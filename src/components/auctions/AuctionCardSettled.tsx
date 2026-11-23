import { useState, useMemo } from 'react';
import { Check } from 'lucide-react';
import {
  computeAuctionPhase,
  blocksUntilNextPhase,
  dollaryDoosToHNS,
  isNearPhaseTransition,
} from '../../lib/name-utils';
import type { UnifiedHnsAuction, AuctionPhase } from '../../types/auction';
import type { NetworkName } from '../../lib/constants';
import { AuctionPhaseStepper } from './AuctionPhaseStepper';

/**
 * Read-only wrapper around AuctionCard for settled (won/lost) auctions.
 *
 * Used by the "Completed" sub-section of the Won and Lost tabs.
 * Differences from the live AuctionCard:
 *  - No call-to-action button (nothing left to do).
 *  - Dimmed styling (opacity-75).
 *  - A small "Registered" or "Redeemed" pill near the name.
 *  - Inline financial display so users can audit past bids.
 *
 * All the complex action UI is intentionally omitted to keep the focus on
 * settled auctions as a historical record.
 */

export type SettledKind = 'registered' | 'redeemed';

interface AuctionCardSettledProps {
  auction: UnifiedHnsAuction;
  settled: SettledKind;
  network: NetworkName;
}

export function AuctionCardSettled({ auction, settled, network }: AuctionCardSettledProps) {
  const { name, currentBlock, startHeight, highestBid, userBidData } = auction;

  const phase = useMemo<AuctionPhase>(
    () => computeAuctionPhase(startHeight, currentBlock, userBidData, network),
    [startHeight, currentBlock, userBidData, network],
  );

  const blocksRemaining = useMemo(
    () => blocksUntilNextPhase(phase, startHeight, currentBlock, network),
    [phase, startHeight, currentBlock, network],
  );

  const nearTransition = useMemo(
    () => isNearPhaseTransition(phase, startHeight, currentBlock, network),
    [phase, startHeight, currentBlock, network],
  );

  const [showLockupDetail, setShowLockupDetail] = useState(false);

  const lockupHNS = userBidData ? dollaryDoosToHNS(userBidData.lockup) : 0;
  const valueHNS = userBidData ? dollaryDoosToHNS(userBidData.value) : 0;
  const blindAmount = userBidData ? userBidData.lockup - userBidData.value : 0;
  const blindHNS = dollaryDoosToHNS(blindAmount);
  const highestHNS = dollaryDoosToHNS(highestBid);

  const pillCls = settled === 'registered'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800 shadow-sm opacity-75">
      {/* Header */}
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold truncate text-gray-700 dark:text-gray-300">
            {name}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${pillCls}`}>
              <Check className="w-3 h-3" />
              {settled === 'registered' ? 'Registered' : 'Redeemed'}
            </span>
            {nearTransition && blocksRemaining !== null && blocksRemaining > 0 && (
              <span className="text-xs text-gray-500">Closing</span>
            )}
          </div>
        </div>
        {highestBid > 0 && (
          <div className="text-right shrink-0 text-sm text-gray-500">
            <div className="text-xs text-gray-400">Highest</div>
            <div className="font-mono font-medium">{highestHNS.toFixed(2)} HNS</div>
          </div>
        )}
      </div>

      {/* Stepper (always shown to keep visual consistency with live cards) */}
      <div className="mb-3">
        <AuctionPhaseStepper currentPhase={phase} showAll={false} />
      </div>

      {/* Financials */}
      {userBidData && (
        <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {settled === 'registered' ? 'Claimed' : 'Refunded'}
            </span>
            <span className="font-mono font-semibold">
              {(settled === 'registered' ? valueHNS : blindAmount > 0 ? valueHNS : lockupHNS).toFixed(4)} HNS
            </span>
          </div>
          <button
            onClick={() => setShowLockupDetail(!showLockupDetail)}
            className="mt-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {showLockupDetail ? 'Hide details' : 'Show details'}
          </button>
          {showLockupDetail && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600 space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>True Bid (Value)</span>
                <span className="font-mono text-green-600 dark:text-green-400">{valueHNS.toFixed(4)} HNS</span>
              </div>
              <div className="flex justify-between">
                <span>Disguise (Blind)</span>
                <span className="font-mono text-amber-600 dark:text-amber-400">{blindHNS.toFixed(4)} HNS</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-dotted border-gray-200 dark:border-gray-600 font-medium text-gray-700 dark:text-gray-300">
                <span>Total Lockup</span>
                <span className="font-mono">{lockupHNS.toFixed(4)} HNS</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {settled === 'registered'
          ? 'You won this auction and the name is now in your wallet.'
          : 'You lost this auction and your locked funds have been returned.'}
      </div>
    </div>
  );
}
