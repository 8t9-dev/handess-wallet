import { describe, it, expect } from 'vitest';
import { bech32 } from 'bech32';
import {
  covenantItemsMatchAddress,
  isValidHnsAddress,
  normalizeHnsAddress,
} from '../address-utils';

function makeAddress(prefix: string, programLength = 20, version = 0): string {
  const program = new Uint8Array(programLength).fill(1);
  return bech32.encode(prefix, [version, ...bech32.toWords(program)]);
}

function covenantItemsFor(address: string): string[] {
  const decoded = bech32.decode(address, 90);
  const program = bech32.fromWords(decoded.words.slice(1));
  return [
    '11'.repeat(32),
    '00000384',
    decoded.words[0].toString(16).padStart(2, '0'),
    program.map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  ];
}

describe('HNS address validation', () => {
  it('accepts mainnet, testnet, and regtest v0 witness addresses', () => {
    expect(isValidHnsAddress(makeAddress('hs'))).toBe(true);
    expect(isValidHnsAddress(makeAddress('ts'))).toBe(true);
    expect(isValidHnsAddress(makeAddress('rs'))).toBe(true);
  });

  it('accepts 32-byte witness programs', () => {
    expect(isValidHnsAddress(makeAddress('hs', 32))).toBe(true);
  });

  it('rejects other bech32 prefixes', () => {
    expect(isValidHnsAddress(makeAddress('bc'))).toBe(false);
  });

  it('rejects a bad checksum', () => {
    const address = makeAddress('hs');
    const corrupted = `${address.slice(0, -1)}q`;
    expect(isValidHnsAddress(corrupted)).toBe(false);
  });

  it('rejects unsupported witness versions', () => {
    expect(isValidHnsAddress(makeAddress('hs', 20, 1))).toBe(false);
  });

  it('rejects empty and malformed values', () => {
    expect(isValidHnsAddress('')).toBe(false);
    expect(isValidHnsAddress('hs1not-an-address')).toBe(false);
  });

  it('trims whitespace in normalize', () => {
    expect(normalizeHnsAddress('  hs1abc  ')).toBe('hs1abc');
    expect(normalizeHnsAddress('')).toBe('');
  });
});

describe('HNS covenant address matching', () => {
  it('matches a TRANSFER covenant to its recipient address', () => {
    const buyer = makeAddress('hs');
    expect(covenantItemsMatchAddress(covenantItemsFor(buyer), buyer)).toBe(true);
  });

  it('matches the same program across network prefixes', () => {
    const buyer = makeAddress('ts');
    expect(covenantItemsMatchAddress(covenantItemsFor(buyer), buyer)).toBe(true);
  });

  it('rejects a different recipient', () => {
    const buyer = makeAddress('hs');
    const other = makeAddress('hs');
    const items = covenantItemsFor(other);
    items[3] = '22'.repeat(20);
    expect(covenantItemsMatchAddress(items, buyer)).toBe(false);
  });

  it('rejects malformed covenant items', () => {
    const buyer = makeAddress('hs');
    expect(covenantItemsMatchAddress([], buyer)).toBe(false);
    expect(covenantItemsMatchAddress(undefined, buyer)).toBe(false);
    expect(covenantItemsMatchAddress(['00', '00', 'zz', '00'], buyer)).toBe(false);
  });
});
