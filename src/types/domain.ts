/**
 * Domain and Name type definitions for Handess Wallet.
 *
 * These types represent Handshake TLD data as returned by hsd APIs
 * and augmented with CRM-specific metadata (tags, notes).
 *
 * Reference: HSD_API_REFERENCE.md for raw API response shapes.
 */

// ============================================================
// Name States
// ============================================================

/**
 * Handshake name auction states.
 * Maps to hsd's name state strings returned by `getnameinfo`.
 */
export type NameState =
  | 'OPENING'    // Auction opened, waiting for bidding period (37 blocks)
  | 'BIDDING'    // Accepting bids (720 blocks / ~5 days)
  | 'REVEAL'     // Bid reveal phase (1,440 blocks / ~10 days)
  | 'CLOSED'     // Auction complete, name is registered
  | 'REVOKED'    // Name permanently revoked
  | 'TRANSFER'   // Name transfer in progress
  | 'EXPIRED';   // Name expired (renewal window passed) -- computed client-side

/**
 * Availability status for bulk search results.
 * Extends NameState with CRM-specific statuses.
 */
export type AvailabilityStatus =
  | 'AVAILABLE'     // Name not in trie, can be opened for auction
  | 'RESERVED'      // ICANN reserved name, cannot be auctioned
  | 'OPENING'
  | 'BIDDING'
  | 'REVEAL'
  | 'CLOSED'
  | 'REVOKED'
  | 'TRANSFER'
  | 'EXPIRED'
  | 'OWNED_BY_YOU'; // Owned by the connected wallet

// ============================================================
// Domain / Name Types
// ============================================================

/**
 * Core domain data as returned by hsd wallet API (`GET /wallet/:id/name/:name`)
 * combined with node API data (`getnameinfo`).
 */
export interface Domain {
  /** The TLD name (e.g., "example") */
  name: string;

  /** SHA3-256 hash of the name */
  nameHash: string;

  /** Current auction/ownership state */
  state: NameState;

  /** Block height when the name was first seen */
  height: number;

  /** Block height of the last renewal */
  renewalBlock: number;

  /** Computed: block height when name expires (renewalBlock + RENEWAL_WINDOW) */
  expiryBlock: number;

  /** Computed: estimated date of expiry based on current block height */
  expiryDate: Date | null;

  /** Owner output: transaction hash */
  ownerHash: string;

  /** Owner output: output index */
  ownerIndex: number;

  /** Value locked in the name (in dollarydoos) */
  value: number;

  /** Highest bid (in dollarydoos, if in auction) */
  highestBid: number;

  /** Current DNS resource records */
  dnsRecords: DNSRecord[];

  /** Whether a transfer is in progress */
  transferring: boolean;

  /** Block height when the transfer was initiated (0 = no pending transfer) */
  transferBlock: number;

  /** Whether the name has been revoked */
  revoked: boolean;

  /** Number of times the name has been renewed */
  renewals: number;

  /** Whether the name was claimed (ICANN/Alexa) vs. auctioned */
  claimed: boolean;

  /** Whether this is a weak name (short claim proof) */
  weak: boolean;
}

/**
 * Extended domain data with CRM-specific metadata.
 * This is what the UI works with -- Domain + local database enrichment.
 */
export interface DomainWithMeta extends Domain {
  /** User-assigned tags (from local SQLite) */
  tags: Tag[];

  /** User notes (from local SQLite) */
  notes: string;

  /** Expiry urgency category (computed) */
  expiryUrgency: 'critical' | 'warning' | 'notice' | 'safe';

  /** Whether this domain is selected in the UI table */
  selected?: boolean;
}

// ============================================================
// DNS Record Types
// ============================================================

/**
 * Handshake DNS resource record types.
 * Used with `sendupdate` / `createupdate` RPC.
 * See HSD_API_REFERENCE.md for full format spec.
 */
export type DNSRecordType = 'NS' | 'GLUE4' | 'GLUE6' | 'DS' | 'TXT' | 'SYNTH4' | 'SYNTH6';

/** Base DNS record with type discriminator */
export interface DNSRecordBase {
  type: DNSRecordType;
}

/** NS: Nameserver delegation */
export interface NSRecord extends DNSRecordBase {
  type: 'NS';
  /** Fully qualified nameserver hostname (with trailing dot) */
  ns: string;
}

/** GLUE4: Nameserver + IPv4 glue */
export interface Glue4Record extends DNSRecordBase {
  type: 'GLUE4';
  ns: string;
  address: string; // IPv4
}

/** GLUE6: Nameserver + IPv6 glue */
export interface Glue6Record extends DNSRecordBase {
  type: 'GLUE6';
  ns: string;
  address: string; // IPv6
}

/** DS: DNSSEC delegation signer */
export interface DSRecord extends DNSRecordBase {
  type: 'DS';
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
}

/** TXT: Text record */
export interface TXTRecord extends DNSRecordBase {
  type: 'TXT';
  txt: string[];
}

/** SYNTH4: Synthetic A record (direct IPv4) */
export interface Synth4Record extends DNSRecordBase {
  type: 'SYNTH4';
  address: string; // IPv4
}

/** SYNTH6: Synthetic AAAA record (direct IPv6) */
export interface Synth6Record extends DNSRecordBase {
  type: 'SYNTH6';
  address: string; // IPv6
}

/** Union of all DNS record types */
export type DNSRecord =
  | NSRecord
  | Glue4Record
  | Glue6Record
  | DSRecord
  | TXTRecord
  | Synth4Record
  | Synth6Record;

/** DNS resource object as sent to hsd */
export interface DNSResource {
  records: DNSRecord[];
}

// ============================================================
// Tags (CRM-specific, stored in local SQLite)
// ============================================================

export interface TagUpdate {
  name: string;
  tags: string[];
}

export interface TagUpdateResult {
  name: string;
  success: boolean;
  skipped: boolean;
  txid?: string;
  error?: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string; // Hex color, e.g., '#6366f1'
}

export interface DomainTag {
  domainName: string;
  tagId: number;
}

// ============================================================
// Sorting & Filtering
// ============================================================

/** Columns the domain table can be sorted by */
export type DomainSortField =
  | 'name'
  | 'state'
  | 'expiryBlock'
  | 'expiryDate'
  | 'renewalBlock'
  | 'value'
  | 'nameLength';

export type SortDirection = 'asc' | 'desc';

export interface DomainSort {
  field: DomainSortField;
  direction: SortDirection;
}

/** Filter criteria for the domain table */
export interface DomainFilters {
  /** Text search on domain name */
  searchText: string;

  /** Regex pattern match (optional, user-provided) */
  namePattern: string | null;

  /** Filter by state(s) -- empty means show all */
  states: NameState[];

  /** Filter by tag ID(s) -- local CRM tags, retained for compatibility */
  tagIds: number[];

  /** Filter by on-chain TXT tag name(s) -- empty means show all */
  tagNames: string[];

  /** Filter by expiry: only show names expiring within N blocks */
  expiryWithinBlocks: number | null;

  /** Filter by name length range */
  nameLengthMin: number | null;
  nameLengthMax: number | null;

  /** Show only untagged names */
  untaggedOnly: boolean;
}

/** Default empty filter state */
export const DEFAULT_DOMAIN_FILTERS: DomainFilters = {
  searchText: '',
  namePattern: null,
  states: [],
  tagIds: [],
  tagNames: [],
  expiryWithinBlocks: null,
  nameLengthMin: null,
  nameLengthMax: null,
  untaggedOnly: false,
};
