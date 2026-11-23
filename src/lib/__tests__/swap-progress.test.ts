import { describe, expect, it } from 'vitest';
import { getSwapProgressState, SWAP_PROGRESS_STEPS } from '../swap-progress';

describe('swap progress wizard states', () => {
  it('treats a completed swap as fully finished', () => {
    const state = getSwapProgressState('completed');
    expect(state.completed).toBe(true);
    expect(state.failed).toBe(false);
    expect(state.currentIdx).toBe(SWAP_PROGRESS_STEPS.length);
    expect(state.currentIdx > SWAP_PROGRESS_STEPS.length - 1).toBe(true);
  });

  it('leaves the active step as the current step while a swap is in progress', () => {
    expect(getSwapProgressState('hns_claimed')).toMatchObject({
      currentIdx: 5,
      failed: false,
      completed: false,
    });
    expect(getSwapProgressState('accepted')).toMatchObject({
      currentIdx: 0,
      failed: false,
      completed: false,
    });
  });

  it('marks terminal failure states as failed', () => {
    for (const state of ['refunding', 'refunded', 'failed'] as const) {
      expect(getSwapProgressState(state).failed).toBe(true);
    }
  });
});
