/**
 * Domain Table Component
 *
 * Sortable, filterable table of domains using TanStack Table.
 */

import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { DomainWithMeta } from '../../types/domain';
import { useDomainsStore } from '../../stores/domains-store';
import { useConnectionStore } from '../../stores/connection-store';
import { getStateLabel, getStateBgColor, toPunycode, getUnicodeName, getNameSortKey, blocksToTimeLeft } from '../../lib/name-utils';
import { extractDomainTags, formatTags } from '../../lib/domain-tags';
import { NETWORKS } from '../../lib/constants';
import { ArrowUpDown, ArrowUp, ArrowDown, CheckSquare, Square, DollarSign, XCircle, Check } from 'lucide-react';
import { BidModal } from '../batch/BidModal';
import { PassphraseModal } from '../common/PassphraseModal';

interface DomainTableProps {
  domains: DomainWithMeta[];
  isLoading: boolean;
}

/**
 * Name cell: punycode in mono, decoded IDNA/emoji form in brackets.
 *
 * Kept in a separate sans-serif span so emoji fall back to the system
 * emoji font instead of JetBrains Mono.
 */
function DomainName({ name }: { name: string }) {
  const unicodeName = getUnicodeName(name);
  return (
    <>
      <span className="font-mono">{name}</span>
      {unicodeName && (
        <span className="font-sans text-gray-400 dark:text-gray-500"> [ {unicodeName} ]</span>
      )}
    </>
  );
}

export function DomainTable({ domains, isLoading }: DomainTableProps) {
  const { selectedNames, toggleSelection, selectAll, deselectAll, setSort, sort } = useDomainsStore();
  const walletInfo = useConnectionStore(s => s.walletInfo);
  const blockHeight = useConnectionStore(s => s.blockHeight);
  const networkStr = useConnectionStore(s => s.network || 'main');
  const network = (networkStr === 'testnet' || networkStr === 'regtest' ? networkStr : 'main') as keyof typeof NETWORKS;
  const transferLockup = NETWORKS[network]?.transferLockup ?? 288;

  const [pageIndex, setPageIndex] = useState(0);
  const [bidTarget, setBidTarget] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{ name: string; type: 'finalize' | 'cancel' } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const pageSize = 50;

  const handleBid = async (name: string, bid: number, lockup: number, passphrase: string) => {
    await window.api.wallet.sendBid(name, bid, lockup, passphrase);
  };

  const handleTransferAction = async (type: 'finalize' | 'cancel', name: string, passphrase: string) => {
    setBusyAction(name);
    setActionError(null);
    try {
      if (type === 'finalize') {
        await window.api.wallet.sendFinalize(name, passphrase);
      } else {
        await window.api.wallet.sendCancel(name, passphrase);
      }
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : `Failed to ${type === 'finalize' ? 'finalize' : 'cancel'} the transfer.`,
      );
    } finally {
      setBusyAction(null);
      setActionTarget(null);
    }
  };

  const triggerTransferAction = (type: 'finalize' | 'cancel', name: string) => {
    const isEncrypted = walletInfo?.master?.encrypted ?? false;
    if (isEncrypted) {
      setActionTarget({ name, type });
    } else {
      handleTransferAction(type, name, '');
    }
  };

  const getTransferProgress = (domain: DomainWithMeta) => {
    if (!domain.transferring || !domain.transferBlock || blockHeight == null) return null;
    const blocksElapsed = blockHeight - domain.transferBlock;
    if (blocksElapsed >= transferLockup) {
      return { label: 'Ready to finalize', ready: true as const };
    }
    const blocksLeft = transferLockup - blocksElapsed;
    return { label: `${blocksLeft} blocks remaining`, ready: false as const };
  };

  const sortedDomains = useMemo(() => {
    const result = [...domains];
    // Precompute decoded sort keys once — decoding inside the comparator
    // would run tens of thousands of times per keystroke.
    const nameSortKeys = sort.field === 'name'
      ? new Map(domains.map((d) => [d.name, getNameSortKey(d.name)]))
      : null;
    result.sort((a, b) => {
      let cmp = 0;
      switch (sort.field) {
        case 'name': {
          // Match the store's sort: decoded names sort as their Unicode form.
          const aKey = nameSortKeys?.get(a.name) ?? a.name;
          const bKey = nameSortKeys?.get(b.name) ?? b.name;
          cmp = aKey.localeCompare(bKey) || a.name.localeCompare(b.name);
          break;
        }
        case 'expiryBlock':
          cmp = a.expiryBlock - b.expiryBlock;
          break;
        case 'state':
          cmp = a.state.localeCompare(b.state);
          break;
        case 'nameLength':
          cmp = a.name.length - b.name.length;
          break;
      }
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [domains, sort]);

  const totalPages = Math.ceil(sortedDomains.length / pageSize);
  const pagedDomains = sortedDomains.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const allSelected = pagedDomains.length > 0 && pagedDomains.every((d) => selectedNames.has(d.name));

  const SortIcon = ({ field }: { field: string }) => {
    if (sort.field !== field) return <ArrowUpDown className="w-4 h-4 opacity-50" />;
    return sort.direction === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />;
  };

  if (isLoading) {
    return (
      <div className="card p-8 text-center text-gray-500">
        Loading domains...
      </div>
    );
  }

  if (domains.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500">
        No domains found. Connect to Handess Wallet to manage your domains.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {actionError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-sm">
          {actionError}
        </div>
      )}
      <div className="table-container">
        <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-900">
          <tr>
            <th className="px-3 py-3 w-10">
              <button
                onClick={() => (allSelected ? deselectAll() : selectAll())}
                className="p-1"
              >
                {allSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
              </button>
            </th>
            <th
              className="px-4 py-3 text-left text-sm font-medium cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setSort({ field: 'name', direction: sort.field === 'name' && sort.direction === 'asc' ? 'desc' : 'asc' })}
            >
              <div className="flex items-center gap-1">
                Name <SortIcon field="name" />
              </div>
            </th>
            <th
              className="px-4 py-3 text-left text-sm font-medium cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setSort({ field: 'state', direction: sort.field === 'state' && sort.direction === 'asc' ? 'desc' : 'asc' })}
            >
              <div className="flex items-center gap-1">
                State <SortIcon field="state" />
              </div>
            </th>
            <th
              className="px-4 py-3 text-left text-sm font-medium cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setSort({ field: 'expiryBlock', direction: sort.field === 'expiryBlock' && sort.direction === 'asc' ? 'desc' : 'asc' })}
            >
              <div className="flex items-center gap-1">
                Expires <SortIcon field="expiryBlock" />
              </div>
            </th>
            <th className="px-4 py-3 text-left text-sm font-medium">Tags</th>
            <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {pagedDomains.map((domain) => (
            <tr key={domain.name} className="hover:bg-gray-50 dark:hover:bg-gray-900">
              <td className="px-3 py-3">
                <button onClick={() => toggleSelection(domain.name)}>
                  {selectedNames.has(domain.name) ? (
                    <CheckSquare className="w-5 h-5 text-hns-600" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </button>
              </td>
              <td className="px-4 py-3 text-sm">
                <DomainName name={domain.name} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`state-badge ${domain.transferring ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : getStateBgColor(domain.state)}`}>
                    {domain.transferring ? 'Transferring' : getStateLabel(domain.state)}
                  </span>
                  {domain.transferring && (() => {
                    const progress = getTransferProgress(domain);
                    if (!progress) return null;
                    return (
                      <span className={`text-xs ${progress.ready ? 'text-green-600' : 'text-orange-500'}`}>
                        {progress.ready ? (
                          <span className="flex items-center gap-1"><Check className="w-3 h-3" />{progress.label}</span>
                        ) : progress.label}
                      </span>
                    );
                  })()}
                </div>
              </td>
              <td className="px-4 py-3 text-sm">
                Block {domain.expiryBlock.toLocaleString()}
                {blockHeight > 0 && domain.expiryBlock > 0 && (
                  <span className="text-gray-400 ml-1">
                    ({blocksToTimeLeft(domain.expiryBlock - blockHeight)})
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                {(() => {
                  const tags = extractDomainTags(domain.dnsRecords);
                  return tags.length > 0 ? formatTags(tags) : '—';
                })()}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  {domain.state === 'BIDDING' && (
                    <button
                      onClick={() => setBidTarget(domain.name)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-hns-600 text-white rounded hover:bg-hns-700"
                    >
                      <DollarSign className="w-3 h-3" />
                      Bid
                    </button>
                  )}
                  {domain.transferring && (() => {
                    const progress = getTransferProgress(domain);
                    if (!progress) return null;
                    if (progress.ready) {
                      return (
                        <button
                          onClick={() => triggerTransferAction('finalize', domain.name)}
                          disabled={busyAction === domain.name}
                          className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                        >
                          {busyAction === domain.name ? 'Finalizing...' : <><Check className="w-3 h-3" />Finalize</>}
                        </button>
                      );
                    }
                    return (
                      <button
                        onClick={() => triggerTransferAction('cancel', domain.name)}
                        disabled={busyAction === domain.name}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                      >
                        {busyAction === domain.name ? 'Cancelling...' : <><XCircle className="w-3 h-3" />Cancel</>}
                      </button>
                    );
                  })()}
                  <Link
                    to={`/explore/name/${encodeURIComponent(toPunycode(domain.name))}`}
                    className="text-hns-600 hover:underline text-sm"
                  >
                    View
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500">
            Page {pageIndex + 1} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
              disabled={pageIndex === 0}
              className="px-3 py-1 text-sm border rounded disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPageIndex(Math.min(totalPages - 1, pageIndex + 1))}
              disabled={pageIndex === totalPages - 1}
              className="px-3 py-1 text-sm border rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
      </div>

      {bidTarget && (
        <BidModal
          name={bidTarget}
          onClose={() => setBidTarget(null)}
          onBid={handleBid}
        />
      )}

      {actionTarget && (
        <PassphraseModal
          title={actionTarget.type === 'finalize' ? 'Finalize Transfer' : 'Cancel Transfer'}
          onSubmit={(pwd) => handleTransferAction(actionTarget.type, actionTarget.name, pwd)}
          onCancel={() => setActionTarget(null)}
        />
      )}
    </div>
  );
}
