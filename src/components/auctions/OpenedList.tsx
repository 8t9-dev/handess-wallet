import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock, Trash2, XCircle } from 'lucide-react';
import { toPunycode, toUnicode, blocksToTimeLeft } from '../../lib/name-utils';
import type { UnifiedHnsAuction } from '../../types/auction';
import type { NetworkName } from '../../lib/constants';

interface OpenedListProps {
  auctions: UnifiedHnsAuction[];
  network: NetworkName;
  onDelete: (name: string) => void;
  onClearAll: () => void;
}

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  OPENING: {
    label: 'Opening',
    classes: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
  },
  BIDDING: {
    label: 'Bidding',
    classes: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
  },
  REVEAL: {
    label: 'Reveal',
    classes: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20',
  },
  CLOSED: {
    label: 'Closed',
    classes: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800',
  },
  REDEEM: {
    label: 'Ended',
    classes: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800',
  },
};


export function OpenedList({ auctions, network, onDelete, onClearAll }: OpenedListProps) {
  const sorted = useMemo(
    () => [...auctions].sort((a, b) => {
      const aBlocks = a.blocksUntilNext ?? Number.MAX_SAFE_INTEGER;
      const bBlocks = b.blocksUntilNext ?? Number.MAX_SAFE_INTEGER;
      return aBlocks - bBlocks;
    }),
    [auctions],
  );

  const handleDelete = (name: string) => {
    if (window.confirm(`Remove "${name}" from the Opened list?`)) {
      onDelete(name);
    }
  };

  const renderStatus = (phase: string) => {
    const style = STATUS_STYLES[phase] || STATUS_STYLES.CLOSED;
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${style.classes}`}>
        <Clock className="w-3 h-3" />
        {style.label}
      </span>
    );
  };

  const renderTime = (a: UnifiedHnsAuction) => {
    const blocks = a.blocksUntilNext ?? 0;
    if (a.blockchainState === 'CLOSED' || a.blockchainState === 'REDEEM') {
      return <span className="text-gray-400">Ended</span>;
    }
    return blocks > 0
      ? `${blocks} (${blocksToTimeLeft(blocks, network)})`
      : '—';
  };

  const renderTimeUrgent = (a: UnifiedHnsAuction) => {
    const blocks = a.blocksUntilNext ?? 0;
    return blocks > 0 && blocks <= 144;
  };

  const handleClearAll = () => {
    if (window.confirm(`Remove all ${auctions.length} names from the Opened list?`)) {
      onClearAll();
    }
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800">
      {/* Clear All bar */}
      {auctions.length > 1 && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50/70 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-700">
          <span className="text-xs text-gray-500">{auctions.length} name{auctions.length !== 1 ? 's' : ''}</span>
          <button
            onClick={handleClearAll}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-600 transition-colors"
          >
            <XCircle className="w-3 h-3" />
            Clear All
          </button>
        </div>
      )}
      {/* Desktop / tablet: full table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5">Name / TLD</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-right px-4 py-2.5">Time Remaining</th>
              <th className="text-right px-4 py-2.5">Highest Bid</th>
              <th className="text-right px-4 py-2.5 w-32">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {sorted.map(a => (
              <tr key={a.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <td className="px-4 py-3">
                  <Link
                    to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                    className="font-semibold text-hns-600 hover:underline truncate block max-w-[16rem]"
                  >
                    {toUnicode(a.name)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {renderStatus(a.blockchainState)}
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`inline-flex items-center gap-1 font-mono ${
                      renderTimeUrgent(a)
                        ? 'text-orange-600 dark:text-orange-400 font-semibold'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    <Clock className="w-3 h-3" />
                    {renderTime(a)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">
                  {a.highestBid > 0 ? `${(a.highestBid / 1_000_000).toFixed(2)} HNS` : 'No bids'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <Link
                      to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                      className="inline-flex items-center text-gray-400 hover:text-hns-600 transition-colors"
                      title="View name details"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => handleDelete(a.name)}
                      className="inline-flex items-center text-gray-400 hover:text-red-500 transition-colors p-1"
                      title="Remove from list"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked rows */}
      <ul className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {sorted.map(a => (
          <li key={a.name} className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link
                to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                className="font-semibold text-hns-600 hover:underline truncate"
              >
                {toUnicode(a.name)}
              </Link>
              <div className="flex items-center gap-1 shrink-0">
                {renderStatus(a.blockchainState)}
                <button
                  onClick={() => handleDelete(a.name)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-1"
                  title="Remove from list"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span
                className={`inline-flex items-center gap-1 font-mono ${
                  renderTimeUrgent(a)
                    ? 'text-orange-600 dark:text-orange-400 font-semibold'
                    : 'text-gray-500'
                }`}
              >
                <Clock className="w-3 h-3" />
                {renderTime(a)}
              </span>
              <span className="font-mono text-gray-500">
                {a.highestBid > 0 ? `${(a.highestBid / 1_000_000).toFixed(2)} HNS` : 'No bids'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}