import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SEARCH_REFRESH_BLOCKS,
  MAX_SEARCH_REFRESH_BLOCKS,
  SEARCH_REFRESH_OPTIONS,
  getSearchRefreshOption,
  isSearchRefreshBlocks,
  normalizeSearchRefreshBlocks,
} from '../search-refresh';

describe('search refresh options', () => {
  it('offers the documented scan depths', () => {
    expect(SEARCH_REFRESH_OPTIONS.map((option) => option.blocks)).toEqual([
      1_000,
      10_000,
      50_000,
      105_120,
    ]);
  });

  it('normalizes IPC values safely', () => {
    expect(normalizeSearchRefreshBlocks(10_000)).toBe(10_000);
    expect(normalizeSearchRefreshBlocks(1)).toBe(100);
    expect(normalizeSearchRefreshBlocks(999_999)).toBe(MAX_SEARCH_REFRESH_BLOCKS);
    expect(normalizeSearchRefreshBlocks('2500')).toBe(2_500);
    expect(normalizeSearchRefreshBlocks(Number.NaN)).toBe(DEFAULT_SEARCH_REFRESH_BLOCKS);
    expect(normalizeSearchRefreshBlocks(undefined)).toBe(DEFAULT_SEARCH_REFRESH_BLOCKS);
  });

  it('recognizes saved preset values', () => {
    expect(isSearchRefreshBlocks(50_000)).toBe(true);
    expect(isSearchRefreshBlocks(2_500)).toBe(false);
    expect(getSearchRefreshOption(50_000).approx).toBe('~1 year');
  });
});
