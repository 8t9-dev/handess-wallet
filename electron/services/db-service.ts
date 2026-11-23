/**
 * Database Service
 *
 * Manages the local persistent data for CRM-specific metadata.
 * Uses electron-store (JSON-based) instead of SQLite to avoid native compilation.
 */

import Store from 'electron-store';
import { app } from 'electron';
import type { Tag } from '../../src/types/domain';
import type { SearchSummary } from '../../src/types/search';
import type { MarketplaceListing } from '../../src/types/marketplace';
import type { PurchaseIntent } from '../../src/types/marketplace';
import type { BidReceipt } from '../../src/types/auction';
import type { HsdAdvancedConfig, HSDConnectionConfig } from '../../src/types/wallet';
import type { LocalSwap, SwapOffer, DgbServerConfig } from '../../src/types/swap';
import {
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  isEncryptedSecret,
  isEncryptionAvailable,
} from './secret-crypto';

interface StoreSchema {
  tags: Tag[];
  domainTags: Record<string, number[]>;
  watchlist: Array<{ name: string; notes: string; notifyOn: string; addedAt: string }>;
  searchHistory: Array<{
    id: number;
    queryNames: string[];
    resultSummary: SearchSummary;
    searchedAt: string;
  }>;
  batchLog: Array<{
    id: number;
    operation: string;
    names: string[];
    totalChunks: number;
    completedChunks: number;
    status: string;
    txHashes: string[];
    startedAt: string;
    completedAt: string | null;
  }>;
  nameCache: Record<string, {
    state: string;
    owner: string | null;
    expiryBlock: number | null;
    renewalBlock: number | null;
    value: number | null;
    highestBid: number | null;
    dnsRecords: unknown[];
    lastUpdated: string;
  }>;
  settings: Record<string, string>;
  nextSearchId: number;
  nextBatchId: number;
  hsdDataDir: string;
  hsdBinaryPath: string;
  hsdApiKey: string;
  /** safeStorage-encrypted JSON of the last explicit connection settings. */
  savedConnectionConfig: string;
  marketplaceListings: MarketplaceListing[];
  purchaseIntents: PurchaseIntent[];
  knownWallets: string[];
  nostrPrivateKey: string;
  nostrRelays: string[];
  /** safeStorage-encrypted JSON (`enc:v1:`) or a legacy plaintext object. */
  bidReceipts: string;
  hsdAdvancedConfig: Record<string, unknown>;
  /** safeStorage-encrypted JSON (`enc:v1:`) or a legacy plaintext array. */
  activeSwaps: string;
  mySwapOffers: SwapOffer[];
  dgbServerConfig: DgbServerConfig | null;
  dgbSeed: string;
  dgbDerivedAddress: string;
  revealedNames: string[];
  openedHidden: string[];
  justRedeemed: string[];
  /** Locally-pending auction opens: name → epoch ms (pruned after 24h). */
  justOpened: Record<string, number>;
}

export class DBService {
  private store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'crm-data',
      cwd: app.getPath('userData'),
      defaults: {
        tags: [],
        domainTags: {},
        watchlist: [],
        searchHistory: [],
        batchLog: [],
        nameCache: {},
        settings: {},
        nextSearchId: 1,
        nextBatchId: 1,
        hsdDataDir: '',
        hsdBinaryPath: '',
        hsdApiKey: '',
        savedConnectionConfig: '',
        marketplaceListings: [],
        purchaseIntents: [],
        knownWallets: [],
        nostrPrivateKey: '',
        nostrRelays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social'],
        bidReceipts: '',
        hsdAdvancedConfig: {},
        activeSwaps: '',
        mySwapOffers: [],
        dgbServerConfig: null,
        dgbSeed: '',
        dgbDerivedAddress: '',
        revealedNames: [],
        openedHidden: [],
        justRedeemed: [],
        justOpened: {},
      },
    });

    this.migrateSecrets();
  }

  /**
   * Encrypt secrets written by older versions of the app.
   * Idempotent: already-encrypted values are left untouched.
   */
  private migrateSecrets(): void {
    if (!isEncryptionAvailable()) {
      console.warn('[DB] safeStorage is unavailable; secrets remain unencrypted at rest.');
      return;
    }

    for (const key of ['nostrPrivateKey', 'dgbSeed', 'hsdApiKey'] as const) {
      const value = this.store.get(key, '');
      if (value && !isEncryptedSecret(value)) {
        this.store.set(key, encryptSecret(value));
      }
    }

    // Bid receipts used to be stored as a plain object; encrypt the whole map.
    const receipts = this.store.get('bidReceipts') as unknown;
    if (receipts && typeof receipts === 'object') {
      this.store.set('bidReceipts', encryptJson(receipts));
    } else if (typeof receipts === 'string' && receipts && !isEncryptedSecret(receipts)) {
      try {
        JSON.parse(receipts);
        this.store.set('bidReceipts', encryptSecret(receipts));
      } catch {
        // Leave malformed legacy data for the accessors to ignore.
      }
    }

    // Swap records can contain the HTLC preimage, so encrypt them as well.
    const swaps = this.store.get('activeSwaps') as unknown;
    if (Array.isArray(swaps)) {
      this.store.set('activeSwaps', encryptJson(swaps));
    }
  }

  getDataDir(): string {
    return app.getPath('userData');
  }

  // Tags
  getTags(): Tag[] {
    return this.store.get('tags', []);
  }

  createTag(name: string, color: string): Tag {
    const tags = this.getTags();
    const id = tags.length > 0 ? Math.max(...tags.map(t => t.id)) + 1 : 1;
    const tag: Tag = { id, name, color };
    this.store.set('tags', [...tags, tag]);
    return tag;
  }

  updateTag(id: number, name: string, color: string): Tag | null {
    const tags = this.getTags();
    const index = tags.findIndex(t => t.id === id);
    if (index === -1) return null;
    tags[index] = { id, name, color };
    this.store.set('tags', tags);
    return tags[index];
  }

  deleteTag(id: number): void {
    const tags = this.getTags().filter(t => t.id !== id);
    this.store.set('tags', tags);
    const domainTags = this.store.get('domainTags', {});
    for (const domain of Object.keys(domainTags)) {
      domainTags[domain] = domainTags[domain].filter(tid => tid !== id);
    }
    this.store.set('domainTags', domainTags);
  }

  assignTag(domainName: string, tagId: number): void {
    const domainTags = this.store.get('domainTags', {});
    if (!domainTags[domainName]) domainTags[domainName] = [];
    if (!domainTags[domainName].includes(tagId)) domainTags[domainName].push(tagId);
    this.store.set('domainTags', domainTags);
  }

  removeTag(domainName: string, tagId: number): void {
    const domainTags = this.store.get('domainTags', {});
    if (domainTags[domainName]) {
      domainTags[domainName] = domainTags[domainName].filter(tid => tid !== tagId);
      this.store.set('domainTags', domainTags);
    }
  }

  getTagsForDomain(domainName: string): Tag[] {
    const domainTags = this.store.get('domainTags', {});
    const tagIds = domainTags[domainName] || [];
    return this.getTags().filter(t => tagIds.includes(t.id));
  }

  getDomainsForTag(tagId: number): string[] {
    const domainTags = this.store.get('domainTags', {});
    return Object.entries(domainTags)
      .filter(([, ids]) => (ids as number[]).includes(tagId))
      .map(([domain]) => domain);
  }

  // Watchlist
  addToWatchlist(name: string, notes?: string, notifyOn?: string): void {
    const watchlist = this.store.get('watchlist', []);
    const existing = watchlist.findIndex(w => w.name === name);
    const entry = { name, notes: notes || '', notifyOn: notifyOn || 'none', addedAt: new Date().toISOString() };
    if (existing >= 0) watchlist[existing] = entry;
    else watchlist.push(entry);
    this.store.set('watchlist', watchlist);
  }

  removeFromWatchlist(name: string): void {
    this.store.set('watchlist', this.store.get('watchlist', []).filter(w => w.name !== name));
  }

  getWatchlist(): Array<{ name: string; notes: string; notifyOn: string; addedAt: string }> {
    return this.store.get('watchlist', []);
  }

  updateWatchlistNotifyOn(name: string, notifyOn: string): void {
    const watchlist = this.store.get('watchlist', []);
    const idx = watchlist.findIndex(w => w.name === name);
    if (idx >= 0) {
      watchlist[idx].notifyOn = notifyOn;
      this.store.set('watchlist', watchlist);
    }
  }

  // Search History
  saveSearchHistory(names: string[], summary: SearchSummary): void {
    const history = this.store.get('searchHistory', []);
    const id = this.store.get('nextSearchId', 1);
    history.unshift({ id, queryNames: names, resultSummary: summary, searchedAt: new Date().toISOString() });
    this.store.set('searchHistory', history.slice(0, 100));
    this.store.set('nextSearchId', id + 1);
  }

  getSearchHistory() {
    return this.store.get('searchHistory', []);
  }

  // Batch Log
  logBatchOperation(operation: string, names: string[], totalChunks: number): number {
    const batchLog = this.store.get('batchLog', []);
    const id = this.store.get('nextBatchId', 1);
    batchLog.unshift({
      id, operation, names, totalChunks, completedChunks: 0,
      status: 'pending', txHashes: [], startedAt: new Date().toISOString(), completedAt: null,
    });
    this.store.set('batchLog', batchLog);
    this.store.set('nextBatchId', id + 1);
    return id;
  }

  updateBatchLog(id: number, completedChunks: number, status: string, txHashes: string[]): void {
    const batchLog = this.store.get('batchLog', []);
    const entry = batchLog.find(b => b.id === id);
    if (entry) {
      entry.completedChunks = completedChunks;
      entry.status = status;
      entry.txHashes = txHashes;
      if (status === 'completed' || status === 'failed') entry.completedAt = new Date().toISOString();
      this.store.set('batchLog', batchLog);
    }
  }

  getBatchHistory() {
    return this.store.get('batchLog', []);
  }

  // Settings
  getSetting(key: string): string | null {
    return this.store.get('settings', {})[key] || null;
  }

  setSetting(key: string, value: string): void {
    const settings = this.store.get('settings', {});
    settings[key] = value;
    this.store.set('settings', settings);
  }

  getAllSettings(): Record<string, string> {
    return this.store.get('settings', {});
  }

  // Name Cache
  cacheName(name: string, data: { state: string; owner: string | null; expiryBlock: number | null; renewalBlock: number | null; value: number | null; highestBid: number | null; dnsRecords: unknown[] }): void {
    const cache = this.store.get('nameCache', {});
    cache[name] = { ...data, lastUpdated: new Date().toISOString() };
    this.store.set('nameCache', cache);
  }

  getCachedName(name: string) {
    return this.store.get('nameCache', {})[name] || null;
  }

  clearExpiredCache(): void {
    const cache = this.store.get('nameCache', {});
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const cleaned: typeof cache = {};
    for (const [name, entry] of Object.entries(cache)) {
      if (entry.lastUpdated > oneHourAgo) cleaned[name] = entry;
    }
    this.store.set('nameCache', cleaned);
  }

  // Marketplace Listings
  getMarketplaceListings(): MarketplaceListing[] {
    return this.store.get('marketplaceListings', []);
  }

  saveMarketplaceListing(listing: MarketplaceListing): void {
    const listings = this.getMarketplaceListings();
    const idx = listings.findIndex(l => l.name === listing.name);
    if (idx >= 0) listings[idx] = listing;
    else listings.push(listing);
    this.store.set('marketplaceListings', listings);
  }

  removeMarketplaceListing(name: string): void {
    this.store.set('marketplaceListings', this.getMarketplaceListings().filter(l => l.name !== name));
  }

  // Purchase Intents
  getPurchaseIntents(): PurchaseIntent[] {
    return this.store.get('purchaseIntents', []);
  }

  savePurchaseIntent(intent: PurchaseIntent): void {
    const intents = this.getPurchaseIntents();
    const idx = intents.findIndex((i) => {
      if (intent.intentId && i.intentId) return i.intentId === intent.intentId;
      return i.name === intent.name && i.buyerAddr === intent.buyerAddr;
    });
    if (idx >= 0) intents[idx] = intent;
    else intents.push(intent);
    this.store.set('purchaseIntents', intents);
  }

  removePurchaseIntent(name: string, buyerAddr: string): void {
    this.store.set('purchaseIntents', this.getPurchaseIntents().filter(i => !(i.name === name && i.buyerAddr === buyerAddr)));
  }

  // Listing verification cache
  getListingVerification(name: string): boolean | undefined {
    const cache = this.store.get('listingVerifications', {}) as Record<string, boolean>;
    return cache[name];
  }

  setListingVerification(name: string, verified: boolean): void {
    const cache = this.store.get('listingVerifications', {}) as Record<string, boolean>;
    cache[name] = verified;
    this.store.set('listingVerifications', cache);
  }

  // Known Wallets (local tracking for login dropdown)
  getKnownWallets(): string[] {
    return this.store.get('knownWallets', []);
  }

  addKnownWallet(walletId: string): void {
    const wallets = this.getKnownWallets();
    if (!wallets.includes(walletId)) {
      wallets.push(walletId);
      this.store.set('knownWallets', wallets);
    }
  }

  removeKnownWallet(walletId: string): void {
    this.store.set('knownWallets', this.getKnownWallets().filter(w => w !== walletId));
  }

  // HSD Settings
  getHsdDataDir(): string {
    return this.store.get('hsdDataDir', '');
  }

  setHsdDataDir(dir: string): void {
    this.store.set('hsdDataDir', dir);
  }

  getHsdBinaryPath(): string {
    return this.store.get('hsdBinaryPath', '');
  }

  setHsdBinaryPath(path: string): void {
    this.store.set('hsdBinaryPath', path);
  }

  getHsdApiKey(): string {
    return decryptSecret(this.store.get('hsdApiKey', ''), 'hsd API key');
  }

  setHsdApiKey(key: string): void {
    this.store.set('hsdApiKey', encryptSecret(key));
  }

  // Saved connection settings (encrypted, replaces the old localStorage copy)
  getSavedConnectionConfig(): HSDConnectionConfig | null {
    const raw = this.store.get('savedConnectionConfig', '');
    if (!raw) return null;
    return decryptJson<HSDConnectionConfig | null>(raw, null, 'saved connection config');
  }

  setSavedConnectionConfig(config: HSDConnectionConfig): void {
    this.store.set('savedConnectionConfig', encryptJson(config));
  }

  // Nostr Keypair
  getNostrPrivateKey(): string {
    return decryptSecret(this.store.get('nostrPrivateKey', ''), 'Nostr private key');
  }

  setNostrPrivateKey(key: string): void {
    this.store.set('nostrPrivateKey', encryptSecret(key));
  }

  getNostrRelays(): string[] {
    const relays = this.store.get('nostrRelays', DEFAULT_RELAYS) as string[];
    return relays.length > 0 ? relays : DEFAULT_RELAYS;
  }

  setNostrRelays(relays: string[]): void {
    this.store.set('nostrRelays', relays);
  }

  // Bid Receipts
  private readBidReceipts(): Record<string, BidReceipt> {
    const raw = this.store.get('bidReceipts', '') as unknown;
    if (!raw) return {};
    // Legacy object written before safeStorage migration.
    if (typeof raw === 'object') return raw as Record<string, BidReceipt>;
    if (typeof raw !== 'string') return {};
    return decryptJson<Record<string, BidReceipt>>(raw, {}, 'bid receipts');
  }

  private writeBidReceipts(receipts: Record<string, BidReceipt>): void {
    this.store.set('bidReceipts', encryptJson(receipts));
  }

  saveBidReceipt(name: string, receipt: BidReceipt): void {
    const receipts = this.readBidReceipts();
    receipts[name] = receipt;
    this.writeBidReceipts(receipts);
  }

  getBidReceipt(name: string): BidReceipt | null {
    return this.readBidReceipts()[name] || null;
  }

  removeBidReceipt(name: string): void {
    const receipts = this.readBidReceipts();
    delete receipts[name];
    this.writeBidReceipts(receipts);
  }

  getAllBidReceipts(): Record<string, BidReceipt> {
    return this.readBidReceipts();
  }

  // Advanced HSD Configuration
  getHsdAdvancedConfig(): HsdAdvancedConfig {
    return this.store.get('hsdAdvancedConfig', {}) as HsdAdvancedConfig;
  }

  setHsdAdvancedConfig(config: HsdAdvancedConfig): void {
    // Remove undefined values so store stays clean
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(config)) {
      if (val !== undefined && val !== null) {
        clean[key] = val;
      }
    }
    this.store.set('hsdAdvancedConfig', clean);
  }

  // ============================================================
  // Swap Storage
  // ============================================================

  getActiveSwaps(): LocalSwap[] {
    const raw = this.store.get('activeSwaps', '') as unknown;
    if (!raw) return [];
    // Legacy plaintext array written before safeStorage migration.
    if (Array.isArray(raw)) return raw as LocalSwap[];
    if (typeof raw !== 'string') return [];
    return decryptJson<LocalSwap[]>(raw, [], 'active swaps');
  }

  private writeActiveSwaps(swaps: LocalSwap[]): void {
    this.store.set('activeSwaps', encryptJson(swaps));
  }

  saveSwap(swap: LocalSwap): void {
    const swaps = this.getActiveSwaps();
    const idx = swaps.findIndex(s => s.id === swap.id);
    if (idx >= 0) swaps[idx] = swap;
    else swaps.push(swap);
    this.writeActiveSwaps(swaps);
  }

  removeSwap(swapId: string): void {
    this.writeActiveSwaps(this.getActiveSwaps().filter(s => s.id !== swapId));
  }

  getMySwapOffers(): SwapOffer[] {
    return this.store.get('mySwapOffers', []);
  }

  saveMySwapOffer(offer: SwapOffer): void {
    const offers = this.getMySwapOffers();
    const idx = offers.findIndex(o => o.id === offer.id);
    if (idx >= 0) offers[idx] = offer;
    else offers.push(offer);
    this.store.set('mySwapOffers', offers);
  }

  removeMySwapOffer(offerId: string): void {
    this.store.set('mySwapOffers', this.getMySwapOffers().filter(o => o.id !== offerId));
  }

  // ============================================================
  // DGB Settings
  // ============================================================

  private readonly DEAD_DGB_HOSTS = [
    'electrum1.digibyte.host',
    'electrum2.digibyte.host',
    'dgb-cn1.electrum.digibyte.io',
  ];

  private readonly DEFAULT_DGB_CONFIG: DgbServerConfig = {
    host: 'electrum1.cipig.net',
    port: 10059,
    ssl: false,
    network: 'mainnet',
  };

  getDgbServerConfig(): DgbServerConfig | null {
    const config = this.store.get('dgbServerConfig', null) as DgbServerConfig | null;
    if (config && this.DEAD_DGB_HOSTS.includes(config.host)) {
      this.store.set('dgbServerConfig', this.DEFAULT_DGB_CONFIG);
      return { ...this.DEFAULT_DGB_CONFIG };
    }
    return config;
  }

  setDgbServerConfig(config: DgbServerConfig): void {
    this.store.set('dgbServerConfig', config);
  }

  getDgbSeed(): string {
    return decryptSecret(this.store.get('dgbSeed', ''), 'DGB seed');
  }

  setDgbSeed(seed: string): void {
    this.store.set('dgbSeed', encryptSecret(seed));
  }

  getDgbDerivedAddress(): string {
    return this.store.get('dgbDerivedAddress', '');
  }

  setDgbDerivedAddress(address: string): void {
    this.store.set('dgbDerivedAddress', address);
  }

  // ============================================================
  // Revealed Names (persisted across restarts to prevent stale
  // "Reveal Bid" buttons when wallet RPC lags)
  // ============================================================

  getRevealedNames(): string[] {
    return this.store.get('revealedNames', []);
  }

  addRevealedName(name: string): void {
    const names = this.getRevealedNames();
    if (!names.includes(name)) {
      names.push(name);
      this.store.set('revealedNames', names);
    }
  }

  removeRevealedName(name: string): void {
    this.store.set('revealedNames', this.getRevealedNames().filter(n => n !== name));
  }

  setRevealedNames(names: string[]): void {
    this.store.set('revealedNames', names);
  }

  // ============================================================
  // Opened Hidden Names (persistent "dismiss" list for the
  // Opened tab on the Auctions page)
  // ============================================================

  getOpenedHidden(): string[] {
    return this.store.get('openedHidden', []);
  }

  addOpenedHidden(name: string): void {
    const names = this.getOpenedHidden();
    if (!names.includes(name)) {
      names.push(name);
      this.store.set('openedHidden', names);
    }
  }

  removeOpenedHidden(name: string): void {
    this.store.set('openedHidden', this.getOpenedHidden().filter(n => n !== name));
  }

  // ============================================================
  // Just Redeemed Names (persisted across restarts — similar to
  // justRevealed, prevents stale "Redeem HNS" button after a
  // successful redeem before hsd syncs the redeemed flag)
  // ============================================================

  getJustRedeemed(): string[] {
    return this.store.get('justRedeemed', []);
  }

  addJustRedeemed(name: string): void {
    const names = this.getJustRedeemed();
    if (!names.includes(name)) {
      names.push(name);
      this.store.set('justRedeemed', names);
    }
  }

  removeJustRedeemed(name: string): void {
    this.store.set('justRedeemed', this.getJustRedeemed().filter(n => n !== name));
  }

  setJustRedeemed(names: string[]): void {
    this.store.set('justRedeemed', names);
  }

  // ============================================================
  // Just Registered Names (persisted across restarts — covers
  // the gap between successful register TX and hsd syncing
  // the name into wallet's owned names list)
  // ============================================================

  getJustRegistered(): string[] {
    return this.store.get('justRegistered', []);
  }

  addJustRegistered(name: string): void {
    const names = this.getJustRegistered();
    if (!names.includes(name)) {
      names.push(name);
      this.store.set('justRegistered', names);
    }
  }

  removeJustRegistered(name: string): void {
    this.store.set('justRegistered', this.getJustRegistered().filter(n => n !== name));
  }

  setJustRegistered(names: string[]): void {
    this.store.set('justRegistered', names);
  }

  // ============================================================
  // Just Opened Names (pending opens not yet indexed in history)
  // ============================================================

  /**
   * Names opened locally in the last 24 hours that may not have appeared in
   * wallet history yet. Stale entries are pruned lazily.
   */
  getJustOpened(): string[] {
    const map = this.store.get('justOpened', {}) || {};
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const fresh: Record<string, number> = {};
    let pruned = false;

    for (const [name, timestamp] of Object.entries(map)) {
      if (typeof timestamp === 'number' && timestamp >= cutoff) {
        fresh[name] = timestamp;
      } else {
        pruned = true;
      }
    }

    if (pruned) this.store.set('justOpened', fresh);
    return Object.keys(fresh);
  }

  addJustOpened(name: string): void {
    const map = this.store.get('justOpened', {}) || {};
    map[name] = Date.now();
    this.store.set('justOpened', map);
  }

  removeJustOpened(name: string): void {
    const map = this.store.get('justOpened', {}) || {};
    if (Object.prototype.hasOwnProperty.call(map, name)) {
      delete map[name];
      this.store.set('justOpened', map);
    }
  }
}

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social'];
