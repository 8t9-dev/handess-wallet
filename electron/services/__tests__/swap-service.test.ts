import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { bech32 } from 'bech32';
import * as bitcoin from 'bitcoinjs-lib';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { SwapService } from '../swap-service';
import type { DBService } from '../db-service';
import type { ElectrumDgbService } from '../electrum-dgb-service';
import type { WalletService } from '../wallet-service';
import type { LocalSwap, SwapOffer, SwapTerms } from '../../../src/types/swap';
import { HNS_HTLC_FEE } from '../htlc-hns-service';
import { buildDgbClaimTx, buildHtlcRedeemScript } from '../htlc-service';
import { DGB_MAINNET, toBitcoinJsNetwork } from '../../dgb-networks';

const initiatorSecret = generateSecretKey();
const initiatorPub = getPublicKey(initiatorSecret);
const counterpartySecret = generateSecretKey();
const counterpartyPub = getPublicKey(counterpartySecret);
const dgbSeed = Buffer.alloc(32, 3);
const dgbPub = Buffer.from(secp256k1.getPublicKey(dgbSeed, true)).toString('hex');
const counterpartyDgbSeed = Buffer.alloc(32, 4);
const counterpartyDgbPub = Buffer.from(
  secp256k1.getPublicKey(counterpartyDgbSeed, true),
).toString('hex');

function hnsAddress(seed: number): string {
  const program = Buffer.alloc(20, seed);
  return bech32.encode('hs', [0, ...bech32.toWords(program)]);
}

function dgbAddressFor(seed: Buffer): string {
  return bitcoin.payments.p2pkh({
    pubkey: Buffer.from(secp256k1.getPublicKey(seed, true)),
    network: toBitcoinJsNetwork(DGB_MAINNET),
  }).address!;
}

function makeSwap(): LocalSwap {
  return {
    id: 'offer-1',
    offer: {
      id: 'offer-1',
      nostrPubkey: initiatorPub,
      direction: 'hnsToDgb',
      hnsAmount: 1,
      dgbAmount: 100,
      exchangeRate: 100,
      dgbAddress: '',
      dgbPubKey: dgbPub,
      createdAt: 1,
      expiresAt: null,
      status: 'accepted',
    },
    state: 'accepted',
    role: 'initiator',
    counterpartyPubkey: counterpartyPub,
    counterpartyDgbPubKey: counterpartyDgbPub,
    initiatorDgbPubKey: dgbPub,
    hnsTimeout: 0,
    dgbTimeout: 0,
    transactions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeService(local?: {
  nostrSecret?: Uint8Array;
  dgbSeed?: Buffer;
  autoComplete?: boolean;
  walletUnlocked?: boolean;
}): SwapService {
  const localNostrSecret = local?.nostrSecret ?? initiatorSecret;
  const localDgbSeed = local?.dgbSeed ?? dgbSeed;
  const autoComplete = local?.autoComplete ?? false;
  const walletUnlocked = local?.walletUnlocked ?? true;
  const saved: LocalSwap[] = [];
  const db = {
    getNostrPrivateKey: () => Buffer.from(localNostrSecret).toString('hex'),
    getNostrRelays: () => [],
    getActiveSwaps: () => [],
    saveSwap: (swap: LocalSwap) => {
      const index = saved.findIndex(item => item.id === swap.id);
      if (index >= 0) saved[index] = swap;
      else saved.push(swap);
    },
    getMySwapOffers: () => [],
    saveMySwapOffer: () => {},
    getSetting: (key: string) => (
      key === 'swapAutoComplete' && autoComplete ? '1' : null
    ),
    getDgbSeed: () => localDgbSeed.toString('hex'),
    getDgbServerConfig: () => ({ host: '127.0.0.1', port: 0, ssl: false, network: 'mainnet' }),
    getSavedConnectionConfig: () => ({
      host: '127.0.0.1',
      nodePort: 12037,
      walletPort: 12039,
      apiKey: '',
      network: 'main',
      walletId: 'primary',
      ssl: false,
    }),
  } as unknown as DBService;

  const electrum = {
    isConnected: () => true,
    getServerInfo: () => ({ host: '127.0.0.1', port: 0, ssl: false, network: 'mainnet' }),
    getCurrentBlockHeight: async () => 2_000,
    estimateFee: async () => 0.00001,
    getBalance: async () => ({ confirmed: 1_000_000_000_000, unconfirmed: 0 }),
    getHistory: async () => [],
    getRawTransaction: async () => null,
    getTransaction: async () => null,
    listUnspent: async () => [],
  } as unknown as ElectrumDgbService;

  const wallet = {
    getBlockHeight: async () => 1_000,
    isUnlocked: async () => walletUnlocked,
    getAddress: async () => ({ address: hnsAddress(9) }),
    getBalance: async () => ({
      confirmed: 1_000_000_000,
      unconfirmed: 0,
      lockedConfirmed: 0,
      lockedUnconfirmed: 0,
      spendable: 1_000_000_000,
    }),
  } as unknown as WalletService;

  return new SwapService(db, electrum, wallet);
}

describe('SwapService HNS ↔ DGB terms and roles', () => {
  it('creates deterministic HNS and DGB HTLC terms and validates them', async () => {
    const service = makeService();
    const swap = { ...makeSwap(), id: 'local-initiator-id' };
    const createTerms = (service as unknown as {
      createTerms: (swap: LocalSwap) => Promise<SwapTerms>;
    }).createTerms.bind(service);
    const validateTerms = (service as unknown as {
      validateTerms: (swap: LocalSwap, terms: SwapTerms) => Promise<void>;
    }).validateTerms.bind(service);

    const terms = await createTerms(swap);

    expect(terms.offerId).toBe(swap.offer.id);
    expect(terms.initiatorPubkey).toBe(initiatorPub);
    expect(terms.counterpartyPubkey).toBe(counterpartyPub);
    expect(terms.initiatorDgbPubKey).toBe(dgbPub);
    expect(terms.counterpartyDgbPubKey).toBe(counterpartyDgbPub);
    expect(terms.hnsAmount).toBe(1_000_000);
    expect(terms.dgbAmount).toBe(10_000_000_000);
    expect(terms.hnsAmount).toBeGreaterThan(HNS_HTLC_FEE);
    expect(terms.hnsTimeout).toBe(1_000 + 288);
    expect(terms.dgbTimeout).toBe(2_000 + 1_440);
    expect(terms.hnsHtlcAddress.startsWith('hs1')).toBe(true);
    expect(bitcoin.address.fromBase58Check(terms.dgbHtlcAddress).version)
      .toBe(DGB_MAINNET.scriptHash);
    expect(terms.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(swap.secretHex).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(Buffer.from(swap.secretHex!, 'hex')).digest('hex'))
      .toBe(terms.secretHash);

    await expect(validateTerms(swap, terms)).resolves.toBeUndefined();

    const counterpartyService = makeService({
      nostrSecret: counterpartySecret,
      dgbSeed: counterpartyDgbSeed,
    });
    const counterpartyValidate = (counterpartyService as unknown as {
      validateTerms: (swap: LocalSwap, terms: SwapTerms) => Promise<void>;
    }).validateTerms.bind(counterpartyService);
    const counterpartySwap: LocalSwap = {
      ...swap,
      role: 'counterparty',
      counterpartyPubkey: initiatorPub,
      initiatorDgbPubKey: dgbPub,
      counterpartyDgbPubKey: counterpartyDgbPub,
    };
    await expect(counterpartyValidate(counterpartySwap, terms)).resolves.toBeUndefined();
  });

  it('applies counterparty terms keyed by the shared offer id', async () => {
    const acceptor = makeService({
      nostrSecret: counterpartySecret,
      dgbSeed: counterpartyDgbSeed,
    });
    const acceptorInternal = acceptor as unknown as {
      publishSwapEvent: (
        kind: number,
        offerId: string,
        content: unknown,
        participants: string[],
      ) => Promise<void>;
      fetchSwapEvents: (kinds: number[]) => Promise<Array<{
        id: string;
        kind: number;
        pubkey: string;
        createdAt: number;
        content: string;
        tags: string[][];
      }>>;
      pollSwapEvents: () => Promise<void>;
    };
    acceptorInternal.publishSwapEvent = async () => {};

    const offer: SwapOffer = {
      id: 'hns-offer-shared',
      nostrPubkey: initiatorPub,
      direction: 'hnsToDgb',
      hnsAmount: 1,
      dgbAmount: 100,
      exchangeRate: 100,
      dgbAddress: dgbAddressFor(dgbSeed),
      dgbPubKey: dgbPub,
      createdAt: 1,
      expiresAt: null,
      status: 'active',
    };
    const acceptorSwap = await acceptor.acceptOffer(offer);

    // The acceptor's local id is generated; only its embedded offer id is shared.
    expect(acceptorSwap.id).not.toBe(offer.id);
    expect(acceptorSwap.offer.id).toBe(offer.id);

    const initiator = makeService();
    (initiator as unknown as {
      publishSwapEvent: (
        kind: number,
        offerId: string,
        content: unknown,
        participants: string[],
      ) => Promise<void>;
    }).publishSwapEvent = async () => {};
    const initiatorSwap: LocalSwap = {
      ...makeSwap(),
      id: offer.id,
      offer: { ...offer, status: 'accepted' },
      state: 'accepted',
      role: 'initiator',
      counterpartyPubkey: counterpartyPub,
      initiatorDgbPubKey: dgbPub,
      counterpartyDgbPubKey: counterpartyDgbPub,
    };
    const createTerms = (initiator as unknown as {
      createTerms: (swap: LocalSwap) => Promise<SwapTerms>;
    }).createTerms.bind(initiator);
    const terms = await createTerms(initiatorSwap);

    acceptorInternal.fetchSwapEvents = async () => [{
      id: 'terms-event',
      kind: 38387,
      pubkey: initiatorPub,
      createdAt: 2,
      content: JSON.stringify(terms),
      tags: [],
    }];
    await acceptorInternal.pollSwapEvents();

    const updated = await acceptor.getSwapById(acceptorSwap.id);
    expect(updated?.terms?.offerId).toBe(offer.id);
    expect(updated?.state).toBe('terms_ready');
  });

  it('recovers the secret from a DGB claim transaction when relays lose it', async () => {
    const service = makeService();
    const swap = makeSwap();
    const createTerms = (service as unknown as {
      createTerms: (swap: LocalSwap) => Promise<SwapTerms>;
    }).createTerms.bind(service);
    const terms = await createTerms(swap);
    const secretHex = swap.secretHex!;

    const dgbAddress = bitcoin.payments.p2pkh({
      pubkey: Buffer.from(secp256k1.getPublicKey(dgbSeed, true)),
      network: toBitcoinJsNetwork(DGB_MAINNET),
    }).address!;
    const fundingTxid = 'aa'.repeat(32);
    const claim = buildDgbClaimTx({
      utxo: { txHash: fundingTxid, vout: 0, value: terms.dgbAmount },
      redeemScript: Buffer.from(terms.dgbHtlcScript, 'hex'),
      secret: Buffer.from(secretHex, 'hex'),
      privateKey: dgbSeed,
      toAddress: dgbAddress,
      fee: 10_000,
      network: 'mainnet',
    });

    const electrum = (service as unknown as { electrumService: ElectrumDgbService })
      .electrumService as unknown as {
        getHistory: () => Promise<Array<{ txHash: string; height: number }>>;
        getRawTransaction: () => Promise<string>;
      };
    electrum.getHistory = async () => [{ txHash: claim.txId, height: 1 }];
    electrum.getRawTransaction = async () => claim.txHex;

    const buyerSwap: LocalSwap = {
      ...swap,
      role: 'counterparty',
      secretHex: undefined,
      dgbHtlcTxid: fundingTxid,
      dgbHtlcVout: 0,
      dgbHtlcValue: terms.dgbAmount,
      terms: { ...terms },
    };
    const recover = (service as unknown as {
      recoverDgbSecret: (swap: LocalSwap) => Promise<string | null>;
    }).recoverDgbSecret.bind(service);

    await expect(recover(buyerSwap)).resolves.toBe(secretHex);
  });

  it('accepts HNS → DGB offers as the DGB side', async () => {
    const service = makeService();
    const internal = service as unknown as {
      publishSwapEvent: (
        kind: number,
        offerId: string,
        content: unknown,
        participants: string[],
      ) => Promise<void>;
    };
    internal.publishSwapEvent = async () => {};

    const offer: SwapOffer = {
      id: 'hns-offer-1',
      nostrPubkey: counterpartyPub,
      direction: 'hnsToDgb',
      hnsAmount: 1,
      dgbAmount: 100,
      exchangeRate: 100,
      dgbAddress: dgbAddressFor(counterpartyDgbSeed),
      dgbPubKey: counterpartyDgbPub,
      createdAt: 1,
      expiresAt: null,
      status: 'active',
    };
    const swap = await service.acceptOffer(offer);

    expect(swap.role).toBe('counterparty');
    expect(swap.counterpartyPubkey).toBe(counterpartyPub);
    expect(swap.initiatorDgbPubKey).toBe(counterpartyDgbPub);
    expect(swap.counterpartyDgbPubKey).toBe(dgbPub);
  });

  it('publishes DGB → HNS offers as the DGB side', async () => {
    const service = makeService();
    const internal = service as unknown as {
      publishEvent: (kind: number, content: string, tags: string[][]) => Promise<void>;
    };
    internal.publishEvent = async () => {};

    const offer = await service.publishOffer({
      direction: 'dgbToHns',
      hnsAmount: 1,
      dgbAmount: 100,
      exchangeRate: 100,
      dgbAddress: '',
      expiresAt: null,
    });

    expect(offer.direction).toBe('dgbToHns');
    expect(offer.dgbPubKey).toBe(dgbPub);
    const local = await service.getSwapById(offer.id);
    expect(local?.role).toBe('counterparty');
    expect(local?.counterpartyDgbPubKey).toBe(dgbPub);
    expect(local?.initiatorDgbPubKey).toBeUndefined();
  });

  it('accepts DGB → HNS offers as the HNS side and creates matching terms', async () => {
    const service = makeService();
    const internal = service as unknown as {
      publishSwapEvent: (
        kind: number,
        offerId: string,
        content: unknown,
        participants: string[],
      ) => Promise<void>;
    };
    internal.publishSwapEvent = async () => {};

    const offer: SwapOffer = {
      id: 'dgb-offer-1',
      nostrPubkey: counterpartyPub,
      direction: 'dgbToHns',
      hnsAmount: 1,
      dgbAmount: 100,
      exchangeRate: 100,
      dgbAddress: dgbAddressFor(counterpartyDgbSeed),
      dgbPubKey: counterpartyDgbPub,
      createdAt: 1,
      expiresAt: null,
      status: 'active',
    };
    const swap = await service.acceptOffer(offer);

    expect(swap.role).toBe('initiator');
    expect(swap.counterpartyPubkey).toBe(counterpartyPub);
    expect(swap.initiatorDgbPubKey).toBe(dgbPub);
    expect(swap.counterpartyDgbPubKey).toBe(counterpartyDgbPub);

    const createTerms = (service as unknown as {
      createTerms: (swap: LocalSwap) => Promise<SwapTerms>;
    }).createTerms.bind(service);
    const validateTerms = (service as unknown as {
      validateTerms: (swap: LocalSwap, terms: SwapTerms) => Promise<void>;
    }).validateTerms.bind(service);
    const terms = await createTerms(swap);

    expect(terms.direction).toBe('dgbToHns');
    expect(terms.initiatorPubkey).toBe(initiatorPub);
    expect(terms.counterpartyPubkey).toBe(counterpartyPub);
    const expectedDgbScript = buildHtlcRedeemScript(
      Buffer.from(terms.secretHash, 'hex'),
      Buffer.from(dgbPub, 'hex'),
      Buffer.from(counterpartyDgbPub, 'hex'),
      terms.dgbTimeout,
    );
    expect(terms.dgbHtlcScript).toBe(expectedDgbScript.toString('hex'));

    await expect(validateTerms(swap, terms)).resolves.toBeUndefined();

    const offererService = makeService({
      nostrSecret: counterpartySecret,
      dgbSeed: counterpartyDgbSeed,
    });
    const offererValidate = (offererService as unknown as {
      validateTerms: (swap: LocalSwap, terms: SwapTerms) => Promise<void>;
    }).validateTerms.bind(offererService);
    const offererSwap: LocalSwap = {
      ...swap,
      role: 'counterparty',
      counterpartyPubkey: initiatorPub,
      initiatorDgbPubKey: dgbPub,
      counterpartyDgbPubKey: counterpartyDgbPub,
      offer: {
        ...swap.offer,
        nostrPubkey: counterpartyPub,
        dgbPubKey: counterpartyDgbPub,
      },
    };
    await expect(offererValidate(offererSwap, terms)).resolves.toBeUndefined();
  });

  it('rejects terms whose payout script was tampered with', async () => {
    const service = makeService();
    const swap = makeSwap();
    const createTerms = (service as unknown as {
      createTerms: (swap: LocalSwap) => Promise<SwapTerms>;
    }).createTerms.bind(service);
    const validateTerms = (service as unknown as {
      validateTerms: (swap: LocalSwap, terms: SwapTerms) => Promise<void>;
    }).validateTerms.bind(service);

    const terms = await createTerms(swap);
    const tampered: SwapTerms = {
      ...terms,
      hnsHtlcAddress: hnsAddress(8),
    };
    await expect(validateTerms(swap, tampered)).rejects.toThrow(/address|script/i);
  });

  it('detects a dropped HNS claim after it disappears from the node', async () => {
    const service = makeService();
    const internal = service as unknown as {
      walletService: {
        getTransaction: (hash: string) => Promise<Record<string, unknown> | null>;
      };
      refreshHnsClaimStatus: (swap: LocalSwap) => Promise<boolean>;
    };
    internal.walletService.getTransaction = async () => null;
    const swap: LocalSwap = {
      ...makeSwap(),
      role: 'counterparty',
      state: 'completed',
      hnsClaimTxid: 'claim-tx',
      hnsClaimed: true,
      hnsClaimBroadcastAt: Date.now() - 10 * 60_000,
      updatedAt: Date.now() - 10 * 60_000,
    };

    const changed = await internal.refreshHnsClaimStatus(swap);

    expect(changed).toBe(true);
    expect(swap.hnsClaimMissing).toBe(true);
  });

  it('never marks a confirmed HNS claim as missing', async () => {
    const service = makeService();
    const internal = service as unknown as {
      walletService: {
        getTransaction: (hash: string) => Promise<Record<string, unknown> | null>;
      };
      refreshHnsClaimStatus: (swap: LocalSwap) => Promise<boolean>;
    };
    internal.walletService.getTransaction = async () => null;
    const swap: LocalSwap = {
      ...makeSwap(),
      role: 'counterparty',
      state: 'completed',
      hnsClaimTxid: 'claim-tx',
      hnsClaimed: true,
      hnsClaimConfirmed: true,
      hnsClaimBroadcastAt: Date.now() - 10 * 60_000,
      updatedAt: Date.now() - 10 * 60_000,
    };

    const changed = await internal.refreshHnsClaimStatus(swap);

    expect(changed).toBe(false);
    expect(swap.hnsClaimMissing).toBeFalsy();
    expect(swap.hnsClaimConfirmed).toBe(true);
  });

  it('records the HNS claim destination and confirmation', async () => {
    const service = makeService();
    const claimAddress = hnsAddress(9);
    const internal = service as unknown as {
      walletService: {
        getTransaction: (hash: string) => Promise<Record<string, unknown> | null>;
      };
      refreshHnsClaimStatus: (swap: LocalSwap) => Promise<boolean>;
    };
    internal.walletService.getTransaction = async () => ({
      height: 355_000,
      confirmations: 2,
      outputs: [{ address: claimAddress, value: 3_868_830 }],
    });
    const swap: LocalSwap = {
      ...makeSwap(),
      role: 'counterparty',
      state: 'completed',
      hnsClaimTxid: 'claim-tx',
      hnsClaimed: true,
      hnsClaimAddress: claimAddress,
      hnsClaimBroadcastAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    };

    const changed = await internal.refreshHnsClaimStatus(swap);

    expect(changed).toBe(true);
    expect(swap.hnsClaimMissing).toBeFalsy();
    expect(swap.hnsClaimConfirmed).toBe(true);
    expect(swap.hnsClaimValue).toBe(3_868_830);
  });

  it('auto-funds HNS after acceptance when the wallet is unlocked', async () => {
    const service = makeService({ autoComplete: true });
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
      executeSwapAsInitiator: (swapId: string, passphrase: string) => Promise<void>;
    };
    let calls = 0;
    internal.executeSwapAsInitiator = async () => { calls += 1; };

    await internal.maybeAutoAdvance({ ...makeSwap(), autoComplete: true });

    expect(calls).toBe(1);
  });

  it('pauses auto HNS funding while the wallet is locked', async () => {
    const service = makeService({ autoComplete: true, walletUnlocked: false });
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
      executeSwapAsInitiator: (swapId: string, passphrase: string) => Promise<void>;
    };
    let calls = 0;
    internal.executeSwapAsInitiator = async () => { calls += 1; };

    await internal.maybeAutoAdvance({ ...makeSwap(), autoComplete: true });

    expect(calls).toBe(0);
  });

  it('does not auto-advance when the global toggle is off', async () => {
    const service = makeService();
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
      executeSwapAsInitiator: (swapId: string, passphrase: string) => Promise<void>;
    };
    let calls = 0;
    internal.executeSwapAsInitiator = async () => { calls += 1; };

    await internal.maybeAutoAdvance({ ...makeSwap(), autoComplete: true });

    expect(calls).toBe(0);
  });

  it('does not auto-advance a swap that was not opted in', async () => {
    const service = makeService({ autoComplete: true });
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
      executeSwapAsInitiator: (swapId: string, passphrase: string) => Promise<void>;
    };
    let calls = 0;
    internal.executeSwapAsInitiator = async () => { calls += 1; };

    await internal.maybeAutoAdvance(makeSwap());

    expect(calls).toBe(0);
  });

  it('enables auto-complete for one existing swap and starts it', async () => {
    const service = makeService({ autoComplete: true });
    const internal = service as unknown as {
      activeSwaps: Map<string, LocalSwap>;
      setSwapAutoComplete: (swapId: string, enabled: boolean) => Promise<void>;
      executeSwapAsInitiator: (swapId: string, passphrase: string) => Promise<void>;
    };
    const swap = { ...makeSwap(), autoComplete: false };
    internal.activeSwaps.set(swap.id, swap);
    let calls = 0;
    internal.executeSwapAsInitiator = async () => { calls += 1; };

    await internal.setSwapAutoComplete(swap.id, true);

    expect(swap.autoComplete).toBe(true);
    expect(calls).toBe(1);
  });

  it('auto-funds DGB once the HNS HTLC has enough confirmations', async () => {
    const service = makeService({ autoComplete: true });
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
      getHnsFundingStatus: (swap: LocalSwap) => Promise<{
        vout: number;
        value: number;
        confirmations: number;
      }>;
      fundDgbHtlc: (swapId: string) => Promise<void>;
    };
    let calls = 0;
    internal.getHnsFundingStatus = async () => ({
      vout: 0,
      value: 1_000_000,
      confirmations: 2,
    });
    internal.fundDgbHtlc = async () => { calls += 1; };

    await internal.maybeAutoAdvance({
      ...makeSwap(),
      autoComplete: true,
      role: 'counterparty',
      state: 'hns_htlc_funded',
    });

    expect(calls).toBe(1);
  });

  it('auto-claims DGB once the DGB HTLC has enough confirmations', async () => {
    const service = makeService({ autoComplete: true });
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
      getDgbFundingStatus: (swap: LocalSwap) => Promise<{
        vout: number;
        value: number;
        confirmations: number;
      }>;
      claimFromDgbHtlc: (swapId: string) => Promise<string>;
    };
    let calls = 0;
    internal.getDgbFundingStatus = async () => ({
      vout: 0,
      value: 10_000_000_000,
      confirmations: 6,
    });
    internal.claimFromDgbHtlc = async () => {
      calls += 1;
      return 'claim-tx';
    };

    await internal.maybeAutoAdvance({
      ...makeSwap(),
      autoComplete: true,
      state: 'dgb_htlc_funded',
      dgbHtlcTxid: 'dgb-tx',
    });

    expect(calls).toBe(1);
  });

  it('waits for DGB confirmations before auto-claiming', async () => {
    const service = makeService({ autoComplete: true });
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
      getDgbFundingStatus: (swap: LocalSwap) => Promise<{
        vout: number;
        value: number;
        confirmations: number;
      }>;
      claimFromDgbHtlc: (swapId: string) => Promise<string>;
    };
    let calls = 0;
    internal.getDgbFundingStatus = async () => ({
      vout: 0,
      value: 10_000_000_000,
      confirmations: 5,
    });
    internal.claimFromDgbHtlc = async () => {
      calls += 1;
      return 'claim-tx';
    };

    await internal.maybeAutoAdvance({
      ...makeSwap(),
      autoComplete: true,
      state: 'dgb_htlc_funded',
      dgbHtlcTxid: 'dgb-tx',
    });

    expect(calls).toBe(0);
  });

  it('auto-claims HNS once the secret is available', async () => {
    const service = makeService({ autoComplete: true });
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
      getHnsFundingStatus: (swap: LocalSwap) => Promise<{
        vout: number;
        value: number;
        confirmations: number;
      }>;
      claimFromHnsHtlc: (swapId: string) => Promise<string>;
    };
    let calls = 0;
    internal.getHnsFundingStatus = async () => ({
      vout: 0,
      value: 1_000_000,
      confirmations: 2,
    });
    internal.claimFromHnsHtlc = async () => {
      calls += 1;
      return 'claim-tx';
    };

    await internal.maybeAutoAdvance({
      ...makeSwap(),
      autoComplete: true,
      role: 'counterparty',
      state: 'secret_revealed',
      dgbHtlcTxid: 'dgb-tx',
      secretHex: 'aa'.repeat(32),
    });

    expect(calls).toBe(1);
  });

  it('reconciles both claims to completed during auto-advance', async () => {
    const service = makeService({ autoComplete: true });
    const internal = service as unknown as {
      maybeAutoAdvance: (swap: LocalSwap) => Promise<void>;
    };
    const swap: LocalSwap = {
      ...makeSwap(),
      state: 'hns_claimed',
      hnsClaimed: true,
      dgbClaimed: true,
    };

    await internal.maybeAutoAdvance(swap);

    expect(swap.state).toBe('completed');
  });
});
