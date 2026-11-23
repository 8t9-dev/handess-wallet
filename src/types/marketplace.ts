export type ListingStatus = 'active' | 'pending' | 'sold' | 'cancelled';

export type PurchaseIntentStatus =
  | 'pending'
  | 'transferred'
  | 'paid'
  | 'sold'
  | 'cancelled';

export interface EscrowInfo {
  /** 2-of-3 P2WSH escrow address. */
  address: string;
  /** Independent arbiter's Nostr public key. */
  arbiterPubKey: string;
  /** Arbiter's HNS payout address for a dispute fee (v3 listings). */
  arbiterPayoutAddress?: string;
  /** Dispute-only arbiter fee in dollarydoos. Zero for legacy v2 escrow. */
  arbiterFee?: number;
  /** Amount held in escrow, in dollarydoos (price + arbiter fee + fee buffer). */
  amount: number;
  state: 'created' | 'funded' | 'released' | 'refunded' | 'disputed';
  fundingTxHash?: string;
  releaseTxHash?: string;
  refundTxHash?: string;
  /** Partially signed release PSBT, encrypted in the intent. */
  releasePsbt?: string;
  /** Buyer or seller who produced the release PSBT. */
  releaseRole?: 'buyer' | 'seller';
  /** Partially signed refund/dispute PSBT for the arbiter. */
  disputePsbt?: string;
  disputeKind?: 'refund' | 'release';
}

export interface MarketplaceListing {
  /** Stable listing identity: `${sellerPubKey}:${name}`. */
  listingId?: string;
  name: string;
  /** Price in dollarydoos (1 HNS = 1,000,000). */
  price: number;
  sellerAddr: string;
  /** Seller's Nostr public key. Required for new listings. */
  sellerPubKey?: string;
  contact?: string;
  /** Whether the full-terms ownership proof was generated. */
  verified: boolean;
  /** Base64 signature over the canonical listing payload. */
  signature?: string;
  /** Exact canonical payload that was signed. */
  signedMessage?: string;
  /** Canonical payload version. v2 adds escrow metadata. */
  payloadVersion?: number;
  /** Seller-selected independent escrow arbiter. */
  escrowArbiterPubKey?: string;
  /** Arbiter HNS payout address for the dispute-only fee (v3). */
  escrowArbiterPayoutAddress?: string;
  /** Dispute-only arbiter fee in dollarydoos (v3). */
  escrowArbiterFee?: number;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp after which the listing must not be shown. */
  expiresAt?: string;
  /** Nostr event id, when known. */
  eventId?: string;
}

export interface CreateListingInput {
  name: string;
  price: number;
  sellerAddr?: string;
}

export interface PurchaseRequest {
  name: string;
  sellerAddr: string;
  price: number;
  passphrase: string;
  buyerAddr?: string;
}

export interface PurchaseIntent {
  /** Stable intent identity, shared by buyer and seller status events. */
  intentId?: string;
  /** Listing this intent belongs to. */
  listingId?: string;
  name: string;
  /** Price in dollarydoos. */
  price: number;
  buyerAddr: string;
  sellerAddr: string;
  /** Nostr public keys used for event routing/verification. */
  buyerPubKey?: string;
  sellerPubKey?: string;
  status: PurchaseIntentStatus;
  createdAt: string;
  updatedAt: string;
  /** Seller's on-chain transfer transaction. */
  transferTxHash?: string;
  /** Height of the transfer transaction. */
  transferHeight?: number;
  /** Buyer's payment transaction. */
  paymentTxHash?: string;
  /** Buyer's finalize transaction. */
  finalizeTxHash?: string;
  /** Optional 2-of-3 escrow details. */
  escrow?: EscrowInfo;
}

export interface RelayHealth {
  url: string;
  ok: boolean;
  error?: string;
}

export interface TransferStatus {
  /** A transfer to the buyer address exists on-chain. */
  transferred: boolean;
  /** The seller cancelled the transfer. */
  cancelled: boolean;
  /** The buyer has finalized the name. */
  finalized: boolean;
  transferTxHash?: string;
  transferHeight?: number;
  /** Blocks left before finalize is allowed. */
  blocksRemaining?: number;
  /** Rough wall-clock estimate for the remaining lockup. */
  estimatedMinutesRemaining?: number;
}
