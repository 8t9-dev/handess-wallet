import { useState, useEffect, useMemo } from 'react';
import { useSwapStore } from '../../stores/swap-store';
import { useHnsPrice } from '../../hooks/useHnsPrice';
import { useDgbPrice } from '../../hooks/useDgbPrice';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

const FALLBACK_HNS_PER_DGB = 0.5;

export function CreateSwapOffer() {
  const { dgbAddress, publishOffer, loading, error } = useSwapStore();
  const { price: hnsUsd, loading: hnsLoading } = useHnsPrice();
  const { price: dgbUsd, loading: dgbLoading, refresh: refreshDgb } = useDgbPrice();

  const [direction, setDirection] = useState<'hnsToDgb' | 'dgbToHns'>('hnsToDgb');
  const [hnsAmount, setHnsAmount] = useState('');
  const [dgbAmount, setDgbAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState(String(FALLBACK_HNS_PER_DGB));
  const [rateIsManual, setRateIsManual] = useState(false);
  const [expiryHours, setExpiryHours] = useState('24');
  const [localError, setLocalError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Compute the live HNS/DGB rate (how many HNS equal 1 DGB).
  //
  // The "HNS/DGB" rate in this form means "HNS per 1 DGB" — i.e.,
  // 1 DGB = X HNS. Conversion:
  //   X = (USD value of 1 DGB) / (USD value of 1 HNS)
  //     = dgbUsd / hnsUsd
  //
  // The math in handleHnsChange / handleDgbChange (dgb = hns / rate,
  // hns = dgb * rate) is consistent with this interpretation: dividing
  // HNS by "HNS per DGB" yields DGB, and multiplying DGB by "HNS per
  // DGB" yields HNS.
  //
  // Worked example (HNS = $0.004, DGB = $0.0032):
  //   rate = 0.0032 / 0.004 = 0.8  (1 DGB = 0.8 HNS)
  //   30 HNS / 0.8 = 37.5 DGB     (HNS worth more per coin → more DGB)
  //   30 DGB * 0.8 = 24 HNS       (DGB worth less per coin → less HNS)
  const marketRate = useMemo(() => {
    if (hnsUsd && dgbUsd && hnsUsd > 0 && dgbUsd > 0) {
      return dgbUsd / hnsUsd;
    }
    return null;
  }, [hnsUsd, dgbUsd]);

  // Inverse rate (DGB per 1 HNS) — used for display so the user can
  // see "1 HNS = X DGB" alongside the underlying USD prices.
  const inverseRate = useMemo(() => {
    if (hnsUsd && dgbUsd && hnsUsd > 0 && dgbUsd > 0) {
      return hnsUsd / dgbUsd;
    }
    return null;
  }, [hnsUsd, dgbUsd]);

  // Auto-populate the exchange rate from the market rate on first load
  // (or whenever the market rate updates and the user hasn't manually edited it).
  useEffect(() => {
    if (marketRate !== null && !rateIsManual) {
      setExchangeRate(marketRate.toFixed(8));
    }
  }, [marketRate, rateIsManual]);

  const handleHnsChange = (val: string) => {
    setHnsAmount(val);
    const rate = parseFloat(exchangeRate) || FALLBACK_HNS_PER_DGB;
    const hns = parseFloat(val) || 0;
    setDgbAmount(String((hns / rate).toFixed(8)));
  };

  const handleDgbChange = (val: string) => {
    setDgbAmount(val);
    const rate = parseFloat(exchangeRate) || FALLBACK_HNS_PER_DGB;
    const dgb = parseFloat(val) || 0;
    setHnsAmount(String((dgb * rate).toFixed(6)));
  };

  const handleRateChange = (val: string) => {
    setRateIsManual(true);
    setExchangeRate(val);
    if (hnsAmount) handleHnsChange(hnsAmount);
    else if (dgbAmount) handleDgbChange(dgbAmount);
  };

  const handleUseMarketRate = () => {
    if (marketRate === null) return;
    setRateIsManual(false);
    setExchangeRate(marketRate.toFixed(8));
    if (hnsAmount) handleHnsChange(hnsAmount);
    else if (dgbAmount) handleDgbChange(dgbAmount);
  };

  const handleSubmit = async () => {
    setLocalError('');
    if (!dgbAddress) {
      setLocalError('No DGB address. Connect to DGB network first.');
      return;
    }
    const hns = parseFloat(hnsAmount);
    const dgb = parseFloat(dgbAmount);
    const rate = parseFloat(exchangeRate) || FALLBACK_HNS_PER_DGB;
    if (!hns || hns <= 0) { setLocalError('Enter HNS amount'); return; }
    if (!dgb || dgb <= 0) { setLocalError('Enter DGB amount'); return; }

    const expiresAt = parseInt(expiryHours) > 0
      ? Math.floor(Date.now() / 1000) + parseInt(expiryHours) * 3600
      : null;

    try {
      await publishOffer({
        direction,
        hnsAmount: hns,
        dgbAmount: dgb,
        exchangeRate: rate,
        dgbAddress,
        expiresAt,
      });
      setHnsAmount('');
      setDgbAmount('');
      setSuccessMsg('Offer published successfully!');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to publish offer');
    }
  };

  const pricesLoading = hnsLoading || dgbLoading;

  return (
    <div className="card p-4 space-y-4">
      <h3 className="text-lg font-semibold">Create Swap Offer</h3>

      <div>
        <label className="block text-sm font-medium mb-1">Direction</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDirection('hnsToDgb')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              direction === 'hnsToDgb'
                ? 'bg-hns-100 border-hns-300 text-hns-700 dark:bg-hns-900/30 dark:border-hns-600 dark:text-hns-300'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}
          >
            HNS → DGB
          </button>
          <button
            type="button"
            onClick={() => setDirection('dgbToHns')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              direction === 'dgbToHns'
                ? 'bg-hns-100 border-hns-300 text-hns-700 dark:bg-hns-900/30 dark:border-hns-600 dark:text-hns-300'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}
          >
            DGB → HNS
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {direction === 'hnsToDgb'
            ? 'You provide HNS and receive DGB. You lock HNS first; the acceptor locks DGB after it confirms.'
            : 'You provide DGB and receive HNS. The acceptor locks HNS first; you lock DGB after it confirms.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">HNS Amount</label>
          <input type="number" step="0.000001" min="0"
            value={hnsAmount}
            onChange={e => handleHnsChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
            placeholder="0.000000" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">DGB Amount</label>
          <input type="number" step="0.00000001" min="0"
            value={dgbAmount}
            onChange={e => handleDgbChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
            placeholder="0.00000000" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">
              Exchange Rate (HNS/DGB)
            </label>
            {marketRate !== null && (
              <button
                type="button"
                onClick={handleUseMarketRate}
                disabled={pricesLoading}
                className="flex items-center gap-1 text-xs text-hns-600 hover:text-hns-700 disabled:opacity-50"
                title="Reset to the current CoinGecko market rate"
              >
                <RefreshCw className="w-3 h-3" />
                Use market
              </button>
            )}
          </div>
          <input type="number" step="0.00000001" min="0"
            value={exchangeRate}
            onChange={e => handleRateChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
          <div className="mt-1 text-xs text-gray-500 flex items-center gap-2 flex-wrap">
            {pricesLoading && marketRate === null ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Fetching prices…
              </>
            ) : marketRate !== null ? (
              <>
                <span>
                  1 HNS ≈ ${hnsUsd?.toFixed(4)} · 1 DGB ≈ ${dgbUsd?.toFixed(4)} ·
                  1 HNS ≈ {inverseRate?.toFixed(4)} DGB
                </span>
                <button
                  type="button"
                  onClick={refreshDgb}
                  disabled={dgbLoading}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                  title="Refresh DGB price"
                >
                  <RefreshCw className={`w-3 h-3 ${dgbLoading ? 'animate-spin' : ''}`} />
                </button>
              </>
            ) : (
              <span>Live price feed unavailable — using manual rate.</span>
            )}
            {rateIsManual && marketRate !== null && (
              <span className="text-amber-600 dark:text-amber-400">(manual)</span>
            )}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Expiry</label>
          <select value={expiryHours} onChange={e => setExpiryHours(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm">
            <option value="1">1 hour</option>
            <option value="6">6 hours</option>
            <option value="24">24 hours</option>
            <option value="72">3 days</option>
            <option value="168">7 days</option>
            <option value="">No expiry</option>
          </select>
        </div>
      </div>

      {(localError || error) && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {localError || error}
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 text-sm flex items-center gap-2">
          <span>{successMsg}</span>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? 'Publishing...' : 'Publish Offer'}
      </button>
    </div>
  );
}
