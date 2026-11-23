import { create } from 'zustand';
import type { Auction, AuctionSummary, Bid, BidReceipt, UnifiedHnsAuction, UserBidData, AuctionPhase, OpenedName } from '../types/auction';
import type { Domain, NameState } from '../types/domain';
import { computeAuctionPhase } from '../lib/name-utils';
import { NETWORKS } from '../lib/constants';
import type { NetworkName } from '../lib/constants';
import { getAuctionSchedule, getBlocksUntilNextPhase } from '../lib/auction-timing';
import { useConnectionStore } from './connection-store';

interface AuctionsStore {
  // Legacy fields (kept for backward compat)
  auctions: Auction[];
  bids: Bid[];
  summary: AuctionSummary;
  isLoading: boolean;
  error: string | null;
  justRevealed: string[];
  pendingReveals: string[];

  // Unified fields
  unifiedAuctions: UnifiedHnsAuction[];
  currentBlock: number;

  // Names the wallet opened for auction, from transaction history
  openedNames: OpenedName[];

  // Local bid receipts (saved at bid time — source of truth for
  // unrevealed True Bid Value, since hsd hides value on-chain)
  bidReceipts: Record<string, BidReceipt>;

  // Opened names the user has dismissed from the Opened tab
  openedHidden: string[];

  // Names the user just redeemed (persisted to cover hsd sync lag)
  justRedeemed: string[];

  // Names the user just registered (persisted to cover hsd sync lag)
  justRegistered: string[];

  fetchAuctions: () => Promise<void>;
  fetchBids: () => Promise<void>;
  getAuctionInfo: (name: string) => Promise<Auction | null>;
  refreshSummary: () => Promise<void>;
  markJustRevealed: (name: string) => void;
  markPendingReveal: (name: string) => void;

  // New unified methods
  fetchUnifiedAuctions: () => Promise<void>;
  loadJustRevealed: () => Promise<void>;
  loadBidReceipts: () => Promise<void>;
  loadJustRedeemed: () => Promise<void>;
  loadJustRegistered: () => Promise<void>;
  markJustRedeemed: (name: string) => void;
  markJustRegistered: (name: string) => void;
  saveBidReceiptLocal: (receipt: BidReceipt) => void;
}

const EMPTY_SUMMARY: AuctionSummary = {
  openingCount: 0,
  activeBidCount: 0,
  pendingRevealCount: 0,
  wonUnregisteredCount: 0,
  pendingRedeemCount: 0,
  totalLockedHNS: 0,
};

export const useAuctionsStore = create<AuctionsStore>((set, get) => ({
  auctions: [],
  bids: [],
  summary: EMPTY_SUMMARY,
  isLoading: false,
  error: null,
  justRevealed: [],
  pendingReveals: [],
  unifiedAuctions: [],
  currentBlock: 0,
  openedNames: [],
  bidReceipts: {},
  openedHidden: [],
  justRedeemed: [],
  justRegistered: [],

  fetchAuctions: async () => {
    set({ isLoading: true, error: null });
    try {
      const rawAuctions = await window.api.wallet.getAuctions();
      set({ auctions: rawAuctions as Auction[], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed to fetch auctions' });
    }
  },

  fetchBids: async () => {
    try {
      const bids = await window.api.wallet.getBids();
      const bidList = bids as Bid[];
      set({ bids: bidList });
      const confirmed = (name: string) => bidList.some(b => b.name === name && b.revealed);
      const justRevealed = get().justRevealed.filter(name => !confirmed(name));
      const pendingReveals = get().pendingReveals.filter(name => !confirmed(name));
      set({ justRevealed, pendingReveals });
    } catch {
      // Ignore
    }
  },

  getAuctionInfo: async (name) => {
    try {
      const auction = await window.api.wallet.getAuctionInfo(name);
      return auction as Auction | null;
    } catch {
      return null;
    }
  },

  refreshSummary: async () => {
    try {
      const [auctions, bids] = await Promise.all([
        window.api.wallet.getAuctions(),
        window.api.wallet.getBids(),
      ]);
      const auctionList = auctions as Auction[];
      const bidList = bids as Bid[];
      const auctionStates = new Map<string, string>();
      auctionList.forEach(a => auctionStates.set(a.name, a.state));
      const auctionIsWinner = new Map<string, boolean | null>();
      auctionList.forEach(a => auctionIsWinner.set(a.name, a.isWinner));

      const wonUnregisteredCount = bidList.filter(b => {
        const state = auctionStates.get(b.name);
        const isWinner = auctionIsWinner.get(b.name);
        return state === 'CLOSED' && isWinner === true && b.revealed && !b.redeemed;
      }).length;

      const pendingRedeemCount = bidList.filter(b => {
        const state = auctionStates.get(b.name);
        const isWinner = auctionIsWinner.get(b.name);
        return (state === 'CLOSED' || state == null) && b.revealed && !b.redeemed && isWinner !== true;
      }).length;

      const pendingRevealCount = bidList.filter(b => {
        const state = auctionStates.get(b.name);
        return state === 'REVEAL' && !b.revealed;
      }).length;

      const activeBidCount = bidList.filter(b => {
        const state = auctionStates.get(b.name);
        return state === 'OPENING' || state === 'BIDDING';
      }).length;

      const summary = {
        openingCount: auctionList.filter(a => a.state === 'OPENING').length,
        activeBidCount,
        pendingRevealCount,
        wonUnregisteredCount,
        pendingRedeemCount,
        totalLockedHNS: bidList.reduce((sum, b) => sum + b.lockup, 0),
      };
      set({ summary, auctions: auctionList, bids: bidList });
    } catch {
      // Ignore
    }
  },

  loadJustRevealed: async () => {
    try {
      const names = await window.api.db.getRevealedNames();
      if (Array.isArray(names) && names.length > 0) {
        set({ justRevealed: names });
      }
    } catch {
      // DB may not be ready
    }
  },

  loadBidReceipts: async () => {
    try {
      const receipts = await window.api.db.getAllBidReceipts();
      if (receipts && typeof receipts === 'object') {
        set({ bidReceipts: receipts as Record<string, BidReceipt> });
      }
    } catch {
      // DB may not be ready
    }
  },

  saveBidReceiptLocal: (receipt: BidReceipt) => {
    set(prev => ({ bidReceipts: { ...prev.bidReceipts, [receipt.name]: receipt } }));
  },

  markJustRevealed: (name: string) => {
    const justRevealed = get().justRevealed;
    if (!justRevealed.includes(name)) {
      set({ justRevealed: [...justRevealed, name] });
      window.api.db.addRevealedName(name).catch(() => {});
    }
  },

  markPendingReveal: (name: string) => {
    const pendingReveals = get().pendingReveals;
    if (!pendingReveals.includes(name)) {
      set({ pendingReveals: [...pendingReveals, name] });
    }
  },

  loadJustRedeemed: async () => {
    try {
      const names = await window.api.db.getJustRedeemed();
      if (Array.isArray(names) && names.length > 0) {
        // Cross-reference with wallet data: only keep entries where the
        // wallet still has an unredeemed bid. If the wallet confirms
        // redemption, we can safely remove the DB entry (avoid unbounded
        // growth across restarts). The wallet-redeemed flag is stable at
        // this point (app startup) so there's no flapping concern.
        try {
          const bids = await window.api.wallet.getBids() as Bid[];
          const stillPending = names.filter(n => {
            const wBid = bids.find(b => b.name === n && b.own);
            return !wBid || !wBid.redeemed;
          });
          const confirmed = names.filter(n => !stillPending.includes(n));
          if (confirmed.length > 0) {
            for (const n of confirmed) {
              window.api.db.removeJustRedeemed(n).catch(() => {});
            }
          }
          set({ justRedeemed: stillPending });
        } catch {
          set({ justRedeemed: names });
        }
      }
    } catch { /* DB may not be ready */ }
  },

  markJustRedeemed: (name: string) => {
    const justRedeemed = get().justRedeemed;
    if (!justRedeemed.includes(name)) {
      set({ justRedeemed: [...justRedeemed, name] });
      window.api.db.addJustRedeemed(name).catch(() => {});
    }
  },

  loadJustRegistered: async () => {
    try {
      const names = await window.api.db.getJustRegistered();
      if (Array.isArray(names) && names.length > 0) {
        set({ justRegistered: names });
      }
    } catch { /* DB may not be ready */ }
  },

  markJustRegistered: (name: string) => {
    const justRegistered = get().justRegistered;
    if (!justRegistered.includes(name)) {
      set({ justRegistered: [...justRegistered, name] });
      window.api.db.addJustRegistered(name).catch(() => {});
    }
  },

  // ============================================================
  // Unified Data Fetching
  //
  // Merges data from THREE API sources (per Core Technical Directives):
  //
  // 1. Node Client: GET /name/:name  → blockchain state
  //    (global auction info: state, height, highest, stats)
  //    THIS IS THE AUTHORITATIVE PHASE SIGNAL — hsd's getnameinfo
  //    state field drives tab bucketing. Block-height math is a
  //    fallback for when node detail is unavailable.
  //
  // 2. Wallet Client: GET /wallet/:id/bid/:name → user bid state
  //    (our bids: value, lockup, blind, revealed, redeemed)
  //
  // 3. Local DB (electron-store): bid receipts
  //    (saved at bid time with nonce + bidAmount — source of
  //    truth for unrevealed True Bid Value since hsd hides it
  //    on-chain during the bidding phase)
  //
  // Bob Wallet alignment: app/utils/nameHelpers.js + app/ducks/names.js
  //   - getNameInfo() fetches NODE data
  //   - getYourBids() fetches WALLET bid data
  //   - Merged in the reducer via state.names[name]
  // ============================================================

  fetchUnifiedAuctions: async () => {
    set({ isLoading: true, error: null });
    try {
      // Step 1: Fetch chain height from Node API
      const currentBlock = await window.api.node.getBlockHeight().catch(() => 0);
      const network = (useConnectionStore.getState().network || 'main') as NetworkName;
      const net = NETWORKS[network];

      // Step 2: Fetch wallet bids + bid receipts
      const [bids, walletAuctions, bidReceipts, openedHidden, openedNames] = await Promise.all([
        window.api.wallet.getBids().catch(() => []),
        window.api.wallet.getAuctions().catch(() => []),
        window.api.db.getAllBidReceipts().catch(() => ({})),
        window.api.db.getOpenedHidden().catch(() => []),
        window.api.wallet.getOpenedNames().catch(() => []),
      ]);

      const bidList = bids as Bid[];
      const walletAuctionMap = new Map<string, Auction>();
      (walletAuctions as Auction[]).forEach(a => walletAuctionMap.set(a.name, a));
      const receiptMap = (bidReceipts as Record<string, BidReceipt>) || {};
      const openedNameList = (openedNames as OpenedName[]) || [];
      const openedHeightByName = new Map(
        openedNameList.map(o => [o.name, o.height] as const),
      );
      // Opens that hsd has not indexed yet have no height/txid. Without this,
      // block math would derive CLOSED for startHeight 0 and the row would
      // briefly render as ended right after the user opened it.
      const pendingOpenedNames = new Set(
        openedNameList
          .filter(o => o.pending || o.height == null)
          .map(o => o.name),
      );

      // Step 2.5: Import names that have bids but aren't tracked by wallet's getAuctions()
      // This ensures the wallet indexes other bidders' bids for these auctions.
      const namesNeedingImport = bidList
        .filter(b => b.own && !walletAuctionMap.has(b.name))
        .map(b => b.name);
      const uniqueNamesNeedingImport = [...new Set(namesNeedingImport)];
      for (const name of uniqueNamesNeedingImport) {
        const walletBid = bidList.find(b => b.name === name && b.own);
        const rescanHeight = walletBid?.height ? Math.max(0, walletBid.height - 100) : undefined;
        try {
          await window.api.wallet.importName(name, rescanHeight);
        } catch (err) {
          console.warn(`[auctions-store] Failed to import name ${name}:`, err);
        }
      }
      // Re-fetch auctions after import to get updated data with other bidders' bids
      if (uniqueNamesNeedingImport.length > 0) {
        const updatedAuctions = await window.api.wallet.getAuctions().catch(() => []);
        (updatedAuctions as Auction[]).forEach(a => walletAuctionMap.set(a.name, a));
      }

      // Step 2.75: Fetch authoritatively owned names for winner fallback.
      // getNames() calls getnames [true] + filters auction states — only names
      // where the wallet has an unspent owner coin are returned. This is the
      // most reliable way to check if the user won (owns the name).
      const ownedNames = new Set((await window.api.wallet.getNames().catch(() => []) as Domain[]).map(d => d.name));

      // Step 3: Build the set of unique names the wallet is involved in.
      //
      // Opened names now come from wallet transaction history (OPEN
      // covenants), not hsd's getAuctions() — that RPC is aliased to
      // getnames() and returns EVERY name the wallet has ever tracked
      // (owned, expired, bid on), which would both flood this list and
      // perform thousands of unnecessary node lookups.
      //
      //   - bidList        → Active/Reveal/Won/Lost
      //   - openedNames    → Opened (and also bid tabs when a bid exists)
      //   - justRedeemed   → keeps settled lost bids visible after pruning
      //   - justRegistered → keeps settled wins visible after hsd sync lag
      const uniqueNames = [
        ...new Set([
          ...bidList.map(b => b.name),
          ...openedNameList.map(o => o.name),
          ...get().justRedeemed,
          ...get().justRegistered,
        ]),
      ];
      const unifiedAuctions: UnifiedHnsAuction[] = [];

      const nodeDetails = await Promise.allSettled(
        uniqueNames.map(async (name) => {
          const detail = await window.api.node.getNameDetail(name);
          return { name, detail };
        }),
      );

      const nodeDetailMap = new Map<string, Record<string, unknown>>();
      for (const result of nodeDetails) {
        if (result.status === 'fulfilled' && result.value.detail) {
          nodeDetailMap.set(result.value.name, result.value.detail as unknown as Record<string, unknown>);
        }
      }

      // Step 4: Merge data into UnifiedHnsAuction for each unique name
      for (const name of uniqueNames) {
        const nodeDetail = nodeDetailMap.get(name);
        const walletAuction = walletAuctionMap.get(name);
        const walletBid = bidList.find(b => b.name === name && b.own);
        const receipt = receiptMap[name];

        // Derive openHeight from multiple sources with fallbacks:
        // 1. Node getNameDetail (most authoritative; hsd's height IS openHeight)
        // 2. Wallet auction openHeight
        // 3. History OPEN transaction height (source for the Opened tab)
        // 4. Wallet phase boundary minus the network's actual period lengths
        // A bid height is not a reliable start-height source: bids can be placed
        // anywhere in BIDDING, so it is intentionally not used.
        const startHeight = (nodeDetail?.openHeight as number)
          || walletAuction?.openHeight
          || (openedHeightByName.get(name) ?? 0)
          || (walletAuction?.biddingStartBlock ? walletAuction.biddingStartBlock - net.openPeriod : 0)
          || (walletAuction?.revealStartBlock ? walletAuction.revealStartBlock - net.openPeriod - net.biddingPeriod : 0)
          || (walletAuction?.closeBlock ? walletAuction.closeBlock - net.openPeriod - net.biddingPeriod - net.revealPeriod : 0);
        // Highest bid value source priority:
        //   1. nodeDetail.highest  — hsd's authoritative highest REVEALED bid value
        //      (0 during BIDDING phase since no reveals have happened yet)
        //   2. walletAuction.highest — hsd's wallet-side view; the wallet service
        //      now also includes the max lockup from wallet-tracked bids as a
        //      fallback, which is the strongest visible-on-chain signal during
        //      BIDDING when hsd hides true bid values for Vickrey privacy.
        //   3. Compute from walletAuction.bids lockups directly as a last resort.
        //      Do NOT fall through to walletBid.lockup — using the user's own
        //      lockup as the global highest would make checkIsWinner return true
        //      for any bid where value >= lockup (bids without a blind), incorrectly
        //      marking lost auctions as won.
        const highestBid = (nodeDetail?.highest as number)
          || (walletAuction?.highest as number)
          || (walletAuction?.bids?.length
            ? Math.max(...walletAuction.bids.map(b => b.lockup || 0))
            : 0)
          || 0;
        const rawState = (nodeDetail?.state as string) || walletAuction?.state;

        // Compute blocksUntilNext using the SAME currentBlock (fetched once at line 258)
        // for both node-derived and fallback math — eliminates race condition between
        // getNameDetail's internal getBlockHeight() and our currentBlock.
        let blocksUntilNext: number | null = null;
        const nodeOpenHeight = nodeDetail?.openHeight as number;
        const nodeState = nodeDetail?.state as string;
        const effectiveStartHeight = nodeOpenHeight || startHeight;
        const effectiveState = nodeState || rawState;

        if (effectiveStartHeight > 0 && effectiveState) {
          const schedule = getAuctionSchedule(effectiveStartHeight, network);
          const nodeBlocksUntil = typeof nodeDetail?.blocksUntilNext === 'number'
            ? nodeDetail.blocksUntilNext
            : null;

          if (effectiveState === 'OPENING') {
            blocksUntilNext = nodeBlocksUntil
              ?? Math.max(0, schedule.biddingStart - currentBlock);
          } else if (effectiveState === 'BIDDING') {
            blocksUntilNext = nodeBlocksUntil
              ?? Math.max(0, schedule.biddingEnd - currentBlock);
          } else if (effectiveState === 'REVEAL') {
            blocksUntilNext = nodeBlocksUntil
              ?? Math.max(0, schedule.revealEnd - currentBlock);
          } else if (effectiveState === 'CLOSED' || effectiveState === 'TRANSFER') {
            blocksUntilNext = null;
          } else {
            blocksUntilNext = computeBlocksUntilForPhase(
              computeAuctionPhase(startHeight, currentBlock, undefined, network),
              startHeight,
              currentBlock,
              network,
            );
          }
        } else {
          blocksUntilNext = computeBlocksUntilForPhase(
            computeAuctionPhase(startHeight, currentBlock, undefined, network),
            startHeight,
            currentBlock,
            network,
          );
        }

        // Build userBidData from wallet bid (if it exists)
        let userBidData: UserBidData | undefined;
        if (walletBid) {
          // Determine revealed status:
          // 1. Direct per-bid RPC flag from hsd's getbids (authoritative
          //    after the nameHash-based cross-reference in wallet-service)
          // 2. justRevealed store array (user just revealed via UI)
          // Do NOT use walletAuction.reveals.length or .hasUnrevealedBids
          // here — those are auction-level signals that conflate OTHER
          // bidders' reveals with the user's own. In a Vickrey auction
          // only the bid owner's REVEAL covenant reveals their bid.
          const locallyJustRevealed = get().justRevealed.includes(name);
          const isRevealed = Boolean(
            walletBid.revealed || locallyJustRevealed,
          );

          // For the TRUE bid value, prefer sources in this order:
          // 1. Local bid receipt (saved at bid time) — works for UNREVEALED
          //    bids where hsd hides the value on-chain.
          // 2. walletBid.value (only meaningful AFTER reveal).
          // 3. walletAuction.bids[].value (revealed bids with value > 0).
          // 4. Fallback to lockup (last resort for unrevealed without receipt).
          // receipt stores bidAmount/lockup in HNS (from sendBid's param),
          // while walletBid values are in dollarydoos (from hsd RPC).
          // Multiply by 1M to normalise to dollarydoos.
          let bidValue = receipt ? receipt.bidAmount * 1_000_000 : 0;
          if (bidValue === 0) bidValue = walletBid.value || 0;
          if (isRevealed && bidValue === 0) {
            const revealedBid = walletAuction?.bids?.find(b => b.own && b.value > 0);
            bidValue = revealedBid?.value || walletBid.lockup || 0;
          }

          // For the LOCKUP value, prefer the wallet RPC (on-chain truth
          // from hsd) over the receipt snapshot. The receipt's lockup
          // reflects the bid parameters at placement time, but may
          // disagree with on-chain data if the user placed multiple
          // bids on the same name (receipt is keyed by name only, not
          // by txid, so it only tracks the most recently saved bid).
          // Fall back to receipt only when wallet data is unavailable.
          const bidLockup = walletBid.lockup || (receipt ? receipt.lockup * 1_000_000 : 0);

          // Use the justRedeemed list to force redeemed=true even before
          // hsd syncs the flag (covers the gap between sendRedeem completing
          // and the next wallet RPC reflecting it).
          const locallyJustRedeemed = get().justRedeemed.includes(name);

          userBidData = {
            txid: walletBid.txHash || '',
            value: bidValue,
            lockup: bidLockup,
            revealed: isRevealed,
            isWinner: null,
            redeemed: walletBid.redeemed || locallyJustRedeemed,
            blind: walletBid.blind || receipt?.nonce || undefined,
            bidHeight: walletBid.height,
          };
        } else if (get().justRedeemed.includes(name)) {
          // Edge case: wallet no longer returns this bid (may have been
          // pruned post-redeem), but we know the user redeemed it.
          // Create a minimal userBidData so the auction stays in the Lost
          // tab as settled rather than falling into the Opened tab.
          userBidData = {
            txid: '',
            value: 0,
            lockup: 0,
            revealed: true,
            isWinner: false,
            redeemed: true,
          };
        }

        if (userBidData && nodeDetail) {
          // Reconstruct the RELIABLE bid value for winner determination,
          // WITHOUT the walletBid.lockup fallback. Lockup includes a blind
          // (value + disguise) and overestimates the true bid, causing
          // lost auctions to appear as won when lockup >= node's highest.
          let reliableValue = receipt ? receipt.bidAmount * 1_000_000 : 0;
          if (reliableValue === 0) reliableValue = walletBid?.value || 0;
          if (userBidData.revealed && reliableValue === 0) {
            const revealedBid = walletAuction?.bids?.find(b => b.own && b.value > 0);
            reliableValue = revealedBid?.value || 0;
          }
          const nodeHighest = nodeDetail.highest as number;
          if (!nodeHighest || nodeHighest <= 0) {
            userBidData.isWinner = null;
          } else if (reliableValue <= 0) {
            userBidData.isWinner = null;
          } else {
            userBidData.isWinner = reliableValue >= nodeHighest;
          }
        }

        // Wallet ownership fallback: if checkIsWinner couldn't determine
        // (isWinner is null), check if the wallet truly owns the name via
        // getNames() (getnames [true] + auction-state filter). This is
        // definitive — if the wallet owns the name, the user won.
        if (userBidData && userBidData.isWinner == null && ownedNames.has(name)) {
          userBidData.isWinner = true;
        }

        // ============================================================
        // Phase determination: TRUST hsd's rawState when available.
        //
        // Why: hsd's getnameinfo returns the authoritative state from
        // its own internal state machine. Our block-height math is a
        // rough approximation that can disagree (e.g., the "1-block
        // before reveal" edge case, or if hsd has a different view of
        // when the bidding period ends).
        //
        // The de name at block 332,043 demonstrates this: hsd reports
        // state="Bidding" (auction still in bidding phase), but our
        // block math says REVEAL (332,043 > biddingEnd=331,727).
        // hsd's state is correct per the user's expectation.
        // ============================================================
        const blockChainPhase = computeAuctionPhase(startHeight, currentBlock, userBidData);
        // A pending open has no on-chain height yet, so hsd reports the name
        // as AVAILABLE (the name index only moves when a block is connected).
        // Trusting that raw state would render a just-broadcast open as
        // "Ended" for up to a full block. Force OPENING until history/node
        // data gives us a real open height.
        const isUnconfirmedOpen = startHeight === 0 && pendingOpenedNames.has(name);
        const phase = isUnconfirmedOpen
          ? 'OPENING'
          : rawState
            ? mapRawStateToPhase(rawState as NameState, userBidData)
            : blockChainPhase;

        // Total number of bids on this auction from wallet-tracked data.
        // If walletAuction is missing or carries no bid list (the RPC
        // getauctions alias returns name states only), at least 1 bid exists
        // when the user has a bid.
        const totalBids = walletAuction?.bids?.length || (walletBid ? 1 : 0);

        // Compute second-highest bid (the Vickrey price — what the winner actually pays).
        // Filter to revealed bids only (unrevealed = still blind, value not yet known),
        // exclude the user's own bid, sort descending, take the top.
        const otherRevealedBids = (walletAuction?.bids || [])
          .filter(b => !b.own && b.value > 0 && b.revealed)
          .sort((a, b) => b.value - a.value);
        const secondHighestBid = otherRevealedBids.length > 0 ? otherRevealedBids[0].value : 0;

        const revealPeriodEnded = blockChainPhase === 'REDEEM' || blockChainPhase === 'CLOSED';
        const unified: UnifiedHnsAuction = {
          name,
          currentBlock,
          startHeight,
          blockchainState: phase,
          highestBid,
          secondHighestBid,
          totalBids,
          blocksUntilNext,
          revealPeriodEnded,
          rawState: rawState as NameState,
          userBidData,
        };

        unifiedAuctions.push(unified);
      }

      // Clean up justRevealed from both memory and DB.
      // Only trust the per-bid revealed flag, not auction-level signals
      // (hasReveals/noUnrevealed) for the same reason: other bidders'
      // reveals don't reveal mine.
      const namesConfirmedRevealed = get().justRevealed.filter(name => {
        const wBid = bidList.find(b => b.name === name && b.own);
        return Boolean(wBid?.revealed);
      });
      if (namesConfirmedRevealed.length > 0) {
        const filtered = get().justRevealed.filter(n => !namesConfirmedRevealed.includes(n));
        set({ justRevealed: filtered });
        for (const name of namesConfirmedRevealed) {
          window.api.db.removeRevealedName(name).catch(() => {});
        }
      }

      // Clean up justRedeemed: only remove names where the wallet has
      // confirmed redemption AND the name no longer needs a pending-redeem
      // badge. To avoid the hsd flag flapping (wallet reports redeemed=true
      // on one poll, false on the next), we keep the justRedeemed entry as
      // a permanent marker. The wallet-redeemed flag is checked in the
      // userBidData build above (walletBid.redeemed || locallyJustRedeemed),
      // so even with the justRedeemed entry, the flag stays consistent.
      // Only clean up from DB at startup via loadJustRedeemed cross-reference.
      // In-memory cleanup is intentionally removed to prevent race conditions
      // between hsd's wallet sync and the UI state.

      set({
        unifiedAuctions,
        currentBlock,
        bidReceipts: receiptMap,
        openedHidden: openedHidden as string[],
        openedNames: openedNameList,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed to fetch unified auctions' });
    }
  },
}));

// ============================================================
// Internal helpers
// ============================================================

/**
 * Map hsd's authoritative NameState to our AuctionPhase.
 *
 *   OPENING/BIDDING/REVEAL → 1:1
 *   CLOSED + (winner|loser) → CLOSED/REDEEM based on user bid data
 *   TRANSFER → CLOSED (name transferred to user)
 *   REVOKED/EXPIRED → CLOSED (settled, no further action)
 */
function mapRawStateToPhase(
  rawState: NameState,
  userBidData?: UserBidData,
): AuctionPhase {
  switch (rawState) {
    case 'OPENING':
    case 'BIDDING':
    case 'REVEAL':
      return rawState;
    case 'CLOSED':
    case 'TRANSFER':
      if (userBidData && !userBidData.redeemed && userBidData.isWinner === false) {
        return 'REDEEM';
      }
      return 'CLOSED';
    case 'REVOKED':
    case 'EXPIRED':
    default:
      return 'CLOSED';
  }
}

/**
 * Compute blocks until the next phase transition for the
 * authoritative (rawState-derived) phase.
 */
function computeBlocksUntilForPhase(
  phase: AuctionPhase,
  startHeight: number,
  currentBlock: number,
  network: NetworkName,
): number | null {
  if (startHeight === 0) return null;
  return getBlocksUntilNextPhase(
    phase,
    getAuctionSchedule(startHeight, network),
    currentBlock,
  );
}


