/**
 * Handshake TLD Search Engine
 *
 * Searches the local compact TLD index for names with DNS/TXT records.
 * The index is bundled as a snapshot and can be refreshed from the connected
 * hsd node for recently updated names.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Database,
  ExternalLink,
  Filter,
  Globe2,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Tag,
  X,
} from 'lucide-react';
import { useConnectionStore } from '../stores/connection-store';
import type {
  HnsIndexRecord,
  HnsIndexSearchResponse,
  HnsIndexStatus,
} from '../types/search-engine';
import { MAX_NAME_LENGTH, VALID_NAME_REGEX } from '../lib/constants';
import { toUnicode } from '../lib/name-utils';
import {
  DEFAULT_SEARCH_REFRESH_BLOCKS,
  SEARCH_REFRESH_OPTIONS,
  getSearchRefreshOption,
  isSearchRefreshBlocks,
} from '../lib/search-refresh';

const PAGE_SIZE = 50;
const REFRESH_DEPTH_KEY = 'handess.search-engine.refresh-depth';

function readSavedRefreshDepth(): number {
  try {
    const raw = window.localStorage.getItem(REFRESH_DEPTH_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (isSearchRefreshBlocks(parsed)) return parsed;
  } catch {
    // Fall through to the default if storage is unavailable.
  }
  return DEFAULT_SEARCH_REFRESH_BLOCKS;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatDate(value: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function stateBadge(state: string): { label: string; className: string } {
  switch (state.toUpperCase()) {
    case 'CLOSED':
      return { label: 'Registered', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' };
    case 'TRANSFER':
      return { label: 'Transfer', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' };
    case 'REVOKED':
      return { label: 'Revoked', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' };
    case 'EXPIRED':
      return { label: 'Expired', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' };
    default:
      return { label: state || 'Unknown', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' };
  }
}

function recordBadge(type: string): string {
  switch (type) {
    case 'NS': return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
    case 'DS': return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
    case 'TXT': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    case 'GLUE4':
    case 'GLUE6': return 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300';
    case 'SYNTH4':
    case 'SYNTH6': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  }
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-hns-600 border-hns-600 text-white'
          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-hns-400 hover:text-hns-700 dark:hover:text-hns-300'
      }`}
    >
      {children}
    </button>
  );
}

function ResultCard({
  record,
  currentHeight,
  refreshing,
  onRefresh,
}: {
  record: HnsIndexRecord;
  currentHeight: number | null;
  refreshing: boolean;
  onRefresh: (name: string) => void;
}) {
  const navigate = useNavigate();
  const badge = stateBadge(record.state);
  const displayName = toUnicode(record.name);
  const blocksLeft = record.expiryBlock && currentHeight
    ? record.expiryBlock - currentHeight
    : null;
  const daysLeft = blocksLeft !== null ? Math.round(blocksLeft / 144) : null;

  return (
    <article className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:border-hns-300 dark:hover:border-hns-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => navigate(`/explore/name/${encodeURIComponent(record.name)}`)}
              className="text-lg font-semibold text-gray-900 dark:text-gray-100 hover:text-hns-600 dark:hover:text-hns-400 text-left truncate"
              title={displayName}
            >
              {displayName}
              <span className="text-gray-400">.</span>
            </button>
            <span className={`state-badge ${badge.className}`}>{badge.label}</span>
            {record.hasWebsite && (
              <span className="state-badge bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                <Globe2 className="w-3 h-3 mr-1" />
                Website
              </span>
            )}
          </div>
          {displayName !== record.name && (
            <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{record.name}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onRefresh(record.name)}
            disabled={refreshing}
            className="p-2 rounded-lg text-gray-400 hover:text-hns-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            title="Refresh this name from the node"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to={`/explore/name/${encodeURIComponent(record.name)}`}
            className="p-2 rounded-lg text-gray-400 hover:text-hns-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Open name details"
          >
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {record.recordTypes.map((type) => (
          <span key={type} className={`state-badge ${recordBadge(type)}`}>{type}</span>
        ))}
        {record.tags.map((tag) => (
          <span key={tag} className="state-badge bg-hns-50 text-hns-700 dark:bg-hns-900/30 dark:text-hns-300">
            <Tag className="w-3 h-3 mr-1" />
            {tag}
          </span>
        ))}
      </div>

      {record.ns.length > 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 truncate" title={record.ns.join(', ')}>
          <Server className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          {record.ns.slice(0, 3).join(', ')}
          {record.ns.length > 3 ? ` +${record.ns.length - 3}` : ''}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        {record.expiryBlock ? (
          <span>
            Expiry block {formatCount(record.expiryBlock)}
            {daysLeft !== null && (
              <span className={daysLeft < 90 ? 'text-amber-500' : ''}>
                {' '}({daysLeft >= 0 ? `${formatCount(daysLeft)} days left` : 'expired'})
              </span>
            )}
          </span>
        ) : (
          <span>Expiry unknown</span>
        )}
        {record.txt.length > 0 && (
          <span className="truncate max-w-full" title={record.txt.join(' | ')}>
            TXT: {record.txt[0]}
          </span>
        )}
      </div>
    </article>
  );
}

export function SearchEngine() {
  const { connectionState, blockHeight } = useConnectionStore();
  const isConnected = connectionState === 'connected';
  const [status, setStatus] = useState<HnsIndexStatus | null>(null);
  const [result, setResult] = useState<HnsIndexSearchResponse | null>(null);
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hasNS, setHasNS] = useState(false);
  const [hasDS, setHasDS] = useState(false);
  const [hasTXT, setHasTXT] = useState(false);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [registeredOnly, setRegisteredOnly] = useState(true);
  const [sort, setSort] = useState<'name' | 'expiry'>('name');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingName, setRefreshingName] = useState<string | null>(null);
  const [refreshDepth, setRefreshDepth] = useState(readSavedRefreshDepth);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentHeight = blockHeight || status?.blockHeight || null;
  const refreshOption = getSearchRefreshOption(refreshDepth);

  const loadStatus = useCallback(async () => {
    try {
      const next = await window.api.searchEngine.getStatus();
      setStatus(next);
      if (next.error && next.nameCount === 0) setError(next.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the TLD index.');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!window.api?.on?.searchEngineProgress) return;
    const unsubscribe = window.api.on.searchEngineProgress((next) => {
      setStatus(next);
      if (next.progress) setRefreshing(next.refreshing);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(REFRESH_DEPTH_KEY, String(refreshDepth));
    } catch {
      // Persisting the preference is best-effort.
    }
  }, [refreshDepth]);

  const runSearch = useCallback(async (searchOffset = offset) => {
    setLoading(true);
    setError(null);
    try {
      const next = await window.api.searchEngine.search({
        query,
        tags: selectedTags,
        hasNS: hasNS || undefined,
        hasDS: hasDS || undefined,
        hasTXT: hasTXT || undefined,
        hasWebsite: hasWebsite || undefined,
        states: registeredOnly ? ['CLOSED'] : undefined,
        sort,
        limit: PAGE_SIZE,
        offset: searchOffset,
      });
      setResult(next);
      setStatus(next.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }, [query, selectedTags, hasNS, hasDS, hasTXT, hasWebsite, registeredOnly, sort, offset]);

  useEffect(() => {
    const timer = setTimeout(() => { void runSearch(); }, 220);
    return () => clearTimeout(timer);
  }, [runSearch]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>(status?.topTags.map((item) => item.tag) || []);
    for (const tag of selectedTags) tags.add(tag);
    return [...tags].sort();
  }, [status, selectedTags]);

  const toggleTag = (tag: string) => {
    setOffset(0);
    setSelectedTags((current) => (
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    ));
  };

  const clearFilters = () => {
    setQuery('');
    setSelectedTags([]);
    setHasNS(false);
    setHasDS(false);
    setHasTXT(false);
    setHasWebsite(false);
    setRegisteredOnly(true);
    setSort('name');
    setOffset(0);
    setMessage(null);
  };

  const handleRefreshRecent = async () => {
    if (refreshing) return;
    if (!isConnected) {
      setError('Connect to your Handshake node to refresh the directory.');
      return;
    }
    setRefreshing(true);
    setCancelling(false);
    setMessage(null);
    setError(null);
    try {
      const result = await window.api.searchEngine.refreshRecent(refreshDepth);
      setStatus(result.status);
      const range = `${formatCount(result.fromHeight)}–${formatCount(result.toHeight)}`;
      const totalRange = result.toHeight - result.fromHeight + 1;
      const prefix = result.cancelled
        ? `Refresh cancelled after ${formatCount(result.scannedBlocks)} of ${formatCount(totalRange)} blocks`
        : `Scanned ${formatCount(result.scannedBlocks)} blocks`;
      const removedText = result.removed > 0
        ? `, removed ${formatCount(result.removed)}`
        : '';
      setMessage(
        `${prefix} (${range}); updated ${formatCount(result.updated)} names${removedText}.`,
      );
      setOffset(0);
      await runSearch(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh the TLD index.');
    } finally {
      setRefreshing(false);
      setCancelling(false);
    }
  };

  const handleCancelRefresh = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const requested = await window.api.searchEngine.cancelRefresh();
      if (!requested) setCancelling(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the refresh.');
      setCancelling(false);
    }
  };

  const handleRefreshName = async (name: string) => {
    if (refreshingName) return;
    if (!isConnected) {
      setError('Connect to your Handshake node to look up a name on-chain.');
      return;
    }
    setRefreshingName(name);
    setMessage(null);
    setError(null);
    try {
      const record = await window.api.searchEngine.refreshName(name);
      setMessage(record
        ? `Refreshed ${name} from the node.`
        : `${name} is no longer registered or has no resource records.`);
      await runSearch();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not refresh ${name}.`);
    } finally {
      setRefreshingName(null);
    }
  };

  const total = result?.total || 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const progress = status?.progress;
  const lookupName = query.trim().toLowerCase().replace(/\.+$/, '');
  const canLookupName = lookupName.length > 0
    && lookupName.length <= MAX_NAME_LENGTH
    && VALID_NAME_REGEX.test(lookupName);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Globe2 className="w-6 h-6 text-hns-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Search Engine</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
            Discover Handshake TLDs with DNS records and searchable TXT categories such as
            <code className="mx-1 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs">tag:sale</code>
            or
            <code className="mx-1 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs">tag:coffee</code>.
            Click a name to inspect it in the explorer.
          </p>
        </div>

        <div className="flex flex-col items-start lg:items-end gap-1">
          <button
            type="button"
            onClick={handleRefreshRecent}
            disabled={refreshing || !isConnected}
            title={isConnected
              ? `Scan the ${refreshOption.label.toLowerCase()} for DNS changes`
              : 'Connect to your Handshake node to refresh'}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-hns-600 text-white text-sm font-medium hover:bg-hns-700 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh from node'}
          </button>
          <span className="text-[11px] text-gray-400">
            {refreshOption.label} · {refreshOption.approx}
          </span>
        </div>
      </div>

      {!isConnected && (
        <div className="flex items-start gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 text-xs text-gray-600 dark:text-gray-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            You are offline. The bundled directory is still searchable; connect to your node to
            look up individual names or refresh recent DNS changes.
          </p>
        </div>
      )}

      {/* Index status */}
      <section className="card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-hns-50 dark:bg-hns-900/30">
              {status?.source === 'node'
                ? <Database className="w-5 h-5 text-hns-600 dark:text-hns-400" />
                : <BadgeCheck className="w-5 h-5 text-hns-600 dark:text-hns-400" />}
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {status?.source === 'node'
                  ? 'Live node index'
                  : status?.source === 'bundled-seed'
                    ? 'Bundled TLD snapshot'
                    : status?.source === 'bundled-seed+node'
                      ? 'Bundled snapshot + live updates'
                      : 'TLD index'}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {status
                  ? `${formatCount(status.nameCount)} names with records · ${formatCount(status.tagCount)} tags · snapshot ${formatDate(status.generatedAt)}`
                  : 'Loading the TLD directory...'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center md:text-right">
            <div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {status ? formatCount(status.nameCount) : '—'}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Names</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {status ? formatCount(status.tagCount) : '—'}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Tags</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {status?.blockHeight ? formatCount(status.blockHeight) : '—'}
              </div>
              <div
                className="text-[11px] uppercase tracking-wide text-gray-400"
                title="Chain height when this directory was last built or refreshed"
              >
                Index block
              </div>
            </div>
          </div>
        </div>

        {(status?.source === 'bundled-seed' || status?.source === 'bundled-seed+node') && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              This is a capped snapshot of registered names with DNS records. It favors tagged,
              custom-DNS, and TXT names over parked placeholders. Use <strong>Refresh from node</strong>
              to pick up changes in the selected range, or check an individual name on-chain from
              the results.
            </p>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <Settings2 className="w-4 h-4 mt-0.5 text-gray-400" />
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Refresh settings
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Choose how far back to scan for DNS record changes. Deeper scans take longer.
                </p>
              </div>
            </div>
            <select
              value={refreshDepth}
              onChange={(event) => setRefreshDepth(Number(event.target.value))}
              disabled={refreshing}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm disabled:opacity-60"
            >
              {SEARCH_REFRESH_OPTIONS.map((option) => (
                <option key={option.blocks} value={option.blocks}>
                  {option.label} ({option.approx})
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 ml-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span>{refreshOption.label}</span>
            <span>·</span>
            <span>Estimated {refreshOption.estimate}</span>
          </div>
          {refreshOption.warn && (
            <p className="mt-2 ml-6 text-[11px] text-amber-600 dark:text-amber-400">
              Deep scans read a large number of blocks and can take several minutes. You can
              cancel while it runs.
            </p>
          )}
        </div>

        {progress && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>{progress.message}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span>
                  {progress.total
                    ? `${Math.min(100, Math.round((progress.scanned / progress.total) * 100))}%`
                    : ''}
                </span>
                {refreshing && (
                  <button
                    type="button"
                    onClick={handleCancelRefresh}
                    disabled={cancelling}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-[11px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
                  >
                    <X className="w-3 h-3" />
                    {cancelling ? 'Cancelling...' : 'Cancel'}
                  </button>
                )}
              </div>
            </div>
            <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-hns-600 transition-all"
                style={{ width: progress.total ? `${Math.min(100, Math.round((progress.scanned / progress.total) * 100))}%` : '15%' }}
              />
            </div>
          </div>
        )}

        {status?.error && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{status.error}</p>
        )}
      </section>

      {/* Search and filters */}
      <section className="card space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setOffset(0); }}
              placeholder="Search TLD name, nameserver, record type, or TXT value..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-hns-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">Sort</label>
            <select
              value={sort}
              onChange={(event) => { setSort(event.target.value as 'name' | 'expiry'); setOffset(0); }}
              className="px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
            >
              <option value="name">Name</option>
              <option value="expiry">Expiry</option>
            </select>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            >
              <X className="w-4 h-4" />
              Clear
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">
            <Filter className="w-3.5 h-3.5" />
            Filters
          </span>
          <ToggleChip active={hasWebsite} onClick={() => { setHasWebsite((v) => !v); setOffset(0); }}>
            <Globe2 className="w-3.5 h-3.5" /> Has website/DNS
          </ToggleChip>
          <ToggleChip active={hasNS} onClick={() => { setHasNS((v) => !v); setOffset(0); }}>
            NS
          </ToggleChip>
          <ToggleChip active={hasDS} onClick={() => { setHasDS((v) => !v); setOffset(0); }}>
            DS / DNSSEC
          </ToggleChip>
          <ToggleChip active={hasTXT} onClick={() => { setHasTXT((v) => !v); setOffset(0); }}>
            TXT
          </ToggleChip>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 ml-1">
            <input
              type="checkbox"
              checked={registeredOnly}
              onChange={(event) => { setRegisteredOnly(event.target.checked); setOffset(0); }}
              className="rounded border-gray-300 text-hns-600 focus:ring-hns-500"
            />
            Registered only
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">
            <Tag className="w-3.5 h-3.5" />
            Tags
          </span>
          {availableTags.slice(0, 24).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedTags.includes(tag)
                  ? 'bg-hns-600 border-hns-600 text-white'
                  : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-hns-400'
              }`}
            >
              {tag}
              {status?.topTags.find((item) => item.tag === tag)?.count !== undefined && (
                <span className="ml-1 opacity-60">
                  {formatCount(status.topTags.find((item) => item.tag === tag)!.count)}
                </span>
              )}
            </button>
          ))}
          {availableTags.length === 0 && (
            <span className="text-xs text-gray-400">No tag: TXT records found in this index yet.</span>
          )}
        </div>

        {message && (
          <p className="text-xs text-hns-700 dark:text-hns-300 bg-hns-50 dark:bg-hns-900/20 rounded-lg px-3 py-2">
            {message}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </section>

      {/* Results */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {loading ? 'Searching...' : `${formatCount(total)} result${total === 1 ? '' : 's'}`}
            {result && result.durationMs > 50 && (
              <span className="ml-2 font-normal text-gray-400">({result.durationMs} ms)</span>
            )}
          </h2>
          {total > PAGE_SIZE && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                Previous
              </button>
              <span>Page {page} of {pageCount}</span>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {loading && !result ? (
          <div className="card flex items-center justify-center gap-2 py-12 text-gray-500 dark:text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading the TLD directory...
          </div>
        ) : result && result.records.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {result.records.map((record) => (
              <ResultCard
                key={record.name}
                record={record}
                currentHeight={currentHeight}
                refreshing={refreshingName === record.name}
                onRefresh={handleRefreshName}
              />
            ))}
          </div>
        ) : (
          <div className="card text-center py-12">
            <Globe2 className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">No matching TLDs</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
              Try a broader name search, remove a tag or record filter, or refresh the index from
              your node to include recent DNS updates.
            </p>
            {(status?.source === 'bundled-seed' || status?.source === 'bundled-seed+node') && (
              <p className="text-xs text-gray-400 mt-3">
                The bundled snapshot is capped to the most useful names. Any registered TLD can
                still be loaded directly from your node.
              </p>
            )}
            {canLookupName && (
              <button
                type="button"
                onClick={() => void handleRefreshName(lookupName)}
                disabled={refreshingName !== null || !isConnected}
                title={isConnected ? undefined : 'Connect to your Handshake node to look up a name'}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-hns-600 text-white text-sm font-medium hover:bg-hns-700 disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${refreshingName === lookupName ? 'animate-spin' : ''}`} />
                Check “{lookupName}” on-chain
              </button>
            )}
          </div>
        )}
      </section>

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        <ExternalLink className="w-3 h-3 inline mr-1 -mt-0.5" />
        Opening a TLD shows its on-chain details. A built-in Handshake browser/resolver is planned
        as a separate, isolated feature; this page never loads remote site content.
      </p>
    </div>
  );
}
