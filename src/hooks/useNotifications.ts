import { useEffect, useState } from 'react';
import { useConnectionStore } from '../stores/connection-store';
import { EXPIRY_THRESHOLDS, daysToBlocks } from '../lib/constants';


interface ExpiringNames {
  critical: number;
  warning: number;
  notice: number;
}

interface PendingActions {
  pendingReveals: number;
  pendingRedeems: number;
  pendingRegistrations: number;
  pendingFinalizations: number;
}

export function useNotifications() {
  const { blockHeight, connectionState } = useConnectionStore();
  const [pendingActions, setPendingActions] = useState<PendingActions>({
    pendingReveals: 0, pendingRedeems: 0, pendingRegistrations: 0, pendingFinalizations: 0,
  });
  const [expiringFromApi, setExpiringFromApi] = useState<{ critical: number; warning: number; notice: number }>({
    critical: 0, warning: 0, notice: 0,
  });

  useEffect(() => {
    if (connectionState !== 'connected') return;
    const fetch = async () => {
      try {
        const actions = await window.api.notifications.getPendingActions();
        setPendingActions(actions);
        const exp = await window.api.notifications.getExpiring();
        setExpiringFromApi({ critical: exp.critical.length, warning: exp.warning.length, notice: exp.notice.length });
      } catch {
        // ignore
      }
    };
    fetch();
    const interval = setInterval(fetch, 60000);
    return () => clearInterval(interval);
  }, [connectionState]);

  const getExpiringNamesCount = (domains: Array<{ expiryBlock: number }>): ExpiringNames => {
    if (connectionState !== 'connected') {
      return { critical: 0, warning: 0, notice: 0 };
    }

    let critical = 0;
    let warning = 0;
    let notice = 0;

    const criticalBlocks = daysToBlocks(EXPIRY_THRESHOLDS.critical);
    const warningBlocks = daysToBlocks(EXPIRY_THRESHOLDS.warning);
    const noticeBlocks = daysToBlocks(EXPIRY_THRESHOLDS.notice);

    for (const domain of domains) {
      const remaining = domain.expiryBlock - blockHeight;
      if (remaining <= criticalBlocks) critical++;
      else if (remaining <= warningBlocks) warning++;
      else if (remaining <= noticeBlocks) notice++;
    }

    return { critical, warning, notice };
  };

  return {
    getExpiringNamesCount,
    pendingActions,
    expiringFromApi,
  };
}