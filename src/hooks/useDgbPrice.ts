import { useState, useEffect } from 'react';

const CACHE_KEY = 'dgb_price_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface PriceCache {
  price: number;
  timestamp: number;
}

function getCachedPrice(): number | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: PriceCache = JSON.parse(raw);
    if (Date.now() - cache.timestamp > CACHE_DURATION) return null;
    return cache.price;
  } catch {
    return null;
  }
}

function setCachedPrice(price: number) {
  try {
    const cache: PriceCache = { price, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

export function useDgbPrice(): { price: number | null; loading: boolean; refresh: () => void } {
  const [price, setPrice] = useState<number | null>(getCachedPrice);
  const [loading, setLoading] = useState(price === null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    window.api.price.getDgbUsd()
      .then(usd => {
        if (cancelled) return;
        if (typeof usd === 'number' && usd > 0) {
          setPrice(usd);
          setCachedPrice(usd);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [tick]);

  return { price, loading, refresh: () => setTick(t => t + 1) };
}
