/**
 * Header Component
 *
 * Top header bar with page title and global actions.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHSD } from '../../hooks/useHSD';
import { useConnectionStore } from '../../stores/connection-store';
import {
  useNotificationStore,
  NOTIFICATION_LINKS,
  type NotificationCategory,
} from '../../stores/notification-store';
import { RefreshCw, Bell, CheckCircle2, Sun, Moon, X } from 'lucide-react';
import { useThemeStore } from '../../stores/theme-store';

// Color/style mapping for each category — drives the chip in the bell dropdown.
const CATEGORY_BADGE: Record<NotificationCategory, { label: string; cls: string; icon: string }> = {
  reveal:            { label: 'Reveal',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',  icon: '⏱️' },
  redeem:            { label: 'Redeem',   cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',  icon: '💰' },
  register:          { label: 'Claim',    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',      icon: '🏆' },
  finalize:          { label: 'Finalize', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300', icon: '📋' },
  'expire-critical': { label: 'Expiry',   cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',          icon: '⚠️' },
  'expire-warning':  { label: 'Expiry',   cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300', icon: '🕒' },
  watchlist:         { label: 'Watchlist', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200',      icon: '👀' },
  general:           { label: 'Info',     cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200',      icon: 'ℹ️' },
};

export function Header() {
  const { blockHeight, connectionState, isLoggedIn } = useHSD();
  const refreshNodeInfo = useConnectionStore((s) => s.refreshNodeInfo);
  const chainSynced = useConnectionStore((s) => s.chainSynced);
  const walletHeight = useConnectionStore((s) => s.walletHeight);
  const network = useConnectionStore((s) => s.network || 'main');
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const dismiss = useNotificationStore((s) => s.dismiss);

  // Derived: count of notifications where read === false.
  // Using useMemo with notifications as a dep so the bell badge
  // re-renders whenever the store changes.
  const unreadCount = useMemo(
    () => notifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0),
    [notifications],
  );

  // Never leave wallet notifications open across a logout.
  useEffect(() => {
    if (!isLoggedIn) setShowNotifs(false);
  }, [isLoggedIn]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        showNotifs &&
        notifRef.current &&
        btnRef.current &&
        !notifRef.current.contains(e.target as Node) &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setShowNotifs(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNotifs]);

  const handleNotifClick = (id: string, category: NotificationCategory) => {
    markAsRead(id);
    setShowNotifs(false);
    const link = NOTIFICATION_LINKS[category];
    if (link) navigate(link);
  };

  return (
    <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        {connectionState === 'connected' && (
          <>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
              network === 'main'
                ? 'bg-hns-50 text-hns-700 dark:bg-hns-900/30 dark:text-hns-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
            }`}>
              {network === 'main' ? 'Mainnet' : network === 'testnet' ? 'Testnet' : 'Regtest'}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Block: {blockHeight.toLocaleString()}
            </span>
            {(() => {
              const catchingUp = walletHeight > 0 && walletHeight < blockHeight - 3;
              const progress = catchingUp
                ? Math.round((walletHeight / blockHeight) * 100)
                : 100;
              return catchingUp ? (
                <div className="flex items-center gap-1.5" title={`Wallet at block ${walletHeight.toLocaleString()} of ${blockHeight.toLocaleString()}`}>
                  <div className="w-24 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-hns-500 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-hns-600 font-medium">
                    {progress}%
                  </span>
                </div>
              ) : chainSynced ? (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Synced
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-hns-600 font-medium">
                  <div className="w-24 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-hns-500 rounded-full transition-all duration-500" style={{ width: '99%' }} />
                  </div>
                  99%
                </span>
              );
            })()}
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <button
          onClick={() => refreshNodeInfo()}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          title="Refresh sync status"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
        {isLoggedIn && (
        <div className="relative">
          <button
            ref={btnRef}
            onClick={() => setShowNotifs(v => !v)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors relative"
            title="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifs && (
            <div
              ref={notifRef}
              className="absolute right-0 top-full mt-2 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <span className="text-sm font-semibold">Notifications</span>
                <div className="flex gap-3">
                  {unreadCount > 0 && (
                    <button onClick={markAllAsRead} className="text-xs text-hns-600 hover:underline">
                      Mark all read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button onClick={clearAll} className="text-xs text-gray-400 hover:underline">
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-400">
                    No notifications yet
                  </div>
                ) : (
                  notifications.map((n) => {
                    const badge = CATEGORY_BADGE[n.category] ?? CATEGORY_BADGE.general;
                    return (
                      <div
                        key={n.id}
                        className={`relative px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${n.read ? '' : 'bg-hns-50 dark:bg-hns-900/10'}`}
                        onClick={() => handleNotifClick(n.id, n.category)}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dismiss(n.id);
                          }}
                          className="absolute top-2 right-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400"
                          title="Dismiss"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="flex items-start gap-2 pr-6">
                          <span className="text-lg shrink-0 mt-0.5" aria-hidden>{badge.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-hns-500 flex-shrink-0" />}
                              <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.cls}`}>
                                {badge.label}
                              </span>
                              {n.count != null && n.count > 0 && (
                                <span className="text-[10px] text-gray-500">×{n.count}</span>
                              )}
                            </div>
                            <p className="text-sm font-medium mt-0.5">{n.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-words">{n.message}</p>
                            {n.names && n.names.length > 0 && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono truncate">
                                {n.names.slice(0, 3).join(', ')}{n.names.length > 3 ? `, +${n.names.length - 3} more` : ''}
                              </p>
                            )}
                            <p className="text-[10px] text-gray-400 mt-1">
                              {new Date(n.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </header>
  );
}
