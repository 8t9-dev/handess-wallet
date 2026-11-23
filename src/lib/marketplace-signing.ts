/**
 * Canonical marketplace listing payloads.
 *
 * The ownership signature must cover every commercial term of the listing,
 * not just the seller's contact string. Otherwise a relay or third party can
 * change the price or payout address while the "Verified" badge stays valid.
 */

import type { MarketplaceListing } from '../types/marketplace';

export const MARKETPLACE_LISTING_VERSION = 1;
export const MARKETPLACE_LISTING_DOMAIN = 'HNS-MARKETPLACE-LISTING-V1';
export const DEFAULT_LISTING_DAYS = 30;

/** Extra HNS the buyer adds to cover the 2-of-3 escrow release transaction. */
export const MARKETPLACE_ESCROW_FEE_BUFFER = 50_000; // 0.05 HNS in dollarydoos

/**
 * Dispute-only arbitration fee. The buyer funds it with the escrow, gets it
 * back on a normal buyer+seller release, and the arbiter receives it on a
 * refund or arbitration release.
 */
export const MARKETPLACE_ARBITER_FEE = 5_000_000; // 5 HNS in dollarydoos

export interface ListingSigningFields {
  listingId: string;
  name: string;
  price: number;
  sellerAddr: string;
  sellerPubKey: string;
  contact?: string;
  createdAt: string;
  expiresAt: string;
  payloadVersion?: number;
  escrowArbiterPubKey?: string;
  escrowArbiterPayoutAddress?: string;
  escrowArbiterFee?: number;
}

/** Deterministic ID for one seller's listing of one name. */
export function getListingId(sellerPubKey: string, name: string): string {
  return `${sellerPubKey}:${name}`;
}

/** Default listing lifetime. */
export function getListingExpiresAt(
  createdAt: string,
  days = DEFAULT_LISTING_DAYS,
): string {
  const created = new Date(createdAt).getTime();
  return new Date(created + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Build the exact UTF-8 string that is signed with the name's owner key.
 * Keep the key order stable; verification reconstructs this from the listing.
 */
export function buildListingPayload(fields: ListingSigningFields): string {
  const version = fields.payloadVersion ?? MARKETPLACE_LISTING_VERSION;
  const payload: Record<string, unknown> = {
    v: version,
    domain: MARKETPLACE_LISTING_DOMAIN,
    listingId: fields.listingId,
    name: fields.name,
    price: fields.price,
    sellerAddr: fields.sellerAddr,
    sellerPubKey: fields.sellerPubKey,
  };

  if (version >= 2) {
    payload.escrowArbiterPubKey = fields.escrowArbiterPubKey || '';
  }
  if (version >= 3) {
    payload.escrowArbiterPayoutAddress = fields.escrowArbiterPayoutAddress || '';
    payload.escrowArbiterFee = fields.escrowArbiterFee ?? 0;
  }

  payload.contact = fields.contact || '';
  payload.createdAt = fields.createdAt;
  payload.expiresAt = fields.expiresAt;

  return JSON.stringify(payload);
}

/** Rebuild the signed payload from a listing, or null for legacy listings. */
export function buildListingPayloadFromListing(
  listing: MarketplaceListing,
): string | null {
  if (
    !listing.listingId ||
    !listing.sellerPubKey ||
    !listing.expiresAt ||
    !listing.createdAt
  ) {
    return null;
  }

  return buildListingPayload({
    listingId: listing.listingId,
    name: listing.name,
    price: listing.price,
    sellerAddr: listing.sellerAddr,
    sellerPubKey: listing.sellerPubKey,
    contact: listing.contact,
    createdAt: listing.createdAt,
    expiresAt: listing.expiresAt,
    payloadVersion: listing.payloadVersion || 1,
    escrowArbiterPubKey: listing.escrowArbiterPubKey,
    escrowArbiterPayoutAddress: listing.escrowArbiterPayoutAddress,
    escrowArbiterFee: listing.escrowArbiterFee,
  });
}

/** A listing that offers 2-of-3 escrow through an independent arbiter. */
export function isEscrowListing(listing: MarketplaceListing): boolean {
  return (listing.payloadVersion === 2 || listing.payloadVersion === 3)
    && Boolean(listing.escrowArbiterPubKey);
}

/** The dispute-only arbiter fee bound into a v3 listing. */
export function getEscrowArbiterFee(listing: MarketplaceListing): number {
  if (listing.payloadVersion !== 3) return 0;
  const fee = Number(listing.escrowArbiterFee);
  return Number.isSafeInteger(fee) && fee > 0 ? fee : 0;
}

/** A listing with every field required for a verifiable full-terms proof. */
export function isCanonicalListing(listing: MarketplaceListing): boolean {
  return Boolean(
    listing.listingId &&
      listing.sellerPubKey &&
      listing.signedMessage &&
      listing.signature &&
      listing.expiresAt,
  );
}

export function isListingExpired(
  listing: MarketplaceListing,
  now = Date.now(),
): boolean {
  if (!listing.expiresAt) return false;
  return new Date(listing.expiresAt).getTime() <= now;
}
