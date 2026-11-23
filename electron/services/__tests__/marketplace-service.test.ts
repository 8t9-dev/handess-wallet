import { describe, it, expect, vi } from 'vitest';
import { bech32 } from 'bech32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { MarketplaceService } from '../shakedex-service';
import type { WalletService } from '../wallet-service';
import type { HSDConnectionService } from '../hsd-connection';
import type { DBService } from '../db-service';
import type { NostrMarketplaceService } from '../nostr-marketplace-service';
import type { MarketplaceListing, PurchaseIntent } from '../../../src/types/marketplace';
import {
  MARKETPLACE_ARBITER_FEE,
  buildListingPayload,
  getListingExpiresAt,
  getListingId,
} from '../../../src/lib/marketplace-signing';
import {
  ESCROW_FEE_BUFFER,
  buildEscrowRedeemScript,
  escrowAddress,
  parseEscrowPsbt,
  signEscrowPsbt as signEscrowPsbtWithKey,
} from '../hns-escrow-service';

function xOnlyPubkey(seed: number): string {
  return Buffer.from(
    secp256k1.getPublicKey(new Uint8Array(32).fill(seed), true),
  ).subarray(1).toString('hex');
}

const SELLER_PUBKEY = xOnlyPubkey(1);
const BUYER_PUBKEY = xOnlyPubkey(2);
const ARBITER_PUBKEY = xOnlyPubkey(3);
const SELLER_SECRET = new Uint8Array(32).fill(1);
const BUYER_SECRET = new Uint8Array(32).fill(2);
const ARBITER_SECRET = new Uint8Array(32).fill(3);

function secretForPubkey(pubkey: string): Uint8Array {
  if (pubkey === SELLER_PUBKEY) return SELLER_SECRET;
  if (pubkey === BUYER_PUBKEY) return BUYER_SECRET;
  if (pubkey === ARBITER_PUBKEY) return ARBITER_SECRET;
  throw new Error('No test secret for pubkey');
}
const CREATED = '2026-10-25T10:00:00.000Z';
const EXPIRES = getListingExpiresAt(CREATED);

function makeAddress(seed: number): string {
  const program = new Uint8Array(20).fill(seed);
  return bech32.encode('hs', [0, ...bech32.toWords(program)]);
}

const SELLER_ADDR = makeAddress(1);
const BUYER_ADDR = makeAddress(2);
const ARBITER_PAYOUT_ADDR = makeAddress(3);

function makeListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  const listingId = getListingId(SELLER_PUBKEY, 'example');
  const signedMessage = buildListingPayload({
    listingId,
    name: 'example',
    price: 100_000_000,
    sellerAddr: SELLER_ADDR,
    sellerPubKey: SELLER_PUBKEY,
    contact: 'seller@example.com',
    createdAt: CREATED,
    expiresAt: EXPIRES,
  });

  return {
    listingId,
    name: 'example',
    price: 100_000_000,
    sellerAddr: SELLER_ADDR,
    sellerPubKey: SELLER_PUBKEY,
    contact: 'seller@example.com',
    verified: true,
    signature: 'seller-signature',
    signedMessage,
    status: 'active',
    createdAt: CREATED,
    updatedAt: CREATED,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function makeEscrowListing(
  overrides: Partial<MarketplaceListing> = {},
): MarketplaceListing {
  const listingId = getListingId(SELLER_PUBKEY, 'example');
  const signedMessage = buildListingPayload({
    listingId,
    name: 'example',
    price: 100_000_000,
    sellerAddr: SELLER_ADDR,
    sellerPubKey: SELLER_PUBKEY,
    contact: 'seller@example.com',
    createdAt: CREATED,
    expiresAt: EXPIRES,
    payloadVersion: 2,
    escrowArbiterPubKey: ARBITER_PUBKEY,
  });

  return {
    listingId,
    name: 'example',
    price: 100_000_000,
    sellerAddr: SELLER_ADDR,
    sellerPubKey: SELLER_PUBKEY,
    contact: 'seller@example.com',
    verified: true,
    signature: 'seller-signature',
    signedMessage,
    payloadVersion: 2,
    escrowArbiterPubKey: ARBITER_PUBKEY,
    status: 'active',
    createdAt: CREATED,
    updatedAt: CREATED,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function makeEscrowIntent(
  listing: MarketplaceListing,
  overrides: Partial<PurchaseIntent> = {},
): PurchaseIntent {
  const address = escrowAddress(
    buildEscrowRedeemScript(BUYER_PUBKEY, SELLER_PUBKEY, ARBITER_PUBKEY),
    'main',
  );
  return {
    intentId: `${BUYER_PUBKEY}:${listing.listingId}:${BUYER_ADDR}`,
    listingId: listing.listingId,
    name: listing.name,
    price: listing.price,
    buyerAddr: BUYER_ADDR,
    sellerAddr: listing.sellerAddr,
    buyerPubKey: BUYER_PUBKEY,
    sellerPubKey: SELLER_PUBKEY,
    status: 'pending',
    createdAt: CREATED,
    updatedAt: CREATED,
    escrow: {
      address,
      arbiterPubKey: ARBITER_PUBKEY,
      amount: listing.price + ESCROW_FEE_BUFFER,
      state: 'created',
    },
    ...overrides,
  };
}

function makePaidEscrowListing(
  overrides: Partial<MarketplaceListing> = {},
): MarketplaceListing {
  const listingId = getListingId(SELLER_PUBKEY, 'example');
  const signedMessage = buildListingPayload({
    listingId,
    name: 'example',
    price: 100_000_000,
    sellerAddr: SELLER_ADDR,
    sellerPubKey: SELLER_PUBKEY,
    contact: 'seller@example.com',
    createdAt: CREATED,
    expiresAt: EXPIRES,
    payloadVersion: 3,
    escrowArbiterPubKey: ARBITER_PUBKEY,
    escrowArbiterPayoutAddress: ARBITER_PAYOUT_ADDR,
    escrowArbiterFee: MARKETPLACE_ARBITER_FEE,
  });

  return {
    ...makeEscrowListing(),
    signedMessage,
    payloadVersion: 3,
    escrowArbiterPayoutAddress: ARBITER_PAYOUT_ADDR,
    escrowArbiterFee: MARKETPLACE_ARBITER_FEE,
    ...overrides,
  };
}

function makePaidEscrowIntent(
  listing: MarketplaceListing,
  overrides: Partial<PurchaseIntent> = {},
): PurchaseIntent {
  const base = makeEscrowIntent(listing);
  return {
    ...base,
    ...overrides,
    escrow: {
      ...base.escrow!,
      arbiterPayoutAddress: ARBITER_PAYOUT_ADDR,
      arbiterFee: MARKETPLACE_ARBITER_FEE,
      amount: listing.price + MARKETPLACE_ARBITER_FEE + ESCROW_FEE_BUFFER,
      ...(overrides.escrow || {}),
    },
  };
}

function makeHarness(options: {
  ourPubKey: string;
  sign?: (name: string, message: string, passphrase: string) => Promise<string>;
  nameInfo?: Record<string, unknown>;
  signatureValid?: boolean;
  ownerAddress?: string;
  transferOutputs?: Array<Record<string, unknown>>;
}) {
  const listings: MarketplaceListing[] = [];
  const intents: PurchaseIntent[] = [];
  const settings: Record<string, string> = {};

  const db = {
    getMarketplaceListings: () => listings,
    saveMarketplaceListing: (listing: MarketplaceListing) => {
      const idx = listings.findIndex(l => l.name === listing.name);
      if (idx >= 0) listings[idx] = listing;
      else listings.push(listing);
    },
    removeMarketplaceListing: (name: string) => {
      const idx = listings.findIndex(l => l.name === name);
      if (idx >= 0) listings.splice(idx, 1);
    },
    getPurchaseIntents: () => intents,
    savePurchaseIntent: (intent: PurchaseIntent) => {
      const idx = intents.findIndex(i => i.intentId && i.intentId === intent.intentId);
      if (idx >= 0) intents[idx] = intent;
      else intents.push(intent);
    },
    removePurchaseIntent: (name: string, buyerAddr: string) => {
      const idx = intents.findIndex(i => i.name === name && i.buyerAddr === buyerAddr);
      if (idx >= 0) intents.splice(idx, 1);
    },
    getSetting: (key: string) => settings[key],
  } as unknown as DBService;

  let nameInfo = options.nameInfo ?? { state: 'CLOSED', owner: { hash: '00', index: 0 } };
  let signatureValid = options.signatureValid ?? true;
  let ownerAddress = options.ownerAddress ?? SELLER_ADDR;

  const execute = vi.fn(async (method: string, args: unknown[]) => {
    switch (method) {
      case 'getnameinfo':
        return { info: nameInfo };
      case 'verifymessagewithname':
        return signatureValid;
      case 'getcoin':
        return { address: ownerAddress };
      default:
        throw new Error(`Unexpected node RPC: ${method} (${String(args[0])})`);
    }
  });

  const nodeClient = {
    execute,
    getInfo: vi.fn(async () => ({
      network: 'main',
      chain: { height: 1000 },
    })),
  };

  const connectionService = {
    getClients: () => ({ nodeClient, walletClient: {} }),
  } as unknown as HSDConnectionService;

  let receivedIntents: PurchaseIntent[] = [];
  const signMessageWithName = vi.fn(options.sign ?? (async () => 'seller-signature'));
  let transaction: Record<string, unknown> = {
    outputs: options.transferOutputs ?? [
      { address: BUYER_ADDR, covenant: { action: 'TRANSFER' } },
    ],
  };
  const getTransaction = vi.fn(async () => transaction);

  const walletService = {
    getAddress: vi.fn(async () => ({ address: SELLER_ADDR })),
    signMessageWithName,
    getTransaction,
    getTxHistory: vi.fn(async () => []),
    sendToAddress: vi.fn(async () => ({ hash: 'pay-tx', fee: 12_345 })),
    sendTransfer: vi.fn(async () => ({ hash: 'transfer-tx' })),
    sendFinalize: vi.fn(async () => ({ hash: 'finalize-tx' })),
    broadcastTx: vi.fn(async () => 'broadcast-tx'),
  } as unknown as WalletService;

  const nostrService = {
    publicKey: options.ourPubKey,
    relays: ['wss://relay.example'],
    setRelays: vi.fn(),
    getListings: vi.fn(async () => []),
    getPurchaseIntents: vi.fn(async () => receivedIntents.map((intent) => ({
      intent,
      eventPubkey: intent.sellerPubKey || intent.buyerPubKey || '',
      eventId: `event-${intent.intentId || intent.name}`,
      createdAt: Date.now(),
    }))),
    publishListing: vi.fn(async () => {}),
    publishPurchaseIntent: vi.fn(async () => {}),
    cancelListing: vi.fn(async () => {}),
    markAsSold: vi.fn(async () => {}),
    signEscrowPsbt: vi.fn((psbt: string, network: 'main' | 'testnet' | 'regtest') =>
      signEscrowPsbtWithKey(
        psbt,
        secretForPubkey(options.ourPubKey),
        options.ourPubKey,
        network,
      )),
  } as unknown as NostrMarketplaceService;

  const service = new MarketplaceService(
    walletService,
    connectionService,
    db,
    nostrService,
  );

  return {
    service,
    db,
    listings,
    intents,
    nodeClient,
    walletService,
    nostrService,
    signMessageWithName,
    execute,
    setSignatureValid: (value: boolean) => { signatureValid = value; },
    setNameInfo: (value: Record<string, unknown>) => { nameInfo = value; },
    setOwnerAddress: (value: string) => { ownerAddress = value; },
    setTransaction: (value: Record<string, unknown>) => { transaction = value; },
    setSetting: (key: string, value: string) => { settings[key] = value; },
    setReceivedIntents: (value: PurchaseIntent[]) => { receivedIntents = value; },
  };
}

describe('MarketplaceService', () => {
  it('creates a listing with the seller address auto-detected and all terms signed', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });

    const listing = await h.service.createListing(
      { name: 'example', price: 100, sellerAddr: '' },
      'secret',
    );

    expect(listing.price).toBe(100_000_000);
    expect(listing.sellerAddr).toBe(SELLER_ADDR);
    expect(listing.sellerPubKey).toBe(SELLER_PUBKEY);
    expect(listing.listingId).toBe(`${SELLER_PUBKEY}:example`);
    expect(listing.expiresAt).toBeTruthy();
    expect(listing.signature).toBe('seller-signature');
    expect(listing.signedMessage).toContain('"price":100000000');
    expect(listing.signedMessage).toContain(`"sellerAddr":"${SELLER_ADDR}"`);
    expect(h.signMessageWithName).toHaveBeenCalledWith(
      'example',
      listing.signedMessage,
      'secret',
    );
    expect(h.nostrService.publishListing).toHaveBeenCalledWith(listing);
  });

  it('rejects a zero or invalid price before publishing', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });

    await expect(
      h.service.createListing({ name: 'example', price: 0, sellerAddr: '' }, ''),
    ).rejects.toThrow(/price/i);

    expect(h.nostrService.publishListing).not.toHaveBeenCalled();
  });

  it('routes a purchase request to the seller with both Nostr pubkeys', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const listing = makeListing();

    const intent = await h.service.requestPurchase(listing, BUYER_ADDR);

    expect(intent.intentId).toBeTruthy();
    expect(intent.intentId).not.toContain(BUYER_ADDR);
    expect(intent.listingId).toBe(listing.listingId);
    expect(intent.sellerPubKey).toBe(SELLER_PUBKEY);
    expect(intent.buyerPubKey).toBe(BUYER_PUBKEY);
    expect(intent.sellerAddr).toBe(SELLER_ADDR);
    expect(intent.buyerAddr).toBe(BUYER_ADDR);
    expect(intent.status).toBe('pending');
    expect(h.intents).toHaveLength(1);
    expect(h.nostrService.publishPurchaseIntent).toHaveBeenCalledWith(intent);
  });

  it('refuses a listing whose signed terms were changed', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const listing = makeListing({ price: 1 });

    await expect(
      h.service.requestPurchase(listing, BUYER_ADDR),
    ).rejects.toThrow(/terms/i);

    expect(h.nostrService.publishPurchaseIntent).not.toHaveBeenCalled();
  });

  it('refuses a listing with an invalid ownership proof', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY, signatureValid: false });

    await expect(
      h.service.requestPurchase(makeListing(), BUYER_ADDR),
    ).rejects.toThrow(/proof/i);

    expect(h.nostrService.publishPurchaseIntent).not.toHaveBeenCalled();
  });

  it('refuses an invalid buyer address', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });

    await expect(
      h.service.requestPurchase(makeListing(), 'not-an-address'),
    ).rejects.toThrow(/address/i);
  });

  it('detects a transfer and computes the remaining lockup', async () => {
    const h = makeHarness({
      ourPubKey: BUYER_PUBKEY,
      nameInfo: { state: 'TRANSFER', transfer: 900, owner: { hash: '00', index: 0 } },
    });

    const status = await h.service.checkTransferStatus(
      'example',
      BUYER_ADDR,
      'transfer-tx',
    );

    expect(status.transferred).toBe(true);
    expect(status.transferTxHash).toBe('transfer-tx');
    expect(status.transferHeight).toBe(900);
    expect(status.blocksRemaining).toBe(188); // 900 + 288 - 1000
  });

  it('reports a finalized name when the current owner is the buyer', async () => {
    const h = makeHarness({
      ourPubKey: BUYER_PUBKEY,
      nameInfo: { state: 'CLOSED', transfer: 900, owner: { hash: '00', index: 0 } },
      ownerAddress: BUYER_ADDR,
    });

    const status = await h.service.checkTransferStatus('example', BUYER_ADDR);

    expect(status.finalized).toBe(true);
    expect(status.cancelled).toBe(false);
  });

  it('does not report a normal CLOSED name as a cancelled transfer', async () => {
    const h = makeHarness({
      ourPubKey: BUYER_PUBKEY,
      nameInfo: { state: 'CLOSED', transfer: 900, owner: { hash: '00', index: 0 } },
    });
    h.setOwnerAddress(SELLER_ADDR);
    h.setTransaction({
      outputs: [{ address: BUYER_ADDR, covenant: { action: 'TRANSFER' } }],
      // No height/confirmations: the seller's transfer is still pending.
    });

    const status = await h.service.checkTransferStatus(
      'example',
      BUYER_ADDR,
      'transfer-tx',
    );

    expect(status.transferred).toBe(false);
    expect(status.cancelled).toBe(false);
    expect(status.finalized).toBe(false);
  });

  it('reports a cancelled transfer only after the transfer was confirmed', async () => {
    const h = makeHarness({
      ourPubKey: BUYER_PUBKEY,
      nameInfo: { state: 'CLOSED', transfer: 900, owner: { hash: '00', index: 0 } },
    });
    h.setOwnerAddress(SELLER_ADDR);
    h.setTransaction({
      outputs: [{ address: BUYER_ADDR, covenant: { action: 'TRANSFER' } }],
      height: 900,
      confirmations: 2,
    });

    const status = await h.service.checkTransferStatus(
      'example',
      BUYER_ADDR,
      'transfer-tx',
    );

    expect(status.transferred).toBe(false);
    expect(status.cancelled).toBe(true);
  });

  it('waits instead of claiming cancellation when Pay seller is clicked early', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const intent = await h.service.requestPurchase(makeListing(), BUYER_ADDR);
    intent.status = 'transferred';
    intent.transferTxHash = 'transfer-tx';

    await expect(
      h.service.confirmAndPay(intent.intentId!, 'secret'),
    ).rejects.toThrow(/not been detected/i);
    expect(h.walletService.sendToAddress).not.toHaveBeenCalled();
  });

  it('allows payment after the buyer already finalized the name', async () => {
    const h = makeHarness({
      ourPubKey: BUYER_PUBKEY,
      nameInfo: { state: 'CLOSED', transfer: 900, owner: { hash: '00', index: 0 } },
      ownerAddress: BUYER_ADDR,
    });
    const intent = await h.service.requestPurchase(makeListing(), BUYER_ADDR);
    intent.status = 'transferred';
    intent.transferTxHash = 'transfer-tx';

    const result = await h.service.confirmAndPay(intent.intentId!, 'secret');

    expect(result.txHash).toBe('pay-tx');
    expect(h.walletService.sendToAddress).toHaveBeenCalledWith(
      SELLER_ADDR,
      100_000_000,
      'secret',
      { subtractFee: false },
    );
  });

  it('renews and reprices a listing with a new signed payload', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    const listing = makeListing();
    h.listings.push(listing);

    const updated = await h.service.republishListing('example', 250, 'secret');

    expect(updated.price).toBe(250_000_000);
    expect(new Date(updated.expiresAt!).getTime()).toBeGreaterThan(
      new Date(listing.expiresAt!).getTime(),
    );
    expect(updated.signature).toBe('seller-signature');
    expect(updated.signedMessage).toContain('"price":250000000');
    expect(updated.listingId).toBe(listing.listingId);
    expect(h.nostrService.publishListing).toHaveBeenCalledWith(updated);
  });

  it('refuses to republish with an invalid price', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    h.listings.push(makeListing());

    await expect(
      h.service.republishListing('example', 0, 'secret'),
    ).rejects.toThrow(/price/i);

    expect(h.nostrService.publishListing).not.toHaveBeenCalled();
  });

  it('refuses to approve a request whose price was tampered down', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    const listing = makeListing();
    h.listings.push(listing);

    const intent: PurchaseIntent = {
      intentId: `${BUYER_PUBKEY}:${listing.listingId}:${BUYER_ADDR}`,
      listingId: listing.listingId,
      name: listing.name,
      price: 1,
      buyerAddr: BUYER_ADDR,
      sellerAddr: SELLER_ADDR,
      buyerPubKey: BUYER_PUBKEY,
      sellerPubKey: SELLER_PUBKEY,
      status: 'pending',
      createdAt: CREATED,
      updatedAt: CREATED,
    };
    h.intents.push(intent);

    await expect(
      h.service.approvePurchase('example', BUYER_ADDR, 'secret'),
    ).rejects.toThrow(/price/i);

    expect(h.walletService.sendTransfer).not.toHaveBeenCalled();
  });

  it('pays the seller the full price with subtractFee disabled', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const listing = makeListing();
    const intent = await h.service.requestPurchase(listing, BUYER_ADDR);

    // The seller approves after the request: the name is now transferring.
    h.setNameInfo({ state: 'TRANSFER', transfer: 900, owner: { hash: '00', index: 0 } });
    intent.status = 'transferred';
    intent.transferTxHash = 'transfer-tx';

    const result = await h.service.confirmAndPay(intent.intentId!, 'secret');

    expect(h.walletService.sendToAddress).toHaveBeenCalledWith(
      SELLER_ADDR,
      100_000_000,
      'secret',
      { subtractFee: false },
    );
    expect(result.txHash).toBe('pay-tx');
    expect(result.fee).toBe(12_345);
  });

  it('creates a v3 paid-escrow listing with the configured arbiter', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    h.setSetting('marketplaceEscrowArbiter', ARBITER_PUBKEY);
    h.setSetting('marketplaceEscrowArbiterPayoutAddress', ARBITER_PAYOUT_ADDR);

    const listing = await h.service.createListing(
      { name: 'example', price: 100, sellerAddr: '' },
      'secret',
    );

    expect(listing.payloadVersion).toBe(3);
    expect(listing.escrowArbiterPubKey).toBe(ARBITER_PUBKEY);
    expect(listing.escrowArbiterPayoutAddress).toBe(ARBITER_PAYOUT_ADDR);
    expect(listing.escrowArbiterFee).toBe(MARKETPLACE_ARBITER_FEE);
    expect(listing.signedMessage).toContain('"v":3');
    expect(listing.signedMessage).toContain(
      `"escrowArbiterPubKey":"${ARBITER_PUBKEY}"`,
    );
    expect(listing.signedMessage).toContain(
      `"escrowArbiterPayoutAddress":"${ARBITER_PAYOUT_ADDR}"`,
    );
    expect(listing.signedMessage).toContain(
      `"escrowArbiterFee":${MARKETPLACE_ARBITER_FEE}`,
    );
  });

  it('requires an arbiter payout address for a paid escrow listing', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    h.setSetting('marketplaceEscrowArbiter', ARBITER_PUBKEY);

    await expect(
      h.service.createListing({ name: 'example', price: 100, sellerAddr: '' }, 'secret'),
    ).rejects.toThrow(/payout address/i);

    expect(h.nostrService.publishListing).not.toHaveBeenCalled();
  });

  it('rejects an invalid escrow arbiter setting before listing', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    h.setSetting('marketplaceEscrowArbiter', 'not-a-pubkey');

    await expect(
      h.service.createListing({ name: 'example', price: 100, sellerAddr: '' }, 'secret'),
    ).rejects.toThrow(/arbiter/i);

    expect(h.nostrService.publishListing).not.toHaveBeenCalled();
  });

  it('rejects an escrow arbiter that is not a valid secp256k1 key', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    h.setSetting('marketplaceEscrowArbiter', '11'.repeat(32));

    await expect(
      h.service.createListing({ name: 'example', price: 100, sellerAddr: '' }, 'secret'),
    ).rejects.toThrow(/secp256k1/i);

    expect(h.nostrService.publishListing).not.toHaveBeenCalled();
  });

  it('rejects the seller as its own escrow arbiter', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    h.setSetting('marketplaceEscrowArbiter', SELLER_PUBKEY);

    await expect(
      h.service.createListing({ name: 'example', price: 100, sellerAddr: '' }, 'secret'),
    ).rejects.toThrow(/independent/i);

    expect(h.nostrService.publishListing).not.toHaveBeenCalled();
  });

  it('routes an escrow purchase to the derived 2-of-3 address and fee buffer', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const listing = makeEscrowListing();

    const intent = await h.service.requestPurchase(listing, BUYER_ADDR, true);
    const expectedAddress = escrowAddress(
      buildEscrowRedeemScript(BUYER_PUBKEY, SELLER_PUBKEY, ARBITER_PUBKEY),
      'main',
    );

    expect(intent.escrow).toBeDefined();
    expect(intent.escrow?.address).toBe(expectedAddress);
    expect(intent.escrow?.arbiterPubKey).toBe(ARBITER_PUBKEY);
    expect(intent.escrow?.amount).toBe(listing.price + ESCROW_FEE_BUFFER);
    expect(intent.escrow?.state).toBe('created');
  });

  it('routes a paid arbiter escrow with the fee and payout address', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const listing = makePaidEscrowListing();

    const intent = await h.service.requestPurchase(listing, BUYER_ADDR, true);

    expect(intent.escrow?.arbiterPayoutAddress).toBe(ARBITER_PAYOUT_ADDR);
    expect(intent.escrow?.arbiterFee).toBe(MARKETPLACE_ARBITER_FEE);
    expect(intent.escrow?.amount).toBe(
      listing.price + MARKETPLACE_ARBITER_FEE + ESCROW_FEE_BUFFER,
    );
  });

  it('pays the seller and refunds the arbitration fee on a normal release', async () => {
    const h = makeHarness({
      ourPubKey: SELLER_PUBKEY,
      ownerAddress: BUYER_ADDR,
      nameInfo: {
        state: 'CLOSED',
        transfer: 900,
        owner: { hash: '00', index: 0 },
      },
    });
    const listing = makePaidEscrowListing();
    h.listings.push(listing);
    const intent = makePaidEscrowIntent(listing, {
      status: 'sold',
      transferTxHash: 'transfer-tx',
      escrow: {
        ...makePaidEscrowIntent(listing).escrow!,
        state: 'funded',
        fundingTxHash: '66'.repeat(32),
      },
    });
    h.intents.push(intent);
    h.setTransaction({
      outputs: [{ address: intent.escrow?.address, value: intent.escrow?.amount }],
      height: 999,
      confirmations: 1,
    });

    const { psbt } = await h.service.createEscrowRelease(intent.intentId!);
    const parsed = parseEscrowPsbt(psbt);

    expect(parsed.outputs).toHaveLength(2);
    expect(parsed.outputs[0]).toEqual({ address: SELLER_ADDR, value: listing.price });
    expect(parsed.outputs[1]).toEqual({ address: BUYER_ADDR, value: MARKETPLACE_ARBITER_FEE });
  });

  it('co-signs and broadcasts the fee-refund release', async () => {
    const seller = makeHarness({
      ourPubKey: SELLER_PUBKEY,
      ownerAddress: BUYER_ADDR,
      nameInfo: {
        state: 'CLOSED',
        transfer: 900,
        owner: { hash: '00', index: 0 },
      },
    });
    const listing = makePaidEscrowListing();
    seller.listings.push(listing);
    const intent = makePaidEscrowIntent(listing, {
      status: 'sold',
      transferTxHash: 'transfer-tx',
      escrow: {
        ...makePaidEscrowIntent(listing).escrow!,
        state: 'funded',
        fundingTxHash: '66'.repeat(32),
      },
    });
    seller.intents.push(intent);
    const fundingOutputs = [
      { address: intent.escrow?.address, value: intent.escrow?.amount },
    ];
    seller.setTransaction({ outputs: fundingOutputs, height: 999, confirmations: 1 });

    const { psbt } = await seller.service.createEscrowRelease(intent.intentId!);

    const buyer = makeHarness({
      ourPubKey: BUYER_PUBKEY,
      ownerAddress: BUYER_ADDR,
      nameInfo: {
        state: 'CLOSED',
        transfer: 900,
        owner: { hash: '00', index: 0 },
      },
    });
    buyer.intents.push({
      ...intent,
      escrow: {
        ...intent.escrow!,
        releasePsbt: psbt,
        releaseRole: 'seller',
      },
    });
    buyer.setTransaction({ outputs: fundingOutputs, height: 999, confirmations: 1 });

    const result = await buyer.service.signEscrowRelease(intent.intentId!);

    expect(result.txId).toBe('broadcast-tx');
    expect(buyer.walletService.broadcastTx).toHaveBeenCalledTimes(1);
    expect(buyer.intents[0].escrow?.state).toBe('released');
    expect(buyer.intents[0].escrow?.releaseTxHash).toBe('broadcast-tx');
  });

  it('pays the buyer and the arbiter fee on a refund PSBT', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const listing = makePaidEscrowListing();
    const intent = makePaidEscrowIntent(listing, {
      status: 'transferred',
      transferTxHash: 'transfer-tx',
      escrow: {
        ...makePaidEscrowIntent(listing).escrow!,
        state: 'funded',
        fundingTxHash: '66'.repeat(32),
      },
    });
    h.intents.push(intent);
    h.setTransaction({
      outputs: [{ address: intent.escrow?.address, value: intent.escrow?.amount }],
      height: 999,
      confirmations: 1,
    });

    const { psbt, kind } = await h.service.createEscrowDisputePsbt(
      intent.intentId!,
      'refund',
    );
    const parsed = parseEscrowPsbt(psbt);

    expect(kind).toBe('refund');
    expect(parsed.outputs).toHaveLength(2);
    expect(parsed.outputs[0]).toEqual({ address: BUYER_ADDR, value: listing.price });
    expect(parsed.outputs[1]).toEqual({
      address: ARBITER_PAYOUT_ADDR,
      value: MARKETPLACE_ARBITER_FEE,
    });
  });

  it('imports an arbiter signature and broadcasts a refund', async () => {
    const h = makeHarness({
      ourPubKey: BUYER_PUBKEY,
      nameInfo: {
        state: 'TRANSFER',
        transfer: 900,
        owner: { hash: '00', index: 0 },
      },
    });
    const listing = makePaidEscrowListing();
    const intent = makePaidEscrowIntent(listing, {
      status: 'transferred',
      transferTxHash: 'transfer-tx',
      escrow: {
        ...makePaidEscrowIntent(listing).escrow!,
        state: 'funded',
        fundingTxHash: '66'.repeat(32),
      },
    });
    h.intents.push(intent);
    h.setTransaction({
      outputs: [{ address: intent.escrow?.address, value: intent.escrow?.amount }],
      height: 999,
      confirmations: 1,
    });

    const { psbt } = await h.service.createEscrowDisputePsbt(
      intent.intentId!,
      'refund',
    );
    const arbiterSigned = signEscrowPsbtWithKey(
      psbt,
      ARBITER_SECRET,
      ARBITER_PUBKEY,
      'main',
    );

    const result = await h.service.importEscrowArbiterPsbt(
      intent.intentId!,
      arbiterSigned,
    );

    expect(result.txId).toBe('broadcast-tx');
    expect(h.walletService.broadcastTx).toHaveBeenCalledTimes(1);
    expect(h.intents[0].escrow?.state).toBe('refunded');
    expect(h.intents[0].status).toBe('cancelled');
    expect(h.intents[0].escrow?.refundTxHash).toBe('broadcast-tx');
  });

  it('blocks seller approval until escrow funding is confirmed', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    const listing = makeEscrowListing();
    h.listings.push(listing);
    const intent = makeEscrowIntent(listing);
    intent.escrow!.fundingTxHash = 'funding-tx';
    intent.escrow!.state = 'funded';
    h.intents.push(intent);

    await expect(
      h.service.approvePurchase('example', BUYER_ADDR, 'secret'),
    ).rejects.toThrow(/funding/i);
    expect(h.walletService.sendTransfer).not.toHaveBeenCalled();

    h.setTransaction({
      outputs: [{ address: intent.escrow?.address, value: intent.escrow?.amount }],
      height: 999,
      confirmations: 1,
    });

    await expect(
      h.service.approvePurchase('example', BUYER_ADDR, 'secret'),
    ).resolves.toEqual({ txHash: 'transfer-tx' });
    expect(h.walletService.sendTransfer).toHaveBeenCalledWith(
      'example',
      BUYER_ADDR,
      'secret',
    );
  });

  it('refuses direct payment for an escrow trade', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const listing = makeEscrowListing();
    const intent = await h.service.requestPurchase(listing, BUYER_ADDR, true);

    h.setNameInfo({
      state: 'TRANSFER',
      transfer: 900,
      owner: { hash: '00', index: 0 },
    });
    intent.status = 'transferred';
    intent.transferTxHash = 'transfer-tx';

    await expect(
      h.service.confirmAndPay(intent.intentId!, 'secret'),
    ).rejects.toThrow(/escrow/i);
    expect(h.walletService.sendToAddress).not.toHaveBeenCalled();
  });

  it('refuses to sign an escrow release before the name is finalized', async () => {
    const h = makeHarness({ ourPubKey: BUYER_PUBKEY });
    const listing = makeEscrowListing();
    const intent = makeEscrowIntent(listing, {
      status: 'sold',
      escrow: {
        ...makeEscrowIntent(listing).escrow!,
        state: 'funded',
        fundingTxHash: 'funding-tx',
        releasePsbt: 'not-a-real-psbt',
        releaseRole: 'seller',
      },
    });
    h.intents.push(intent);

    await expect(
      h.service.signEscrowRelease(intent.intentId!),
    ).rejects.toThrow(/finalized/i);
    expect(h.walletService.broadcastTx).not.toHaveBeenCalled();
  });

  it('does not let a newer intent downgrade or replace escrow terms', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    const listing = makeEscrowListing();
    h.listings.push(listing);
    const existing = makeEscrowIntent(listing, {
      status: 'transferred',
      escrow: {
        ...makeEscrowIntent(listing).escrow!,
        state: 'funded',
        fundingTxHash: 'funding-tx',
      },
    });
    h.intents.push(existing);

    const tampered: PurchaseIntent = {
      ...existing,
      price: 1,
      sellerAddr: BUYER_ADDR,
      status: 'pending',
      updatedAt: '2026-10-25T10:05:00.000Z',
      escrow: {
        address: makeAddress(9),
        arbiterPubKey: ARBITER_PUBKEY,
        amount: 1,
        state: 'created',
      },
    };
    h.setReceivedIntents([tampered]);

    const [merged] = await h.service.getPurchaseRequests();

    expect(merged.price).toBe(listing.price);
    expect(merged.sellerAddr).toBe(listing.sellerAddr);
    expect(merged.status).toBe('transferred');
    expect(merged.escrow?.address).toBe(existing.escrow?.address);
    expect(merged.escrow?.amount).toBe(existing.escrow?.amount);
    expect(merged.escrow?.fundingTxHash).toBe('funding-tx');
    expect(merged.escrow?.state).toBe('funded');
  });

  it('does not let a newer intent strip escrow from a funded trade', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    const listing = makeEscrowListing();
    h.listings.push(listing);
    const existing = makeEscrowIntent(listing, {
      status: 'transferred',
      escrow: {
        ...makeEscrowIntent(listing).escrow!,
        state: 'funded',
        fundingTxHash: 'funding-tx',
      },
    });
    h.intents.push(existing);

    const stripped: PurchaseIntent = {
      ...existing,
      price: listing.price,
      status: 'pending',
      updatedAt: '2026-10-25T10:06:00.000Z',
    };
    delete stripped.escrow;
    h.setReceivedIntents([stripped]);

    const [merged] = await h.service.getPurchaseRequests();

    expect(merged.escrow?.address).toBe(existing.escrow?.address);
    expect(merged.escrow?.amount).toBe(existing.escrow?.amount);
    expect(merged.escrow?.fundingTxHash).toBe('funding-tx');
    expect(merged.status).toBe('transferred');
  });

  it('refuses seller escrow actions when the payout address was tampered with', async () => {
    const h = makeHarness({ ourPubKey: SELLER_PUBKEY });
    const listing = makeEscrowListing();
    h.listings.push(listing);
    const intent = makeEscrowIntent(listing, {
      sellerAddr: BUYER_ADDR,
      escrow: {
        address: makeEscrowIntent(listing).escrow!.address,
        arbiterPubKey: ARBITER_PUBKEY,
        amount: listing.price + ESCROW_FEE_BUFFER,
        state: 'funded',
      },
    });
    h.intents.push(intent);

    await expect(
      h.service.createEscrowRelease(intent.intentId!),
    ).rejects.toThrow(/payout address|signed listing/i);
    expect(h.nostrService.signEscrowPsbt).not.toHaveBeenCalled();
  });
});
