/**
 * Watchlist Store (Zustand)
 *
 * Manages the watchlist -- names the user doesn't own but wants to track.
 * Watchlist data is stored in local SQLite via the db service.
 */

import { create } from 'zustand';
import type { NameLookupResult } from '../types/search';
import { useNotificationStore } from './notification-store';
import { getStateLabel } from '../lib/name-utils';

export interface WatchlistEntry {
  name: string;
  notes: string;
  notifyOn: 'none' | 'bidding' | 'available';
  addedAt: string;
  /** Live state from last check (fetched on refresh) */
  liveState: NameLookupResult | null;
}

interface WatchlistStore {
  // State
  entries: WatchlistEntry[];
  isLoading: boolean;
  error: string | null;

  // Actions
  /** Fetch watchlist from database */
  fetchWatchlist: () => Promise<void>;
  /** Add a name to the watchlist */
  addName: (name: string, notes?: string, notifyOn?: 'none' | 'bidding' | 'available') => Promise<void>;
  /** Remove a name from the watchlist */
  removeName: (name: string) => Promise<void>;
  /** Refresh live state for all watchlist names */
  refreshStates: () => Promise<void>;
  /** Import names to watchlist from a list */
  importNames: (names: string[]) => Promise<void>;
}

export const useWatchlistStore = create<WatchlistStore>((set, get) => ({
  entries: [],
  isLoading: false,
  error: null,

  fetchWatchlist: async () => {
    set({ isLoading: true });
    try {
      const rawEntries = await window.api.db.getWatchlist();
      const entries = rawEntries.map(e => ({ ...e, notifyOn: (e.notifyOn || 'none') as 'none' | 'bidding' | 'available', liveState: null }));
      set({ entries, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  },

  addName: async (name, notes, notifyOn) => {
    await window.api.db.addToWatchlist(name, notes, notifyOn);
    await get().fetchWatchlist();
  },

  removeName: async (name) => {
    await window.api.db.removeFromWatchlist(name);
    set((state) => ({ entries: state.entries.filter((e) => e.name !== name) }));
  },

  refreshStates: async () => {
    const entries = get().entries;
    const notify = useNotificationStore.getState().pushNotification;
    for (let i = 0; i < entries.length; i++) {
      const prevState = entries[i].liveState?.status;
      try {
        const liveState = await window.api.node.getNameInfo(entries[i].name);
        entries[i].liveState = liveState;
        const newState = liveState.status;

        if (prevState && prevState !== newState && entries[i].notifyOn !== 'none') {
          if (entries[i].notifyOn === 'bidding' && newState === 'BIDDING') {
            notify({
              name: entries[i].name,
              category: 'watchlist',
              title: 'Watchlist update',
              message: `${entries[i].name} is now Bidding (was ${getStateLabel(prevState)})`,
            });
          } else if (entries[i].notifyOn === 'available' && newState === 'AVAILABLE') {
            notify({
              name: entries[i].name,
              category: 'watchlist',
              title: 'Watchlist update',
              message: `${entries[i].name} is now Available (was ${getStateLabel(prevState)})`,
            });
          }
        }
      } catch {
        entries[i].liveState = null;
      }
    }
    set({ entries: [...entries] });
  },

  importNames: async (names) => {
    const existing = new Set(get().entries.map(e => e.name));
    const newNames = names.filter(n => !existing.has(n));
    for (const name of newNames) {
      await window.api.db.addToWatchlist(name);
    }
    if (newNames.length > 0) {
      await get().fetchWatchlist();
    }
  },
}));
