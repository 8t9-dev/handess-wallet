import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  available: true,
}));

vi.mock('electron', () => {
  return {
    safeStorage: {
      isEncryptionAvailable: () => mockState.available,
      encryptString: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
      decryptString: (value: Buffer) => {
        const text = value.toString('utf8');
        if (!text.startsWith('sealed:')) {
          throw new Error('invalid ciphertext');
        }
        return text.slice('sealed:'.length);
      },
    },
  };
});

import {
  decryptJson,
  decryptSecret,
  ENCRYPTED_PREFIX,
  encryptJson,
  encryptSecret,
  isEncryptedSecret,
} from '../secret-crypto';

describe('secret-crypto', () => {
  beforeEach(() => {
    mockState.available = true;
    vi.restoreAllMocks();
  });

  it('encrypts values with a versioned prefix and decrypts them back', () => {
    const encrypted = encryptSecret('super-secret');

    expect(encrypted.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(encrypted).not.toContain('super-secret');
    expect(decryptSecret(encrypted)).toBe('super-secret');
  });

  it('leaves empty and already-encrypted values unchanged', () => {
    expect(encryptSecret('')).toBe('');

    const once = encryptSecret('value');
    expect(encryptSecret(once)).toBe(once);
    expect(decryptSecret(once)).toBe('value');
  });

  it('reads legacy plaintext values', () => {
    expect(isEncryptedSecret('plain')).toBe(false);
    expect(decryptSecret('plain')).toBe('plain');
  });

  it('falls back to an empty string when ciphertext cannot be decrypted', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(decryptSecret(`${ENCRYPTED_PREFIX}not-valid-base64`)).toBe('');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('round-trips structured JSON secrets', () => {
    const receipts = { example: { bidAmount: 10, nonce: 'abc', lockup: 5 } };

    expect(decryptJson(encryptJson(receipts), {})).toEqual(receipts);
  });

  it('returns the fallback for malformed JSON', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(decryptJson(encryptJson({ ok: true }), { fallback: true })).toEqual({ ok: true });
    expect(decryptJson('not-json', { fallback: true })).toEqual({ fallback: true });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('stores plaintext when OS encryption is unavailable', () => {
    mockState.available = false;

    expect(encryptSecret('secret')).toBe('secret');
    expect(decryptSecret('secret')).toBe('secret');
  });
});
