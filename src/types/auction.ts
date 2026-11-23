import type { NameState } from './domain';

// ============================================================
// Unified Auction Phase (5-state lifecycle machine)
// ============================================================
// Maps to the On-Chain State Machine described in HSD protocol:
//   startHeight -> OPENING (720 blocks) -> BIDDING (288 blocks)
//   -> REVEAL (1440 blocks) -> REDEEM | CLOSED
//
// Bob Wallet Reference: app/utils/nameHelpers.js checkState()
// - OPENING/CLOSED map 1:1 with NameState
// - REDEEM is a UI sub-phase of CLOSED: user has unclaimed losing bids
// - REVOKED/TRANSFER bubble up from NameState when applicable

export type AuctionPhase =
  | 'OPENING'
  | 'BIDDING'
  | 'REVEAL'
  | 'REDEEM'
  | 'CLOSED';

// ============================================================
// Unified Handshake Auction
// ============================================================
// Merges data from TWO distinct API sources:
//   1. Node Client: GET /name/:name → blockchain-wide auction state
//   2. Wallet Client: GET /wallet/:id/bid/:name → user's bid state

export interface UnifiedHnsAuction {
  /** The TLD name */
  name: string;

  /** Current chain height at time of fetch */
  currentBlock: number;

  /** Block height when the OPEN transaction was mined */
  startHeight: number;

  // -------------------------------------------------------
  // FROM: hsd Node API (/name/:name → getNameInfo)
  // -------------------------------------------------------
  /** On-chain auction phase computed via block-height state machine */
  blockchainState: AuctionPhase;

  /** Highest bid value seen on-chain (in dollarydoos) */
  highestBid: number;

  /** Second-highest bid value (in dollarydoos) — the amount the winner actually pays in a Vickrey auction */
  secondHighestBid?: number;

  /** Total number of bids in this auction */
  totalBids: number;

  /**
   * Blocks until the next phase transition.
   * - OPENING: blocks until BIDDING starts (startHeight + 720 - currentBlock)
   * - BIDDING: blocks until REVEAL starts (startHeight + 1008 - currentBlock)
   * - REVEAL:  blocks until auction CLOSES (startHeight + 2448 - currentBlock)
   * - REDEEM/CLOSED: null
   */
  blocksUntilNext: number | null;

  /** Whether the reveal period has ended per block-height math (may differ from rawState while hsd catches up) */
  revealPeriodEnded?: boolean;

  /** On-chain name state from hsd (can include REVOKED, TRANSFER) */
  rawState?: NameState;

  /** Stats from hsd node API when available (pre-computed phase boundaries) */
  stats?: {
    openPeriodEnd: number;
    bidPeriodStart: number;
    bidPeriodEnd: number;
    revealPeriodStart: number;
    revealPeriodEnd: number;
  };

  // -------------------------------------------------------
  // FROM: hsd Wallet API (/wallet/:id/bid/:name → getAuctionInfo)
  // -------------------------------------------------------
  /** User's bid data for this auction (null if wallet has no bid) */
  userBidData?: UserBidData;
}

export interface UserBidData {
  /** Transaction ID of the user's BID covenant */
  txid: string;

  /**
   * The TRUE bid amount in dollarydoos.
   * This is the actual intended bid (hidden on-chain during BIDDING).
   * Distinguish from `lockup` which is the visible on-chain amount.
   */
  value: number;

  /**
   * The LOCKUP amount in dollarydoos.
   * This is the TOTAL on-chain output (value + blinding disguise).
   * lockup >= value always. The difference (lockup - value) is the
   * blinding/disguise amount that hides the true bid.
   *
   * CRITICAL UX: Always display Lockup separately from Value so users
   * understand the Vickrey auction mechanics.
   */
  lockup: number;

  /** Whether the user has revealed this bid */
  revealed: boolean;

  /** Whether the user's revealed bid won the auction (null = not yet known) */
  isWinner: boolean | null;

  /** Whether the user has redeemed their losing bid funds */
  redeemed: boolean;

  /** Blinding nonce hex (critical for reveal — stored in wallet DB) */
  blind?: string;

  /** Block height of the user's bid transaction. 0 or -1 = unconfirmed (mempool) */
  bidHeight?: number;
}

/**
 * A name the wallet opened for auction.
 *
 * Derived from the wallet's transaction history (OPEN covenants) rather than
 * hsd's `getauctions`, which is aliased to `getnames` and returns every name
 * the wallet tracks.
 */
export interface OpenedName {
  /** Punycode name exactly as stored on-chain */
  name: string;

  /** Transaction ID of the OPEN covenant (empty for a locally-pending open) */
  txid: string;

  /** Block height of the OPEN transaction (null while unconfirmed) */
  height: number | null;

  /** Transaction timestamp (seconds since epoch) */
  time: number;

  /**
   * True when the name was just opened locally but has not appeared in
   * wallet history yet. Replaced by the real history entry once indexed.
   */
  pending?: boolean;
}

// ============================================================
// Existing Types (kept for backward compatibility)
// ============================================================

export interface Auction {
  name: string;
  nameHash: string;
  state: NameState;
  openHeight: number;
  biddingStartBlock: number;
  revealStartBlock: number;
  closeBlock: number;
  biddingEndDate: Date | null;
  revealEndDate: Date | null;
  bids: Bid[];
  reveals: Reveal[];
  hasUnrevealedBids: boolean;
  hasUnredeemedBids: boolean;
  isWinner: boolean | null;
  highest?: number;
  blocksUntil?: number;
}

export interface Bid {
  name: string;
  nameHash: string;
  value: number;
  lockup: number;
  blind: string;
  revealed: boolean;
  redeemed: boolean;
  txHash: string;
  outIndex: number;
  height: number;
  own: boolean;
}

export interface Reveal {
  name: string;
  value: number;
  height: number;
  txHash: string;
  outIndex: number;
  own: boolean;
}

export interface BidReceipt {
  name: string;
  bidAmount: number;
  nonce: string;
  lockup: number;
  createdAt: string;
}

export interface BidInput {
  name: string;
  bidAmount: number;
  lockupAmount: number;
}

export interface BulkBidInput {
  bids: BidInput[];
  uniformPricing: boolean;
}

export interface AuctionSummary {
  openingCount: number;
  activeBidCount: number;
  pendingRevealCount: number;
  wonUnregisteredCount: number;
  pendingRedeemCount: number;
  totalLockedHNS: number;
}

// ============================================================
// Global Auctions Overview
// ============================================================

export type GlobalAuctionState = 'OPENING' | 'BIDDING' | 'REVEAL';

/** An active chain-wide auction discovered by scanning recent blocks. */
export interface GlobalAuction {
  name: string;
  state: GlobalAuctionState;
  /** Block where the OPEN covenant was mined. */
  openHeight: number;
  biddingStart: number;
  revealStart: number;
  /** Block where the auction fully closes. */
  closeBlock: number;
  /** Blocks until bidding/reveal/close, depending on the current phase. */
  blocksUntilNext: number;
  /** Blocks until the auction closes, regardless of phase. */
  blocksUntilClose: number;
  /** Number of BID covenants seen in the scan window. */
  bidCount: number;
  /** Number of REVEAL covenants seen in the scan window. */
  revealCount: number;
  /** Highest visible BID lockup in dollarydoos. */
  highestLockup: number;
  /** Highest revealed bid reported by hsd, in dollarydoos. */
  highestRevealedBid: number;
}

export interface GlobalAuctionsScanResult {
  /** Closest auctions to closing. */
  endingSoon: GlobalAuction[];
  /** Auctions with bids, sorted by bid count descending. */
  mostBids: GlobalAuction[];
  /** Auctions with bids, sorted by bid count ascending. */
  fewestBids: GlobalAuction[];
  /** Auctions with bids, sorted by visible lockup descending. */
  highestBids: GlobalAuction[];
  /** Auctions with bids, sorted by visible lockup ascending. */
  lowestBids: GlobalAuction[];
  totalActive: number;
  totalWithBids: number;
  currentHeight: number;
  scannedFrom: number;
  scannedTo: number;
  generatedAt: string;
}
