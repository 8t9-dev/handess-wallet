import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, DollarSign, TrendingUp, Gavel } from 'lucide-react';
import { toPunycode, toUnicode, dollaryDoosToHNS, blocksToTimeLeft } from '../../lib/name-utils';
import type { UnifiedHnsAuction } from '../../types/auction';
import type { NetworkName } from '../../lib/constants';

// ============================================================
// ActiveBidsList
// ============================================================
// List/table view of names the user has bid on that are still in
// the Bidding auction phase (not yet in REVEAL).
//
// Columns (per user requirements):
//   - Name
//   - Your Bid (the user's true bid amount, from local bid
//     receipt for unrevealed bids, or from wallet RPC for
//     revealed bids)
//   - Highest Current Bid (the top bid on the name/TLD)
//   - Blocks Until Reveal (countdown to the bidding phase
//     ending — when the auction moves to REVEAL phase)
//   - Action: "Bid Now" button (only shown when the highest
//     current bid is GREATER than the user's bid, so the user
//     knows they need to outbid to stay competitive)
//
// This replaces the card grid for the "Active Bids" tab.
// ============================================================

interface ActiveBidsListProps {
  auctions: UnifiedHnsAuction[];
  network: NetworkName;
}

function formatHNS(dollarydoos: number, decimals: number = 4): string {
  return `${dollaryDoosToHNS(dollarydoos).toFixed(decimals)} HNS`;
}

export function ActiveBidsList({ auctions, network }: ActiveBidsListProps) {
  const navigate = useNavigate();

  const sorted = useMemo(
    // Sort by blocks-until-reveal ascending (ending soonest first).
    () => [...auctions].sort((a, b) => {
      const aBlocks = a.blocksUntilNext ?? Number.MAX_SAFE_INTEGER;
      const bBlocks = b.blocksUntilNext ?? Number.MAX_SAFE_INTEGER;
      return aBlocks - bBlocks;
    }),
    [auctions],
  );

  const handleBidNow = (name: string) => {
    navigate(`/explore/name/${encodeURIComponent(toPunycode(name))}`);
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800">
      {/* Desktop / tablet: full table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-right px-4 py-2.5">Your Bid</th>
              <th className="text-right px-4 py-2.5">
                <span title="True bid values hidden during bidding (Vickrey privacy). Showing highest confirmed lockup from wallet-tracked bids.">
                  Highest Lockup
                </span>
              </th>
              <th className="text-right px-4 py-2.5">
                <span title="Blocks until the next phase starts: bidding, reveal, or auction close.">
                  Next Phase In
                </span>
              </th>
              <th className="text-right px-4 py-2.5">Mempool</th>
              <th className="text-right px-4 py-2.5 w-40">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {sorted.map(a => {
              const userValue = a.userBidData?.value ?? 0;
              const userLockup = a.userBidData?.lockup ?? 0;
              // hsd hides unrevealed bid values on-chain (Vickrey privacy).
              // If the local receipt is missing, fall back to the visible
              // on-chain lockup as the strongest signal we can show.
              const showAsLockup = userValue === 0 && userLockup > 0;
              const displayValue = showAsLockup ? userLockup : userValue;
              const blocks = a.blocksUntilNext;
              const urgent = blocks !== null && blocks > 0 && blocks <= 12;
              const isTransitioning = blocks === null;
              // Show "Bid Now" only when the user is NOT the
              // highest bidder — they need to outbid to stay in.
              const needsToOutbid = a.highestBid > userValue;

              return (
                <tr
                  key={a.name}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                    needsToOutbid ? 'bg-orange-50/40 dark:bg-orange-900/10' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                      className="font-semibold text-hns-600 hover:underline truncate block max-w-[12rem]"
                    >
                      {toUnicode(a.name)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-600 dark:text-green-400">
                    {displayValue > 0 ? (
                      <span
                        title={
                          showAsLockup
                            ? 'Bid value hidden by Vickrey auction privacy. Showing the visible on-chain lockup (bid + blinding).'
                            : undefined
                        }
                      >
                        {formatHNS(displayValue)}
                        {showAsLockup && (
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-gray-500">lockup</span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-mono ${
                        needsToOutbid
                          ? 'text-orange-600 dark:text-orange-400 font-semibold'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}
                      title="True bid values hidden during bidding (Vickrey privacy). Showing highest confirmed lockup from wallet-tracked bids."
                    >
                      {a.highestBid > 0
                        ? formatHNS(a.highestBid)
                        : a.totalBids > 0
                          ? `(${a.totalBids} bid${a.totalBids !== 1 ? 's' : ''})`
                          : 'No bids'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-flex items-center gap-1 font-mono ${
                        isTransitioning
                          ? 'text-amber-600 dark:text-amber-400 font-semibold'
                          : urgent
                          ? 'text-orange-600 dark:text-orange-400 font-semibold'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      {isTransitioning
                        ? 'Transitioning…'
                        : blocks != null && blocks > 0
                        ? `${blocks} (${blocksToTimeLeft(blocks, network)})`
                        : blocks === 0
                        ? 'Ending…'
                        : '—'}
                    </span>
                    <div className="text-[10px] text-gray-400">
                      {a.blockchainState === 'OPENING'
                        ? 'to bidding'
                        : a.blockchainState === 'BIDDING'
                          ? 'to reveal'
                          : 'to close'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.userBidData?.bidHeight != null && a.userBidData.bidHeight > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        Confirmed
                      </span>
                    ) : a.userBidData?.txid ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <svg className="w-3 h-3 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        In Mempool
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {needsToOutbid ? (
                      <button
                        onClick={() => handleBidNow(a.name)}
                        className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                      >
                        <Gavel className="w-3 h-3" />
                        Bid Now
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                        ✓ You&apos;re highest
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked rows */}
      <ul className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {sorted.map(a => {
          const userValue = a.userBidData?.value ?? 0;
          const userLockup = a.userBidData?.lockup ?? 0;
          const showAsLockup = userValue === 0 && userLockup > 0;
          const displayValue = showAsLockup ? userLockup : userValue;
          const blocks = a.blocksUntilNext;
          const urgent = blocks !== null && blocks > 0 && blocks <= 12;
          const isTransitioning = blocks === null;
          const needsToOutbid = a.highestBid > userValue;

          return (
            <li
              key={a.name}
              className={`p-3 space-y-2 ${
                needsToOutbid ? 'bg-orange-50/40 dark:bg-orange-900/10' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                  className="font-semibold text-hns-600 hover:underline truncate"
                >
                  {toUnicode(a.name)}
                </Link>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 text-xs font-mono ${
                    isTransitioning
                      ? 'text-amber-600 dark:text-amber-400 font-semibold'
                      : urgent
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-gray-500'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  {isTransitioning
                    ? 'Transitioning…'
                    : blocks != null && blocks > 0
                    ? `${blocks} blk`
                    : blocks === 0
                    ? 'Ending…'
                    : '—'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <DollarSign className="w-3 h-3" /> Your Bid
                  </div>
                  <div
                    className="font-mono text-green-600 dark:text-green-400"
                    title={
                      showAsLockup
                        ? 'Bid value hidden by Vickrey auction privacy. Showing the visible on-chain lockup (bid + blinding).'
                        : undefined
                    }
                  >
                    {displayValue > 0 ? (
                      <>
                        {formatHNS(displayValue)}
                        {showAsLockup && (
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-gray-500">lockup</span>
                        )}
                      </>
                    ) : '—'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <TrendingUp className="w-3 h-3" />
                    <span title="True bid values hidden during bidding (Vickrey privacy). Showing highest confirmed lockup from wallet-tracked bids.">
                      Highest Lockup
                    </span>
                  </div>
                  <div
                    className={`font-mono ${
                      needsToOutbid
                        ? 'text-orange-600 dark:text-orange-400 font-semibold'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                    title="True bid values hidden during bidding (Vickrey privacy). Showing highest confirmed lockup from wallet-tracked bids."
                  >
                    {a.highestBid > 0
                      ? formatHNS(a.highestBid)
                      : a.totalBids > 0
                        ? `(${a.totalBids} bid${a.totalBids !== 1 ? 's' : ''})`
                        : 'No bids'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Mempool
                  </div>
                  <div className="font-mono">
                    {a.userBidData?.bidHeight != null && a.userBidData.bidHeight > 0 ? (
                      <span className="text-green-600 dark:text-green-400">Confirmed</span>
                    ) : a.userBidData?.txid ? (
                      <span className="text-amber-600 dark:text-amber-400">In Mempool</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </div>
                </div>
              </div>
              {needsToOutbid ? (
                <button
                  onClick={() => handleBidNow(a.name)}
                  className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                >
                  <Gavel className="w-3 h-3" />
                  Bid Now
                </button>
              ) : (
                <div className="w-full inline-flex items-center justify-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium py-1">
                  ✓ You&apos;re the highest bidder
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
