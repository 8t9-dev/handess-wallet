/**
 * Search Engine refresh scope options.
 *
 * Handshake targets one block every 10 minutes (144 blocks/day), so the
 * presets line up with roughly one week, ten weeks, one year, and the full
 * two-year mainnet renewal window.
 */

export interface SearchRefreshOption {
  blocks: number;
  label: string;
  approx: string;
  estimate: string;
  warn?: boolean;
}

export const SEARCH_REFRESH_OPTIONS: SearchRefreshOption[] = [
  {
    blocks: 1_000,
    label: 'Last 1,000 blocks',
    approx: '~1 week',
    estimate: '~7 seconds',
  },
  {
    blocks: 10_000,
    label: 'Last 10,000 blocks',
    approx: '~10 weeks',
    estimate: '~1 minute',
  },
  {
    blocks: 50_000,
    label: 'Last 50,000 blocks',
    approx: '~1 year',
    estimate: '~5–6 minutes',
    warn: true,
  },
  {
    blocks: 105_120,
    label: 'Last 105,120 blocks',
    approx: '~2 years',
    estimate: '~10–13 minutes',
    warn: true,
  },
];

export const DEFAULT_SEARCH_REFRESH_BLOCKS = 1_000;
export const MIN_SEARCH_REFRESH_BLOCKS = 100;
export const MAX_SEARCH_REFRESH_BLOCKS = 105_120;

/** Clamp an untrusted IPC value to a safe scan depth. */
export function normalizeSearchRefreshBlocks(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SEARCH_REFRESH_BLOCKS;
  return Math.min(
    MAX_SEARCH_REFRESH_BLOCKS,
    Math.max(MIN_SEARCH_REFRESH_BLOCKS, Math.floor(parsed)),
  );
}

/** True when the value matches one of the UI presets. */
export function isSearchRefreshBlocks(value: number): boolean {
  return SEARCH_REFRESH_OPTIONS.some((option) => option.blocks === value);
}

export function getSearchRefreshOption(blocks: number): SearchRefreshOption {
  return SEARCH_REFRESH_OPTIONS.find((option) => option.blocks === blocks)
    ?? SEARCH_REFRESH_OPTIONS[0];
}
