/**
 * On-chain tag helpers.
 *
 * Tags are stored in Handshake TXT records using the `tag: name` convention.
 * A name may have several tag TXT records; non-tag TXT records must be kept.
 */

import type { DNSRecord } from '../types/domain';
import { MAX_TAGS_PER_NAME, extractTags, normalizeTag } from './hns-index';

const TAG_PREFIX = /^tag\s*:/i;

export function isTagTxt(value: string): boolean {
  return TAG_PREFIX.test(value.trim());
}

/** Sorted, deduplicated on-chain tags for a name. */
export function extractDomainTags(records: DNSRecord[]): string[] {
  return extractTags(records);
}

/**
 * Parse a user/CSV tag list. Accepts commas, semicolons, and whitespace.
 * A leading `tag:` on each entry is tolerated. Invalid entries are returned
 * separately so the caller can show a useful error instead of silently
 * dropping them.
 */
export function parseTagList(input: string): { tags: string[]; invalid: string[] } {
  const tags = new Set<string>();
  const invalid: string[] = [];

  // Split on commas/semicolons first so `tag: coffee, sale` keeps the prefix
  // attached to its value. Then allow whitespace-separated tags within each
  // chunk (`coffee sale`).
  const chunks = input
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const withoutPrefix = chunk.replace(TAG_PREFIX, '').trim();
    for (const part of withoutPrefix.split(/\s+/).filter(Boolean)) {
      const tag = normalizeTag(part);
      if (tag) tags.add(tag);
      else invalid.push(part);
    }
  }

  return { tags: [...tags].sort(), invalid };
}

/** Format tags for the table and CSV: `coffee, sale`. */
export function formatTags(tags: string[]): string {
  return tags.join(', ');
}

/**
 * Replace the tag TXT records while preserving every other record.
 * One TXT record per tag keeps each value well under TXT's 255-byte limit.
 */
export function applyTagsToRecords(records: DNSRecord[], tags: string[]): DNSRecord[] {
  const kept: DNSRecord[] = [];

  for (const record of records) {
    if (record.type !== 'TXT') {
      kept.push(record);
      continue;
    }

    const nonTagValues = record.txt.filter((value) => !isTagTxt(value));
    if (nonTagValues.length > 0) {
      kept.push({ type: 'TXT', txt: nonTagValues });
    }
  }

  const uniqueTags = [...new Set(tags)]
    .map((tag) => normalizeTag(tag))
    .filter((tag): tag is string => tag !== null)
    .slice(0, MAX_TAGS_PER_NAME)
    .sort();

  for (const tag of uniqueTags) {
    kept.push({ type: 'TXT', txt: [`tag: ${tag}`] });
  }

  return kept;
}

/** True when two tag lists contain the same tags regardless of order. */
export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((tag, index) => tag === sortedB[index]);
}
