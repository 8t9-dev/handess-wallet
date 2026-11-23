export const NETWORKS = {
  main: {
    nodePort: 12037,
    walletPort: 12039,
    blockTimeMinutes: 10,
    /** Blocks for OPEN tx to be committed to the merkle tree */
    treeInterval: 36,
    /** OPENING phase: hsd uses treeInterval + 1 blocks */
    openPeriod: 37,
    /** BIDDING phase: 5 days at 144 blocks/day */
    biddingPeriod: 720,
    /** REVEAL phase: 10 days at 144 blocks/day */
    revealPeriod: 1_440,
    renewalWindow: 105_120,
    transferLockup: 288,
    /** Claimed-name lockup: 30 days */
    lockupPeriod: 4_320,
    coinbaseMaturity: 100,
    maxBlockRenewals: 600,
  },
  testnet: {
    nodePort: 13037,
    walletPort: 13039,
    blockTimeMinutes: 10,
    treeInterval: 36,
    openPeriod: 37,
    /** 1 day at 144 blocks/day */
    biddingPeriod: 144,
    /** 2 days at 144 blocks/day */
    revealPeriod: 288,
    renewalWindow: 4_320,
    transferLockup: 288,
    /** Claimed-name lockup: 6 hours */
    lockupPeriod: 36,
    coinbaseMaturity: 100,
    maxBlockRenewals: 600,
  },
  regtest: {
    nodePort: 14037,
    walletPort: 14039,
    blockTimeMinutes: 10,
    treeInterval: 5,
    openPeriod: 6,
    biddingPeriod: 5,
    revealPeriod: 10,
    renewalWindow: 5_000,
    transferLockup: 10,
    lockupPeriod: 2,
    coinbaseMaturity: 2,
    maxBlockRenewals: 600,
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

export const BATCH_CHUNK_SIZE = 85;

export const BULK_LOOKUP_CONCURRENCY = 10;

export const MAX_BULK_SEARCH_NAMES = 1_000;

export const DOLLARYDOOS_PER_HNS = 1_000_000;

export const AUCTION_BLIND_MULTIPLIER = 2;

export const EXPIRY_THRESHOLDS = {
  critical: 30,
  warning: 60,
  notice: 90,
} as const;

export function daysToBlocks(days: number, network: NetworkName = 'main'): number {
  const minutesPerDay = 24 * 60;
  const blocksPerDay = minutesPerDay / NETWORKS[network].blockTimeMinutes;
  return Math.floor(days * blocksPerDay);
}

export const UI_DEFAULTS = {
  pageSize: 50,
  theme: 'system' as 'light' | 'dark' | 'system',
  dateFormat: 'relative' as 'relative' | 'absolute',
  tableDensity: 'comfortable' as 'compact' | 'comfortable' | 'spacious',
} as const;

export const MAX_NAME_LENGTH = 63;

export const VALID_NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export const BOB_CONFIG_PATHS = {
  win32: '%APPDATA%\\Bob\\hsd_data',
  darwin: '~/Library/Application Support/Bob/hsd_data',
  linux: '~/.config/Bob/hsd_data',
} as const;

export const EXPLORER_URLS = {
  main: {
    tx: 'https://hnsnetwork.com/txs/',
    name: 'https://hnsnetwork.com/names/',
    block: 'https://hnsnetwork.com/blocks/',
    address: 'https://hnsnetwork.com/address/',
  },
  testnet: {
    tx: 'https://hnsnetwork.com/txs/',
    name: 'https://hnsnetwork.com/names/',
    block: 'https://hnsnetwork.com/blocks/',
    address: 'https://hnsnetwork.com/address/',
  },
  regtest: {
    tx: '#',
    name: '#',
    block: '#',
    address: '#',
  },
} as const;
