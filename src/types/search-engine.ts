/**
 * Search Engine (TLD directory) types.
 *
 * The index is intentionally separate from the wallet and from HSD's RPC
 * surface. It stores a compact snapshot of Handshake TLDs that currently have
 * DNS/TXT resource records, plus live updates fetched from the connected node.
 */

export type HnsIndexSource = 'bundled-seed' | 'bundled-seed+node' | 'node' | 'none';

export interface HnsIndexRecord {
  /** Punycode/ASCII TLD name without a trailing dot. */
  name: string;
  /** hsd name state (CLOSED, REVOKED, etc.). */
  state: string;
  /** Last renewal block, if any. */
  renewal: number | null;
  /** Estimated expiry block, derived from renewal + renewal window. */
  expiryBlock: number | null;
  /** Resource record types present at the TLD apex. */
  recordTypes: string[];
  /** Nameservers referenced by NS/GLUE records. */
  ns: string[];
  /** Glue/synthetic addresses at the TLD apex. */
  addresses: string[];
  /** Normalized `tag:` categories from TXT records. */
  tags: string[];
  /** Short previews of TXT records (max 3). */
  txt: string[];
  hasNS: boolean;
  hasDS: boolean;
  hasTXT: boolean;
  /** Has NS/GLUE/SYNTH records, i.e. can point at a website or app. */
  hasWebsite: boolean;
}

export interface HnsIndexProgress {
  phase: 'loading' | 'scanning' | 'resolving' | 'saving';
  scanned: number;
  total: number | null;
  matched: number;
  message: string;
}

export interface HnsIndexTagStat {
  tag: string;
  count: number;
}

export interface HnsIndexStatus {
  ready: boolean;
  loading: boolean;
  source: HnsIndexSource;
  nameCount: number;
  tagCount: number;
  generatedAt: string | null;
  blockHeight: number | null;
  topTags: HnsIndexTagStat[];
  refreshing: boolean;
  progress: HnsIndexProgress | null;
  error: string | null;
}

export interface HnsIndexSearchQuery {
  query?: string;
  tags?: string[];
  hasNS?: boolean;
  hasDS?: boolean;
  hasTXT?: boolean;
  hasWebsite?: boolean;
  states?: string[];
  sort?: 'name' | 'expiry';
  limit?: number;
  offset?: number;
}

export interface HnsIndexSearchResponse {
  records: HnsIndexRecord[];
  total: number;
  offset: number;
  limit: number;
  durationMs: number;
  status: HnsIndexStatus;
}

export interface HnsIndexRefreshResult {
  /** Name changes examined (resolved + removed + renewals). */
  scanned: number;
  /** Blocks actually scanned in the selected range. */
  scannedBlocks: number;
  fromHeight: number;
  toHeight: number;
  updated: number;
  removed: number;
  blockHeight: number;
  cancelled: boolean;
  status: HnsIndexStatus;
}
