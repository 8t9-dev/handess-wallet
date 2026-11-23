import { describe, it, expect } from 'vitest';
import { findOpenedName } from '../opened-names';

const HASH = 'ab'.repeat(32);

/** Encode an ASCII string the way hsd stores covenant items (hex bytes). */
function toHex(text: string): string {
  return [...text]
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

function openCovenant(name: string) {
  return {
    covenant: {
      action: 'OPEN',
      type: 2,
      items: [HASH, '00000000', toHex(name)],
    },
  };
}

describe('findOpenedName', () => {
  it('extracts the raw name from an OPEN covenant', () => {
    expect(findOpenedName([openCovenant('jacob')])).toBe('jacob');
  });

  it('accepts hsd numeric covenant type 2 without an action string', () => {
    expect(findOpenedName([
      { covenant: { type: 2, items: [HASH, '00000000', toHex('jacob')] } },
    ])).toBe('jacob');
  });

  it('accepts a numeric action of 2', () => {
    expect(findOpenedName([
      { covenant: { action: 2, items: [HASH, '00000000', toHex('jacob')] } },
    ])).toBe('jacob');
  });

  it('decodes punycode names, including IDNA/emoji names', () => {
    expect(findOpenedName([openCovenant('xn--gg-6352aa')])).toBe('xn--gg-6352aa');
    expect(findOpenedName([openCovenant('xn--ad-o352ama')])).toBe('xn--ad-o352ama');
  });

  it('ignores non-OPEN covenants', () => {
    expect(findOpenedName([
      {
        covenant: {
          action: 'BID',
          type: 3,
          items: [HASH, '00000000', toHex('jacob')],
        },
      },
    ])).toBeNull();
  });

  it('finds OPEN when it is not the first output', () => {
    expect(findOpenedName([
      { covenant: { action: 'NONE', type: 0, items: [] } },
      openCovenant('jacob'),
    ])).toBe('jacob');
  });

  it('ignores outputs without a covenant', () => {
    expect(findOpenedName([{}, openCovenant('jacob')])).toBe('jacob');
  });

  it('returns null for missing or malformed outputs', () => {
    expect(findOpenedName(null)).toBeNull();
    expect(findOpenedName(undefined)).toBeNull();
    expect(findOpenedName([])).toBeNull();
    expect(findOpenedName([
      { covenant: { action: 'OPEN', type: 2, items: [HASH, '00000000'] } },
    ])).toBeNull();
  });

  it('returns null when the OPEN name is not valid hex', () => {
    expect(findOpenedName([
      { covenant: { action: 'OPEN', type: 2, items: [HASH, '00000000', 'not-hex'] } },
    ])).toBeNull();
  });
});
