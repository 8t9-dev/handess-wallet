import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { decryptIntentPayload, encryptIntentPayload } from '../nostr-intent-crypto';

const alice = generateSecretKey();
const alicePub = getPublicKey(alice);
const bob = generateSecretKey();
const bobPub = getPublicKey(bob);
const carol = generateSecretKey();

const PAYLOAD = {
  intentId: 'opaque-id',
  name: 'example',
  price: 100_000_000,
  buyerAddr: 'hs1qbuyer',
  sellerAddr: 'hs1qseller',
  status: 'pending',
};

describe('NIP-44 purchase intent crypto', () => {
  it('round-trips an intent between buyer and seller', () => {
    const encrypted = encryptIntentPayload(PAYLOAD, alice, bobPub);
    expect(encrypted.startsWith('nip44:')).toBe(true);
    expect(encrypted).not.toContain('hs1qbuyer');
    expect(decryptIntentPayload(encrypted, bob, alicePub)).toEqual(PAYLOAD);
  });

  it('cannot be decrypted by a third party', () => {
    const encrypted = encryptIntentPayload(PAYLOAD, alice, bobPub);
    expect(decryptIntentPayload(encrypted, carol, alicePub)).toBeNull();
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptIntentPayload(PAYLOAD, alice, bobPub);
    const tampered = `${encrypted.slice(0, -4)}AAAA`;
    expect(decryptIntentPayload(tampered, bob, alicePub)).toBeNull();
  });

  it('still reads legacy plaintext intents', () => {
    const legacy = JSON.stringify({ name: 'old-listing', status: 'pending' });
    expect(decryptIntentPayload(legacy, bob, alicePub)).toEqual({
      name: 'old-listing',
      status: 'pending',
    });
  });

  it('returns null for malformed plaintext', () => {
    expect(decryptIntentPayload('not-json', bob, alicePub)).toBeNull();
  });
});
