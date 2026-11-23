import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_ARBITER_FEE,
  buildListingPayload,
  buildListingPayloadFromListing,
  getEscrowArbiterFee,
  getListingExpiresAt,
  getListingId,
  isCanonicalListing,
  isEscrowListing,
  isListingExpired,
} from '../marketplace-signing';
import type { MarketplaceListing } from '../../types/marketplace';

const CREATED = '2026-10-25T10:00:00.000Z';
const EXPIRES = getListingExpiresAt(CREATED);
const PUBKEY = 'a'.repeat(64);

function makeListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    listingId: getListingId(PUBKEY, 'example'),
    name: 'example',
    price: 100_000_000,
    sellerAddr: 'hs1qexample',
    sellerPubKey: PUBKEY,
    contact: 'test@example.com',
    verified: true,
    signature: 'signature',
    signedMessage: buildListingPayload({
      listingId: getListingId(PUBKEY, 'example'),
      name: 'example',
      price: 100_000_000,
      sellerAddr: 'hs1qexample',
      sellerPubKey: PUBKEY,
      contact: 'test@example.com',
      createdAt: CREATED,
      expiresAt: EXPIRES,
    }),
    status: 'active',
    createdAt: CREATED,
    updatedAt: CREATED,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

describe('marketplace listing signing', () => {
  it('builds a deterministic listing id from seller key and name', () => {
    expect(getListingId(PUBKEY, 'example')).toBe(`${PUBKEY}:example`);
  });

  it('defaults the listing lifetime to 30 days', () => {
    expect(EXPIRES).toBe('2026-11-24T10:00:00.000Z');
  });

  it('binds name, price, address, seller key, contact, and expiry', () => {
    const payload = buildListingPayload({
      listingId: getListingId(PUBKEY, 'example'),
      name: 'example',
      price: 100_000_000,
      sellerAddr: 'hs1qexample',
      sellerPubKey: PUBKEY,
      contact: 'test@example.com',
      createdAt: CREATED,
      expiresAt: EXPIRES,
    });
    const parsed = JSON.parse(payload);
    expect(parsed).toMatchObject({
      v: 1,
      domain: 'HNS-MARKETPLACE-LISTING-V1',
      listingId: `${PUBKEY}:example`,
      name: 'example',
      price: 100_000_000,
      sellerAddr: 'hs1qexample',
      sellerPubKey: PUBKEY,
      contact: 'test@example.com',
      createdAt: CREATED,
      expiresAt: EXPIRES,
    });
  });

  it('rebuilds the exact signed payload from a canonical listing', () => {
    const listing = makeListing();
    expect(buildListingPayloadFromListing(listing)).toBe(listing.signedMessage);
  });

  it('changes the payload when the price or payout address is tampered with', () => {
    const listing = makeListing();
    const original = buildListingPayloadFromListing(listing);
    const repriced = buildListingPayloadFromListing({ ...listing, price: 1 });
    const readdressed = buildListingPayloadFromListing({ ...listing, sellerAddr: 'hs1qattacker' });
    expect(repriced).not.toBe(original);
    expect(readdressed).not.toBe(original);
  });

  it('returns null for a legacy listing without a full payload', () => {
    const legacy = makeListing({
      listingId: undefined,
      sellerPubKey: undefined,
      expiresAt: undefined,
      signedMessage: 'legacy contact string',
    });
    expect(buildListingPayloadFromListing(legacy)).toBeNull();
    expect(isCanonicalListing(legacy)).toBe(false);
  });

  it('recognises canonical listings', () => {
    expect(isCanonicalListing(makeListing())).toBe(true);
  });

  it('detects expired listings, including the boundary', () => {
    const listing = makeListing();
    expect(isListingExpired(listing, new Date(EXPIRES).getTime() - 1)).toBe(false);
    expect(isListingExpired(listing, new Date(EXPIRES).getTime())).toBe(true);
  });

  it('binds the escrow arbiter in a v2 payload', () => {
    const arbiter = 'c'.repeat(64);
    const payload = buildListingPayload({
      listingId: getListingId(PUBKEY, 'example'),
      name: 'example',
      price: 100_000_000,
      sellerAddr: 'hs1qexample',
      sellerPubKey: PUBKEY,
      contact: 'test@example.com',
      createdAt: CREATED,
      expiresAt: EXPIRES,
      payloadVersion: 2,
      escrowArbiterPubKey: arbiter,
    });
    const parsed = JSON.parse(payload);
    expect(parsed.v).toBe(2);
    expect(parsed.escrowArbiterPubKey).toBe(arbiter);
  });

  it('omits escrow metadata from a v1 payload', () => {
    const parsed = JSON.parse(makeListing().signedMessage!);
    expect(parsed.v).toBe(1);
    expect(parsed.escrowArbiterPubKey).toBeUndefined();
  });

  it('rebuilds a v2 payload and recognises an escrow listing', () => {
    const arbiter = 'c'.repeat(64);
    const signedMessage = buildListingPayload({
      listingId: getListingId(PUBKEY, 'example'),
      name: 'example',
      price: 100_000_000,
      sellerAddr: 'hs1qexample',
      sellerPubKey: PUBKEY,
      contact: 'test@example.com',
      createdAt: CREATED,
      expiresAt: EXPIRES,
      payloadVersion: 2,
      escrowArbiterPubKey: arbiter,
    });
    const listing = makeListing({
      payloadVersion: 2,
      escrowArbiterPubKey: arbiter,
      signedMessage,
    });

    expect(buildListingPayloadFromListing(listing)).toBe(signedMessage);
    expect(isEscrowListing(listing)).toBe(true);
    expect(
      buildListingPayloadFromListing({ ...listing, escrowArbiterPubKey: 'd'.repeat(64) }),
    ).not.toBe(signedMessage);
    expect(isEscrowListing(makeListing())).toBe(false);
  });

  it('binds the arbiter fee and payout address in a v3 payload', () => {
    const arbiter = 'c'.repeat(64);
    const payout = 'hs1qarbiter';
    const signedMessage = buildListingPayload({
      listingId: getListingId(PUBKEY, 'example'),
      name: 'example',
      price: 100_000_000,
      sellerAddr: 'hs1qexample',
      sellerPubKey: PUBKEY,
      contact: 'test@example.com',
      createdAt: CREATED,
      expiresAt: EXPIRES,
      payloadVersion: 3,
      escrowArbiterPubKey: arbiter,
      escrowArbiterPayoutAddress: payout,
      escrowArbiterFee: MARKETPLACE_ARBITER_FEE,
    });
    const listing = makeListing({
      payloadVersion: 3,
      escrowArbiterPubKey: arbiter,
      escrowArbiterPayoutAddress: payout,
      escrowArbiterFee: MARKETPLACE_ARBITER_FEE,
      signedMessage,
    });
    const parsed = JSON.parse(signedMessage);

    expect(parsed.v).toBe(3);
    expect(parsed.escrowArbiterFee).toBe(MARKETPLACE_ARBITER_FEE);
    expect(parsed.escrowArbiterPayoutAddress).toBe(payout);
    expect(buildListingPayloadFromListing(listing)).toBe(signedMessage);
    expect(isEscrowListing(listing)).toBe(true);
    expect(getEscrowArbiterFee(listing)).toBe(MARKETPLACE_ARBITER_FEE);
  });
});
