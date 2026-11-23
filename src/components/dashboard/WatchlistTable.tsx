/**
 * Watchlist Table Component
 */

import { Bell } from 'lucide-react';
import type { WatchlistEntry } from '../../stores/watchlist-store';
import { getStateLabel, getStateBgColor } from '../../lib/name-utils';

interface WatchlistTableProps {
  entries: WatchlistEntry[];
  isLoading: boolean;
  onRemove: (name: string) => void;
}

const NOTIFY_LABELS: Record<string, string> = {
  none: '',
  bidding: 'Notify on Bidding',
  available: 'Notify on Available',
};

export function WatchlistTable({ entries, isLoading, onRemove }: WatchlistTableProps) {
  if (isLoading) {
    return <div className="p-4 text-center text-gray-500">Loading...</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500">
        No names in watchlist. Add names to track their availability.
      </div>
    );
  }

  return (
    <div className="table-container">
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-900">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
            <th className="px-4 py-3 text-left text-sm font-medium">State</th>
            <th className="px-4 py-3 text-left text-sm font-medium">Notify</th>
            <th className="px-4 py-3 text-left text-sm font-medium">Notes</th>
            <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {entries.map((entry) => (
            <tr key={entry.name} className="hover:bg-gray-50 dark:hover:bg-gray-900">
              <td className="px-4 py-3 font-mono text-sm">{entry.name}</td>
              <td className="px-4 py-3">
                {entry.liveState && (
                  <span className={`state-badge ${getStateBgColor(entry.liveState.status)}`}>
                    {getStateLabel(entry.liveState.status)}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                {entry.notifyOn !== 'none' && (
                  <span className="inline-flex items-center gap-1 text-xs text-hns-600" title={NOTIFY_LABELS[entry.notifyOn]}>
                    <Bell className="w-3 h-3" />
                    {entry.notifyOn === 'bidding' ? 'Bidding' : 'Available'}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">{entry.notes || '-'}</td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => onRemove(entry.name)}
                  className="text-red-600 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
