import { useState } from 'react';
import { useSwapStore } from '../../stores/swap-store';
import type { SwapOffer } from '../../types/swap';
import { ExternalLink, Clock, Loader2, AlertCircle } from 'lucide-react';

export function ActiveOffersList() {
  const { activeOffers, acceptOffer, loading, dgbAddress, error } = useSwapStore();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [localAcceptError, setLocalAcceptError] = useState('');

  const handleAccept = async (offer: SwapOffer) => {
    setLocalAcceptError('');
    setAcceptingId(offer.id);
    try {
      await acceptOffer(offer);
    } catch { /* error handled by store */ }
    setAcceptingId(null);
  };

  const formatTime = (ts: number | null | undefined) => {
    if (!ts) return 'Never';
    const diff = ts * 1000 - Date.now();
    if (diff <= 0) return 'Expired';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  if (activeOffers.length === 0) {
    return (
      <div className="card p-6 text-center text-gray-400">
        <ExternalLink className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No active swap offers found on Nostr relays</p>
        <p className="text-xs mt-1">Offers appear here as they are published by other wallets</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Active Offers ({activeOffers.length})</h3>
      {activeOffers.map((offer) => (
        <div key={offer.id} className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {offer.direction === 'hnsToDgb' ? 'HNS → DGB' : 'DGB → HNS'}
            </span>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTime(offer.expiresAt)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-400">HNS:</span>
              <span className="ml-1 font-mono font-medium">{offer.hnsAmount.toFixed(6)}</span>
            </div>
            <div>
              <span className="text-gray-400">DGB:</span>
              <span className="ml-1 font-mono font-medium">{offer.dgbAmount.toFixed(8)}</span>
            </div>
            <div className="col-span-2">
              <span className="text-gray-400">Rate:</span>
              <span className="ml-1">1 HNS = {(1 / (offer.exchangeRate || 0.5)).toFixed(8)} DGB</span>
            </div>
          </div>
          <div className="text-xs text-gray-400 font-mono truncate">
            Pubkey: {offer.nostrPubkey.slice(0, 16)}...
          </div>
          <div className="text-xs text-gray-400">
            {offer.direction === 'hnsToDgb'
              ? `You provide ${offer.dgbAmount.toFixed(8)} DGB and receive ${offer.hnsAmount.toFixed(6)} HNS. The HNS side locks first.`
              : `You provide ${offer.hnsAmount.toFixed(6)} HNS and receive ${offer.dgbAmount.toFixed(8)} DGB. You lock HNS first; the DGB side funds after it confirms.`}
          </div>
          <div className="space-y-2">
            <button
              onClick={() => handleAccept(offer)}
              disabled={
                loading
                || acceptingId === offer.id
                || !dgbAddress
                || (offer.expiresAt != null && offer.expiresAt * 1000 <= Date.now())
              }
              className="w-full px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2"
            >
              {acceptingId === offer.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              {offer.expiresAt != null && offer.expiresAt * 1000 <= Date.now()
                ? 'Expired'
                : acceptingId === offer.id ? 'Accepting...' : 'Accept Offer'}
            </button>
          </div>
        </div>
      ))}
      {(localAcceptError || error) && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {localAcceptError || error}
        </div>
      )}
    </div>
  );
}
