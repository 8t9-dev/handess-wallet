import { useState, useEffect } from 'react';

const CACHE_KEY = 'hns_price_cache';
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

export function useHnsPrice(): { price: number | null; loading: boolean } {
  const [price, setPrice] = useState<number | null>(getCachedPrice);
  const [loading, setLoading] = useState(price === null);

  useEffect(() => {
    const cached = getCachedPrice();
    if (cached !== null) {
      setPrice(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;

    window.api.price.getHnsUsd()
      .then(usd => {
        if (cancelled) return;
        if (typeof usd === 'number' && usd > 0) {
          setPrice(usd);
          setCachedPrice(usd);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return { price, loading };
}
