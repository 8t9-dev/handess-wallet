import { describe, it, expect } from 'vitest';
import { bucketAuctions } from '../auction-buckets';
import type { UnifiedHnsAuction, UserBidData } from '../../types/auction';

function auction(
  overrides: Partial<UnifiedHnsAuction> & { name: string },
): UnifiedHnsAuction {
  return {
    currentBlock: 1_000,
    startHeight: 100,
    blockchainState: 'OPENING',
    highestBid: 0,
    totalBids: 0,
    blocksUntilNext: 10,
    ...overrides,
  };
}

function bid(overrides: Partial<UserBidData> = {}): UserBidData {
  return {
    txid: 'bid-tx',
    value: 100,
    lockup: 150,
    revealed: false,
    isWinner: null,
    redeemed: false,
    ...overrides,
  };
}

describe('bucketAuctions — Opened tab', () => {
  it('puts a history-opened name in Opened while OPENING', () => {
    const result = bucketAuctions(
      [auction({ name: 'xn--gg-6352aa' })],
      [],
      [],
      ['xn--gg-6352aa'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['xn--gg-6352aa']);
  });

  it('keeps an opened name in Opened after bidding starts, even without a bid', () => {
    const result = bucketAuctions(
      [auction({ name: 'jacob', blockchainState: 'BIDDING' })],
      [],
      [],
      ['jacob'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['jacob']);
    expect(result.active).toEqual([]);
  });

  it('keeps an opened name in Opened after the auction closes', () => {
    const result = bucketAuctions(
      [auction({ name: 'jacob', blockchainState: 'CLOSED', blocksUntilNext: null })],
      [],
      [],
      ['jacob'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['jacob']);
  });

  it('shows an opened name with a bid in BOTH Opened and Active Bids', () => {
    const result = bucketAuctions(
      [auction({ name: 'jacob', blockchainState: 'BIDDING', userBidData: bid() })],
      [],
      [],
      ['jacob'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['jacob']);
    expect(result.active.map(a => a.name)).toEqual(['jacob']);
  });

  it('does not show non-opened names without a bid in Opened', () => {
    const result = bucketAuctions(
      [auction({ name: 'someone-elses-name', blockchainState: 'OPENING' })],
      [],
      [],
      [],
    );

    expect(result.opened).toEqual([]);
    expect(result.active).toEqual([]);
  });

  it('keeps opened names out of Opened when dismissed, without affecting bid tabs', () => {
    const result = bucketAuctions(
      [auction({ name: 'jacob', blockchainState: 'BIDDING', userBidData: bid() })],
      ['jacob'],
      [],
      ['jacob'],
    );

    expect(result.opened).toEqual([]);
    expect(result.active.map(a => a.name)).toEqual(['jacob']);
  });

  it('hides only the dismissed name when several were opened', () => {
    const result = bucketAuctions(
      [
        auction({ name: 'one', blockchainState: 'BIDDING' }),
        auction({ name: 'two', blockchainState: 'OPENING' }),
      ],
      ['one'],
      [],
      ['one', 'two'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['two']);
  });
});

describe('bucketAuctions — bid-backed tabs remain phase-driven', () => {
  it('buckets won opened names into Opened and Won (pending)', () => {
    const result = bucketAuctions(
      [
        auction({
          name: 'won-name',
          blockchainState: 'CLOSED',
          userBidData: bid({ isWinner: true, revealed: true }),
        }),
      ],
      [],
      [],
      ['won-name'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['won-name']);
    expect(result.wonPending.map(a => a.name)).toEqual(['won-name']);
    expect(result.wonSettled).toEqual([]);
  });

  it('buckets a registered opened name into Won (settled)', () => {
    const result = bucketAuctions(
      [
        auction({
          name: 'registered',
          blockchainState: 'CLOSED',
          userBidData: bid({ isWinner: true, revealed: true }),
        }),
      ],
      [],
      ['registered'],
      ['registered'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['registered']);
    expect(result.wonSettled.map(a => a.name)).toEqual(['registered']);
    expect(result.wonPending).toEqual([]);
  });

  it('buckets a lost opened name into Lost (pending)', () => {
    const result = bucketAuctions(
      [
        auction({
          name: 'lost-name',
          blockchainState: 'CLOSED',
          userBidData: bid({ isWinner: false, revealed: true }),
        }),
      ],
      [],
      [],
      ['lost-name'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['lost-name']);
    expect(result.lostPending.map(a => a.name)).toEqual(['lost-name']);
  });

  it('buckets a redeemed lost name into Lost (settled) while keeping it opened', () => {
    const result = bucketAuctions(
      [
        auction({
          name: 'redeemed',
          blockchainState: 'CLOSED',
          userBidData: bid({ isWinner: false, revealed: true, redeemed: true }),
        }),
      ],
      [],
      [],
      ['redeemed'],
    );

    expect(result.opened.map(a => a.name)).toEqual(['redeemed']);
    expect(result.lostSettled.map(a => a.name)).toEqual(['redeemed']);
    expect(result.lostPending).toEqual([]);
  });

  it('puts revealed bids in Reveal Phase', () => {
    const result = bucketAuctions(
      [
        auction({
          name: 'revealing',
          blockchainState: 'REVEAL',
          userBidData: bid({ revealed: true }),
        }),
      ],
      [],
      [],
      ['revealing'],
    );

    expect(result.reveal.map(a => a.name)).toEqual(['revealing']);
    expect(result.opened.map(a => a.name)).toEqual(['revealing']);
  });
});
