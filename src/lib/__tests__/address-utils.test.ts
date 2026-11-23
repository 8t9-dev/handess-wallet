import { describe, it, expect } from 'vitest';
import { bech32 } from 'bech32';
import { isValidHnsAddress, normalizeHnsAddress } from '../address-utils';

function makeAddress(prefix: string, programLength = 20, version = 0): string {
  const program = new Uint8Array(programLength).fill(1);
  return bech32.encode(prefix, [version, ...bech32.toWords(program)]);
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
