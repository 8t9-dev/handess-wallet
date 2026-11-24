/**
 * Handshake address validation.
 *
 * hsd uses bech32 witness addresses with the `hs` prefix on mainnet and
 * `ts`/`rs` on test networks. We validate the checksum and the witness
 * program length before letting an address into a marketplace trade.
 */

import { bech32 } from 'bech32';

const HNS_PREFIXES = new Set(['hs', 'ts', 'rs']);

export function isValidHnsAddress(address: string): boolean {
  if (typeof address !== 'string') return false;

  const trimmed = address.trim();
  if (!trimmed) return false;

  try {
    const decoded = bech32.decode(trimmed, 90);
    if (!HNS_PREFIXES.has(decoded.prefix)) return false;

    // Handshake addresses are v0 witness programs (P2WPKH / P2WSH).
    const version = decoded.words[0];
    if (version !== 0) return false;

    const program = bech32.fromWords(decoded.words.slice(1));
    return program.length === 20 || program.length === 32;
  } catch {
    return false;
  }
}

export function normalizeHnsAddress(address: string): string {
  return typeof address === 'string' ? address.trim() : '';
}

/**
 * Check a Handshake covenant's address fields against a bech32 address.
 *
 * A TRANSFER covenant stores the intended recipient as `[nameHash, height,
 * version, hash]`. The transfer output itself pays the seller, so the recipient
 * must be read from these items rather than from `output.address`.
 */
export function covenantItemsMatchAddress(
  items: unknown,
  address: string,
): boolean {
  if (!Array.isArray(items) || items.length < 4) return false;

  const versionItem = items[2];
  const hashItem = items[3];
  if (typeof versionItem !== 'string' || typeof hashItem !== 'string') return false;

  const version = Number.parseInt(versionItem, 16);
  if (!Number.isInteger(version) || version < 0 || version > 31) return false;

  const programHex = hashItem.toLowerCase();
  if (!/^[0-9a-f]+$/.test(programHex) || programHex.length % 2 !== 0) return false;

  try {
    const decoded = bech32.decode(address.trim(), 90);
    if (decoded.words[0] !== version) return false;

    const program = bech32.fromWords(decoded.words.slice(1));
    const decodedHex = program
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return decodedHex === programHex;
  } catch {
    return false;
  }
}
