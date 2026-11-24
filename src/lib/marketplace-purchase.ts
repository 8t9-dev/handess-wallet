import type {
  PurchaseIntent,
  PurchaseIntentStatus,
  TransferStatus,
} from '../types/marketplace';

/**
 * The on-chain transfer is the source of truth for an active purchase. A
 * seller's Nostr status event can be missed when relays are unavailable, so a
 * locally pending intent may still have a verified on-chain transfer.
 */
export function effectivePurchaseStatus(
  intent: Pick<PurchaseIntent, 'status'>,
  status?: TransferStatus,
): PurchaseIntentStatus {
  if (intent.status === 'paid' || intent.status === 'sold' || intent.status === 'cancelled') {
    return intent.status;
  }
  if (status?.cancelled) return 'cancelled';
  if (status?.transferred || status?.finalized) return 'transferred';
  return intent.status;
}

/** Payment is allowed only after the on-chain transfer is verified. */
export function canPaySeller(
  intent: Pick<PurchaseIntent, 'status' | 'escrow'>,
  status?: TransferStatus,
): boolean {
  if (intent.escrow) return false;
  if (intent.status === 'paid' || intent.status === 'sold' || intent.status === 'cancelled') {
    return false;
  }
  if (status?.cancelled) return false;
  return Boolean(status?.transferred || status?.finalized);
}

/** Purchases that can still change state should be polled on-chain. */
export function shouldTrackTransfer(
  intent: Pick<PurchaseIntent, 'status'>,
): boolean {
  return intent.status !== 'sold' && intent.status !== 'cancelled';
}
