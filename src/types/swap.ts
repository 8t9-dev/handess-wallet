export type DgbNetworkType = 'mainnet' | 'testnet';

export interface DgbServerConfig {
  host: string;
  port: number;
  ssl: boolean;
  network: DgbNetworkType;
}

export interface DgbBalance {
  confirmed: number;
  unconfirmed: number;
}

export interface DgbUtxo {
  txHash: string;
  vout: number;
  value: number;
  height: number;
  confirmations: number;
  address: string;
  scriptPubKey: string;
}

export interface SwapOffer {
  id: string;
  nostrPubkey: string;
  nostrEventId?: string;
  direction: 'hnsToDgb' | 'dgbToHns';
  hnsAmount: number;
  dgbAmount: number;
  exchangeRate: number;
  dgbAddress: string;
  /** Offerer's DGB public key for the HTLC claim path. */
  dgbPubKey: string;
  createdAt: number;
  expiresAt: number | null;
  status: 'active' | 'accepted' | 'cancelled' | 'completed';
}

export interface SwapAccept {
  offerId: string;
  nostrPubkey: string;
  nostrEventId?: string;
  dgbAddress: string;
  /** Acceptor's DGB public key for the HTLC refund path. */
  dgbPubKey: string;
  createdAt: number;
}

export type SwapState =
  | 'offered'
  | 'accepted'
  | 'terms_ready'
  | 'hns_funding'
  | 'hns_htlc_funded'
  | 'dgb_funding'
  | 'dgb_htlc_funded'
  | 'dgb_claimed'
  | 'secret_revealed'
  | 'hns_claimed'
  | 'completed'
  | 'refunding'
  | 'refunded'
  | 'failed';

/**
 * Terms are published by the HNS side after accepting. Amounts are in base
 * units: dollarydoos for HNS and satoshis for DGB.
 */
export interface SwapTerms {
  offerId: string;
  direction: 'hnsToDgb' | 'dgbToHns';
  initiatorPubkey: string;
  counterpartyPubkey: string;
  initiatorDgbPubKey: string;
  counterpartyDgbPubKey: string;
  secretHash: string;
  hnsTimeout: number;
  dgbTimeout: number;
  hnsHtlcAddress: string;
  hnsHtlcScript: string;
  dgbHtlcAddress: string;
  dgbHtlcScript: string;
  hnsAmount: number;
  dgbAmount: number;
  createdAt: number;
}

export interface SwapFunding {
  offerId: string;
  chain: 'hns' | 'dgb';
  txid: string;
  vout: number;
  /** Dollarydoos for HNS, satoshis for DGB. */
  amount: number;
  address: string;
  createdAt: number;
}

export interface SwapSecretReveal {
  offerId: string;
  secret: string;
  dgbClaimTxid: string;
  createdAt: number;
}

export interface SwapStatusMessage {
  offerId: string;
  status: 'dgb_claimed' | 'hns_claimed' | 'completed' | 'refunded';
  chain: 'hns' | 'dgb';
  txid?: string;
  createdAt: number;
}

export interface SwapTransaction {
  swapId: string;
  state: SwapState;
  chain: 'hns' | 'dgb';
  txHash: string;
  rawTx?: string;
  amount: number;
  htlcAddress?: string;
  createdAt: number;
}

export interface LocalSwap {
  id: string;
  offer: SwapOffer;
  state: SwapState;
  /** Whether this swap should auto-advance after the offer is accepted. */
  autoComplete?: boolean;
  secretHash?: string;
  /** Local only. Persist before broadcasting the HNS funding transaction. */
  secretHex?: string;
  /** Legacy field from the previous implementation. */
  encryptedSecret?: string;
  terms?: SwapTerms;
  hnsHtlcTxid?: string;
  hnsHtlcVout?: number;
  hnsHtlcValue?: number;
  hnsHtlcAddress?: string;
  hnsHtlcScript?: string;
  dgbHtlcTxid?: string;
  dgbHtlcVout?: number;
  dgbHtlcValue?: number;
  dgbHtlcAddress?: string;
  dgbHtlcScript?: string;
  hnsClaimTxid?: string;
  /** Destination HNS address used by the HNS claim transaction. */
  hnsClaimAddress?: string;
  /** Expected HNS output value of the claim. */
  hnsClaimValue?: number;
  /** Raw claim transaction, retained so a dropped claim can be rebroadcast. */
  hnsClaimTxHex?: string;
  hnsClaimBroadcastAt?: number;
  /** Whether the claim transaction is confirmed on the HNS chain. */
  hnsClaimConfirmed?: boolean;
  /** Whether the node can no longer find the broadcast claim transaction. */
  hnsClaimMissing?: boolean;
  dgbClaimTxid?: string;
  hnsRefundTxid?: string;
  dgbRefundTxid?: string;
  hnsClaimed?: boolean;
  dgbClaimed?: boolean;
  /** Whether the revealed secret has been published to the swap relays. */
  secretPublished?: boolean;
  hnsRefunded?: boolean;
  dgbRefunded?: boolean;
  hnsConfirmations?: number;
  dgbConfirmations?: number;
  hnsTimeout: number;
  dgbTimeout: number;
  role: 'initiator' | 'counterparty';
  counterpartyPubkey?: string;
  counterpartyDgbPubKey?: string;
  counterpartyDgbAddress?: string;
  initiatorDgbPubKey?: string;
  transactions: SwapTransaction[];
  createdAt: number;
  updatedAt: number;
}

export interface SecretData {
  secret: string;
  secretHash: string;
}
