import { describe, it, expect } from 'vitest';
import { formatResourceRecord } from '../record-helpers';
import type { DNSRecord } from '../../types/domain';

describe('formatResourceRecord', () => {
  it('formats NS and glue records', () => {
    expect(formatResourceRecord({ type: 'NS', ns: 'ns1.example.' })).toBe('ns1.example.');
    expect(formatResourceRecord({ type: 'GLUE4', ns: 'ns1.example.', address: '192.0.2.1' }))
      .toBe('ns1.example. → 192.0.2.1');
  });

  it('shows every DS field', () => {
    const record: DNSRecord = {
      type: 'DS',
      keyTag: 36114,
      algorithm: 13,
      digestType: 2,
      digest: '4408b69369a05e3249ace61526651131540aae59796d956f9ba2f75e817b47a1',
    };
    expect(formatResourceRecord(record)).toContain('keyTag=36114');
    expect(formatResourceRecord(record)).toContain('algorithm=13');
    expect(formatResourceRecord(record)).toContain('digestType=2');
    expect(formatResourceRecord(record)).toContain(record.digest);
  });

  it('shows every TXT chunk', () => {
    const record: DNSRecord = { type: 'TXT', txt: ['tag: crypto', 'second chunk'] };
    expect(formatResourceRecord(record)).toBe('"tag: crypto" "second chunk"');
  });

  it('formats synthetic records', () => {
    expect(formatResourceRecord({ type: 'SYNTH4', address: '192.0.2.2' })).toBe('192.0.2.2');
  });
});
