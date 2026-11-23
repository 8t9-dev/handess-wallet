import type { UnifiedHnsAuction } from '../types/auction';

export interface AuctionBuckets {
  opened: UnifiedHnsAuction[];
  active: UnifiedHnsAuction[];
  reveal: UnifiedHnsAuction[];
  wonPending: UnifiedHnsAuction[];
  wonSettled: UnifiedHnsAuction[];
  lostPending: UnifiedHnsAuction[];
  lostSettled: UnifiedHnsAuction[];
}

/**
 * Bucket unified auctions into the five lifecycle tabs.
 *
 * The Opened tab is history-driven: every name in `openedNames` (OPEN
 * covenants found in wallet transaction history) stays there until the user
 * dismisses it, regardless of the auction's current phase or whether the user
 * placed a bid. A name can therefore appear in Opened AND in one of the
 * bid-backed tabs at the same time.
 *
 * The bid-backed tabs keep their original phase/bid-driven behaviour:
 *   Active Bids  = OPENING/BIDDING with a user bid
 *   Reveal Phase = REVEAL with a user bid
 *   Won          = CLOSED + winner (pending/completed)
 *   Lost         = REDEEM or CLOSED + loser (pending/completed)
 */
export function bucketAuctions(
  auctions: UnifiedHnsAuction[],
  openedHidden: string[],
  justRegistered: string[],
  openedNames: string[] = [],
): AuctionBuckets {
  const opened: UnifiedHnsAuction[] = [];
  const active: UnifiedHnsAuction[] = [];
  const reveal: UnifiedHnsAuction[] = [];
  const wonPending: UnifiedHnsAuction[] = [];
  const wonSettled: UnifiedHnsAuction[] = [];
  const lostPending: UnifiedHnsAuction[] = [];
  const lostSettled: UnifiedHnsAuction[] = [];

  const openedSet = new Set(openedNames);
  const hiddenSet = new Set(openedHidden);
  const registeredSet = new Set(justRegistered);

  for (const a of auctions) {
    const hasUserBid = !!a.userBidData;
    const isWinner = a.userBidData?.isWinner === true;
    const redeemed = a.userBidData?.redeemed === true;
    const isJustRegistered = registeredSet.has(a.name);
    const isSettled = redeemed || isJustRegistered;
    const phase = a.blockchainState;

    // History-sourced Opened list. Intentionally independent of phase and
    // bid status so opened names persist until manually cleared.
    if (openedSet.has(a.name) && !hiddenSet.has(a.name)) {
      opened.push(a);
    }

    // Names with no user bid have no other tab to appear in.
    if (!hasUserBid) continue;

    // Names WITH a user bid also bucket by phase and bid status.
    switch (phase) {
      case 'OPENING':
        // User bid during OPENING phase — waiting for BIDDING to start.
        active.push(a);
        break;
      case 'BIDDING':
        active.push(a);
        break;
      case 'REVEAL':
        // In reveal phase — show regardless of whether this specific bid was
        // already revealed; it leaves once the auction closes.
        reveal.push(a);
        break;
      case 'REDEEM':
        // Lost auction, can redeem funds.
        (redeemed ? lostSettled : lostPending).push(a);
        break;
      case 'CLOSED':
        if (isWinner) {
          (isSettled ? wonSettled : wonPending).push(a);
        } else if (!redeemed) {
          lostPending.push(a);
        } else {
          lostSettled.push(a);
        }
        break;
    }
  }

  return { opened, active, reveal, wonPending, wonSettled, lostPending, lostSettled };
}
