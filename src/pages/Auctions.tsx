import { useEffect, useState, Component, ErrorInfo, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ChevronDown, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';
import { useConnectionStore } from '../stores/connection-store';
import { useAuctionsStore } from '../stores/auctions-store';
import { AuctionLifecycleTabs } from '../components/auctions/AuctionLifecycleTabs';
import { PassphraseModal } from '../components/common/PassphraseModal';
import type { BidReceipt, GlobalAuction, GlobalAuctionsScanResult } from '../types/auction';
import { blocksToTimeLeft, toPunycode, toUnicode } from '../lib/name-utils';
import type { NetworkName } from '../lib/constants';

type GlobalBidSort = 'bids-desc' | 'bids-asc' | 'highest' | 'lowest';

const GLOBAL_PAGE_SIZE = 50;

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[Auctions ErrorBoundary]', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-6">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-red-800 dark:text-red-200 font-medium">Auctions Page Error</h3>
                <p className="text-red-600 dark:text-red-400 text-sm mt-1 font-mono text-xs">
                  {this.state.error?.message || 'Unknown error'}
                </p>
                {import.meta.env.DEV && (
                  <details className="mt-2">
                    <summary className="text-xs text-red-500 cursor-pointer">Error Details</summary>
                    <pre className="mt-2 text-xs text-red-400 bg-red-50 dark:bg-red-900/30 p-2 rounded overflow-auto max-h-64">
                      {this.state.error?.stack}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function formatHNSShort(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
}

function statusBadge(state: string): { label: string; cls: string } {
  switch (state) {
    case 'OPENING': return { label: 'Opening', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'BIDDING': return { label: 'Bidding', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' };
    case 'REVEAL': return { label: 'Reveal', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };
    case 'CLOSED': return { label: 'Closed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    default: return { label: state, cls: 'bg-gray-100 text-gray-700' };
  }
}

function GlobalAuctionTable({
  auctions,
  network,
}: {
  auctions: GlobalAuction[];
  network: NetworkName;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900/90 text-[10px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="text-left px-3 py-2">Name</th>
            <th className="text-left px-3 py-2">Phase</th>
            <th className="text-right px-3 py-2">Bidding ends in</th>
            <th className="text-right px-3 py-2">Bids</th>
            <th
              className="text-right px-3 py-2"
              title="Highest visible BID lockup; the true bid stays hidden until reveal."
            >
              Highest bid
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {auctions.map((auction) => {
            const badge = statusBadge(auction.state);
            return (
              <tr key={auction.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-3 py-2.5">
                  <Link
                    to={`/explore/name/${encodeURIComponent(toPunycode(auction.name))}`}
                    className="font-medium text-hns-600 hover:underline truncate block max-w-[12rem]"
                    title={auction.name}
                  >
                    {toUnicode(auction.name)}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right text-xs whitespace-nowrap">
                  <div className="font-mono text-gray-700 dark:text-gray-300">
                    {auction.blocksUntilNext > 0
                      ? `${auction.blocksUntilNext.toLocaleString()} blk`
                      : 'Now'}
                  </div>
                  <div className="text-gray-400">
                    {blocksToTimeLeft(auction.blocksUntilNext, network)}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-xs">
                  <span className="font-mono text-gray-700 dark:text-gray-300">
                    {auction.bidCount.toLocaleString()}
                  </span>
                  {auction.revealCount > 0 && (
                    <div className="text-gray-400">{auction.revealCount.toLocaleString()} revealed</div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  {auction.highestLockup > 0
                    ? `${formatHNSShort(auction.highestLockup / 1_000_000)} HNS`
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GlobalPagination({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const start = page * GLOBAL_PAGE_SIZE + 1;
  const end = Math.min(total, (page + 1) * GLOBAL_PAGE_SIZE);

  return (
    <footer className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 text-[11px] text-gray-500">
      <span>{start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
        >
          Previous
        </button>
        <span>Page {page + 1} / {pageCount}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(pageCount - 1, page + 1))}
          disabled={page >= pageCount - 1}
          className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </footer>
  );
}

export function Auctions() {
  const { connectionState, walletInfo, network: connectionNetwork } = useConnectionStore();
  const {
    unifiedAuctions,
    isLoading,
    error,
    currentBlock: storeCurrentBlock,
    fetchUnifiedAuctions,
    loadJustRevealed,
    loadJustRedeemed,
    loadJustRegistered,
    markJustRevealed,
    markJustRedeemed,
    markJustRegistered,
    markPendingReveal,
    saveBidReceiptLocal,
  } = useAuctionsStore();

  const [action, setAction] = useState<{ name: string; type: string; loading: boolean; msg: string; ok: boolean } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ name: string; type: string; extra?: { bid?: number; lockup?: number; names?: string[] } } | null>(null);

  const [showGlobalAuctions, setShowGlobalAuctions] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [globalMeta, setGlobalMeta] = useState<GlobalAuctionsScanResult | null>(null);
  const [globalBidSort, setGlobalBidSort] = useState<GlobalBidSort>('bids-desc');
  const [endingPage, setEndingPage] = useState(0);
  const [bidPage, setBidPage] = useState(0);

  const network = (
    connectionNetwork === 'testnet' || connectionNetwork === 'regtest'
      ? connectionNetwork
      : 'main'
  ) as NetworkName;
  const isEncrypted = walletInfo?.master?.encrypted ?? false;

  // Fetch on mount — fetchUnifiedAuctions now loads bidReceipts internally
  useEffect(() => {
    if (connectionState !== 'connected') return;
    Promise.all([
      fetchUnifiedAuctions(),
      loadJustRevealed(),
      loadJustRedeemed(),
      loadJustRegistered(),
    ]);
  }, [connectionState, fetchUnifiedAuctions, loadJustRevealed, loadJustRedeemed, loadJustRegistered]);

  // Auto-refresh on height change (10s throttle, Bob Wallet pattern)
  useEffect(() => {
    if (connectionState !== 'connected') return;
    const interval = setInterval(() => {
      window.api.node.getBlockHeight().then(h => {
        if (h !== storeCurrentBlock) {
          fetchUnifiedAuctions();
        }
      }).catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, [connectionState, storeCurrentBlock, fetchUnifiedAuctions]);

  const executeAction = async (
    name: string,
    type: string,
    pwd: string,
    extra?: { bid?: number; lockup?: number },
  ) => {
    setAction({ name, type, loading: true, msg: '', ok: false });
    try {
      if (type === 'bid' && extra?.bid != null && extra?.lockup != null) {
        const tx = await window.api.wallet.sendBid(name, extra.bid, extra.lockup, pwd);
        const receipt = (tx as unknown as Record<string, unknown>)._receipt as { bidAmount: number; nonce?: string; lockup: number } | undefined;
        if (receipt) {
          const bidRec: BidReceipt = {
            name,
            bidAmount: receipt.bidAmount,
            nonce: receipt.nonce || '',
            lockup: receipt.lockup,
            createdAt: new Date().toISOString(),
          };
          await window.api.db.saveBidReceipt(name, bidRec);
          saveBidReceiptLocal(bidRec);
        }
        setAction({ name, type: 'bid', loading: false, msg: 'Bid placed!', ok: true });
      } else if (type === 'reveal') {
        try {
          await window.api.wallet.sendReveal(name, pwd);
          setAction({ name, type: 'reveal', loading: false, msg: 'Revealed!', ok: true });
          markJustRevealed(name);
          markPendingReveal(name);
        } catch (revealErr) {
          const revealMsg = revealErr instanceof Error ? revealErr.message : '';
          if (revealMsg.includes('No bids to reveal')) {
            // Bid already revealed from wallet's perspective — treat as success.
            // Don't call markJustRevealed here: that would persist the name to
            // the justRevealed DB, causing the Dashboard's pending-reveals count
            // to subtract it and show 0 even when the user still has unrevealed
            // bids. The wallet confirms it as revealed so no further action needed.
            setAction({ name, type: 'reveal', loading: false, msg: 'Already revealed', ok: true });
          } else {
            throw revealErr;
          }
        }
      } else if (type === 'redeem') {
        try {
          await window.api.wallet.sendRedeem(name, pwd);
          setAction({ name, type: 'redeem', loading: false, msg: 'Redeemed!', ok: true });
          markJustRedeemed(name);
        } catch (redeemErr) {
          const redeemMsg = redeemErr instanceof Error ? redeemErr.message : '';
          if (redeemMsg.includes('No reveals to redeem')) {
            markJustRedeemed(name);
            setAction({ name, type: 'redeem', loading: false, msg: 'Already redeemed', ok: true });
          } else {
            throw redeemErr;
          }
        }
      } else if (type === 'register') {
        await window.api.wallet.sendUpdate(name, { records: [] }, pwd);
        setAction({ name, type: 'register', loading: false, msg: 'Registered!', ok: true });
        markJustRegistered(name);
      }
      await fetchUnifiedAuctions();
    } catch (err) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      setAction({ name, type, loading: false, msg: err instanceof Error ? err.message : `${label} failed`, ok: false });
    }
  };

  const triggerAction = (
    name: string,
    type: string,
    extra?: { bid?: number; lockup?: number },
  ) => {
    if (isEncrypted) {
      setPendingAction({ name, type, extra });
    } else {
      executeAction(name, type, '', extra);
    }
  };

  const handlePassphraseSubmit = (pwd: string) => {
    if (pendingAction) {
      if (pendingAction.type === 'reveal-all' && pendingAction.extra?.names) {
        executeRevealAll(pendingAction.extra.names, pwd);
      } else if (pendingAction.type === 'redeem-all' && pendingAction.extra?.names) {
        executeRedeemAll(pendingAction.extra.names, pwd);
      } else if (pendingAction.type === 'register-all' && pendingAction.extra?.names) {
        executeRegisterAll(pendingAction.extra.names, pwd);
      } else {
        executeAction(pendingAction.name, pendingAction.type, pwd, pendingAction.extra);
      }
      setPendingAction(null);
    }
  };

  const executeRedeemAll = async (names: string[], pwd: string) => {
    setAction({ name: 'redeem-all', type: 'redeem-all', loading: true, msg: '', ok: false });
    let redeemed = 0;
    let failed = 0;
    try {
      for (const name of names) {
        setAction({ name, type: 'redeem', loading: true, msg: `Redeeming ${redeemed + 1}/${names.length}…`, ok: false });
        try {
          await window.api.wallet.sendRedeem(name, pwd);
          markJustRedeemed(name);
          redeemed++;
          setAction({ name, type: 'redeem', loading: false, msg: `Redeemed ${redeemed}/${names.length}`, ok: true });
        } catch (redeemErr) {
          const redeemMsg = redeemErr instanceof Error ? redeemErr.message : '';
          if (redeemMsg.includes('No reveals to redeem')) {
            markJustRedeemed(name);
            redeemed++;
            setAction({ name, type: 'redeem', loading: false, msg: `Already redeemed ${redeemed}/${names.length}`, ok: true });
          } else {
            failed++;
            setAction({ name, type: 'redeem', loading: false, msg: `Failed: ${redeemMsg || 'unknown error'}`, ok: false });
          }
        }
      }
      const summary = failed > 0
        ? `Done — ${redeemed} redeemed, ${failed} failed`
        : `All ${redeemed} name${redeemed !== 1 ? 's' : ''} redeemed!`;
      setAction({ name: 'redeem-all', type: 'redeem-all', loading: false, msg: summary, ok: failed === 0 });
    } catch (err) {
      setAction({ name: 'redeem-all', type: 'redeem-all', loading: false, msg: err instanceof Error ? err.message : 'Redeem all failed', ok: false });
    }
    await fetchUnifiedAuctions();
  };

  const handleRedeemAll = (names: string[]) => {
    if (isEncrypted) {
      setPendingAction({ name: 'redeem-all', type: 'redeem-all', extra: { names } });
    } else {
      executeRedeemAll(names, '');
    }
  };

  const executeRevealAll = async (names: string[], pwd: string) => {
    setAction({ name: 'reveal-all', type: 'reveal-all', loading: true, msg: '', ok: false });
    let revealed = 0;
    let failed = 0;
    try {
      for (const name of names) {
        setAction({ name, type: 'reveal', loading: true, msg: `Revealing ${revealed + 1}/${names.length}…`, ok: false });
        try {
          await window.api.wallet.sendReveal(name, pwd);
          markJustRevealed(name);
          markPendingReveal(name);
          revealed++;
          setAction({ name, type: 'reveal', loading: false, msg: `Revealed ${revealed}/${names.length}`, ok: true });
        } catch (revealErr) {
          const revealMsg = revealErr instanceof Error ? revealErr.message : '';
          if (revealMsg.includes('No bids to reveal')) {
            revealed++;
            setAction({ name, type: 'reveal', loading: false, msg: `Revealed ${revealed}/${names.length}`, ok: true });
          } else {
            failed++;
            setAction({ name, type: 'reveal', loading: false, msg: `Failed: ${revealMsg || 'unknown error'}`, ok: false });
          }
        }
      }
      const summary = failed > 0
        ? `Done — ${revealed} revealed, ${failed} failed`
        : `All ${revealed} name${revealed !== 1 ? 's' : ''} revealed!`;
      setAction({ name: 'reveal-all', type: 'reveal-all', loading: false, msg: summary, ok: failed === 0 });
    } catch (err) {
      setAction({ name: 'reveal-all', type: 'reveal-all', loading: false, msg: err instanceof Error ? err.message : 'Reveal all failed', ok: false });
    }
    await fetchUnifiedAuctions();
  };

  const handleRevealAll = (names: string[]) => {
    if (isEncrypted) {
      setPendingAction({ name: 'reveal-all', type: 'reveal-all', extra: { names } });
    } else {
      executeRevealAll(names, '');
    }
  };

  const executeRegisterAll = async (names: string[], pwd: string) => {
    setAction({ name: 'register-all', type: 'register-all', loading: true, msg: '', ok: false });
    let registered = 0;
    let failed = 0;
    try {
      for (const name of names) {
        try {
          await window.api.wallet.sendUpdate(name, { records: [] }, pwd);
          markJustRegistered(name);
          registered++;
          setAction({ name, type: 'register', loading: false, msg: `Registered ${registered}/${names.length}`, ok: true });
        } catch (registerErr) {
          failed++;
          setAction({ name, type: 'register', loading: false, msg: `Failed: ${registerErr instanceof Error ? registerErr.message : 'unknown error'}`, ok: false });
        }
      }
      const summary = failed > 0
        ? `Done — ${registered} registered, ${failed} failed`
        : `All ${names.length} name${names.length !== 1 ? 's' : ''} registered!`;
      setAction({ name: 'register-all', type: 'register-all', loading: false, msg: summary, ok: failed === 0 });
    } catch (err) {
      setAction({ name: 'register-all', type: 'register-all', loading: false, msg: err instanceof Error ? err.message : 'Register all failed', ok: false });
    }
    await fetchUnifiedAuctions();
  };

  const handleRegisterAll = (names: string[]) => {
    if (isEncrypted) {
      setPendingAction({ name: 'register-all', type: 'register-all', extra: { names } });
    } else {
      executeRegisterAll(names, '');
    }
  };

  const scanGlobal = async () => {
    setScanLoading(true);
    setScanError(null);
    try {
      const result = await window.api.node.scanGlobalAuctions();
      setGlobalMeta(result);
      setEndingPage(0);
      setBidPage(0);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanLoading(false);
    }
  };

  const toggleGlobalAuctions = () => {
    const next = !showGlobalAuctions;
    setShowGlobalAuctions(next);
    if (next && !globalMeta && !scanLoading) {
      void scanGlobal();
    }
  };

  const endingSoonAuctions = globalMeta?.endingSoon ?? [];
  const bidAuctions = globalBidSort === 'bids-desc'
    ? (globalMeta?.mostBids ?? [])
    : globalBidSort === 'bids-asc'
      ? (globalMeta?.fewestBids ?? [])
      : globalBidSort === 'highest'
        ? (globalMeta?.highestBids ?? [])
        : (globalMeta?.lowestBids ?? []);

  const endingPageCount = Math.max(1, Math.ceil(endingSoonAuctions.length / GLOBAL_PAGE_SIZE));
  const bidPageCount = Math.max(1, Math.ceil(bidAuctions.length / GLOBAL_PAGE_SIZE));
  const endingPageRows = endingSoonAuctions.slice(
    endingPage * GLOBAL_PAGE_SIZE,
    (endingPage + 1) * GLOBAL_PAGE_SIZE,
  );
  const bidPageRows = bidAuctions.slice(
    bidPage * GLOBAL_PAGE_SIZE,
    (bidPage + 1) * GLOBAL_PAGE_SIZE,
  );

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
          Connect to your Handshake node to view your auctions and bids.
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
      <div>
        <h1 className="text-2xl font-bold">Auctions</h1>
        <p className="text-gray-500 dark:text-gray-400">Track and manage your auction activity</p>
      </div>

      <ErrorBoundary>
        <AuctionLifecycleTabs
          auctions={unifiedAuctions}
          network={network}
          currentAction={action}
          isEncrypted={isEncrypted}
          isLoading={isLoading}
          hasError={!!error}
          onRetry={fetchUnifiedAuctions}
          onPlaceBid={(name, bid, lockup) => triggerAction(name, 'bid', { bid, lockup })}
          onReveal={(name) => triggerAction(name, 'reveal')}
          onRevealAll={handleRevealAll}
          onRedeem={(name) => triggerAction(name, 'redeem')}
          onRedeemAll={handleRedeemAll}
          onRegister={(name) => triggerAction(name, 'register')}
          onRegisterAll={handleRegisterAll}
        />
      </ErrorBoundary>

      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <button
          onClick={toggleGlobalAuctions}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm">Global Auctions Overview</span>
            {globalMeta && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-hns-100 text-hns-700 dark:bg-hns-900/40 dark:text-hns-300">
                {globalMeta.totalActive.toLocaleString()} in bidding
              </span>
            )}
          </span>
          <span className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
            {globalMeta
              ? `Block ${globalMeta.scannedTo.toLocaleString()}`
              : 'Scan recent blocks'}
            {showGlobalAuctions ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
        </button>

        {showGlobalAuctions && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-gray-400">
                {globalMeta
                  ? `${globalMeta.totalActive.toLocaleString()} in bidding · ${globalMeta.totalWithBids.toLocaleString()} with bids · block ${globalMeta.scannedTo.toLocaleString()}`
                  : 'Scanning recent chain activity…'}
              </p>
              <button
                onClick={() => void scanGlobal()}
                disabled={scanLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-hns-600 hover:text-hns-700 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${scanLoading ? 'animate-spin' : ''}`} />
                {scanLoading ? 'Scanning…' : 'Refresh'}
              </button>
            </div>

            {scanLoading && !globalMeta ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                Scanning the active-auction window…
              </div>
            ) : scanError ? (
              <div className="text-center py-8 text-sm text-red-500">
                {scanError}
                <button onClick={() => void scanGlobal()} className="ml-2 underline hover:no-underline">
                  Retry
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <section className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <header className="flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">Bidding ends soon</h3>
                      <span className="text-[11px] text-gray-500">
                        {endingSoonAuctions.length.toLocaleString()} closest
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400">Bidding phase</span>
                  </header>
                  {endingPageRows.length > 0 ? (
                    <>
                      <GlobalAuctionTable auctions={endingPageRows} network={network} />
                      <GlobalPagination
                        page={endingPage}
                        pageCount={endingPageCount}
                        total={endingSoonAuctions.length}
                        onChange={setEndingPage}
                      />
                    </>
                  ) : (
                    <div className="py-8 px-3 text-center text-sm text-gray-400">
                      No active auctions were found in the scanned window.
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">Bid activity</h3>
                      <span className="text-[11px] text-gray-500">
                        {bidAuctions.length.toLocaleString()} top
                      </span>
                    </div>
                    <select
                      value={globalBidSort}
                      onChange={(event) => {
                        setGlobalBidSort(event.target.value as GlobalBidSort);
                        setBidPage(0);
                      }}
                      className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-[11px]"
                    >
                      <option value="bids-desc">Most bids</option>
                      <option value="bids-asc">Fewest bids</option>
                      <option value="highest">Highest bid</option>
                      <option value="lowest">Lowest bid</option>
                    </select>
                  </header>
                  {bidPageRows.length > 0 ? (
                    <>
                      <GlobalAuctionTable auctions={bidPageRows} network={network} />
                      <GlobalPagination
                        page={bidPage}
                        pageCount={bidPageCount}
                        total={bidAuctions.length}
                        onChange={setBidPage}
                      />
                    </>
                  ) : (
                    <div className="py-8 px-3 text-center text-sm text-gray-400">
                      No auctions with bids were found.
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}
      </div>

      {pendingAction && (
        <PassphraseModal
          title={`Confirm ${pendingAction.type.charAt(0).toUpperCase() + pendingAction.type.slice(1)}`}
          onSubmit={handlePassphraseSubmit}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
