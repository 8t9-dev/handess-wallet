/**
 * Node Service
 *
 * Handles blockchain-level queries via hsd's NodeClient.
 * Read-only -- no signing or wallet operations.
 */

import type { HSDConnectionService } from './hsd-connection';
import type { NameLookupResult, BulkSearchResult, SearchSummary } from '../../src/types/search';
import type { DNSRecord, DNSResource } from '../../src/types/domain';
import type { GlobalAuction, GlobalAuctionsScanResult } from '../../src/types/auction';
import { BULK_LOOKUP_CONCURRENCY, NETWORKS } from '../../src/lib/constants';
import { getAuctionSchedule } from '../../src/lib/auction-timing';
import { parseBlockCovenants } from '../../src/lib/hns-block';

interface VerboseBlock {
  height: number;
  hash: string;
  time: number;
  size: number;
  weight: number;
  version: number;
  merkleroot: string;
  merkleRoot: string;
  previousblockhash: string;
  prevBlockHash: string;
  bits: number;
  difficulty: number;
  txs: Array<Record<string, unknown>>;
}

export class NodeService {
  private connectionService: HSDConnectionService;

  constructor(connectionService: HSDConnectionService) {
    this.connectionService = connectionService;
  }

  async getInfo() {
    const { nodeClient } = this.connectionService.getClients();
    return await nodeClient.getInfo();
  }

  async getBlockHeight(): Promise<number> {
    const info = await this.getInfo();
    return info.chain.height;
  }

  async getBlockchainInfo() {
    const { nodeClient } = this.connectionService.getClients();
    return await nodeClient.execute('getblockchaininfo');
  }

  async getNameInfo(name: string): Promise<NameLookupResult> {
    const { nodeClient } = this.connectionService.getClients();
    const raw = await nodeClient.execute('getnameinfo', [name]) as Record<string, unknown> | null;

    // hsd's getnameinfo returns { start: { reserved, week, start }, info: { name, state, height, ... } }
    const info = (raw as Record<string, unknown>)?.info as Record<string, unknown> | null;
    const isReserved = (raw?.start as Record<string, unknown> | undefined)?.reserved === true;

    if (!raw || !info) {
      return {
        name,
        status: isReserved ? 'RESERVED' : 'AVAILABLE',
        owner: null,
        expiryBlock: null,
        expiryDate: null,
        highestBid: null,
        value: null,
        recordCount: 0,
        auctionInfo: null,
        error: null,
      };
    }

    const owner = info.owner as Record<string, unknown> | null;
    const network = this.connectionService.getNetwork();
    const renewalWindow = NETWORKS[network].renewalWindow;

    return {
      name,
      // A reserved name that has already been claimed/registered has info and
      // must show its real state; RESERVED only applies to unclaimed names.
      status: (info.state as string) as NameLookupResult['status'],
      owner: owner?.hash as string | null || null,
      expiryBlock: info.renewal ? (info.renewal as number) + renewalWindow : null,
      expiryDate: null,
      highestBid: typeof info.highest === 'number' ? (info.highest as number) / 1000000 : null,
      value: info.value as number | null,
      recordCount: 0,
      auctionInfo: null,
      error: null,
    };
  }

  async getNameResource(name: string): Promise<DNSResource | null> {
    const { nodeClient } = this.connectionService.getClients();
    try {
      const response = await nodeClient.execute('getnameresource', [name]) as { records?: unknown[] } | null;
      if (!response) return null;
      return { records: (response.records || []) as DNSResource['records'] };
    } catch {
      return null;
    }
  }

  async bulkLookup(names: string[]): Promise<BulkSearchResult> {
    const results: NameLookupResult[] = [];
    const summary: SearchSummary = {
      total: names.length,
      available: 0,
      opening: 0,
      bidding: 0,
      reveal: 0,
      closed: 0,
      ownedByYou: 0,
      reserved: 0,
      expired: 0,
      revoked: 0,
      errors: 0,
    };

    const startTime = Date.now();

    for (let i = 0; i < names.length; i += BULK_LOOKUP_CONCURRENCY) {
      const batch = names.slice(i, i + BULK_LOOKUP_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (name) => {
          try {
            return await this.getNameInfo(name);
          } catch (err) {
            return {
              name,
              status: 'AVAILABLE' as const,
              owner: null,
              expiryBlock: null,
              expiryDate: null,
              highestBid: null,
              value: null,
              recordCount: 0,
              auctionInfo: null,
              error: err instanceof Error ? err.message : 'Lookup failed',
            };
          }
        })
      );

      for (const result of batchResults) {
        results.push(result);
        const status = result.status.toLowerCase();
        if (status in summary) {
          (summary as unknown as Record<string, number>)[status] = (summary as unknown as Record<string, number>)[status] + 1;
        }
        if (result.error) summary.errors++;
      }
    }

    return {
      results,
      summary,
      durationMs: Date.now() - startTime,
      searchedAt: new Date().toISOString(),
    };
  }

  async estimateFee(blocks: number = 6): Promise<number> {
    const { nodeClient } = this.connectionService.getClients();
    const response = await nodeClient.execute('estimatesmartfee', [blocks]) as { fee?: number };
    return response.fee || 0;
  }

  async getTransaction(hash: string) {
    const { nodeClient, walletClient } = this.connectionService.getClients();
    // Try node chain DB first (confirmed transactions)
    try {
      return await nodeClient.getTX(hash);
    } catch {
      // Fallback to wallet TX DB (includes pending/unconfirmed)
      try {
        return await walletClient.getTX(hash);
      } catch {
        throw new Error('Transaction not found.');
      }
    }
  }

  async getBlockByHeight(height: number): Promise<VerboseBlock> {
    const { nodeClient } = this.connectionService.getClients();
    const hash = await nodeClient.execute('getblockhash', [height]);
    return await nodeClient.execute('getblock', [hash, 1]) as VerboseBlock;
  }

  async getRecentBlocks(count: number = 10) {
    const info = await this.getInfo();
    const currentHeight = info.chain.height;
    const blocks: Array<{
      height: number;
      hash: string;
      time: number;
      transactions: number;
      size: number;
      totalFee: number;
    }> = [];
    for (let h = currentHeight; h > Math.max(0, currentHeight - count); h--) {
      const block = await this.getBlockByHeight(h);
      const txs: Array<{ fee?: number }> = block.txs || [];
      const totalFee = txs.reduce((sum: number, tx: { fee?: number }) => sum + (tx.fee || 0), 0);
      blocks.push({
        height: block.height,
        hash: block.hash,
        time: block.time,
        transactions: (block.txs?.length || 0),
        size: block.size || 0,
        totalFee,
      });
    }
    return blocks;
  }

  async getMempoolInfo() {
    const { nodeClient } = this.connectionService.getClients();
    return await nodeClient.execute('getmempoolinfo');
  }

  async getCoinSupply() {
    const { nodeClient } = this.connectionService.getClients();
    const info = await nodeClient.getInfo();
    try {
      const txOutInfo = await nodeClient.execute('gettxoutsetinfo') as {
        total_amount?: number;
        transactions?: number;
        txouts?: number;
      };
      const mempoolInfo = await nodeClient.execute('getmempoolinfo') as { size?: number };
      return {
        blocks: info.chain.height,
        transactions: txOutInfo?.transactions || 0,
        txouts: txOutInfo?.txouts || 0,
        totalSupply: txOutInfo?.total_amount || 0,
        mempoolTxCount: mempoolInfo?.size || 0,
      };
    } catch {
      return {
        blocks: info.chain.height,
        transactions: 0,
        txouts: 0,
        totalSupply: 0,
        mempoolTxCount: 0,
      };
    }
  }

  async getBlockDetails(height: number) {
    const { nodeClient } = this.connectionService.getClients();
    const hash = await nodeClient.execute('getblockhash', [height]);
    const block = await nodeClient.execute('getblock', [hash, 1]) as VerboseBlock;

    const rawTxs = (block.txs || []) as Array<Record<string, unknown>>;
    const txs = rawTxs.map((tx) => {
      const inputs = (tx.inputs || []) as Array<Record<string, unknown>>;
      const outputs = (tx.outputs || []) as Array<Record<string, unknown>>;
      return {
        hash: String(tx.hash || ''),
        version: Number(tx.version || 1) as number,
        size: Number(tx.size || 0),
        fee: Number(tx.fee || 0),
        inputs: inputs.map(i => ({
          coinbase: i.coinbase as string | undefined,
          prevout: i.prevout as { hash: string; index: number } | undefined,
          address: i.address as string | null,
          sequence: Number(i.sequence || 0),
          covenant: i.covenant as { action: string } | undefined,
        })),
        outputs: outputs.map(o => ({
          value: Number(o.value || 0),
          address: String(o.address || ''),
        })),
        locktime: Number(tx.locktime || 0),
      };
    });

    const totalFee = txs.reduce((sum: number, tx: { fee: number }) => sum + (tx.fee || 0), 0);

    let nextBlockHash: string | null = null;
    try {
      const nextHash = await nodeClient.execute('getblockhash', [height + 1]);
      nextBlockHash = nextHash as string;
    } catch { /* tip of chain */ }

    return {
      hash: block.hash,
      height: block.height,
      version: block.version,
      time: block.time,
      size: block.size || 0,
      weight: block.weight || 0,
      merkleRoot: block.merkleroot || block.merkleRoot || '',
      previousBlockHash: block.previousblockhash || block.prevBlockHash || '',
      nextBlockHash,
      bits: block.bits || 0,
      difficulty: block.difficulty || 0,
      totalFee,
      txs,
    };
  }

  /**
   * Fetch actual timestamps for a set of block heights. Used by the explorer
   * so historical events show real dates instead of estimates from the tip.
   */
  async getBlockTimes(heights: number[]): Promise<Record<number, number>> {
    const { nodeClient } = this.connectionService.getClients();
    const currentHeight = await this.getBlockHeight();
    const unique = [...new Set(
      heights.filter((height) => Number.isInteger(height) && height > 0 && height <= currentHeight),
    )];
    const times: Record<number, number> = {};
    const batchSize = 10;

    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      await Promise.all(batch.map(async (height) => {
        try {
          const block = await nodeClient.execute(
            'getblockbyheight',
            [height, true, false],
          ) as { time?: number };
          if (typeof block?.time === 'number') times[height] = block.time;
        } catch {
          // Unknown/pruned height: callers fall back to an estimate.
        }
      }));
    }

    return times;
  }

  async getTreeUpdateInfo(height: number): Promise<{ nextBlock: number; blocksAway: number; estimatedMinutes: number }> {
    const network = this.connectionService.getNetwork();
    const interval = NETWORKS[network].treeInterval;
    const nextBlock = Math.ceil(height / interval) * interval;
    const blocksAway = nextBlock - height;
    const estimatedMinutes = blocksAway * NETWORKS[network].blockTimeMinutes;
    return { nextBlock, blocksAway, estimatedMinutes };
  }

  async getAddressInfo(address: string) {
    const { nodeClient } = this.connectionService.getClients();
    const [balanceResult, txCountResult, namesResult] = await Promise.all([
      nodeClient.execute('getaddressbalance', [[address]]).catch(() => null),
      nodeClient.execute('getaddresstxcount', [[address]]).catch(() => null),
      nodeClient.execute('getnamebyaddress', [address]).catch(() => null),
    ]);
    const balance = balanceResult as { confirmed?: number; unconfirmed?: number } | null;
    const txCount = txCountResult as { total?: number } | null;
    const names = namesResult as string[] | null;
    return {
      address,
      balance: balance ? (balance.confirmed || 0) / 1_000_000 : 0,
      unconfirmed: balance ? (balance.unconfirmed || 0) / 1_000_000 : 0,
      txCount: txCount?.total || 0,
      names: names || [],
    };
  }

  /**
   * Scan the latest blocks for name covenant operations and return
   * currently-active auctions (BIDDING / REVEAL state).
   *
   * Works by extracting name hashes from covenant items in block
   * transactions, then calling getnameinfo(hash) — hsd accepts
   * 64-char hex hashes as input to getnameinfo, bypassing the
   * name-to-hash grinding step.
   */
  async getNameDetail(name: string) {
    const { nodeClient } = this.connectionService.getClients();

    // hsd's getnameinfo returns { start: { reserved, week, start }, info: { name, state, height, ... } }
    const raw = await nodeClient.execute('getnameinfo', [name]) as Record<string, unknown> | null;

    // Get resource records. Keep the full type-specific fields (TXT chunks,
    // DS key tag/algorithm/digest, glue addresses) for the explorer.
    let records: DNSRecord[] = [];
    try {
      const resource = await nodeClient.execute(
        'getnameresource',
        [name],
      ) as { records?: DNSRecord[] } | null;
      records = resource?.records || [];
    } catch { /* no resource records */ }

    const info = (raw as Record<string, unknown>)?.info as Record<string, unknown> | null;
    const state = (info?.state as string) || 'AVAILABLE';
    const network = this.connectionService.getNetwork();
    const claimed = Number(info?.claimed) || 0;

    // hsd's NameState.height is the OPEN height for auction names (and the
    // claim height for claimed names). It does NOT move with each phase, so
    // never subtract phase offsets from it.
    const rawHeight = Number(info?.height) || 0;
    const openHeight = claimed > 0 || state === 'LOCKED' ? 0 : rawHeight;
    const schedule = openHeight > 0 ? getAuctionSchedule(openHeight, network) : null;

    const now = await this.getBlockHeight();
    const stats = (info?.stats as Record<string, number> | undefined) || null;
    const statBlocks = (key: string): number | null => {
      const value = stats?.[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };

    let nextPhaseBlock = 0;
    let blocksUntilNext: number | null = null;
    if (state === 'OPENING') {
      nextPhaseBlock = schedule?.biddingStart ?? 0;
      blocksUntilNext = statBlocks('blocksUntilBidding')
        ?? (nextPhaseBlock > 0 ? Math.max(0, nextPhaseBlock - now) : null);
    } else if (state === 'BIDDING') {
      nextPhaseBlock = schedule?.biddingEnd ?? 0;
      blocksUntilNext = statBlocks('blocksUntilReveal')
        ?? (nextPhaseBlock > 0 ? Math.max(0, nextPhaseBlock - now) : null);
    } else if (state === 'REVEAL') {
      nextPhaseBlock = schedule?.revealEnd ?? 0;
      blocksUntilNext = statBlocks('blocksUntilClose')
        ?? (nextPhaseBlock > 0 ? Math.max(0, nextPhaseBlock - now) : null);
    }

    const ownerRaw = info?.owner as Record<string, unknown> | null;
    const renewalBlock = (info?.renewal as number) || 0;
    const renewalWindow = NETWORKS[network].renewalWindow;

    return {
      name,
      unicodeName: name,
      nameHash: ((raw as Record<string, unknown>)?.start as Record<string, unknown> | undefined)?.nameHash as string || (info?.nameHash as string) || '',
      state,
      owner: ownerRaw?.hash as string | null || null,
      value: (info?.value as number) || 0,
      highest: (info?.highest as number) || 0,
      openHeight,
      biddingStart: schedule?.biddingStart ?? 0,
      revealStart: schedule?.revealStart ?? 0,
      auctionClose: schedule?.auctionClose ?? 0,
      nextPhaseBlock,
      blocksUntilNext,
      // Backward-compatible field used by older components.
      closeBlock: nextPhaseBlock,
      blocksUntil: blocksUntilNext ?? 0,
      renewal: renewalBlock || null,
      expiryBlock: renewalBlock ? renewalBlock + renewalWindow : null,
      claim: claimed || null,
      lockupEnd: claimed ? claimed + NETWORKS[network].lockupPeriod : null,
      revoked: (info?.revoked as number) || null,
      transfer: (info?.transfer as number) || null,
      renewals: (info?.renewals as number) || 0,
      reserved: ((raw as Record<string, unknown>)?.start as Record<string, unknown> | undefined)?.reserved === true,
      stats,
      records,
    };
  }

  /**
   * Scan recent blocks for covenant data and return currently-active
   * auctions (BIDDING / REVEAL state).
   *
   * Scans the last ~2500 blocks, which covers the full lifespan of
   * any active auction (OPENING=37 + BIDDING=720 + REVEAL=1440 blocks).
   * Processes blocks in parallel batches, deduplicates name hashes,
   * then resolves each hash to full name state info.
   */
  async scanGlobalAuctions(): Promise<GlobalAuctionsScanResult> {
    const { nodeClient } = this.connectionService.getClients();
    const info = await nodeClient.getInfo();
    const currentHeight = Number(info.chain?.height ?? info.blocks ?? 0);
    const network = this.connectionService.getNetwork();
    const net = NETWORKS[network];

    if (currentHeight <= 0) {
      throw new Error('Cannot scan auctions: chain height is unavailable.');
    }

    // Only names currently in BIDDING are eligible. Such a name must have been
    // opened within the last OPENING + BIDDING window, so there is no reason to
    // scan the reveal portion at all.
    const scanDepth = net.openPeriod + net.biddingPeriod + 64;
    const scannedFrom = Math.max(1, currentHeight - scanDepth + 1);
    const scannedTo = currentHeight;

    const openHeights = new Map<string, number>();
    const openNames = new Map<string, string>();
    const bidCounts = new Map<string, number>();
    const revealCounts = new Map<string, number>();
    const highestLockups = new Map<string, number>();
    const batchSize = 20;

    for (let h = scannedTo; h >= scannedFrom; h -= batchSize) {
      const heights: number[] = [];
      for (let i = 0; i < batchSize && h - i >= scannedFrom; i++) {
        heights.push(h - i);
      }

      // Raw blocks are much faster to transfer than verbose JSON. Parse only
      // the covenant outputs locally; see src/lib/hns-block.ts.
      const blocks = await Promise.all(heights.map(async (height) => {
        try {
          const raw = await nodeClient.execute(
            'getblockbyheight',
            [height, false],
          ) as string;
          return parseBlockCovenants(raw);
        } catch {
          return null;
        }
      }));

      for (let i = 0; i < blocks.length; i++) {
        const covenants = blocks[i];
        if (!covenants) continue;
        const blockHeight = heights[i];

        for (const covenant of covenants) {
          const normalized = covenant.hash.toLowerCase();

          if (covenant.action === 'OPEN') {
            const previous = openHeights.get(normalized);
            if (previous == null || blockHeight < previous) {
              openHeights.set(normalized, blockHeight);
            }
            if (covenant.name) openNames.set(normalized, covenant.name);
          } else if (covenant.action === 'BID') {
            bidCounts.set(normalized, (bidCounts.get(normalized) || 0) + 1);
            if (covenant.value > 0) {
              highestLockups.set(
                normalized,
                Math.max(highestLockups.get(normalized) || 0, covenant.value),
              );
            }
          } else if (covenant.action === 'REVEAL') {
            revealCounts.set(normalized, (revealCounts.get(normalized) || 0) + 1);
          }
        }
      }
    }

    // OPEN embeds the name in its covenant, so resolving the whole candidate
    // set through getnameinfo is unnecessary. Fall back to getnamebyhash only
    // for unusual OPEN covenants that do not include the raw name.
    const missingNames = [...openHeights.keys()].filter((hash) => !openNames.get(hash));
    const resolveBatch = 20;
    for (let i = 0; i < missingNames.length; i += resolveBatch) {
      const batch = missingNames.slice(i, i + resolveBatch);
      const names = await Promise.all(batch.map(async (hash) => {
        try {
          const name = await nodeClient.execute('getnamebyhash', [hash]);
          return typeof name === 'string' ? name : null;
        } catch {
          return null;
        }
      }));
      names.forEach((name, index) => {
        if (name) openNames.set(batch[index], name);
      });
    }

    const auctions: GlobalAuction[] = [];
    for (const [hash, openHeight] of openHeights) {
      const name = openNames.get(hash);
      if (!name || openHeight <= 0) continue;

      const schedule = getAuctionSchedule(openHeight, network);

      // Bids are only accepted during BIDDING. Exclude OPENING (not yet
      // bid-able) and REVEAL (bidding has ended), even if they are still
      // active auctions.
      if (currentHeight < schedule.biddingStart || currentHeight >= schedule.biddingEnd) {
        continue;
      }

      const blocksUntilNext = schedule.biddingEnd - currentHeight;
      auctions.push({
        name,
        state: 'BIDDING',
        openHeight,
        biddingStart: schedule.biddingStart,
        revealStart: schedule.revealStart,
        closeBlock: schedule.revealEnd,
        blocksUntilNext: Math.max(0, blocksUntilNext),
        blocksUntilClose: Math.max(0, schedule.revealEnd - currentHeight),
        bidCount: bidCounts.get(hash) || 0,
        revealCount: revealCounts.get(hash) || 0,
        highestLockup: highestLockups.get(hash) || 0,
        highestRevealedBid: 0,
      });
    }

    const byName = (a: GlobalAuction, b: GlobalAuction) => a.name.localeCompare(b.name);
    const byBiddingEnd = [...auctions].sort((a, b) => (
      a.blocksUntilNext - b.blocksUntilNext || byName(a, b)
    ));
    const withBids = auctions.filter((auction) => auction.bidCount > 0);
    const top = 1000;

    return {
      endingSoon: byBiddingEnd.slice(0, top),
      mostBids: [...withBids]
        .sort((a, b) => b.bidCount - a.bidCount || byName(a, b))
        .slice(0, top),
      fewestBids: [...withBids]
        .sort((a, b) => a.bidCount - b.bidCount || byName(a, b))
        .slice(0, top),
      highestBids: [...withBids]
        .sort((a, b) => b.highestLockup - a.highestLockup || byName(a, b))
        .slice(0, top),
      lowestBids: [...withBids]
        .sort((a, b) => a.highestLockup - b.highestLockup || byName(a, b))
        .slice(0, top),
      totalActive: auctions.length,
      totalWithBids: withBids.length,
      currentHeight,
      scannedFrom,
      scannedTo,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Verify a signed message against a Handshake name.
   * Calls hsd node RPC: verifymessagewithname(name, signature, message).
   * For SPV mode, falls back to: verifymessage(address, signature, message)
   * after resolving the owner's address from the name's UTXO.
   */
  async verifyMessageWithName(name: string, signature: string, message: string): Promise<boolean> {
    const { nodeClient } = this.connectionService.getClients();
    try {
      const result = await nodeClient.execute('verifymessagewithname', [name, signature, message]);
      return Boolean(result);
    } catch {
      // SPV fallback: resolve owner address, then use verifymessage
      try {
        const nameInfo = await nodeClient.execute('getnameinfo', [name]) as Record<string, unknown> | null;
        const vInfo = nameInfo?.info as Record<string, unknown> | null;
        const owner = vInfo?.owner as Record<string, unknown> | null;
        if (!owner || !owner.hash) throw new Error('Cannot find the name owner.');
        const coin = await nodeClient.execute('getcoin', [owner.hash, owner.index]) as Record<string, unknown> | null;
        if (!coin?.address) throw new Error('Cannot find the owner address.');
        const result = await nodeClient.execute('verifymessage', [coin.address, signature, message]);
        return Boolean(result);
      } catch {
        return false;
      }
    }
  }
}
