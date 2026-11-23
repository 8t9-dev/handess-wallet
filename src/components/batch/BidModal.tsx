import { useState, useEffect } from 'react';
import { X, Loader2, DollarSign, ArrowRight, Check } from 'lucide-react';
import { useConnectionStore } from '../../stores/connection-store';

interface BidModalProps {
  name: string;
  onClose: () => void;
  onBid: (name: string, bid: number, lockup: number, passphrase: string) => Promise<void>;
}

type Step = 'entry' | 'confirm';

const ESTIMATED_TX_SIZE_KB = 0.3;

export function BidModal({ name, onClose, onBid }: BidModalProps) {
  const [step, setStep] = useState<Step>('entry');
  const [bidAmount, setBidAmount] = useState('');
  const [blindAmount, setBlindAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState(0);

  const { walletInfo } = useConnectionStore();
  const isEncrypted = walletInfo?.master?.encrypted ?? false;
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    window.api.wallet.getFeeEstimates().then(estimates => {
      const standard = estimates.find(e => e.speed === 'standard');
      if (standard) {
        const feeHns = parseFloat(standard.feeHns);
        if (!isNaN(feeHns)) setFeeEstimate(feeHns * ESTIMATED_TX_SIZE_KB);
      }
    }).catch(() => setFeeEstimate(0.01));
  }, []);

  const handleBidChange = (val: string) => {
    setBidAmount(val);
    const bid = parseFloat(val);
    if (!isNaN(bid) && bid > 0) {
      setBlindAmount((bid * 1).toFixed(2));
    }
  };

  const handleReview = () => {
    const bid = parseFloat(bidAmount);
    if (!bidAmount || isNaN(bid) || bid <= 0) {
      setError('Enter a valid bid amount');
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (isEncrypted && !passphrase) {
      setError('Enter your wallet passphrase');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const bid = parseFloat(bidAmount);
      const blind = parseFloat(blindAmount) || 0;
      // Total lockup = bid + blind (blind is the extra concealment returned on reveal)
      await onBid(name, bid, bid + blind, passphrase);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bid failed');
    } finally {
      setBusy(false);
    }
  };

  const bid = parseFloat(bidAmount) || 0;
  const blind = parseFloat(blindAmount) || 0;
  const lockup = bid + blind;
  const total = lockup + feeEstimate;

  const resetToEntry = () => {
    setStep('entry');
    setPassphrase('');
    setError(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={step === 'confirm' ? undefined : onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>

        {step === 'entry' && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-hns-600" />
                Place Bid
              </h3>
              <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-hns-50 dark:bg-hns-900/20 rounded-lg p-3">
              <div className="text-sm text-gray-500">Name</div>
              <div className="font-mono font-medium text-lg">{name}</div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Bid Amount (HNS)</label>
              <div className="text-xs text-gray-400 mb-1">Locked until reveal</div>
              <input type="number" value={bidAmount} onChange={e => handleBidChange(e.target.value)}
                min="0.01" step="0.01"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                placeholder="100" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Concealment / Blind (HNS) <span className="text-gray-400 font-normal">optional</span></label>
              <div className="text-xs text-gray-400 mb-1">Extra amount returned on reveal. Hidden bids &gt; 0 prevent others from estimating your true bid.</div>
              <input type="number" value={blindAmount} onChange={e => setBlindAmount(e.target.value)}
                min="0" step="0.01"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                placeholder="100" />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm">{error}</div>
            )}

            <button onClick={handleReview} disabled={!bidAmount}
              className="w-full py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2 font-medium">
              Review Bid <ArrowRight className="w-4 h-4" />
            </button>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Check className="w-5 h-5 text-amber-500" />
                Confirm Bid
              </h3>
              <button onClick={resetToEntry} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-hns-50 dark:bg-hns-900/20 rounded-lg p-3">
              <div className="text-sm text-gray-500">Name</div>
              <div className="font-mono font-medium text-lg">{name}</div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="text-gray-500">Bid Amount</span>
                <span className="font-medium">{bid.toFixed(2)} HNS</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="text-gray-500">Concealment (returned on reveal)</span>
                <span className="font-medium">{blind.toFixed(2)} HNS</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="text-gray-500">Total Lockup (Bid + Blind)</span>
                <span className="font-medium">{lockup.toFixed(2)} HNS</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="text-gray-500">Network Fee (est.)</span>
                <span className="font-medium">{feeEstimate.toFixed(4)} HNS</span>
              </div>
              <div className="flex justify-between py-2 font-semibold">
                <span>Total Deducted</span>
                <span>{total.toFixed(4)} HNS</span>
              </div>
            </div>

            {isEncrypted && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Wallet Passphrase
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter your wallet passphrase"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500 text-sm"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) handleConfirm(); }}
                />
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm">{error}</div>
            )}

            <div className="flex gap-3">
              <button onClick={resetToEntry}
                className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium">
                Back
              </button>
              <button onClick={handleConfirm} disabled={busy}
                className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2 font-medium">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {busy ? 'Submitting...' : 'Confirm & Submit'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}