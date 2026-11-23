import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock, Shield, EyeOff, DollarSign, TrendingUp, Check, Siren, Loader2, Eye } from 'lucide-react';
import { toPunycode, toUnicode, dollaryDoosToHNS, blocksToTimeLeft } from '../../lib/name-utils';
import type { UnifiedHnsAuction } from '../../types/auction';
import type { NetworkName } from '../../lib/constants';

// ============================================================
// RevealPhaseList
// ============================================================
// List/table view of names the user has bid on that are now in
// the Reveal auction phase — bids must be revealed before the
// phase ends or funds are lost.
//
// Mirrors the ActiveBidsList table layout (same visual language)
// but with reveal-specific columns and actions:
//
//   - Name
//   - True Bid (true value, from receipt for unrevealed, from
//     wallet RPC for revealed)
//   - Lockup (total on-chain amount)
//   - Disguise (lockup - trueBid)
//   - Blocks Until Close (countdown to auction close — the
//     deadline for revealing)
//   - Highest Current Bid (top bid on the name/TLD)
//   - Status (Revealed badge) + Action (Reveal Now button)
//
// This replaces the card grid for the "Reveal Phase" tab.
// ============================================================

interface RevealPhaseListProps {
  auctions: UnifiedHnsAuction[];
  network: NetworkName;
  currentAction: { name: string; type: string; loading: boolean; ok: boolean; msg: string } | null;
  onReveal: (name: string) => void;
  onRevealAll: (names: string[]) => void;
}

function formatHNS(dollarydoos: number, decimals: number = 4): string {
  return `${dollaryDoosToHNS(dollarydoos).toFixed(decimals)} HNS`;
}

export function RevealPhaseList({ auctions, network, currentAction, onReveal, onRevealAll }: RevealPhaseListProps) {
  const sorted = useMemo(
    // Sort by blocks-until-close ascending (ending soonest first).
    () => [...auctions].sort((a, b) => {
      const aBlocks = a.blocksUntilNext ?? Number.MAX_SAFE_INTEGER;
      const bBlocks = b.blocksUntilNext ?? Number.MAX_SAFE_INTEGER;
      return aBlocks - bBlocks;
    }),
    [auctions],
  );

  const unrevealedNames = useMemo(
    () => sorted.filter(a => a.userBidData?.revealed !== true).map(a => a.name),
    [sorted],
  );

  const isBatchRevealing = currentAction?.type === 'reveal-all';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800">
      {/* Reveal All action bar */}
      {unrevealedNames.length >= 2 && (
        <div className="flex items-center justify-between px-4 py-3 bg-orange-50/70 dark:bg-orange-900/15 border-b border-orange-200 dark:border-orange-800/50">
          <span className="text-sm text-orange-700 dark:text-orange-300">
            {unrevealedNames.length} name{unrevealedNames.length !== 1 ? 's' : ''} pending reveal
          </span>
          <button
            onClick={() => onRevealAll(unrevealedNames)}
            disabled={isBatchRevealing || currentAction?.loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isBatchRevealing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            {isBatchRevealing ? 'Revealing…' : 'Reveal All'}
          </button>
        </div>
      )}
      {/* Desktop / tablet: full table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-right px-4 py-2.5">Lockup</th>
              <th className="text-right px-4 py-2.5">True Bid</th>
              <th className="text-right px-4 py-2.5">Disguise</th>
              <th className="text-right px-4 py-2.5">Blocks Until Close</th>
              <th className="text-right px-4 py-2.5">Highest Current Bid</th>
              <th className="text-right px-4 py-2.5">Status</th>
              <th className="text-right px-4 py-2.5 w-32">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {sorted.map(a => {
              const userValue = a.userBidData?.value ?? 0;
              const userLockup = a.userBidData?.lockup ?? 0;
              const disguise = userValue > 0 ? Math.max(0, userLockup - userValue) : 0;
              const blocks = a.blocksUntilNext ?? 0;
              const urgent = blocks > 0 && blocks <= 144;
              const isRevealed = a.userBidData?.revealed === true;
              const periodEnded = a.revealPeriodEnded === true;
              const isBusy = currentAction?.name === a.name && currentAction?.loading;
              const isActioned = currentAction?.name === a.name && !currentAction?.loading;

              return (
                <tr
                  key={a.name}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                    !isRevealed && urgent
                      ? 'bg-orange-50/50 dark:bg-orange-900/10'
                      : ''
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
                  <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                    {userLockup > 0 ? formatHNS(userLockup) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-600 dark:text-green-400">
                    {userValue > 0 ? formatHNS(userValue) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-amber-600 dark:text-amber-400">
                    {disguise > 0 ? formatHNS(disguise) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-flex items-center gap-1 font-mono ${
                        periodEnded
                          ? 'text-gray-400 dark:text-gray-500'
                          : urgent
                            ? 'text-orange-600 dark:text-orange-400 font-semibold'
                            : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      {periodEnded ? 'Ended' : blocks > 0 ? `${blocks} (${blocksToTimeLeft(blocks, network)})` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">
                    {a.highestBid > 0 ? formatHNS(a.highestBid) : 'No bids'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isRevealed ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                        <Check className="w-3 h-3" />
                        Revealed
                      </span>
                    ) : periodEnded ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                        <Clock className="w-3 h-3" />
                        Awaiting close
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400">
                        <Siren className="w-3 h-3" />
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isRevealed ? (
                      <Link
                        to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                        className="inline-flex items-center text-gray-400 hover:text-hns-600 transition-colors"
                        title="Open name detail"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                      </Link>
                    ) : periodEnded ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 cursor-default">
                        Awaiting confirmation
                      </span>
                    ) : (
                      <button
                        onClick={() => onReveal(a.name)}
                        disabled={isBusy}
                        className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 transition-colors"
                      >
                        {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                        {isBusy ? 'Revealing…' : isActioned && !currentAction.ok ? 'Retry' : 'Reveal Now'}
                      </button>
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
          const disguise = userValue > 0 ? Math.max(0, userLockup - userValue) : 0;
          const blocks = a.blocksUntilNext ?? 0;
          const urgent = blocks > 0 && blocks <= 144;
          const isRevealed = a.userBidData?.revealed === true;
          const periodEnded = a.revealPeriodEnded === true;
          const isBusy = currentAction?.name === a.name && currentAction?.loading;
          const isActioned = currentAction?.name === a.name && !currentAction?.loading;

          return (
            <li
              key={a.name}
              className={`p-3 space-y-2 ${
                !isRevealed && urgent ? 'bg-orange-50/50 dark:bg-orange-900/10' : ''
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
                    periodEnded
                      ? 'text-gray-400 dark:text-gray-500'
                      : urgent
                        ? 'text-orange-600 dark:text-orange-400 font-semibold'
                        : 'text-gray-500'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  {periodEnded ? 'Ended' : blocks > 0 ? `${blocks} blk` : '—'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <Shield className="w-3 h-3" /> Lockup
                  </div>
                  <div className="font-mono text-gray-700 dark:text-gray-300">
                    {userLockup > 0 ? formatHNS(userLockup) : '—'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <DollarSign className="w-3 h-3" /> True Bid
                  </div>
                  <div className="font-mono text-green-600 dark:text-green-400">
                    {userValue > 0 ? formatHNS(userValue) : '—'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <EyeOff className="w-3 h-3" /> Disguise
                  </div>
                  <div className="font-mono text-amber-600 dark:text-amber-400">
                    {disguise > 0 ? formatHNS(disguise) : '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-gray-500">
                  <TrendingUp className="w-3 h-3" /> Highest:
                  <span className="font-mono text-gray-700 dark:text-gray-300">
                    {a.highestBid > 0 ? formatHNS(a.highestBid) : 'No bids'}
                  </span>
                </div>
                {isRevealed ? (
                  <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                    <Check className="w-3 h-3" /> Revealed
                  </span>
                ) : periodEnded ? (
                  <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 font-medium">
                    <Clock className="w-3 h-3" /> Awaiting close
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 font-medium">
                    <Siren className="w-3 h-3" /> Pending
                  </span>
                )}
              </div>
              {!isRevealed && !periodEnded && (
                <button
                  onClick={() => onReveal(a.name)}
                  disabled={isBusy}
                  className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-md bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 transition-colors"
                >
                  {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                  {isBusy ? 'Revealing…' : isActioned && !currentAction.ok ? 'Retry Reveal' : 'Reveal Bid Now'}
                </button>
              )}
              {periodEnded && (
                <span className="block w-full text-center px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                  Awaiting blockchain confirmation
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
