/**
 * Portfolio Summary Component (Dashboard)
 *
 * Shows HNS price, confirmed/spendable balance, and pending purchase requests
 * for names the user currently has listed for sale.
 */

import type { WalletBalance } from '../../types/wallet';
import { dollaryDoosToHNS } from '../../lib/name-utils';
import { HnsSymbol } from '../icons/HnsSymbol';

interface PortfolioSummaryProps {
  balance: WalletBalance | null;
  purchaseRequestCount: number;
  hnsPrice?: number | null;
}

export function PortfolioSummary({
  balance,
  purchaseRequestCount,
  hnsPrice,
}: PortfolioSummaryProps) {
  const confirmedHNS = balance ? dollaryDoosToHNS(balance.confirmed) : 0;
  const spendableHNS = balance ? dollaryDoosToHNS(balance.confirmed - balance.lockedConfirmed) : 0;
  const lockedHNS = confirmedHNS - spendableHNS;

  const formatUSD = (hns: number) => {
    if (hnsPrice === null || hnsPrice === undefined) return null;
    return (hns * hnsPrice).toFixed(2);
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="card flex items-center gap-3">
        <HnsSymbol className="w-20 h-20" />
        <div>
          {hnsPrice != null ? (
            <div className="text-2xl font-bold">${hnsPrice.toFixed(4)}</div>
          ) : (
            <div className="text-2xl font-bold">-</div>
          )}
          <div className="text-sm text-gray-500">HNS / USD</div>
        </div>
      </div>
      <div className="card">
        <div className="text-2xl font-bold">{confirmedHNS.toFixed(2)}</div>
        <div className="text-sm text-gray-500">Balance (HNS)</div>
        {lockedHNS > 0 && (
          <div className="text-xs text-gray-400">+ {lockedHNS.toFixed(2)} locked</div>
        )}
        {formatUSD(confirmedHNS) && (
          <div className="text-xs text-gray-400">~${formatUSD(confirmedHNS)} USD</div>
        )}
      </div>
      <div className="card">
        <div className="text-2xl font-bold">{spendableHNS.toFixed(2)}</div>
        <div className="text-sm text-gray-500">Spendable (HNS)</div>
        {formatUSD(spendableHNS) && (
          <div className="text-xs text-gray-400">~${formatUSD(spendableHNS)} USD</div>
        )}
      </div>
      <div className="card">
        <div className="text-2xl font-bold">{purchaseRequestCount}</div>
        <div className="text-sm text-gray-500">Purchase Requests</div>
        <div className="text-xs text-gray-400">For names listed for sale</div>
      </div>
    </div>
  );
}
