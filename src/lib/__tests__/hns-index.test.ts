import { describe, it, expect } from 'vitest';
import {
  buildTagCounts,
  extractTags,
  extractTagsFromText,
  matchesIndexQuery,
  normalizeTag,
  parseIndexRecord,
  searchIndexRecords,
  summarizeDnsRecords,
  topTags,
} from '../hns-index';
import type { DNSRecord } from '../../types/domain';
import type { HnsIndexRecord } from '../../types/search-engine';

function makeRecord(overrides: Partial<HnsIndexRecord> = {}): HnsIndexRecord {
  return {
    name: 'example',
    state: 'CLOSED',
    renewal: 100,
    expiryBlock: 200,
    recordTypes: ['NS'],
    ns: ['ns1.example.'],
    addresses: [],
    tags: [],
    txt: [],
    hasNS: true,
    hasDS: false,
    hasTXT: false,
    hasWebsite: true,
    ...overrides,
  };
}

describe('normalizeTag', () => {
  it('lowercases and trims valid tags', () => {
    expect(normalizeTag('  Coffee ')).toBe('coffee');
  });

  it('accepts underscores and hyphens', () => {
    expect(normalizeTag('coffee_shop')).toBe('coffee_shop');
    expect(normalizeTag('real-estate')).toBe('real-estate');
  });

  it('rejects empty, oversized, and unsafe tags', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('-leading')).toBeNull();
    expect(normalizeTag('has space')).toBeNull();
    expect(normalizeTag('x'.repeat(33))).toBeNull();
    expect(normalizeTag('<script>')).toBeNull();
  });
});

describe('extractTagsFromText', () => {
  it('parses comma and space separated tags', () => {
    expect(extractTagsFromText('tag:sale,coffee health')).toEqual(['sale', 'coffee', 'health']);
  });

  it('is case-insensitive and tolerates whitespace before the colon', () => {
    expect(extractTagsFromText(' TAG : Food ')).toEqual(['food']);
  });

  it('ignores non-tag TXT values and unsafe entries', () => {
    expect(extractTagsFromText('hello world')).toEqual([]);
    expect(extractTagsFromText('tag:<bad>,good')).toEqual(['good']);
  });

  it('deduplicates repeated tags', () => {
    expect(extractTagsFromText('tag:sale sale')).toEqual(['sale']);
  });
});

describe('extractTags', () => {
  it('collects tags across TXT records only', () => {
    const records: DNSRecord[] = [
      { type: 'NS', ns: 'ns1.example.' },
      { type: 'TXT', txt: ['tag:coffee', 'tag:food,coffee'] },
      { type: 'TXT', txt: ['not a tag'] },
    ];
    expect(extractTags(records)).toEqual(['coffee', 'food']);
  });
});

describe('summarizeDnsRecords', () => {
  it('summarizes NS, glue, DS, and TXT records', () => {
    const records: DNSRecord[] = [
      { type: 'NS', ns: 'ns1.example.' },
      { type: 'GLUE4', ns: 'ns2.example.', address: '192.0.2.1' },
      { type: 'DS', keyTag: 1, algorithm: 13, digestType: 2, digest: 'ab' },
      { type: 'TXT', txt: ['tag:sale,coffee', 'hello'] },
    ];

    const summary = summarizeDnsRecords(records);
    expect(summary.recordTypes).toEqual(['DS', 'GLUE4', 'NS', 'TXT']);
    expect(summary.ns).toEqual(['ns1.example.', 'ns2.example.']);
    expect(summary.addresses).toEqual(['192.0.2.1']);
    expect(summary.tags).toEqual(['coffee', 'sale']);
    expect(summary.txt).toEqual(['tag:sale,coffee', 'hello']);
    expect(summary.hasNS).toBe(true);
    expect(summary.hasDS).toBe(true);
    expect(summary.hasTXT).toBe(true);
    expect(summary.hasWebsite).toBe(true);
  });

  it('treats synthetic records as website-capable', () => {
    const summary = summarizeDnsRecords([{ type: 'SYNTH4', address: '192.0.2.2' }]);
    expect(summary.hasWebsite).toBe(true);
    expect(summary.hasNS).toBe(false);
    expect(summary.addresses).toEqual(['192.0.2.2']);
  });

  it('truncates long TXT previews and caps preview count', () => {
    const summary = summarizeDnsRecords([
      { type: 'TXT', txt: ['a'.repeat(200), 'two', 'three', 'four'] },
    ]);
    expect(summary.txt).toHaveLength(3);
    expect(summary.txt[0].endsWith('...')).toBe(true);
    expect(summary.txt[0].length).toBe(160);
  });
});

describe('parseIndexRecord', () => {
  it('normalizes a valid record', () => {
    const record = parseIndexRecord({
      name: ' Example ',
      state: 'CLOSED',
      renewal: 10,
      expiryBlock: 20,
      recordTypes: ['NS'],
      ns: ['ns1.example.'],
      tags: ['Coffee', 'coffee', '<bad>'],
      hasNS: true,
      hasWebsite: true,
    });

    expect(record).not.toBeNull();
    expect(record!.name).toBe('example');
    expect(record!.tags).toEqual(['coffee']);
    expect(record!.hasNS).toBe(true);
  });

  it('rejects missing or unsafe names', () => {
    expect(parseIndexRecord(null)).toBeNull();
    expect(parseIndexRecord({})).toBeNull();
    expect(parseIndexRecord({ name: 'bad name' })).toBeNull();
    expect(parseIndexRecord({ name: 'a'.repeat(254) })).toBeNull();
  });

  it('rejects numeric states from old seeds instead of coercing them', () => {
    expect(parseIndexRecord({ name: 'example', state: 4 })).toBeNull();
    expect(parseIndexRecord({ name: 'example', state: null })).toBeNull();
  });

  it('defaults missing fields safely', () => {
    const record = parseIndexRecord({ name: 'example' });
    expect(record).toEqual({
      name: 'example',
      state: 'CLOSED',
      renewal: null,
      expiryBlock: null,
      recordTypes: [],
      ns: [],
      addresses: [],
      tags: [],
      txt: [],
      hasNS: false,
      hasDS: false,
      hasTXT: false,
      hasWebsite: false,
    });
  });
});

describe('matchesIndexQuery', () => {
  const record = makeRecord({
    tags: ['coffee', 'sale'],
    recordTypes: ['NS', 'TXT'],
    txt: ['tag:coffee,sale'],
    hasTXT: true,
  });

  it('matches name, tag, nameserver, and TXT text', () => {
    expect(matchesIndexQuery(record, { query: 'exam' })).toBe(true);
    expect(matchesIndexQuery(record, { query: 'coffee' })).toBe(true);
    expect(matchesIndexQuery(record, { query: 'ns1.example' })).toBe(true);
    expect(matchesIndexQuery(record, { query: 'tag:coffee' })).toBe(true);
    expect(matchesIndexQuery(record, { query: 'missing' })).toBe(false);
  });

  it('matches multiple free-text tokens independently', () => {
    expect(matchesIndexQuery(record, { query: 'exam coffee' })).toBe(true);
    expect(matchesIndexQuery(record, { query: 'exam health' })).toBe(false);
  });

  it('supports tag: shorthand in the free-text query', () => {
    expect(matchesIndexQuery(record, { query: 'tag:coffee' })).toBe(true);
    expect(matchesIndexQuery(record, { query: 'tag:coffee,sale' })).toBe(true);
    expect(matchesIndexQuery(record, { query: 'tag:coffee tag:sale' })).toBe(true);
    expect(matchesIndexQuery(record, { query: 'tag:health' })).toBe(false);
  });

  it('requires every selected tag', () => {
    expect(matchesIndexQuery(record, { tags: ['coffee'] })).toBe(true);
    expect(matchesIndexQuery(record, { tags: ['coffee', 'sale'] })).toBe(true);
    expect(matchesIndexQuery(record, { tags: ['coffee', 'health'] })).toBe(false);
  });

  it('applies record and state filters', () => {
    expect(matchesIndexQuery(record, { hasNS: true })).toBe(true);
    expect(matchesIndexQuery(record, { hasDS: true })).toBe(false);
    expect(matchesIndexQuery(record, { hasTXT: true })).toBe(true);
    expect(matchesIndexQuery(record, { hasWebsite: true })).toBe(true);
    expect(matchesIndexQuery(record, { states: ['CLOSED'] })).toBe(true);
    expect(matchesIndexQuery(record, { states: ['REVOKED'] })).toBe(false);
  });
});

describe('searchIndexRecords', () => {
  const records = [
    makeRecord({ name: 'zeta', expiryBlock: 300 }),
    makeRecord({ name: 'alpha', expiryBlock: 100 }),
    makeRecord({ name: 'beta', expiryBlock: 200, tags: ['coffee'] }),
  ];

  it('sorts by name and paginates', () => {
    const result = searchIndexRecords(records, { sort: 'name', limit: 2, offset: 0 });
    expect(result.records.map((record) => record.name)).toEqual(['alpha', 'beta']);
    expect(result.total).toBe(3);
    expect(result.limit).toBe(2);
  });

  it('sorts by expiry', () => {
    const result = searchIndexRecords(records, { sort: 'expiry' });
    expect(result.records.map((record) => record.name)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('clamps limit and offset', () => {
    const result = searchIndexRecords(records, { limit: 9999, offset: -5 });
    expect(result.limit).toBe(200);
    expect(result.offset).toBe(0);
  });

  it('filters by tag', () => {
    const result = searchIndexRecords(records, { tags: ['coffee'] });
    expect(result.records.map((record) => record.name)).toEqual(['beta']);
  });

  it('can consume a pre-ordered list without re-sorting every match', () => {
    const ordered = [records[1], records[2], records[0]]; // alpha, beta, zeta
    const first = searchIndexRecords(ordered, { sort: 'name', limit: 2, offset: 0 }, { ordered: true });
    expect(first.records.map((record) => record.name)).toEqual(['alpha', 'beta']);
    expect(first.total).toBe(3);

    const second = searchIndexRecords(ordered, { sort: 'name', limit: 2, offset: 2 }, { ordered: true });
    expect(second.records.map((record) => record.name)).toEqual(['zeta']);
    expect(second.total).toBe(3);
  });

  it('counts every match even when only one page is collected', () => {
    const ordered = [records[1], records[2], records[0]];
    const result = searchIndexRecords(ordered, { limit: 1 }, { ordered: true });
    expect(result.records).toHaveLength(1);
    expect(result.total).toBe(3);
  });
});

describe('tag counts', () => {
  const records = [
    makeRecord({ name: 'a', tags: ['coffee', 'sale'] }),
    makeRecord({ name: 'b', tags: ['coffee'] }),
    makeRecord({ name: 'c', tags: [] }),
  ];

  it('counts tags and returns the most common first', () => {
    const counts = buildTagCounts(records);
    expect(counts.get('coffee')).toBe(2);
    expect(counts.get('sale')).toBe(1);
    expect(topTags(counts)).toEqual([
      { tag: 'coffee', count: 2 },
      { tag: 'sale', count: 1 },
    ]);
  });
});
