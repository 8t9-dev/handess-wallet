import { describe, it, expect } from 'vitest';
import {
  extractRawCovenantName,
  getCovenantNameHash,
  sanitizeCovenantName,
} from '../covenant-utils';

const HASH = 'ab'.repeat(32);

/** Encode an ASCII string the way hsd stores covenant items (hex bytes). */
function toHex(text: string): string {
  return [...text]
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

// ================================================================
// extractRawCovenantName — actions that embed the name at items[2]
// ================================================================
describe('extractRawCovenantName', () => {
  it.each(['OPEN', 'BID', 'FINALIZE', 'CLAIM'])('reads the raw name for %s', (action) => {
    const items = [HASH, '00000000', toHex('jacob')];
    expect(extractRawCovenantName(action, items)).toBe('jacob');
  });

  it('decodes punycode names, including IDNA/emoji names', () => {
    const items = [HASH, '00000000', toHex('xn--jacob-7y04d')];
    expect(extractRawCovenantName('OPEN', items)).toBe('xn--jacob-7y04d');
  });

  it('is case-insensitive about the action', () => {
    expect(extractRawCovenantName('open', [HASH, '00000000', toHex('jacob')])).toBe('jacob');
  });

  it('strips NUL padding and control bytes', () => {
    const items = [HASH, '00000000', toHex('\0jacob\0\0')];
    expect(extractRawCovenantName('BID', items)).toBe('jacob');
  });

  it('does NOT decode the height at items[1] for RENEW', () => {
    // Regression: height 0x00007179 decodes to "Qy", which is what the
    // history page used to show for every renewal.
    const heightHex = '79710000';
    const items = [HASH, heightHex, 'cd'.repeat(32)];
    expect(extractRawCovenantName('RENEW', items)).toBeNull();
  });

  it.each([
    'REVEAL',
    'REDEEM',
    'REGISTER',
    'UPDATE',
    'RENEW',
    'TRANSFER',
    'REVOKE',
  ])('returns null for %s, which has no raw name', (action) => {
    expect(extractRawCovenantName(action, [HASH, '00000000', 'cd'.repeat(32)])).toBeNull();
  });

  it('returns null for unknown actions', () => {
    expect(extractRawCovenantName('NONE', [HASH, '00000000', toHex('jacob')])).toBeNull();
  });

  it('returns null when items[2] is missing', () => {
    expect(extractRawCovenantName('OPEN', [HASH, '00000000'])).toBeNull();
  });

  it('returns null when items[2] is not hex', () => {
    expect(extractRawCovenantName('OPEN', [HASH, '00000000', 'not-hex'])).toBeNull();
  });

  it('returns null for odd-length hex', () => {
    expect(extractRawCovenantName('OPEN', [HASH, '00000000', '6a6f6'])).toBeNull();
  });
});

// ================================================================
// getCovenantNameHash — actions that only carry the name hash
// ================================================================
describe('getCovenantNameHash', () => {
  it.each([
    'REVEAL',
    'REDEEM',
    'REGISTER',
    'UPDATE',
    'RENEW',
    'TRANSFER',
    'REVOKE',
  ])('returns items[0] for %s', (action) => {
    expect(getCovenantNameHash(action, [HASH, '00000000'])).toBe(HASH);
  });

  it('resolves the RENEW name hash rather than the height item', () => {
    const items = [HASH, '79710000', 'cd'.repeat(32)];
    expect(getCovenantNameHash('RENEW', items)).toBe(HASH);
  });

  it('is case-insensitive about the action', () => {
    expect(getCovenantNameHash('renew', [HASH])).toBe(HASH);
  });

  it.each(['OPEN', 'BID', 'FINALIZE', 'CLAIM'])(
    'returns null for %s, which embeds the name instead',
    (action) => {
      expect(getCovenantNameHash(action, [HASH, '00000000', toHex('jacob')])).toBeNull();
    },
  );

  it('returns null for a malformed hash', () => {
    expect(getCovenantNameHash('RENEW', ['ab'.repeat(31)])).toBeNull();
    expect(getCovenantNameHash('RENEW', ['zz'.repeat(32)])).toBeNull();
  });

  it('returns null when items are empty', () => {
    expect(getCovenantNameHash('RENEW', [])).toBeNull();
  });
});

// ================================================================
// sanitizeCovenantName
// ================================================================
describe('sanitizeCovenantName', () => {
  it('keeps printable ASCII names untouched', () => {
    expect(sanitizeCovenantName('xn--jacob-7y04d')).toBe('xn--jacob-7y04d');
  });

  it('removes NULs and other control bytes', () => {
    expect(sanitizeCovenantName('\0jacob\0')).toBe('jacob');
    expect(sanitizeCovenantName('ja\u0007cob')).toBe('jacob');
  });
});
