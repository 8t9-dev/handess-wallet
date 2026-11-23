import punycode from 'punycode';

import {
  NETWORKS,
  DOLLARYDOOS_PER_HNS,
  VALID_NAME_REGEX,
  MAX_NAME_LENGTH,
  EXPIRY_THRESHOLDS,
  daysToBlocks,
} from './constants';
import type { NetworkName } from './constants';
import type { NameState, AvailabilityStatus } from '../types/domain';
import type { AuctionPhase, UserBidData } from '../types/auction';
import { getAuctionSchedule, getBlocksUntilNextPhase } from './auction-timing';

// ============================================================
// Value Conversion
// ============================================================

export function dollaryDoosToHNS(dollarydoos: number): number {
  return dollarydoos / DOLLARYDOOS_PER_HNS;
}

export function hnsToDollaryDoos(hns: number): number {
  return Math.round(hns * DOLLARYDOOS_PER_HNS);
}

export function formatHNS(dollarydoos: number, decimals: number = 6): string {
  const hns = dollaryDoosToHNS(dollarydoos);
  return `${hns.toFixed(decimals)} HNS`;
}

// ============================================================
// Name Validation
// ============================================================

export function validateName(name: string): { valid: boolean; error: string | null } {
  if (!name || name.length === 0) {
    return { valid: false, error: 'Name cannot be empty' };
  }

  if (name.length > MAX_NAME_LENGTH) {
    return { valid: false, error: `Name exceeds ${MAX_NAME_LENGTH} character limit (${name.length})` };
  }

  if (name !== name.toLowerCase()) {
    return { valid: false, error: 'Name must be lowercase' };
  }

  if (!VALID_NAME_REGEX.test(name)) {
    return { valid: false, error: 'Name must be alphanumeric with hyphens (no leading/trailing hyphens)' };
  }

  return { valid: true, error: null };
}

export function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, '');
}

export function toPunycode(input: string): string {
  try {
    return punycode.toASCII(input);
  } catch {
    return input;
  }
}

export function toUnicode(input: string): string {
  try {
    return punycode.toUnicode(input);
  } catch {
    return input;
  }
}

/**
 * Return the decoded Unicode form of a name, or null when there is nothing
 * to decode.
 *
 * Handshake stores names as punycode ASCII. Names that are already Unicode,
 * plain ASCII, or invalid punycode (e.g. `xn--1091`, which throws inside
 * punycode) return null.
 */
export function getUnicodeName(name: string): string | null {
  if (Array.from(name).some((ch) => (ch.codePointAt(0) ?? 0) > 0x7F)) {
    return null;
  }

  const unicode = toUnicode(name);
  return unicode !== name ? unicode : null;
}

/**
 * Format a name for display, appending its decoded IDNA/emoji form.
 *
 * `xn--armstrong-3d95h` → `xn--armstrong-3d95h [ armstrong💙 ]`
 * ASCII and undecodable names are returned unchanged.
 */
export function formatNameWithUnicode(name: string): string {
  const unicode = getUnicodeName(name);
  return unicode ? `${name} [ ${unicode} ]` : name;
}

/**
 * Sort key for name lists: the decoded Unicode form when available, so
 * `xn--armstrong-3d95h` sorts as `armstrong💙` alongside other names.
 */
export function getNameSortKey(name: string): string {
  return getUnicodeName(name) ?? name;
}

// ============================================================
// Expiry Calculation
// ============================================================

export function getExpiryBlock(renewalBlock: number, network: NetworkName = 'main'): number {
  return renewalBlock + NETWORKS[network].renewalWindow;
}

export function getExpiryDate(
  expiryBlock: number,
  currentBlock: number,
  network: NetworkName = 'main',
): Date | null {
  const blocksRemaining = expiryBlock - currentBlock;
  if (blocksRemaining <= 0) return null;

  const minutesRemaining = blocksRemaining * NETWORKS[network].blockTimeMinutes;
  return new Date(Date.now() + minutesRemaining * 60_000);
}

export function getExpiryUrgency(
  expiryBlock: number,
  currentBlock: number,
  network: NetworkName = 'main',
): 'critical' | 'warning' | 'notice' | 'safe' {
  const blocksRemaining = expiryBlock - currentBlock;

  if (blocksRemaining <= daysToBlocks(EXPIRY_THRESHOLDS.critical, network)) {
    return 'critical';
  }
  if (blocksRemaining <= daysToBlocks(EXPIRY_THRESHOLDS.warning, network)) {
    return 'warning';
  }
  if (blocksRemaining <= daysToBlocks(EXPIRY_THRESHOLDS.notice, network)) {
    return 'notice';
  }
  return 'safe';
}

export function blocksUntilExpiry(expiryBlock: number, currentBlock: number): number {
  return expiryBlock - currentBlock;
}

// ============================================================
// Auction Lifecycle State Machine
// ============================================================
//
// hsd's NameState.height is the block where the OPEN transaction was mined,
// so phase boundaries are:
//   startHeight + 0                    → OPENING begins
//   startHeight + openPeriod           → BIDDING begins
//   startHeight + openPeriod + bidding → REVEAL begins
//   startHeight + openPeriod + bidding + reveal → auction CLOSED
//
// openPeriod is treeInterval + 1 (37 blocks on mainnet/testnet, 6 on regtest).
// BIDDING is 720 blocks on mainnet and REVEAL is 1440; testnet/regtest differ.
// See src/lib/auction-timing.ts for the single source of truth.
//
// ============================================================

/** Phase transition blocks computed from startHeight */
export interface AuctionTimeline {
  biddingStart: number;
  biddingEnd: number;
  revealEnd: number;
}

/** Ordered phases for UI progression display */
export const AUCTION_PHASES: readonly AuctionPhase[] = [
  'OPENING',
  'BIDDING',
  'REVEAL',
  'REDEEM',
  'CLOSED',
] as const;

/**
 * Compute the on-chain auction phase using the block-height state machine.
 *
 * This mirrors hsd's NameState.state() exactly: a phase changes on the block
 * at its boundary, not one block early. The UI must not enable REVEAL actions
 * while hsd still reports BIDDING.
 *
 * @param startHeight - Block where OPEN tx was mined
 * @param currentBlock - Current chain height
 * @param userBidData - Optional user bid data (determines REDEEM vs CLOSED)
 * @param network - Network name
 * @returns The computed AuctionPhase
 */
export function computeAuctionPhase(
  startHeight: number,
  currentBlock: number,
  userBidData?: UserBidData | null,
  network: NetworkName = 'main',
): AuctionPhase {
  const { biddingStart, biddingEnd, revealEnd } = getAuctionSchedule(startHeight, network);

  if (currentBlock < biddingStart) {
    return 'OPENING';
  }

  if (currentBlock < biddingEnd) {
    return 'BIDDING';
  }

  if (currentBlock < revealEnd) {
    return 'REVEAL';
  }

  // After reveal ends: REDEEM if user has an unredeemed losing bid, else CLOSED
  if (userBidData && !userBidData.redeemed && userBidData.isWinner === false) {
    return 'REDEEM';
  }

  return 'CLOSED';
}

/**
 * Compute blocks until the next phase transition.
 *
 * Returns null for terminal phases (REDEEM/CLOSED) or when
 * the calculation isn't applicable.
 */
export function blocksUntilNextPhase(
  phase: AuctionPhase,
  startHeight: number,
  currentBlock: number,
  network: NetworkName = 'main',
): number | null {
  return getBlocksUntilNextPhase(
    phase,
    getAuctionSchedule(startHeight, network),
    currentBlock,
  );
}

/** Human-readable label for each phase */
export function getPhaseLabel(phase: AuctionPhase): string {
  const labels: Record<AuctionPhase, string> = {
    OPENING: 'Opening',
    BIDDING: 'Bidding',
    REVEAL: 'Reveal',
    REDEEM: 'Redeem',
    CLOSED: 'Closed',
  };
  return labels[phase];
}

/** Tailwind color classes for each phase badge */
export function getPhaseBadgeClasses(phase: AuctionPhase): string {
  const classes: Record<AuctionPhase, string> = {
    OPENING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    BIDDING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    REVEAL: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    REDEEM: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    CLOSED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };
  return classes[phase];
}

/**
 * Determine the urgent action a user should take for this auction.
 *
 * Bob Wallet alignment: app/pages/Auction/BidActionPanel/index.js
 *   - BIDDING with wallet bid → "Place Bid" (additional bid) or wait
 *   - REVEAL with unrevealed bid → "Reveal Your Bids" (URGENT)
 *   - REDEEM with unredeemed bid → "Redeem My Bid" (URGENT)
 *   - CLOSED + isWinner + !registered → "Register" (URGENT)
 */
export interface UrgentAction {
  type: 'bid' | 'reveal' | 'redeem' | 'register' | 'none';
  label: string;
  urgency: 'high' | 'medium' | 'low';
}

export function getUrgentAction(phase: AuctionPhase, userBidData?: UserBidData | null): UrgentAction {
  if (phase === 'REVEAL' && userBidData && !userBidData.revealed) {
    return { type: 'reveal', label: 'Reveal Bid', urgency: 'high' };
  }

  if (phase === 'REVEAL' && userBidData && userBidData.revealed) {
    return { type: 'none', label: 'Revealed', urgency: 'low' };
  }

  if (phase === 'REDEEM') {
    return { type: 'redeem', label: 'Redeem Funds', urgency: 'high' };
  }

  if (phase === 'BIDDING') {
    return { type: 'bid', label: 'Place Bid', urgency: 'medium' };
  }

  if (phase === 'OPENING') {
    return { type: 'bid', label: 'Place Bid', urgency: 'medium' };
  }

  return { type: 'none', label: '', urgency: 'low' };
}

/**
 * Check if a phase transition is 3 blocks or less away.
 * Used to flag items that need urgent attention.
 */
export function isNearPhaseTransition(
  phase: AuctionPhase,
  startHeight: number,
  currentBlock: number,
  network: NetworkName = 'main',
): boolean {
  const remaining = blocksUntilNextPhase(phase, startHeight, currentBlock, network);
  return remaining !== null && remaining <= 3;
}

// ============================================================
// Auction Timeline (deprecated — kept for backward compat)
// ============================================================

/**
 * Calculate auction phase end blocks given the OPEN block height.
 * Uses corrected HSD protocol constants.
 *
 * @deprecated Use getPhaseBoundaries() or computeAuctionPhase() instead.
 */
export function getAuctionTimeline(
  openHeight: number,
  network: NetworkName = 'main',
): AuctionTimeline {
  const { biddingStart, biddingEnd, revealEnd } = getAuctionSchedule(openHeight, network);
  return { biddingStart, biddingEnd, revealEnd };
}

/**
 * Auction lifecycle phases for the Auctions dashboard.
 * @deprecated Use AuctionPhase instead.
 */
export type AuctionCardPhase = 'BIDDING' | 'REVEAL' | 'CLOSED_WON' | 'CLOSED_LOST';

/**
 * Compute the lifecycle phase for an auction card based on block heights.
 * Uses corrected HSD protocol constants.
 *
 * @deprecated Use computeAuctionPhase() instead.
 */
export function computePhase(
  openHeight: number,
  currentHeight: number,
  isRevealed: boolean,
  isWinner: boolean | null,
  network: NetworkName = 'main',
): AuctionCardPhase {
  const { biddingStart, biddingEnd, revealEnd } = getAuctionSchedule(openHeight, network);

  if (currentHeight < biddingStart) {
    return 'BIDDING';
  }

  if (currentHeight < biddingEnd) {
    return 'BIDDING';
  }
  if (currentHeight < revealEnd) {
    return 'REVEAL';
  }
  // CLOSED
  if (isWinner === true) {
    return 'CLOSED_WON';
  }
  return 'CLOSED_LOST';
}

/**
 * Convert a number of blocks to a human-readable time-left string.
 */
export function blocksToTimeLeft(blocks: number, network: NetworkName = 'main'): string {
  if (blocks <= 0) return 'Expired';
  const blockTimeMinutes = NETWORKS[network].blockTimeMinutes;
  const mins = blocks * blockTimeMinutes;
  // 1 month ≈ 30 days
  const monthMins = 30 * 24 * 60;
  if (mins >= monthMins) {
    const months = Math.floor(mins / monthMins);
    return `~${months} month${months !== 1 ? 's' : ''}`;
  }
  const weekMins = 7 * 24 * 60;
  if (mins >= weekMins) {
    const weeks = Math.floor(mins / weekMins);
    return `~${weeks} week${weeks !== 1 ? 's' : ''}`;
  }
  if (mins >= 1440) return `~${Math.floor(mins / 1440)} days`;
  if (mins >= 60) return `~${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
  return `~${Math.floor(mins)}m`;
}

export function estimateBlockDate(
  targetBlock: number,
  currentBlock: number,
  network: NetworkName = 'main',
): Date | null {
  const blocksRemaining = targetBlock - currentBlock;
  if (blocksRemaining <= 0) return null;

  const minutesRemaining = blocksRemaining * NETWORKS[network].blockTimeMinutes;
  return new Date(Date.now() + minutesRemaining * 60_000);
}

// ============================================================
// Name Metadata
// ============================================================
//
// Used by the Explorer NameDetail page to render identity info
// (Type, Length, Script, Composition, IDNA2008, etc.) the way
// explorers like shakeshift.com do.

export interface NameMetadata {
  /** ASCII or Unicode */
  type: 'ASCII' | 'Unicode';
  /** Number of UTF-8 code points */
  length: number;
  /** Same as length for most names; differs for emoji/surrogate pairs */
  codePoints: number;
  /** Number of grapheme clusters (visual characters) */
  graphemes: number;
  /** Detected script (Latin, Cyrillic, Greek, CJK, etc.) */
  script: string;
  /** Composition (Lowercase, Uppercase, Digits, Mixed) */
  composition: string;
  /** True if name contains non-ASCII characters (requires Unicode normalization) */
  requiresUnicode: boolean;
  /** IDNA2008 compliance — best-effort heuristic */
  idna2008Compliant: boolean;
}

function detectScript(name: string): string {
  // Per Unicode Technical Standard #24, basic script detection
  // covers the most common Top-Level-Domain scripts on Handshake.
  if (/^[a-z0-9-]+$/.test(name)) return 'Latin';
  if (/^[A-Za-z0-9-]+$/.test(name)) return 'Latin';
  // Cyrillic: U+0400–U+04FF
  if (/^[\u0400-\u04FF0-9-]+$/.test(name)) return 'Cyrillic';
  // Greek: U+0370–U+03FF
  if (/^[\u0370-\u03FF0-9-]+$/.test(name)) return 'Greek';
  // Hebrew: U+0590–U+05FF
  if (/^[\u0590-\u05FF0-9-]+$/.test(name)) return 'Hebrew';
  // Arabic: U+0600–U+06FF
  if (/^[\u0600-\u06FF0-9-]+$/.test(name)) return 'Arabic';
  // Devanagari: U+0900–U+097F
  if (/^[\u0900-\u097F0-9-]+$/.test(name)) return 'Devanagari';
  // Han (CJK): U+4E00–U+9FFF
  if (/^[\u4E00-\u9FFF0-9-]+$/.test(name)) return 'Han';
  // Hiragana: U+3040–U+309F, Katakana: U+30A0–U+30FF
  if (/^[\u3040-\u30FF0-9-]+$/.test(name)) return 'Japanese';
  // Hangul: U+AC00–U+D7AF, U+1100–U+11FF
  if (/^[\uAC00-\uD7AF\u1100-\u11FF0-9-]+$/.test(name)) return 'Hangul';
  return 'Mixed/Other';
}

function detectComposition(name: string): string {
  const hasLower = /[a-z]/.test(name);
  const hasUpper = /[A-Z]/.test(name);
  const hasDigit = /[0-9]/.test(name);
  const hasHyphen = /-/.test(name);
  const parts: string[] = [];
  if (hasLower) parts.push('Lowercase');
  if (hasUpper) parts.push('Uppercase');
  if (hasDigit) parts.push('Digits');
  if (hasHyphen) parts.push('Hyphens');
  if (parts.length === 0) return 'Symbols/Other';
  if (parts.length === 1) return `${parts[0]} Letters`;
  return parts.join(' + ');
}

export function getNameMetadata(name: string): NameMetadata {
  // code points (each emoji or surrogate pair counts as 1)
  const codePoints = Array.from(name).length;
  // graphemes: prefer Intl.Segmenter when available, fall back to code points
  let graphemes = codePoints;
  if (typeof Intl !== 'undefined' && (Intl as unknown as { Segmenter?: unknown }).Segmenter) {
    try {
      const seg = new (Intl as unknown as { Segmenter: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter('en', { granularity: 'grapheme' });
      let count = 0;
      for (const segment of seg.segment(name)) {
        if (segment.segment) count++;
      }
      graphemes = count;
    } catch { /* fallback already set */ }
  }
  // ASCII detection via code-point comparison (avoids no-control-regex lint).
  const requiresUnicode = Array.from(name).some(ch => (ch.codePointAt(0) ?? 0) > 0x7F);
  const idna2008Compliant = /^[a-z0-9-]+$/.test(name); // ASCII LDH = IDNA2008 OK
  return {
    type: requiresUnicode ? 'Unicode' : 'ASCII',
    length: name.length,
    codePoints,
    graphemes,
    script: detectScript(name),
    composition: detectComposition(name),
    requiresUnicode,
    idna2008Compliant,
  };
}

/**
 * Format a name hash for compact display: 8...6 (8 leading, 6 trailing chars).
 */
export function formatNameHash(hash: string, head = 8, tail = 6): string {
  if (!hash || hash.length <= head + tail) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

// ============================================================
// State Display Helpers
// ============================================================

export function getStateLabel(state: NameState | AvailabilityStatus): string {
  const labels: Record<string, string> = {
    AVAILABLE: 'Available',
    RESERVED: 'Reserved',
    OPENING: 'Opening',
    BIDDING: 'Bidding',
    REVEAL: 'Reveal',
    CLOSED: 'Registered',
    REVOKED: 'Revoked',
    TRANSFER: 'Transferring',
    EXPIRED: 'Expired',
    OWNED_BY_YOU: 'Owned by You',
  };
  return labels[state] || state;
}

export function getStateColor(state: NameState | AvailabilityStatus): string {
  const colors: Record<string, string> = {
    AVAILABLE: 'text-state-available',
    RESERVED: 'text-state-reserved',
    OPENING: 'text-state-bidding',
    BIDDING: 'text-state-bidding',
    REVEAL: 'text-state-reveal',
    CLOSED: 'text-state-closed',
    REVOKED: 'text-state-revoked',
    TRANSFER: 'text-state-transfer',
    EXPIRED: 'text-state-expiring',
    OWNED_BY_YOU: 'text-state-transfer',
  };
  return colors[state] || 'text-gray-500';
}

export function getStateBgColor(state: NameState | AvailabilityStatus): string {
  const colors: Record<string, string> = {
    AVAILABLE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    RESERVED: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    OPENING: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    BIDDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    REVEAL: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    CLOSED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    REVOKED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    TRANSFER: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    EXPIRED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    OWNED_BY_YOU: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  };
  return colors[state] || 'bg-gray-100 text-gray-800';
}
