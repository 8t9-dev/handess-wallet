import type { AuctionPhase } from '../../types/auction';
import { AUCTION_PHASES, getPhaseLabel } from '../../lib/name-utils';

interface AuctionPhaseStepperProps {
  currentPhase: AuctionPhase;
  /** If true, always show all 5 phases. If false, collapse after current phase. */
  showAll?: boolean;
  /** If true, apply urgent visual treatment (used for REVEAL with unrevealed bid) */
  urgent?: boolean;
}

/**
 * Chevron-style auction phase progress indicator.
 *
 * Visually maps the HSD auction lifecycle as a segmented process bar:
 *   [OPENING] > [BIDDING] > [REVEAL] > [REDEEM] > [CLOSED]
 *
 * Bob Wallet alignment: app/components/AuctionGraph (progress bars)
 * Enhanced with: step-by-step chevron segments, Lockup/Value distinction,
 * urgent action flags.
 */
export function AuctionPhaseStepper({
  currentPhase,
  showAll = true,
  urgent = false,
}: AuctionPhaseStepperProps) {
  const currentIndex = AUCTION_PHASES.indexOf(currentPhase);

  // Determine which phases to show
  const phases = showAll
    ? AUCTION_PHASES
    : AUCTION_PHASES.slice(0, currentIndex + 1);

  // Collapse REDEEM into CLOSED if user has no losing bids
  const filteredPhases = phases.filter(p => {
    if (p === 'REDEEM' && currentPhase !== 'REDEEM' && currentPhase !== 'CLOSED') {
      return showAll;
    }
    return true;
  });

  return (
    <div
      className={`flex items-center w-full ${urgent ? 'animate-pulse' : ''}`}
      role="progressbar"
      aria-label={`Auction phase: ${getPhaseLabel(currentPhase)}`}
      aria-valuemin={0}
      aria-valuemax={AUCTION_PHASES.length - 1}
      aria-valuenow={currentIndex}
    >
      {filteredPhases.map((phase, idx) => {
        const phaseIndex = AUCTION_PHASES.indexOf(phase);
        const isPast = phaseIndex < currentIndex;
        const isCurrent = phase === currentPhase;
        const isFuture = phaseIndex > currentIndex;

        return (
          <div key={phase} className="flex items-center flex-1">
            {/* Phase segment */}
            <div
              className={`
                relative flex items-center justify-center h-8 px-3 text-xs font-semibold
                transition-all duration-300
                ${isPast
                  ? 'bg-hns-600 text-white'
                  : isCurrent
                    ? urgent
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/50 scale-105 z-10'
                      : 'bg-hns-500 text-white shadow-md z-10'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }
                ${idx === 0 ? 'rounded-l-lg' : ''}
                ${idx === filteredPhases.length - 1 ? 'rounded-r-lg' : ''}
                ${isFuture ? 'opacity-40' : ''}
                flex-1
              `}
            >
              <span className="truncate">{getPhaseLabel(phase)}</span>

              {/* Chevron-style arrow connector (after each segment except last) */}
              {idx < filteredPhases.length - 1 && (
                <div
                  className={`
                    absolute -right-2 top-0 w-0 h-0
                    border-t-[16px] border-b-[16px] border-l-[8px]
                    ${isPast || (isCurrent && phaseIndex + 1 === currentIndex)
                      ? 'border-l-hns-600'
                      : isCurrent
                        ? 'border-l-hns-500'
                        : 'border-l-gray-200 dark:border-l-gray-700'
                    }
                    z-20
                  `}
                  style={{
                    borderTopColor: 'transparent',
                    borderBottomColor: 'transparent',
                  }}
                />
              )}
            </div>

            {/* Inter-segment gap filler (cover the arrows) */}
            {idx < filteredPhases.length - 1 && (
              <div
                className={`
                  w-2 h-8 -ml-2 -mr-2 z-10 shrink-0
                  ${isPast
                    ? 'bg-hns-600'
                    : isCurrent
                      ? 'bg-hns-500'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }
                  ${isFuture ? 'opacity-40' : ''}
                `}
                style={{
                  clipPath: 'polygon(0 0, 100% 50%, 0 100%)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Compact dot-style stepper for table/list views.
 * Shows colored dots for each completed step and a pulsing dot for current.
 */
export function AuctionPhaseDots({
  currentPhase,
  urgent = false,
}: {
  currentPhase: AuctionPhase;
  urgent?: boolean;
}) {
  const currentIndex = AUCTION_PHASES.indexOf(currentPhase);

  return (
    <div className="flex items-center gap-1" aria-label={`Phase: ${getPhaseLabel(currentPhase)}`}>
      {AUCTION_PHASES.map((phase, idx) => {
        const isPast = idx < currentIndex;
        const isCurrent = idx === currentIndex;
        const isUrgent = isCurrent && urgent && phase === 'REVEAL';
        const isRedeemOrClosed = phase === 'REDEEM' || phase === 'CLOSED';

        let dotClass = 'w-2 h-2 rounded-full ';
        if (isPast) {
          dotClass += 'bg-hns-500';
        } else if (isCurrent) {
          dotClass += isUrgent
            ? 'bg-orange-500 animate-pulse ring-2 ring-orange-300'
            : 'bg-hns-500 ring-2 ring-hns-300';
        } else {
          dotClass += isRedeemOrClosed ? 'bg-gray-300 dark:bg-gray-600' : 'bg-gray-300 dark:bg-gray-600';
        }

        return (
          <div key={phase} className="flex items-center">
            <div className={dotClass} title={getPhaseLabel(phase)} />
            {idx < AUCTION_PHASES.length - 1 && (
              <div
                className={`w-2 h-px mx-0.5 ${
                  idx < currentIndex
                    ? 'bg-hns-400'
                    : 'bg-gray-300 dark:bg-gray-600'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
