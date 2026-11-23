/**
 * Handshake auction timing.
 *
 * hsd's NameState.height is the block where the OPEN transaction was mined.
 * Every phase boundary is derived from that height and the network constants:
 *
 *   OPENING: openHeight .. openHeight + openPeriod
 *   BIDDING: biddingStart .. biddingStart + biddingPeriod
 *   REVEAL:  revealStart .. revealStart + revealPeriod
 *
 * Keep this as the single source of truth. The old UI used 720/288/1440 for
 * every network, which made countdowns and tab bucketing wrong.
 */

import { NETWORKS } from './constants';
import type { NetworkName } from './constants';
import type { AuctionPhase } from '../types/auction';

export interface AuctionSchedule {
  openHeight: number;
  /** First block of the BIDDING phase. */
  biddingStart: number;
  /** First block after BIDDING / first block of REVEAL. */
  biddingEnd: number;
  /** Alias for biddingEnd, named for readability in the UI. */
  revealStart: number;
  /** First block after REVEAL / auction is closed. */
  revealEnd: number;
  /** Alias for revealEnd. */
  auctionClose: number;
}

export function getAuctionSchedule(
  openHeight: number,
  network: NetworkName = 'main',
): AuctionSchedule {
  const net = NETWORKS[network];
  const biddingStart = openHeight + net.openPeriod;
  const biddingEnd = biddingStart + net.biddingPeriod;
  const revealEnd = biddingEnd + net.revealPeriod;

  return {
    openHeight,
    biddingStart,
    biddingEnd,
    revealStart: biddingEnd,
    revealEnd,
    auctionClose: revealEnd,
  };
}

/** Block at which the current auction phase ends, or null for settled names. */
export function getNextPhaseBlock(
  phase: AuctionPhase,
  schedule: AuctionSchedule,
): number | null {
  switch (phase) {
    case 'OPENING':
      return schedule.biddingStart;
    case 'BIDDING':
      return schedule.biddingEnd;
    case 'REVEAL':
      return schedule.revealEnd;
    case 'REDEEM':
    case 'CLOSED':
      return null;
  }
}

/** Blocks until the current phase ends, clamped at zero. */
export function getBlocksUntilNextPhase(
  phase: AuctionPhase,
  schedule: AuctionSchedule,
  currentBlock: number,
): number | null {
  const next = getNextPhaseBlock(phase, schedule);
  return next === null ? null : Math.max(0, next - currentBlock);
}
