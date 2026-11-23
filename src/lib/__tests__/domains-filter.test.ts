import { describe, it, expect } from 'vitest';
import { getFilteredDomains } from '../../stores/domains-store';
import { DEFAULT_DOMAIN_FILTERS } from '../../types/domain';
import type { DomainFilters, DomainSort, DomainWithMeta } from '../../types/domain';

function makeDomain(name: string, overrides: Partial<DomainWithMeta> = {}): DomainWithMeta {
  return {
    name,
    nameHash: '',
    state: 'CLOSED',
    height: 0,
    renewalBlock: 100,
    expiryBlock: 200,
    expiryDate: null,
    ownerHash: '',
    ownerIndex: 0,
    value: 0,
    highestBid: 0,
    dnsRecords: [],
    transferring: false,
    transferBlock: 0,
    revoked: false,
    renewals: 0,
    claimed: false,
    weak: false,
    tags: [],
    notes: '',
    expiryUrgency: 'safe',
    ...overrides,
  };
}

const SORT_BY_NAME_ASC: DomainSort = { field: 'name', direction: 'asc' };
const NO_FILTERS: DomainFilters = { ...DEFAULT_DOMAIN_FILTERS };

// ================================================================
// Search — punycode and decoded IDNA/emoji names
// ================================================================
describe('getFilteredDomains search', () => {
  const domains = [
    makeDomain('xn--armstrong-3d95h'), // armstrong💙
    makeDomain('zebra'),
    makeDomain('xn--1091'), // invalid punycode — no decoded form
  ];

  it('matches raw punycode names', () => {
    const result = getFilteredDomains(
      domains,
      { ...NO_FILTERS, searchText: 'xn--armstrong' },
      SORT_BY_NAME_ASC,
    );
    expect(result.map((d) => d.name)).toEqual(['xn--armstrong-3d95h']);
  });

  it('matches the full decoded name including emoji', () => {
    const result = getFilteredDomains(
      domains,
      { ...NO_FILTERS, searchText: 'armstrong💙' },
      SORT_BY_NAME_ASC,
    );
    expect(result.map((d) => d.name)).toEqual(['xn--armstrong-3d95h']);
  });

  it('matches a partial decoded name (emoji only)', () => {
    const result = getFilteredDomains(
      domains,
      { ...NO_FILTERS, searchText: '💙' },
      SORT_BY_NAME_ASC,
    );
    expect(result.map((d) => d.name)).toEqual(['xn--armstrong-3d95h']);
  });

  it('is case-insensitive and trims the query', () => {
    const result = getFilteredDomains(
      domains,
      { ...NO_FILTERS, searchText: '  ARMSTRONG  ' },
      SORT_BY_NAME_ASC,
    );
    expect(result.map((d) => d.name)).toEqual(['xn--armstrong-3d95h']);
  });

  it('still matches names that have no decoded form', () => {
    const result = getFilteredDomains(
      domains,
      { ...NO_FILTERS, searchText: '1091' },
      SORT_BY_NAME_ASC,
    );
    expect(result.map((d) => d.name)).toEqual(['xn--1091']);
  });

  it('returns no rows when nothing matches', () => {
    const result = getFilteredDomains(
      domains,
      { ...NO_FILTERS, searchText: 'no-such-name' },
      SORT_BY_NAME_ASC,
    );
    expect(result).toEqual([]);
  });
});

// ================================================================
// Sort — decoded names sort as their Unicode form
// ================================================================
describe('getFilteredDomains sort', () => {
  const domains = [
    makeDomain('zebra'),
    makeDomain('xn--armstrong-3d95h'), // armstrong💙
    makeDomain('xn--jacob-7y04d'), // jacob👑
    makeDomain('apple'),
  ];

  it('sorts by decoded name ascending', () => {
    const result = getFilteredDomains(domains, NO_FILTERS, SORT_BY_NAME_ASC);
    expect(result.map((d) => d.name)).toEqual([
      'apple',
      'xn--armstrong-3d95h',
      'xn--jacob-7y04d',
      'zebra',
    ]);
  });

  it('sorts by decoded name descending', () => {
    const result = getFilteredDomains(domains, NO_FILTERS, {
      field: 'name',
      direction: 'desc',
    });
    expect(result.map((d) => d.name)).toEqual([
      'zebra',
      'xn--jacob-7y04d',
      'xn--armstrong-3d95h',
      'apple',
    ]);
  });
});
