import type { GlobalAuction } from '../types/auction';
import { toUnicode } from './name-utils';

export type GlobalAuctionFilter = 'all' | 'opening' | 'bidding' | 'reveal' | 'closing';
export type GlobalAuctionSort = 'closing' | 'opened' | 'bids' | 'bids-asc' | 'lockup' | 'lockup-asc';
export type GlobalAuctionView = 'all' | 'ending' | 'bids' | 'highest' | 'lowest';

export interface GlobalAuctionQuery {
  query?: string;
  filter?: GlobalAuctionFilter;
  /** Used by the "closing" filter. */
  closingWithinBlocks?: number;
  sort?: GlobalAuctionSort;
}

export function matchesGlobalAuctionQuery(
  auction: GlobalAuction,
  query: string,
): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  if (auction.name.toLowerCase().includes(text)) return true;
  const unicode = toUnicode(auction.name).toLowerCase();
  return unicode.includes(text);
}

function matchesFilter(
  auction: GlobalAuction,
  filter: GlobalAuctionFilter,
  closingWithinBlocks: number,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'opening':
      return auction.state === 'OPENING';
    case 'bidding':
      return auction.state === 'BIDDING';
    case 'reveal':
      return auction.state === 'REVEAL';
    case 'closing':
      return auction.blocksUntilClose <= closingWithinBlocks;
  }
}

export function countGlobalAuctionPhases(
  auctions: GlobalAuction[],
  closingWithinBlocks: number,
): Record<GlobalAuctionFilter, number> {
  return {
    all: auctions.length,
    opening: auctions.filter((auction) => auction.state === 'OPENING').length,
    bidding: auctions.filter((auction) => auction.state === 'BIDDING').length,
    reveal: auctions.filter((auction) => auction.state === 'REVEAL').length,
    closing: auctions.filter((auction) => auction.blocksUntilClose <= closingWithinBlocks).length,
  };
}

export function sortGlobalAuctions(
  auctions: GlobalAuction[],
  sort: GlobalAuctionSort,
): GlobalAuction[] {
  const copy = [...auctions];
  copy.sort((a, b) => {
    switch (sort) {
      case 'closing':
        return a.blocksUntilClose - b.blocksUntilClose || a.name.localeCompare(b.name);
      case 'opened':
        return b.openHeight - a.openHeight || a.name.localeCompare(b.name);
      case 'bids':
        return b.bidCount - a.bidCount || a.name.localeCompare(b.name);
      case 'bids-asc':
        return a.bidCount - b.bidCount || a.name.localeCompare(b.name);
      case 'lockup':
        return b.highestLockup - a.highestLockup || a.name.localeCompare(b.name);
      case 'lockup-asc':
        return a.highestLockup - b.highestLockup || a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });
  return copy;
}

export function queryGlobalAuctions(
  auctions: GlobalAuction[],
  query: GlobalAuctionQuery,
): GlobalAuction[] {
  const filter = query.filter || 'all';
  const closingWithinBlocks = query.closingWithinBlocks ?? 1008;
  const matched = auctions.filter((auction) => (
    matchesFilter(auction, filter, closingWithinBlocks)
    && matchesGlobalAuctionQuery(auction, query.query || '')
  ));
  return sortGlobalAuctions(matched, query.sort || 'closing');
}

export interface GlobalAuctionMilestone {
  label: 'Bidding starts' | 'Reveal starts' | 'Auction closes';
  targetBlock: number;
  blocks: number;
}

export function getGlobalAuctionMilestone(auction: GlobalAuction): GlobalAuctionMilestone {
  if (auction.state === 'OPENING') {
    return {
      label: 'Bidding starts',
      targetBlock: auction.biddingStart,
      blocks: auction.blocksUntilNext,
    };
  }
  if (auction.state === 'BIDDING') {
    return {
      label: 'Reveal starts',
      targetBlock: auction.revealStart,
      blocks: auction.blocksUntilNext,
    };
  }
  return {
    label: 'Auction closes',
    targetBlock: auction.closeBlock,
    blocks: auction.blocksUntilClose,
  };
}
