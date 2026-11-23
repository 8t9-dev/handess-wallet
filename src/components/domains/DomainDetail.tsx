import type { DomainWithMeta } from '../../types/domain';
import { getStateLabel, getStateBgColor, formatHNS, blocksToTimeLeft } from '../../lib/name-utils';
import { useConnectionStore } from '../../stores/connection-store';
import { DollarSign } from 'lucide-react';

interface DomainDetailProps {
  domain: DomainWithMeta;
  onClose: () => void;
  onBid?: (name: string) => void;
}

export function DomainDetail({ domain, onClose, onBid }: DomainDetailProps) {
  const blockHeight = useConnectionStore(s => s.blockHeight);
  return (
    <div className="card space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold font-mono">{domain.name}</h2>
          <span className={`state-badge ${getStateBgColor(domain.state)} mt-2`}>
            {getStateLabel(domain.state)}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm text-gray-500">Expiry Block</div>
          <div className="font-mono">
            {domain.expiryBlock.toLocaleString()}
            {blockHeight > 0 && domain.expiryBlock > 0 && (
              <span className="text-gray-400 text-xs ml-1">
                ({blocksToTimeLeft(domain.expiryBlock - blockHeight)})
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Value</div>
          <div>{formatHNS(domain.value)}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Renewal Block</div>
          <div className="font-mono">{domain.renewalBlock.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Highest Bid</div>
          <div>{domain.highestBid > 0 ? formatHNS(domain.highestBid) : '-'}</div>
        </div>
      </div>

      <div>
        <div className="text-sm text-gray-500 mb-2">DNS Records</div>
        {domain.dnsRecords.length === 0 ? (
          <div className="text-gray-400">No records set</div>
        ) : (
          <pre className="text-xs bg-gray-100 dark:bg-gray-900 p-3 rounded-lg overflow-x-auto">
            {JSON.stringify(domain.dnsRecords, null, 2)}
          </pre>
        )}
      </div>

      <div className="flex gap-2 pt-4 border-t">
        {domain.state === 'BIDDING' && onBid && (
          <button
            onClick={() => onBid(domain.name)}
            className="flex items-center justify-center gap-2 flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700"
          >
            <DollarSign className="w-4 h-4" />
            Place Bid
          </button>
        )}
        <button className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700">
          Renew
        </button>
        <button className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
          Transfer
        </button>
        <button className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
          Update DNS
        </button>
      </div>
    </div>
  );
}
