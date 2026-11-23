/**
 * useNotificationSubscription
 *
 * Bridges the `notification` IPC events from the main process into the
 * renderer-side `useNotificationStore`. Mount it once at the top of the
 * React tree (e.g. in `Layout.tsx`) so the bell dropdown stays in sync
 * for the lifetime of the app, regardless of which page is active.
 *
 * The main process already de-duplicates by count, so we get one event
 * when a pending count first goes non-zero, another when the count
 * changes (e.g. user reveals one of three bids), and no spam in between.
 */

import { useEffect } from 'react';
import { useNotificationStore } from '../stores/notification-store';
import type { NotificationCategory } from '../stores/notification-store';

type PayloadKind = 'reveal' | 'redeem' | 'register' | 'finalize' | 'expire-critical' | 'expire-warning' | 'general';

function isPayloadKind(value: string): value is PayloadKind {
  return [
    'reveal',
    'redeem',
    'register',
    'finalize',
    'expire-critical',
    'expire-warning',
    'general',
  ].includes(value);
}

function mapKindToCategory(kind: string): NotificationCategory {
  if (isPayloadKind(kind)) {
    // 'expire-critical' / 'expire-warning' / 'finalize' / 'general' / 'reveal' /
    // 'redeem' / 'register' are all valid NotificationCategory values.
    return kind;
  }
  return 'general';
}

export function useNotificationSubscription(): void {
  useEffect(() => {
    if (!window.api?.on?.notification) return;

    const unsubscribe = window.api.on.notification((message) => {
      const category = mapKindToCategory(message.kind);
      const names = Array.isArray(message.names) ? message.names : [];

      useNotificationStore.getState().pushNotification({
        category,
        title: message.title,
        message: message.body,
        count: message.count,
        names,
        name: names[0],
      });
    });

    return unsubscribe;
  }, []);
}
