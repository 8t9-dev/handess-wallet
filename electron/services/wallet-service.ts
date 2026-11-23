/**
 * Wallet Service
 *
 * Handles all wallet operations: name management, bidding, transfers,
 * DNS updates, and transaction history.
 */

import type { HSDConnectionService } from './hsd-connection';
import type { Domain, DNSRecord, DNSResource, TagUpdate, TagUpdateResult } from '../../src/types/domain';
import type { Auction, Bid, OpenedName } from '../../src/types/auction';
import type { WalletInfo, WalletBalance, Transaction, NameSignatureResult } from '../../src/types/wallet';
import {
  extractRawCovenantName,
  getCovenantNameHash,
  sanitizeCovenantName,
} from '../../src/lib/covenant-utils';
import { findOpenedName } from '../../src/lib/opened-names';
import { NETWORKS } from '../../src/lib/constants';
import { getAuctionSchedule } from '../../src/lib/auction-timing';
import { applyTagsToRecords, extractDomainTags, sameTags } from '../../src/lib/domain-tags';

export class WalletService {
  private connectionService: HSDConnectionService;

  /**
   * Per-session cache of history txid → OPEN covenant (or null when the tx
   * has no OPEN output). Confirmed transactions are immutable, so each tx
   * only needs to be inspected once per app session.
   */
  private openedTxCache = new Map<string, OpenedName | null>();

  constructor(connectionService: HSDConnectionService) {
    this.connectionService = connectionService;
  }

  async getInfo(): Promise<WalletInfo> {
    const { walletClient } = this.connectionService.getClients();
    const raw = await walletClient.execute('getwalletinfo') as Record<string, unknown>;
    const walletId = String(raw.walletid || '');
    const until = Number(raw.unlocked_until) || 0;

    // Get encryption status from HTTP API (GET /wallet/:id/master has encrypted flag)
    let encrypted = false;
    if (walletId) {
      try {
        const master = await (walletClient as unknown as { getMaster: (id: string) => Promise<Record<string, unknown>> }).getMaster(walletId);
        encrypted = Boolean(master?.encrypted);
      } catch { /* ignore */ }
    }

    // Get accurate balance with locked fields from HTTP API (GET /wallet/:id/balance)
    // The RPC getwalletinfo does NOT return a locked field, but the HTTP API does.
    let confirmed = 0;
    let unconfirmed = 0;
    let lockedConfirmed = 0;
    let lockedUnconfirmed = 0;
    try {
      const bal = await (walletClient as unknown as { getBalance: (id: string) => Promise<Record<string, unknown>> }).getBalance(walletId);
      if (bal && typeof bal === 'object') {
        const b = bal as Record<string, unknown>;
        confirmed = Number(b.confirmed) || 0;
        unconfirmed = Number(b.unconfirmed) || 0;
        lockedConfirmed = Number(b.lockedConfirmed) || 0;
        lockedUnconfirmed = Number(b.lockedUnconfirmed) || 0;
      }
    } catch {
      // Fallback: RPC returns balance in HNS — convert to dollarydoos
      const balanceVal = typeof raw.balance === 'number' ? raw.balance : 0;
      confirmed = Math.round(balanceVal * 1000000);
      unconfirmed = Math.round((Number(raw.unconfirmed_balance) || balanceVal) * 1000000);
    }

    return {
      id: walletId,
      wid: Number(raw.walletversion) || 0,
      watchOnly: false,
      accountDepth: 1,
      token: '',
      master: { encrypted, until },
      balance: {
        confirmed,
        unconfirmed,
        lockedConfirmed,
        lockedUnconfirmed,
        spendable: confirmed - lockedConfirmed,
      },
      height: Number(raw.height) || 0,
    } as WalletInfo;
  }

  async getBalance(): Promise<WalletBalance> {
    const { walletClient } = this.connectionService.getClients();

    // Get wallet ID for HTTP API calls
    let walletId = 'primary';
    try {
      const info = await walletClient.execute('getwalletinfo') as Record<string, unknown>;
      walletId = String(info.walletid || 'primary');
    } catch { /* use default */ }

    // Primary: HTTP API (GET /wallet/:id/balance) returns confirmed/unconfirmed/lockedConfirmed/lockedUnconfirmed in dollarydoos
    try {
      const bal = await (walletClient as unknown as { getBalance: (id: string) => Promise<Record<string, unknown>> }).getBalance(walletId);
      if (bal && typeof bal === 'object') {
        const b = bal as Record<string, unknown>;
        const confirmed = Number(b.confirmed) || 0;
        const unconfirmed = Number(b.unconfirmed) || 0;
        const lockedConfirmed = Number(b.lockedConfirmed) || 0;
        const lockedUnconfirmed = Number(b.lockedUnconfirmed) || 0;
        return { confirmed, unconfirmed, lockedConfirmed, lockedUnconfirmed, spendable: confirmed - lockedConfirmed };
      }
    } catch (err) {
      console.warn('[WalletService] getBalance HTTP API failed:', err);
    }

    // Fallback 1: getwalletinfo RPC (no locked field, returns HNS numbers)
    try {
      const info = await walletClient.execute('getwalletinfo') as Record<string, unknown>;
      const balanceVal = typeof info.balance === 'number' ? info.balance : 0;
      const confirmed = Math.round(balanceVal * 1000000);
      const unconfirmed = Math.round((Number(info.unconfirmed_balance) || balanceVal) * 1000000);
      return { confirmed, unconfirmed, lockedConfirmed: 0, lockedUnconfirmed: 0, spendable: confirmed };
    } catch (err) {
      console.warn('[WalletService] getwalletinfo RPC failed:', err);
    }

    // Fallback 2: getbalance RPC (single HNS number)
    try {
      const bal = await walletClient.execute('getbalance');
      if (typeof bal === 'number') {
        const confirmed = Math.round(bal * 1000000);
        return { confirmed, unconfirmed: confirmed, lockedConfirmed: 0, lockedUnconfirmed: 0, spendable: confirmed };
      }
    } catch (err) {
      console.warn('[WalletService] getbalance RPC failed:', err);
    }

    return { confirmed: 0, unconfirmed: 0, lockedConfirmed: 0, lockedUnconfirmed: 0, spendable: 0 };
  }

  /**
   * Enumerate wallets via hsd's HTTP API.
   *
   * hsd has no `listwallets` RPC (that method is Bitcoin Core's), and all
   * wallets live inside one LevelDB, so they cannot be discovered from the
   * filesystem. `GET /wallet` is the authoritative list.
   */
  private async fetchWalletIds(): Promise<string[]> {
    const { walletClient } = this.connectionService.getClients();
    try {
      const wallets = await walletClient.getWallets();
      if (Array.isArray(wallets)) {
        return wallets.map(w => String(w)).filter(Boolean).sort();
      }
    } catch (err) {
      console.warn('[WalletService] GET /wallet failed:', err);
    }

    // Legacy fallback for hsd builds that added a listwallets RPC.
    try {
      const wallets = await walletClient.execute('listwallets');
      if (Array.isArray(wallets)) {
        return wallets.map(w => String(w)).filter(Boolean).sort();
      }
      if (wallets && typeof wallets === 'object') {
        return Object.keys(wallets as Record<string, unknown>).sort();
      }
    } catch { /* not supported */ }

    return [];
  }

  async listWallets(): Promise<string[]> {
    return this.fetchWalletIds();
  }

  async getNames(includeResources = false): Promise<Domain[]> {
    const { walletClient, nodeClient } = this.connectionService.getClients();
    const names = await walletClient.execute('getnames', [true]);
    const blockHeight = await nodeClient.getInfo().then(i => i.chain.height);
    const network = this.connectionService.getNetwork();
    const renewalWindow = NETWORKS[network].renewalWindow;
    const blockTimeMinutes = NETWORKS[network].blockTimeMinutes;

    // Filter out names that are in auction states (OPENING, BIDDING, REVEAL).
    // Those belong on the Auctions page, not My Domains.
    // With `own=true`, hsd only returns names where the wallet has an unspent
    // owner coin, so all returned names are owned by definition.
    const AUCTION_STATES = new Set(['OPENING', 'BIDDING', 'REVEAL']);
    const owned = (names as Record<string, unknown>[])
      .filter(n => !AUCTION_STATES.has(n.state as string));

    // Resource records are a separate node lookup. Only My Domains needs them
    // (for TXT tags), so callers such as the Auctions page can skip this.
    const recordsByName = new Map<string, DNSRecord[]>();
    if (includeResources) {
      const concurrency = 8;
      for (let i = 0; i < owned.length; i += concurrency) {
        const batch = owned.slice(i, i + concurrency);
        await Promise.all(batch.map(async (n) => {
          const name = (n.name as string) || '';
          if (!name) return;
          try {
            const resource = await nodeClient.execute(
              'getnameresource',
              [name],
            ) as { records?: DNSRecord[] } | null;
            recordsByName.set(name, resource?.records || []);
          } catch {
            recordsByName.set(name, []);
          }
        }));
      }
    }

    return owned.map((n) => {
      const renewalBlock = (n.renewal as number) || 0;
      const expiryBlock = renewalBlock + renewalWindow;
      const blocksRemaining = expiryBlock - blockHeight;
      const minutesRemaining = blocksRemaining * blockTimeMinutes;
      const expiryDate = blocksRemaining > 0 ? new Date(Date.now() + minutesRemaining * 60000) : null;
      const name = (n.name as string) || '';

      return {
        name,
        nameHash: (n.nameHash as string) || '',
        state: (n.state as string) as Domain['state'],
        height: (n.height as number) || 0,
        renewalBlock,
        expiryBlock,
        expiryDate,
        ownerHash: ((n.owner as Record<string, unknown>)?.hash as string) || '',
        ownerIndex: ((n.owner as Record<string, unknown>)?.index as number) || 0,
        value: (n.value as number) || 0,
        highestBid: (n.highest as number) || 0,
        dnsRecords: recordsByName.get(name) || [],
        transferring: (n.transfer as number) > 0,
        transferBlock: (n.transfer as number) || 0,
        revoked: (n.revoked as boolean) || false,
        renewals: (n.renewals as number) || 0,
        claimed: (n.claimed as number) !== 0,
        weak: (n.weak as boolean) || false,
      };
    });
  }

  async getNameInfo(name: string): Promise<Domain | null> {
    const { walletClient } = this.connectionService.getClients();
    const info = await walletClient.getName(name);
    if (!info) return null;
    return info as Domain;
  }

  async getBids(name?: string): Promise<Bid[]> {
    const { walletClient } = this.connectionService.getClients();

    // Helper: extract revealed status from a bid object returned by hsd.
    // hsd's wallet RPC (getbids) returns { ..., revealed: boolean } on every bid.
    // The HTTP API methods may or may not include this field depending on version.
    const getRevealed = (b: Record<string, unknown>): boolean => {
      if (typeof b.revealed === 'boolean') return b.revealed;
      if (typeof b.revealed === 'number') return b.revealed !== 0;
      // HTTP API: cross-reference with reveals data (fetch once, reuse)
      return false; // safe default — unrevealed until proven otherwise
    };

    const mapBid = (b: Record<string, unknown>): Bid => {
      const prevout = (b.prevout as Record<string, unknown>) || {};
      const revealed = getRevealed(b);
      return {
        name: (b.name as string) || '',
        nameHash: (b.nameHash as string) || '',
        value: revealed ? Number(b.value) : 0,
        lockup: Number(b.lockup) || 0,
        blind: (b.blind as string) || '',
        revealed,
        redeemed: b.redeemed != null && b.redeemed !== false && b.redeemed !== 0,
        txHash: String(prevout.hash || b.hash || b.txHash || ''),
        outIndex: Number(prevout.index ?? b.index ?? b.outIndex ?? 0),
        height: (b.height as number) || 0,
        own: (b.own as boolean) ?? true,
      };
    };

    // Cross-reference helper: build a set of revealed nameHashes (and a
    // ambiguous-name set) for a list of reveals. We prefer nameHash
    // matching — name-based matching is only safe when the wallet has
    // exactly one bid for that name (no prevout ambiguity).
    const buildRevealMatchSets = (reveals: unknown[]) => {
      const revealedHashes = new Set<string>();
      const revealedNames = new Set<string>();
      // Map nameHash/name to the revealed value (the true bid amount from the reveal covenant)
      const revealedValues = new Map<string, number>();
      for (const r of reveals as Record<string, unknown>[]) {
        const h = r.nameHash as string | undefined;
        if (h) {
          revealedHashes.add(h);
          const val = Number(r.value || 0);
          if (val > 0) revealedValues.set(h, val);
        }
        const n = r.name as string | undefined;
        if (n) {
          revealedNames.add(n);
          const val = Number(r.value || 0);
          if (val > 0 && !revealedValues.has(n)) revealedValues.set(n, val);
        }
      }
      return { revealedHashes, revealedNames, revealedValues };
    };

    const isBidRevealed = (
      bid: Bid,
      revealMatch: { revealedHashes: Set<string>; revealedNames: Set<string>; revealedValues: Map<string, number> },
      bidsPerName: Map<string, number>,
    ): boolean => {
      if (bid.revealed) return true;
      if (bid.nameHash && revealMatch.revealedHashes.has(bid.nameHash)) return true;
      if (
        revealMatch.revealedNames.has(bid.name) &&
        (bidsPerName.get(bid.name) || 0) === 1
      ) {
        return true;
      }
      return false;
    };

    // Get the revealed value for a bid from the reveals data.
    // Prefer nameHash lookup, fall back to name lookup.
    const getRevealedValue = (
      bid: Bid,
      revealMatch: { revealedValues: Map<string, number> },
    ): number => {
      if (bid.nameHash && revealMatch.revealedValues.has(bid.nameHash)) {
        return revealMatch.revealedValues.get(bid.nameHash)!;
      }
      if (revealMatch.revealedValues.has(bid.name)) {
        return revealMatch.revealedValues.get(bid.name)!;
      }
      // Fallback: use the bid's own value if non-zero, otherwise lockup
      return bid.value || bid.lockup || 0;
    };

    const bidsPerName = (bids: Bid[]) => {
      const m = new Map<string, number>();
      for (const b of bids) m.set(b.name, (m.get(b.name) || 0) + 1);
      return m;
    };

    // Primary: raw RPC getbids — definitively returns revealed field on every bid.
    try {
      const result = await walletClient.execute('getbids', name ? [name] : []);
      const bids: Record<string, unknown>[] = Array.isArray(result) ? result as Record<string, unknown>[] : [];
      if (bids.length > 0) {
        const mapped = bids.map(mapBid);
        // Cross-reference with getReveals HTTP API to catch cases where
        // the RPC's revealed flag is stale (e.g., wallet DB out of sync).
        // Match by nameHash when both sides provide it; fall back to
        // name-based matching only when the wallet has a single bid for
        // that name (no prevout ambiguity). Only overrides false → true.
        try {
          const reveals = await this.getReveals(name);
          if (reveals && Array.isArray(reveals) && reveals.length > 0) {
            const revealMatch = buildRevealMatchSets(reveals);
            const perName = bidsPerName(mapped);
            if (revealMatch.revealedHashes.size > 0 || revealMatch.revealedNames.size > 0) {
              return mapped.map((b) =>
                isBidRevealed(b, revealMatch, perName)
                  ? { ...b, revealed: true, value: getRevealedValue(b, revealMatch) }
                  : b
              );
            }
          }
        } catch { /* getReveals is best-effort */ }
        return mapped;
      }
    } catch (err) {
      console.warn('[WalletService] getbids RPC failed, trying HTTP API:', err);
    }

    // Fallback: HTTP API (getBids / getBidsByName) — may or may not have revealed.
    try {
      const bids: unknown = name
        ? await walletClient.getBidsByName(name)
        : await walletClient.getBids();
      const bidArr: Record<string, unknown>[] = Array.isArray(bids) ? bids as Record<string, unknown>[] : [];
      if (bidArr.length > 0) {
        // Check if HTTP API returned revealed field
        const allHaveRevealed = bidArr.every(
          b => typeof b.revealed === 'boolean' || typeof b.revealed === 'number'
        );
        if (allHaveRevealed) return bidArr.map(mapBid);
        // If HTTP API is missing revealed, cross-reference with getReveals
        // using the same nameHash-first strategy as the RPC path.
        return this.getReveals(name).then(reveals => {
          const mapped = bidArr.map(mapBid);
          if (!reveals || !Array.isArray(reveals) || reveals.length === 0) {
            return mapped;
          }
          const revealMatch = buildRevealMatchSets(reveals);
          const perName = bidsPerName(mapped);
          return mapped.map((b) => {
            if (isBidRevealed(b, revealMatch, perName)) {
              return { ...b, revealed: true, value: b.lockup || b.value };
            }
            return b;
          });
        }).catch(() => bidArr.map(mapBid));
      }
    } catch (err) {
      console.warn('[WalletService] getBids HTTP API failed:', err);
    }

    return [];
  }

  async getReveals(name?: string): Promise<unknown[]> {
    const { walletClient } = this.connectionService.getClients();
    return name
      ? await walletClient.getRevealsByName(name)
      : await walletClient.getReveals();
  }

  async getAuctions(): Promise<Auction[]> {
    const { walletClient, nodeClient } = this.connectionService.getClients();
    const network = this.connectionService.getNetwork();

    // `hs-client`'s getAuctions() calls the HTTP endpoint
    // GET /wallet/:id/auction, which is not implemented by current hsd and
    // returns null. The RPC `getauctions` works (it is aliased to `getnames`)
    // and returns every name the wallet tracks. Prefer the RPC and keep the
    // HTTP call as a fallback for older hsd builds.
    let auctions: Record<string, unknown>[] | null = null;
    try {
      const rpcAuctions = await walletClient.execute('getauctions', []);
      if (Array.isArray(rpcAuctions)) {
        auctions = rpcAuctions as Record<string, unknown>[];
      }
    } catch { /* fall through to HTTP */ }

    if (!auctions) {
      const httpAuctions = await walletClient.getAuctions().catch(() => null);
      if (Array.isArray(httpAuctions)) {
        auctions = httpAuctions as Record<string, unknown>[];
      }
    }

    // hsd can return null while the wallet is rescanning/starting up. Treat
    // that as "no wallet auctions" instead of throwing on `.map` and blanking
    // every auctions tab in the renderer.
    if (!auctions) {
      console.warn('[wallet:getAuctions] wallet returned no auction list');
      return [];
    }

    const nodeInfo = await nodeClient.getInfo().catch(() => null);
    const currentHeight = nodeInfo?.chain?.height ?? 0;

    // Fetch wallet-owned names once for winner detection
    const ownedNames = new Set<string>();
    try {
      const names = await walletClient.execute('getnames', [true]) as Array<Record<string, unknown>>;
      if (Array.isArray(names)) {
        names.forEach(n => {
          const name = n.name as string;
          if (name) ownedNames.add(name);
        });
      }
    } catch { /* fallback: assume not owned */ }

    return (auctions as Record<string, unknown>[]).map((a) => {
      const rawBids = (a.bids as Array<Record<string, unknown>>) || [];
      const rawReveals = (a.reveals as Array<Record<string, unknown>>) || [];
      const state = a.state as string;

      // Compute hasUnrevealedBids: any bid where value is undefined/null
      const hasUnrevealedBids = rawBids.some(b => {
        const val = b.value;
        return val === undefined || val === null || val === -1;
      });

      // Compute hasUnredeemedBids: any revealed bid that hasn't been redeemed
      const hasUnredeemedBids = rawBids.some(b => {
        const val = b.value;
        const revealed = val !== undefined && val !== null && val !== -1;
        if (!revealed) return false;
        return b.redeemed == null || b.redeemed === false || b.redeemed === 0;
      });

      // isWinner: after CLOSED, check if the wallet owns the name.
      // A revealed bid + CLOSED auction doesn't guarantee a win —
      // the wallet could have revealed and lost. Cross-reference
      // against wallet-owned names for the definitive answer.
      const name = (a.name as string) || '';
      let isWinner: boolean | null = null;
      if (state === 'CLOSED') {
        isWinner = ownedNames.has(name);
      }

      // hsd's NameState.height is already the OPEN block (or claim block for
      // claimed names). Never subtract phase offsets from it.
      const rawHeight = (a.height as number) || 0;
      const claimed = Number(a.claimed) || 0;
      const openHeight = claimed > 0 || state === 'LOCKED' ? 0 : rawHeight;
      const schedule = openHeight > 0 ? getAuctionSchedule(openHeight, network) : null;

      // Highest lockup from wallet-tracked bids (includes other bidders'
      // visible lockup values — the strongest signal available during
      // BIDDING when hsd hides revealed bid values for Vickrey privacy).
      const maxBidLockup = rawBids.reduce<number>((max, b) => {
        const lockup = Number(b.lockup) || 0;
        return lockup > max ? lockup : max;
      }, 0);

      let blocksUntil = 0;
      if (schedule) {
        if (state === 'OPENING') {
          blocksUntil = Math.max(0, schedule.biddingStart - currentHeight);
        } else if (state === 'BIDDING') {
          blocksUntil = Math.max(0, schedule.biddingEnd - currentHeight);
        } else if (state === 'REVEAL') {
          blocksUntil = Math.max(0, schedule.revealEnd - currentHeight);
        }
      }

      return {
        name,
        nameHash: (a.nameHash as string) || '',
        state: state as Auction['state'],
        openHeight,
        biddingStartBlock: schedule?.biddingStart ?? 0,
        revealStartBlock: schedule?.revealStart ?? 0,
        closeBlock: schedule?.auctionClose ?? 0,
        biddingEndDate: null,
        revealEndDate: null,
        bids: rawBids as unknown as Bid[],
        reveals: rawReveals as unknown as Auction['reveals'],
        hasUnrevealedBids,
        hasUnredeemedBids,
        isWinner,
        highest: (a.highest as number) || maxBidLockup || 0,
        blocksUntil,
      };
    });
  }

  async getAuctionInfo(name: string): Promise<Auction | null> {
    const { walletClient } = this.connectionService.getClients();
    const info = await walletClient.getAuctionInfo(name);
    return info as Auction | null;
  }

  /**
   * Apply on-chain tags to several names using one wallet unlock.
   * Existing non-tag TXT records are preserved. Names whose tags already
   * match are skipped so no unnecessary transaction or fee is created.
   */
  async applyTags(updates: TagUpdate[], passphrase: string): Promise<TagUpdateResult[]> {
    const { walletClient, nodeClient } = this.connectionService.getClients();
    const timeout = Math.min(1800, Math.max(300, updates.length * 15));

    return await this.withUnlockedWallet(passphrase, async () => {
      const results: TagUpdateResult[] = [];

      for (const update of updates) {
        const name = update.name.trim().toLowerCase().replace(/\.+$/, '');
        try {
          const resource = await nodeClient.execute(
            'getnameresource',
            [name],
          ) as { records?: DNSRecord[] } | null;
          const currentRecords = resource?.records || [];
          const currentTags = extractDomainTags(currentRecords);

          if (sameTags(currentTags, update.tags)) {
            results.push({ name, success: true, skipped: true });
            continue;
          }

          const records = applyTagsToRecords(currentRecords, update.tags);
          const tx = await walletClient.execute(
            'sendupdate',
            [name, { records }],
          ) as Record<string, unknown>;

          results.push({
            name,
            success: true,
            skipped: false,
            txid: String(tx?.txid || tx?.hash || ''),
          });
        } catch (err) {
          results.push({
            name,
            success: false,
            skipped: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return results;
    }, timeout);
  }

  private async withUnlockedWallet<T>(
    passphrase: string,
    operation: () => Promise<T>,
    timeoutSeconds = 300,
  ): Promise<T> {
    const { walletClient } = this.connectionService.getClients();
    const encrypted = await this.isEncrypted();
    if (encrypted && passphrase) {
      try {
        await walletClient.execute('walletpassphrase', [passphrase, timeoutSeconds]);
        const result = await operation();
        await walletClient.execute('walletlock');
        return result;
      } catch (err) {
        try { await walletClient.execute('walletlock'); } catch { /* ignore */ }
        throw err;
      }
    }
    return await operation();
  }

  async sendOpen(name: string, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return await walletClient.execute('sendopen', [name]);
    }) as Transaction;
  }

  async sendBulkOpen(names: string[], passphrase: string): Promise<{ name: string; hash: string; success: boolean; error?: string }[]> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      const results: { name: string; hash: string; success: boolean; error?: string }[] = [];
      for (const name of names) {
        try {
          const result = await walletClient.execute('sendopen', [name]) as Record<string, unknown>;
          results.push({ name, hash: String(result.txid || result.hash || ''), success: true });
        } catch (err) {
          results.push({ name, hash: '', success: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return results;
    });
  }

  async sendBid(name: string, bid: number, lockup: number, passphrase: string): Promise<Transaction & { _receipt?: { bidAmount: number; nonce?: string; lockup: number } }> {
    const { walletClient } = this.connectionService.getClients();
    const result = await this.withUnlockedWallet(passphrase, async () => {
      // hsd RPC sendbid expects values in HNS (not dollarydoos).
      // The RPC's valid.ufixed() internally converts HNS → dollarydoos.
      return await walletClient.execute('sendbid', [name, bid, lockup]);
    }) as Transaction;

    // Attach receipt data for local storage. Always include bidAmount +
    // lockup from the original parameters. The nonce/blind is retrieved
    // best-effort from hsd's wallet DB — hsd may not have indexed the
    // bid yet right after sendbid, so the bid lookup is optional.
    const _receipt: { bidAmount: number; nonce?: string; lockup: number } = {
      bidAmount: bid,
      lockup,
    };
    try {
      const bids = await this.getBids(name);
      const ourBid = bids.find(b => b.name === name && b.own);
      if (ourBid && ourBid.blind) {
        _receipt.nonce = ourBid.blind;
      }
    } catch {
      // Nonce retrieval is best-effort; bid still succeeded
    }
    (result as unknown as Record<string, unknown>)._receipt = _receipt;

    return result;
  }

  async sendReveal(name: string | null, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return name
        ? await walletClient.execute('sendreveal', [name])
        : await walletClient.execute('sendreveal');
    }) as Transaction;
  }

  async sendRedeem(name: string | null, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return name
        ? await walletClient.execute('sendredeem', [name])
        : await walletClient.execute('sendredeem');
    }) as Transaction;
  }

  async sendUpdate(name: string, resource: DNSResource, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return await walletClient.execute('sendupdate', [name, resource]);
    }) as Transaction;
  }

  async sendRenewal(name: string, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return await walletClient.execute('sendrenewal', [name]);
    }) as Transaction;
  }

  async sendTransfer(name: string, address: string, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return await walletClient.execute('sendtransfer', [name, address]);
    }) as Transaction;
  }

  async sendFinalize(name: string, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return await walletClient.execute('sendfinalize', [name]);
    }) as Transaction;
  }

  async sendCancel(name: string, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return await walletClient.execute('sendcancel', [name]);
    }) as Transaction;
  }

  async sendRevoke(name: string, passphrase: string): Promise<Transaction> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withUnlockedWallet(passphrase, async () => {
      return await walletClient.execute('sendrevoke', [name]);
    }) as Transaction;
  }

  async importName(name: string, height?: number): Promise<void> {
    const { walletClient } = this.connectionService.getClients();
    const args = height ? [name, height] : [name];
    await walletClient.execute('importname', args);
  }

  async unlock(passphrase: string, timeout: number = 300): Promise<void> {
    const { walletClient } = this.connectionService.getClients();
    await walletClient.execute('walletpassphrase', [passphrase, timeout]);
  }

  async lock(): Promise<void> {
    const { walletClient } = this.connectionService.getClients();
    await walletClient.execute('walletlock');
  }

  private extractCovenantInfo(tx: Record<string, unknown>): { category: string; name: string | undefined; hasCovenant: boolean } {
    const allOutputs = (tx.outputs as Array<Record<string, unknown>>) || [];

    for (const output of allOutputs) {
      const cov = output.covenant as Record<string, unknown> | undefined;
      if (cov) {
        const action = String(cov.action || 'NONE');
        if (action !== 'NONE') {
          const items = (cov.items as string[]) || [];
          let name: string | undefined;
          if (items.length > 1 && ['OPEN', 'REGISTER', 'UPDATE', 'TRANSFER', 'FINALIZE', 'REVOKE'].includes(action)) {
            try {
              const hex = items[1];
              if (hex && /^[0-9a-f]+$/i.test(hex)) {
                name = Buffer.from(hex, 'hex').toString('utf8').replace(/\0/g, '');
              }
            } catch { /* ignore */ }
          }
          return { category: action.toLowerCase(), name, hasCovenant: true };
        }
      }
    }

    return { category: 'send', name: undefined, hasCovenant: false };
  }

  /**
   * Fetch every wallet history entry, paginating past hsd's 100-entry limit.
   * Returns entries newest-first, as hsd provides them.
   */
  private async getAllHistoryEntries(): Promise<Record<string, unknown>[]> {
    const { walletClient } = this.connectionService.getClients();
    const MAX_TXS_PER_PAGE = 100;
    const entries: Record<string, unknown>[] = [];
    let lastTxid: string | null = null;

    try {
      const batch = await walletClient.execute('listhistory', ['*']) as Record<string, unknown>[];
      if (Array.isArray(batch)) entries.push(...batch);
      if (entries.length > 0 && entries.length % MAX_TXS_PER_PAGE === 0) {
        lastTxid = String(entries[entries.length - 1].txid || '');
      }
    } catch (err) {
      console.warn('[wallet] listhistory failed:', err);
      return [];
    }

    while (lastTxid) {
      try {
        const batch = await walletClient.execute('listhistoryafter', ['*', lastTxid, MAX_TXS_PER_PAGE]) as Record<string, unknown>[];
        if (!Array.isArray(batch) || batch.length === 0) break;
        entries.push(...batch);
        if (batch.length < MAX_TXS_PER_PAGE) break;
        lastTxid = String(batch[batch.length - 1].txid || '');
        if (!lastTxid) break;
      } catch (err) {
        console.warn('[wallet] listhistoryafter failed at', lastTxid, err);
        break;
      }
    }

    return entries;
  }

  /**
   * Wallet id to scope read-only HTTP queries to.
   *
   * Explicitly configured connections use their wallet. Auto-detected
   * connections follow hsd's currently selected wallet, which is what Bob
   * Wallet sets when the user logs in.
   */
  private async getActiveWalletId(): Promise<string> {
    const configured = this.connectionService.getConfiguredWalletId();
    if (configured) return configured;

    try {
      const { walletClient } = this.connectionService.getClients();
      const info = await walletClient.execute('getwalletinfo') as Record<string, unknown>;
      return String(info.walletid || '');
    } catch {
      return '';
    }
  }

  /**
   * Fetch a wallet's full history through the wallet-scoped HTTP API.
   *
   * `GET /wallet/:id/tx/history` is unaffected by hsd's global wallet
   * pointer, and each entry embeds the transaction outputs (including
   * covenants), so no per-transaction `getTX` calls are needed.
   *
   * The endpoint caps each page at maxHistoryTXs (100); page with `after`
   * (newest-first + the oldest hash of the previous page).
   */
  private async getWalletHistoryEntries(walletId: string): Promise<Record<string, unknown>[]> {
    const { walletClient } = this.connectionService.getClients();
    const MAX_TXS_PER_PAGE = 100;
    const entries: Record<string, unknown>[] = [];

    // hsd wallets normally only have the "default" account, but scan every
    // account when the wallet exposes more than one.
    let accounts: string[] = ['default'];
    try {
      const raw = await walletClient.getAccounts(walletId);
      if (Array.isArray(raw)) {
        const names = raw
          .map(a => (typeof a === 'string'
            ? a
            : String((a as Record<string, unknown>)?.name || '')))
          .filter(Boolean);
        if (names.length > 0) accounts = [...new Set(names)];
      }
    } catch { /* fall back to the default account */ }

    for (const account of accounts) {
      let after: string | undefined;

      for (let page = 0; page < 100; page++) {
        const params: Record<string, unknown> = {
          account,
          limit: MAX_TXS_PER_PAGE,
          reverse: true,
        };
        if (after) params.after = after;

        const batch = await walletClient.get(
          `/wallet/${encodeURIComponent(walletId)}/tx/history`,
          params,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;

        entries.push(...(batch as Record<string, unknown>[]));
        if (batch.length < MAX_TXS_PER_PAGE) break;

        const last = batch[batch.length - 1] as Record<string, unknown>;
        after = String(last.hash || '');
        if (!after) break;
      }
    }

    return entries;
  }

  /**
   * Find names the wallet opened for auction by scanning its transaction
   * history for OPEN covenants.
   *
   * hsd's `getauctions` is aliased to `getnames` and returns every tracked
   * name (owned, bid on, expired), so it cannot identify opens reliably.
   * Wallet history is the source of truth used by the History page.
   *
   * `pendingNames` covers opens sent seconds ago that hsd has not indexed in
   * history yet (see DBService.justOpened).
   */
  async getOpenedNames(pendingNames: string[] = []): Promise<OpenedName[]> {
    const { walletClient, nodeClient } = this.connectionService.getClients();
    const walletId = await this.getActiveWalletId();

    // Preferred: wallet-scoped HTTP history. It cannot be confused by hsd's
    // global wallet pointer and avoids one getTX call per transaction.
    let entries: Record<string, unknown>[] | null = null;
    if (walletId) {
      try {
        entries = await this.getWalletHistoryEntries(walletId);
      } catch (err) {
        console.warn(`[wallet] history scan failed for "${walletId}":`, err);
      }
    }

    const fromHttp = entries !== null;

    // Fallback: legacy global RPC path (older hsd builds, or when the
    // wallet-scoped HTTP endpoint is unavailable).
    if (!entries) entries = await this.getAllHistoryEntries();
    if (entries.length === 0 && pendingNames.length === 0) return [];

    // Deduplicate history entries (one tx can produce multiple entries) and
    // remember the wallet's height/time for each txid. HTTP entries also
    // carry the decoded outputs, which is all we need to detect an OPEN.
    const entryMeta = new Map<
      string,
      { height: number | null; time: number; outputs: Record<string, unknown>[] }
    >();
    for (const entry of entries) {
      const txid = String(entry.txid || entry.hash || '');
      if (!txid || entryMeta.has(txid)) continue;
      const rawHeight = entry.blockheight ?? entry.height;
      entryMeta.set(txid, {
        height: rawHeight != null ? Number(rawHeight) : null,
        time: Number(entry.time || entry.timereceived || 0),
        outputs: (entry.outputs || entry.vout || []) as Record<string, unknown>[],
      });
    }

    const txids = [...entryMeta.keys()];
    const inspected: OpenedName[] = [];

    // Inspect in small batches to avoid hammering the node.
    const BATCH = 10;
    for (let i = 0; i < txids.length; i += BATCH) {
      const batch = txids.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (txid) => {
        if (this.openedTxCache.has(txid)) {
          const cached = this.openedTxCache.get(txid);
          // An unconfirmed open can be found in the mempool before it is
          // mined. Refresh its height once the wallet history confirms it.
          if (cached && cached.height == null) {
            const meta = entryMeta.get(txid);
            if (meta?.height != null) {
              const updated: OpenedName = {
                ...cached,
                height: meta.height,
                time: cached.time || meta.time,
              };
              this.openedTxCache.set(txid, updated);
              return updated;
            }
          }
          return cached ?? null;
        }

        try {
          if (fromHttp) {
            const meta = entryMeta.get(txid);
            const name = findOpenedName(meta?.outputs);
            if (!name) {
              // Successfully inspected, no OPEN output — safe to cache.
              this.openedTxCache.set(txid, null);
              return null;
            }

            const opened: OpenedName = {
              name,
              txid,
              height: meta?.height ?? null,
              time: meta?.time ?? 0,
            };
            this.openedTxCache.set(txid, opened);
            return opened;
          }

          let tx = await nodeClient.getTX(txid) as Record<string, unknown> | null;
          if (!tx && walletId) {
            tx = await (walletClient as unknown as {
              getTX: (id: string, hash: string) => Promise<Record<string, unknown> | null>;
            }).getTX(walletId, txid);
          }
          if (!tx) return null; // transient/unconfirmed — retry next refresh

          const meta = entryMeta.get(txid);
          const outputs = (tx.outputs || tx.vout || []) as Array<Record<string, unknown>>;
          const name = findOpenedName(outputs);

          if (!name) {
            // Successfully inspected, no OPEN output — safe to cache.
            this.openedTxCache.set(txid, null);
            return null;
          }

          const opened: OpenedName = {
            name,
            txid,
            height: tx.height != null ? Number(tx.height) : (meta?.height ?? null),
            time: Number(tx.time || tx.mtime || meta?.time || 0),
          };
          this.openedTxCache.set(txid, opened);
          return opened;
        } catch {
          // Do not cache failures (e.g. unconfirmed tx not yet in node mempool).
          return null;
        }
      }));

      for (const result of results) {
        if (result) inspected.push(result);
      }
    }

    // One row per name, keeping the most recent open (re-opens after expiry).
    const byName = new Map<string, OpenedName>();
    for (const opened of inspected) {
      const existing = byName.get(opened.name);
      if (!existing) {
        byName.set(opened.name, opened);
        continue;
      }
      const existingHeight = existing.height ?? -1;
      const nextHeight = opened.height ?? -1;
      if (nextHeight >= existingHeight) byName.set(opened.name, opened);
    }

    // Merge locally-pending opens that history has not indexed yet.
    for (const name of pendingNames) {
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          txid: '',
          height: null,
          time: Math.floor(Date.now() / 1000),
          pending: true,
        });
      }
    }

    return [...byName.values()].sort((a, b) => {
      // Unconfirmed/pending rows first.
      const aHeight = a.height ?? Number.MAX_SAFE_INTEGER;
      const bHeight = b.height ?? Number.MAX_SAFE_INTEGER;
      if (aHeight !== bHeight) return bHeight - aHeight;
      return b.time - a.time;
    });
  }

  async getTxHistory(): Promise<Transaction[]> {
    const { walletClient, nodeClient } = this.connectionService.getClients();

    // ---------------------------------------------------------------
    // Step 1: Get all wallet addresses for classification
    // ---------------------------------------------------------------
    const walletAddresses = new Set<string>();
    try {
      const addrs = await walletClient.execute('getaddressesbyaccount', [0]) as string[];
      for (const a of addrs) walletAddresses.add(a);
    } catch { /* ignore — classification will use fallback */ }

    // If the default-account lookup returned nothing, try 'default'
    if (walletAddresses.size === 0) {
      try {
        const addrs = await walletClient.execute('getaddressesbyaccount', ['default']) as string[];
        for (const a of addrs) walletAddresses.add(a);
      } catch { /* ignore */ }
    }

    // ---------------------------------------------------------------
    // Step 2: Get the active wallet's transactions.
    //
    // Prefer the wallet-scoped HTTP history endpoint. hsd's `listhistory`
    // JSON-RPC throws "Assertion failed" when the wallet history contains a
    // record whose transaction cannot be resolved (for example a pruned tx).
    // The HTTP endpoint uses WalletDB.toDetails, which skips those records
    // safely, and it is already what the auction views use.
    // Keep the RPC path as a fallback for older hsd builds.
    // ---------------------------------------------------------------
    const walletId = await this.getActiveWalletId();
    let rpcTxs: Record<string, unknown>[] = [];

    if (walletId) {
      try {
        rpcTxs = await this.getWalletHistoryEntries(walletId);
      } catch (err) {
        console.warn(`[wallet] wallet-scoped history failed for "${walletId}":`, err);
      }
    }

    if (rpcTxs.length === 0) {
      rpcTxs = await this.getAllHistoryEntries();
    }
    if (rpcTxs.length === 0) return [];

    // The HTTP endpoint can return the same transaction once per account.
    // Keep one entry per tx so a batched covenant tx cannot be expanded twice.
    const seenTxids = new Set<string>();
    rpcTxs = rpcTxs.filter((tx) => {
      const hash = String(tx.txid || tx.hash || '');
      if (!hash || seenTxids.has(hash)) return false;
      seenTxids.add(hash);
      return true;
    });

    // ---------------------------------------------------------------
    // Step 2.5: Build a nameHash → name lookup cache.
    // BID/REVEAL/REDEEM covenants encode the nameHash (items[0]) but
    // NOT the human-readable name. We'll resolve them using getnamebyhash.
    // ---------------------------------------------------------------
    const nameHashCache = new Map<string, string>();

    // Pre-populate from wallet's known names/bids/auctions for speed
    try {
      const [walletNames, walletBids, walletAuctions] = await Promise.all([
        walletClient.execute('getnames').catch(() => []),
        walletClient.execute('getbids').catch(() => []),
        walletClient.execute('getauctions').catch(() => []),
      ]) as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]];

      if (Array.isArray(walletNames)) {
        for (const n of walletNames) {
          const name = n.name as string;
          const hash = n.nameHash as string;
          if (name && hash) nameHashCache.set(hash, name);
        }
      }
      if (Array.isArray(walletBids)) {
        for (const b of walletBids) {
          const name = b.name as string;
          const hash = b.nameHash as string;
          if (name && hash) nameHashCache.set(hash, name);
        }
      }
      if (Array.isArray(walletAuctions)) {
        for (const a of walletAuctions) {
          const name = a.name as string;
          const hash = a.nameHash as string;
          if (name && hash) nameHashCache.set(hash, name);
        }
      }
    } catch { /* ignore — we'll resolve individually below */ }

    // ---------------------------------------------------------------
    // Step 3: For each TX, fetch full data from the NODE (not wallet)
    // to get correct fee, output addresses, and covenant info.
    // The wallet's getSpentCoins() often returns null (pruned coins),
    // making wallet-level classification unreliable.
    // ---------------------------------------------------------------
    // hsd covenant types: NONE=0, CLAIM=1, OPEN=2, BID=3, REVEAL=4,
    // REDEEM=5, REGISTER=6, UPDATE=7, RENEW=8, TRANSFER=9, FINALIZE=10, REVOKE=11
    const COVENANT_NAMES: Record<number, string> = {
      0: 'none', 1: 'claim', 2: 'open', 3: 'bid', 4: 'reveal',
      5: 'redeem', 6: 'register', 7: 'update', 8: 'renew',
      9: 'transfer', 10: 'finalize', 11: 'revoke',
    };

    const results: Transaction[] = [];

    // Process in batches of 10 to avoid overwhelming the node
    const BATCH = 10;
    for (let i = 0; i < rpcTxs.length; i += BATCH) {
      const batch = rpcTxs.slice(i, i + BATCH);
      const enriched = await Promise.all(batch.map(async (rpcTx) => {
        const hash = String(rpcTx.txid || rpcTx.hash || '');
        const height = rpcTx.blockheight != null
          ? Number(rpcTx.blockheight)
          : rpcTx.height != null ? Number(rpcTx.height) : null;
        const block = rpcTx.blockhash
          ? String(rpcTx.blockhash)
          : rpcTx.block
            ? String(rpcTx.block)
            : null;
        const time = Number(rpcTx.time || rpcTx.timereceived || rpcTx.mtime || 0);
        const entryInputs = (rpcTx.inputs || []) as Array<Record<string, unknown>>;
        const entryOutputs = (rpcTx.outputs || rpcTx.vout || []) as Array<Record<string, unknown>>;

        // The wallet-scoped HTTP history entry has no `category` or `amount`
        // fields. Derive them from its inputs and outputs so the row is still
        // useful if the node lookup below fails.
        let entrySentValue = 0;
        let entryReceivedValue = 0;
        for (const output of entryOutputs) {
          const address = String(output.address || '');
          const value = Number(output.value || 0);
          if (walletAddresses.has(address)) entryReceivedValue += value;
          else entrySentValue += value;
        }
        const entryFee = Number(rpcTx.fee || 0);
        const entrySpentFromWallet = entryFee > 0 || entryInputs.some((input) => {
          // Wallet HTTP history sets `path` only for coins this wallet owns.
          if (input.path) return true;
          if (walletAddresses.has(String(input.address || ''))) return true;
          const coin = input.coin as Record<string, unknown> | undefined;
          if (!coin) return false;
          if (coin.path) return true;
          return walletAddresses.has(String(coin.address || ''));
        });
        const fallbackCat = rpcTx.category
          ? String(rpcTx.category)
          : (entrySpentFromWallet && entrySentValue > 0) ? 'send' : 'receive';
        const fallbackAmount = rpcTx.amount != null
          ? Math.round(parseFloat(String(rpcTx.amount || '0')) * 1e6)
          : fallbackCat === 'send' ? -entrySentValue : entryReceivedValue;

        // Fallback using the history data if the node lookup fails
        const fallback: Transaction = {
          hash,
          height,
          block,
          time,
          index: Number(rpcTx.vout ?? -1),
          version: 1,
          fee: 0,
          amount: fallbackAmount,
          category: fallbackCat,
          name: undefined,
          event: fallbackCat === 'send' ? 'Sent HNS' : 'Received HNS',
          confirmations: Number(rpcTx.confirmations || 0),
          inputs: entryInputs,
          outputs: entryOutputs,
        };

        try {
          let nodeTx = await nodeClient.getTX(hash) as Record<string, unknown> | null;
          if (!nodeTx) {
            try {
              nodeTx = await walletClient.getTX(hash) as Record<string, unknown> | null;
            } catch {
              nodeTx = null;
            }
          }
          if (!nodeTx) return [fallback];

          // --- Fee from node ---
          // nodeClient.getTX returns fee via Amount.coin(fee, true) which is a
          // string like "0.000300" (HNS). But in some hsd versions it may
          // arrive as a raw number (dollarydoos) or a dollarydoos string
          // (e.g. "14000"). Handle all three.
          let fee = 0;
          const rawFee = nodeTx.fee;
          if (typeof rawFee === 'string') {
            // "0.014" → HNS, "14000" → dollarydoos (no decimal → dollarydoos)
            if (rawFee.includes('.')) {
              fee = Math.round(parseFloat(rawFee) * 1e6);
            } else {
              fee = parseInt(rawFee, 10);
            }
          } else if (typeof rawFee === 'number' && rawFee > 0) {
            fee = rawFee > 1 ? Math.round(rawFee) : Math.round(rawFee * 1e6);
          }
          if (isNaN(fee) || fee < 0) fee = 0;

          // --- Outputs (some hsd versions return "outputs", others "vout") ---
          const vout = (nodeTx.outputs || nodeTx.vout || []) as Array<Record<string, unknown>>;
          const vin = (nodeTx.inputs || []) as Array<Record<string, unknown>>;

          let sentValue = 0;
          let receivedValue = 0;
          let recipientAddress = '';

          for (const output of vout) {
            const addr = String(output.address || '');
            // output.value from node Coin.getJSON() is already in dollarydoos
            const valDolly = Number(output.value || 0);
            const isWallet = walletAddresses.has(addr);

            if (isWallet) {
              receivedValue += valDolly;
            } else {
              sentValue += valDolly;
              if (!recipientAddress && addr) recipientAddress = addr;
            }
          }

          // --- Covenant outputs and names ---
          // A batched tx has one covenant output per name (for example the
          // batch FINALIZE created by "Finalize All"). Collect all of them;
          // stopping at the first covenant is what collapsed a whole batch
          // into a single history row.
          //
          // Layouts live in src/lib/covenant-utils.ts. In short, OPEN/BID/
          // FINALIZE/CLAIM embed the name at items[2]; the rest only carry the
          // name hash at items[0] and must be resolved via getnamebyhash.
          // (Reading items[1] as text decodes the 4-byte height — that is what
          // rendered a renewal as "Renew name Qy".)
          const covenantOutputs: Array<{
            action: string;
            name: string;
            index: number;
            value: number;
          }> = [];

          for (let outputIndex = 0; outputIndex < vout.length; outputIndex++) {
            const output = vout[outputIndex];
            const cov = output.covenant as Record<string, unknown> | undefined;
            if (!cov) continue;

            // Resolve action to string, handling both numeric and string forms
            let actionStr: string;
            if (typeof cov.action === 'string') {
              actionStr = cov.action;
            } else if (typeof cov.type === 'number' && COVENANT_NAMES[cov.type]) {
              actionStr = COVENANT_NAMES[cov.type].toUpperCase();
            } else if (typeof cov.action === 'number' && COVENANT_NAMES[cov.action]) {
              actionStr = COVENANT_NAMES[cov.action].toUpperCase();
            } else {
              actionStr = '';
            }
            if (!actionStr || actionStr === 'NONE') continue;

            const items = (cov.items as string[]) || [];
            let name = extractRawCovenantName(actionStr, items) || '';

            if (!name) {
              const nameHash = getCovenantNameHash(actionStr, items);
              if (nameHash) {
                if (nameHashCache.has(nameHash)) {
                  name = nameHashCache.get(nameHash)!;
                } else {
                  try {
                    const resolvedName = await nodeClient.execute('getnamebyhash', [nameHash]);
                    if (resolvedName && typeof resolvedName === 'string') {
                      name = sanitizeCovenantName(resolvedName);
                      if (name) nameHashCache.set(nameHash, name);
                    }
                  } catch { /* ignore — name may be pruned */ }
                }
              }
            }

            covenantOutputs.push({
              action: actionStr.toLowerCase(),
              name,
              index: outputIndex,
              value: Number(output.value || 0),
            });
          }

          const primaryCovenant = covenantOutputs[0];
          const hasCovenantOutput = Boolean(primaryCovenant);
          const covenantName = primaryCovenant?.name ?? '';

          // Wallet HTTP history only includes `path` for coins this wallet
          // owns, and its fee is non-zero only when every input is ours.
          // Either signal proves this wallet initiated the transaction.
          const walletSpent = entrySpentFromWallet || vin.some((input) => {
            if (input.path) return true;
            if (walletAddresses.has(String(input.address || ''))) return true;
            const coin = input.coin as Record<string, unknown> | undefined;
            if (!coin) return false;
            if (coin.path) return true;
            return walletAddresses.has(String(coin.address || ''));
          });

          // --- Classification ---
          // For covenant TXs the wallet normally initiates → send. An
          // incoming TRANSFER is the exception: the sender pays the fee and
          // the recipient receives the name's value.
          let category: string;
          let amount: number;

          if (hasCovenantOutput) {
            category = primaryCovenant!.action;
            amount = walletSpent ? -sentValue : receivedValue;
          } else {
            category = fallbackCat;
            amount = category === 'send' ? -sentValue : receivedValue;
          }

          // --- Fix amount for covenant transactions ---
          // Covenant outputs carry the locked value in their output.value field.
          // For BID: the output value IS the lockup amount (in dollarydoos).
          // For REVEAL: the output value is the true bid (returned to winner).
          // For REDEEM: the output value is the refunded blind amount.
          // For OPEN/UPDATE/RENEW/etc.: typically just the fee.
          if (hasCovenantOutput && walletSpent) {
            if (category === 'bid') {
              // BID lockup = sum of all BID covenant output values
              let lockupAmount = 0;
              for (const output of vout) {
                const cov = output.covenant as Record<string, unknown> | undefined;
                if (!cov) continue;
                const actionStr = typeof cov.action === 'string' ? cov.action : '';
                const actionType = typeof cov.type === 'number' ? cov.type : -1;
                if (actionStr === 'BID' || actionType === 3) {
                  lockupAmount += Number(output.value || 0);
                }
              }
              amount = -(lockupAmount + fee);
            } else if (category === 'reveal') {
              // REVEAL: the bid value is returned minus the fee
              let revealValue = 0;
              for (const output of vout) {
                const cov = output.covenant as Record<string, unknown> | undefined;
                if (!cov) continue;
                const actionStr = typeof cov.action === 'string' ? cov.action : '';
                const actionType = typeof cov.type === 'number' ? cov.type : -1;
                if (actionStr === 'REVEAL' || actionType === 4) {
                  revealValue += Number(output.value || 0);
                }
              }
              amount = -(revealValue + fee);
            } else if (category === 'redeem') {
              // REDEEM: getting funds back (positive net effect)
              let redeemValue = 0;
              for (const output of vout) {
                const cov = output.covenant as Record<string, unknown> | undefined;
                if (!cov) continue;
                const actionStr = typeof cov.action === 'string' ? cov.action : '';
                const actionType = typeof cov.type === 'number' ? cov.type : -1;
                if (actionStr === 'REDEEM' || actionType === 5) {
                  redeemValue += Number(output.value || 0);
                }
              }
              // Redeem returns funds to the user (positive), minus fee
              amount = redeemValue - fee;
            } else if (category === 'register') {
              // REGISTER: the winning bid amount is burned (paid to name)
              let registerValue = 0;
              for (const output of vout) {
                const cov = output.covenant as Record<string, unknown> | undefined;
                if (!cov) continue;
                const actionStr = typeof cov.action === 'string' ? cov.action : '';
                const actionType = typeof cov.type === 'number' ? cov.type : -1;
                if (actionStr === 'REGISTER' || actionType === 6) {
                  registerValue += Number(output.value || 0);
                }
              }
              amount = -(registerValue + fee);
            } else {
              amount = -fee;
            }
          }

          // --- Determine sender address from inputs ---
          let senderAddress = '';
          for (const input of vin) {
            const inputAddr = String(input.address || '');
            if (inputAddr) { senderAddress = inputAddr; break; }
            const coin = input.coin as Record<string, unknown> | undefined;
            if (coin) {
              const coinAddr = String(coin.address || '');
              if (coinAddr) { senderAddress = coinAddr; break; }
            }
          }

          // Fee: only the wallet that spent inputs pays the fee. A recipient
          // of a name transfer sees the sender's tx but pays nothing.
          const displayFee = (walletSpent || category === 'send') ? fee : 0;

          // --- Event description ---
          const covalentCats = ['open', 'bid', 'reveal', 'redeem', 'register', 'update', 'renew', 'transfer', 'finalize', 'revoke'];
          const labels: Record<string, string> = {
            open: 'Open auction for', bid: 'Bid on name', reveal: 'Reveal bid for', redeem: 'Redeem bid for',
            register: 'Register name', update: 'Update DNS for', renew: 'Renew name',
            transfer: 'Transfer name', finalize: 'Finalize transfer of', revoke: 'Revoke name',
          };
          const eventFor = (cat: string, name: string): string => {
            if (covalentCats.includes(cat)) {
              return name ? `${labels[cat] || cat} ${name}` : labels[cat] || cat;
            }
            if (cat === 'send') {
              return recipientAddress ? `Sent HNS to ${recipientAddress}` : 'Sent HNS';
            }
            return senderAddress ? `Received HNS from ${senderAddress}` : 'Received HNS';
          };

          const baseRow = {
            hash,
            height,
            block,
            time,
            index: Number(rpcTx.vout ?? -1),
            version: 1,
            confirmations: Number(rpcTx.confirmations || 0),
            inputs: vin,
            outputs: vout,
          };

          // One row per distinct name when a tx batches multiple covenants.
          // Dedupe by name so repeated covenant outputs for one name stay
          // together; unnamed outputs remain distinct rows.
          const uniqueCovenants: Array<{
            action: string;
            name: string;
            index: number;
            value: number;
          }> = [];
          const seenNames = new Set<string>();
          for (const covenant of covenantOutputs) {
            const key = covenant.name || `#${covenant.index}`;
            if (seenNames.has(key)) continue;
            seenNames.add(key);
            uniqueCovenants.push(covenant);
          }

          if (uniqueCovenants.length > 1) {
            return uniqueCovenants.map((covenant, rowIndex) => ({
              ...baseRow,
              rowId: `${hash}:${covenant.index}`,
              // A batch is one on-chain transaction with one fee. Show it on
              // the first row only so it is never multiplied by row count.
              fee: rowIndex === 0 ? displayFee : 0,
              // Keep the transaction's net amount on the first row. Incoming
              // covenant rows instead show the value they received.
              amount: walletSpent
                ? (rowIndex === 0 ? amount : 0)
                : covenant.value,
              category: covenant.action,
              name: covenant.name || undefined,
              event: eventFor(covenant.action, covenant.name),
            } as unknown as Transaction));
          }

          return [{
            ...baseRow,
            rowId: `${hash}:${primaryCovenant?.index ?? 0}`,
            fee: displayFee,
            amount,
            category,
            name: covenantName || undefined,
            event: eventFor(category, covenantName),
          } as unknown as Transaction];
        } catch {
          return [fallback];
        }
      }));

      results.push(...enriched.flat());
    }

    return results;
  }

  // ============================================================
  // New Wallet Features
  // ============================================================

  /**
   * Create a new wallet (without passphrase so the seed phrase is accessible).
   * Uses hs-client's WalletClient.createWallet() REST method (PUT /wallet/:id).
   */
  async createWallet(name: string): Promise<{ id: string }> {
    const { walletClient } = this.connectionService.getClients();
    const result = await (walletClient as unknown as { createWallet: (id: string, options: Record<string, unknown>) => Promise<Record<string, unknown>> }).createWallet(name, {});
    return result as { id: string };
  }

  /**
   * Get the master key (includes mnemonic seed phrase if not encrypted).
   * Uses hs-client's WalletClient.getMaster() REST method (GET /wallet/:id/master).
   */
  async getMasterKey(name: string): Promise<{ mnemonic: string | null; encrypted: boolean }> {
    const { walletClient } = this.connectionService.getClients();
    const result = await (walletClient as unknown as { getMaster: (id: string) => Promise<Record<string, unknown>> }).getMaster(name);
    const mnemonicObj = result?.mnemonic;
    const phrase = mnemonicObj && typeof mnemonicObj === 'object' ? (mnemonicObj as Record<string, unknown>).phrase : mnemonicObj;
    const mnemonic = typeof phrase === 'string' && phrase.trim().split(/\s+/).length >= 12 ? phrase.trim() : null;
    return { mnemonic, encrypted: (result?.encrypted as boolean) || false };
  }

  /**
   * Encrypt an unencrypted wallet with a passphrase.
   * Uses hs-client's WalletClient.setPassphrase() REST method (POST /wallet/:id/passphrase).
   */
  async encryptWallet(name: string, passphrase: string): Promise<void> {
    const { walletClient } = this.connectionService.getClients();
    await (walletClient as unknown as { setPassphrase: (id: string, passphrase: string) => Promise<void> }).setPassphrase(name, passphrase);
  }

  /**
   * Get a wallet address for receiving.
   */
  async getAddress(account?: string): Promise<{ address: string }> {
    const { walletClient } = this.connectionService.getClients();
    const acct = account || 'default';
    const addr = await walletClient.execute('getaccountaddress', [acct]);
    return { address: String(addr) };
  }

  /**
   * Create a new receiving address.
   */
  async createAddress(account?: string): Promise<{ address: string }> {
    const { walletClient } = this.connectionService.getClients();
    const acct = account || 'default';
    const addr = await walletClient.execute('getnewaddress', [acct]);
    return { address: String(addr) };
  }

  /**
   * List all addresses for an account.
   */
  async listAddresses(account?: string): Promise<Array<{ address: string; type: string; account: number }>> {
    const { walletClient } = this.connectionService.getClients();
    const acct = account || 'default';
    const addrs = await walletClient.execute('getaddressesbyaccount', [acct]) as string[];
    return (addrs || []).map((addr, i) => ({
      address: addr,
      type: i === 0 ? 'receive' : 'change',
      account: 0,
    }));
  }

  /**
   * Send HNS to a recipient address using HTTP API.
   * Supports custom fee rates via the `rate` option (in dollarydoos/kB).
   */
  async sendToAddress(
    address: string,
    amount: number,
    passphrase: string,
    options?: { feeRate?: number; subtractFee?: boolean }
  ): Promise<{ hash: string; fee: number }> {
    const { walletClient } = this.connectionService.getClients();
    // Send from the wallet the user actually selected instead of relying on
    // hsd's global wallet pointer, which can point at a different wallet when
    // several are open.
    const walletId = (await this.getActiveWalletId()) || 'primary';
    const sendOpts: Record<string, unknown> = {
      outputs: [{ address, value: amount }],
      passphrase,
      // Default: the recipient receives exactly `amount`; the wallet pays the
      // fee on top. Callers that intentionally want the fee taken out of the
      // amount must opt in explicitly.
      subtractFee: options?.subtractFee ?? false,
    };
    if (options?.feeRate != null) {
      sendOpts.rate = options.feeRate;
    }
    const result = await (walletClient as unknown as { send: (id: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>> }).send(walletId, sendOpts);
    return { hash: String((result as Record<string, unknown>).hash || ''), fee: Number((result as Record<string, unknown>).fee || 0) };
  }

  /**
   * Fee rate presets (dollarydoos per kilobyte).
   */
  private static readonly FEE_RATES = {
    slow: 10_000,
    standard: 50_000,
    fast: 100_000,
  } as const;

  /** Estimated tx size for a simple send (bytes). */
  private static readonly ESTIMATED_TX_SIZE = 200;

  /**
   * Get fee estimates for each speed tier.
   * Returns fee in dollarydoos and HNS display value.
   */
  async getFeeEstimates(): Promise<Array<{ speed: string; feeDollarydoos: number; feeHns: string }>> {
    const rates = WalletService.FEE_RATES;
    const size = WalletService.ESTIMATED_TX_SIZE;
    return Object.entries(rates).map(([speed, rate]) => {
      const feeDollarydoos = Math.ceil((rate * size) / 1000);
      const feeHns = (feeDollarydoos / 1_000_000).toFixed(6);
      return { speed, feeDollarydoos, feeHns };
    });
  }

  /**
   * List all wallets available on the node.
   */
  async listWalletsDetailed(): Promise<string[]> {
    return this.fetchWalletIds();
  }

  /**
   * Get the public key for an address.
   */
  async getPublicKey(address: string): Promise<{ publicKey: string }> {
    const { walletClient } = this.connectionService.getClients();
    return await walletClient.execute('getpubkey', [address]) as { publicKey: string };
  }

  /**
   * Import a wallet from a BIP39 seed phrase.
   * Uses hsd's REST API PUT /wallet/:id with mnemonic option.
   */
  async importWallet(name: string, mnemonic: string, passphrase?: string): Promise<{ id: string }> {
    const { walletClient } = this.connectionService.getClients();
    const options: Record<string, unknown> = { mnemonic };
    if (passphrase) options.passphrase = passphrase;
    const result = await (walletClient as unknown as { createWallet: (id: string, options: Record<string, unknown>) => Promise<Record<string, unknown>> }).createWallet(name, options);
    return result as { id: string };
  }

  /**
   * Select a wallet for subsequent operations.
   */
  async selectWallet(walletId: string): Promise<void> {
    const { walletClient } = this.connectionService.getClients();
    await walletClient.execute('selectwallet', [walletId]);
    this.connectionService.setSelectedWallet(walletId);
  }

  /**
   * Read the lock state used by message signing. `unlocked_until` comes from
   * `getwalletinfo`; the encrypted flag only exists on the wallet master
   * endpoint.
   */
  private async getSigningWalletState(): Promise<{ encrypted: boolean; unlocked: boolean }> {
    const { walletClient } = this.connectionService.getClients();
    const raw = await walletClient.execute('getwalletinfo') as Record<string, unknown>;
    const walletId = String(raw.walletid || '');
    const until = Number(raw.unlocked_until) || 0;

    let encrypted = false;
    if (walletId) {
      try {
        const master = await (walletClient as unknown as {
          getMaster: (id: string) => Promise<Record<string, unknown>>;
        }).getMaster(walletId);
        encrypted = Boolean(master?.encrypted);
      } catch {
        // If the master endpoint is unavailable, let the signing RPC report
        // any real error instead of blocking the operation here.
      }
    }

    return { encrypted, unlocked: until > Math.floor(Date.now() / 1000) };
  }

  /**
   * Run a message-signing operation with the wallet unlocked.
   *
   * - Unencrypted wallet: run directly.
   * - Already unlocked: use the existing session when no passphrase is given.
   * - Locked + passphrase: unlock for the operation, then lock again.
   * - Locked + no passphrase: fail without touching the wallet.
   */
  private async withSigningWallet<T>(
    passphrase: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const { walletClient } = this.connectionService.getClients();
    const { encrypted, unlocked } = await this.getSigningWalletState();

    if (!encrypted || (unlocked && !passphrase)) {
      return await operation();
    }

    if (!passphrase) {
      throw new Error('Wallet is locked. Enter your passphrase to sign.');
    }

    try {
      await walletClient.execute('walletpassphrase', [passphrase, 300]);
      return await operation();
    } finally {
      try {
        await walletClient.execute('walletlock');
      } catch {
        // Locking is best-effort; never hide the signing result/error.
      }
    }
  }

  /**
   * Sign a message with the private key associated with a Handshake name.
   * Calls hsd wallet RPC: signmessagewithname(name, message)
   * Returns a signature string (base64-encoded).
   */
  async signMessageWithName(
    name: string,
    message: string,
    passphrase = '',
  ): Promise<string> {
    const { walletClient } = this.connectionService.getClients();
    return await this.withSigningWallet(passphrase, async () => {
      return await walletClient.execute('signmessagewithname', [name, message]) as string;
    });
  }

  /**
   * Sign the same message with every provided name.
   *
   * A failure for one name is returned in that name's result instead of
   * aborting the batch. Unlock failures (for example a wrong passphrase)
   * reject the whole call.
   */
  async signMessageBatch(
    names: string[],
    message: string,
    passphrase = '',
  ): Promise<NameSignatureResult[]> {
    if (!Array.isArray(names) || names.length === 0) {
      throw new Error('No names to sign.');
    }
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('Message is required.');
    }

    const { walletClient } = this.connectionService.getClients();
    return await this.withSigningWallet(passphrase, async () => {
      const results: NameSignatureResult[] = [];
      for (const name of names) {
        try {
          const signature = await walletClient.execute(
            'signmessagewithname',
            [name, message],
          ) as string;
          results.push({ name, signature });
        } catch (err) {
          results.push({
            name,
            signature: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return results;
    });
  }

  /**
   * Deep clean the wallet database, wiping balance and transaction history
   * while retaining key hashes and name maps.
   * Calls hsd wallet RPC: deepclean (wallet plugin method).
   */
  async deepClean(): Promise<void> {
    const { walletClient } = this.connectionService.getClients();
    // hsd exposes Deep Clean as `POST /deepclean` on the wallet HTTP server,
    // not as a JSON-RPC method. The endpoint requires this explicit
    // acknowledgement before it drops wallet history and balance state.
    await walletClient.post('/deepclean', { I_HAVE_BACKED_UP_MY_WALLET: true });
  }

  /**
   * Rescan the blockchain for wallet transactions starting from the given height.
   * Uses hsd's REST API (POST /rescan) — this is NOT available via JSON-RPC.
   * @param height Block height to start rescanning from (default: 0).
   */
  async rescan(height: number = 0): Promise<void> {
    const { walletClient } = this.connectionService.getClients();
    await walletClient.rescan(height);
  }

  /**
   * Get the compressed ECDSA public key (33 bytes hex) for an address.
   * Uses hsd wallet RPC: getpubkey(address)
   */
  async getCompressedPubKey(address: string): Promise<string> {
    const { walletClient } = this.connectionService.getClients();
    const result = await walletClient.execute('getpubkey', [address]) as { publicKey: string };
    // hsd returns the full public key; we need the compressed 33-byte form
    const pk = result.publicKey;
    if (pk.length === 130 && pk.startsWith('04')) {
      const x = Buffer.from(pk.slice(2, 66), 'hex');
      const y = Buffer.from(pk.slice(66, 130), 'hex');
      const compressed = Buffer.concat([Buffer.from([y[y.length - 1] & 1 ? 0x03 : 0x02]), x]);
      return compressed.toString('hex');
    }
    return pk; // already compressed (66 hex chars = 33 bytes)
  }

  /**
   * Broadcast a raw transaction to the Handshake network.
   * Uses node RPC: sendrawtransaction(hex)
   */
  async broadcastTx(txHex: string): Promise<string> {
    const { nodeClient } = this.connectionService.getClients();
    return await nodeClient.execute('sendrawtransaction', [txHex]) as string;
  }

  /**
   * Get the current block height from the node.
   */
  async getBlockHeight(): Promise<number> {
    const info = await this.connectionService.getClients().nodeClient.getInfo();
    return (info as Record<string, unknown>).chain?.height as number;
  }

  /**
   * Get a transaction from the HNS node by txid.
   */
  async getTransaction(txHash: string): Promise<Record<string, unknown> | null> {
    try {
      const { nodeClient } = this.connectionService.getClients();
      return await nodeClient.getTX(txHash) as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }

  /** Recent transactions touching an address (requires address indexing). */
  async getTransactionsByAddress(
    address: string,
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    const { nodeClient } = this.connectionService.getClients();
    const client = nodeClient as unknown as {
      getTXByAddress(address: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    };
    return await client.getTXByAddress(address, limit);
  }

  /**
   * Get wallet passphrase status.
   */
  async isEncrypted(): Promise<boolean> {
    try {
      const info = await this.getInfo();
      return info.master?.encrypted ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Whether the wallet can sign without a passphrase right now.
   * Unencrypted wallets and wallets inside their unlock window return true.
   */
  async isUnlocked(): Promise<boolean> {
    try {
      const info = await this.getInfo();
      if (!info.master?.encrypted) return true;
      return (info.master?.until ?? 0) > Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }
}
