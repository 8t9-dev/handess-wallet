import { describe, expect, it } from 'vitest';
import {
  canPaySeller,
  effectivePurchaseStatus,
  shouldTrackTransfer,
} from '../marketplace-purchase';
import type { PurchaseIntent, TransferStatus } from '../../types/marketplace';

function makeIntent(overrides: Partial<PurchaseIntent> = {}): PurchaseIntent {
  return {
    intentId: 'intent-1',
    name: 'example',
    price: 100_000_000,
    buyerAddr: 'hs1qbuyer',
    sellerAddr: 'hs1qseller',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TRANSFERRED: TransferStatus = {
  transferred: true,
  cancelled: false,
  finalized: false,
  blocksRemaining: 100,
};

describe('marketplace purchase status', () => {
  it('shows a chain-detected transfer even when the local intent is pending', () => {
    expect(effectivePurchaseStatus(makeIntent(), TRANSFERRED)).toBe('transferred');
  });

  it('does not override paid, sold, or cancelled intents', () => {
    expect(effectivePurchaseStatus(makeIntent({ status: 'paid' }), TRANSFERRED)).toBe('paid');
    expect(effectivePurchaseStatus(makeIntent({ status: 'sold' }), TRANSFERRED)).toBe('sold');
    expect(effectivePurchaseStatus(makeIntent({ status: 'cancelled' }), TRANSFERRED)).toBe('cancelled');
  });

  it('shows a chain cancellation even when the local intent is pending', () => {
    const status: TransferStatus = { transferred: false, cancelled: true, finalized: false };
    expect(effectivePurchaseStatus(makeIntent(), status)).toBe('cancelled');
  });

  it('allows payment for a verified transfer without a seller status event', () => {
    expect(canPaySeller(makeIntent(), TRANSFERRED)).toBe(true);
  });

  it('allows payment after the buyer finalized the name first', () => {
    const status: TransferStatus = { transferred: false, cancelled: false, finalized: true };
    expect(canPaySeller(makeIntent(), status)).toBe(true);
  });

  it('blocks payment until the transfer is verified', () => {
    expect(canPaySeller(makeIntent())).toBe(false);
    expect(canPaySeller(makeIntent(), {
      transferred: false,
      cancelled: false,
      finalized: false,
    })).toBe(false);
  });

  it('blocks payment for escrow, cancelled, paid, and sold purchases', () => {
    const escrow = { address: 'hs1qescrow', arbiterPubKey: 'aa', amount: 1, state: 'funded' as const };
    expect(canPaySeller(makeIntent({ escrow }), TRANSFERRED)).toBe(false);
    expect(canPaySeller(makeIntent({ status: 'cancelled' }), TRANSFERRED)).toBe(false);
    expect(canPaySeller(makeIntent({ status: 'paid' }), TRANSFERRED)).toBe(false);
    expect(canPaySeller(makeIntent({ status: 'sold' }), TRANSFERRED)).toBe(false);
  });

  it('tracks every purchase that has not reached a terminal state', () => {
    expect(shouldTrackTransfer(makeIntent({ status: 'pending' }))).toBe(true);
    expect(shouldTrackTransfer(makeIntent({ status: 'transferred' }))).toBe(true);
    expect(shouldTrackTransfer(makeIntent({ status: 'paid' }))).toBe(true);
    expect(shouldTrackTransfer(makeIntent({ status: 'sold' }))).toBe(false);
    expect(shouldTrackTransfer(makeIntent({ status: 'cancelled' }))).toBe(false);
  });
});
