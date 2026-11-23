/**
 * Pending Actions Component (Dashboard)
 *
 * Shows actions that require user attention, sourced from
 * `window.api.notifications.getPendingActions()`. Each row is a
 * distinct user action with a single CTA that navigates to the
 * appropriate page (typically `/auctions`).
 *
 * Action types surfaced:
 *   - REVEAL  — bid in REVEAL phase awaiting `sendreveal`
 *   - REDEEM  — losing bid awaiting `sendredeem`
 *   - REGISTER — winning bid awaiting `sendupdate` to claim the name
 */

import { Link } from 'react-router-dom';

interface PendingActionsProps {
  pendingReveals: number;
  pendingRedeems: number;
  pendingRegistrations: number;
}

interface RowConfig {
  count: number;
  label: string;
  cta: string;
  ctaCls: string;
  icon: string;
  rowCls: string;
  iconWrap: string;
  iconCls: string;
}

function rowConfig(
  count: number,
  kind: 'reveal' | 'redeem' | 'register',
): RowConfig {
  if (kind === 'reveal') {
    return {
      count,
      label: 'Bids to Reveal',
      cta: 'Reveal',
      ctaCls: 'bg-amber-600 text-white hover:bg-amber-700',
      icon: '⏱️',
      rowCls: 'bg-amber-50 dark:bg-amber-900/20',
      iconWrap: 'bg-amber-100 dark:bg-amber-900',
      iconCls: 'text-amber-600 dark:text-amber-300',
    };
  }
  if (kind === 'redeem') {
    return {
      count,
      label: 'Funds to Recover',
      cta: 'Redeem',
      ctaCls: 'bg-green-600 text-white hover:bg-green-700',
      icon: '💰',
      rowCls: 'bg-green-50 dark:bg-green-900/20',
      iconWrap: 'bg-green-100 dark:bg-green-900',
      iconCls: 'text-green-600 dark:text-green-300',
    };
  }
  return {
    count,
    label: 'Wins to Claim',
    cta: 'Claim',
    ctaCls: 'bg-blue-600 text-white hover:bg-blue-700',
    icon: '🏆',
    rowCls: 'bg-blue-50 dark:bg-blue-900/20',
    iconWrap: 'bg-blue-100 dark:bg-blue-900',
    iconCls: 'text-blue-600 dark:text-blue-300',
  };
}

export function PendingActions({
  pendingReveals,
  pendingRedeems,
  pendingRegistrations,
}: PendingActionsProps) {
  const total = pendingReveals + pendingRedeems + pendingRegistrations;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Pending Actions</h3>
        <Link to="/auctions" className="text-sm text-hns-600 hover:underline">
          View All
        </Link>
      </div>

      {total === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No pending actions
        </div>
      ) : (
        <div className="space-y-3">
          {(
            [
              ['reveal', pendingReveals],
              ['redeem', pendingRedeems],
              ['register', pendingRegistrations],
            ] as const
          )
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => {
              const cfg = rowConfig(count, kind);
              return (
                <div
                  key={kind}
                  className={`flex items-center justify-between p-3 rounded-lg ${cfg.rowCls}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${cfg.iconWrap}`}>
                      <span className="text-lg">{cfg.icon}</span>
                    </div>
                    <div>
                      <div className="font-medium">{cfg.count}</div>
                      <div className="text-sm text-gray-500">{cfg.label}</div>
                    </div>
                  </div>
                  <Link
                    to="/auctions"
                    className={`px-3 py-1.5 text-sm rounded-lg ${cfg.ctaCls}`}
                  >
                    {cfg.cta}
                  </Link>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
