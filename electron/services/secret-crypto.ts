/**
 * Secret-at-rest helpers backed by Electron's safeStorage.
 *
 * On Windows safeStorage is DPAPI, so ciphertext can only be decrypted by the
 * same OS user on the same machine. Values are stored as `enc:v1:<base64>`.
 *
 * Legacy plaintext values are still readable (returned unchanged) so an
 * interrupted migration can never lock the user out; DBService encrypts them
 * on startup.
 */

import { safeStorage } from 'electron';

export const ENCRYPTED_PREFIX = 'enc:v1:';

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/** Encrypt a string, leaving empty and already-encrypted values untouched. */
export function encryptSecret(value: string): string {
  if (!value || isEncryptedSecret(value) || !isEncryptionAvailable()) {
    return value;
  }

  return ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64');
}

/**
 * Decrypt a value. Plaintext input is returned as-is for backwards
 * compatibility. If the OS key is unavailable (different user or machine),
 * this returns an empty string instead of throwing at startup.
 */
export function decryptSecret(value: string, label = 'secret'): string {
  if (!value) return '';
  if (!isEncryptedSecret(value)) return value;

  try {
    return safeStorage.decryptString(
      Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64')
    );
  } catch (error) {
    console.error(
      `[Secrets] Could not decrypt ${label}. It may have been encrypted by a different Windows user or machine.`,
      error
    );
    return '';
  }
}

/** JSON helpers for structured secrets such as bid receipts. */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(value: string, fallback: T, label = 'secret'): T {
  const plaintext = decryptSecret(value, label);
  if (!plaintext) return fallback;

  try {
    return JSON.parse(plaintext) as T;
  } catch {
    console.error(`[Secrets] Stored ${label} is not valid JSON; ignoring it.`);
    return fallback;
  }
}
