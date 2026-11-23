/**
 * Pure helpers for the Handshake TLD search index.
 *
 * Kept in src/lib so the index parser/filter can be tested without Electron.
 */

import type { DNSRecord } from '../types/domain';
import type {
  HnsIndexRecord,
  HnsIndexSearchQuery,
  HnsIndexSearchResponse,
  HnsIndexTagStat,
} from '../types/search-engine';

export const INDEX_VERSION = 1;
export const MAX_TAGS_PER_NAME = 12;
export const MAX_NS_PER_NAME = 8;
export const MAX_TXT_PREVIEWS = 3;

const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Normalize a user/tag value. Returns null when it is not a safe tag. */
export function normalizeTag(value: string): string | null {
  const tag = value.trim().toLowerCase();
  return TAG_PATTERN.test(tag) ? tag : null;
}

/** Parse tags out of a TXT record value. `tag:sale,coffee` yields two. */
export function extractTagsFromText(value: string): string[] {
  const text = value.trim();
  if (!/^tag\s*:/i.test(text)) return [];

  const payload = text.replace(/^tag\s*:/i, '');
  const tags: string[] = [];
  for (const part of payload.split(/[,\s]+/)) {
    const tag = normalizeTag(part);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function extractTags(records: DNSRecord[]): string[] {
  const tags = new Set<string>();
  for (const record of records) {
    if (record.type !== 'TXT') continue;
    for (const value of record.txt) {
      for (const tag of extractTagsFromText(value)) tags.add(tag);
    }
  }
  return [...tags].sort().slice(0, MAX_TAGS_PER_NAME);
}

export type DnsSummary = Pick<
  HnsIndexRecord,
  | 'recordTypes'
  | 'ns'
  | 'addresses'
  | 'tags'
  | 'txt'
  | 'hasNS'
  | 'hasDS'
  | 'hasTXT'
  | 'hasWebsite'
>;

/** Build the compact, searchable summary stored in the index. */
export function summarizeDnsRecords(records: DNSRecord[]): DnsSummary {
  const recordTypes = new Set<string>();
  const ns = new Set<string>();
  const addresses = new Set<string>();
  const txt: string[] = [];

  for (const record of records) {
    recordTypes.add(record.type);

    if (record.type === 'NS' && record.ns) ns.add(record.ns);
    if ((record.type === 'GLUE4' || record.type === 'GLUE6') && record.ns) {
      ns.add(record.ns);
    }
    if (record.type === 'GLUE4' || record.type === 'GLUE6') addresses.add(record.address);
    if (record.type === 'SYNTH4' || record.type === 'SYNTH6') addresses.add(record.address);

    if (record.type === 'TXT') {
      for (const value of record.txt) {
        const text = value.trim();
        if (!text || txt.length >= MAX_TXT_PREVIEWS) continue;
        txt.push(text.length > 160 ? `${text.slice(0, 157)}...` : text);
      }
    }
  }

  const types = [...recordTypes].sort();
  const hasNS = types.includes('NS') || types.includes('GLUE4') || types.includes('GLUE6');
  const hasDS = types.includes('DS');
  const hasTXT = types.includes('TXT');
  const hasWebsite = hasNS || types.includes('SYNTH4') || types.includes('SYNTH6');

  return {
    recordTypes: types,
    ns: [...ns].slice(0, MAX_NS_PER_NAME),
    addresses: [...addresses].slice(0, MAX_NS_PER_NAME),
    tags: extractTags(records),
    txt,
    hasNS,
    hasDS,
    hasTXT,
    hasWebsite,
  };
}

function asStringArray(value: unknown, max = 32): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      out.push(item.trim());
      if (out.length >= max) break;
    }
  }
  return out;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asBlock(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

/** Validate one decoded NDJSON index line. */
export function parseIndexRecord(raw: unknown): HnsIndexRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim().toLowerCase() : '';
  if (!name || name.length > 253 || !/^[a-z0-9._-]+$/i.test(name)) return null;

  const tags = asStringArray(value.tags, MAX_TAGS_PER_NAME)
    .map(normalizeTag)
    .filter((tag): tag is string => tag !== null);

  // Older/interrupted builds emitted numeric hsd states. Accept a missing
  // state for development NDJSON, but never silently coerce a bad value.
  const state = value.state === undefined ? 'CLOSED' : value.state;
  if (typeof state !== 'string') return null;

  return {
    name,
    state,
    renewal: asBlock(value.renewal),
    expiryBlock: asBlock(value.expiryBlock),
    recordTypes: asStringArray(value.recordTypes, 16),
    ns: asStringArray(value.ns, MAX_NS_PER_NAME),
    addresses: asStringArray(value.addresses, MAX_NS_PER_NAME),
    tags: [...new Set(tags)].sort(),
    txt: asStringArray(value.txt, MAX_TXT_PREVIEWS),
    hasNS: asBoolean(value.hasNS),
    hasDS: asBoolean(value.hasDS),
    hasTXT: asBoolean(value.hasTXT),
    hasWebsite: asBoolean(value.hasWebsite),
  };
}

export function buildTagCounts(records: Iterable<HnsIndexRecord>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const tag of record.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return counts;
}

export function topTags(counts: Map<string, number>, limit = 20): HnsIndexTagStat[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

/** Does a single free-text token appear anywhere in the record? */
function recordMatchesToken(record: HnsIndexRecord, token: string): boolean {
  // Most searches are by name, so check the cheapest field first.
  if (record.name.includes(token)) return true;
  if (record.tags.some((tag) => tag.includes(token))) return true;
  if (record.ns.some((host) => host.toLowerCase().includes(token))) return true;
  if (record.recordTypes.some((type) => type.toLowerCase().includes(token))) return true;
  if (record.txt.some((text) => text.toLowerCase().includes(token))) return true;
  return false;
}

/** Does a record match every active filter? */
export function matchesIndexQuery(record: HnsIndexRecord, query: HnsIndexSearchQuery): boolean {
  const rawText = (query.query || '').trim().toLowerCase();
  const textTokens: string[] = [];
  const textTags: string[] = [];

  // Allow `tag:coffee` in the free-text box as a shorthand filter.
  for (const token of rawText.split(/\s+/).filter(Boolean)) {
    if (token.startsWith('tag:')) {
      for (const part of token.slice(4).split(',')) {
        const tag = normalizeTag(part);
        if (tag) textTags.push(tag);
      }
    } else {
      textTokens.push(token);
    }
  }

  // Every free-text token must match; this keeps multi-word searches useful
  // without allocating a combined haystack string per record.
  for (const token of textTokens) {
    if (!recordMatchesToken(record, token)) return false;
  }

  const tags = [
    ...(query.tags || []),
    ...textTags,
  ]
    .map(normalizeTag)
    .filter((tag): tag is string => tag !== null);
  for (const tag of tags) {
    if (!record.tags.includes(tag)) return false;
  }

  if (query.hasNS && !record.hasNS) return false;
  if (query.hasDS && !record.hasDS) return false;
  if (query.hasTXT && !record.hasTXT) return false;
  if (query.hasWebsite && !record.hasWebsite) return false;

  const states = (query.states || []).map((state) => state.toUpperCase());
  if (states.length > 0 && !states.includes(record.state.toUpperCase())) return false;

  return true;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export interface SearchIndexOptions {
  /**
   * Set when the caller already ordered `records` by the requested sort key.
   * This avoids collecting and sorting every match on each keystroke.
   */
  ordered?: boolean;
}

/** Names are lowercase ASCII, so a plain comparison beats localeCompare. */
function compareNames(a: HnsIndexRecord, b: HnsIndexRecord): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function compareIndexRecords(
  a: HnsIndexRecord,
  b: HnsIndexRecord,
  sort: 'name' | 'expiry',
): number {
  if (sort === 'expiry') {
    const aExpiry = a.expiryBlock ?? Number.MAX_SAFE_INTEGER;
    const bExpiry = b.expiryBlock ?? Number.MAX_SAFE_INTEGER;
    return aExpiry - bExpiry || compareNames(a, b);
  }
  return compareNames(a, b);
}

export function searchIndexRecords(
  records: Iterable<HnsIndexRecord>,
  query: HnsIndexSearchQuery,
  options: SearchIndexOptions = {},
): Omit<HnsIndexSearchResponse, 'status'> {
  const startedAt = Date.now();
  const limit = clampInt(query.limit, 50, 1, 200);
  const offset = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const sort = query.sort === 'expiry' ? 'expiry' : 'name';
  const ordered = options.ordered === true;

  const matches: HnsIndexRecord[] = [];
  let total = 0;
  for (const record of records) {
    if (!matchesIndexQuery(record, query)) continue;
    total++;
    if (!ordered || matches.length < offset + limit) matches.push(record);
  }

  if (!ordered) {
    matches.sort((a, b) => compareIndexRecords(a, b, sort));
  }

  return {
    records: matches.slice(offset, offset + limit),
    total,
    offset,
    limit,
    durationMs: Date.now() - startedAt,
  };
}
