import { Check, Clock, X, Loader2 } from 'lucide-react';
import type { LocalSwap } from '../../types/swap';
import { getSwapProgressState, SWAP_PROGRESS_STEPS } from '../../lib/swap-progress';

export function SwapProgressWizard({ swap }: { swap: LocalSwap }) {
  const { currentIdx, failed } = getSwapProgressState(swap.state);

  return (
    <div className="space-y-2">
      {SWAP_PROGRESS_STEPS.map((step, idx) => {
        const isActive = !failed && currentIdx >= idx;
        const isCurrent = !failed && currentIdx === idx;
        const isCompleted = !failed && currentIdx > idx;

        let icon;
        if (failed) icon = <X className="w-4 h-4 text-red-500" />;
        else if (isCompleted) icon = <Check className="w-4 h-4 text-green-500" />;
        else if (isCurrent) icon = <Loader2 className="w-4 h-4 text-hns-500 animate-spin" />;
        else icon = <Clock className="w-4 h-4 text-gray-300" />;

        return (
          <div key={step.label} className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">{icon}</div>
            <div>
              <span className={`text-sm font-medium ${isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}`}>
                {step.label}
              </span>
              <p className="text-xs text-gray-400">{step.description}</p>
            </div>
          </div>
        );
      })}
      {failed && (
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <X className="w-4 h-4 text-red-500" />
          </div>
          <div>
            <span className="text-sm font-medium text-red-600">
              {swap.state === 'refunded' ? 'Refunded' : swap.state === 'refunding' ? 'Refunding' : 'Failed'}
            </span>
            <p className="text-xs text-gray-400">
              {swap.hnsRefundTxid
                ? 'HNS was refunded.'
                : swap.dgbRefundTxid
                  ? 'DGB was refunded.'
                  : 'The swap did not complete.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
