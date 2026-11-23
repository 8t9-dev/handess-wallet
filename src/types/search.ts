/**
 * Bulk search type definitions.
 *
 * The CRM supports searching large lists of names at once to check
 * availability, current state, and ownership. Results can be acted
 * upon in bulk (open auctions, place bids, etc.).
 *
 * Import methods: paste text, upload CSV, upload JSON.
 */

import type { AvailabilityStatus } from './domain';

// ============================================================
// Search Input Types
// ============================================================

/**
 * Supported import formats for bulk name search.
 */
export type ImportFormat = 'text' | 'csv' | 'json';

/**
 * A parsed and validated name input from the user.
 */
export interface ParsedNameInput {
  /** The original input string */
  original: string;

  /** The cleaned/normalized name (lowercase, trimmed) */
  normalized: string;

  /** Whether the name is valid for Handshake (alphanumeric + hyphens, <= 63 chars) */
  valid: boolean;

  /** Validation error message if invalid */
  validationError: string | null;
}

/**
 * Result of parsing a bulk name input.
 */
export interface ParseResult {
  /** Successfully parsed and valid names */
  validNames: string[];

  /** Invalid entries with reasons */
  invalidEntries: ParsedNameInput[];

  /** Duplicate names that were removed */
  duplicatesRemoved: string[];

  /** Total count before deduplication/validation */
  totalInput: number;
}

// ============================================================
// Search Result Types
// ============================================================

/**
 * Result of looking up a single name via `getnameinfo` RPC.
 */
export interface NameLookupResult {
  /** The name that was searched */
  name: string;

  /** Availability/ownership status */
  status: AvailabilityStatus;

  /** Owner address (if owned) */
  owner: string | null;

  /** Expiry block (if owned) */
  expiryBlock: number | null;

  /** Estimated expiry date (if owned) */
  expiryDate: Date | null;

  /** Current highest bid in HNS (if in auction) */
  highestBid: number | null;

  /** Value locked in the name (dollarydoos) */
  value: number | null;

  /** Number of DNS records (if owned) */
  recordCount: number;

  /** Current auction phase block info (if in auction) */
  auctionInfo: {
    /** Block when current phase ends */
    phaseEndBlock: number;
    /** Estimated date when current phase ends */
    phaseEndDate: Date | null;
  } | null;

  /** Error if the lookup failed for this name */
  error: string | null;
}

/**
 * Complete result of a bulk search operation.
 */
export interface BulkSearchResult {
  /** All individual lookup results */
  results: NameLookupResult[];

  /** Summary counts by status */
  summary: SearchSummary;

  /** Total time taken in milliseconds */
  durationMs: number;

  /** ISO timestamp when the search was performed */
  searchedAt: string;
}

/**
 * Summary of search results by availability status.
 */
export interface SearchSummary {
  total: number;
  available: number;
  opening: number;
  bidding: number;
  reveal: number;
  closed: number;
  ownedByYou: number;
  reserved: number;
  expired: number;
  revoked: number;
  errors: number;
}

// ============================================================
// Search History (stored in SQLite)
// ============================================================

/**
 * A saved search in the history.
 */
export interface SearchHistoryEntry {
  /** Database ID */
  id: number;

  /** Names that were searched (JSON-serialized array) */
  queryNames: string[];

  /** Summary of results */
  summary: SearchSummary;

  /** ISO timestamp when the search was performed */
  searchedAt: string;
}

// ============================================================
// Search Filters (for result table)
// ============================================================

/**
 * Filters for the search results table.
 */
export interface SearchResultFilters {
  /** Filter by status(es) */
  statuses: AvailabilityStatus[];

  /** Text search on name */
  searchText: string;

  /** Sort field */
  sortField: 'name' | 'status' | 'expiryBlock' | 'highestBid';

  /** Sort direction */
  sortDirection: 'asc' | 'desc';
}

export const DEFAULT_SEARCH_RESULT_FILTERS: SearchResultFilters = {
  statuses: [],
  searchText: '',
  sortField: 'name',
  sortDirection: 'asc',
};
