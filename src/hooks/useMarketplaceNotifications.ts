/**
 * Keeps the marketplace purchase-request count fresh outside the Marketplace
 * page and clears marketplace data when the wallet session ends.
 */

import { useEffect } from 'react';
import { useConnectionStore } from '../stores/connection-store';
import { useMarketplaceStore } from '../stores/marketplace-store';

const POLL_INTERVAL = 60_000;

export function useMarketplaceNotifications(): number {
  const sessionActive = useConnectionStore(
    (s) => s.connectionState === 'connected' && s.isLoggedIn,
  );
  const fetchPurchaseRequests = useMarketplaceStore((s) => s.fetchPurchaseRequests);
  const pendingCount = useMarketplaceStore(
    (s) => s.purchaseRequests.filter((r) => r.status === 'pending').length,
  );

  useEffect(() => {
    if (!sessionActive) {
      // Do not leave another session's listings/purchases visible after a
      // logout or node stop.
      useMarketplaceStore.setState({
        myListings: [],
        offers: [],
        purchaseRequests: [],
        myPurchases: [],
      });
      return;
    }

    fetchPurchaseRequests();
    const id = setInterval(fetchPurchaseRequests, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [sessionActive, fetchPurchaseRequests]);

  return sessionActive ? pendingCount : 0;
}
