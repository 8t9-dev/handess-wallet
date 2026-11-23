import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Check, X, Clock, Siren, Eye, EyeOff, DollarSign, Shield } from 'lucide-react';
import { toPunycode, toUnicode } from '../../lib/name-utils';
import {
  computeAuctionPhase,
  getPhaseLabel,
  getPhaseBadgeClasses,
  getUrgentAction,
  blocksUntilNextPhase,
  blocksToTimeLeft,
  dollaryDoosToHNS,
  isNearPhaseTransition,
} from '../../lib/name-utils';
import type { UnifiedHnsAuction, AuctionPhase } from '../../types/auction';
import type { NetworkName } from '../../lib/constants';
import { AuctionPhaseStepper } from './AuctionPhaseStepper';

// ============================================================
// Unified Auction Card
// ============================================================
// Maps Bob Wallet's BidActionPanel workflow to a React component:
//   app/pages/Auction/BidActionPanel/index.js
//
// Key UX principles:
// 1. Always show Lockup (hidden on-chain total) ≠ Value (actual bid)
// 2. Phase stepper shows current position in lifecycle
// 3. Urgent REVEAL phase with unrevealed bid = high visual priority
// 4. Each phase renders exactly one action option (no ambiguity)
// ============================================================

interface AuctionCardProps {
  auction: UnifiedHnsAuction;
  network: NetworkName;
  /** Current action being executed for this name (for loading state) */
  currentAction?: { type: string; loading: boolean; ok: boolean; msg: string } | null;
  onPlaceBid: (name: string, bidAmount: number, lockup: number) => void;
  onReveal: (name: string) => void;
  onRedeem: (name: string) => void;
  onRegister: (name: string, records?: string) => void;
  /** If true, wallet is encrypted and will prompt for passphrase */
  isEncrypted?: boolean;
}

export function AuctionCard({
  auction,
  network,
  currentAction,
  onPlaceBid,
  onReveal,
  onRedeem,
  onRegister,
}: AuctionCardProps) {
  const {
    name,
    currentBlock,
    startHeight,
    highestBid,
    totalBids,
    userBidData,
    blockchainState,
  } = auction;

  // ----------------------------------------------------------
  // Phase: use the store's authoritative blockchainState
  // (derived from hsd's getnameinfo via rawState mapping).
  // Fall back to block-height math if not set.
  // ----------------------------------------------------------
  const phase = useMemo<AuctionPhase>(
    () => blockchainState ?? computeAuctionPhase(startHeight, currentBlock, userBidData, network),
    [blockchainState, startHeight, currentBlock, userBidData, network],
  );

  const urgentAction = useMemo(
    () => getUrgentAction(phase, userBidData),
    [phase, userBidData],
  );

  const blocksRemaining = useMemo(
    () => auction.blocksUntilNext ?? blocksUntilNextPhase(phase, startHeight, currentBlock, network),
    [auction.blocksUntilNext, phase, startHeight, currentBlock, network],
  );

  const nearTransition = useMemo(
    () => isNearPhaseTransition(phase, startHeight, currentBlock, network),
    [phase, startHeight, currentBlock, network],
  );

  const isUrgent = urgentAction.urgency === 'high';
  const isBusy = currentAction?.loading ?? false;
  const actionResult = currentAction && !currentAction.loading;

  // ----------------------------------------------------------
  // Local UI state
  // ----------------------------------------------------------
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidInput, setBidInput] = useState('');
  const [lockupInput, setLockupInput] = useState('');
  const [bidError, setBidError] = useState<string | null>(null);
  const [dnsRecords, setDnsRecords] = useState('');
  const [showLockupDetail, setShowLockupDetail] = useState(false);

  // ----------------------------------------------------------
  // Action handlers
  // ----------------------------------------------------------
  const handlePlaceBid = () => {
    const bid = parseFloat(bidInput);
    const lock = parseFloat(lockupInput);
    if (isNaN(bid) || bid <= 0) { setBidError('Enter a valid bid amount'); return; }
    if (isNaN(lock) || lock < bid) { setBidError('Lockup must be >= bid amount'); return; }
    setBidError(null);
    onPlaceBid(name, bid, lock);
    setShowBidForm(false);
    setBidInput('');
    setLockupInput('');
  };

  const handleReveal = () => onReveal(name);
  const handleRedeem = () => onRedeem(name);
  const handleRegister = () => onRegister(name, dnsRecords);

  // ----------------------------------------------------------
  // Financial display helpers
  // ----------------------------------------------------------
  const lockupHNS = userBidData ? dollaryDoosToHNS(userBidData.lockup) : 0;
  const valueHNS = userBidData ? dollaryDoosToHNS(userBidData.value) : 0;
  const blindAmount = userBidData ? (userBidData.lockup - userBidData.value) : 0;
  const blindHNS = dollaryDoosToHNS(blindAmount);
  const highestHNS = dollaryDoosToHNS(highestBid);

  // ----------------------------------------------------------
  // Phase-specific labels
  // ----------------------------------------------------------
  let statusLabel = getPhaseLabel(phase);
  if (phase === 'REDEEM') statusLabel = 'Funds to Redeem';
  if (phase === 'REVEAL' && userBidData?.revealed) statusLabel = 'Revealed';
  if (phase === 'REVEAL' && !userBidData?.revealed && userBidData) statusLabel = 'REVEAL NOW';

  return (
    <div
      className={`
        border rounded-xl p-4 bg-white dark:bg-gray-800 shadow-sm transition-all duration-300
        ${isUrgent
          ? 'border-orange-400 dark:border-orange-500 ring-1 ring-orange-300 dark:ring-orange-400'
          : 'border-gray-200 dark:border-gray-700'
        }
      `}
    >
      {/* ====================================================== */}
      {/* Header: Name + Phase Badge + Countdown */}
      {/* ====================================================== */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 mr-3">
          <Link
            to={`/explore/name/${encodeURIComponent(toPunycode(name))}`}
            className="text-base font-semibold truncate block text-hns-600 hover:underline"
          >
            {toUnicode(name)}
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${getPhaseBadgeClasses(phase)}`}>
              {phase === 'REDEEM' ? 'Redeem' : statusLabel}
            </span>
            {nearTransition && blocksRemaining !== null && blocksRemaining <= 1 && (
              <span className="flex items-center gap-1 text-xs text-orange-600 font-medium">
                <Clock className="w-3 h-3" />
                Closing
              </span>
            )}
          </div>
        </div>

        {/* Right column: countdown + highest bid */}
        <div className="text-right shrink-0 text-sm text-gray-500">
          {blocksRemaining !== null && blocksRemaining > 0 && (
            <div className="text-xs text-gray-400">
              {phase === 'OPENING' && 'Bidding in '}
              {phase === 'BIDDING' && 'Reveal in '}
              {phase === 'REVEAL' && 'Close in '}
              <span className="font-mono font-medium text-gray-600 dark:text-gray-300">
                {blocksToTimeLeft(blocksRemaining, network)}
              </span>
            </div>
          )}
          {highestBid > 0 && (
            <div className="text-xs text-gray-400 mt-0.5">
              Highest: <span className="font-mono">{highestHNS.toFixed(2)} HNS</span>
            </div>
          )}
          {totalBids > 0 && (
            <div className="text-xs text-gray-400 mt-0.5">{totalBids} bid{totalBids !== 1 ? 's' : ''}</div>
          )}
        </div>
      </div>

      {/* ====================================================== */}
      {/* Phase Stepper */}
      {/* ====================================================== */}
      <div className="mb-3">
        <AuctionPhaseStepper
          currentPhase={phase}
          urgent={isUrgent && phase === 'REVEAL'}
        />
      </div>

      {/* ====================================================== */}
      {/* Financial Display: Lockup vs Value */}
      {/* ====================================================== */}
      {userBidData && (
        <div className="mb-3 border border-gray-100 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50">
          {/* Lockup row */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-gray-600 dark:text-gray-400">Lockup</span>
              <button
                onClick={() => setShowLockupDetail(!showLockupDetail)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title="Toggle lockup breakdown"
              >
                {showLockupDetail ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <span className="font-mono font-semibold">{lockupHNS.toFixed(4)} HNS</span>
          </div>

          {/* Lockup breakdown (shown on toggle) */}
          {showLockupDetail && (
            <div className="mt-2 pl-5 space-y-1 text-xs text-gray-500 border-t border-gray-200 dark:border-gray-600 pt-2">
              <div className="flex justify-between">
                <span>True Bid (Value)</span>
                <span className="font-mono text-green-600 dark:text-green-400">{valueHNS.toFixed(4)} HNS</span>
              </div>
              <div className="flex justify-between">
                <span>Disguise (Blind)</span>
                <span className="font-mono text-amber-600 dark:text-amber-400">{blindHNS.toFixed(4)} HNS</span>
              </div>
              <div className="flex justify-between border-t border-dotted border-gray-200 dark:border-gray-600 pt-1 font-medium text-gray-700 dark:text-gray-300">
                <span>Total Lockup</span>
                <span className="font-mono">{lockupHNS.toFixed(4)} HNS</span>
              </div>
            </div>
          )}

          {/* Value row (always visible) */}
          <div className="flex items-center justify-between text-sm mt-1.5">
            <div className="flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5 text-green-500" />
              <span className="text-gray-600 dark:text-gray-400">True Bid</span>
            </div>
            <span className="font-mono font-semibold text-green-600 dark:text-green-400">
              {valueHNS.toFixed(4)} HNS
            </span>
          </div>

          {/* Revealed / Redeemed status */}
          {userBidData.revealed && (
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-green-600 dark:text-green-400">
              <Check className="w-3 h-3" />
              Bid revealed
            </div>
          )}
          {userBidData.redeemed && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
              <Check className="w-3 h-3" />
              Funds redeemed
            </div>
          )}
        </div>
      )}

      {/* ====================================================== */}
      {/* Phase-Specific Action */}
      {/* ====================================================== */}

      {/* OPENING / BIDDING: Place bid form */}
      {(phase === 'OPENING' || phase === 'BIDDING') && (
        <div>
          {!showBidForm ? (
            <button
              onClick={() => setShowBidForm(true)}
              className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Place Bid
            </button>
          ) : (
            <div className="space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  True Bid Amount <span className="text-gray-400 font-normal">(HNS)</span>
                </label>
                <input
                  type="number" value={bidInput} onChange={e => setBidInput(e.target.value)}
                  min="0.01" step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                  placeholder="e.g. 50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Lockup Amount <span className="text-gray-400 font-normal">(HNS, ≥ bid)</span>
                </label>
                <input
                  type="number" value={lockupInput} onChange={e => setLockupInput(e.target.value)}
                  min="0.01" step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                  placeholder="e.g. 100"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Lockup = True Bid + Disguise. Recommended: 2× your bid.
                </p>
              </div>
              {bidError && <div className="text-xs text-red-600">{bidError}</div>}
              <div className="flex gap-2">
                <button onClick={handlePlaceBid} disabled={isBusy}
                  className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1">
                  {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                  Submit Bid
                </button>
                <button onClick={() => { setShowBidForm(false); setBidError(null); }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* REVEAL: Show urgent reveal button */}
      {phase === 'REVEAL' && userBidData && !userBidData.revealed && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
            <Siren className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                Reveal Required
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-300 mt-0.5">
                Your bid must be revealed before the reveal period ends or funds are lost.
                {blocksRemaining !== null && blocksRemaining > 0 && (
                  <> <span className="font-bold">{blocksToTimeLeft(blocksRemaining, network)}</span> remaining.</>
                )}
              </p>
            </div>
          </div>
          <button onClick={handleReveal} disabled={isBusy}
            className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-lg shadow-orange-500/25">
            {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isBusy ? 'Revealing...' : 'Reveal Bid Now'}
          </button>
        </div>
      )}

      {/* REVEAL: Already revealed */}
      {phase === 'REVEAL' && userBidData?.revealed && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <Check className="w-4 h-4" />
          Bid revealed — awaiting auction close
        </div>
      )}

      {/* REDEEM: Reclaim losing bid funds */}
      {phase === 'REDEEM' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <DollarSign className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                Funds Available to Redeem
              </p>
              <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">
                You didn&apos;t win this auction. Your locked funds of{' '}
                <span className="font-bold">{lockupHNS.toFixed(4)} HNS</span> can be reclaimed.
              </p>
            </div>
          </div>
          <button onClick={handleRedeem} disabled={isBusy}
            className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
            {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isBusy ? 'Redeeming...' : `Redeem ${lockupHNS.toFixed(4)} HNS`}
          </button>
        </div>
      )}

      {/* CLOSED + Won: Register the name */}
      {phase === 'CLOSED' && userBidData?.isWinner === true && (
        <div className="space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              DNS Records (JSON, optional)
            </label>
            <textarea
              value={dnsRecords}
              onChange={e => setDnsRecords(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm font-mono"
              rows={2}
              placeholder='[{"type":"NS","ns":"ns1.example.com"}]'
            />
          </div>
          <button onClick={handleRegister} disabled={isBusy}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
            {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
            Claim & Register Name
          </button>
        </div>
      )}

      {/* CLOSED: No user involvement */}
      {phase === 'CLOSED' && (!userBidData || userBidData.isWinner !== true) && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Auction closed
        </div>
      )}

      {/* ====================================================== */}
      {/* Action Result */}
      {/* ====================================================== */}
      {actionResult && (
        <div className={`mt-2 text-xs ${currentAction.ok ? 'text-green-600' : 'text-red-600'}`}>
          {currentAction.ok ? (
            <span className="flex items-center gap-1"><Check className="w-3 h-3" />{currentAction.msg}</span>
          ) : (
            <span className="flex items-center gap-1"><X className="w-3 h-3" />{currentAction.msg}</span>
          )}
        </div>
      )}

      {/* ====================================================== */}
      {/* Non-urgent attention: Next phase countdown */}
      {/* ====================================================== */}
      {!isUrgent && blocksRemaining !== null && blocksRemaining > 0 && (
        <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
          <Clock className="w-3 h-3" />
          {phase === 'OPENING' && `Bidding starts in ${blocksToTimeLeft(blocksRemaining, network)}`}
          {phase === 'BIDDING' && `Reveal in ${blocksToTimeLeft(blocksRemaining, network)}`}
          {phase === 'REVEAL' && `Closes in ${blocksToTimeLeft(blocksRemaining, network)}`}
        </div>
      )}
    </div>
  );
}
