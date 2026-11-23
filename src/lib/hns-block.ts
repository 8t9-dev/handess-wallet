/**
 * Minimal Handshake raw-block covenant scanner.
 *
 * Fetching `getblockbyheight [height, false]` returns raw hex. Parsing only the
 * covenant outputs locally is dramatically faster than requesting verbose JSON
 * for ~2,200 blocks, and avoids adding hsd/bcrypto to the Electron main bundle.
 */

export type RawCovenantAction =
  | 'OPEN'
  | 'BID'
  | 'REVEAL'
  | 'REGISTER'
  | 'UPDATE'
  | 'RENEW'
  | 'TRANSFER'
  | 'FINALIZE'
  | 'REVOKE';

export interface RawBlockCovenant {
  action: RawCovenantAction;
  /** 32-byte name hash as lowercase hex. */
  hash: string;
  /** Output value in dollarydoos. */
  value: number;
  /** OPEN embeds the raw name at item index 2. */
  name?: string;
  /**
   * Byte length of the resource data embedded in REGISTER/UPDATE covenants.
   * A length of 0 or 1 (`00`) means the name has no resource records.
   */
  resourceSize?: number;
}

const HEADER_SIZE = 236;
const ACTION_BY_TYPE: Record<number, RawCovenantAction> = {
  2: 'OPEN',
  3: 'BID',
  4: 'REVEAL',
  6: 'REGISTER',
  7: 'UPDATE',
  8: 'RENEW',
  9: 'TRANSFER',
  10: 'FINALIZE',
  11: 'REVOKE',
};

interface Cursor {
  offset: number;
}

function ensure(buffer: Buffer, cursor: Cursor, size: number): void {
  if (cursor.offset + size > buffer.length) {
    throw new Error('Malformed block: unexpected end of data.');
  }
}

function readU8(buffer: Buffer, cursor: Cursor): number {
  ensure(buffer, cursor, 1);
  return buffer[cursor.offset++];
}

function readU16(buffer: Buffer, cursor: Cursor): number {
  ensure(buffer, cursor, 2);
  const value = buffer.readUInt16LE(cursor.offset);
  cursor.offset += 2;
  return value;
}

function readU32(buffer: Buffer, cursor: Cursor): number {
  ensure(buffer, cursor, 4);
  const value = buffer.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  return value;
}

function readU64AsNumber(buffer: Buffer, cursor: Cursor): number {
  ensure(buffer, cursor, 8);
  const value = Number(buffer.readBigUInt64LE(cursor.offset));
  cursor.offset += 8;
  return value;
}

function readVarint(buffer: Buffer, cursor: Cursor): number {
  const first = readU8(buffer, cursor);
  if (first < 0xfd) return first;
  if (first === 0xfd) return readU16(buffer, cursor);
  if (first === 0xfe) return readU32(buffer, cursor);
  const low = readU32(buffer, cursor);
  const high = readU32(buffer, cursor);
  const value = high * 0x100000000 + low;
  if (!Number.isSafeInteger(value)) throw new Error('Malformed block: varint too large.');
  return value;
}

function skip(buffer: Buffer, cursor: Cursor, size: number): void {
  ensure(buffer, cursor, size);
  cursor.offset += size;
}

/** HNS names are ASCII on chain; drop padding/control bytes. */
function bufferToName(buffer: Buffer): string | undefined {
  let name = '';
  for (const byte of buffer) {
    if (byte >= 0x20 && byte <= 0x7e) name += String.fromCharCode(byte);
  }
  return name || undefined;
}

/**
 * Extract Handshake name covenants from one serialized block. Fetching raw
 * blocks and parsing them locally is much faster than requesting verbose JSON
 * for large scan ranges. REGISTER/UPDATE resource sizes are included so callers
 * can distinguish empty resource data from real DNS records.
 */
export function parseBlockCovenants(rawHex: string): RawBlockCovenant[] {
  const buffer = Buffer.from(rawHex, 'hex');
  if (buffer.length < HEADER_SIZE + 1) {
    throw new Error('Malformed block: too short.');
  }

  const cursor: Cursor = { offset: HEADER_SIZE };
  const txCount = readVarint(buffer, cursor);
  const covenants: RawBlockCovenant[] = [];

  for (let txIndex = 0; txIndex < txCount; txIndex++) {
    skip(buffer, cursor, 4); // version
    const inputCount = readVarint(buffer, cursor);
    skip(buffer, cursor, inputCount * 40); // outpoint hash/index + sequence

    const outputCount = readVarint(buffer, cursor);
    for (let outputIndex = 0; outputIndex < outputCount; outputIndex++) {
      const value = readU64AsNumber(buffer, cursor);

      const addressVersion = readU8(buffer, cursor);
      if (addressVersion > 31) throw new Error('Malformed block: bad address version.');
      const addressSize = readU8(buffer, cursor);
      if (addressSize < 2 || addressSize > 40) {
        throw new Error('Malformed block: bad address size.');
      }
      skip(buffer, cursor, addressSize);

      const covenantType = readU8(buffer, cursor);
      const itemCount = readVarint(buffer, cursor);
      let nameHash: string | null = null;
      let resourceSize: number | undefined;
      const items: Buffer[] = [];

      for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        const itemSize = readVarint(buffer, cursor);
        ensure(buffer, cursor, itemSize);
        const start = cursor.offset;
        if (itemIndex === 0 && itemSize === 32) {
          nameHash = buffer.subarray(start, start + 32).toString('hex');
        }
        // REGISTER/UPDATE carry the serialized resource at item index 2.
        if ((covenantType === 6 || covenantType === 7) && itemIndex === 2) {
          resourceSize = itemSize;
        }
        if (items.length < 3) {
          items.push(buffer.subarray(start, start + itemSize));
        }
        skip(buffer, cursor, itemSize);
      }

      const action = ACTION_BY_TYPE[covenantType];
      if (action && nameHash) {
        covenants.push({
          action,
          hash: nameHash,
          value,
          name: action === 'OPEN' && items[2] ? bufferToName(items[2]) : undefined,
          resourceSize,
        });
      }
    }

    skip(buffer, cursor, 4); // locktime

    // Witnesses are serialized after all outputs.
    for (let inputIndex = 0; inputIndex < inputCount; inputIndex++) {
      const witnessCount = readVarint(buffer, cursor);
      for (let witnessIndex = 0; witnessIndex < witnessCount; witnessIndex++) {
        const size = readVarint(buffer, cursor);
        skip(buffer, cursor, size);
      }
    }
  }

  return covenants;
}
