/**
 * Watchlist Page
 *
 * Track names you don't own but want to monitor.
 *
 * TODO: Implementation:
 * 1. Show watchlist table with name, state, notes
 * 2. Add name to watchlist
 * 3. Refresh live state for all watchlist names
 * 4. Remove from watchlist
 * 5. Import/export watchlist
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionStore } from '../stores/connection-store';
import { useWatchlistStore } from '../stores/watchlist-store';
import { WatchlistTable } from '../components/dashboard/WatchlistTable';
import { AddWatchlistModal } from '../components/dashboard/AddWatchlistModal';

export function Watchlist() {
  const { connectionState } = useConnectionStore();
  const { fetchWatchlist, refreshStates, addName, removeName, entries, isLoading } = useWatchlistStore();
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Auto-poll states every 30s
  useEffect(() => {
    const interval = setInterval(() => { refreshStates(); }, 30_000);
    return () => clearInterval(interval);
  }, [refreshStates]);

  const handleAdd = async (name: string, notes?: string, notifyOn?: 'none' | 'bidding' | 'available') => {
    await addName(name, notes, notifyOn);
    setShowAddModal(false);
  };

  if (connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Connect to your Handshake node to manage your watchlist.
        </p>
        <Link
          to="/settings"
          className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors"
        >
          Go to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Watchlist</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Track names you don&apos;t own
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refreshStates()}
            className="px-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Refresh All
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-sm bg-hns-600 text-white rounded-lg hover:bg-hns-700"
          >
            Add Name
          </button>
        </div>
      </div>

      <WatchlistTable
        entries={entries}
        isLoading={isLoading}
        onRemove={removeName}
      />

      {showAddModal && (
        <AddWatchlistModal
          onAdd={handleAdd}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
