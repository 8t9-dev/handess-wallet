import type { SwapState } from '../types/swap';

export const SWAP_PROGRESS_STEPS: Array<{ label: string; description: string }> = [
  { label: 'Accepted', description: 'Counterparty accepted the offer' },
  { label: 'Terms Exchanged', description: 'HTLC keys, timeouts, and secret hash agreed' },
  { label: 'HNS Locked', description: 'HNS is locked in the HNS HTLC' },
  { label: 'DGB Locked', description: 'DGB is locked in the DGB HTLC' },
  { label: 'DGB Claimed', description: 'HNS side claimed DGB and revealed the secret' },
  { label: 'HNS Claimed', description: 'DGB side claimed HNS with the revealed secret' },
  { label: 'Completed', description: 'Both HTLCs were spent successfully' },
];

const STEP_INDEX: Record<SwapState, number> = {
  offered: 0,
  accepted: 0,
  terms_ready: 1,
  hns_funding: 2,
  hns_htlc_funded: 2,
  dgb_funding: 3,
  dgb_htlc_funded: 3,
  dgb_claimed: 4,
  secret_revealed: 4,
  hns_claimed: 5,
  completed: SWAP_PROGRESS_STEPS.length,
  refunding: SWAP_PROGRESS_STEPS.length,
  refunded: SWAP_PROGRESS_STEPS.length,
  failed: SWAP_PROGRESS_STEPS.length,
};

export interface SwapProgressState {
  currentIdx: number;
  failed: boolean;
  completed: boolean;
}

/**
 * Map a swap state to the progress-wizard position. A completed swap points one
 * step past the final row so every row, including "Completed", is rendered as
 * finished instead of "in progress".
 */
export function getSwapProgressState(state: SwapState): SwapProgressState {
  const failed = state === 'refunded' || state === 'failed' || state === 'refunding';
  return {
    currentIdx: STEP_INDEX[state] ?? 0,
    failed,
    completed: state === 'completed',
  };
}
