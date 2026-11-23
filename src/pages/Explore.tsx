import { useEffect, useState, useCallback } from 'react';
import { useConnectionStore } from '../stores/connection-store';
import { Search, ExternalLink, Gavel, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { BlockSummary, ChainStats, TreeUpdateInfo, AddressInfo } from '../types/explore';
import type { NameLookupResult } from '../types/search';
import type { Auction } from '../types/auction';
import { toPunycode, toUnicode } from '../lib/name-utils';
import { BidModal } from '../components/batch/BidModal';
import { PassphraseModal } from '../components/common/PassphraseModal';

function formatTime(ts: number): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatHNS(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
}

function formatHNSFull(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} kB`;
  return `${bytes} B`;
}

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'OPENING': return { label: 'Opening', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'BIDDING': return { label: 'Bidding', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' };
    case 'REVEAL': return { label: 'Reveal', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };
    case 'CLOSED': return { label: 'Closed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    case 'AVAILABLE': return { label: 'Available', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
    case 'REVOKED': return { label: 'Revoked', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    default: return { label: status, cls: 'bg-gray-100 text-gray-700' };
  }
}

export function Explore() {
  const { connectionState, blockHeight } = useConnectionStore();
  const [stats, setStats] = useState<ChainStats | null>(null);
  const [blocks, setBlocks] = useState<BlockSummary[]>([]);
  const [treeUpdate, setTreeUpdate] = useState<TreeUpdateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{
    type: string;
    data: unknown;
    loading: boolean;
    error?: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (connectionState !== 'connected') return;
    setLoading(true);
    try {
      const [coinSupply, recentBlocks, treeInfo] = await Promise.all([
        window.api.node.getCoinSupply(),
        window.api.node.getRecentBlocks(12),
        window.api.node.getTreeUpdateInfo(blockHeight),
      ]);
      setStats(coinSupply);
      setBlocks(recentBlocks);
      setTreeUpdate(treeInfo);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [connectionState, blockHeight]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    setSearchResult({ type: '', data: null, loading: true });

    try {
      // Detect query type and call appropriate API
      if (/^\d+$/.test(query)) {
        // Block height
        const height = parseInt(query, 10);
        try {
          const detail = await window.api.node.getBlockDetails(height);
          setSearchResult({ type: 'block', data: detail, loading: false });
        } catch {
          setSearchResult({ type: 'block', data: null, loading: false, error: `Block #${height} not found.` });
        }
      } else if (/^(hs|TS|RS|MS|es)[0-9a-z]{30,}/i.test(query)) {
        // Address
        const info = await window.api.node.getAddressInfo(query);
        if (info) {
          setSearchResult({ type: 'address', data: info, loading: false });
        } else {
          setSearchResult({ type: 'address', data: null, loading: false, error: 'Address not found.' });
        }
      } else if (/^[0-9a-fA-F]{64}$/.test(query)) {
        // Transaction hash
        try {
          const tx = await window.api.node.getTransaction(query);
          setSearchResult({ type: 'tx', data: tx, loading: false });
        } catch {
          setSearchResult({ type: 'tx', data: null, loading: false, error: 'Transaction not found.' });
        }
      } else {
        // Name lookup (convert Unicode to punycode)
        const punycodeQuery = toPunycode(query);
        try {
          const [nameInfo, resource, walletAuction] = await Promise.all([
            window.api.node.getNameInfo(punycodeQuery),
            window.api.node.getNameResource(punycodeQuery),
            window.api.wallet.getAuctionInfo(punycodeQuery).catch(() => null),
          ]);
          setSearchResult({ type: 'name', data: { nameInfo, resource, walletAuction }, loading: false });
        } catch {
          setSearchResult({ type: 'name', data: null, loading: false, error: `"${query}" not found.` });
        }
      }
    } catch {
      setSearchResult({ type: '', data: null, loading: false, error: 'Search failed.' });
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResult(null);
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
        <p className="text-gray-500 dark:text-gray-400 mb-4">Connect to your full node to explore the blockchain.</p>
        <Link
          to="/settings"
          className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors"
        >
          Go to Settings
        </Link>
      </div>
    );
  }

  const totalSupply = stats?.totalSupply || 0;
  const issuedEstimate = totalSupply * 1.16;
  const lockedEstimate = totalSupply * 0.00075;
  const burnedEstimate = totalSupply * 0.14;
  const namesEstimate = 12700000;
  const addressesEstimate = stats?.txouts || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Search */}
      <form onSubmit={handleSearch} className="relative max-w-2xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by block height, name, address, or tx hash..."
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-hns-500 focus:border-transparent"
        />
      </form>

      {/* Search Results */}
      {searchResult && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Search Results</h3>
            <button onClick={clearSearch} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
          </div>
          {searchResult.loading ? (
            <div className="py-4 text-center text-gray-400 text-sm">Searching...</div>
          ) : searchResult.error ? (
            <div className="py-4 text-center text-red-400 text-sm">{searchResult.error}</div>
          ) : searchResult.type === 'block' ? (
            <BlockSearchResult data={searchResult.data as import('../types/explore').BlockDetail} />
          ) : searchResult.type === 'name' ? (
            <NameSearchResult data={searchResult.data as { nameInfo: NameLookupResult; resource: unknown; walletAuction: Auction | null }} />
          ) : searchResult.type === 'address' ? (
            <AddressSearchResult data={searchResult.data as AddressInfo} />
          ) : searchResult.type === 'tx' ? (
            <TxSearchResult data={searchResult.data as { hash: string; height: number | null; fee: number }} />
          ) : null}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Blocks" value={stats ? stats.blocks.toLocaleString() : '...'} />
        <StatCard label="Names" value={stats ? namesEstimate.toLocaleString() : '...'} />
        <StatCard label="Addresses" value={stats ? addressesEstimate.toLocaleString() : '...'} />
        <StatCard label="Transactions" value={stats ? stats.transactions.toLocaleString() : '...'} />
        <StatCard label="Circulating" value={stats ? `${formatHNSFull(totalSupply)} HNS` : '...'} small />
        <StatCard label="Issued" value={stats ? `${formatHNSFull(issuedEstimate)} HNS` : '...'} small />
        <StatCard label="Locked" value={stats ? `${formatHNSFull(lockedEstimate)} HNS` : '...'} small />
        <StatCard label="Burned" value={stats ? `${formatHNSFull(burnedEstimate)} HNS` : '...'} small />
      </div>

      {/* Next Tree Update */}
      {treeUpdate && (
        <div className="text-sm text-gray-500">
          Next Tree Update Block{' '}
          <span className="font-mono font-medium text-hns-600">{treeUpdate.nextBlock.toLocaleString()}</span>
          {'  (in ~'}{treeUpdate.estimatedMinutes} minutes)
        </div>
      )}

      {/* Latest Blocks */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Latest Blocks</h3>
          <span className="text-xs text-gray-500">Block {blockHeight.toLocaleString()}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 font-medium">Height</th>
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium text-right">Txns</th>
                <th className="pb-2 font-medium text-right">Size</th>
                <th className="pb-2 font-medium text-right">Fees</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : blocks.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">No blocks</td></tr>
              ) : blocks.map((b) => (
                <tr key={b.height} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-2.5">
                    <Link
                      to={`/explore/block/${b.height}`}
                      className="font-mono text-hns-600 font-medium hover:underline"
                    >
                      {b.height}
                    </Link>
                  </td>
                  <td className="py-2.5 text-gray-500">{formatTime(b.time)}</td>
                  <td className="py-2.5 text-right font-mono">{b.transactions}</td>
                  <td className="py-2.5 text-right font-mono">{formatBytes(b.size)}</td>
                  <td className="py-2.5 text-right font-mono">{formatHNS(b.totalFee / 1_000_000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-center">
          <Link to={`/explore/block/${blockHeight}`} className="text-sm text-hns-600 hover:underline inline-flex items-center gap-1">
            Show all blocks <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-400 text-center pt-4">
        {new Date().toISOString().replace('T', ' • ').slice(0, 19)} • UTC • Block {blockHeight.toLocaleString()}
      </div>
    </div>
  );
}

// Sub-components

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="card text-center">
      <div className={`text-gray-500 ${small ? 'text-[10px]' : 'text-xs'} mb-0.5 truncate`}>{label}</div>
      <div className={`font-bold truncate ${small ? 'text-xs' : 'text-sm'}`}>{value}</div>
    </div>
  );
}

function BlockSearchResult({ data }: { data: import('../types/explore').BlockDetail }) {
  return (
    <div>
      <Link to={`/explore/block/${data.height}`} className="text-hns-600 hover:underline font-medium">
        Block #{data.height.toLocaleString()}
      </Link>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <div><span className="text-gray-500">Hash:</span> <span className="font-mono text-xs">{(data.hash || '').slice(0, 20)}...</span></div>
        <div><span className="text-gray-500">Time:</span> {new Date(data.time * 1000).toLocaleString()}</div>
        <div><span className="text-gray-500">Txns:</span> {data.txs.length}</div>
        <div><span className="text-gray-500">Size:</span> {formatBytes(data.size)}</div>
        <div><span className="text-gray-500">Weight:</span> {(data.weight / 1000).toFixed(2)} kWU</div>
        <div><span className="text-gray-500">Fees:</span> {formatHNSFull(data.totalFee / 1_000_000)} HNS</div>
      </div>
    </div>
  );
}

function NameSearchResult({ data }: { data: { nameInfo: NameLookupResult; resource: unknown; walletAuction: Auction | null } }) {
  const info = data.nameInfo;
  const walletAuction = data.walletAuction;
  // Use wallet auction state as fallback when node returns AVAILABLE
  // (getnameinfo can return null for names the wallet has bid on).
  const effectiveStatus = info?.status === 'AVAILABLE' && walletAuction?.state
    ? walletAuction.state
    : info?.status || 'UNKNOWN';
  const badge = statusBadge(effectiveStatus);
  const displayName = info?.name ? toUnicode(info.name) : '';
  const punycodeName = info?.name ? toPunycode(info.name) : '';
  const [showBid, setShowBid] = useState(false);

  const { walletInfo } = useConnectionStore();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openSuccess, setOpenSuccess] = useState(false);
  const [showPassphraseForOpen, setShowPassphraseForOpen] = useState(false);

  const handleBid = async (name: string, bid: number, lockup: number, passphrase: string) => {
    await window.api.wallet.sendBid(name, bid, lockup, passphrase);
  };

  const triggerOpenAuction = () => {
    const isEncrypted = walletInfo?.master?.encrypted ?? false;
    if (isEncrypted) {
      setShowPassphraseForOpen(true);
    } else {
      handleOpen('');
    }
  };

  const handleOpen = async (passphrase: string) => {
    setOpening(true);
    setOpenError(null);
    setOpenSuccess(false);
    try {
      await window.api.wallet.sendOpen(punycodeName, passphrase);
      setOpenSuccess(true);
      info.status = 'OPENING'; // Optimistically update standard status in component view
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Failed to open auction');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div>
      {showBid && punycodeName && (
        <BidModal
          name={punycodeName}
          onClose={() => setShowBid(false)}
          onBid={handleBid}
        />
      )}
      <div className="flex items-center gap-2 mb-2">
        <Link to={`/explore/name/${encodeURIComponent(punycodeName)}`} className="font-medium text-hns-600 hover:underline">
          {displayName || info?.name}
        </Link>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>{badge.label}</span>
      </div>
      {info?.error ? (
        <div className="text-sm text-red-400">{info.error}</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
          <div><span className="text-gray-500">Status:</span> {effectiveStatus || 'Unknown'}</div>
          <div><span className="text-gray-500">Owner:</span> {info?.owner ? `${info.owner.slice(0, 16)}...` : 'None'}</div>
          <div><span className="text-gray-500">Value:</span> {info?.value ? `${formatHNSFull(info.value / 1_000_000)} HNS` : '-'}</div>
          <div><span className="text-gray-500">Highest Bid:</span> {info?.highestBid ? `${formatHNSFull(info.highestBid)} HNS` : '-'}</div>
          <div><span className="text-gray-500">Expiry:</span> {info?.expiryBlock ? `Block ${info.expiryBlock.toLocaleString()}` : '-'}</div>
        </div>
      )}
      {effectiveStatus === 'BIDDING' && (
        <button onClick={() => setShowBid(true)}
          className="mt-3 flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium">
          <Gavel className="w-3.5 h-3.5" /> Bid Now
        </button>
      )}
      {effectiveStatus === 'AVAILABLE' && (
        <button onClick={triggerOpenAuction} disabled={opening}
          className="mt-3 flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50">
          {opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gavel className="w-3.5 h-3.5" />}
          {opening ? 'Opening...' : 'Open Auction'}
        </button>
      )}
      {effectiveStatus === 'REVEAL' && (
        <Link to={`/explore/name/${encodeURIComponent(punycodeName)}`}
          className="mt-3 flex items-center gap-1.5 text-xs px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">
          View Auction Details
        </Link>
      )}

      {openError && (
        <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-900/20 text-red-600 text-xs">{openError}</div>
      )}
      {openSuccess && (
        <div className="mt-2 p-2 rounded bg-green-50 dark:bg-green-900/20 text-green-600 text-xs">
          Auction successfully opened! Bidding will start in 37 blocks (~6 hours).
        </div>
      )}

      {showPassphraseForOpen && (
        <PassphraseModal
          title="Open Auction"
          onSubmit={(pwd) => {
            setShowPassphraseForOpen(false);
            handleOpen(pwd);
          }}
          onCancel={() => setShowPassphraseForOpen(false)}
        />
      )}
    </div>
  );
}

function AddressSearchResult({ data }: { data: AddressInfo }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-xs">{data.address}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <div><span className="text-gray-500">Balance:</span> {formatHNSFull(data.balance)} HNS</div>
        <div><span className="text-gray-500">Unconfirmed:</span> {formatHNSFull(data.unconfirmed)} HNS</div>
        <div><span className="text-gray-500">Txns:</span> {data.txCount.toLocaleString()}</div>
        <div><span className="text-gray-500">Names:</span> {data.names?.length || 0}</div>
      </div>
      {data.names && data.names.length > 0 && (
        <div className="mt-2">
          <span className="text-xs text-gray-500">Owned names:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {data.names.map(n => (
              <span key={n} className="px-2 py-0.5 bg-hns-50 dark:bg-hns-900/30 text-hns-600 rounded text-xs">{n}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TxSearchResult({ data }: { data: { hash: string; height: number | null; fee: number } }) {
  return (
    <div>
      <div className="text-sm font-mono break-all">{data.hash}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div><span className="text-gray-500">Block:</span> {data.height != null ? data.height.toLocaleString() : 'Pending'}</div>
        <div><span className="text-gray-500">Fee:</span> {data.fee ? formatHNSFull(data.fee / 1_000_000) : '-'} HNS</div>
      </div>
    </div>
  );
}
