import type { WalletService } from './wallet-service';
import type { HSDConnectionService } from './hsd-connection';
import type { DBService } from './db-service';
import type { NostrMarketplaceService } from './nostr-marketplace-service';
import type {
  MarketplaceListing,
  CreateListingInput,
  PurchaseIntent,
  TransferStatus,
  RelayHealth,
  EscrowInfo,
} from '../../src/types/marketplace';
import {
  MARKETPLACE_ARBITER_FEE,
  buildListingPayload,
  buildListingPayloadFromListing,
  getListingId,
  getListingExpiresAt,
  isCanonicalListing,
  isEscrowListing,
  isListingExpired,
} from '../../src/lib/marketplace-signing';
import {
  covenantItemsMatchAddress,
  isValidHnsAddress,
  normalizeHnsAddress,
} from '../../src/lib/address-utils';
import {
  ESCROW_FEE_BUFFER,
  buildEscrowRedeemScript,
  buildEscrowSpendPsbtMulti,
  compressedNostrPubkey,
  createEscrowUtxo,
  escrowAddress,
  finalizeEscrowPsbt,
  parseEscrowPsbt,
  type EscrowNetwork,
  type EscrowPayout,
  type EscrowUtxo,
} from './hns-escrow-service';
import { randomUUID } from 'crypto';

const TRANSFER_LOCKUP_BLOCKS: Record<string, number> = {
  main: 288,
  testnet: 288,
  regtest: 10,
  simnet: 5,
};

const BLOCK_MINUTES = 10;

function nowIso(): string {
  return new Date().toISOString();
}

function intentIdOf(intent: PurchaseIntent): string {
  return intent.intentId
    || `${intent.buyerPubKey || ''}:${intent.name}:${intent.buyerAddr}`;
}

function mergeIntents(local: PurchaseIntent[], remote: PurchaseIntent[]): PurchaseIntent[] {
  const merged = new Map<string, PurchaseIntent>();

  for (const intent of [...local, ...remote]) {
    const id = intentIdOf(intent);
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { ...intent, intentId: id });
      continue;
    }
    if (new Date(intent.updatedAt) <= new Date(existing.updatedAt)) continue;

    const next: PurchaseIntent = { ...intent, intentId: id };

    if (existing.escrow) {
      // Escrow terms are fixed when the request is created. A newer event
      // may update status/PSBTs, but it must not replace the address, the
      // participants, or the amount. Otherwise a malicious counterparty
      // could downgrade an escrow trade or strand already-funded coins.
      next.name = existing.name;
      next.listingId = existing.listingId || next.listingId;
      next.price = existing.price;
      next.buyerAddr = existing.buyerAddr;
      next.sellerAddr = existing.sellerAddr;
      next.buyerPubKey = existing.buyerPubKey;
      next.sellerPubKey = existing.sellerPubKey;

      if (!next.escrow) {
        next.escrow = existing.escrow;
      } else {
        const escrow = { ...next.escrow };
        escrow.address = existing.escrow.address;
        escrow.arbiterPubKey = existing.escrow.arbiterPubKey;
        escrow.arbiterPayoutAddress = existing.escrow.arbiterPayoutAddress;
        escrow.arbiterFee = existing.escrow.arbiterFee;
        escrow.amount = existing.escrow.amount;
        escrow.fundingTxHash = existing.escrow.fundingTxHash || escrow.fundingTxHash;
        escrow.releaseTxHash = existing.escrow.releaseTxHash || escrow.releaseTxHash;
        escrow.refundTxHash = existing.escrow.refundTxHash || escrow.refundTxHash;

        const terminalState = existing.escrow.state === 'released'
          || existing.escrow.state === 'refunded';
        if (terminalState) {
          escrow.state = existing.escrow.state;
          escrow.releasePsbt = undefined;
          escrow.releaseRole = undefined;
          escrow.disputePsbt = undefined;
          escrow.disputeKind = undefined;
        } else if (existing.escrow.state !== 'created' && escrow.state === 'created') {
          escrow.state = existing.escrow.state;
        }
        next.escrow = escrow;
      }

      if (existing.status === 'sold' || existing.status === 'cancelled') {
        next.status = existing.status;
      } else if (existing.status === 'transferred' && next.status === 'pending') {
        next.status = 'transferred';
      }
    }

    merged.set(id, next);
  }

  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export class MarketplaceService {
  private walletService: WalletService;
  private connectionService: HSDConnectionService;
  private dbService: DBService;
  private nostrService: NostrMarketplaceService;
  /** Prevent two concurrent fund calls from sending twice. */
  private escrowFundingInFlight = new Set<string>();

  constructor(
    walletService: WalletService,
    connectionService: HSDConnectionService,
    dbService: DBService,
    nostrService: NostrMarketplaceService,
  ) {
    this.walletService = walletService;
    this.connectionService = connectionService;
    this.dbService = dbService;
    this.nostrService = nostrService;
  }

  get nostrPublicKey(): string { return this.nostrService.publicKey; }
  get relays(): string[] { return this.nostrService.relays; }
  setRelays(relays: string[]): void { this.nostrService.setRelays(relays); }

  private async verifyListingProof(listing: MarketplaceListing): Promise<boolean> {
    if (!isCanonicalListing(listing) || !listing.sellerPubKey || !listing.signature) {
      return false;
    }

    const version = listing.payloadVersion || 1;
    if (version === 2 || version === 3) {
      if (!listing.escrowArbiterPubKey
        || !/^[0-9a-f]{64}$/.test(listing.escrowArbiterPubKey)
        || listing.escrowArbiterPubKey === listing.sellerPubKey) {
        return false;
      }
      try {
        compressedNostrPubkey(listing.escrowArbiterPubKey);
      } catch {
        return false;
      }
      if (version === 2) {
        if (listing.escrowArbiterPayoutAddress || listing.escrowArbiterFee != null) {
          return false;
        }
      } else if (!listing.escrowArbiterPayoutAddress
        || !isValidHnsAddress(listing.escrowArbiterPayoutAddress)
        || !Number.isSafeInteger(listing.escrowArbiterFee)
        || (listing.escrowArbiterFee || 0) <= 0) {
        return false;
      }
    } else if (version !== 1
      || listing.escrowArbiterPubKey
      || listing.escrowArbiterPayoutAddress
      || listing.escrowArbiterFee != null) {
      return false;
    }

    const payload = buildListingPayloadFromListing(listing);
    if (!payload || payload !== listing.signedMessage) return false;
    if (listing.listingId !== getListingId(listing.sellerPubKey, listing.name)) return false;

    try {
      const { nodeClient } = this.connectionService.getClients();

      // The name must currently be registered and owned by the signing key.
      const raw = await nodeClient.execute('getnameinfo', [listing.name]) as {
        info?: Record<string, unknown>;
      } | null;
      const state = String(raw?.info?.state || '');
      if (state !== 'CLOSED') return false;

      return Boolean(await nodeClient.execute('verifymessagewithname', [
        listing.name,
        listing.signature,
        payload,
      ]));
    } catch {
      return false;
    }
  }

  async getMyListings(): Promise<MarketplaceListing[]> {
    return this.dbService.getMarketplaceListings()
      .filter((listing) => listing.status !== 'cancelled')
      .map((listing) => {
        const version = listing.payloadVersion || 1;
        const versionConsistent = version === 1
          ? !listing.escrowArbiterPubKey
            && !listing.escrowArbiterPayoutAddress
            && listing.escrowArbiterFee == null
          : version === 2
            ? Boolean(listing.escrowArbiterPubKey)
              && !listing.escrowArbiterPayoutAddress
              && listing.escrowArbiterFee == null
            : version === 3
              && Boolean(listing.escrowArbiterPubKey)
              && Boolean(listing.escrowArbiterPayoutAddress)
              && isValidHnsAddress(listing.escrowArbiterPayoutAddress || '')
              && Number.isSafeInteger(listing.escrowArbiterFee)
              && (listing.escrowArbiterFee || 0) > 0;
        return {
          ...listing,
          verified: Boolean(
            versionConsistent
            && listing.signature
            && listing.signedMessage
            && buildListingPayloadFromListing(listing) === listing.signedMessage,
          ),
        };
      });
  }

  async getOffers(includeOwn = false): Promise<MarketplaceListing[]> {
    const remote = await this.nostrService.getListings();
    const local = this.dbService.getMarketplaceListings();
    const ourPubKey = this.nostrService.publicKey;

    const localById = new Map<string, MarketplaceListing>();
    for (const listing of local) {
      const id = listing.listingId
        || (listing.sellerPubKey ? getListingId(listing.sellerPubKey, listing.name) : '');
      if (id) localById.set(id, listing);
    }

    return remote
      .filter((listing) => {
        if (!listing.listingId) return false;
        if (!includeOwn && listing.sellerPubKey === ourPubKey) return false;
        if (isListingExpired(listing)) return false;

        const mine = localById.get(listing.listingId);
        if (mine?.status === 'cancelled') return false;
        if (!includeOwn
          && mine
          && (mine.status === 'active' || mine.status === 'pending')) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async verifyListing(listing: MarketplaceListing): Promise<boolean> {
    return await this.verifyListingProof(listing);
  }

  async testRelays(): Promise<RelayHealth[]> {
    return await this.nostrService.testRelays();
  }

  async createListing(input: CreateListingInput, passphrase: string): Promise<MarketplaceListing> {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Select a name to list.');

    const priceHns = Number(input.price);
    if (!Number.isFinite(priceHns) || priceHns <= 0) {
      throw new Error('Enter a valid price greater than zero.');
    }
    const price = Math.round(priceHns * 1_000_000);
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new Error('That price is too large.');
    }

    const sellerAddr = normalizeHnsAddress(input.sellerAddr || '')
      || (await this.walletService.getAddress()).address;
    if (!isValidHnsAddress(sellerAddr)) {
      throw new Error('The seller address is not a valid Handshake address.');
    }

    const sellerPubKey = this.nostrService.publicKey;
    const createdAt = nowIso();
    const expiresAt = getListingExpiresAt(createdAt);
    const listingId = getListingId(sellerPubKey, name);
    const contact = this.dbService.getSetting('marketplaceContact') || undefined;
    const escrowArbiterPubKey = (this.dbService.getSetting('marketplaceEscrowArbiter') || '')
      .trim()
      .toLowerCase();
    const escrowArbiterPayoutAddress = normalizeHnsAddress(
      this.dbService.getSetting('marketplaceEscrowArbiterPayoutAddress') || '',
    );
    if (escrowArbiterPubKey) {
      if (!/^[0-9a-f]{64}$/.test(escrowArbiterPubKey)) {
        throw new Error('The configured escrow arbiter public key is invalid.');
      }
      try {
        compressedNostrPubkey(escrowArbiterPubKey);
      } catch {
        throw new Error('The configured escrow arbiter public key is not a valid secp256k1 key.');
      }
      if (escrowArbiterPubKey === sellerPubKey) {
        throw new Error('The escrow arbiter must be an independent third party, not the seller.');
      }
      if (!escrowArbiterPayoutAddress || !isValidHnsAddress(escrowArbiterPayoutAddress)) {
        throw new Error(
          'Set a valid HNS payout address for the escrow arbiter before creating an escrow listing.',
        );
      }
    }
    const payloadVersion = escrowArbiterPubKey ? 3 : 1;
    if (payloadVersion === 3
      && !Number.isSafeInteger(price + MARKETPLACE_ARBITER_FEE + ESCROW_FEE_BUFFER)) {
      throw new Error('That price is too large for an escrow listing.');
    }

    const signedMessage = buildListingPayload({
      listingId,
      name,
      price,
      sellerAddr,
      sellerPubKey,
      contact,
      createdAt,
      expiresAt,
      payloadVersion,
      escrowArbiterPubKey: escrowArbiterPubKey || undefined,
      escrowArbiterPayoutAddress: escrowArbiterPayoutAddress || undefined,
      escrowArbiterFee: payloadVersion === 3 ? MARKETPLACE_ARBITER_FEE : undefined,
    });

    // A listing without a valid ownership proof is worse than no listing:
    // buyers cannot distinguish it from a scam. Fail loudly instead.
    const signature = await this.walletService.signMessageWithName(
      name,
      signedMessage,
      passphrase,
    );
    if (!signature) throw new Error('Could not create the ownership proof.');

    const listing: MarketplaceListing = {
      listingId,
      name,
      price,
      sellerAddr,
      sellerPubKey,
      contact,
      verified: true,
      signature,
      signedMessage,
      payloadVersion,
      escrowArbiterPubKey: escrowArbiterPubKey || undefined,
      escrowArbiterPayoutAddress: escrowArbiterPayoutAddress || undefined,
      escrowArbiterFee: payloadVersion === 3 ? MARKETPLACE_ARBITER_FEE : undefined,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    };

    this.dbService.saveMarketplaceListing(listing);

    try {
      await this.nostrService.publishListing(listing);
    } catch (err) {
      this.dbService.removeMarketplaceListing(listing.name);
      throw new Error(err instanceof Error ? err.message : 'Failed to publish listing to relays');
    }

    return listing;
  }

  /**
   * Renew or reprice an existing canonical listing. The seller address and
   * contact are preserved; the full payload is re-signed with the new price
   * and expiry.
   */
  async republishListing(
    name: string,
    priceHns: number,
    passphrase: string,
  ): Promise<MarketplaceListing> {
    const listing = this.dbService.getMarketplaceListings().find(
      l => l.name === name && l.sellerPubKey === this.nostrService.publicKey,
    );
    if (!listing) {
      throw new Error('Your listing could not be found. Relist the name instead.');
    }
    if (!listing.listingId || !listing.sellerPubKey) {
      throw new Error('This legacy listing must be relisted from scratch.');
    }
    if (listing.status !== 'active') {
      throw new Error('Only active listings can be renewed or repriced.');
    }
    if (!isValidHnsAddress(listing.sellerAddr)) {
      throw new Error('The listing payout address is invalid. Relist the name.');
    }

    const price = Math.round(Number(priceHns) * 1_000_000);
    if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(price)) {
      throw new Error('Enter a valid price greater than zero.');
    }
    if (listing.payloadVersion === 3
      && !Number.isSafeInteger(price + (listing.escrowArbiterFee || 0) + ESCROW_FEE_BUFFER)) {
      throw new Error('That price is too large for an escrow listing.');
    }

    const updatedAt = nowIso();
    const expiresAt = getListingExpiresAt(updatedAt);
    const signedMessage = buildListingPayload({
      listingId: listing.listingId,
      name: listing.name,
      price,
      sellerAddr: listing.sellerAddr,
      sellerPubKey: listing.sellerPubKey,
      contact: listing.contact,
      createdAt: listing.createdAt,
      expiresAt,
      payloadVersion: listing.payloadVersion || 1,
      escrowArbiterPubKey: listing.escrowArbiterPubKey,
      escrowArbiterPayoutAddress: listing.escrowArbiterPayoutAddress,
      escrowArbiterFee: listing.escrowArbiterFee,
    });

    const signature = await this.walletService.signMessageWithName(
      listing.name,
      signedMessage,
      passphrase,
    );
    if (!signature) throw new Error('Could not create the ownership proof.');

    const updated: MarketplaceListing = {
      ...listing,
      price,
      signature,
      signedMessage,
      verified: true,
      status: 'active',
      updatedAt,
      expiresAt,
    };

    this.dbService.saveMarketplaceListing(updated);

    try {
      await this.nostrService.publishListing(updated);
    } catch (err) {
      this.dbService.saveMarketplaceListing(listing);
      throw new Error(err instanceof Error ? err.message : 'Failed to publish listing to relays');
    }

    return updated;
  }

  async cancelListing(name: string, _passphrase: string): Promise<void> {
    // Best-effort: publish the cancellation, but always update local state.
    try {
      await this.nostrService.cancelListing(name);
    } catch {
      console.warn('[Marketplace] Failed to publish cancel to Nostr');
    }

    const listings = this.dbService.getMarketplaceListings();
    const listing = listings.find(l => l.name === name);
    if (listing) {
      listing.status = 'cancelled';
      listing.updatedAt = nowIso();
      this.dbService.saveMarketplaceListing(listing);
    }
  }

  /**
   * Publish a cancellation only for a listing owned by this marketplace
   * identity, even when the listing is not in the local DB (for example after
   * a reinstall). Never allow one user to hide another user's listing.
   */
  async forceCancelListing(name: string): Promise<void> {
    const ourPubKey = this.nostrService.publicKey;
    const local = this.dbService.getMarketplaceListings()
      .find(l => l.name === name && l.sellerPubKey === ourPubKey);
    if (local) {
      await this.cancelListing(name, '');
      return;
    }

    const remote = await this.nostrService.getListings();
    const own = remote.find(l => l.name === name && l.sellerPubKey === ourPubKey);
    if (!own) {
      throw new Error('You can only withdraw your own listings.');
    }

    await this.nostrService.cancelListing(name);
  }

  // === 2-of-3 escrow helpers ===

  private async getEscrowNetwork(): Promise<EscrowNetwork> {
    try {
      const nodeInfo = await this.connectionService.getClients().nodeClient.getInfo() as Record<string, unknown>;
      const network = String(nodeInfo.network || 'main');
      return network === 'testnet' || network === 'regtest' ? network : 'main';
    } catch {
      return 'main';
    }
  }

  private buildEscrowInfo(
    listing: MarketplaceListing,
    buyerPubKey: string,
    network: EscrowNetwork,
  ): EscrowInfo {
    if (!isEscrowListing(listing) || !listing.sellerPubKey || !listing.escrowArbiterPubKey) {
      throw new Error('This listing does not offer 2-of-3 escrow.');
    }

    const redeem = buildEscrowRedeemScript(
      buyerPubKey,
      listing.sellerPubKey,
      listing.escrowArbiterPubKey,
    );
    const arbiterFee = listing.payloadVersion === 3
      ? Number(listing.escrowArbiterFee)
      : 0;
    if (!Number.isSafeInteger(arbiterFee) || arbiterFee < 0) {
      throw new Error('The escrow arbiter fee is invalid.');
    }
    if (arbiterFee > 0) {
      if (!listing.escrowArbiterPayoutAddress
        || !isValidHnsAddress(listing.escrowArbiterPayoutAddress)) {
        throw new Error('The escrow arbiter payout address is invalid.');
      }
    }
    const amount = listing.price + arbiterFee + ESCROW_FEE_BUFFER;
    if (!Number.isSafeInteger(amount)) {
      throw new Error('The escrow amount is too large.');
    }

    return {
      address: escrowAddress(redeem, network),
      arbiterPubKey: listing.escrowArbiterPubKey,
      arbiterPayoutAddress: arbiterFee > 0
        ? listing.escrowArbiterPayoutAddress
        : undefined,
      arbiterFee,
      amount,
      state: 'created',
    };
  }

  private escrowRole(intent: PurchaseIntent): 'buyer' | 'seller' | null {
    if (this.nostrService.publicKey === intent.buyerPubKey) return 'buyer';
    if (this.nostrService.publicKey === intent.sellerPubKey) return 'seller';
    return null;
  }

  /**
   * Re-derive the escrow address from the intent and, for the seller, compare
   * the commercial terms with the locally signed listing. A counterparty can
   * republish an intent with newer timestamps, so never sign a PSBT that pays
   * an address other than the one in the signed listing.
   */
  private async verifyEscrowIntentTerms(intent: PurchaseIntent): Promise<void> {
    const escrow = intent.escrow;
    if (!escrow) return;
    if (!intent.buyerPubKey || !intent.sellerPubKey) {
      throw new Error('Escrow participant keys are missing.');
    }
    if (!Number.isSafeInteger(intent.price) || intent.price <= 0) {
      throw new Error('This escrow trade has an invalid price.');
    }
    if (intent.buyerPubKey === intent.sellerPubKey
      || escrow.arbiterPubKey === intent.buyerPubKey
      || escrow.arbiterPubKey === intent.sellerPubKey) {
      throw new Error('Escrow participants must use three distinct keys.');
    }
    const arbiterFee = Number(escrow.arbiterFee || 0);
    if (!Number.isSafeInteger(arbiterFee) || arbiterFee < 0) {
      throw new Error('This escrow trade has an invalid arbiter fee.');
    }
    if (arbiterFee > 0
      && (!escrow.arbiterPayoutAddress
        || !isValidHnsAddress(escrow.arbiterPayoutAddress))) {
      throw new Error('This escrow trade has an invalid arbiter payout address.');
    }
    if (!Number.isSafeInteger(escrow.amount)
      || escrow.amount !== intent.price + arbiterFee + ESCROW_FEE_BUFFER) {
      throw new Error('The escrow amount does not match the trade price and fees.');
    }

    const network = await this.getEscrowNetwork();
    const expectedAddress = escrowAddress(
      buildEscrowRedeemScript(
        intent.buyerPubKey,
        intent.sellerPubKey,
        escrow.arbiterPubKey,
      ),
      network,
    );
    if (escrow.address !== expectedAddress) {
      throw new Error('The escrow address does not match the trade participants.');
    }

    if (this.escrowRole(intent) === 'seller') {
      const listing = this.dbService.getMarketplaceListings().find(
        (candidate) => candidate.name === intent.name
          && candidate.sellerPubKey === intent.sellerPubKey,
      );
      if (!listing) {
        throw new Error('Your signed listing for this escrow trade could not be found.');
      }
      if (!isEscrowListing(listing) || !listing.escrowArbiterPubKey) {
        throw new Error('This listing does not offer 2-of-3 escrow.');
      }
      if (listing.listingId && intent.listingId && listing.listingId !== intent.listingId) {
        throw new Error('This escrow request is for a different listing.');
      }
      if (intent.price !== listing.price) {
        throw new Error('The escrow price does not match your signed listing.');
      }
      if (intent.sellerAddr !== listing.sellerAddr) {
        throw new Error('The escrow payout address does not match your signed listing.');
      }
      if (escrow.arbiterPubKey !== listing.escrowArbiterPubKey) {
        throw new Error('The escrow arbiter does not match your signed listing.');
      }
      const listingFee = listing.payloadVersion === 3
        ? Number(listing.escrowArbiterFee || 0)
        : 0;
      if (arbiterFee !== listingFee) {
        throw new Error('The escrow arbiter fee does not match your signed listing.');
      }
      if (arbiterFee > 0
        && escrow.arbiterPayoutAddress !== listing.escrowArbiterPayoutAddress) {
        throw new Error('The escrow arbiter payout address does not match your signed listing.');
      }
      if (arbiterFee === 0 && escrow.arbiterPayoutAddress) {
        throw new Error('This escrow stipulates an unexpected arbiter payout address.');
      }
    }
  }

  private async verifyEscrowFunding(
    intent: PurchaseIntent,
  ): Promise<{ funded: boolean; value: number; vout: number; confirmations: number }> {
    const escrow = intent.escrow;
    if (!escrow || !intent.buyerPubKey || !intent.sellerPubKey) {
      return { funded: false, value: 0, vout: -1, confirmations: 0 };
    }

    const network = await this.getEscrowNetwork();
    const redeem = buildEscrowRedeemScript(
      intent.buyerPubKey,
      intent.sellerPubKey,
      escrow.arbiterPubKey,
    );
    if (escrowAddress(redeem, network) !== escrow.address) {
      throw new Error('Escrow address does not match the trade participants.');
    }
    if (!escrow.fundingTxHash) {
      return { funded: false, value: 0, vout: -1, confirmations: 0 };
    }

    const tx = await this.walletService.getTransaction(escrow.fundingTxHash);
    if (!tx) {
      return { funded: false, value: 0, vout: -1, confirmations: 0 };
    }

    const outputs = (tx.outputs as Array<Record<string, unknown>>) || [];
    const vout = outputs.findIndex((output) =>
      normalizeHnsAddress(String(output.address || '')) === escrow.address
      && Number(output.value) >= escrow.amount,
    );
    if (vout < 0) {
      return { funded: false, value: 0, vout: -1, confirmations: 0 };
    }

    let confirmations = Number(tx.confirmations) || 0;
    const height = Number(tx.height) || 0;
    if (height > 0) {
      try {
        const nodeInfo = await this.connectionService.getClients().nodeClient.getInfo() as Record<string, unknown>;
        const chain = nodeInfo.chain as Record<string, unknown> | undefined;
        const currentHeight = Number(chain?.height) || 0;
        confirmations = Math.max(1, currentHeight - height + 1);
      } catch {
        // Keep the RPC-reported confirmation count.
      }
    }

    return {
      funded: true,
      value: Number(outputs[vout].value),
      vout,
      confirmations,
    };
  }

  private async getEscrowUtxo(intent: PurchaseIntent): Promise<EscrowUtxo> {
    if (!intent.escrow || !intent.buyerPubKey || !intent.sellerPubKey || !intent.escrow.fundingTxHash) {
      throw new Error('Escrow is not funded.');
    }

    const funding = await this.verifyEscrowFunding(intent);
    if (!funding.funded || funding.vout < 0) {
      throw new Error('Escrow funding could not be verified.');
    }

    const redeem = buildEscrowRedeemScript(
      intent.buyerPubKey,
      intent.sellerPubKey,
      intent.escrow.arbiterPubKey,
    );

    return createEscrowUtxo(
      intent.escrow.fundingTxHash,
      funding.vout,
      funding.value,
      redeem,
    );
  }

  private escrowArbiterFee(intent: PurchaseIntent): number {
    const fee = Number(intent.escrow?.arbiterFee || 0);
    if (!Number.isSafeInteger(fee) || fee < 0) {
      throw new Error('The escrow arbiter fee is invalid.');
    }
    return fee;
  }

  /**
   * Normal buyer+seller release: the seller gets the price and the buyer gets
   * the arbitration fee back. Legacy v2 escrow has no fee output.
   */
  private releaseEscrowOutputs(intent: PurchaseIntent): EscrowPayout[] {
    if (!intent.escrow) throw new Error('Escrow details are missing.');
    const outputs: EscrowPayout[] = [
      { address: intent.sellerAddr, value: intent.price },
    ];
    const fee = this.escrowArbiterFee(intent);
    if (fee > 0) {
      outputs.push({ address: intent.buyerAddr, value: fee });
    }
    return outputs;
  }

  /**
   * Refund: buyer gets the price, arbiter gets the fee. Arbitration release:
   * seller gets the price, arbiter gets the fee.
   */
  private disputeEscrowOutputs(
    intent: PurchaseIntent,
    kind: 'release' | 'refund',
  ): EscrowPayout[] {
    if (!intent.escrow) throw new Error('Escrow details are missing.');
    const outputs: EscrowPayout[] = [{
      address: kind === 'refund' ? intent.buyerAddr : intent.sellerAddr,
      value: intent.price,
    }];
    const fee = this.escrowArbiterFee(intent);
    if (fee > 0) {
      const payout = intent.escrow.arbiterPayoutAddress;
      if (!payout || !isValidHnsAddress(payout)) {
        throw new Error('The escrow arbiter payout address is invalid.');
      }
      outputs.push({ address: payout, value: fee });
    }
    return outputs;
  }

  private validateEscrowSpendPsbt(
    psbtBase64: string,
    intent: PurchaseIntent,
    expectedOutputs: EscrowPayout[],
    network: EscrowNetwork,
    expectedUtxo?: EscrowUtxo,
  ): void {
    if (!intent.escrow || !intent.buyerPubKey || !intent.sellerPubKey) {
      throw new Error('Escrow details are missing.');
    }

    const psbt = parseEscrowPsbt(psbtBase64);
    if (psbt.network !== network) {
      throw new Error('The escrow transaction network does not match this trade.');
    }
    if (psbt.outputs.length !== expectedOutputs.length) {
      throw new Error('The escrow transaction outputs do not match the agreed terms.');
    }

    const redeem = buildEscrowRedeemScript(
      intent.buyerPubKey,
      intent.sellerPubKey,
      intent.escrow.arbiterPubKey,
    );
    if (psbt.input.redeemScript !== redeem.toString('hex')) {
      throw new Error('The escrow witness script does not match this trade.');
    }
    if (psbt.input.txHash !== intent.escrow.fundingTxHash) {
      throw new Error('The escrow input is not the funding transaction.');
    }
    if (expectedUtxo) {
      if (psbt.input.vout !== expectedUtxo.vout) {
        throw new Error('The escrow input is not the funded output.');
      }
      if (psbt.input.value !== expectedUtxo.value) {
        throw new Error('The escrow input value does not match the on-chain funding.');
      }
    }

    const remaining = psbt.outputs.map(output => ({ ...output }));
    for (const expected of expectedOutputs) {
      const index = remaining.findIndex(
        output => output.value === expected.value && output.address === expected.address,
      );
      if (index < 0) {
        throw new Error('The escrow payout outputs do not match the agreed terms.');
      }
      remaining.splice(index, 1);
    }
    if (remaining.length !== 0) {
      throw new Error('The escrow transaction contains an unexpected output.');
    }

    if (expectedUtxo) {
      const total = psbt.outputs.reduce((sum, output) => sum + output.value, 0);
      const actualFee = expectedUtxo.value - total;
      if (actualFee !== ESCROW_FEE_BUFFER) {
        throw new Error('The escrow transaction fee does not match the agreed fee buffer.');
      }
    }
  }

  // === Transfer-first: buyer side ===

  async requestPurchase(
    listing: MarketplaceListing,
    buyerAddr: string,
    useEscrow = false,
  ): Promise<PurchaseIntent> {
    const buyer = normalizeHnsAddress(buyerAddr);
    if (!isValidHnsAddress(buyer)) {
      throw new Error('Enter a valid Handshake receiving address.');
    }
    if (!isCanonicalListing(listing) || !listing.sellerPubKey || !listing.listingId) {
      throw new Error('This listing does not have a valid ownership proof.');
    }
    if (listing.status !== 'active') {
      throw new Error('This listing is no longer active.');
    }
    if (!Number.isSafeInteger(listing.price) || listing.price <= 0) {
      throw new Error('This listing has an invalid price.');
    }
    if (listing.sellerPubKey === this.nostrService.publicKey) {
      throw new Error('This is your own listing.');
    }
    if (isListingExpired(listing)) {
      throw new Error('This listing has expired. Ask the seller to relist it.');
    }
    if (buyer === normalizeHnsAddress(listing.sellerAddr)) {
      throw new Error('Use a receiving address that you control, not the seller address.');
    }
    if (listing.listingId !== getListingId(listing.sellerPubKey, listing.name)) {
      throw new Error('The listing identity does not match its signed proof.');
    }

    const payload = buildListingPayloadFromListing(listing);
    if (!payload || payload !== listing.signedMessage) {
      throw new Error('The listing terms do not match its signed proof.');
    }

    const valid = await this.verifyListingProof(listing);
    if (!valid) {
      throw new Error('The seller ownership proof is invalid or the name is no longer for sale.');
    }

    const buyerPubKey = this.nostrService.publicKey;
    let escrow: EscrowInfo | undefined;
    if (useEscrow) {
      const network = await this.getEscrowNetwork();
      escrow = this.buildEscrowInfo(listing, buyerPubKey, network);
    }

    // Opaque ID: the d tag is public, so it must not contain the name or
    // buyer address. The private terms live in the encrypted content.
    const intentId = randomUUID();
    const createdAt = nowIso();

    const intent: PurchaseIntent = {
      intentId,
      listingId: listing.listingId,
      name: listing.name,
      price: listing.price,
      buyerAddr: buyer,
      sellerAddr: listing.sellerAddr,
      buyerPubKey,
      sellerPubKey: listing.sellerPubKey,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      escrow,
    };

    this.dbService.savePurchaseIntent(intent);

    try {
      await this.nostrService.publishPurchaseIntent(intent);
    } catch (err) {
      this.dbService.removePurchaseIntent(intent.name, intent.buyerAddr);
      throw new Error(err instanceof Error ? err.message : 'Failed to send purchase request');
    }

    return intent;
  }

  async getEscrowFundingStatus(intentId: string): Promise<{
    funded: boolean;
    value: number;
    vout: number;
    confirmations: number;
    address: string;
    amount: number;
  }> {
    const intent = this.dbService.getPurchaseIntents()
      .find(i => intentIdOf(i) === intentId);
    if (!intent?.escrow) throw new Error('Escrow was not requested for this trade.');

    const status = await this.verifyEscrowFunding(intent);
    return {
      ...status,
      address: intent.escrow.address,
      amount: intent.escrow.amount,
    };
  }

  async fundEscrow(
    intentId: string,
    passphrase: string,
  ): Promise<{ txHash: string; address: string; amount: number }> {
    const intent = this.dbService.getPurchaseIntents()
      .find(i => intentIdOf(i) === intentId);
    if (!intent?.escrow) throw new Error('Escrow was not requested for this trade.');
    if (this.escrowFundingInFlight.has(intentId)) {
      throw new Error('Escrow funding is already in progress.');
    }
    this.escrowFundingInFlight.add(intentId);
    try {
      if (this.escrowRole(intent) !== 'buyer') {
        throw new Error('Only the buyer can fund the escrow.');
      }
      if (intent.escrow.state !== 'created') {
        throw new Error('This escrow has already been funded.');
      }
      if (intent.status !== 'pending') {
        throw new Error('This escrow request is no longer active.');
      }
      if (!intent.buyerPubKey || !intent.sellerPubKey) {
        throw new Error('Escrow participant keys are missing.');
      }
      await this.verifyEscrowIntentTerms(intent);

      const network = await this.getEscrowNetwork();
      const redeem = buildEscrowRedeemScript(
        intent.buyerPubKey,
        intent.sellerPubKey,
        intent.escrow.arbiterPubKey,
      );
      if (escrowAddress(redeem, network) !== intent.escrow.address) {
        throw new Error('Escrow address does not match the trade participants.');
      }

      const tx = await this.walletService.sendToAddress(
        intent.escrow.address,
        intent.escrow.amount,
        passphrase,
        { subtractFee: false },
      );

      intent.escrow.fundingTxHash = tx.hash;
      intent.escrow.state = 'funded';
      intent.updatedAt = nowIso();
      this.dbService.savePurchaseIntent(intent);
      await this.nostrService.publishPurchaseIntent(intent);

      return {
        txHash: tx.hash,
        address: intent.escrow.address,
        amount: intent.escrow.amount,
      };
    } finally {
      this.escrowFundingInFlight.delete(intentId);
    }
  }

  async createEscrowRelease(
    intentId: string,
  ): Promise<{ psbt: string; role: 'buyer' | 'seller' }> {
    const intent = this.dbService.getPurchaseIntents()
      .find(i => intentIdOf(i) === intentId);
    if (!intent?.escrow) throw new Error('Escrow was not requested for this trade.');

    const role = this.escrowRole(intent);
    if (!role) throw new Error('You are not a participant in this escrow.');
    if (intent.escrow.state !== 'funded' && intent.escrow.state !== 'disputed') {
      throw new Error('Escrow is not funded.');
    }
    await this.verifyEscrowIntentTerms(intent);
    if (intent.escrow.releasePsbt) {
      if (intent.escrow.releaseRole === role) {
        return { psbt: intent.escrow.releasePsbt, role };
      }
      throw new Error('The counterparty already created the release. Sign their PSBT instead.');
    }

    const status = await this.checkTransferStatus(
      intent.name,
      intent.buyerAddr,
      intent.transferTxHash,
    );
    if (!status.finalized) {
      throw new Error('The buyer must finalize the name before escrow can be released.');
    }

    const network = await this.getEscrowNetwork();
    const utxo = await this.getEscrowUtxo(intent);
    const psbt = buildEscrowSpendPsbtMulti(
      utxo,
      this.releaseEscrowOutputs(intent),
      network,
    );
    const signed = this.nostrService.signEscrowPsbt(psbt, network);

    intent.escrow.releasePsbt = signed;
    intent.escrow.releaseRole = role;
    intent.escrow.disputePsbt = undefined;
    intent.escrow.disputeKind = undefined;
    intent.escrow.state = 'funded';
    intent.updatedAt = nowIso();
    this.dbService.savePurchaseIntent(intent);
    await this.nostrService.publishPurchaseIntent(intent);

    return { psbt: signed, role };
  }

  async signEscrowRelease(intentId: string): Promise<{ txId: string }> {
    const intent = this.dbService.getPurchaseIntents()
      .find(i => intentIdOf(i) === intentId);
    if (!intent?.escrow?.releasePsbt) {
      throw new Error('There is no release PSBT to sign.');
    }

    const role = this.escrowRole(intent);
    if (!role) throw new Error('You are not a participant in this escrow.');
    if (!intent.escrow.releaseRole) {
      throw new Error('The release PSBT is missing its creator.');
    }
    if (intent.escrow.releaseRole === role) {
      throw new Error('Waiting for the counterparty to sign the release.');
    }
    if (intent.escrow.state !== 'funded' && intent.escrow.state !== 'disputed') {
      throw new Error('Escrow is not funded.');
    }
    await this.verifyEscrowIntentTerms(intent);

    // Never release escrow before the name is finalized to the buyer,
    // regardless of what the counterparty's status event claims.
    const status = await this.checkTransferStatus(
      intent.name,
      intent.buyerAddr,
      intent.transferTxHash,
    );
    if (!status.finalized) {
      throw new Error('The name has not been finalized to the buyer yet.');
    }

    const network = await this.getEscrowNetwork();
    const utxo = await this.getEscrowUtxo(intent);
    this.validateEscrowSpendPsbt(
      intent.escrow.releasePsbt,
      intent,
      this.releaseEscrowOutputs(intent),
      network,
      utxo,
    );

    const signed = this.nostrService.signEscrowPsbt(
      intent.escrow.releasePsbt,
      network,
    );
    const { txHex, txId } = finalizeEscrowPsbt(signed, network);
    const broadcastTxId = await this.walletService.broadcastTx(txHex);

    intent.escrow.releaseTxHash = broadcastTxId || txId;
    intent.escrow.state = 'released';
    intent.escrow.releasePsbt = undefined;
    intent.escrow.releaseRole = undefined;
    intent.escrow.disputePsbt = undefined;
    intent.escrow.disputeKind = undefined;
    intent.status = 'sold';
    intent.updatedAt = nowIso();
    this.dbService.savePurchaseIntent(intent);
    await this.nostrService.publishPurchaseIntent(intent);

    return { txId: broadcastTxId || txId };
  }

  async createEscrowDisputePsbt(
    intentId: string,
    kind: 'refund' | 'release',
  ): Promise<{ psbt: string; kind: 'refund' | 'release' }> {
    const intent = this.dbService.getPurchaseIntents()
      .find(i => intentIdOf(i) === intentId);
    if (!intent?.escrow) throw new Error('Escrow was not requested for this trade.');

    const role = this.escrowRole(intent);
    if (!role) throw new Error('You are not a participant in this escrow.');
    if (kind === 'refund' && role !== 'buyer') {
      throw new Error('Only the buyer can request an escrow refund.');
    }
    if (kind === 'release' && role !== 'seller') {
      throw new Error('Only the seller can request an arbitration release.');
    }
    if (intent.escrow.state !== 'funded' && intent.escrow.state !== 'disputed') {
      throw new Error('Escrow is not funded.');
    }
    await this.verifyEscrowIntentTerms(intent);

    const status = await this.checkTransferStatus(
      intent.name,
      intent.buyerAddr,
      intent.transferTxHash,
    );
    if (kind === 'refund' && status.finalized) {
      throw new Error('The buyer already owns the name; a refund is not appropriate.');
    }
    if (kind === 'release' && !status.finalized) {
      throw new Error('The name has not been finalized to the buyer yet.');
    }

    const network = await this.getEscrowNetwork();
    const utxo = await this.getEscrowUtxo(intent);
    const psbt = buildEscrowSpendPsbtMulti(
      utxo,
      this.disputeEscrowOutputs(intent, kind),
      network,
    );
    const signed = this.nostrService.signEscrowPsbt(psbt, network);

    intent.escrow.disputePsbt = signed;
    intent.escrow.disputeKind = kind;
    intent.escrow.releasePsbt = undefined;
    intent.escrow.releaseRole = undefined;
    intent.escrow.state = 'disputed';
    intent.updatedAt = nowIso();
    this.dbService.savePurchaseIntent(intent);
    await this.nostrService.publishPurchaseIntent(intent);

    return { psbt: signed, kind };
  }

  async importEscrowArbiterPsbt(
    intentId: string,
    psbtBase64: string,
  ): Promise<{ txId: string }> {
    const intent = this.dbService.getPurchaseIntents()
      .find(i => intentIdOf(i) === intentId);
    if (!intent?.escrow?.disputePsbt || !intent.escrow.disputeKind) {
      throw new Error('There is no arbitration PSBT waiting for a signature.');
    }
    if (!this.escrowRole(intent)) {
      throw new Error('You are not a participant in this escrow.');
    }
    await this.verifyEscrowIntentTerms(intent);

    const status = await this.checkTransferStatus(
      intent.name,
      intent.buyerAddr,
      intent.transferTxHash,
    );
    if (intent.escrow.disputeKind === 'refund' && status.finalized) {
      throw new Error('The buyer already owns the name; the refund is no longer valid.');
    }
    if (intent.escrow.disputeKind === 'release' && !status.finalized) {
      throw new Error('The name has not been finalized to the buyer yet.');
    }

    const network = await this.getEscrowNetwork();
    const utxo = await this.getEscrowUtxo(intent);
    this.validateEscrowSpendPsbt(
      psbtBase64,
      intent,
      this.disputeEscrowOutputs(intent, intent.escrow.disputeKind),
      network,
      utxo,
    );

    const { txHex, txId } = finalizeEscrowPsbt(psbtBase64, network);
    const broadcastTxId = await this.walletService.broadcastTx(txHex);

    if (intent.escrow.disputeKind === 'refund') {
      intent.escrow.refundTxHash = broadcastTxId || txId;
      intent.escrow.state = 'refunded';
      intent.status = 'cancelled';
    } else {
      intent.escrow.releaseTxHash = broadcastTxId || txId;
      intent.escrow.state = 'released';
      intent.status = 'sold';
    }
    intent.escrow.disputePsbt = undefined;
    intent.escrow.disputeKind = undefined;
    intent.updatedAt = nowIso();
    this.dbService.savePurchaseIntent(intent);
    await this.nostrService.publishPurchaseIntent(intent);

    return { txId: broadcastTxId || txId };
  }

  async checkTransferStatus(
    name: string,
    buyerAddr: string,
    transferTxHash?: string,
  ): Promise<TransferStatus> {
    const buyer = normalizeHnsAddress(buyerAddr);
    if (!buyer) return { transferred: false, cancelled: false, finalized: false };

    try {
      const { nodeClient } = this.connectionService.getClients();

      const nodeInfo = await nodeClient.getInfo() as Record<string, unknown>;
      const chain = nodeInfo.chain as Record<string, unknown> | undefined;
      const currentHeight = Number(chain?.height) || 0;
      const network = String(nodeInfo.network || 'main');

      const raw = await nodeClient.execute('getnameinfo', [name]) as {
        info?: Record<string, unknown>;
      } | null;
      const info = raw?.info;
      if (!info) return { transferred: false, cancelled: false, finalized: false };

      const state = String(info.state || '');
      const transferHeight = Number(info.transfer) || 0;
      const owner = info.owner as { hash?: string; index?: number } | undefined;
      const nameHash = String(info.nameHash || '').toLowerCase();

      const inspectTransferTx = async (
        hash: string,
      ): Promise<{ hash: string; tx: Record<string, unknown>; matchesBuyer: boolean } | null> => {
        if (!hash) return null;
        const tx = await this.walletService.getTransaction(hash);
        if (!tx || !Array.isArray(tx.outputs)) return null;

        const transferOutputs = (tx.outputs as Array<Record<string, unknown>>)
          .filter((output) => {
            const covenant = output.covenant as Record<string, unknown> | undefined;
            if (String(covenant?.action || '').toUpperCase() !== 'TRANSFER') {
              return false;
            }
            if (!nameHash) return true;
            const items = covenant?.items;
            return Array.isArray(items)
              && String(items[0] || '').toLowerCase() === nameHash;
          });
        if (transferOutputs.length === 0) return null;

        const matchesBuyer = transferOutputs.some((output) => {
          const covenant = output.covenant as Record<string, unknown> | undefined;
          return covenantItemsMatchAddress(covenant?.items, buyer);
        });
        return { hash, tx, matchesBuyer };
      };

      // hsd keeps a transferring name in CLOSED state. `transfer` is the
      // height that started the lockup, and the current owner is the transfer
      // output. That output still pays the seller; the intended recipient is
      // encoded in the TRANSFER covenant's address items.
      if (transferHeight > 0) {
        const ownerHash = String(owner?.hash || '');
        const candidates = Array.from(
          new Set([ownerHash, transferTxHash || ''].filter(Boolean)),
        );

        let inspected: Awaited<ReturnType<typeof inspectTransferTx>> = null;
        for (const hash of candidates) {
          inspected = await inspectTransferTx(hash);
          if (inspected) break;
        }

        if (!inspected) {
          // The name is in transfer, but the recipient could not be verified.
          // Stay pending rather than letting the buyer pay an unverified trade.
          return {
            transferred: false,
            cancelled: false,
            finalized: false,
            transferHeight,
            transferTxHash: transferTxHash || ownerHash || undefined,
          };
        }

        if (!inspected.matchesBuyer) {
          // The name is being transferred to a different recipient.
          return {
            transferred: false,
            cancelled: true,
            finalized: false,
            transferTxHash: inspected.hash,
            transferHeight,
          };
        }

        const lockup = TRANSFER_LOCKUP_BLOCKS[network] ?? TRANSFER_LOCKUP_BLOCKS.main;
        const finalizableHeight = transferHeight + lockup;
        const blocksRemaining = Math.max(0, finalizableHeight - currentHeight);

        return {
          transferred: true,
          cancelled: false,
          finalized: false,
          transferTxHash: inspected.hash,
          transferHeight,
          blocksRemaining,
          estimatedMinutesRemaining: blocksRemaining * BLOCK_MINUTES,
        };
      }

      // `transfer` is zero after finalize or cancel. Resolve the owner coin to
      // distinguish "buyer now owns the name" from "seller still owns it".
      let ownerAddr = '';
      if (owner?.hash && owner.index != null) {
        try {
          const coin = await nodeClient.getCoin(owner.hash, owner.index) as Record<string, unknown> | null;
          ownerAddr = normalizeHnsAddress(String(coin?.address || ''));
        } catch {
          // Leave unknown; treat as not finalized.
        }
      }

      if (state === 'REVOKED' || state === 'EXPIRED' || info.expired === true) {
        return {
          transferred: false,
          cancelled: true,
          finalized: false,
          transferHeight: undefined,
        };
      }

      if (ownerAddr && ownerAddr === buyer) {
        return {
          transferred: false,
          cancelled: false,
          finalized: true,
          transferTxHash: transferTxHash || undefined,
        };
      }

      // A completed transfer that no longer exists was cancelled. Require the
      // transfer transaction to be confirmed and to have targeted this buyer.
      let matchedTxHash = '';
      let matched = false;
      let transferConfirmed = false;

      if (transferTxHash) {
        const inspected = await inspectTransferTx(transferTxHash);
        if (inspected?.matchesBuyer) {
          matchedTxHash = inspected.hash;
          matched = true;
          const txHeight = Number(inspected.tx.height ?? 0);
          const txConfirmations = Number(inspected.tx.confirmations ?? 0);
          transferConfirmed = txHeight > 0 || txConfirmations > 0;
        }
      }

      // Fall back to the buyer's wallet history if the seller published an
      // intent before transfer txids were included.
      if (!matched) {
        try {
          const history = await this.walletService.getTxHistory();
          const hit = history.find((tx) =>
            tx.outputs.some((output) => {
              if (String(output.covenant.action || '').toUpperCase() !== 'TRANSFER') {
                return false;
              }
              const items = (output.covenant as unknown as Record<string, unknown>).items;
              if (nameHash) {
                if (!Array.isArray(items)
                  || String(items[0] || '').toLowerCase() !== nameHash) {
                  return false;
                }
              }
              return covenantItemsMatchAddress(items, buyer);
            }),
          );
          if (hit) {
            matchedTxHash = hit.hash;
            matched = true;
            transferConfirmed = hit.height != null && hit.height > 0;
          }
        } catch {
          // No history available; stay pending.
        }
      }

      return {
        transferred: false,
        cancelled: Boolean(matched && transferConfirmed),
        finalized: false,
        transferTxHash: matchedTxHash || undefined,
      };
    } catch {
      return { transferred: false, cancelled: false, finalized: false };
    }
  }

  async confirmAndPay(
    intentId: string,
    passphrase: string,
  ): Promise<{ txHash: string; fee: number }> {
    const intent = this.dbService.getPurchaseIntents()
      .find(i => intentIdOf(i) === intentId);
    if (!intent) throw new Error('Purchase intent not found.');
    if (intent.status === 'cancelled' || intent.status === 'sold') {
      throw new Error('This purchase is no longer active.');
    }
    if (intent.escrow) {
      throw new Error(
        'This escrow trade releases funds after finalization. Use the escrow release action instead of paying directly.',
      );
    }
    if (!isValidHnsAddress(intent.sellerAddr)) {
      throw new Error('The seller address on this listing is invalid.');
    }

    // The on-chain transfer is the source of truth; the local status may
    // still be 'pending' until the next My Purchases sync.
    const status = await this.checkTransferStatus(
      intent.name,
      intent.buyerAddr,
      intent.transferTxHash,
    );
    if (status.cancelled) {
      throw new Error('The seller cancelled the transfer.');
    }
    // If the buyer already finalized, the name is theirs but the seller still
    // needs to be paid. Otherwise wait for the transfer to confirm.
    if (!status.transferred && !status.finalized) {
      throw new Error('The name transfer has not been detected on-chain yet.');
    }

    // subtractFee: false so the seller receives the full listed price. The
    // buyer pays the network fee on top of it.
    const tx = await this.walletService.sendToAddress(
      intent.sellerAddr,
      intent.price,
      passphrase,
      { subtractFee: false },
    );

    intent.status = 'paid';
    intent.paymentTxHash = tx.hash;
    intent.updatedAt = nowIso();
    this.dbService.savePurchaseIntent(intent);
    await this.nostrService.publishPurchaseIntent(intent);

    return { txHash: tx.hash, fee: tx.fee };
  }

  async finalizePurchase(
    intentId: string,
    passphrase: string,
  ): Promise<{ txHash: string }> {
    const intent = this.dbService.getPurchaseIntents()
      .find(i => intentIdOf(i) === intentId);
    if (!intent) throw new Error('Purchase intent not found.');
    if (intent.status === 'cancelled' || intent.status === 'sold') {
      throw new Error('There is no active transfer to finalize.');
    }

    const status = await this.checkTransferStatus(
      intent.name,
      intent.buyerAddr,
      intent.transferTxHash,
    );
    if (status.cancelled) {
      throw new Error('The seller cancelled the transfer.');
    }
    if (!status.transferred) {
      throw new Error('The on-chain transfer could not be verified.');
    }
    if ((status.blocksRemaining ?? 0) > 0) {
      throw new Error(
        `The transfer is still locked up for ${status.blocksRemaining} more blocks.`,
      );
    }

    const tx = await this.walletService.sendFinalize(intent.name, passphrase);

    intent.status = 'sold';
    intent.finalizeTxHash = tx.hash;
    intent.updatedAt = nowIso();
    this.dbService.savePurchaseIntent(intent);
    await this.nostrService.publishPurchaseIntent(intent);

    return { txHash: tx.hash };
  }

  // === Transfer-first: seller side ===

  async getPurchaseRequests(): Promise<PurchaseIntent[]> {
    const ourPubKey = this.nostrService.publicKey;
    const received = await this.nostrService.getPurchaseIntents(ourPubKey);

    const local = this.dbService.getPurchaseIntents()
      .filter(i => i.sellerPubKey === ourPubKey);
    const remote = received.map(r => r.intent)
      .filter(i => i.sellerPubKey === ourPubKey);

    const merged = mergeIntents(local, remote);
    // Persist remote status updates so approve/reject and the UI see them.
    for (const intent of merged) {
      this.dbService.savePurchaseIntent(intent);

      // Keep the seller's listing status in sync once the trade is actually
      // complete. A status event alone is not enough: require an on-chain
      // escrow release or a finalize that the chain confirms.
      if (intent.status === 'sold') {
        const listings = this.dbService.getMarketplaceListings();
        const listing = listings.find(
          l => l.name === intent.name && l.sellerPubKey === ourPubKey,
        );
        if (listing && listing.status !== 'sold') {
          let complete = intent.escrow?.state === 'released';
          if (!complete && intent.finalizeTxHash) {
            const status = await this.checkTransferStatus(
              intent.name,
              intent.buyerAddr,
              intent.transferTxHash,
            );
            complete = status.finalized;
          }
          if (complete) {
            listing.status = 'sold';
            listing.updatedAt = nowIso();
            this.dbService.saveMarketplaceListing(listing);
          }
        }
      }
    }
    return merged;
  }

  async getMyPurchases(): Promise<PurchaseIntent[]> {
    const ourPubKey = this.nostrService.publicKey;
    const received = await this.nostrService.getPurchaseIntents(ourPubKey);

    const local = this.dbService.getPurchaseIntents();
    const remote = received.map(r => r.intent)
      .filter(i => i.buyerPubKey === ourPubKey);

    const merged = mergeIntents(local, remote)
      .filter(i => !i.buyerPubKey || i.buyerPubKey === ourPubKey);

    for (const intent of merged) this.dbService.savePurchaseIntent(intent);
    return merged;
  }

  async approvePurchase(
    name: string,
    buyerAddr: string,
    passphrase: string,
  ): Promise<{ txHash: string }> {
    const requests = await this.getPurchaseRequests();
    const intent = requests.find(
      i => i.name === name && i.buyerAddr === buyerAddr && i.status === 'pending',
    );
    if (!intent) throw new Error('This purchase request is no longer pending.');
    if (!isValidHnsAddress(intent.buyerAddr)) {
      throw new Error('The buyer address is invalid.');
    }

    // The request price is self-reported by the buyer. Never approve a price
    // below the signed listing price.
    const listings = this.dbService.getMarketplaceListings();
    const listing = listings.find(
      l => l.name === name && l.sellerPubKey === this.nostrService.publicKey,
    );
    if (!listing) {
      throw new Error('Your local listing could not be found. Relist the name and try again.');
    }
    if (listing.status !== 'active') {
      throw new Error('This listing is already in a transfer or is no longer active.');
    }
    if (intent.listingId && listing.listingId && intent.listingId !== listing.listingId) {
      throw new Error('This request is for a different listing.');
    }
    if (intent.price !== listing.price) {
      throw new Error(
        `The request price (${intent.price / 1_000_000} HNS) does not match your listing price (${listing.price / 1_000_000} HNS).`,
      );
    }

    if (intent.escrow) {
      await this.verifyEscrowIntentTerms(intent);
      const funding = await this.verifyEscrowFunding(intent);
      if (!funding.funded) {
        throw new Error('Escrow funding has not been detected yet.');
      }
      if (funding.confirmations < 1) {
        throw new Error('Escrow funding is waiting for confirmation.');
      }
    }

    const tx = await this.walletService.sendTransfer(name, intent.buyerAddr, passphrase);

    intent.status = 'transferred';
    intent.transferTxHash = tx.hash;
    intent.updatedAt = nowIso();
    this.dbService.savePurchaseIntent(intent);
    await this.nostrService.publishPurchaseIntent(intent);

    // Mark the listing pending locally and stop advertising it on relays.
    listing.status = 'pending';
    listing.updatedAt = nowIso();
    this.dbService.saveMarketplaceListing(listing);
    try {
      await this.nostrService.cancelListing(name);
    } catch {
      console.warn('[Marketplace] Failed to cancel listing on Nostr');
    }

    return { txHash: tx.hash };
  }

  async rejectPurchase(name: string, buyerAddr: string): Promise<void> {
    const requests = await this.getPurchaseRequests();
    const matches = requests.filter(
      i => i.name === name && i.buyerAddr === buyerAddr && i.status === 'pending',
    );
    if (matches.length === 0) {
      throw new Error('This purchase request is no longer pending.');
    }

    for (const intent of matches) {
      if (intent.escrow?.fundingTxHash) {
        try {
          const funding = await this.verifyEscrowFunding(intent);
          if (funding.funded) {
            throw new Error(
              'This escrow is already funded. Use the refund or release flow instead of rejecting.',
            );
          }
        } catch (error) {
          if (error instanceof Error && /already funded/i.test(error.message)) {
            throw error;
          }
          // Unverifiable terms cannot have a valid escrow funding output;
          // allow the seller to reject the malformed request.
        }
      }
      intent.status = 'cancelled';
      intent.updatedAt = nowIso();
      this.dbService.savePurchaseIntent(intent);
      await this.nostrService.publishPurchaseIntent(intent);
    }
  }

  /** Remove a purchase request from the local DB (no Nostr publish — just cleanup) */
  dismissPurchaseRequest(name: string, buyerAddr: string): void {
    this.dbService.removePurchaseIntent(name, buyerAddr);
  }

  async transferNameToBuyer(
    name: string,
    buyerAddr: string,
    passphrase: string,
  ): Promise<{ txHash: string }> {
    const tx = await this.walletService.sendTransfer(name, buyerAddr, passphrase);
    try { await this.nostrService.markAsSold(name); } catch { /* ignore */ }
    this.dbService.removeMarketplaceListing(name);
    return { txHash: tx.hash };
  }
}
