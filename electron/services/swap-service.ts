import { randomBytes, createHash } from 'crypto';
import WebSocket from 'ws';
import { finalizeEvent, getPublicKey, Relay, verifyEvent } from 'nostr-tools';
import type { Event as NostrEvent, EventTemplate, Filter } from 'nostr-tools';
import { useWebSocketImplementation as configureNostrWebSocket } from 'nostr-tools/relay';
import * as bitcoin from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import type {
  SwapOffer,
  SwapAccept,
  LocalSwap,
  SwapTerms,
  SwapFunding,
  SwapSecretReveal,
  SwapStatusMessage,
  DgbNetworkType,
} from '../../src/types/swap';
import type { ElectrumDgbService } from './electrum-dgb-service';
import type { DBService } from './db-service';
import type { WalletService } from './wallet-service';
import {
  HTLC_TIMEOUT_DGB,
  HTLC_TIMEOUT_HNS,
  buildDgbClaimTx,
  buildDgbFundingTx,
  buildDgbRefundTx,
  buildHtlcRedeemScript,
  createP2shAddress,
  type DgbFundingUtxo,
} from './htlc-service';
import {
  HNS_HTLC_FEE,
  buildHnsClaimTx,
  buildHnsHtlcScript,
  buildHnsRefundTx,
  createHnsP2wshAddress,
  generateSecret,
  type HnsNetwork,
} from './htlc-hns-service';
import { compressedNostrPubkey, normalizeNostrSecretKey } from './hns-escrow-service';
import { getDgbNetwork, toBitcoinJsNetwork } from '../dgb-networks';
import { isValidHnsAddress, normalizeHnsAddress } from '../../src/lib/address-utils';

// nostr-tools has more than one bundled relay module, and some copies read the
// global WebSocket directly. Electron's main process has no global WebSocket,
// so install the ws implementation globally as well as in nostr-tools.
const wsGlobal = globalThis as unknown as { WebSocket?: typeof WebSocket };
if (!wsGlobal.WebSocket) wsGlobal.WebSocket = WebSocket;
configureNostrWebSocket(
  WebSocket as unknown as Parameters<typeof configureNostrWebSocket>[0],
);

const SWAP_OFFER_KIND = 38385;
const SWAP_ACCEPT_KIND = 38386;
const SWAP_TERMS_KIND = 38387;
const SWAP_FUNDING_KIND = 38388;
const SWAP_SECRET_KIND = 38389;
const SWAP_STATUS_KIND = 38390;
const SWAP_TAG = 'hns-dgb-swap';
const RELAY_TIMEOUT = 10000;
const EVENT_LIMIT = 500;

const HNS_CONFIRMATIONS_REQUIRED = 2;
const DGB_CONFIRMATIONS_REQUIRED = 6;
const DGB_FALLBACK_FEE_RATE = 20_000; // sat/kB
const DGB_OFFER_FEE_BUFFER = 20_000; // sats reserved for DGB funding
const DGB_MIN_HTLC_AMOUNT = 10_000; // sats; must exceed the claim fee

type CreateSwapOfferInput = Omit<
  SwapOffer,
  'id' | 'nostrPubkey' | 'createdAt' | 'status' | 'dgbPubKey'
>;

interface RawSwapEvent {
  id: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  content: string;
  tags: string[][];
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateId(): string {
  return bytesToHex(randomBytes(16));
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isXOnlyPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function isCompressedPubkey(value: string): boolean {
  if (!/^(02|03)[0-9a-f]{64}$/i.test(value)) return false;
  try {
    secp256k1.Point.fromHex(value);
    return true;
  } catch {
    return false;
  }
}

function secretMatchesHash(secretHex: string, expectedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(secretHex)) return false;
  return createHash('sha256').update(Buffer.from(secretHex, 'hex')).digest('hex')
    === expectedHash;
}

export class SwapService {
  private dbService: DBService;
  private electrumService: ElectrumDgbService;
  private walletService: WalletService;
  private _secretKey: Uint8Array;
  private _publicKey: string;
  private activeSwaps: Map<string, LocalSwap> = new Map();
  private offerSubscriptions: Array<(offers: SwapOffer[]) => void> = [];
  private swapUpdateCallbacks: Array<(swap: LocalSwap) => void> = [];
  private _monitorInterval: NodeJS.Timeout | null = null;
  private _pollInFlight = false;
  private _fundingLocks = new Set<string>();
  private _autoActionLocks = new Set<string>();

  constructor(
    dbService: DBService,
    electrumService: ElectrumDgbService,
    walletService: WalletService,
  ) {
    this.dbService = dbService;
    this.electrumService = electrumService;
    this.walletService = walletService;

    const stored = this.dbService.getNostrPrivateKey();
    if (stored) {
      this._secretKey = hexToBytes(stored);
    } else {
      this._secretKey = randomBytes(32);
      this.dbService.setNostrPrivateKey(bytesToHex(this._secretKey));
    }
    this._publicKey = getPublicKey(this._secretKey);

    this.loadActiveSwaps();
  }

  get publicKey(): string { return this._publicKey; }

  get relays(): string[] {
    return this.dbService.getNostrRelays();
  }

  private loadActiveSwaps(): void {
    try {
      const swaps = this.dbService.getActiveSwaps();
      for (const swap of swaps) {
        if ((swap.state as string) === 'secret_generated') {
          swap.state = swap.hnsHtlcTxid ? 'hns_funding' : 'terms_ready';
        }
        if (!swap.secretHex && swap.encryptedSecret) {
          swap.secretHex = swap.encryptedSecret;
        }
        this.activeSwaps.set(swap.id, swap);
      }
    } catch { /* ignore */ }
  }

  private persistSwap(swap: LocalSwap): void {
    this.activeSwaps.set(swap.id, swap);
    try {
      this.dbService.saveSwap(swap);
    } catch (err) {
      console.error('[SwapService] Failed to persist swap:', err);
    }
  }

  private async withRelay<T>(url: string, fn: (relay: Relay) => Promise<T>): Promise<T | null> {
    try {
      const relay = await Relay.connect(url);
      try {
        return await fn(relay);
      } finally {
        relay.close();
      }
    } catch (err) {
      console.error(`[Swap] Relay ${url} error:`, err);
      return null;
    }
  }

  private async publishEvent(kind: number, content: string, tags: string[][]): Promise<void> {
    const template: EventTemplate = {
      kind,
      created_at: nowSeconds(),
      tags,
      content,
    };
    const signed = finalizeEvent(template, this._secretKey);
    const results = await Promise.allSettled(
      this.relays.map(url => this.withRelay(url, relay => relay.publish(signed))),
    );
    const failures = results.filter(r => r.status === 'rejected' || r.value === null).length;
    if (failures === this.relays.length) {
      const firstErr = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      throw new Error(`Failed to publish swap event to any relay: ${firstErr?.reason?.message || 'unknown'}`);
    }
  }

  private async publishSwapEvent(
    kind: number,
    offerId: string,
    content: unknown,
    participants: string[],
  ): Promise<void> {
    const tags: string[][] = [
      ['d', offerId],
      ['t', SWAP_TAG],
    ];
    for (const pubkey of Array.from(new Set(participants.filter(Boolean)))) {
      tags.push(['p', pubkey]);
    }
    await this.publishEvent(kind, JSON.stringify(content), tags);
  }

  /**
   * Swap events use the shared offer id. The acceptor's local swap id is
   * generated, so look up by the embedded offer id when the direct key misses.
   */
  private findSwapByOfferId(offerId: string): LocalSwap | undefined {
    const direct = this.activeSwaps.get(offerId);
    if (direct) return direct;
    for (const swap of this.activeSwaps.values()) {
      if (swap.offer?.id === offerId) return swap;
    }
    return undefined;
  }

  private async fetchSwapEvents(kinds: number[]): Promise<RawSwapEvent[]> {
    const filter: Filter = {
      kinds,
      '#t': [SWAP_TAG],
      limit: EVENT_LIMIT,
    };
    const seen = new Map<string, RawSwapEvent>();

    await Promise.allSettled(
      this.relays.map(url => this.withRelay(url, (relay) => {
        return new Promise<void>((resolve) => {
          const sub = relay.subscribe([filter], {
            onevent: (event: NostrEvent) => {
              try {
                if (!verifyEvent(event)) return;
                seen.set(event.id, {
                  id: event.id,
                  kind: event.kind,
                  pubkey: event.pubkey,
                  createdAt: event.created_at,
                  content: event.content,
                  tags: event.tags,
                });
              } catch { /* ignore */ }
            },
            oneose: () => { sub.close(); resolve(); },
          });
          setTimeout(() => { sub.close(); resolve(); }, RELAY_TIMEOUT);
        });
      })),
    );

    return Array.from(seen.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  // ============================================================
  // Keys and networks
  // ============================================================

  private getHnsNetwork(): HnsNetwork {
    const network = this.dbService.getSavedConnectionConfig()?.network;
    if (network === 'testnet') return 'testnet';
    if (network === 'regtest') return 'regtest';
    return 'mainnet';
  }

  private getDgbNetworkType(): DgbNetworkType {
    if (this.electrumService.isConnected()) {
      const info = this.electrumService.getServerInfo();
      if (info.network === 'testnet') return 'testnet';
      return 'mainnet';
    }
    return this.dbService.getDgbServerConfig()?.network === 'testnet'
      ? 'testnet'
      : 'mainnet';
  }

  private getHnsSwapKeys(): { secret: Uint8Array; publicKey: Buffer } {
    return {
      secret: normalizeNostrSecretKey(this._secretKey),
      publicKey: compressedNostrPubkey(this._publicKey),
    };
  }

  private getDgbKeys(): {
    privateKey: Buffer;
    publicKey: Buffer;
    address: string;
    network: DgbNetworkType;
  } {
    let seed = this.dbService.getDgbSeed();
    if (!seed) {
      seed = randomBytes(32).toString('hex');
      this.dbService.setDgbSeed(seed);
    }
    const privateKey = Buffer.from(seed, 'hex').slice(0, 32);
    if (privateKey.length !== 32) throw new Error('Invalid DGB wallet seed');
    const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, true));
    const network = this.getDgbNetworkType();
    const address = bitcoin.payments.p2pkh({
      pubkey: publicKey,
      network: toBitcoinJsNetwork(getDgbNetwork(network)),
    }).address;
    if (!address) throw new Error('Could not derive DGB address');
    return { privateKey, publicKey, address, network };
  }

  private async getHnsAddress(): Promise<string> {
    const result = await this.walletService.getAddress();
    const address = result.address;
    if (!isValidHnsAddress(address)) throw new Error('No valid HNS wallet address');
    return address;
  }

  private async getHnsHeight(): Promise<number> {
    return await this.walletService.getBlockHeight();
  }

  private async getDgbHeight(): Promise<number> {
    return await this.electrumService.getCurrentBlockHeight();
  }

  private async dgbFeeRateSatPerKb(): Promise<number> {
    const dgbPerKb = await this.electrumService.estimateFee(2);
    return Math.max(1000, Math.ceil(Number(dgbPerKb) * 1e8) || DGB_FALLBACK_FEE_RATE);
  }

  private async dgbSpendFee(estimatedSize = 320): Promise<number> {
    const rate = await this.dgbFeeRateSatPerKb();
    return Math.max(1000, Math.ceil((rate * estimatedSize) / 1000));
  }

  private selectDgbUtxos(
    utxos: Array<{ txHash: string; vout: number; value: number; confirmations: number }>,
    target: number,
    feeRateSatPerKb: number,
  ): DgbFundingUtxo[] {
    const available = utxos
      .filter(utxo => utxo.confirmations > 0)
      .sort((a, b) => b.value - a.value);
    const selected: DgbFundingUtxo[] = [];
    let total = 0;
    for (const utxo of available) {
      selected.push({ txHash: utxo.txHash, vout: utxo.vout, value: utxo.value });
      total += utxo.value;
      const size = 10 + selected.length * 148 + 2 * 34;
      const fee = Math.max(1000, Math.ceil((feeRateSatPerKb * size) / 1000));
      if (total >= target + fee) return selected;
    }
    throw new Error('Insufficient confirmed DGB funds for the HTLC and fee');
  }

  // ============================================================
  // Offers
  // ============================================================

  async publishOffer(offer: CreateSwapOfferInput): Promise<SwapOffer> {
    if (offer.direction !== 'hnsToDgb' && offer.direction !== 'dgbToHns') {
      throw new Error('Choose a valid swap direction.');
    }
    const hnsAmount = Number(offer.hnsAmount);
    const dgbAmount = Number(offer.dgbAmount);
    const exchangeRate = Number(offer.exchangeRate);
    if (!Number.isFinite(hnsAmount) || hnsAmount <= 0) throw new Error('Enter a valid HNS amount.');
    if (!Number.isFinite(dgbAmount) || dgbAmount <= 0) throw new Error('Enter a valid DGB amount.');
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error('Enter a valid exchange rate.');
    if (offer.expiresAt != null && offer.expiresAt * 1000 <= Date.now()) {
      throw new Error('The offer expiry must be in the future.');
    }

    const hnsBase = Math.round(hnsAmount * 1_000_000);
    const dgbBase = Math.round(dgbAmount * 1e8);
    if (!Number.isSafeInteger(hnsBase) || hnsBase <= HNS_HTLC_FEE) {
      throw new Error('The HNS amount does not cover the HTLC transaction fee.');
    }
    if (!Number.isSafeInteger(dgbBase) || dgbBase <= DGB_MIN_HTLC_AMOUNT) {
      throw new Error('The DGB amount is too small to cover the HTLC claim fee.');
    }

    const dgb = this.getDgbKeys();
    if (offer.direction === 'hnsToDgb') {
      const balance = await this.walletService.getBalance();
      if (balance.spendable < hnsBase + 100_000) {
        throw new Error(
          `Insufficient HNS balance. Need at least ${((hnsBase + 100_000) / 1_000_000).toFixed(6)} HNS including the fee buffer.`,
        );
      }
    } else {
      if (!this.electrumService.isConnected()) {
        throw new Error('Connect to DGB before publishing a DGB → HNS offer.');
      }
      const balance = await this.electrumService.getBalance(dgb.address);
      if (balance.confirmed < dgbBase + DGB_OFFER_FEE_BUFFER) {
        throw new Error(
          `Insufficient DGB balance. Need at least ${((dgbBase + DGB_OFFER_FEE_BUFFER) / 1e8).toFixed(8)} DGB including the fee buffer.`,
        );
      }
    }

    const fullOffer: SwapOffer = {
      ...offer,
      hnsAmount,
      dgbAmount,
      exchangeRate,
      dgbAddress: dgb.address,
      dgbPubKey: dgb.publicKey.toString('hex'),
      id: generateId(),
      nostrPubkey: this._publicKey,
      createdAt: nowSeconds(),
      status: 'active',
    };

    await this.publishEvent(SWAP_OFFER_KIND, JSON.stringify(fullOffer), [
      ['d', fullOffer.id],
      ['t', SWAP_TAG],
      ['p', this._publicKey],
    ]);

    this.dbService.saveMySwapOffer(fullOffer);

    // The HNS side is always the protocol initiator. The HNS side funds the
    // HNS HTLC first and later claims DGB. For a DGB → HNS offer, the offerer
    // is the DGB side and therefore starts as the protocol counterparty.
    const isHnsSide = fullOffer.direction === 'hnsToDgb';
    const swap: LocalSwap = {
      id: fullOffer.id,
      offer: fullOffer,
      state: 'offered',
      role: isHnsSide ? 'initiator' : 'counterparty',
      initiatorDgbPubKey: isHnsSide ? fullOffer.dgbPubKey : undefined,
      counterpartyDgbPubKey: isHnsSide ? undefined : fullOffer.dgbPubKey,
      hnsTimeout: 0,
      dgbTimeout: 0,
      transactions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.persistSwap(swap);
    return fullOffer;
  }

  async cancelOffer(offerId: string): Promise<void> {
    const offer = this.dbService.getMySwapOffers().find(o => o.id === offerId);
    if (!offer) return;

    const cancelled: SwapOffer = { ...offer, status: 'cancelled' };
    await this.publishEvent(SWAP_OFFER_KIND, JSON.stringify(cancelled), [
      ['d', cancelled.id],
      ['t', SWAP_TAG],
      ['p', this._publicKey],
    ]);
    this.dbService.saveMySwapOffer(cancelled);

    const swap = this.activeSwaps.get(offerId);
    if (swap && swap.state === 'offered') {
      swap.state = 'failed';
      swap.offer = { ...swap.offer, status: 'cancelled' };
      swap.updatedAt = Date.now();
      this.persistSwap(swap);
      this.notifySwapUpdate(swap);
    }
  }

  async fetchActiveOffers(): Promise<SwapOffer[]> {
    const events = await this.fetchSwapEvents([SWAP_OFFER_KIND]);
    const latest = new Map<string, { offer: SwapOffer; createdAt: number }>();

    for (const event of events) {
      try {
        const offer = JSON.parse(event.content) as SwapOffer;
        if (offer.direction !== 'hnsToDgb' && offer.direction !== 'dgbToHns') continue;
        if (offer.nostrPubkey !== event.pubkey) continue;
        if (!offer.id) continue;
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
        if (dTag && dTag !== offer.id) continue;
        const existing = latest.get(offer.id);
        if (!existing || event.createdAt > existing.createdAt) {
          latest.set(offer.id, {
            offer: { ...offer, nostrEventId: event.id },
            createdAt: event.createdAt,
          });
        }
      } catch { /* ignore malformed offer */ }
    }

    return Array.from(latest.values())
      .filter(({ offer }) => {
        if (offer.status !== 'active') return false;
        if (offer.nostrPubkey === this._publicKey) return false;
        if (!isCompressedPubkey(offer.dgbPubKey || '')) return false;
        if (!Number.isFinite(offer.hnsAmount) || offer.hnsAmount <= 0) return false;
        if (!Number.isFinite(offer.dgbAmount) || offer.dgbAmount <= 0) return false;
        const hnsBase = Math.round(offer.hnsAmount * 1_000_000);
        const dgbBase = Math.round(offer.dgbAmount * 1e8);
        if (!Number.isSafeInteger(hnsBase) || hnsBase <= HNS_HTLC_FEE) return false;
        if (!Number.isSafeInteger(dgbBase) || dgbBase <= DGB_MIN_HTLC_AMOUNT) return false;
        if (offer.expiresAt != null && offer.expiresAt * 1000 <= Date.now()) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(item => item.offer);
  }

  async subscribeActiveOffers(): Promise<() => void> {
    const intervalId = setInterval(async () => {
      try {
        const offers = await this.fetchActiveOffers();
        this.offerSubscriptions.forEach(cb => cb(offers));
      } catch { /* ignore */ }
    }, 15000);

    return () => clearInterval(intervalId);
  }

  onOffers(callback: (offers: SwapOffer[]) => void): () => void {
    this.offerSubscriptions.push(callback);
    return () => {
      this.offerSubscriptions = this.offerSubscriptions.filter(cb => cb !== callback);
    };
  }

  onSwapUpdate(callback: (swap: LocalSwap) => void): () => void {
    this.swapUpdateCallbacks.push(callback);
    return () => {
      this.swapUpdateCallbacks = this.swapUpdateCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifySwapUpdate(swap: LocalSwap): void {
    this.swapUpdateCallbacks.forEach(cb => cb(swap));
  }

  async acceptOffer(offer: SwapOffer): Promise<LocalSwap> {
    if (offer.direction !== 'hnsToDgb' && offer.direction !== 'dgbToHns') {
      throw new Error('Choose a valid swap direction.');
    }
    if (offer.status !== 'active') throw new Error('This offer is no longer active.');
    if (offer.nostrPubkey === this._publicKey) throw new Error('You cannot accept your own offer.');
    if (offer.expiresAt != null && offer.expiresAt * 1000 <= Date.now()) {
      throw new Error('This offer has expired.');
    }
    if (!isXOnlyPubkey(offer.nostrPubkey || '')) throw new Error('Invalid offer pubkey.');
    if (!isCompressedPubkey(offer.dgbPubKey || '')) throw new Error('Offer is missing a valid DGB pubkey.');

    const hnsBase = Math.round(Number(offer.hnsAmount) * 1_000_000);
    const dgbBase = Math.round(Number(offer.dgbAmount) * 1e8);
    if (!Number.isSafeInteger(hnsBase) || hnsBase <= HNS_HTLC_FEE) {
      throw new Error('The offer HNS amount does not cover the HTLC claim fee.');
    }
    if (!Number.isSafeInteger(dgbBase) || dgbBase <= DGB_MIN_HTLC_AMOUNT) {
      throw new Error('The offer DGB amount is too small to cover the HTLC claim fee.');
    }

    const dgb = this.getDgbKeys();
    // The acceptor is the HNS side only for DGB → HNS offers. The HNS side
    // always funds HNS first, so it is the protocol initiator.
    const isHnsSide = offer.direction === 'dgbToHns';
    if (isHnsSide) {
      const balance = await this.walletService.getBalance();
      if (balance.spendable < hnsBase + 100_000) {
        throw new Error(
          `Insufficient HNS balance to accept this offer. Need at least ${((hnsBase + 100_000) / 1_000_000).toFixed(6)} HNS.`,
        );
      }
    } else {
      if (!this.electrumService.isConnected()) {
        throw new Error('Connect to DGB before accepting an HNS → DGB offer.');
      }
      const balance = await this.electrumService.getBalance(dgb.address);
      if (balance.confirmed < dgbBase + DGB_OFFER_FEE_BUFFER) {
        throw new Error(
          `Insufficient DGB balance to accept this offer. Need at least ${((dgbBase + DGB_OFFER_FEE_BUFFER) / 1e8).toFixed(8)} DGB.`,
        );
      }
    }

    const swap: LocalSwap = {
      id: generateId(),
      offer: { ...offer, status: 'accepted' },
      state: 'accepted',
      autoComplete: this.isAutoCompleteEnabled(),
      role: isHnsSide ? 'initiator' : 'counterparty',
      counterpartyPubkey: offer.nostrPubkey,
      initiatorDgbPubKey: isHnsSide ? dgb.publicKey.toString('hex') : offer.dgbPubKey,
      counterpartyDgbPubKey: isHnsSide ? offer.dgbPubKey : dgb.publicKey.toString('hex'),
      counterpartyDgbAddress: offer.dgbAddress,
      hnsTimeout: 0,
      dgbTimeout: 0,
      transactions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.persistSwap(swap);

    const accept: SwapAccept = {
      offerId: offer.id,
      nostrPubkey: this._publicKey,
      dgbAddress: dgb.address,
      dgbPubKey: dgb.publicKey.toString('hex'),
      createdAt: nowSeconds(),
    };
    await this.publishSwapEvent(
      SWAP_ACCEPT_KIND,
      offer.id,
      accept,
      [offer.nostrPubkey, this._publicKey],
    );

    this.notifySwapUpdate(swap);
    await this.maybeAutoAdvance(swap);
    return swap;
  }

  // ============================================================
  // Terms
  // ============================================================

  private async createTerms(swap: LocalSwap): Promise<SwapTerms> {
    if (swap.role !== 'initiator') throw new Error('Only the initiator creates swap terms.');
    if (!swap.counterpartyPubkey || !isXOnlyPubkey(swap.counterpartyPubkey)) {
      throw new Error('The counterparty Nostr pubkey is missing.');
    }
    if (!swap.initiatorDgbPubKey || !isCompressedPubkey(swap.initiatorDgbPubKey)) {
      throw new Error('The initiator DGB pubkey is missing.');
    }
    if (!swap.counterpartyDgbPubKey || !isCompressedPubkey(swap.counterpartyDgbPubKey)) {
      throw new Error('The counterparty DGB pubkey is missing.');
    }

    const hnsHeight = await this.getHnsHeight();
    const dgbHeight = await this.getDgbHeight();
    if (hnsHeight <= 0) throw new Error('Connect to the HNS node before starting the swap.');
    if (dgbHeight <= 0) throw new Error('Connect to DGB before starting the swap.');

    const hnsKeys = this.getHnsSwapKeys();
    const secret = generateSecret();
    const hnsTimeout = hnsHeight + HTLC_TIMEOUT_HNS;
    const dgbTimeout = dgbHeight + HTLC_TIMEOUT_DGB;
    const hnsAmount = Math.round(swap.offer.hnsAmount * 1_000_000);
    const dgbAmount = Math.round(swap.offer.dgbAmount * 1e8);

    if (hnsAmount <= HNS_HTLC_FEE) {
      throw new Error('The HNS amount does not cover the claim fee.');
    }

    const hnsScript = buildHnsHtlcScript(
      secret.secretHash,
      compressedNostrPubkey(swap.counterpartyPubkey),
      hnsKeys.publicKey,
      hnsTimeout,
    );
    const dgbScript = buildHtlcRedeemScript(
      secret.secretHash,
      Buffer.from(swap.initiatorDgbPubKey, 'hex'),
      Buffer.from(swap.counterpartyDgbPubKey, 'hex'),
      dgbTimeout,
    );

    const hnsHtlcAddress = createHnsP2wshAddress(hnsScript, this.getHnsNetwork());
    const dgbP2sh = createP2shAddress(dgbScript, this.getDgbNetworkType());

    const terms: SwapTerms = {
      offerId: swap.offer.id,
      direction: swap.offer.direction,
      initiatorPubkey: this._publicKey,
      counterpartyPubkey: swap.counterpartyPubkey,
      initiatorDgbPubKey: swap.initiatorDgbPubKey,
      counterpartyDgbPubKey: swap.counterpartyDgbPubKey,
      secretHash: secret.secretHash.toString('hex'),
      hnsTimeout,
      dgbTimeout,
      hnsHtlcAddress,
      hnsHtlcScript: hnsScript.toString('hex'),
      dgbHtlcAddress: dgbP2sh.address,
      dgbHtlcScript: dgbScript.toString('hex'),
      hnsAmount,
      dgbAmount,
      createdAt: nowSeconds(),
    };

    swap.terms = terms;
    swap.secretHex = secret.secret.toString('hex');
    swap.secretHash = terms.secretHash;
    swap.hnsTimeout = hnsTimeout;
    swap.dgbTimeout = dgbTimeout;
    swap.hnsHtlcAddress = hnsHtlcAddress;
    swap.hnsHtlcScript = terms.hnsHtlcScript;
    swap.dgbHtlcAddress = terms.dgbHtlcAddress;
    swap.dgbHtlcScript = terms.dgbHtlcScript;
    swap.initiatorDgbPubKey = terms.initiatorDgbPubKey;
    swap.counterpartyDgbPubKey = terms.counterpartyDgbPubKey;
    swap.state = 'terms_ready';
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);
    return terms;
  }

  private async validateTerms(swap: LocalSwap, terms: SwapTerms): Promise<void> {
    if (!swap.counterpartyPubkey) throw new Error('Counterparty pubkey missing.');
    if (terms.offerId !== swap.offer.id) throw new Error('Terms belong to a different offer.');
    if (terms.direction !== swap.offer.direction) {
      throw new Error('Terms direction does not match the offer.');
    }

    const localDgbPubkey = this.getDgbKeys().publicKey.toString('hex');
    const expectedInitiatorPubkey = swap.role === 'initiator'
      ? this._publicKey
      : swap.counterpartyPubkey;
    const expectedCounterpartyPubkey = swap.role === 'counterparty'
      ? this._publicKey
      : swap.counterpartyPubkey;
    const expectedInitiatorDgb = swap.role === 'initiator'
      ? localDgbPubkey
      : swap.initiatorDgbPubKey;
    const expectedCounterpartyDgb = swap.role === 'counterparty'
      ? localDgbPubkey
      : swap.counterpartyDgbPubKey;

    if (terms.initiatorPubkey !== expectedInitiatorPubkey) {
      throw new Error('Terms initiator pubkey mismatch.');
    }
    if (terms.counterpartyPubkey !== expectedCounterpartyPubkey) {
      throw new Error('Terms counterparty pubkey mismatch.');
    }
    if (!expectedInitiatorDgb || terms.initiatorDgbPubKey !== expectedInitiatorDgb) {
      throw new Error('Terms initiator DGB pubkey mismatch.');
    }
    if (!expectedCounterpartyDgb || terms.counterpartyDgbPubKey !== expectedCounterpartyDgb) {
      throw new Error('Terms counterparty DGB pubkey mismatch.');
    }
    if (!isCompressedPubkey(terms.initiatorDgbPubKey)
      || !isCompressedPubkey(terms.counterpartyDgbPubKey)) {
      throw new Error('Terms contain invalid DGB pubkeys.');
    }
    if (!/^[0-9a-f]{64}$/.test(terms.secretHash)) {
      throw new Error('Terms contain an invalid secret hash.');
    }
    const expectedHns = Math.round(swap.offer.hnsAmount * 1_000_000);
    const expectedDgb = Math.round(swap.offer.dgbAmount * 1e8);
    if (terms.hnsAmount !== expectedHns || terms.dgbAmount !== expectedDgb) {
      throw new Error('Terms amounts do not match the offer.');
    }

    const hnsHeight = await this.getHnsHeight();
    const dgbHeight = await this.getDgbHeight();
    if (!Number.isSafeInteger(terms.hnsTimeout) || terms.hnsTimeout < hnsHeight + 144) {
      throw new Error('HNS HTLC timeout is missing or too short.');
    }
    if (!Number.isSafeInteger(terms.dgbTimeout) || terms.dgbTimeout < dgbHeight + 720) {
      throw new Error('DGB HTLC timeout is missing or too short.');
    }

    const hnsScript = buildHnsHtlcScript(
      Buffer.from(terms.secretHash, 'hex'),
      compressedNostrPubkey(terms.counterpartyPubkey),
      compressedNostrPubkey(terms.initiatorPubkey),
      terms.hnsTimeout,
    );
    if (hnsScript.toString('hex') !== terms.hnsHtlcScript) {
      throw new Error('HNS HTLC script does not match the terms.');
    }
    const hnsAddress = createHnsP2wshAddress(hnsScript, this.getHnsNetwork());
    if (hnsAddress !== terms.hnsHtlcAddress) {
      throw new Error('HNS HTLC address does not match the terms.');
    }

    const dgbScript = buildHtlcRedeemScript(
      Buffer.from(terms.secretHash, 'hex'),
      Buffer.from(terms.initiatorDgbPubKey, 'hex'),
      Buffer.from(terms.counterpartyDgbPubKey, 'hex'),
      terms.dgbTimeout,
    );
    if (dgbScript.toString('hex') !== terms.dgbHtlcScript) {
      throw new Error('DGB HTLC script does not match the terms.');
    }
    const dgbP2sh = createP2shAddress(dgbScript, this.getDgbNetworkType());
    if (dgbP2sh.address !== terms.dgbHtlcAddress) {
      throw new Error('DGB HTLC address does not match the terms.');
    }
  }

  private applyTerms(swap: LocalSwap, terms: SwapTerms): void {
    swap.terms = terms;
    swap.secretHash = terms.secretHash;
    swap.hnsTimeout = terms.hnsTimeout;
    swap.dgbTimeout = terms.dgbTimeout;
    swap.hnsHtlcAddress = terms.hnsHtlcAddress;
    swap.hnsHtlcScript = terms.hnsHtlcScript;
    swap.dgbHtlcAddress = terms.dgbHtlcAddress;
    swap.dgbHtlcScript = terms.dgbHtlcScript;
    swap.initiatorDgbPubKey = terms.initiatorDgbPubKey;
    swap.counterpartyDgbPubKey = terms.counterpartyDgbPubKey;
    swap.state = 'terms_ready';
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);
  }

  // ============================================================
  // Funding
  // ============================================================

  private async waitForHnsFunding(
    txid: string,
    address: string,
  ): Promise<{ vout: number; value: number } | null> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const tx = await this.walletService.getTransaction(txid);
      if (tx && Array.isArray(tx.outputs)) {
        const outputs = tx.outputs as Array<{ value: number; address?: string }>;
        const vout = outputs.findIndex(
          output => normalizeHnsAddress(String(output.address || '')) === address,
        );
        if (vout >= 0) {
          return { vout, value: Number(outputs[vout].value) };
        }
      }
      await sleep(1000);
    }
    return null;
  }

  async executeSwapAsInitiator(swapId: string, passphrase: string): Promise<void> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) throw new Error('Swap not found.');
    if (swap.role !== 'initiator') throw new Error('Only the HNS side can start this swap.');
    if (!['accepted', 'terms_ready', 'hns_funding'].includes(swap.state)) {
      throw new Error(`Swap is in state ${swap.state}, expected accepted or terms_ready.`);
    }
    if (!swap.counterpartyPubkey || !swap.counterpartyDgbPubKey) {
      throw new Error('The counterparty has not supplied its DGB pubkey yet.');
    }

    if (!swap.terms) {
      await this.createTerms(swap);
    }
    const terms = swap.terms;
    if (!terms) throw new Error('Swap terms could not be created.');

    await this.publishSwapEvent(
      SWAP_TERMS_KIND,
      swap.offer.id,
      terms,
      [terms.initiatorPubkey, terms.counterpartyPubkey],
    );

    if (swap.hnsHtlcTxid) {
      const existing = await this.waitForHnsFunding(swap.hnsHtlcTxid, terms.hnsHtlcAddress);
      if (!existing) {
        throw new Error('HNS funding was broadcast but the HTLC output is not visible yet.');
      }
      swap.hnsHtlcVout = existing.vout;
      swap.hnsHtlcValue = existing.value;
      swap.state = 'hns_funding';
      swap.updatedAt = Date.now();
      this.persistSwap(swap);
      const funding: SwapFunding = {
        offerId: swap.offer.id,
        chain: 'hns',
        txid: swap.hnsHtlcTxid,
        vout: existing.vout,
        amount: existing.value,
        address: terms.hnsHtlcAddress,
        createdAt: nowSeconds(),
      };
      await this.publishSwapEvent(
        SWAP_FUNDING_KIND,
        swap.offer.id,
        funding,
        [terms.initiatorPubkey, terms.counterpartyPubkey],
      );
      this.notifySwapUpdate(swap);
      return;
    }

    const tx = await this.walletService.sendToAddress(
      terms.hnsHtlcAddress,
      terms.hnsAmount,
      passphrase,
      { subtractFee: false },
    );

    swap.hnsHtlcTxid = tx.hash;
    swap.state = 'hns_funding';
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);

    const output = await this.waitForHnsFunding(tx.hash, terms.hnsHtlcAddress);
    if (!output) {
      throw new Error(`HNS funding was broadcast (${tx.hash}), but its HTLC output is not visible yet. Re-run Start Swap to refresh.`);
    }

    swap.hnsHtlcVout = output.vout;
    swap.hnsHtlcValue = output.value;
    swap.updatedAt = Date.now();
    this.persistSwap(swap);

    const funding: SwapFunding = {
      offerId: swap.offer.id,
      chain: 'hns',
      txid: tx.hash,
      vout: output.vout,
      amount: output.value,
      address: terms.hnsHtlcAddress,
      createdAt: nowSeconds(),
    };
    await this.publishSwapEvent(
      SWAP_FUNDING_KIND,
      swap.offer.id,
      funding,
      [terms.initiatorPubkey, terms.counterpartyPubkey],
    );
    this.notifySwapUpdate(swap);
  }

  private async getHnsFundingStatus(swap: LocalSwap): Promise<{
    vout: number;
    value: number;
    confirmations: number;
  } | null> {
    if (!swap.terms || !swap.hnsHtlcTxid) return null;
    const tx = await this.walletService.getTransaction(swap.hnsHtlcTxid);
    if (!tx || !Array.isArray(tx.outputs)) return null;
    const outputs = tx.outputs as Array<{ value: number; address?: string }>;
    const vout = outputs.findIndex(
      output => normalizeHnsAddress(String(output.address || '')) === swap.terms!.hnsHtlcAddress,
    );
    if (vout < 0) return null;

    let confirmations = Number(tx.confirmations) || 0;
    const height = Number(tx.height) || 0;
    if (height > 0) {
      const currentHeight = await this.getHnsHeight();
      confirmations = Math.max(1, currentHeight - height + 1);
    }
    return {
      vout,
      value: Number(outputs[vout].value),
      confirmations,
    };
  }

  private async getDgbFundingStatus(swap: LocalSwap): Promise<{
    vout: number;
    value: number;
    confirmations: number;
  } | null> {
    if (!swap.terms || !swap.dgbHtlcTxid) return null;
    const tx = await this.electrumService.getTransaction(swap.dgbHtlcTxid, true);
    if (!tx || !Array.isArray(tx.vout)) return null;
    const network = toBitcoinJsNetwork(getDgbNetwork(this.getDgbNetworkType()));
    const expectedScript = Buffer.from(bitcoin.address.toOutputScript(
      swap.terms.dgbHtlcAddress,
      network,
    )).toString('hex');
    const outputs = tx.vout as Array<{
      value: number;
      n: number;
      scriptPubKey?: { hex?: string; addresses?: string[] };
    }>;
    const vout = outputs.find((output) => {
      const spk = output.scriptPubKey;
      if (!spk) return false;
      if (spk.hex && spk.hex === expectedScript) return true;
      return (spk.addresses || []).includes(swap.terms!.dgbHtlcAddress);
    });
    if (!vout) return null;

    const value = Math.round(Number(vout.value) * 1e8);
    let confirmations = Number(tx.confirmations) || 0;
    const height = Number(tx.height) || 0;
    if (height > 0) {
      const currentHeight = await this.getDgbHeight();
      confirmations = Math.max(1, currentHeight - height + 1);
    }
    return { vout: Number(vout.n), value, confirmations };
  }

  async fundDgbHtlc(swapId: string): Promise<void> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) throw new Error('Swap not found.');
    if (swap.role !== 'counterparty') throw new Error('Only the DGB side can fund the DGB HTLC.');
    if (!swap.terms) throw new Error('Swap terms are not available yet.');
    if (!['terms_ready', 'hns_funding', 'hns_htlc_funded'].includes(swap.state)) {
      throw new Error(`Swap is in state ${swap.state}, expected HNS funding first.`);
    }
    if (swap.dgbHtlcTxid) {
      const funding: SwapFunding = {
        offerId: swap.offer.id,
        chain: 'dgb',
        txid: swap.dgbHtlcTxid,
        vout: swap.dgbHtlcVout ?? 0,
        amount: swap.dgbHtlcValue ?? swap.terms.dgbAmount,
        address: swap.terms.dgbHtlcAddress,
        createdAt: nowSeconds(),
      };
      await this.publishSwapEvent(
        SWAP_FUNDING_KIND,
        swap.offer.id,
        funding,
        [swap.terms.initiatorPubkey, swap.terms.counterpartyPubkey],
      );
      return;
    }

    const lockKey = `dgb:${swap.id}`;
    if (this._fundingLocks.has(lockKey)) throw new Error('DGB funding is already in progress.');
    this._fundingLocks.add(lockKey);
    try {
      const hnsStatus = await this.getHnsFundingStatus(swap);
      if (!hnsStatus) throw new Error('HNS HTLC funding has not been detected yet.');
      if (hnsStatus.confirmations < HNS_CONFIRMATIONS_REQUIRED) {
        throw new Error(
          `Wait for ${HNS_CONFIRMATIONS_REQUIRED} HNS confirmations (currently ${hnsStatus.confirmations}).`,
        );
      }
      swap.hnsConfirmations = hnsStatus.confirmations;
      swap.hnsHtlcVout = hnsStatus.vout;
      swap.hnsHtlcValue = hnsStatus.value;
      swap.state = 'hns_htlc_funded';
      this.persistSwap(swap);
      this.notifySwapUpdate(swap);

      const dgb = this.getDgbKeys();
      const dgbPubkey = dgb.publicKey.toString('hex');
      if (dgbPubkey !== swap.terms.counterpartyDgbPubKey) {
        throw new Error('The local DGB key does not match the swap terms.');
      }
      const htlcScript = Buffer.from(swap.terms.dgbHtlcScript, 'hex');
      const p2sh = createP2shAddress(htlcScript, dgb.network);
      if (p2sh.address !== swap.terms.dgbHtlcAddress) {
        throw new Error('The DGB HTLC address does not match the terms.');
      }

      const utxos = await this.electrumService.listUnspent(dgb.address);
      const dgbHeight = await this.getDgbHeight();
      const feeRate = await this.dgbFeeRateSatPerKb();
      const selected = this.selectDgbUtxos(
        utxos.map(utxo => ({
          txHash: utxo.txHash,
          vout: utxo.vout,
          value: utxo.value,
          confirmations: utxo.height > 0
            ? Math.max(1, dgbHeight - utxo.height + 1)
            : 0,
        })),
        swap.terms.dgbAmount,
        feeRate,
      );

      const { txHex, txId } = buildDgbFundingTx({
        utxos: selected,
        privateKey: dgb.privateKey,
        changeAddress: dgb.address,
        htlcScript,
        htlcAmount: swap.terms.dgbAmount,
        feeRateSatPerKb: feeRate,
        network: dgb.network,
      });

      const broadcastId = await this.electrumService.broadcastTransaction(txHex);
      swap.dgbHtlcTxid = broadcastId || txId;
      swap.dgbHtlcVout = 0;
      swap.dgbHtlcValue = swap.terms.dgbAmount;
      swap.dgbHtlcAddress = swap.terms.dgbHtlcAddress;
      swap.dgbHtlcScript = swap.terms.dgbHtlcScript;
      swap.state = 'dgb_funding';
      swap.updatedAt = Date.now();
      this.persistSwap(swap);

      const funding: SwapFunding = {
        offerId: swap.offer.id,
        chain: 'dgb',
        txid: swap.dgbHtlcTxid,
        vout: 0,
        amount: swap.terms.dgbAmount,
        address: swap.terms.dgbHtlcAddress,
        createdAt: nowSeconds(),
      };
      await this.publishSwapEvent(
        SWAP_FUNDING_KIND,
        swap.offer.id,
        funding,
        [swap.terms.initiatorPubkey, swap.terms.counterpartyPubkey],
      );
      this.notifySwapUpdate(swap);
    } finally {
      this._fundingLocks.delete(lockKey);
    }
  }

  // ============================================================
  // Claims and refunds
  // ============================================================

  async claimFromDgbHtlc(swapId: string): Promise<string> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) throw new Error('Swap not found.');
    if (swap.role !== 'initiator') throw new Error('Only the HNS side can claim the DGB HTLC.');
    if (!swap.terms) throw new Error('Swap terms are missing.');
    if (!swap.secretHex) throw new Error('The swap secret is missing.');
    if (swap.dgbClaimed || swap.dgbRefunded) throw new Error('The DGB HTLC is already spent.');

    const status = await this.getDgbFundingStatus(swap);
    if (!status) throw new Error('DGB HTLC funding has not been detected.');
    if (status.value !== swap.terms.dgbAmount) {
      throw new Error('The DGB HTLC amount does not match the agreed amount.');
    }
    if (status.confirmations < DGB_CONFIRMATIONS_REQUIRED) {
      throw new Error(
        `Wait for ${DGB_CONFIRMATIONS_REQUIRED} DGB confirmations (currently ${status.confirmations}).`,
      );
    }
    swap.dgbConfirmations = status.confirmations;
    swap.dgbHtlcVout = status.vout;
    swap.dgbHtlcValue = status.value;
    swap.state = 'dgb_htlc_funded';
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);

    const dgb = this.getDgbKeys();
    if (dgb.publicKey.toString('hex') !== swap.terms.initiatorDgbPubKey) {
      throw new Error('The local DGB key does not match the swap terms.');
    }

    const fee = await this.dgbSpendFee();
    const { txHex, txId } = buildDgbClaimTx({
      utxo: {
        txHash: swap.dgbHtlcTxid!,
        vout: status.vout,
        value: status.value,
      },
      redeemScript: Buffer.from(swap.terms.dgbHtlcScript, 'hex'),
      secret: Buffer.from(swap.secretHex, 'hex'),
      privateKey: dgb.privateKey,
      toAddress: dgb.address,
      fee,
      network: dgb.network,
    });
    const broadcastId = await this.electrumService.broadcastTransaction(txHex);

    swap.dgbClaimed = true;
    swap.dgbClaimTxid = broadcastId || txId;
    swap.secretPublished = false;
    swap.state = swap.hnsClaimed ? 'completed' : 'dgb_claimed';
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);

    await this.publishSecret(swap);
    return swap.dgbClaimTxid;
  }

  async claimFromHnsHtlc(swapId: string): Promise<string> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) throw new Error('Swap not found.');
    if (swap.role !== 'counterparty') throw new Error('Only the DGB side can claim the HNS HTLC.');
    if (!swap.terms) throw new Error('Swap terms are missing.');
    if (!swap.secretHex) throw new Error('The DGB claim secret has not been revealed yet.');
    if (swap.hnsClaimed || swap.hnsRefunded) throw new Error('The HNS HTLC is already spent.');
    if (swap.hnsHtlcTxid == null) throw new Error('The HNS HTLC is not funded.');
    if (!secretMatchesHash(swap.secretHex, swap.terms.secretHash)) {
      throw new Error('The revealed secret does not match the HTLC secret hash.');
    }

    const status = await this.getHnsFundingStatus(swap);
    if (!status) throw new Error('HNS HTLC funding has not been detected.');
    if (status.value !== swap.terms.hnsAmount) {
      throw new Error('The HNS HTLC amount does not match the agreed amount.');
    }
    if (status.confirmations < HNS_CONFIRMATIONS_REQUIRED) {
      throw new Error(
        `Wait for ${HNS_CONFIRMATIONS_REQUIRED} HNS confirmations (currently ${status.confirmations}).`,
      );
    }
    swap.hnsConfirmations = status.confirmations;
    swap.hnsHtlcVout = status.vout;
    swap.hnsHtlcValue = status.value;
    this.persistSwap(swap);

    const hnsKeys = this.getHnsSwapKeys();
    if (this._publicKey !== swap.terms.counterpartyPubkey) {
      throw new Error('The local Nostr key does not match the swap terms.');
    }
    const toAddress = await this.getHnsAddress();
    const { txHex } = buildHnsClaimTx({
      utxo: {
        txHash: swap.hnsHtlcTxid,
        vout: status.vout,
        value: status.value,
      },
      redeemScript: Buffer.from(swap.terms.hnsHtlcScript, 'hex'),
      secret: Buffer.from(swap.secretHex, 'hex'),
      privateKey: hnsKeys.secret,
      toAddress,
      fee: HNS_HTLC_FEE,
      network: this.getHnsNetwork(),
    });
    const txid = await this.walletService.broadcastTx(txHex);

    swap.hnsClaimed = true;
    swap.hnsClaimTxid = txid;
    swap.hnsClaimAddress = toAddress;
    swap.hnsClaimValue = status.value - HNS_HTLC_FEE;
    swap.hnsClaimTxHex = txHex;
    swap.hnsClaimBroadcastAt = Date.now();
    swap.hnsClaimConfirmed = false;
    swap.hnsClaimMissing = false;
    swap.state = swap.dgbClaimed ? 'completed' : 'hns_claimed';
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);
    await this.publishStatus(swap, 'hns_claimed', 'hns', txid);
    return txid;
  }

  /**
   * Rebuild and rebroadcast the HNS claim if the original transaction was
   * dropped from the node's mempool before it was mined.
   */
  async rebroadcastHnsClaim(swapId: string): Promise<string> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) throw new Error('Swap not found.');
    if (swap.role !== 'counterparty') throw new Error('Only the DGB side can claim the HNS HTLC.');
    if (!swap.terms) throw new Error('Swap terms are missing.');
    if (!swap.secretHex) throw new Error('The DGB claim secret has not been revealed yet.');
    if (swap.hnsClaimConfirmed) throw new Error('The HNS claim is already confirmed.');
    if (!swap.hnsHtlcTxid) throw new Error('The HNS HTLC is not funded.');
    if (!secretMatchesHash(swap.secretHex, swap.terms.secretHash)) {
      throw new Error('The revealed secret does not match the HTLC secret hash.');
    }

    if (swap.hnsClaimTxid) {
      const existing = await this.walletService.getTransaction(swap.hnsClaimTxid);
      if (existing) {
        await this.refreshHnsClaimStatus(swap);
        throw new Error('The HNS claim is already broadcast; wait for confirmation.');
      }
    }

    const status = await this.getHnsFundingStatus(swap);
    if (!status) throw new Error('HNS HTLC funding has not been detected.');
    if (status.value !== swap.terms.hnsAmount) {
      throw new Error('The HNS HTLC amount does not match the agreed amount.');
    }
    if (status.confirmations < HNS_CONFIRMATIONS_REQUIRED) {
      throw new Error(
        `Wait for ${HNS_CONFIRMATIONS_REQUIRED} HNS confirmations (currently ${status.confirmations}).`,
      );
    }

    const hnsKeys = this.getHnsSwapKeys();
    if (this._publicKey !== swap.terms.counterpartyPubkey) {
      throw new Error('The local Nostr key does not match the swap terms.');
    }
    // Use the original claim address when known. For older swaps without it,
    // the currently selected HNS wallet is the recovery destination.
    const toAddress = swap.hnsClaimAddress || await this.getHnsAddress();
    if (!isValidHnsAddress(toAddress)) throw new Error('No valid HNS wallet address');

    const { txHex } = buildHnsClaimTx({
      utxo: {
        txHash: swap.hnsHtlcTxid,
        vout: status.vout,
        value: status.value,
      },
      redeemScript: Buffer.from(swap.terms.hnsHtlcScript, 'hex'),
      secret: Buffer.from(swap.secretHex, 'hex'),
      privateKey: hnsKeys.secret,
      toAddress,
      fee: HNS_HTLC_FEE,
      network: this.getHnsNetwork(),
    });
    const txid = await this.walletService.broadcastTx(txHex);

    swap.hnsClaimed = true;
    swap.hnsClaimTxid = txid;
    swap.hnsClaimAddress = toAddress;
    swap.hnsClaimValue = status.value - HNS_HTLC_FEE;
    swap.hnsClaimTxHex = txHex;
    swap.hnsClaimBroadcastAt = Date.now();
    swap.hnsClaimConfirmed = false;
    swap.hnsClaimMissing = false;
    swap.state = swap.dgbClaimed ? 'completed' : 'hns_claimed';
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);
    await this.publishStatus(swap, 'hns_claimed', 'hns', txid).catch((err) => {
      console.warn('[Swap] Failed to publish HNS claim status:', err);
    });
    return txid;
  }

  async refundHnsHtlc(swapId: string): Promise<string> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) throw new Error('Swap not found.');
    if (swap.role !== 'initiator') throw new Error('Only the HNS side can refund the HNS HTLC.');
    if (!swap.terms) throw new Error('Swap terms are missing.');
    if (swap.hnsClaimed || swap.hnsRefunded) throw new Error('The HNS HTLC is already spent.');
    if (!swap.hnsHtlcTxid || !swap.terms) throw new Error('The HNS HTLC is not funded.');

    const currentHeight = await this.getHnsHeight();
    if (currentHeight < swap.terms.hnsTimeout) {
      throw new Error(
        `The HNS refund is locked until block ${swap.terms.hnsTimeout}. Current height: ${currentHeight}.`,
      );
    }

    const status = await this.getHnsFundingStatus(swap);
    if (!status) throw new Error('HNS HTLC funding has not been detected.');
    if (status.value !== swap.terms.hnsAmount) {
      throw new Error('The HNS HTLC amount does not match the agreed amount.');
    }

    const hnsKeys = this.getHnsSwapKeys();
    if (this._publicKey !== swap.terms.initiatorPubkey) {
      throw new Error('The local Nostr key does not match the swap terms.');
    }
    const toAddress = await this.getHnsAddress();
    const { txHex } = buildHnsRefundTx({
      utxo: {
        txHash: swap.hnsHtlcTxid,
        vout: status.vout,
        value: status.value,
      },
      redeemScript: Buffer.from(swap.terms.hnsHtlcScript, 'hex'),
      privateKey: hnsKeys.secret,
      toAddress,
      fee: HNS_HTLC_FEE,
      locktime: swap.terms.hnsTimeout,
      network: this.getHnsNetwork(),
    });
    const txid = await this.walletService.broadcastTx(txHex);

    swap.hnsRefunded = true;
    swap.hnsRefundTxid = txid;
    swap.state = 'refunded';
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);
    await this.publishStatus(swap, 'refunded', 'hns', txid);
    return txid;
  }

  async refundDgbHtlc(swapId: string): Promise<string> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) throw new Error('Swap not found.');
    if (swap.role !== 'counterparty') throw new Error('Only the DGB side can refund the DGB HTLC.');
    if (!swap.terms) throw new Error('Swap terms are missing.');
    if (swap.dgbClaimed || swap.dgbRefunded) throw new Error('The DGB HTLC is already spent.');
    if (!swap.dgbHtlcTxid) throw new Error('The DGB HTLC is not funded.');

    const currentHeight = await this.getDgbHeight();
    if (currentHeight < swap.terms.dgbTimeout) {
      throw new Error(
        `The DGB refund is locked until block ${swap.terms.dgbTimeout}. Current height: ${currentHeight}.`,
      );
    }

    const status = await this.getDgbFundingStatus(swap);
    if (!status) throw new Error('DGB HTLC funding has not been detected.');
    if (status.value !== swap.terms.dgbAmount) {
      throw new Error('The DGB HTLC amount does not match the agreed amount.');
    }

    const dgb = this.getDgbKeys();
    if (dgb.publicKey.toString('hex') !== swap.terms.counterpartyDgbPubKey) {
      throw new Error('The local DGB key does not match the swap terms.');
    }
    const fee = await this.dgbSpendFee();
    const { txHex, txId } = buildDgbRefundTx({
      utxo: {
        txHash: swap.dgbHtlcTxid,
        vout: status.vout,
        value: status.value,
      },
      redeemScript: Buffer.from(swap.terms.dgbHtlcScript, 'hex'),
      privateKey: dgb.privateKey,
      toAddress: dgb.address,
      fee,
      locktime: swap.terms.dgbTimeout,
      network: dgb.network,
    });
    const broadcastId = await this.electrumService.broadcastTransaction(txHex);

    swap.dgbRefunded = true;
    swap.dgbRefundTxid = broadcastId || txId;
    swap.state = 'refunded';
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);
    await this.publishStatus(swap, 'refunded', 'dgb', swap.dgbRefundTxid);
    return swap.dgbRefundTxid;
  }

  private async publishStatus(
    swap: LocalSwap,
    status: SwapStatusMessage['status'],
    chain: 'hns' | 'dgb',
    txid?: string,
  ): Promise<void> {
    if (!swap.terms) return;
    const message: SwapStatusMessage = {
      offerId: swap.offer.id,
      status,
      chain,
      txid,
      createdAt: nowSeconds(),
    };
    await this.publishSwapEvent(
      SWAP_STATUS_KIND,
      swap.offer.id,
      message,
      [swap.terms.initiatorPubkey, swap.terms.counterpartyPubkey],
    );
  }

  /**
   * Publish the revealed secret at most once. The DGB claim is already on
   * chain, so a relay failure must not make the claim look failed locally.
   * The monitor retries this until the event is published.
   */
  private async publishSecret(swap: LocalSwap): Promise<boolean> {
    if (!swap.terms || !swap.secretHex || !swap.dgbClaimTxid) return false;
    if (swap.secretPublished) return true;

    const reveal: SwapSecretReveal = {
      offerId: swap.offer.id,
      secret: swap.secretHex,
      dgbClaimTxid: swap.dgbClaimTxid,
      createdAt: nowSeconds(),
    };
    try {
      await this.publishSwapEvent(
        SWAP_SECRET_KIND,
        swap.offer.id,
        reveal,
        [swap.terms.initiatorPubkey, swap.terms.counterpartyPubkey],
      );
      await this.publishStatus(swap, 'dgb_claimed', 'dgb', swap.dgbClaimTxid);
      swap.secretPublished = true;
      swap.updatedAt = Date.now();
      this.persistSwap(swap);
      return true;
    } catch (err) {
      console.warn('[Swap] Secret publish failed; will retry:', err);
      return false;
    }
  }

  /**
   * Recover the HTLC secret from the DGB claim transaction. The claim's
   * scriptSig contains the secret in clear, so this works even if every relay
   * loses the secret-reveal event.
   */
  private async recoverDgbSecret(swap: LocalSwap): Promise<string | null> {
    if (!swap.terms || !swap.dgbHtlcTxid) return null;
    const fundingVout = swap.dgbHtlcVout ?? 0;
    const history = await this.electrumService.getHistory(swap.terms.dgbHtlcAddress);

    for (const entry of history) {
      if (entry.txHash === swap.dgbHtlcTxid) continue;
      const raw = await this.electrumService.getRawTransaction(entry.txHash);
      if (!raw) continue;

      let tx: bitcoin.Transaction;
      try {
        tx = bitcoin.Transaction.fromHex(raw);
      } catch {
        continue;
      }

      for (const input of tx.ins) {
        const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
        if (inputTxid !== swap.dgbHtlcTxid || input.index !== fundingVout) continue;

        const chunks = bitcoin.script.decompile(input.script);
        if (!chunks || chunks.length !== 4) continue;
        const candidate = chunks[1];
        if (!(candidate instanceof Uint8Array) || candidate.length !== 32) continue;

        const candidateHex = Buffer.from(candidate).toString('hex');
        if (secretMatchesHash(candidateHex, swap.terms.secretHash)) {
          return candidateHex;
        }
      }
    }
    return null;
  }

  // ============================================================
  // Auto-complete
  // ============================================================

  private isAutoCompleteEnabled(): boolean {
    return this.dbService.getSetting('swapAutoComplete') === '1';
  }

  /**
   * Advance one local step when auto-complete is enabled and the next action
   * is actually ready. The existing confirmation thresholds and validation
   * still apply; this only removes the manual button press.
   */
  private async maybeAutoAdvance(swap: LocalSwap): Promise<void> {
    if (swap.hnsClaimed && swap.dgbClaimed) {
      if (swap.state !== 'completed') {
        swap.state = 'completed';
        swap.updatedAt = Date.now();
        this.persistSwap(swap);
        this.notifySwapUpdate(swap);
      }
      return;
    }

    if (!swap.autoComplete || !this.isAutoCompleteEnabled()) return;

    if (['completed', 'failed', 'refunded', 'refunding'].includes(swap.state)) return;

    const lockKey = `auto:${swap.id}`;
    if (this._autoActionLocks.has(lockKey)) return;
    this._autoActionLocks.add(lockKey);
    try {
      if (swap.role === 'initiator') {
        if (!swap.hnsHtlcTxid
          && ['accepted', 'terms_ready', 'hns_funding'].includes(swap.state)) {
          // An encrypted wallet must be unlocked before the HNS HTLC can be
          // funded. The UI shows the passphrase prompt and resumes auto mode
          // after the user unlocks it.
          if (!await this.walletService.isUnlocked()) return;
          await this.executeSwapAsInitiator(swap.id, '');
          return;
        }

        if (swap.dgbHtlcTxid && !swap.dgbClaimed) {
          if (!this.electrumService.isConnected()) return;
          const status = await this.getDgbFundingStatus(swap);
          if (status && status.confirmations >= DGB_CONFIRMATIONS_REQUIRED) {
            await this.claimFromDgbHtlc(swap.id);
          }
        }
        return;
      }

      // Counterparty / DGB side.
      if (!swap.dgbHtlcTxid) {
        const status = await this.getHnsFundingStatus(swap);
        if (status && status.confirmations >= HNS_CONFIRMATIONS_REQUIRED) {
          if (!this.electrumService.isConnected()) return;
          await this.fundDgbHtlc(swap.id);
        }
        return;
      }

      if (swap.secretHex && !swap.hnsClaimed) {
        const status = await this.getHnsFundingStatus(swap);
        if (status && status.confirmations >= HNS_CONFIRMATIONS_REQUIRED) {
          await this.claimFromHnsHtlc(swap.id);
        }
      }
    } catch (err) {
      console.warn(`[Swap] Auto-complete step failed for ${swap.id}:`, err);
    } finally {
      this._autoActionLocks.delete(lockKey);
    }
  }

  async setSwapAutoComplete(swapId: string, enabled: boolean): Promise<void> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) throw new Error('Swap not found.');
    if (['completed', 'failed', 'refunded', 'refunding'].includes(swap.state)) {
      throw new Error('This swap is already finished.');
    }
    swap.autoComplete = enabled;
    swap.updatedAt = Date.now();
    this.persistSwap(swap);
    this.notifySwapUpdate(swap);
    if (enabled) await this.maybeAutoAdvance(swap);
  }

  // ============================================================
  // Monitoring
  // ============================================================

  async startMonitor(): Promise<void> {
    this.stopMonitor();
    this._monitorInterval = setInterval(() => {
      void this.pollAll();
    }, 10000);
    await this.pollAll();
  }

  stopMonitor(): void {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
  }

  private async pollAll(): Promise<void> {
    if (this._pollInFlight) return;
    this._pollInFlight = true;
    try {
      await this.pollSwapEvents();
      await this.pollChainStates();
    } catch (err) {
      console.warn('[Swap] Poll failed:', err);
    } finally {
      this._pollInFlight = false;
    }
  }

  private async pollSwapEvents(): Promise<void> {
    const swaps = Array.from(this.activeSwaps.values())
      .filter(swap => swap.state !== 'completed' && swap.state !== 'failed');
    if (swaps.length === 0) return;

    const events = await this.fetchSwapEvents([
      SWAP_ACCEPT_KIND,
      SWAP_TERMS_KIND,
      SWAP_FUNDING_KIND,
      SWAP_SECRET_KIND,
      SWAP_STATUS_KIND,
    ]);

    for (const event of events) {
      try {
        if (event.kind === SWAP_ACCEPT_KIND) {
          const accept = JSON.parse(event.content) as SwapAccept;
          const swap = this.findSwapByOfferId(accept.offerId);
          if (!swap || swap.state !== 'offered') continue;
          if (event.pubkey !== accept.nostrPubkey || !isXOnlyPubkey(accept.nostrPubkey)) continue;
          if (!isCompressedPubkey(accept.dgbPubKey || '')) continue;
          if (accept.nostrPubkey === swap.offer.nostrPubkey) continue;

          const isHnsSide = swap.offer.direction === 'hnsToDgb';
          swap.state = 'accepted';
          swap.autoComplete = this.isAutoCompleteEnabled();
          swap.role = isHnsSide ? 'initiator' : 'counterparty';
          swap.counterpartyPubkey = accept.nostrPubkey;
          swap.initiatorDgbPubKey = isHnsSide ? swap.offer.dgbPubKey : accept.dgbPubKey;
          swap.counterpartyDgbPubKey = isHnsSide ? accept.dgbPubKey : swap.offer.dgbPubKey;
          swap.counterpartyDgbAddress = accept.dgbAddress;
          swap.offer = { ...swap.offer, status: 'accepted' };
          swap.updatedAt = Date.now();
          this.persistSwap(swap);
          this.dbService.saveMySwapOffer(swap.offer);
          await this.publishEvent(SWAP_OFFER_KIND, JSON.stringify(swap.offer), [
            ['d', swap.offer.id],
            ['t', SWAP_TAG],
            ['p', this._publicKey],
          ]).catch(() => {});
          this.notifySwapUpdate(swap);
          await this.maybeAutoAdvance(swap);
          continue;
        }

        if (event.kind === SWAP_TERMS_KIND) {
          const terms = JSON.parse(event.content) as SwapTerms;
          const swap = this.findSwapByOfferId(terms.offerId);
          if (!swap || swap.role !== 'counterparty' || swap.terms) continue;
          if (event.pubkey !== swap.counterpartyPubkey) continue;
          await this.validateTerms(swap, terms);
          this.applyTerms(swap, terms);
          await this.maybeAutoAdvance(swap);
          continue;
        }

        if (event.kind === SWAP_FUNDING_KIND) {
          const funding = JSON.parse(event.content) as SwapFunding;
          if (!funding || (funding.chain !== 'hns' && funding.chain !== 'dgb')) continue;
          const swap = this.findSwapByOfferId(funding.offerId);
          if (!swap || !swap.terms) continue;

          if (funding.chain === 'hns') {
            if (event.pubkey !== swap.terms.initiatorPubkey) continue;
            if (swap.hnsHtlcTxid) continue;
            if (!isXOnlyPubkey(funding.txid) || funding.address !== swap.terms.hnsHtlcAddress) continue;
            const status = await this.getHnsFundingStatus({
              ...swap,
              hnsHtlcTxid: funding.txid,
            });
            if (!status) continue;
            if (status.value !== swap.terms.hnsAmount) continue;
            swap.hnsHtlcTxid = funding.txid;
            swap.hnsHtlcVout = status.vout;
            swap.hnsHtlcValue = status.value;
            swap.hnsConfirmations = status.confirmations;
            swap.state = status.confirmations >= HNS_CONFIRMATIONS_REQUIRED
              ? 'hns_htlc_funded'
              : 'hns_funding';
            swap.updatedAt = Date.now();
            this.persistSwap(swap);
            this.notifySwapUpdate(swap);
            await this.maybeAutoAdvance(swap);
          } else {
            if (event.pubkey !== swap.terms.counterpartyPubkey) continue;
            if (swap.dgbHtlcTxid) continue;
            if (!isXOnlyPubkey(funding.txid) || funding.address !== swap.terms.dgbHtlcAddress) continue;
            const status = await this.getDgbFundingStatus({
              ...swap,
              dgbHtlcTxid: funding.txid,
            });
            if (!status) continue;
            if (status.value !== swap.terms.dgbAmount) continue;
            swap.dgbHtlcTxid = funding.txid;
            swap.dgbHtlcVout = status.vout;
            swap.dgbHtlcValue = status.value;
            swap.dgbConfirmations = status.confirmations;
            swap.state = status.confirmations >= DGB_CONFIRMATIONS_REQUIRED
              ? 'dgb_htlc_funded'
              : 'dgb_funding';
            swap.updatedAt = Date.now();
            this.persistSwap(swap);
            this.notifySwapUpdate(swap);
            await this.maybeAutoAdvance(swap);
          }
          continue;
        }

        if (event.kind === SWAP_SECRET_KIND) {
          const reveal = JSON.parse(event.content) as SwapSecretReveal;
          const swap = this.findSwapByOfferId(reveal.offerId);
          if (!swap || swap.role !== 'counterparty' || !swap.terms) continue;
          if (event.pubkey !== swap.terms.initiatorPubkey) continue;
          if (!secretMatchesHash(reveal.secret, swap.terms.secretHash)) continue;
          if (swap.secretHex && swap.secretHex !== reveal.secret) continue;
          swap.secretHex = reveal.secret;
          swap.dgbClaimed = true;
          swap.dgbClaimTxid = reveal.dgbClaimTxid;
          swap.state = swap.hnsClaimed ? 'completed' : 'secret_revealed';
          swap.updatedAt = Date.now();
          this.persistSwap(swap);
          this.notifySwapUpdate(swap);
          await this.maybeAutoAdvance(swap);
          continue;
        }

        if (event.kind === SWAP_STATUS_KIND) {
          const message = JSON.parse(event.content) as SwapStatusMessage;
          const swap = this.findSwapByOfferId(message.offerId);
          if (!swap || !swap.terms) continue;
          if (event.pubkey !== swap.terms.initiatorPubkey
            && event.pubkey !== swap.terms.counterpartyPubkey) continue;

          if (message.status === 'dgb_claimed') {
            swap.dgbClaimed = true;
            swap.dgbClaimTxid = message.txid || swap.dgbClaimTxid;
            if (swap.hnsClaimed) swap.state = 'completed';
            else if (swap.role === 'counterparty') swap.state = 'secret_revealed';
            else swap.state = 'dgb_claimed';
          } else if (message.status === 'hns_claimed') {
            swap.hnsClaimed = true;
            swap.hnsClaimTxid = message.txid || swap.hnsClaimTxid;
            swap.state = swap.dgbClaimed ? 'completed' : 'hns_claimed';
          } else if (message.status === 'completed') {
            if (swap.hnsClaimed && swap.dgbClaimed) swap.state = 'completed';
          } else if (message.status === 'refunded') {
            if (message.chain === 'hns') swap.hnsRefunded = true;
            else swap.dgbRefunded = true;
            swap.state = swap.hnsRefunded && swap.dgbRefunded ? 'refunded' : 'refunding';
          }
          swap.updatedAt = Date.now();
          this.persistSwap(swap);
          this.notifySwapUpdate(swap);
          await this.maybeAutoAdvance(swap);
        }
      } catch (err) {
        console.warn('[Swap] Ignored invalid swap event:', err);
      }
    }
  }

  /**
   * Refresh the HNS claim transaction's on-chain state and destination.
   * Runs even after a swap is marked completed so a dropped claim can be
   * detected and rebroadcast.
   */
  private async refreshHnsClaimStatus(swap: LocalSwap): Promise<boolean> {
    if (!swap.hnsClaimTxid) return false;
    let changed = false;
    try {
      const tx = await this.walletService.getTransaction(swap.hnsClaimTxid);
      if (tx && Array.isArray(tx.outputs)) {
        const outputs = tx.outputs as Array<{ address?: string; value?: number }>;
        const target = swap.hnsClaimAddress
          ? normalizeHnsAddress(swap.hnsClaimAddress)
          : '';
        const match = target
          ? outputs.find(o => normalizeHnsAddress(String(o.address || '')) === target)
          : outputs.find(o => normalizeHnsAddress(String(o.address || '')) !== '');
        if (match) {
          const address = normalizeHnsAddress(String(match.address || ''));
          if (address && address !== swap.hnsClaimAddress) {
            swap.hnsClaimAddress = address;
            changed = true;
          }
          const value = Number(match.value);
          if (Number.isFinite(value) && value > 0 && value !== swap.hnsClaimValue) {
            swap.hnsClaimValue = value;
            changed = true;
          }
        }
        const confirmed = Number(tx.height ?? 0) > 0
          || Number(tx.confirmations ?? 0) > 0;
        if (swap.hnsClaimConfirmed !== confirmed) {
          swap.hnsClaimConfirmed = confirmed;
          changed = true;
        }
        if (swap.hnsClaimMissing) {
          swap.hnsClaimMissing = false;
          changed = true;
        }
      } else if (swap.hnsClaimed && !swap.hnsClaimConfirmed) {
        const started = swap.hnsClaimBroadcastAt || swap.updatedAt;
        if (Date.now() - started > 120_000 && !swap.hnsClaimMissing) {
          swap.hnsClaimMissing = true;
          changed = true;
        }
      }
    } catch {
      // Leave the last known state; the next poll retries.
    }
    return changed;
  }

  private async pollChainStates(): Promise<void> {
    for (const swap of this.activeSwaps.values()) {
      try {
        if (!swap.terms) continue;

        // Verify/refresh the HNS claim even for completed swaps. This detects
        // a claim transaction that was dropped from the mempool before mining.
        const claimChanged = await this.refreshHnsClaimStatus(swap);
        if (swap.state === 'completed'
          || swap.state === 'failed'
          || swap.state === 'refunded') {
          if (claimChanged) {
            swap.updatedAt = Date.now();
            this.persistSwap(swap);
            this.notifySwapUpdate(swap);
          }
          continue;
        }

        let changed = claimChanged;

      // Recover funding details from the chains if the relay event was lost.
      if (!swap.hnsHtlcTxid) {
        try {
          const txs = await this.walletService.getTransactionsByAddress(
            swap.terms.hnsHtlcAddress,
            20,
          );
          for (const tx of txs) {
            const hash = String(tx.hash || tx.txid || '');
            if (!/^[0-9a-f]{64}$/.test(hash)) continue;
            const outputs = Array.isArray(tx.outputs)
              ? tx.outputs as Array<{ value: number; address?: string }>
              : [];
            const vout = outputs.findIndex(
              output => normalizeHnsAddress(String(output.address || '')) === swap.terms!.hnsHtlcAddress,
            );
            if (vout < 0) continue;
            swap.hnsHtlcTxid = hash;
            swap.hnsHtlcVout = vout;
            swap.hnsHtlcValue = Number(outputs[vout].value);
            changed = true;
            break;
          }
        } catch { /* address index unavailable */ }
      }

      if (!swap.dgbHtlcTxid) {
        try {
          const utxos = await this.electrumService.listUnspent(swap.terms.dgbHtlcAddress);
          const utxo = utxos.find(item => item.value === swap.terms!.dgbAmount);
          if (utxo) {
            swap.dgbHtlcTxid = utxo.txHash;
            swap.dgbHtlcVout = utxo.vout;
            swap.dgbHtlcValue = utxo.value;
            changed = true;
          }
        } catch { /* DGB not connected */ }
      }

      if (swap.hnsHtlcTxid && !swap.hnsClaimed && !swap.hnsRefunded) {
        const status = await this.getHnsFundingStatus(swap);
        if (status) {
          if (swap.hnsConfirmations !== status.confirmations) {
            swap.hnsConfirmations = status.confirmations;
            changed = true;
          }
          if (swap.hnsHtlcVout !== status.vout) {
            swap.hnsHtlcVout = status.vout;
            changed = true;
          }
          if (swap.hnsHtlcValue !== status.value) {
            swap.hnsHtlcValue = status.value;
            changed = true;
          }
          if (status.confirmations >= HNS_CONFIRMATIONS_REQUIRED
            && (swap.state === 'terms_ready' || swap.state === 'hns_funding')) {
            swap.state = 'hns_htlc_funded';
            changed = true;
          }
        }
      }

      if (swap.dgbHtlcTxid && !swap.dgbClaimed && !swap.dgbRefunded) {
        const status = await this.getDgbFundingStatus(swap);
        if (status) {
          if (swap.dgbConfirmations !== status.confirmations) {
            swap.dgbConfirmations = status.confirmations;
            changed = true;
          }
          if (swap.dgbHtlcVout !== status.vout) {
            swap.dgbHtlcVout = status.vout;
            changed = true;
          }
          if (swap.dgbHtlcValue !== status.value) {
            swap.dgbHtlcValue = status.value;
            changed = true;
          }
          if (status.confirmations >= DGB_CONFIRMATIONS_REQUIRED
            && (swap.state === 'hns_htlc_funded' || swap.state === 'dgb_funding')) {
            swap.state = 'dgb_htlc_funded';
            changed = true;
          }
        }
      }

      // Sellers retry publishing the secret if the relay event was lost.
      if (swap.role === 'initiator'
        && swap.dgbClaimed
        && swap.secretHex
        && swap.dgbClaimTxid
        && !swap.secretPublished) {
        await this.publishSecret(swap);
      }

      // Buyers can recover the secret directly from the DGB claim transaction.
      if (swap.role === 'counterparty'
        && swap.dgbHtlcTxid
        && !swap.secretHex) {
        const secret = await this.recoverDgbSecret(swap);
        if (secret) {
          swap.secretHex = secret;
          swap.dgbClaimed = true;
          swap.state = swap.hnsClaimed ? 'completed' : 'secret_revealed';
          changed = true;
        }
      }

        if (changed) {
          swap.updatedAt = Date.now();
          this.persistSwap(swap);
          this.notifySwapUpdate(swap);
        }

        await this.maybeAutoAdvance(swap);
      } catch (err) {
        console.warn(`[Swap] Chain poll failed for ${swap.id}:`, err);
      }
    }
  }

  // ============================================================
  // Read APIs
  // ============================================================

  async getMySwaps(): Promise<LocalSwap[]> {
    return Array.from(this.activeSwaps.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getSwapById(swapId: string): Promise<LocalSwap | null> {
    return this.activeSwaps.get(swapId) || null;
  }

  async getMySwapOffers(): Promise<SwapOffer[]> {
    return this.dbService.getMySwapOffers();
  }
}
