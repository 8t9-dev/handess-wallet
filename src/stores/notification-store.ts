import { create } from 'zustand';

/**
 * Notification categories.
 *
 * Each one maps to a specific user action:
 *   - 'reveal'        — bids in REVEAL phase that need `sendreveal` to recover lockup
 *   - 'redeem'        — losing bids in CLOSED phase with locked funds awaiting `sendredeem`
 *   - 'register'      — winning bids awaiting `sendupdate` to claim the name
 *   - 'finalize'      — name transfers awaiting `sendfinalize`
 *   - 'expire-critical' — owned name within 720 blocks of expiry (~5 days)
 *   - 'expire-warning'  — owned name within 1440 blocks of expiry (~10 days)
 *   - 'watchlist'     — watchlist event (existing behaviour, kept for back-compat)
 *   - 'general'       — generic info notifications
 */
export type NotificationCategory =
  | 'reveal'
  | 'redeem'
  | 'register'
  | 'finalize'
  | 'expire-critical'
  | 'expire-warning'
  | 'watchlist'
  | 'general';

/**
 * Human-readable label for each category.
 * Used in the bell dropdown and the dashboard widget.
 */
export const NOTIFICATION_LABELS: Record<NotificationCategory, string> = {
  reveal: 'Reveal',
  redeem: 'Redeem',
  register: 'Claim',
  finalize: 'Finalize',
  'expire-critical': 'Expiry',
  'expire-warning': 'Expiry',
  watchlist: 'Watchlist',
  general: 'Info',
};

/**
 * Where the user should land when they click a notification of this category.
 * The renderer uses this to set the bell item's onClick.
 */
export const NOTIFICATION_LINKS: Record<NotificationCategory, string> = {
  reveal: '/auctions',
  redeem: '/auctions',
  register: '/auctions',
  finalize: '/auctions',
  'expire-critical': '/domains',
  'expire-warning': '/domains',
  watchlist: '/watchlist',
  general: '/dashboard',
};

export interface AppNotification {
  id: string;
  /** Optional: a specific name the notification refers to (e.g. an expiring name). */
  name?: string;
  /** Optional: a list of names, for aggregate notifications (e.g. "3 bids to reveal"). */
  names?: string[];
  category: NotificationCategory;
  title: string;
  message: string;
  count?: number;
  timestamp: string;
  read: boolean;
}

interface NotificationStore {
  notifications: AppNotification[];
  pushNotification: (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  /** Remove a single notification by id. */
  dismiss: (id: string) => void;
  /** Remove all notifications of a given category. */
  clearByCategory: (category: NotificationCategory) => void;
}

let notifId = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  pushNotification: (n) => {
    notifId += 1;
    const notification: AppNotification = {
      ...n,
      id: `notif-${notifId}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    set((s) => ({ notifications: [notification, ...s.notifications].slice(0, 100) }));
  },

  markAsRead: (id) => {
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }));
  },

  markAllAsRead: () => {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },

  dismiss: (id) => {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  clearByCategory: (category) => {
    set((s) => ({
      notifications: s.notifications.filter((n) => n.category !== category),
    }));
  },
}));
