import type { DNSRecord } from './domain';

export interface BlockSummary {
  height: number;
  hash: string;
  time: number;
  transactions: number;
  size: number;
  totalFee: number;
}

export interface TXOutput {
  value: number;
  address: string;
}

export interface TXInput {
  coinbase?: string;
  prevout?: { hash: string; index: number };
  address?: string | null;
  sequence: number;
  covenant?: { action: string };
}

export interface BlockDetail {
  hash: string;
  height: number;
  version: number;
  time: number;
  size: number;
  weight: number;
  merkleRoot: string;
  previousBlockHash: string;
  nextBlockHash: string | null;
  bits: number;
  difficulty: number;
  totalFee: number;
  txs: BlockTransaction[];
}

export interface BlockTransaction {
  hash: string;
  version: number;
  size: number;
  fee: number;
  inputs: TXInput[];
  outputs: TXOutput[];
  locktime: number;
}

export interface ChainStats {
  blocks: number;
  transactions: number;
  txouts: number;
  totalSupply: number;
  mempoolTxCount: number;
}

export interface AuctionSummary {
  name: string;
  bids: number;
  highestLockup: number;
  timeLeft: string;
  blocksUntil: number | null;
  lockupValue: number;
}

export interface TreeUpdateInfo {
  nextBlock: number;
  blocksAway: number;
  estimatedMinutes: number;
}

export interface AddressInfo {
  address: string;
  balance: number;
  unconfirmed: number;
  txCount: number;
  names: string[];
}

export type SearchResult =
  | { type: 'block'; height: number; hash: string; error?: never }
  | { type: 'block'; height: number; hash: null; error: string }
  | { type: 'tx'; tx: unknown; error?: never }
  | { type: 'tx'; tx: null; error: string }
  | { type: 'address'; info: AddressInfo; error?: never }
  | { type: 'address'; info: null; error: string }
  | { type: 'name'; info: unknown; resource: unknown; error?: never }
  | { type: 'name'; info: null; error: string }
  | { type: 'unknown'; query: string };

export interface NameDetail {
  name: string;
  unicodeName: string;
  /** 64-char hex hash of the name (SHA3 of DNS-encoded name) */
  nameHash: string;
  state: string;
  owner: string | null;
  value: number;
  highest: number;
  openHeight: number;
  /** Block when BIDDING phase begins */
  biddingStart: number;
  /** Block when REVEAL phase begins */
  revealStart: number;
  /** Block when auction fully closes */
  auctionClose: number;
  /** Next phase boundary (bidding start, reveal start, or auction close). */
  nextPhaseBlock: number;
  /** Blocks until nextPhaseBlock; null when the auction is settled. */
  blocksUntilNext: number | null;
  /** Backward-compatible alias for nextPhaseBlock. */
  closeBlock: number;
  /** Backward-compatible alias for blocksUntilNext (0 when settled). */
  blocksUntil: number;
  renewal: number | null;
  expiryBlock: number | null;
  /** Block where name was claimed (ICANN) */
  claim: number | null;
  /** End of the post-claim lockup. */
  lockupEnd: number | null;
  /** Block where name was revoked */
  revoked: number | null;
  /** Block where the current transfer started */
  transfer: number | null;
  /** How many times the name has been renewed */
  renewals: number;
  /** Whether the name is ICANN-reserved */
  reserved: boolean;
  /** Raw hsd phase stats (blocksUntilBidding, blocksUntilReveal, etc.). */
  stats?: Record<string, number> | null;
  records: DNSRecord[];
}
