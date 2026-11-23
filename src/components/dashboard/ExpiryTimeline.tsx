/**
 * Expiry Timeline Component (Dashboard)
 *
 * Shows names expiring in 30/60/90 days with visual bar.
 */

import { Link } from 'react-router-dom';

interface ExpiryTimelineProps {
  critical: number;
  warning: number;
}

export function ExpiryTimeline({ critical, warning }: ExpiryTimelineProps) {
  const total = critical + warning;
  const criticalPct = total > 0 ? (critical / total) * 100 : 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Expiry Timeline</h3>
        <Link to="/domains" className="text-sm text-hns-600 hover:underline">
          View All
        </Link>
      </div>

      {total === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No names expiring soon
        </div>
      ) : (
        <div className="space-y-4">
          {/* Visual bar */}
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-red-500 transition-all"
              style={{ width: `${criticalPct}%` }}
            />
            <div
              className="h-full bg-amber-400 transition-all"
              style={{ width: `${100 - criticalPct}%` }}
            />
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded" />
              <div>
                <div className="font-semibold">{critical}</div>
                <div className="text-xs text-gray-500">Critical (30 days)</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-amber-400 rounded" />
              <div>
                <div className="font-semibold">{warning}</div>
                <div className="text-xs text-gray-500">Warning (60 days)</div>
              </div>
            </div>
          </div>

          {/* Action */}
          {critical > 0 && (
            <button className="w-full mt-2 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
              Renew {critical} Critical Names
            </button>
          )}
        </div>
      )}
    </div>
  );
}
