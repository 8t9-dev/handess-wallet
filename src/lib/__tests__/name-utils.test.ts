import { describe, it, expect } from 'vitest';
import {
  computePhase,
  computeAuctionPhase,
  dollaryDoosToHNS,
  hnsToDollaryDoos,
  formatHNS,
  getAuctionTimeline,
  blocksToTimeLeft,
  blocksUntilNextPhase,
  getUrgentAction,
  isNearPhaseTransition,
  getUnicodeName,
  formatNameWithUnicode,
  getNameSortKey,
} from '../name-utils';
import type { UserBidData } from '../../types/auction';
import { daysToBlocks, NETWORKS } from '../constants';

// ================================================================
// computeAuctionPhase (NEW — 5-state lifecycle machine)
// ================================================================
describe('computeAuctionPhase', () => {
  const main = NETWORKS.main;
  // main: openPeriod=37, biddingPeriod=720, revealPeriod=1440
  const startHeight = 100_000;
  const biddingStart = startHeight + main.openPeriod;           // 100037
  const biddingEnd = biddingStart + main.biddingPeriod;         // 100757
  const revealEnd = biddingEnd + main.revealPeriod;             // 102197

  // --- OPENING ---
  it('returns OPENING when currentBlock < biddingStart', () => {
    expect(computeAuctionPhase(startHeight, startHeight)).toBe('OPENING');
  });

  it('returns OPENING at biddingStart - 1', () => {
    expect(computeAuctionPhase(startHeight, biddingStart - 1)).toBe('OPENING');
  });

  it('returns OPENING regardless of userBidData', () => {
    const userBid: UserBidData = { txid: '0x', value: 500, lockup: 1000, revealed: false, isWinner: null, redeemed: false };
    expect(computeAuctionPhase(startHeight, startHeight, userBid)).toBe('OPENING');
  });

  // --- BIDDING ---
  it('returns BIDDING at biddingStart', () => {
    expect(computeAuctionPhase(startHeight, biddingStart)).toBe('BIDDING');
  });

  it('returns BIDDING at biddingEnd - 2', () => {
    expect(computeAuctionPhase(startHeight, biddingEnd - 2)).toBe('BIDDING');
  });

  it('stays BIDDING at biddingEnd - 1 (hsd boundary)', () => {
    expect(computeAuctionPhase(startHeight, biddingEnd - 1)).toBe('BIDDING');
  });

  // --- REVEAL ---
  it('returns REVEAL at biddingEnd', () => {
    expect(computeAuctionPhase(startHeight, biddingEnd)).toBe('REVEAL');
  });

  it('returns REVEAL at revealEnd - 1', () => {
    expect(computeAuctionPhase(startHeight, revealEnd - 1)).toBe('REVEAL');
  });

  it('returns REVEAL even when user already revealed', () => {
    const userBid: UserBidData = { txid: '0x', value: 500, lockup: 1000, revealed: true, isWinner: null, redeemed: false };
    expect(computeAuctionPhase(startHeight, biddingEnd, userBid)).toBe('REVEAL');
  });

  // --- REDEEM ---
  it('returns REDEEM when past revealEnd, user lost, not redeemed', () => {
    const userBid: UserBidData = { txid: '0x', value: 500, lockup: 1000, revealed: true, isWinner: false, redeemed: false };
    expect(computeAuctionPhase(startHeight, revealEnd, userBid)).toBe('REDEEM');
  });

  it('returns REDEEM well past revealEnd if unredeemed', () => {
    const userBid: UserBidData = { txid: '0x', value: 500, lockup: 1000, revealed: true, isWinner: false, redeemed: false };
    expect(computeAuctionPhase(startHeight, 999_999, userBid)).toBe('REDEEM');
  });

  // --- CLOSED ---
  it('returns CLOSED when past revealEnd, no user bid', () => {
    expect(computeAuctionPhase(startHeight, revealEnd)).toBe('CLOSED');
  });

  it('returns CLOSED when past revealEnd, user won', () => {
    const userBid: UserBidData = { txid: '0x', value: 500, lockup: 1000, revealed: true, isWinner: true, redeemed: false };
    expect(computeAuctionPhase(startHeight, revealEnd, userBid)).toBe('CLOSED');
  });

  it('returns CLOSED when past revealEnd, redeemed losing bid', () => {
    const userBid: UserBidData = { txid: '0x', value: 500, lockup: 1000, revealed: true, isWinner: false, redeemed: true };
    expect(computeAuctionPhase(startHeight, revealEnd, userBid)).toBe('CLOSED');
  });

  it('returns CLOSED when startHeight=0 (unknown)', () => {
    expect(computeAuctionPhase(0, 999_999)).toBe('CLOSED');
  });

  // --- Regtest ---
  it('uses regtest block periods correctly', () => {
    const reg = NETWORKS.regtest;
    // regtest: openPeriod=5, biddingPeriod=2, revealPeriod=10
    const oh = 100;
    const bs = oh + reg.openPeriod;       // 105
    const be = bs + reg.biddingPeriod;    // 107
    const re = be + reg.revealPeriod;     // 117

    expect(computeAuctionPhase(oh, 100, null, 'regtest')).toBe('OPENING');
    expect(computeAuctionPhase(oh, bs - 1, null, 'regtest')).toBe('OPENING');
    expect(computeAuctionPhase(oh, bs, null, 'regtest')).toBe('BIDDING');
    expect(computeAuctionPhase(oh, be - 2, null, 'regtest')).toBe('BIDDING');
    // hsd keeps BIDDING until the reveal boundary block.
    expect(computeAuctionPhase(oh, be - 1, null, 'regtest')).toBe('BIDDING');
    expect(computeAuctionPhase(oh, be, null, 'regtest')).toBe('REVEAL');
    expect(computeAuctionPhase(oh, re - 1, null, 'regtest')).toBe('REVEAL');
    expect(computeAuctionPhase(oh, re, null, 'regtest')).toBe('CLOSED');

    const lostBid: UserBidData = { txid: '0x', value: 100, lockup: 200, revealed: true, isWinner: false, redeemed: false };
    expect(computeAuctionPhase(oh, re, lostBid, 'regtest')).toBe('REDEEM');
  });
});

// ================================================================
// computePhase (deprecated — kept for backward compat)
// ================================================================
describe('computePhase', () => {
  const main = NETWORKS.main;
  // main: openPeriod=37, biddingPeriod=720, revealPeriod=1440
  const openHeight = 100_000;
  const biddingStart = openHeight + main.openPeriod;           // 100037
  const biddingEnd = biddingStart + main.biddingPeriod;         // 100757
  const revealEnd = biddingEnd + main.revealPeriod;             // 102197

  // --- BIDDING ---
  it('returns BIDDING when currentHeight < biddingEnd', () => {
    expect(computePhase(openHeight, openHeight, false, null, 'main')).toBe('BIDDING');
  });

  it('returns BIDDING at the exact biddingStart block', () => {
    expect(computePhase(openHeight, biddingStart, false, null, 'main')).toBe('BIDDING');
  });

  it('returns BIDDING at the last block before biddingEnd (anticipating edge case)', () => {
    expect(computePhase(openHeight, biddingEnd - 2, false, null, 'main')).toBe('BIDDING');
  });

  it('returns BIDDING regardless of revealed/winner before biddingEnd', () => {
    expect(computePhase(openHeight, biddingEnd - 2, true, true, 'main')).toBe('BIDDING');
    expect(computePhase(openHeight, biddingEnd - 2, false, false, 'main')).toBe('BIDDING');
  });

  // --- REVEAL ---
  it('stays BIDDING at biddingEnd - 1 (hsd boundary)', () => {
    expect(computePhase(openHeight, biddingEnd - 1, false, null, 'main')).toBe('BIDDING');
  });

  it('returns REVEAL at biddingEnd', () => {
    expect(computePhase(openHeight, biddingEnd, false, null, 'main')).toBe('REVEAL');
  });

  it('returns REVEAL at the last block before revealEnd', () => {
    expect(computePhase(openHeight, revealEnd - 1, false, null, 'main')).toBe('REVEAL');
  });

  it('returns REVEAL even when user already revealed', () => {
    expect(computePhase(openHeight, biddingEnd, true, null, 'main')).toBe('REVEAL');
  });

  // --- CLOSED_WON ---
  it('returns CLOSED_WON when currentHeight >= revealEnd and isWinner=true', () => {
    expect(computePhase(openHeight, revealEnd, false, true, 'main')).toBe('CLOSED_WON');
  });

  it('returns CLOSED_WON well past revealEnd when isWinner=true', () => {
    expect(computePhase(openHeight, 999_999, false, true, 'main')).toBe('CLOSED_WON');
  });

  // --- CLOSED_LOST ---
  it('returns CLOSED_LOST when currentHeight >= revealEnd and isWinner=false', () => {
    expect(computePhase(openHeight, revealEnd, false, false, 'main')).toBe('CLOSED_LOST');
  });

  it('returns CLOSED_LOST when currentHeight >= revealEnd and isWinner=null', () => {
    expect(computePhase(openHeight, revealEnd, false, null, 'main')).toBe('CLOSED_LOST');
  });

  it('returns CLOSED_LOST well past revealEnd when isWinner=false', () => {
    expect(computePhase(openHeight, 999_999, false, false, 'main')).toBe('CLOSED_LOST');
  });

  // --- Regtest ---
  it('uses regtest block periods correctly', () => {
    const reg = NETWORKS.regtest;
    // regtest: openPeriod=5, biddingPeriod=2, revealPeriod=10
    const oh = 100;
    const bs = oh + reg.openPeriod;       // 105
    const be = bs + reg.biddingPeriod;    // 107
    const re = be + reg.revealPeriod;     // 117

    expect(computePhase(oh, 100, false, null, 'regtest')).toBe('BIDDING');
    expect(computePhase(oh, bs, false, null, 'regtest')).toBe('BIDDING');
    expect(computePhase(oh, be - 2, false, null, 'regtest')).toBe('BIDDING');
    // hsd keeps BIDDING until the reveal boundary block.
    expect(computePhase(oh, be - 1, false, null, 'regtest')).toBe('BIDDING');
    expect(computePhase(oh, be, false, null, 'regtest')).toBe('REVEAL');
    expect(computePhase(oh, re - 1, false, null, 'regtest')).toBe('REVEAL');

    expect(computePhase(oh, re, false, true, 'regtest')).toBe('CLOSED_WON');
    expect(computePhase(oh, re, false, false, 'regtest')).toBe('CLOSED_LOST');
    expect(computePhase(oh, re, false, null, 'regtest')).toBe('CLOSED_LOST');
  });
});

// ================================================================
// blocksUntilNextPhase
// ================================================================
describe('blocksUntilNextPhase', () => {
  const startHeight = 100_000;
  const main = NETWORKS.main;
  const biddingStart = startHeight + main.openPeriod;           // 100037
  const biddingEnd = biddingStart + main.biddingPeriod;         // 100757
  const revealEnd = biddingEnd + main.revealPeriod;             // 102197

  it('returns blocks until biddingStart for OPENING phase', () => {
    expect(blocksUntilNextPhase('OPENING', startHeight, startHeight)).toBe(37);
    expect(blocksUntilNextPhase('OPENING', startHeight, biddingStart - 10)).toBe(10);
  });

  it('returns blocks until biddingEnd for BIDDING phase', () => {
    expect(blocksUntilNextPhase('BIDDING', startHeight, biddingStart)).toBe(720);
    expect(blocksUntilNextPhase('BIDDING', startHeight, biddingEnd - 5)).toBe(5);
  });

  it('returns blocks until revealEnd for REVEAL phase', () => {
    expect(blocksUntilNextPhase('REVEAL', startHeight, biddingEnd)).toBe(1440);
    expect(blocksUntilNextPhase('REVEAL', startHeight, revealEnd - 10)).toBe(10);
  });

  it('returns null for REDEEM and CLOSED phases', () => {
    expect(blocksUntilNextPhase('REDEEM', startHeight, revealEnd)).toBeNull();
    expect(blocksUntilNextPhase('CLOSED', startHeight, revealEnd)).toBeNull();
  });

  it('never returns negative (floors at 0)', () => {
    expect(blocksUntilNextPhase('OPENING', startHeight, biddingStart + 100)).toBe(0);
  });
});

// ================================================================
// getUrgentAction
// ================================================================
describe('getUrgentAction', () => {
  const userBid: UserBidData = { txid: '0x', value: 500, lockup: 1000, revealed: false, isWinner: null, redeemed: false };

  it('returns urgent reveal for REVEAL phase with unrevealed bid', () => {
    const action = getUrgentAction('REVEAL', userBid);
    expect(action.type).toBe('reveal');
    expect(action.urgency).toBe('high');
  });

  it('returns low urgency for REVEAL phase with revealed bid', () => {
    const revealed: UserBidData = { ...userBid, revealed: true };
    expect(getUrgentAction('REVEAL', revealed).urgency).toBe('low');
  });

  it('returns urgent redeem for REDEEM phase', () => {
    const losing: UserBidData = { ...userBid, isWinner: false, revealed: true };
    expect(getUrgentAction('REDEEM', losing).urgency).toBe('high');
  });

  it('returns medium for BIDDING phase', () => {
    expect(getUrgentAction('BIDDING', userBid).urgency).toBe('medium');
  });

  it('returns low for CLOSED phase', () => {
    expect(getUrgentAction('CLOSED', userBid).urgency).toBe('low');
  });
});

// ================================================================
// isNearPhaseTransition
// ================================================================
describe('isNearPhaseTransition', () => {
  const startHeight = 100_000;

  const main = NETWORKS.main;
  const biddingEnd = startHeight + main.openPeriod + main.biddingPeriod;

  it('returns true when 3 blocks from bidding end', () => {
    expect(isNearPhaseTransition('BIDDING', startHeight, biddingEnd - 3)).toBe(true);
  });

  it('returns true when 0 blocks from bidding end', () => {
    expect(isNearPhaseTransition('BIDDING', startHeight, biddingEnd)).toBe(true);
  });

  it('returns false when 10 blocks from bidding end', () => {
    expect(isNearPhaseTransition('BIDDING', startHeight, biddingEnd - 10)).toBe(false);
  });

  it('returns false for terminal phases', () => {
    expect(isNearPhaseTransition('CLOSED', startHeight, 999_999)).toBe(false);
  });
});

// ================================================================
// getUnicodeName
// ================================================================
describe('getUnicodeName', () => {
  it('decodes valid punycode names', () => {
    expect(getUnicodeName('xn--armstrong-3d95h')).toBe('armstrong💙');
    expect(getUnicodeName('xn--electrician-7v9g')).toBe('electrician⚡');
    // Flag emoji names (as seen in Bulk Search results).
    expect(getUnicodeName('xn--ad-o352ama')).toBe('ad🇦🇩');
    expect(getUnicodeName('xn--af-o352aua')).toBe('af🇦🇫');
  });

  it('returns null for plain ASCII names', () => {
    expect(getUnicodeName('namebaseme')).toBeNull();
  });

  it('returns null for names that are already Unicode', () => {
    expect(getUnicodeName('armstrong💙')).toBeNull();
  });

  it('returns null for invalid punycode instead of throwing', () => {
    expect(getUnicodeName('xn--1091')).toBeNull();
    expect(getUnicodeName('xn--1191')).toBeNull();
    expect(getUnicodeName('xn--1021')).toBeNull();
  });
});

// ================================================================
// formatNameWithUnicode
// ================================================================
describe('formatNameWithUnicode', () => {
  it('appends the decoded IDNA/emoji name in brackets', () => {
    expect(formatNameWithUnicode('xn--armstrong-3d95h')).toBe(
      'xn--armstrong-3d95h [ armstrong💙 ]',
    );
    expect(formatNameWithUnicode('xn--jacob-7y04d')).toBe('xn--jacob-7y04d [ jacob👑 ]');
  });

  it('leaves plain ASCII names unchanged', () => {
    expect(formatNameWithUnicode('namebaseme')).toBe('namebaseme');
    expect(formatNameWithUnicode('https-namebase-me')).toBe('https-namebase-me');
  });

  it('leaves invalid punycode unchanged', () => {
    expect(formatNameWithUnicode('xn--1091')).toBe('xn--1091');
  });

  it('leaves already-Unicode names unchanged', () => {
    expect(formatNameWithUnicode('armstrong💙')).toBe('armstrong💙');
  });
});

// ================================================================
// getNameSortKey
// ================================================================
describe('getNameSortKey', () => {
  it('uses the decoded name when one exists', () => {
    expect(getNameSortKey('xn--armstrong-3d95h')).toBe('armstrong💙');
  });

  it('uses the raw name for ASCII and invalid punycode', () => {
    expect(getNameSortKey('namebaseme')).toBe('namebaseme');
    expect(getNameSortKey('xn--1091')).toBe('xn--1091');
  });
});

// ================================================================
// dollaryDoosToHNS
// ================================================================
describe('dollaryDoosToHNS', () => {
  it('converts 0 dollarydoos to 0 HNS', () => {
    expect(dollaryDoosToHNS(0)).toBe(0);
  });

  it('converts 1 dollarydoo to 0.000001 HNS', () => {
    expect(dollaryDoosToHNS(1)).toBe(0.000001);
  });

  it('converts 1,000,000 dollarydoos to 1 HNS', () => {
    expect(dollaryDoosToHNS(1_000_000)).toBe(1);
  });

  it('converts 1,500,000 dollarydoos to 1.5 HNS', () => {
    expect(dollaryDoosToHNS(1_500_000)).toBe(1.5);
  });

  it('converts 1,234,567 dollarydoos to 1.234567 HNS', () => {
    expect(dollaryDoosToHNS(1_234_567)).toBe(1.234567);
  });

  it('handles very large values', () => {
    expect(dollaryDoosToHNS(1_000_000_000_000)).toBe(1_000_000);
  });
});

// ================================================================
// hnsToDollaryDoos
// ================================================================
describe('hnsToDollaryDoos', () => {
  it('converts 0 HNS to 0 dollarydoos', () => {
    expect(hnsToDollaryDoos(0)).toBe(0);
  });

  it('converts 0.000001 HNS to 1 dollarydoo', () => {
    expect(hnsToDollaryDoos(0.000001)).toBe(1);
  });

  it('converts 1 HNS to 1,000,000 dollarydoos', () => {
    expect(hnsToDollaryDoos(1)).toBe(1_000_000);
  });

  it('converts 1.5 HNS to 1,500,000 dollarydoos', () => {
    expect(hnsToDollaryDoos(1.5)).toBe(1_500_000);
  });

  it('converts 1.234567 HNS to 1,234,567 dollarydoos', () => {
    expect(hnsToDollaryDoos(1.234567)).toBe(1_234_567);
  });

  it('rounds fractional results correctly', () => {
    expect(hnsToDollaryDoos(1.2345678)).toBe(1_234_568);
  });

  it('handles large values', () => {
    expect(hnsToDollaryDoos(1_000_000)).toBe(1_000_000_000_000);
  });
});

// ================================================================
// formatHNS
// ================================================================
describe('formatHNS', () => {
  it('formats 0 as "0.000000 HNS"', () => {
    expect(formatHNS(0)).toBe('0.000000 HNS');
  });

  it('formats 1,000,000 as "1.000000 HNS"', () => {
    expect(formatHNS(1_000_000)).toBe('1.000000 HNS');
  });

  it('formats 1,500 as "0.001500 HNS"', () => {
    expect(formatHNS(1_500)).toBe('0.001500 HNS');
  });

  it('formats 1,234,567 as "1.234567 HNS"', () => {
    expect(formatHNS(1_234_567)).toBe('1.234567 HNS');
  });

  it('respects custom decimal places', () => {
    expect(formatHNS(1_234_567, 4)).toBe('1.2346 HNS');
  });

  it('respects zero decimal places', () => {
    expect(formatHNS(1_000_000, 0)).toBe('1 HNS');
  });
});

// ================================================================
// getAuctionTimeline
// ================================================================
describe('getAuctionTimeline', () => {
  it('computes correct timeline for mainnet openHeight=100000', () => {
    const main = NETWORKS.main;
    const timeline = getAuctionTimeline(100_000, 'main');
    expect(timeline.biddingStart).toBe(100_000 + main.openPeriod);
    expect(timeline.biddingEnd).toBe(100_000 + main.openPeriod + main.biddingPeriod);
    expect(timeline.revealEnd).toBe(100_000 + main.openPeriod + main.biddingPeriod + main.revealPeriod);
  });

  it('computes correct timeline for regtest openHeight=100', () => {
    const reg = NETWORKS.regtest;
    const timeline = getAuctionTimeline(100, 'regtest');
    expect(timeline.biddingStart).toBe(100 + reg.openPeriod);
    expect(timeline.biddingEnd).toBe(100 + reg.openPeriod + reg.biddingPeriod);
    expect(timeline.revealEnd).toBe(100 + reg.openPeriod + reg.biddingPeriod + reg.revealPeriod);
  });

  it('works with openHeight=0', () => {
    const main = NETWORKS.main;
    const timeline = getAuctionTimeline(0, 'main');
    expect(timeline.biddingStart).toBe(main.openPeriod);
    expect(timeline.biddingEnd).toBe(main.openPeriod + main.biddingPeriod);
    expect(timeline.revealEnd).toBe(main.openPeriod + main.biddingPeriod + main.revealPeriod);
  });

  it('defaults to mainnet', () => {
    const main = NETWORKS.main;
    const timeline = getAuctionTimeline(100_000);
    expect(timeline.biddingStart).toBe(100_000 + main.openPeriod);
  });
});

// ================================================================
// blocksToTimeLeft
// ================================================================
describe('blocksToTimeLeft', () => {
  it('returns "Expired" for 0 or negative blocks', () => {
    expect(blocksToTimeLeft(0, 'main')).toBe('Expired');
    expect(blocksToTimeLeft(-5, 'main')).toBe('Expired');
  });

  it('returns "~10m" for 1 block on mainnet', () => {
    expect(blocksToTimeLeft(1, 'main')).toBe('~10m');
  });

  it('returns "~50m" for 5 blocks on mainnet', () => {
    expect(blocksToTimeLeft(5, 'main')).toBe('~50m');
  });

  it('returns "~1h 0m" for 6 blocks on mainnet', () => {
    expect(blocksToTimeLeft(6, 'main')).toBe('~1h 0m');
  });

  it('returns "~1h 10m" for 7 blocks on mainnet', () => {
    expect(blocksToTimeLeft(7, 'main')).toBe('~1h 10m');
  });

  it('returns "~23h 50m" for 143 blocks on mainnet', () => {
    expect(blocksToTimeLeft(143, 'main')).toBe('~23h 50m');
  });

  it('returns "~1 days" for 144 blocks on mainnet', () => {
    expect(blocksToTimeLeft(144, 'main')).toBe('~1 days');
  });

  it('returns "~2 days" for 288 blocks on mainnet', () => {
    expect(blocksToTimeLeft(288, 'main')).toBe('~2 days');
  });

  it('uses regtest block time correctly: 1 block -> "~10m"', () => {
    expect(blocksToTimeLeft(1, 'regtest')).toBe('~10m');
  });

  it('uses regtest block time: 60 blocks -> "~10h 0m"', () => {
    expect(blocksToTimeLeft(60, 'regtest')).toBe('~10h 0m');
  });

  it('uses regtest block time: 1440 blocks -> "~1 week"', () => {
    expect(blocksToTimeLeft(1440, 'regtest')).toBe('~1 week');
  });

  it('defaults to mainnet', () => {
    expect(blocksToTimeLeft(1)).toBe('~10m');
  });

  it('floors minutes', () => {
    expect(blocksToTimeLeft(0.5, 'main')).toBe('~5m');
  });
});

// ================================================================
// daysToBlocks (from constants.ts)
// ================================================================
describe('daysToBlocks', () => {
  it('converts 1 day to 144 blocks on mainnet', () => {
    expect(daysToBlocks(1, 'main')).toBe(144);
  });

  it('converts 30 days to 4320 blocks on mainnet', () => {
    expect(daysToBlocks(30, 'main')).toBe(4320);
  });

  it('converts 1 day to 144 blocks on regtest (10 min target spacing)', () => {
    expect(daysToBlocks(1, 'regtest')).toBe(144);
  });

  it('converts 0 days to 0 blocks', () => {
    expect(daysToBlocks(0, 'main')).toBe(0);
  });

  it('defaults to mainnet', () => {
    expect(daysToBlocks(1)).toBe(144);
  });
});
