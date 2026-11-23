import { describe, it, expect } from 'vitest';
import {
  applyTagsToRecords,
  extractDomainTags,
  formatTags,
  parseTagList,
  sameTags,
} from '../domain-tags';
import type { DNSRecord } from '../../types/domain';

const NS: DNSRecord = { type: 'NS', ns: 'ns1.example.' };
const TXT_VERIFY: DNSRecord = { type: 'TXT', txt: ['some-verification-value'] };

describe('parseTagList', () => {
  it('parses comma, semicolon, and space separated tags', () => {
    expect(parseTagList('coffee, sale; food health').tags).toEqual([
      'coffee',
      'food',
      'health',
      'sale',
    ]);
  });

  it('strips an existing tag: prefix and normalizes', () => {
    expect(parseTagList('tag: Coffee, TAG:sale').tags).toEqual(['coffee', 'sale']);
  });

  it('reports invalid tags instead of dropping them silently', () => {
    const result = parseTagList('good, <bad>');
    expect(result.tags).toEqual(['good']);
    expect(result.invalid).toEqual(['<bad>']);
  });

  it('deduplicates repeated tags', () => {
    expect(parseTagList('coffee, coffee, COFFEE').tags).toEqual(['coffee']);
  });
});

describe('extractDomainTags', () => {
  it('reads only tag TXT records', () => {
    const records: DNSRecord[] = [
      NS,
      TXT_VERIFY,
      { type: 'TXT', txt: ['tag: coffee'] },
      { type: 'TXT', txt: ['tag:sale,food'] },
    ];
    expect(extractDomainTags(records)).toEqual(['coffee', 'food', 'sale']);
  });
});

describe('applyTagsToRecords', () => {
  it('preserves non-tag records and replaces tag TXT records', () => {
    const records: DNSRecord[] = [
      NS,
      TXT_VERIFY,
      { type: 'TXT', txt: ['tag: old'] },
      { type: 'TXT', txt: ['tag: another'] },
    ];

    const updated = applyTagsToRecords(records, ['coffee', 'sale']);

    expect(updated).toContainEqual(NS);
    expect(updated).toContainEqual(TXT_VERIFY);
    expect(updated.filter((record) => record.type === 'TXT')).toEqual([
      { type: 'TXT', txt: ['some-verification-value'] },
      { type: 'TXT', txt: ['tag: coffee'] },
      { type: 'TXT', txt: ['tag: sale'] },
    ]);
    expect(updated).not.toContainEqual({ type: 'TXT', txt: ['tag: old'] });
  });

  it('removes all tags when given an empty list', () => {
    const updated = applyTagsToRecords(
      [NS, { type: 'TXT', txt: ['tag: old'] }],
      [],
    );
    expect(updated).toEqual([NS]);
  });

  it('keeps a non-tag chunk in a mixed TXT record', () => {
    const mixed: DNSRecord = { type: 'TXT', txt: ['tag: old', 'keep-me'] };
    const updated = applyTagsToRecords([mixed], ['new']);
    expect(updated).toContainEqual({ type: 'TXT', txt: ['keep-me'] });
    expect(updated).toContainEqual({ type: 'TXT', txt: ['tag: new'] });
  });
});

describe('tag helpers', () => {
  it('formats and compares tags regardless of order', () => {
    expect(formatTags(['coffee', 'sale'])).toBe('coffee, sale');
    expect(sameTags(['coffee', 'sale'], ['sale', 'coffee'])).toBe(true);
    expect(sameTags(['coffee'], ['coffee', 'sale'])).toBe(false);
  });
});
