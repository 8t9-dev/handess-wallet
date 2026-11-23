/**
 * History Page
 *
 * Shows wallet transaction history.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionStore } from '../stores/connection-store';
import { dollaryDoosToHNS, getUnicodeName, formatNameWithUnicode } from '../lib/name-utils';
import { copyText } from '../lib/clipboard';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';

const PAGE_SIZE = 100;

interface TxRecord {
  hash: string;
  height: number | null;
  time: number;
  amount: number;
  fee: number;
  category?: string;
  name?: string;
  event?: string;
  confirmations: number;
  inputs: unknown[];
  outputs: unknown[];
  rowId?: string;
}

/**
 * Render an event string with the name in display form, matching My Domains:
 * `Renew name xn--jacob-7y04d [ jacob👑 ]`
 */
function EventText({ event, name }: { event?: string; name?: string }) {
  if (!event) return <>-</>;

  const unicodeName = name ? getUnicodeName(name) : null;
  const nameIndex = name && unicodeName ? event.indexOf(name) : -1;

  if (!name || !unicodeName || nameIndex === -1) return <>{event}</>;

  return (
    <>
      {event.slice(0, nameIndex)}
      <span className="font-mono">{name}</span>
      <span className="text-gray-400 dark:text-gray-500"> [ {unicodeName} ]</span>
      {event.slice(nameIndex + name.length)}
    </>
  );
}

/**
 * Plain-text variant of EventText for CSV export.
 */
function formatEvent(tx: TxRecord): string {
  if (!tx.name || !tx.event) return tx.event || '';
  return tx.event.replace(tx.name, formatNameWithUnicode(tx.name));
}

export function History() {
  const { connectionState, isLoggedIn, walletInfo } = useConnectionStore();
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortAsc, setSortAsc] = useState(false);

  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE));
  const paginatedTxs = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => {
      const diff = (a.time || 0) - (b.time || 0);
      return sortAsc ? diff : -diff;
    });
    return sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [transactions, page, sortAsc]);

  const copyToClipboard = async (hash: string, key: string) => {
    if (!(await copyText(hash))) return;
    setCopiedHash(key);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setPage(1);
    try {
      const txs = await window.api.wallet.getTxHistory();
      setTransactions((txs as TxRecord[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch history');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Reload when the node connects, when login completes, and when the
    // active wallet changes. The page can be reached before login in some
    // flows, and a previous wallet's rows must never linger.
    if (connectionState === 'connected' && isLoggedIn) {
      void fetchHistory();
    }
  }, [connectionState, isLoggedIn, walletInfo?.id, fetchHistory]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatAmount = (amount: number) => {
    if (amount === 0) return '0.000000';
    const hns = dollaryDoosToHNS(amount);
    return hns >= 0 ? `+${hns.toFixed(6)}` : `${hns.toFixed(6)}`;
  };

  const formatType = (category: string | undefined, amount: number) => {
    if (category && !['send', 'receive'].includes(category)) {
      return category.charAt(0).toUpperCase() + category.slice(1);
    }
    return amount < 0 ? 'Sent' : 'Received';
  };

  const exportCSV = () => {
    const headers = ['Date', 'Type', 'Event', 'TX Hash', 'Height', 'Amount (HNS)', 'Fee (HNS)', 'Confirmations'];
    const rows = transactions.map(tx => [
      tx.time ? new Date(tx.time * 1000).toISOString() : 'Pending',
      tx.category || '',
      formatEvent(tx),
      tx.hash,
      tx.height != null ? String(tx.height) : 'Unconfirmed',
      dollaryDoosToHNS(tx.amount).toFixed(6),
      tx.fee > 0 ? dollaryDoosToHNS(tx.fee).toFixed(6) : '0',
      String(tx.confirmations),
    ]);

    const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transaction-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          Connect to your Handshake node to view transaction history.
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
          <h1 className="text-2xl font-bold">Transaction History</h1>
          <p className="text-gray-500 dark:text-gray-400">
            {transactions.length} transactions
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            disabled={transactions.length === 0}
            className="px-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={fetchHistory}
            disabled={isLoading}
            className="px-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700">
          {error}
        </div>
      )}

      {isLoading && transactions.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">Loading transactions...</div>
      ) : transactions.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">No transactions found</div>
      ) : (
        <div className="table-container">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th
                  onClick={() => { setSortAsc(v => !v); setPage(1); }}
                  className="px-4 py-3 text-left text-sm font-medium cursor-pointer select-none hover:text-hns-600 transition-colors"
                >
                  <span className="inline-flex items-center gap-1">
                    Date
                    {sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                  </span>
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">TX Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Event</th>
                <th className="px-4 py-3 text-left text-sm font-medium">TX Hash</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Height</th>
                <th className="px-4 py-3 text-right text-sm font-medium">Amount (HNS)</th>
                <th className="px-4 py-3 text-right text-sm font-medium">Fee (HNS)</th>
                <th className="px-4 py-3 text-right text-sm font-medium">Confirmations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {paginatedTxs.map((tx) => (
                  <tr key={tx.rowId ?? tx.hash} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                    <td className="px-4 py-3 text-sm">
                      {tx.time ? formatTime(tx.time) : 'Pending'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium">{formatType(tx.category, tx.amount)}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      <EventText event={tx.event} name={tx.name} />
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">
                      <span className="text-hns-600 hover:underline cursor-pointer" title={tx.hash} onClick={() => copyToClipboard(tx.hash, tx.rowId ?? tx.hash)}>
                        {copiedHash === (tx.rowId ?? tx.hash) ? 'Copied!' : `${(tx.hash || '').slice(0, 16)}...`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {tx.height !== null ? tx.height.toLocaleString() : 'Unconfirmed'}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right font-mono ${
                      tx.amount === 0
                        ? 'text-gray-500'
                        : tx.amount > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {formatAmount(tx.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-gray-500">
                      {tx.fee > 0 ? `-${dollaryDoosToHNS(tx.fee).toFixed(6)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      {tx.confirmations}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-500">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
