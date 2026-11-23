import { describe, it, expect } from 'vitest';
import {
  countGlobalAuctionPhases,
  getGlobalAuctionMilestone,
  queryGlobalAuctions,
  sortGlobalAuctions,
} from '../global-auctions';
import type { GlobalAuction } from '../../types/auction';

function makeAuction(overrides: Partial<GlobalAuction> = {}): GlobalAuction {
  return {
    name: 'example',
    state: 'OPENING',
    openHeight: 1000,
    biddingStart: 1037,
    revealStart: 1757,
    closeBlock: 3197,
    blocksUntilNext: 37,
    blocksUntilClose: 2197,
    bidCount: 0,
    revealCount: 0,
    highestLockup: 0,
    highestRevealedBid: 0,
    ...overrides,
  };
}

const auctions: GlobalAuction[] = [
  makeAuction({ name: 'alpha', state: 'OPENING', openHeight: 1000, blocksUntilClose: 2197 }),
  makeAuction({ name: 'beta', state: 'BIDDING', openHeight: 900, blocksUntilClose: 700, bidCount: 9, highestLockup: 500_000_000 }),
  makeAuction({ name: 'gamma', state: 'REVEAL', openHeight: 800, blocksUntilClose: 100, bidCount: 3, revealCount: 2, highestLockup: 2_000_000_000 }),
];

describe('countGlobalAuctionPhases', () => {
  it('counts phases and the closing window', () => {
    expect(countGlobalAuctionPhases(auctions, 720)).toEqual({
      all: 3,
      opening: 1,
      bidding: 1,
      reveal: 1,
      closing: 2,
    });
  });
});

describe('queryGlobalAuctions', () => {
  it('filters by phase and name', () => {
    expect(queryGlobalAuctions(auctions, { filter: 'bidding' }).map((a) => a.name)).toEqual(['beta']);
    expect(queryGlobalAuctions(auctions, { query: 'amm' }).map((a) => a.name)).toEqual(['gamma']);
  });

  it('filters to auctions closing within the window', () => {
    expect(queryGlobalAuctions(auctions, { filter: 'closing', closingWithinBlocks: 500 }).map((a) => a.name)).toEqual(['gamma']);
  });

  it('sorts by closing, open height, bids, and lockup', () => {
    expect(sortGlobalAuctions(auctions, 'closing').map((a) => a.name)).toEqual(['gamma', 'beta', 'alpha']);
    expect(sortGlobalAuctions(auctions, 'opened').map((a) => a.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortGlobalAuctions(auctions, 'bids').map((a) => a.name)).toEqual(['beta', 'gamma', 'alpha']);
    expect(sortGlobalAuctions(auctions, 'bids-asc').map((a) => a.name)).toEqual(['alpha', 'gamma', 'beta']);
    expect(sortGlobalAuctions(auctions, 'lockup').map((a) => a.name)).toEqual(['gamma', 'beta', 'alpha']);
    expect(sortGlobalAuctions(auctions, 'lockup-asc').map((a) => a.name)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('getGlobalAuctionMilestone', () => {
  it('returns the phase-appropriate milestone', () => {
    expect(getGlobalAuctionMilestone(auctions[0])).toEqual({
      label: 'Bidding starts',
      targetBlock: 1037,
      blocks: 37,
    });
    expect(getGlobalAuctionMilestone(auctions[1]).label).toBe('Reveal starts');
    expect(getGlobalAuctionMilestone(auctions[2]).label).toBe('Auction closes');
  });
});
