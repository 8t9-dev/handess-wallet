import { describe, it, expect } from 'vitest';
import { domainsToCSV, signaturesToCSV } from '../export-utils';
import type { DomainWithMeta } from '../../types/domain';

function makeDomain(overrides: Partial<DomainWithMeta> = {}): DomainWithMeta {
  return {
    name: 'example',
    nameHash: '',
    state: 'CLOSED',
    height: 0,
    renewalBlock: 100,
    expiryBlock: 200,
    expiryDate: new Date('2026-01-02T03:04:05.000Z'),
    ownerHash: '',
    ownerIndex: 0,
    value: 1_500_000,
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

// ================================================================
// domainsToCSV
// ================================================================
describe('domainsToCSV', () => {
  it('uses the default metadata columns', () => {
    const csv = domainsToCSV([makeDomain()]);
    expect(csv.split('\n')[0]).toBe(
      'name,state,expiryBlock,expiryDate,renewalBlock,value,tags',
    );
  });

  it('exports the raw punycode name for round-trip imports', () => {
    const csv = domainsToCSV([makeDomain({ name: 'xn--armstrong-3d95h' })]);
    const row = csv.split('\n')[1];
    expect(row.startsWith('xn--armstrong-3d95h,')).toBe(true);
    expect(row).not.toContain('[');
  });

  it('leaves ASCII and invalid punycode names unchanged', () => {
    const csv = domainsToCSV([
      makeDomain({ name: 'namebaseme' }),
      makeDomain({ name: 'xn--1091' }),
    ]);
    const [, first, second] = csv.split('\n');
    expect(first.startsWith('namebaseme,')).toBe(true);
    expect(second.startsWith('xn--1091,')).toBe(true);
    expect(second).not.toContain('[');
  });

  it('serialises values as HNS, dates as ISO and on-chain tags', () => {
    const csv = domainsToCSV([
      makeDomain({ dnsRecords: [{ type: 'TXT', txt: ['tag: defi'] }] }),
    ]);
    const row = csv.split('\n')[1];
    expect(row).toBe(
      'example,CLOSED,200,2026-01-02T03:04:05.000Z,100,1.5,defi',
    );
  });

  it('quotes a multi-tag field containing commas', () => {
    const csv = domainsToCSV([
      makeDomain({
        dnsRecords: [
          { type: 'TXT', txt: ['tag: coffee'] },
          { type: 'TXT', txt: ['tag: sale'] },
        ],
      }),
    ]);
    expect(csv.split('\n')[1].endsWith(',"coffee, sale"')).toBe(true);
  });

  it('leaves expiryDate blank when unknown', () => {
    const csv = domainsToCSV([makeDomain({ expiryDate: null })]);
    expect(csv.split('\n')[1]).toBe('example,CLOSED,200,,100,1.5,');
  });

  it('supports explicit columns', () => {
    const csv = domainsToCSV([makeDomain({ name: 'xn--armstrong-3d95h' })], [
      'name',
      'dnsRecordCount',
    ]);
    expect(csv).toBe('name,dnsRecordCount\nxn--armstrong-3d95h,0');
  });

  it('does not prepend a BOM (added at download time)', () => {
    expect(domainsToCSV([makeDomain()]).startsWith('\uFEFF')).toBe(false);
  });
});

// ================================================================
// signaturesToCSV
// ================================================================
describe('signaturesToCSV', () => {
  const row = {
    name: 'example',
    message: 'Hello, Handshake!',
    signature: 'abc+/def==',
  };

  it('uses the name,message,signature header', () => {
    expect(signaturesToCSV([]).split('\n')[0]).toBe('name,message,signature');
  });

  it('writes one row per name with the same message', () => {
    const csv = signaturesToCSV([
      row,
      { ...row, name: 'second', signature: 'xyz==' },
    ]);
    const [, first, second] = csv.split('\n');
    expect(first).toBe('example,"Hello, Handshake!",abc+/def==');
    expect(second).toBe('second,"Hello, Handshake!",xyz==');
  });

  it('escapes quotes and newlines in the message', () => {
    const csv = signaturesToCSV([
      { ...row, message: 'line one\nline "two"' },
    ]);
    expect(csv).toBe(
      'name,message,signature\nexample,"line one\nline ""two""",abc+/def==',
    );
  });

  it('escapes carriage returns', () => {
    const csv = signaturesToCSV([{ ...row, message: 'line one\r\nline two' }]);
    expect(csv).toBe(
      'name,message,signature\nexample,"line one\r\nline two",abc+/def==',
    );
  });

  it('preserves surrounding whitespace in the signed message', () => {
    const csv = signaturesToCSV([{ ...row, message: '  padded  ' }]);
    expect(csv.split('\n')[1]).toBe('example,  padded  ,abc+/def==');
  });
});
