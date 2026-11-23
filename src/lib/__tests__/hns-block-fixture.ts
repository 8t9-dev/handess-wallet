/**
 * Minimal Handshake block serializer for tests.
 *
 * Only the fields read by `parseBlockCovenants` are populated. The header is
 * zero-filled because the parser does not validate it.
 */

export interface FixtureCovenant {
  /** hsd covenant type (e.g. 6 = REGISTER, 7 = UPDATE). */
  type: number;
  items: Buffer[];
  value?: number;
}

function varint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid varint value.');
  }
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 0xfd;
    buffer.writeUInt16LE(value, 1);
    return buffer;
  }
  if (value <= 0xffffffff) {
    const buffer = Buffer.alloc(5);
    buffer[0] = 0xfe;
    buffer.writeUInt32LE(value, 1);
    return buffer;
  }
  throw new Error('Test fixture varint too large.');
}

function output(covenant: FixtureCovenant): Buffer {
  const chunks: Buffer[] = [];

  const value = Buffer.alloc(8);
  value.writeBigUInt64LE(BigInt(covenant.value ?? 0));
  chunks.push(value);

  // Null address: version 0, two zero bytes.
  chunks.push(Buffer.from([0, 2, 0, 0]));

  chunks.push(Buffer.from([covenant.type]));
  chunks.push(varint(covenant.items.length));
  for (const item of covenant.items) {
    chunks.push(varint(item.length), item);
  }

  return Buffer.concat(chunks);
}

export function buildRawBlock(covenants: FixtureCovenant[]): string {
  const chunks: Buffer[] = [Buffer.alloc(236)];

  chunks.push(varint(1)); // transaction count
  chunks.push(Buffer.alloc(4)); // version
  chunks.push(varint(1)); // input count
  chunks.push(Buffer.alloc(40)); // outpoint + sequence
  chunks.push(varint(covenants.length));
  for (const covenant of covenants) chunks.push(output(covenant));
  chunks.push(Buffer.alloc(4)); // locktime
  chunks.push(varint(0)); // witness count for the single input

  return Buffer.concat(chunks).toString('hex');
}
