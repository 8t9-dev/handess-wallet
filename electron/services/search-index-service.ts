/**
 * Handshake TLD search index service.
 *
 * Loads a bundled NDJSON snapshot, serves filtered searches, and merges live
 * name/resource data from the connected hsd node. The index is intentionally
 * separate from the wallet database and never contains keys or balances.
 */

import { sha3_256 } from '@noble/hashes/sha3.js';
import { createReadStream, createWriteStream, existsSync, mkdirSync, promises as fs } from 'fs';
import { dirname } from 'path';
import { createGunzip, createGzip } from 'zlib';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as readline from 'readline';
import { EventEmitter } from 'events';
import type { HSDConnectionService } from './hsd-connection';
import type { DNSRecord } from '../../src/types/domain';
import { parseBlockCovenants } from '../../src/lib/hns-block';
import {
  DEFAULT_SEARCH_REFRESH_BLOCKS,
  normalizeSearchRefreshBlocks,
} from '../../src/lib/search-refresh';
import type {
  HnsIndexProgress,
  HnsIndexRecord,
  HnsIndexRefreshResult,
  HnsIndexSearchQuery,
  HnsIndexSearchResponse,
  HnsIndexSource,
  HnsIndexStatus,
} from '../../src/types/search-engine';
import {
  buildTagCounts,
  compareIndexRecords,
  INDEX_VERSION,
  parseIndexRecord,
  searchIndexRecords,
  summarizeDnsRecords,
  topTags,
} from '../../src/lib/hns-index';

const RENEWAL_WINDOW = 105120;
const LOAD_PROGRESS_EVERY = 50000;
const SCAN_BATCH_SIZE = 20;
const RESOLVE_BATCH_SIZE = 10;
/**
 * Upper bound on record changes kept in memory for one refresh. Reaching this
 * is treated as an error rather than silently returning a partial directory.
 */
const MAX_REFRESH_CHANGES = 250_000;

interface IndexHeader {
  version: number;
  network: string;
  height: number | null;
  generatedAt: string | null;
}

interface IndexFile {
  header: IndexHeader;
  records: Map<string, HnsIndexRecord>;
}

interface OverlayFile {
  header: Partial<IndexHeader> | null;
  entries: Map<string, HnsIndexRecord | null>;
}

interface RefreshChange {
  action: 'resolve' | 'remove';
  height: number;
}

export interface SearchIndexServiceOptions {
  /** Bundled seed file (gzip NDJSON). */
  seedPath: string;
  /** Per-user index built from live node data (gzip NDJSON). */
  userIndexPath: string;
}

/** Handshake name hash: SHA3-256 of the lowercase/punycode name. */
function hashName(name: string): string {
  return Buffer.from(sha3_256(Buffer.from(name, 'utf8'))).toString('hex');
}

export class SearchIndexService extends EventEmitter {
  private connectionService: HSDConnectionService;
  private options: SearchIndexServiceOptions;
  private records = new Map<string, HnsIndexRecord>();
  /** Refreshed names layered on top of the bundled seed (null = deleted). */
  private overrides = new Map<string, HnsIndexRecord | null>();
  private orderedByName: HnsIndexRecord[] | null = null;
  private orderedByExpiry: HnsIndexRecord[] | null = null;
  private tagCounts = new Map<string, number>();
  private header: IndexHeader = {
    version: INDEX_VERSION,
    network: 'main',
    height: null,
    generatedAt: null,
  };
  private source: HnsIndexSource = 'none';
  private hasSeedFile = false;
  private loaded = false;
  private loading = false;
  private loadPromise: Promise<void> | null = null;
  private refreshing = false;
  private refreshCancelled = false;
  private progress: HnsIndexProgress | null = null;
  private error: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(connectionService: HSDConnectionService, options: SearchIndexServiceOptions) {
    super();
    this.connectionService = connectionService;
    this.options = options;
  }

  /** Load the user index if present, otherwise the bundled seed. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loading = true;
    this.error = null;
    this.progress = {
      phase: 'loading',
      scanned: 0,
      total: null,
      matched: 0,
      message: 'Loading the TLD directory...',
    };
    this.emitProgress();

    this.loadPromise = (async () => {
      try {
        let hasSeed = false;
        this.records = new Map();
        this.header = {
          version: INDEX_VERSION,
          network: 'main',
          height: null,
          generatedAt: null,
        };
        this.source = 'none';

        if (existsSync(this.options.seedPath)) {
          try {
            const file = await this.readIndexFile(this.options.seedPath);
            this.records = file.records;
            this.header = file.header;
            this.source = 'bundled-seed';
            hasSeed = true;
          } catch (err) {
            console.warn('[SearchIndex] Bundled seed could not be read:', err);
            this.error = 'The bundled TLD directory could not be read. Refresh from your node to rebuild it.';
          }
        }

        // The user index is an overlay: only refreshed names (and tombstones)
        // are stored, so future bundled seeds still take effect.
        if (existsSync(this.options.userIndexPath)) {
          try {
            const overlay = await this.readOverlayFile(this.options.userIndexPath);
            this.applyOverlay(overlay.entries);
            // Keep the entries so later saves preserve refreshed names and
            // tombstones instead of dropping them.
            this.overrides = overlay.entries;

            // Restore the last completed bulk refresh height so the UI does
            // not fall back to the seed height after every restart.
            const sameNetwork = !overlay.header?.network
              || !this.header.network
              || overlay.header.network === this.header.network;
            if (
              sameNetwork
              && typeof overlay.header?.height === 'number'
              && overlay.header.height >= (this.header.height ?? 0)
            ) {
              this.header = {
                ...this.header,
                height: overlay.header.height,
                generatedAt: overlay.header.generatedAt ?? this.header.generatedAt,
              };
            }

            if (overlay.entries.size > 0 || typeof overlay.header?.height === 'number') {
              this.source = hasSeed ? 'bundled-seed+node' : 'node';
            }
          } catch (err) {
            console.warn('[SearchIndex] User index could not be loaded; ignoring it:', err);
          }
        }

        this.hasSeedFile = hasSeed;
        this.invalidateOrder();
        this.rebuildTags();

        if (!hasSeed && this.records.size === 0) {
          this.error = 'No TLD index is available. Refresh from your node to build one.';
        }
      } finally {
        this.loaded = true;
        this.loading = false;
        this.progress = null;
        this.loadPromise = null;
        this.emitProgress();
      }
    })();

    return this.loadPromise;
  }

  async getStatus(): Promise<HnsIndexStatus> {
    await this.ensureLoaded();
    return this.statusSnapshot();
  }

  async search(query: HnsIndexSearchQuery): Promise<HnsIndexSearchResponse> {
    await this.ensureLoaded();
    const sort = query.sort === 'expiry' ? 'expiry' : 'name';
    const result = searchIndexRecords(this.getOrderedRecords(sort), query, { ordered: true });
    return {
      ...result,
      status: this.statusSnapshot(),
    };
  }

  /** Re-fetch a single name from the node and merge it into the index. */
  async refreshName(name: string): Promise<HnsIndexRecord | null> {
    await this.ensureLoaded();
    const normalized = name.trim().toLowerCase().replace(/\.+$/, '');
    if (!normalized) throw new Error('Name is required.');

    const { nodeClient } = this.connectionService.getClients();
    const raw = await nodeClient.execute('getnameinfo', [normalized]) as Record<string, unknown> | null;
    const info = raw?.info as Record<string, unknown> | null;
    if (!info) {
      this.records.delete(normalized);
      // Remember the removal so the bundled seed does not resurrect it.
      this.overrides.set(normalized, null);
      this.invalidateOrder();
      this.rebuildTags();
      this.scheduleSave();
      this.emitProgress();
      return null;
    }

    // A name with no resource data returns null; a thrown RPC error must not be
    // mistaken for "no records", or a transient failure would tombstone it.
    const resource = await nodeClient.execute(
      'getnameresource',
      [normalized],
    ) as { records?: DNSRecord[] } | null;
    const records = resource?.records || [];

    const record = this.toIndexRecord(normalized, info, records);
    if (record) this.records.set(normalized, record);
    else this.records.delete(normalized);
    this.overrides.set(normalized, record);

    this.source = this.hasSeedFile ? 'bundled-seed+node' : 'node';
    // A single-name lookup does not cover the whole directory, so it must not
    // advance the bulk refresh height.
    this.invalidateOrder();
    this.rebuildTags();
    this.scheduleSave();
    this.emitProgress();
    return record;
  }

  /** Request cancellation of the running bulk refresh. */
  async cancelRefresh(): Promise<boolean> {
    if (!this.refreshing) return false;
    this.refreshCancelled = true;
    if (this.progress) {
      this.setProgress({ ...this.progress, message: 'Cancelling refresh...' });
    }
    return true;
  }

  /**
   * Scan a configurable block range for resource-record changes.
   *
   * Raw blocks are parsed locally so large ranges do not require verbose JSON.
   * REGISTER/UPDATE covenants embed the new resource data: a length of 0–1
   * means the name has no records, while longer data is resolved through RPC.
   * RENEW only advances expiry and is handled from the hash without RPC;
   * FINALIZE/TRANSFER do not change DNS data and are ignored.
   */
  async refreshRecent(blockCount = DEFAULT_SEARCH_REFRESH_BLOCKS): Promise<HnsIndexRefreshResult> {
    await this.ensureLoaded();
    if (this.refreshing) throw new Error('A TLD index refresh is already running.');

    this.refreshing = true;
    this.refreshCancelled = false;
    this.error = null;
    const { nodeClient } = this.connectionService.getClients();
    let updated = 0;
    let removed = 0;
    let scannedBlocks = 0;
    let fromHeight = 0;
    let toHeight = 0;
    let cancelled = false;

    try {
      const info = await nodeClient.getInfo();
      const tipHeight = info.chain.height;
      const depth = normalizeSearchRefreshBlocks(blockCount);
      const startHeight = Math.max(1, tipHeight - depth + 1);
      const totalBlocks = tipHeight - startHeight + 1;
      fromHeight = startHeight;
      toHeight = tipHeight;

      // Map the current directory to on-chain name hashes. Renewals can then
      // update expiry locally, and resolved names can reuse their known name.
      const hashToName = new Map<string, string>();
      for (const name of this.records.keys()) {
        hashToName.set(hashName(name), name);
      }
      const isIndexed = (hash: string) => hashToName.has(hash);

      // Final action per name within the scanned range. The scan is ascending,
      // so a later covenant overwrites an earlier one.
      const changes = new Map<string, RefreshChange>();
      const renewals = new Map<string, number>();
      let failedBlocks = 0;
      let truncated = false;

      this.setProgress({
        phase: 'scanning',
        scanned: 0,
        total: totalBlocks,
        matched: 0,
        message: `Scanning blocks ${startHeight.toLocaleString()}–${tipHeight.toLocaleString()}...`,
      });

      for (let height = startHeight; height <= tipHeight; height += SCAN_BATCH_SIZE) {
        if (this.refreshCancelled) {
          cancelled = true;
          break;
        }

        const heights: number[] = [];
        for (let i = 0; i < SCAN_BATCH_SIZE && height + i <= tipHeight; i++) {
          heights.push(height + i);
        }

        const blocks = await Promise.all(heights.map(async (h) => {
          try {
            const raw = await nodeClient.execute('getblockbyheight', [h, false]) as string;
            return parseBlockCovenants(raw);
          } catch {
            return null;
          }
        }));

        for (let i = 0; i < blocks.length; i++) {
          const covenants = blocks[i];
          if (!covenants) {
            failedBlocks++;
            continue;
          }
          const blockHeight = heights[i];

          for (const covenant of covenants) {
            const hash = covenant.hash.toLowerCase();

            switch (covenant.action) {
              case 'REGISTER':
              case 'UPDATE': {
                const hasRecords = (covenant.resourceSize ?? 0) > 1;
                if (hasRecords) {
                  changes.set(hash, { action: 'resolve', height: blockHeight });
                } else if (isIndexed(hash) || changes.has(hash)) {
                  // Empty resource data clears records. Ignore names that have
                  // never been in the directory.
                  changes.set(hash, { action: 'remove', height: blockHeight });
                }
                break;
              }
              case 'REVOKE':
                if (isIndexed(hash) || changes.has(hash)) {
                  changes.set(hash, { action: 'remove', height: blockHeight });
                }
                break;
              case 'RENEW':
                if (isIndexed(hash) && !changes.has(hash)) {
                  const previous = renewals.get(hash) ?? 0;
                  if (blockHeight > previous) renewals.set(hash, blockHeight);
                }
                break;
              default:
                // OPEN/BID/REVEAL/REDEEM, TRANSFER, and FINALIZE do not change
                // the resource records stored for a name.
                break;
            }
          }
        }

        scannedBlocks += heights.length;
        this.setProgress({
          phase: 'scanning',
          scanned: scannedBlocks,
          total: totalBlocks,
          matched: changes.size + renewals.size,
          message: `Scanning blocks: ${Math.min(100, Math.round((scannedBlocks / totalBlocks) * 100))}% (${scannedBlocks.toLocaleString()} / ${totalBlocks.toLocaleString()})`,
        });

        if (changes.size > MAX_REFRESH_CHANGES) {
          truncated = true;
          break;
        }
      }

      if (!cancelled && failedBlocks > 0) {
        throw new Error(
          `Could not read ${failedBlocks.toLocaleString()} block${failedBlocks === 1 ? '' : 's'} in the selected range. Try again or choose a smaller scan depth.`,
        );
      }

      if (truncated) {
        throw new Error(
          `This range contains more than ${MAX_REFRESH_CHANGES.toLocaleString()} record changes. Choose a smaller scan depth.`,
        );
      }

      // A cancelled scan has not covered the selected range; discard its
      // partial set rather than applying a misleading half-refresh.
      if (!cancelled) {
        // The resolve RPC returns the latest renewal too, so renewal-only
        // entries are redundant for names with a record change.
        for (const hash of changes.keys()) renewals.delete(hash);

        const resolveHashes = [...changes.entries()]
          .filter(([, change]) => change.action === 'resolve')
          .map(([hash]) => hash);
        const removeHashes = [...changes.entries()]
          .filter(([, change]) => change.action === 'remove')
          .map(([hash]) => hash);

        // Removals and resolves are disjoint because `changes` keeps only the
        // final action for each name. Apply clears first.
        for (const hash of removeHashes) {
          const name = hashToName.get(hash);
          if (!name) continue;
          if (this.records.delete(name)) removed++;
          this.overrides.set(name, null);
          hashToName.delete(hash);
        }

        this.setProgress({
          phase: 'resolving',
          scanned: 0,
          total: resolveHashes.length,
          matched: 0,
          message: `Resolving ${resolveHashes.length.toLocaleString()} updated names...`,
        });

        for (let i = 0; i < resolveHashes.length; i += RESOLVE_BATCH_SIZE) {
          if (this.refreshCancelled) {
            cancelled = true;
            break;
          }

          const batch = resolveHashes.slice(i, i + RESOLVE_BATCH_SIZE);
          const results = await Promise.all(batch.map(async (hash) => {
            try {
              const name = hashToName.get(hash)
                ?? await nodeClient.execute('getnamebyhash', [hash]) as string | null;
              if (!name || typeof name !== 'string') return null;

              const raw = await nodeClient.execute('getnameinfo', [name]) as Record<string, unknown> | null;
              const nameInfo = raw?.info as Record<string, unknown> | null;
              if (!nameInfo) return { hash, name: name.toLowerCase(), record: null };

              const resource = await nodeClient.execute(
                'getnameresource',
                [name],
              ) as { records?: DNSRecord[] } | null;

              return {
                hash,
                name: name.toLowerCase(),
                record: this.toIndexRecord(name, nameInfo, resource?.records || []),
              };
            } catch {
              // Keep the existing entry on transient RPC errors.
              return null;
            }
          }));

          for (const result of results) {
            if (!result) continue;
            const wasIndexed = hashToName.has(result.hash);

            // New names only enter the curated directory when they have tags
            // or custom DNS. Plain TXT-only bulk registrations are skipped.
            if (result.record && !wasIndexed && !this.shouldAddNewName(result.record)) {
              continue;
            }

            if (result.record) {
              this.records.set(result.name, result.record);
              this.overrides.set(result.name, result.record);
              hashToName.set(result.hash, result.name);
              updated++;
            } else {
              if (this.records.delete(result.name)) removed++;
              // Tombstone so a name removed on-chain does not reappear from the
              // bundled snapshot on the next launch.
              this.overrides.set(result.name, null);
              hashToName.delete(result.hash);
            }
          }

          this.setProgress({
            phase: 'resolving',
            scanned: Math.min(i + RESOLVE_BATCH_SIZE, resolveHashes.length),
            total: resolveHashes.length,
            matched: updated,
            message: `Resolving updated names: ${Math.min(100, Math.round(((i + RESOLVE_BATCH_SIZE) / Math.max(1, resolveHashes.length)) * 100))}%`,
          });
        }

        // Renewal-only updates are cheap: match the covenant hash against the
        // current directory and advance expiry locally.
        if (!cancelled && renewals.size > 0) {
          for (const [hash, renewalHeight] of renewals) {
            const name = hashToName.get(hash);
            if (!name) continue;
            const existing = this.records.get(name);
            if (!existing) continue;
            if (renewalHeight <= (existing.renewal ?? 0)) continue;
            const next = {
              ...existing,
              renewal: renewalHeight,
              expiryBlock: renewalHeight + RENEWAL_WINDOW,
            };
            this.records.set(name, next);
            this.overrides.set(name, next);
            updated++;
          }
        }
      }

      if (!cancelled) {
        this.source = this.hasSeedFile ? 'bundled-seed+node' : 'node';
        this.header = {
          version: INDEX_VERSION,
          network: this.header.network || 'main',
          height: tipHeight,
          generatedAt: new Date().toISOString(),
        };
      }

      this.invalidateOrder();
      this.rebuildTags();
      this.setProgress({
        phase: 'saving',
        scanned: updated + removed,
        total: updated + removed,
        matched: updated,
        message: 'Saving the refreshed TLD directory...',
      });
      await this.saveNow();

      return {
        scanned: changes.size + renewals.size,
        scannedBlocks,
        fromHeight,
        toHeight,
        updated,
        removed,
        blockHeight: this.header.height ?? tipHeight,
        cancelled,
        status: this.statusSnapshot(),
      };
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.refreshing = false;
      this.refreshCancelled = false;
      this.progress = null;
      this.emitProgress();
    }
  }

  /** Flush any pending debounced save. */
  async flush(): Promise<void> {
    const pending = this.saveTimer;
    if (pending) {
      clearTimeout(pending);
      this.saveTimer = null;
      await this.saveNow();
    }
    await this.savePromise;
  }

  private statusSnapshot(): HnsIndexStatus {
    return {
      ready: this.loaded,
      loading: this.loading,
      source: this.source,
      nameCount: this.records.size,
      tagCount: this.tagCounts.size,
      generatedAt: this.header.generatedAt,
      blockHeight: this.header.height,
      topTags: topTags(this.tagCounts, 20),
      refreshing: this.refreshing,
      progress: this.progress,
      error: this.error,
    };
  }

  private applyOverlay(entries: Map<string, HnsIndexRecord | null>): void {
    for (const [name, record] of entries) {
      if (record) this.records.set(name, record);
      else this.records.delete(name);
    }
  }

  private invalidateOrder(): void {
    this.orderedByName = null;
    this.orderedByExpiry = null;
  }

  /** Lazily cache the two sort orders so searches never re-sort the index. */
  private getOrderedRecords(sort: 'name' | 'expiry'): HnsIndexRecord[] {
    if (sort === 'expiry') {
      if (!this.orderedByExpiry) {
        this.orderedByExpiry = [...this.records.values()]
          .sort((a, b) => compareIndexRecords(a, b, 'expiry'));
      }
      return this.orderedByExpiry;
    }

    if (!this.orderedByName) {
      this.orderedByName = [...this.records.values()]
        .sort((a, b) => compareIndexRecords(a, b, 'name'));
    }
    return this.orderedByName;
  }

  private rebuildTags(): void {
    this.tagCounts = buildTagCounts(this.records.values());
  }

  private toIndexRecord(
    name: string,
    info: Record<string, unknown>,
    records: DNSRecord[],
  ): HnsIndexRecord | null {
    if (!Array.isArray(records) || records.length === 0) return null;

    const summary = summarizeDnsRecords(records);
    const renewal = typeof info.renewal === 'number' && info.renewal > 0
      ? info.renewal
      : null;
    const state = typeof info.state === 'string' ? info.state : 'CLOSED';

    // Only current registrations can resolve. Auction and revoked names may
    // still carry stale resource data, which should not appear in the index.
    if (state !== 'CLOSED' && state !== 'TRANSFER' && state !== 'LOCKED') {
      return null;
    }

    return {
      name: name.trim().toLowerCase(),
      state,
      renewal,
      expiryBlock: renewal ? renewal + RENEWAL_WINDOW : null,
      ...summary,
    };
  }

  /**
   * Keep new names out of the directory unless they are tagged or publish
   * custom DNS. Bulk registrations with only a plain TXT record are skipped;
   * the bundled seed uses the same quality-first policy.
   */
  private shouldAddNewName(record: HnsIndexRecord): boolean {
    if (record.tags.length > 0) return true;
    return record.recordTypes.some((type) => type !== 'TXT');
  }

  private setProgress(progress: HnsIndexProgress): void {
    this.progress = progress;
    this.emitProgress();
  }

  private emitProgress(): void {
    this.emit('progress', this.statusSnapshot());
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow().catch((err) => {
        console.warn('[SearchIndex] Could not save index:', err);
      });
    }, 2000);
  }

  /**
   * Persist only the user-specific overlay (refreshed names and tombstones).
   * Writing the whole index here would freeze an old copy of the bundled seed
   * on disk and hide future seed updates.
   */
  private async saveNow(): Promise<void> {
    if (!this.loaded) return;

    const target = this.options.userIndexPath;
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.tmp`;
    const header = {
      type: 'header',
      version: INDEX_VERSION,
      network: this.header.network || 'main',
      height: this.header.height,
      generatedAt: this.header.generatedAt,
    };
    const entries = [...this.overrides.entries()];

    const write = async (): Promise<void> => {
      const lines = async function* (
        values: Array<[string, HnsIndexRecord | null]>,
      ): AsyncGenerator<string> {
        yield `${JSON.stringify(header)}\n`;
        for (const [name, record] of values) {
          yield `${JSON.stringify(record ?? { name, deleted: true })}\n`;
        }
      };
      await pipeline(
        Readable.from(lines(entries)),
        createGzip({ level: 9 }),
        createWriteStream(temp),
      );
      await fs.rename(temp, target);
    };

    this.savePromise = this.savePromise.then(write, write);
    await this.savePromise;
  }

  /** Read the per-user overlay: refreshed records, tombstones, and header. */
  private async readOverlayFile(filePath: string): Promise<OverlayFile> {
    const source = createReadStream(filePath);
    const decompressed = filePath.toLowerCase().endsWith('.gz')
      ? source.pipe(createGunzip())
      : source;
    const reader = readline.createInterface({ input: decompressed, crlfDelay: Infinity });
    const entries = new Map<string, HnsIndexRecord | null>();
    let header: Partial<IndexHeader> | null = null;

    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        const value = parsed as Record<string, unknown>;
        if (value.type === 'header') {
          if (typeof value.version === 'number' && value.version !== INDEX_VERSION) {
            throw new Error(`Unsupported TLD index version ${value.version}.`);
          }
          header = {
            version: INDEX_VERSION,
            network: typeof value.network === 'string' ? value.network : undefined,
            height: typeof value.height === 'number' ? value.height : undefined,
            generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
          };
          continue;
        }

        if (value.deleted === true) {
          const name = typeof value.name === 'string' ? value.name.trim().toLowerCase() : '';
          if (name) entries.set(name, null);
          continue;
        }

        const record = parseIndexRecord(parsed);
        if (record) entries.set(record.name, record);
      }
    } finally {
      reader.close();
    }

    return { header, entries };
  }

  private async readIndexFile(filePath: string): Promise<IndexFile> {
    const source = createReadStream(filePath);
    const decompressed = filePath.toLowerCase().endsWith('.gz')
      ? source.pipe(createGunzip())
      : source;
    const reader = readline.createInterface({ input: decompressed, crlfDelay: Infinity });

    const records = new Map<string, HnsIndexRecord>();
    let header: IndexHeader | null = null;
    let scanned = 0;

    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (!header) {
          const value = parsed as Record<string, unknown>;
          if (value.type === 'header') {
            header = {
              version: typeof value.version === 'number' ? value.version : 0,
              network: typeof value.network === 'string' ? value.network : 'main',
              height: typeof value.height === 'number' ? value.height : null,
              generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : null,
            };
            if (header.version !== INDEX_VERSION) {
              throw new Error(`Unsupported TLD index version ${header.version}.`);
            }
            continue;
          }
        }

        const record = parseIndexRecord(parsed);
        if (!record) continue;
        records.set(record.name, record);
        scanned++;

        if (scanned % LOAD_PROGRESS_EVERY === 0) {
          this.progress = {
            phase: 'loading',
            scanned,
            total: null,
            matched: records.size,
            message: `Loading TLD index: ${records.size.toLocaleString()} names...`,
          };
          this.emitProgress();
        }
      }
    } finally {
      reader.close();
    }

    if (!header) {
      // Allow plain NDJSON without a header line for development builds.
      header = {
        version: INDEX_VERSION,
        network: 'main',
        height: null,
        generatedAt: null,
      };
    }

    return { header, records };
  }
}
