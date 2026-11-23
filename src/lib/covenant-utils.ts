/**
 * Covenant name helpers.
 *
 * hsd serialises covenant items as raw buffers, which are hex strings in RPC
 * JSON. The layout depends on the action (see hsd/lib/primitives/covenant.js):
 *
 *   OPEN / BID / FINALIZE / CLAIM:
 *     [nameHash, height(u32), rawName, ...] → name at index 2
 *   REVEAL / REDEEM / REGISTER / UPDATE / RENEW / TRANSFER / REVOKE:
 *     [nameHash, height(u32), ...] → no raw name; resolve items[0] with
 *     `getnamebyhash`.
 *
 * Decoding items[1] as text is a common mistake: it is a 4-byte height, so a
 * renewal rendered as "Renew name Qy" instead of the actual name.
 */

const NAME_AT_INDEX_2 = new Set(['OPEN', 'BID', 'FINALIZE', 'CLAIM']);
const NAME_FROM_HASH = new Set([
  'REVEAL',
  'REDEEM',
  'REGISTER',
  'UPDATE',
  'RENEW',
  'TRANSFER',
  'REVOKE',
]);

const HEX_RE = /^[0-9a-f]+$/i;

/**
 * Decode hex-encoded on-chain ASCII, dropping padding/control bytes.
 * HNS names are ASCII on chain (IDNA/emoji names are punycode).
 */
function hexToAscii(hex: string): string {
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code >= 0x20 && code <= 0x7e) out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Extract the name embedded directly in the covenant (index 2), or `null`
 * when this action stores only a name hash.
 */
export function extractRawCovenantName(action: string, items: string[]): string | null {
  if (!NAME_AT_INDEX_2.has(action.toUpperCase()) || items.length <= 2) return null;

  const hex = items[2];
  if (typeof hex !== 'string' || hex.length < 2 || hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    return null;
  }

  return hexToAscii(hex) || null;
}

/**
 * Return the name hash (items[0]) for actions that don't embed the name, or
 * `null` when the action embeds a raw name or the hash is malformed.
 */
export function getCovenantNameHash(action: string, items: string[]): string | null {
  if (!NAME_FROM_HASH.has(action.toUpperCase()) || items.length === 0) return null;

  const hash = items[0];
  if (typeof hash !== 'string' || hash.length !== 64 || !HEX_RE.test(hash)) return null;

  return hash;
}

/**
 * Strip bytes that cannot be part of a name. Used on names returned by
 * `getnamebyhash` as a defensive measure.
 */
export function sanitizeCovenantName(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, '');
}
