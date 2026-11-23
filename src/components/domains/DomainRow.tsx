/**
 * Domain Row Component
 */

import type { DomainWithMeta } from '../../types/domain';
import { getStateLabel, getStateBgColor, getUnicodeName, blocksToTimeLeft } from '../../lib/name-utils';
import { extractDomainTags, formatTags } from '../../lib/domain-tags';
import { useConnectionStore } from '../../stores/connection-store';
import { CheckSquare, Square } from 'lucide-react';

interface DomainRowProps {
  domain: DomainWithMeta;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}

export function DomainRow({ domain, isSelected, onToggleSelect, onClick }: DomainRowProps) {
  const blockHeight = useConnectionStore(s => s.blockHeight);
  const unicodeName = getUnicodeName(domain.name);
  return (
    <tr
      className="hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer"
      onClick={onClick}
    >
      <td className="px-3 py-3" onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}>
        {isSelected ? <CheckSquare className="w-5 h-5 text-hns-600" /> : <Square className="w-5 h-5" />}
      </td>
      <td className="px-4 py-3 text-sm">
        <span className="font-mono">{domain.name}</span>
        {unicodeName && (
          <span className="font-sans text-gray-400 dark:text-gray-500"> [ {unicodeName} ]</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`state-badge ${getStateBgColor(domain.state)}`}>
          {getStateLabel(domain.state)}
        </span>
      </td>
      <td className="px-4 py-3 text-sm font-mono">
        {domain.expiryBlock.toLocaleString()}
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
    </tr>
  );
}
