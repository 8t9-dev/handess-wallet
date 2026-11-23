import { useEffect, useState, useMemo } from 'react';
import { useConnectionStore } from '../stores/connection-store';
import { useDomainsStore } from '../stores/domains-store';
import { useAuctionsStore } from '../stores/auctions-store';
import { useMarketplaceStore } from '../stores/marketplace-store';
import { PortfolioSummary } from '../components/dashboard/PortfolioSummary';
import { ExpiryTimeline } from '../components/dashboard/ExpiryTimeline';
import { PendingActions } from '../components/dashboard/PendingActions';
import { useHnsPrice } from '../hooks/useHnsPrice';

import { Link } from 'react-router-dom';
import { dollaryDoosToHNS } from '../lib/name-utils';
import { copyText } from '../lib/clipboard';

interface TxRecord {
  hash: string;
  height: number | null;
  time: number;
  amount: number;
  fee: number;
  confirmations: number;
  rowId?: string;
}

// Re-export bucketAuctions for dashboard to use same logic as Auctions page
function bucketAuctionsDashboard(auctions: Array<{
  name?: string;
  userBidData?: { isWinner?: boolean | null; redeemed?: boolean; revealed?: boolean };
  blockchainState: 'OPENING' | 'BIDDING' | 'REVEAL' | 'REDEEM' | 'CLOSED';
}>, justRegistered: string[]): {
  pendingReveals: number;
  pendingRedeems: number;
  pendingRegistrations: number;
} {
  let pendingReveals = 0;
  let pendingRedeems = 0;
  let pendingRegistrations = 0;

  for (const a of auctions) {
    const hasUserBid = !!a.userBidData;
    if (!hasUserBid) continue;

    const isWinner = a.userBidData?.isWinner === true;
    const redeemed = a.userBidData?.redeemed === true;
    const isRevealed = a.userBidData?.revealed === true;
    const isJustRegistered = a.name ? justRegistered.includes(a.name) : false;
    const isSettled = redeemed || isJustRegistered;
    const phase = a.blockchainState;

    switch (phase) {
      case 'REVEAL':
        if (!isRevealed) pendingReveals++;
        break;
      case 'REDEEM':
        if (!redeemed) pendingRedeems++;
        break;
      case 'CLOSED':
        if (isWinner) {
          if (!isSettled) pendingRegistrations++;
        } else if (!redeemed) {
          pendingRedeems++;
        }
        break;
    }
  }

  return { pendingReveals, pendingRedeems, pendingRegistrations };
}

export function Dashboard() {
  const { connectionState, balance, blockHeight, walletInfo, config } = useConnectionStore();
  const { domains, fetchDomains } = useDomainsStore();
  const { price: hnsPrice } = useHnsPrice();
  const { unifiedAuctions, loadJustRevealed, loadJustRedeemed, justRegistered, loadJustRegistered } = useAuctionsStore();
  const {
    myListings,
    purchaseRequests,
    fetchMyListings,
    fetchPurchaseRequests,
  } = useMarketplaceStore();
  const [stats, setStats] = useState({
    totalDomains: 0,
    expiringCritical: 0,
    expiringWarning: 0,
    expiringNotice: 0,
    pendingReveals: 0,
    pendingRedeems: 0,
    pendingRegistrations: 0,
  });
  const [recentTxs, setRecentTxs] = useState<TxRecord[]>([]);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  

  const copyToClipboard = async (hash: string, key: string) => {
    if (!(await copyText(hash))) return;
    setCopiedHash(key);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  useEffect(() => {
    if (connectionState === 'connected') {
      fetchDomains();
      fetchRecentTxs();
      loadJustRevealed();
      loadJustRedeemed();
      loadJustRegistered();
    }
  }, [connectionState, fetchDomains, loadJustRevealed, loadJustRedeemed, loadJustRegistered]);

  useEffect(() => {
    if (connectionState !== 'connected') return;

    void fetchMyListings();
    void fetchPurchaseRequests();
    const intervalId = window.setInterval(() => {
      void fetchMyListings();
      void fetchPurchaseRequests();
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [connectionState, fetchMyListings, fetchPurchaseRequests]);

  const fetchRecentTxs = async () => {
    try {
      const txs = await window.api.wallet.getTxHistory();
      // History expands a batch into one row per name. The dashboard is a
      // compact summary, so keep one row per on-chain transaction.
      const seenHashes = new Set<string>();
      const sorted = (txs as TxRecord[] || [])
        .filter((tx) => tx.time > 0)
        .sort((a, b) => b.time - a.time)
        .filter((tx) => {
          if (seenHashes.has(tx.hash)) return false;
          seenHashes.add(tx.hash);
          return true;
        })
        .slice(0, 5);
      setRecentTxs(sorted);
    } catch {
      // Ignore errors
    }
  };

  useEffect(() => {
    if (domains.length > 0 && blockHeight > 0) {
      let critical = 0;
      let warning = 0;
      let notice = 0;

      for (const d of domains) {
        const remaining = d.expiryBlock - blockHeight;
        if (remaining <= 4320) critical++;
        else if (remaining <= 8640) warning++;
        else if (remaining <= 12960) notice++;
      }

      setStats(prev => ({
        ...prev,
        totalDomains: domains.length,
        expiringCritical: critical,
        expiringWarning: warning,
        expiringNotice: notice,
      }));
    }
  }, [domains, blockHeight]);

  // Use unifiedAuctions from auctions-store for pending counts
  // This ensures Dashboard counts match Auctions page counts exactly
  const pendingCounts = useMemo(() => {
    return bucketAuctionsDashboard(unifiedAuctions, justRegistered);
  }, [unifiedAuctions, justRegistered]);

  useEffect(() => {
    setStats(prev => ({ ...prev, ...pendingCounts }));
  }, [pendingCounts]);

  const purchaseRequestCount = useMemo(() => {
    const activeNames = new Set(
      myListings
        .filter(listing => listing.status === 'active')
        .map(listing => listing.name.toLowerCase()),
    );
    const pendingRequests = purchaseRequests.filter(
      request => request.status === 'pending'
        && activeNames.has(request.name.toLowerCase()),
    );
    const uniqueRequests = new Set(
      pendingRequests.map(
        request => request.intentId
          || `${request.name.toLowerCase()}:${request.buyerAddr}`,
      ),
    );
    return uniqueRequests.size;
  }, [myListings, purchaseRequests]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const formatAmount = (amount: number) => {
    if (amount === 0) return '0.0000';
    const hns = dollaryDoosToHNS(amount);
    return hns >= 0 ? `+${hns.toFixed(4)}` : `${hns.toFixed(4)}`;
  };

  if (connectionState !== 'connected') {
    return (
      <>
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
          <div className="w-16 h-16 mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Connect to your Handshake node to view your wallet and domains.
          </p>
          <Link
            to="/settings"
            className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors"
          >
            Go to Settings
          </Link>
        </div>
      </>
    );
  }

  const rawWalletId = walletInfo?.id || config?.walletId || 'Unknown';
  const walletNameDisplay = rawWalletId;

  return (
    <>
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Wallet: {walletNameDisplay} | Block Height: {blockHeight.toLocaleString()}
        </p>
      </div>

      {/* Portfolio Summary */}
      <PortfolioSummary
        balance={balance}
        purchaseRequestCount={purchaseRequestCount}
        hnsPrice={hnsPrice}
      />

      {/* Two-column layout: Expiry Timeline + Pending Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ExpiryTimeline
          critical={stats.expiringCritical}
          warning={stats.expiringWarning}
        />
        <PendingActions
          pendingReveals={stats.pendingReveals}
          pendingRedeems={stats.pendingRedeems}
          pendingRegistrations={stats.pendingRegistrations}
        />
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Recent Transactions</h3>
          <Link to="/history" className="text-sm text-hns-600 hover:underline">
            View All
          </Link>
        </div>
        {recentTxs.length === 0 ? (
          <div className="text-center py-4 text-gray-500">No recent transactions</div>
        ) : (
          <div className="space-y-2">
            {recentTxs.map((tx) => (
              <div key={tx.rowId ?? tx.hash} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <div>
                  <div className="text-sm font-mono text-hns-600 cursor-pointer hover:underline" title={tx.hash} onClick={() => copyToClipboard(tx.hash, tx.rowId ?? tx.hash)}>
                    {copiedHash === (tx.rowId ?? tx.hash) ? 'Copied!' : `${(tx.hash || '').slice(0, 16)}...`}
                  </div>
                  <div className="text-xs text-gray-400">
                    {tx.time ? formatTime(tx.time) : 'Pending'}
                  </div>
                </div>
                <div className={`text-sm font-mono font-medium ${
                  tx.amount === 0
                    ? 'text-gray-500'
                    : tx.amount > 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {formatAmount(tx.amount)} HNS
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Link to="/domains" className="card hover:border-hns-300 transition-colors">
          <div className="text-2xl font-bold text-hns-600">{stats.totalDomains}</div>
          <div className="text-sm text-gray-500">My Domains</div>
        </Link>
        <Link to="/search" className="card hover:border-hns-300 transition-colors">
          <div className="text-2xl font-bold text-hns-600">+</div>
          <div className="text-sm text-gray-500">Search Names</div>
        </Link>
        <Link to="/auctions" className="card hover:border-hns-300 transition-colors">
          <div className="text-2xl font-bold text-hns-600">{stats.pendingReveals}</div>
          <div className="text-sm text-gray-500">Pending Reveals</div>
        </Link>
      </div>
    </div>
    </>
  );
}
