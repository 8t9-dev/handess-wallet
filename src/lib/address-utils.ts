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
