import WebSocket from 'ws';
import { getPublicKey, finalizeEvent, verifyEvent, Relay } from 'nostr-tools';
import type { Event, EventTemplate } from 'nostr-tools';
import type { Filter } from 'nostr-tools';
import { randomBytes } from 'crypto';
import type { MarketplaceListing, PurchaseIntent, RelayHealth } from '../../src/types/marketplace';
import { isCanonicalListing, isListingExpired } from '../../src/lib/marketplace-signing';
import { decryptIntentPayload, encryptIntentPayload } from './nostr-intent-crypto';
import {
  signEscrowPsbt as signEscrowPsbtWithKey,
  type EscrowNetwork,
} from './hns-escrow-service';
import type { DBService } from './db-service';

const LISTING_KIND = 38383;
const PURCHASE_KIND = 38384;
const RELAY_TIMEOUT = 8000;

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

interface FetchedEvent<T> {
  value: T;
  eventId: string;
  pubkey: string;
  createdAt: number;
  dTag: string;
}

export interface ReceivedPurchaseIntent {
  intent: PurchaseIntent;
  eventPubkey: string;
  eventId: string;
  createdAt: number;
}

export class NostrMarketplaceService {
  private dbService: DBService;
  private _secretKey: Uint8Array;
  private _publicKey: string;

  constructor(dbService: DBService) {
    this.dbService = dbService;
    const stored = dbService.getNostrPrivateKey();
    if (stored) {
      this._secretKey = hexToBytes(stored);
    } else {
      this._secretKey = randomBytes(32);
      dbService.setNostrPrivateKey(bytesToHex(this._secretKey));
    }
    this._publicKey = getPublicKey(this._secretKey);
  }

  get publicKey(): string { return this._publicKey; }
  get relays(): string[] { return this.dbService.getNostrRelays(); }
  setRelays(relays: string[]): void { this.dbService.setNostrRelays(relays); }

  /** Sign a 2-of-3 escrow PSBT with this install's Nostr key. */
  signEscrowPsbt(psbtBase64: string, network: EscrowNetwork): string {
    return signEscrowPsbtWithKey(
      psbtBase64,
      this._secretKey,
      this._publicKey,
      network,
    );
  }

  private relayOptions(): Parameters<typeof Relay.connect>[1] {
    // nostr-tools' type omits `websocketImplementation` even though the Node
    // implementation accepts it. Keep the cast narrow and explicit.
    return {
      websocketImplementation: WebSocket,
    } as unknown as Parameters<typeof Relay.connect>[1];
  }

  private async connectRelay(url: string): Promise<Relay> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Connection timed out')),
        RELAY_TIMEOUT,
      );
    });

    try {
      return await Promise.race([
        Relay.connect(url, this.relayOptions()),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async withRelay<T>(url: string, fn: (relay: Relay) => Promise<T>): Promise<T | null> {
    try {
      const relay = await this.connectRelay(url);
      try {
        return await fn(relay);
      } finally {
        relay.close();
      }
    } catch (err) {
      console.error(`[Nostr] Relay ${url} error:`, err);
      return null;
    }
  }

  /** Check every configured relay without publishing or subscribing. */
  async testRelays(): Promise<RelayHealth[]> {
    return await Promise.all(this.relays.map(async (url) => {
      try {
        const relay = await this.connectRelay(url);
        relay.close();
        return { url, ok: true };
      } catch (err) {
        return {
          url,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }));
  }

  private async publishEvent(kind: number, content: string, tags: string[][]): Promise<void> {
    const template: EventTemplate = {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    };
    const signed = finalizeEvent(template, this._secretKey);
    const results = await Promise.allSettled(
      this.relays.map(url => this.withRelay(url, relay => relay.publish(signed)))
    );
    const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === null)).length;
    if (failures === this.relays.length) {
      const firstErr = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      throw new Error(`Failed to publish to any relay: ${firstErr?.reason?.message || 'unknown'}`);
    }
  }

  private async fetchEvents<T>(
    kind: number,
    extraTags: Record<string, string[]>,
    parse: (content: string, createdAt: number, pubkey: string) => T | null,
  ): Promise<Array<FetchedEvent<T>>> {
    const filter: Filter = { kinds: [kind], limit: 500, ...extraTags };
    const seen = new Map<string, FetchedEvent<T>>();

    await Promise.allSettled(
      this.relays.map(url => this.withRelay(url, (relay) => {
        return new Promise<void>((resolve) => {
          const sub = relay.subscribe([filter], {
            onevent(event: Record<string, unknown>) {
              // Do not trust a relay to have validated the event signature.
              try {
                if (!verifyEvent(event as unknown as Event)) return;
              } catch {
                return;
              }

              const content = String(event.content || '');
              const createdAt = Number(event.created_at) || 0;
              const pubkey = String(event.pubkey || '');
              const eventId = String(event.id || '');
              if (!pubkey || !eventId) return;

              const parsed = parse(content, createdAt, pubkey);
              if (!parsed) return;

              const tags = (event.tags as string[][]) || [];
              const dTag = tags.find((t: string[]) => t[0] === 'd')?.[1] || '';
              // Nostr addressable events replace per (kind, pubkey, d). Using
              // the pubkey prevents one seller's listing from hiding another's.
              const key = `${pubkey}:${dTag || eventId}`;
              const existing = seen.get(key);
              if (!existing || createdAt > existing.createdAt) {
                seen.set(key, { value: parsed, eventId, pubkey, createdAt, dTag });
              }
            },
            oneose() { sub.close(); resolve(); },
          });
          setTimeout(() => { sub.close(); resolve(); }, RELAY_TIMEOUT);
        });
      }))
    );

    return Array.from(seen.values());
  }

  // === Listing events (kind 38383) ===

  private listingDTag(listing: MarketplaceListing): string {
    return listing.listingId || `${this._publicKey}:${listing.name}`;
  }

  async publishListing(listing: MarketplaceListing): Promise<void> {
    await this.publishEvent(LISTING_KIND, JSON.stringify(listing), [
      ['d', this.listingDTag(listing)],
      ['t', 'hns-marketplace'],
    ]);
  }

  async getListings(): Promise<MarketplaceListing[]> {
    const records = await this.fetchEvents<MarketplaceListing>(
      LISTING_KIND, { '#t': ['hns-marketplace'] },
      (content) => { try { return JSON.parse(content) as MarketplaceListing; } catch { return null; } },
    );

    const listings: MarketplaceListing[] = [];
    for (const record of records) {
      const listing = record.value;
      if (listing.status !== 'active') continue;

      // Legacy listings do not bind the seller's Nostr key into the signed
      // payload. Hiding them is safer than trusting whoever republished them.
      if (!isCanonicalListing(listing)) continue;
      if (listing.sellerPubKey !== record.pubkey) continue;
      if (listing.listingId !== record.dTag) continue;
      if (isListingExpired(listing)) continue;

      listings.push({ ...listing, eventId: record.eventId });
    }
    return listings;
  }

  async cancelListing(name: string): Promise<void> {
    const listing = this.dbService.getMarketplaceListings().find(l => l.name === name);
    if (listing) {
      await this.publishListing({
        ...listing,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    // No local copy: publish a minimal cancellation using our canonical d tag.
    const now = new Date().toISOString();
    await this.publishEvent(LISTING_KIND, JSON.stringify({
      listingId: `${this._publicKey}:${name}`,
      name,
      price: 0,
      sellerAddr: '',
      sellerPubKey: this._publicKey,
      verified: false,
      status: 'cancelled',
      createdAt: now,
      updatedAt: now,
    }), [
      ['d', `${this._publicKey}:${name}`],
      ['t', 'hns-marketplace'],
    ]);
  }

  async markAsPending(name: string): Promise<void> {
    const listing = this.dbService.getMarketplaceListings().find(l => l.name === name);
    if (!listing) return;
    await this.publishListing({ ...listing, status: 'pending', updatedAt: new Date().toISOString() });
  }

  async markAsSold(name: string): Promise<void> {
    const listing = this.dbService.getMarketplaceListings().find(l => l.name === name);
    if (!listing) return;
    await this.publishListing({ ...listing, status: 'sold', updatedAt: new Date().toISOString() });
  }

  // === Purchase intent events (kind 38384) ===

  async publishPurchaseIntent(intent: PurchaseIntent): Promise<void> {
    const participants = Array.from(new Set(
      [intent.sellerPubKey, intent.buyerPubKey].filter((p): p is string => Boolean(p)),
    ));
    if (participants.length === 0) {
      throw new Error('Purchase intent is missing buyer/seller public keys');
    }

    const recipient = this._publicKey === intent.buyerPubKey
      ? intent.sellerPubKey
      : this._publicKey === intent.sellerPubKey
        ? intent.buyerPubKey
        : null;
    if (!recipient) {
      throw new Error('Purchase intent is missing the counterparty public key');
    }

    const dTag = intent.intentId
      || `${intent.buyerPubKey || ''}:${intent.name}:${intent.buyerAddr}`;
    const tags: string[][] = [['d', dTag], ['t', 'hns-purchase'], ['encrypted', 'nip44']];
    for (const pubkey of participants) tags.push(['p', pubkey]);

    const content = encryptIntentPayload(intent, this._secretKey, recipient);
    await this.publishEvent(PURCHASE_KIND, content, tags);
  }

  async getPurchaseIntents(filterPubkey?: string): Promise<ReceivedPurchaseIntent[]> {
    const extraTags: Record<string, string[]> = { '#t': ['hns-purchase'] };
    if (filterPubkey) extraTags['#p'] = [filterPubkey];

    const records = await this.fetchEvents<PurchaseIntent>(
      PURCHASE_KIND, extraTags,
      (content, _createdAt, pubkey) => {
        // Our own outgoing events are encrypted to the counterparty and are
        // not decryptable by us. The local DB is authoritative for our side.
        if (pubkey === this._publicKey) return null;
        return decryptIntentPayload<PurchaseIntent>(content, this._secretKey, pubkey);
      },
    );

    const intents: ReceivedPurchaseIntent[] = [];
    for (const record of records) {
      const intent = record.value;
      if (!intent.intentId || !intent.buyerPubKey || !intent.sellerPubKey) continue;
      if (record.dTag && record.dTag !== intent.intentId) continue;

      // Only the buyer or the seller may publish an intent/status update.
      const isBuyer = record.pubkey === intent.buyerPubKey;
      const isSeller = record.pubkey === intent.sellerPubKey;
      if (!isBuyer && !isSeller) continue;

      // Statuses are role-bound: the buyer owns request/payment/finalize
      // states; the seller owns transfer/reject states. Escrow updates are
      // different: both parties publish PSBT/tx progress, and the on-chain
      // 2-of-3 spend is the authority.
      if (!intent.escrow) {
        if (isBuyer && !['pending', 'paid', 'sold'].includes(intent.status)) continue;
        if (isSeller && !['transferred', 'cancelled'].includes(intent.status)) continue;
      } else {
        const escrowState = intent.escrow.state;
        if (!['created', 'funded', 'disputed', 'released', 'refunded'].includes(escrowState)) {
          continue;
        }
        // Direct payment is never part of an escrow trade.
        if (intent.status === 'paid') continue;
        // Only the seller can report that the name transfer started. The
        // buyer may still publish a transferred status while attaching a
        // refund/dispute PSBT to an existing transfer.
        if (intent.status === 'transferred'
          && !isSeller
          && !(escrowState === 'disputed' && intent.escrow.disputePsbt)) continue;
        // A seller may only mark an escrow sold after an on-chain release,
        // or while proposing a release PSBT (the buyer re-checks the chain
        // before adding its signature).
        if (intent.status === 'sold'
          && isSeller
          && escrowState !== 'released'
          && !intent.escrow.releasePsbt) continue;
        // Once funded, cancellation requires an on-chain refund. The seller
        // can still reject an unfunded request.
        if (intent.status === 'cancelled'
          && escrowState !== 'refunded'
          && !(isSeller && escrowState === 'created')) continue;
      }

      if (filterPubkey
        && intent.buyerPubKey !== filterPubkey
        && intent.sellerPubKey !== filterPubkey) continue;

      intents.push({
        intent,
        eventPubkey: record.pubkey,
        eventId: record.eventId,
        createdAt: record.createdAt,
      });
    }
    return intents;
  }
}
