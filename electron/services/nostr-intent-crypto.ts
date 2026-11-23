/**
 * NIP-44 encryption for marketplace purchase intents.
 *
 * Listing events stay public (they are classified ads), but purchase intents
 * contain buyer addresses, names, and prices. Encrypt those to the
 * counterparty's Nostr key; the event tags still route the event.
 */

import { nip44 } from 'nostr-tools';

const PREFIX = 'nip44:';

export function encryptIntentPayload(
  payload: unknown,
  senderSecretKey: Uint8Array,
  recipientPubKey: string,
): string {
  const conversationKey = nip44.getConversationKey(senderSecretKey, recipientPubKey);
  const ciphertext = nip44.encrypt(JSON.stringify(payload), conversationKey);
  return `${PREFIX}${ciphertext}`;
}

/**
 * Decrypt an intent payload. Plain JSON is accepted for backwards
 * compatibility with intents published before encryption was added.
 */
export function decryptIntentPayload<T>(
  content: string,
  recipientSecretKey: Uint8Array,
  senderPubKey: string,
): T | null {
  if (!content.startsWith(PREFIX)) {
    try {
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  try {
    const conversationKey = nip44.getConversationKey(recipientSecretKey, senderPubKey);
    const plaintext = nip44.decrypt(content.slice(PREFIX.length), conversationKey);
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}
