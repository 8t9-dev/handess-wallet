import { useState, useMemo } from 'react';
import { getStateLabel, getStateBgColor, dollaryDoosToHNS, getUnicodeName } from '../../lib/name-utils';
import type { NameLookupResult } from '../../types/search';
import { LogoIcon } from '../icons/LogoIcon';
import { Eye, EyeOff, Gavel, Loader2, X } from 'lucide-react';
import { BidModal } from '../batch/BidModal';
import { useConnectionStore } from '../../stores/connection-store';
import { useWatchlistStore } from '../../stores/watchlist-store';
import { PassphraseModal } from '../common/PassphraseModal';

interface SearchResultsProps {
  results: NameLookupResult[];
  nameMap?: Map<string, string>;
  isLoading: boolean;
  onClear: () => void;
  onUpdateResultStatus?: (name: string, status: NameLookupResult['status']) => void;
}

export function SearchResults({ results, nameMap, isLoading, onClear, onUpdateResultStatus }: SearchResultsProps) {
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());

  // Single action states
  const [biddingName, setBiddingName] = useState<string | null>(null);
  const { walletInfo } = useConnectionStore();
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openSuccess, setOpenSuccess] = useState<string | null>(null);
  const [showPassphraseForOpen, setShowPassphraseForOpen] = useState(false);
  const [pendingOpenName, setPendingOpenName] = useState<string | null>(null);

  // Bulk action states
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [showBulkPassphrase, setShowBulkPassphrase] = useState(false);
  const [bulkAction, setBulkAction] = useState<'open' | 'bid' | 'watchlist' | null>(null);
  const [showBulkBidModal, setShowBulkBidModal] = useState(false);

  // Watchlist
  const { addName: addWatchlist, entries: watchlistEntries } = useWatchlistStore();
  const watchlistSet = useMemo(() => new Set(watchlistEntries.map(e => e.name)), [watchlistEntries]);
  const [watchlistBusy, setWatchlistBusy] = useState<string | null>(null);

  // --- Filtered results ---
  const displayedResults = useMemo(() => {
    const filtered = showAvailableOnly ? results.filter(r => r.status === 'AVAILABLE') : results;
    return filtered;
  }, [results, showAvailableOnly]);

  // --- Selection helpers ---
  const selectables = useMemo(() =>
    displayedResults.filter(r => r.status === 'AVAILABLE' || r.status === 'BIDDING'),
    [displayedResults],
  );

  const allSelected = selectables.length > 0 && selectables.every(r => selectedNames.has(r.name));
  const someSelected = selectables.some(r => selectedNames.has(r.name));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedNames(new Set());
    } else {
      setSelectedNames(new Set(selectables.map(r => r.name)));
    }
  };

  const toggleSelect = (name: string) => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const selectedAvailable = useMemo(() =>
    Array.from(selectedNames).filter(n => {
      const r = results.find(x => x.name === n);
      return r?.status === 'AVAILABLE';
    }),
    [selectedNames, results],
  );

  const selectedBidding = useMemo(() =>
    Array.from(selectedNames).filter(n => {
      const r = results.find(x => x.name === n);
      return r?.status === 'BIDDING';
    }),
    [selectedNames, results],
  );

  // --- Single open ---
  const handleBid = async (name: string, bid: number, lockup: number, passphrase: string) => {
    await window.api.wallet.sendBid(name, bid, lockup, passphrase);
  };

  const triggerOpenAuction = (name: string) => {
    if (openingName !== null || showPassphraseForOpen) return;
    const isEncrypted = walletInfo?.master?.encrypted ?? false;
    if (isEncrypted) { setPendingOpenName(name); setShowPassphraseForOpen(true); }
    else handleOpen(name, '');
  };

  const handleOpen = async (name: string, passphrase: string) => {
    setOpeningName(name); setOpenError(null); setOpenSuccess(null);
    try {
      await window.api.wallet.sendOpen(name, passphrase);
      setOpenSuccess(`Auction opened for ${name}!`);
      onUpdateResultStatus?.(name, 'OPENING');
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : `Failed to open ${name}`);
    } finally { setOpeningName(null); }
  };

  // --- Bulk open ---
  const handleBulkOpen = async (passphrase: string) => {
    setBulkBusy(true); setBulkAction(null); setShowBulkPassphrase(false);
    const names = selectedAvailable;
    setBulkProgress(`Opening ${names.length} name${names.length !== 1 ? 's' : ''}...`);
    try {
      const results = await window.api.wallet.sendBulkOpen(names, passphrase);
      const opened = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      for (const r of opened) onUpdateResultStatus?.(r.name, 'OPENING');
      if (failed.length > 0) {
        console.error('[Bulk Open] Failed opens:', failed.map(r => `${r.name}: ${r.error}`).join(', '));
      }
      setSelectedNames(new Set());
      setOpenSuccess(`Opened ${opened.length} auction${opened.length !== 1 ? 's' : ''}${failed.length > 0 ? ` (${failed.length} failed)` : ''}!`);
    } catch (err) {
      setOpenError(`Bulk open failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBulkProgress('');
      setBulkBusy(false);
    }
  };

  // --- Bulk bid ---
  const handleBulkBid = async (bidAmount: number, lockup: number, passphrase: string) => {
    setBulkBusy(true); setShowBulkBidModal(false);
    let bid = 0;
    for (const name of selectedBidding) {
      setBulkProgress(`Bidding on ${name} (${bid + 1}/${selectedBidding.length})...`);
      try {
        await window.api.wallet.sendBid(name, bidAmount, lockup, passphrase);
        bid++;
      } catch { /* skip failed */ }
    }
    setSelectedNames(new Set());
    setBulkProgress('');
    setBulkBusy(false);
    setOpenSuccess(`Bid placed on ${bid} name${bid !== 1 ? 's' : ''}!`);
  };

  const triggerBulkOpen = () => {
    const isEncrypted = walletInfo?.master?.encrypted ?? false;
    if (isEncrypted) { setBulkAction('open'); setShowBulkPassphrase(true); }
    else handleBulkOpen('');
  };

  const triggerBulkBid = () => setShowBulkBidModal(true);

  // --- Single watchlist ---
  const handleToggleWatchlist = async (name: string) => {
    setWatchlistBusy(name);
    try {
      if (watchlistSet.has(name)) {
        await useWatchlistStore.getState().removeName(name);
      } else {
        await addWatchlist(name);
      }
    } finally { setWatchlistBusy(null); }
  };

  // --- Bulk watchlist ---
  const handleBulkWatchlist = async () => {
    setBulkBusy(true); setBulkAction(null);
    const toAdd = Array.from(selectedNames).filter(n => !watchlistSet.has(n));
    let added = 0;
    for (const name of toAdd) {
      setBulkProgress(`Adding ${name} (${added + 1}/${toAdd.length})...`);
      try { await addWatchlist(name); added++; } catch { /* skip */ }
    }
    setSelectedNames(new Set());
    setBulkProgress(''); setBulkBusy(false);
    setOpenSuccess(`Added ${added} name${added !== 1 ? 's' : ''} to watchlist!`);
  };

  // --- CSV export ---
  const exportCSV = () => {
    const headers = ['Name', 'Original Name', 'Status', 'Owner', 'Expires', 'Highest Bid'];
    const rows = results.map(r => [
      r.name,
      nameMap?.get(r.name) || '',
      r.status,
      r.owner || '',
      r.expiryBlock ? String(r.expiryBlock) : '',
      r.highestBid ? dollaryDoosToHNS(r.highestBid).toFixed(2) : '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `bulk-search-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="card p-8 text-center text-gray-500">
        <div className="animate-spin w-6 h-6 border-2 border-hns-600 border-t-transparent rounded-full mx-auto mb-2" />
        Searching {results.length} names...
      </div>
    );
  }

  const available = results.filter((r) => r.status === 'AVAILABLE').length;
  const inAuction = results.filter((r) => ['OPENING', 'BIDDING', 'REVEAL'].includes(r.status)).length;
  const owned = results.filter((r) => r.status === 'CLOSED' || r.status === 'OWNED_BY_YOU').length;
  const hasSelection = selectedNames.size > 0;

  return (
    <div className="space-y-4">
      {biddingName && (
        <BidModal name={biddingName} onClose={() => setBiddingName(null)} onBid={handleBid} />
      )}

      {showBulkBidModal && (
        <BulkBidModal
          names={selectedBidding}
          onClose={() => setShowBulkBidModal(false)}
          onBid={handleBulkBid}
        />
      )}

      {(openError || openSuccess) && (
        <div className="space-y-2">
          {openError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm flex items-center justify-between">
              <span>{openError}</span>
              <button onClick={() => setOpenError(null)} className="text-red-400 hover:text-red-600 font-bold">×</button>
            </div>
          )}
          {openSuccess && (
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 text-sm flex items-center justify-between">
              <span>{openSuccess}</span>
              <button onClick={() => setOpenSuccess(null)} className="text-green-400 hover:text-green-600 font-bold">×</button>
            </div>
          )}
        </div>
      )}

      {/* Summary + filters */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 items-center">
          <div className="text-sm">
            <span className="font-semibold text-green-600">{available}</span> available
          </div>
          <div className="text-sm">
            <span className="font-semibold text-amber-600">{inAuction}</span> in auction
          </div>
          <div className="text-sm">
            <span className="font-semibold text-blue-600">{owned}</span> owned
          </div>
          {available > 0 && (
            <button
              onClick={() => setShowAvailableOnly(!showAvailableOnly)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                showAvailableOnly
                  ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700'
              }`}
            >
              {showAvailableOnly ? 'Showing Available' : 'Show Available Only'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={exportCSV}
            className="text-sm text-hns-600 hover:text-hns-700 dark:text-hns-400 dark:hover:text-hns-300">
            Export CSV
          </button>
          <button onClick={onClear} className="text-sm text-gray-500 hover:text-gray-700">
            Clear Results
          </button>
        </div>
      </div>

      {/* Results table */}
      <div className="table-container">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-4 py-3 w-10">
                <input type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300 dark:border-gray-600 text-hns-600 focus:ring-hns-500"
                />
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Owner</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Expires</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Highest Bid</th>
              <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {displayedResults.map((result) => {
              const isSelectable = result.status === 'AVAILABLE' || result.status === 'BIDDING';
              // Show the decoded IDNA/emoji form alongside punycode, matching
              // My Domains. Falls back to whatever the user typed for names
              // that don't decode.
              const unicodeName = getUnicodeName(result.name) ?? nameMap?.get(result.name) ?? null;
              return (
                <tr key={result.name} className={`hover:bg-gray-50 dark:hover:bg-gray-900 ${selectedNames.has(result.name) ? 'bg-hns-50/50 dark:bg-hns-900/10' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox"
                      checked={selectedNames.has(result.name)}
                      disabled={!isSelectable}
                      onChange={() => toggleSelect(result.name)}
                      className="rounded border-gray-300 dark:border-gray-600 text-hns-600 focus:ring-hns-500 disabled:opacity-30"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="font-mono">{result.name}</span>
                    {unicodeName && (
                      <span className="font-sans text-gray-400 dark:text-gray-500"> [ {unicodeName} ]</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`state-badge ${getStateBgColor(result.status)}`}>
                      {getStateLabel(result.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono">
                    {result.owner ? `${result.owner.slice(0, 10)}...` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {result.expiryBlock ? `Block ${result.expiryBlock.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {result.highestBid
                      ? `${dollaryDoosToHNS(result.highestBid).toFixed(2)} HNS`
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {result.status === 'AVAILABLE' && (
                        <button
                          onClick={() => triggerOpenAuction(result.name)}
                          disabled={openingName === result.name}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded disabled:opacity-50 flex items-center justify-center"
                          title="Open Auction"
                        >
                          {openingName === result.name ? (
                            <div className="animate-spin w-4 h-4 border border-green-600 border-t-transparent rounded-full" />
                          ) : (
                            <LogoIcon className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      {result.status === 'BIDDING' && (
                        <button onClick={() => setBiddingName(result.name)}
                          className="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Place Bid">
                          <Gavel className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleWatchlist(result.name)}
                        disabled={watchlistBusy === result.name}
                        className={`p-1.5 rounded disabled:opacity-50 ${
                          watchlistSet.has(result.name)
                            ? 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30'
                            : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                        title={watchlistSet.has(result.name) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                      >
                        {watchlistBusy === result.name ? (
                          <div className="animate-spin w-4 h-4 border border-current border-t-transparent rounded-full" />
                        ) : watchlistSet.has(result.name) ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bulk action bar */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 flex items-center gap-4 z-50">
          <div className="text-sm">
            <span className="font-semibold">{selectedNames.size}</span> name{selectedNames.size !== 1 ? 's' : ''} selected
          </div>
          <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />
          {selectedAvailable.length > 0 && (
            <button onClick={triggerBulkOpen} disabled={bulkBusy}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 disabled:opacity-50">
              {bulkBusy && bulkAction === 'open'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {bulkProgress}</>
                : <>Open Auction ({selectedAvailable.length})</>}
            </button>
          )}
          {selectedBidding.length > 0 && (
            <button onClick={triggerBulkBid} disabled={bulkBusy}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50">
              {bulkBusy && bulkAction === 'bid'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {bulkProgress}</>
                : <>Place Bid ({selectedBidding.length})</>}
            </button>
          )}
          <button onClick={handleBulkWatchlist} disabled={bulkBusy}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50">
            {bulkBusy && bulkAction === 'watchlist'
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {bulkProgress}</>
              : <><Eye className="w-4 h-4" /> Add to Watchlist</>}
          </button>
          <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />
          <button onClick={() => setSelectedNames(new Set())}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </div>
      )}

      {showPassphraseForOpen && pendingOpenName && (
        <PassphraseModal
          title={`Open Auction for ${pendingOpenName}`}
          onSubmit={(pwd) => { setShowPassphraseForOpen(false); handleOpen(pendingOpenName, pwd); setPendingOpenName(null); }}
          onCancel={() => { setShowPassphraseForOpen(false); setPendingOpenName(null); }}
        />
      )}

      {showBulkPassphrase && (
        <PassphraseModal
          title={`Bulk Open Auction (${selectedAvailable.length} names)`}
          onSubmit={(pwd) => { setShowBulkPassphrase(false); handleBulkOpen(pwd); }}
          onCancel={() => { setShowBulkPassphrase(false); setBulkAction(null); }}
        />
      )}
    </div>
  );
}

// ============================================================
// Bulk Bid Modal — applies the same bid amount to all selected
// ============================================================
function BulkBidModal({
  names,
  onClose,
  onBid,
}: {
  names: string[];
  onClose: () => void;
  onBid: (bidAmount: number, lockup: number, passphrase: string) => void;
}) {
  const [bidHNS, setBidHNS] = useState('');
  const [lockupHNS, setLockupHNS] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);

  const bidNum = parseFloat(bidHNS) || 0;
  const lockupNum = parseFloat(lockupHNS) || 0;
  const valid = bidNum > 0 && lockupNum >= bidNum;

  const handleSubmit = () => {
    if (!valid) return;
    const isEncrypted = useConnectionStore.getState().walletInfo?.master?.encrypted ?? false;
    if (isEncrypted) setShowPassphrase(true);
    else onBid(bidNum, lockupNum, '');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Bulk Place Bid</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Place the same bid on <span className="font-semibold">{names.length}</span> name{names.length !== 1 ? 's' : ''}.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Bid Amount (HNS)</label>
            <input type="number" step="0.01" min="0" value={bidHNS} onChange={e => setBidHNS(e.target.value)}
              placeholder="e.g. 10.00"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Lockup Amount (HNS)</label>
            <input type="number" step="0.01" min="0" value={lockupHNS} onChange={e => setLockupHNS(e.target.value)}
              placeholder="e.g. 15.00"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700" />
            {bidNum > 0 && lockupNum > 0 && lockupNum < bidNum && (
              <p className="text-xs text-red-500 mt-1">Lockup must be ≥ bid amount</p>
            )}
          </div>
          <p className="text-xs text-gray-400">Names: {names.slice(0, 5).join(', ')}{names.length > 5 ? ` +${names.length - 5} more` : ''}</p>
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <button onClick={handleSubmit} disabled={!valid}
            className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
            Place {names.length} Bid{names.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>

      {showPassphrase && (
        <PassphraseModal
          title={`Bulk Bid (${names.length} names)`}
          onSubmit={(pwd) => { setShowPassphrase(false); onBid(bidNum, lockupNum, pwd); }}
          onCancel={() => setShowPassphrase(false)}
        />
      )}
    </div>
  );
}
