import { describe, it, expect } from 'vitest';
import { NodeService } from '../node-service';
import type { HSDConnectionService } from '../hsd-connection';

const HASH_A = 'aa'.repeat(32);
const HASH_B = 'bb'.repeat(32);
const ACTION_TYPE: Record<string, number> = { OPEN: 2, BID: 3, REVEAL: 4 };

function varint(value: number): Buffer {
  if (value < 0xfd) return Buffer.from([value]);
  throw new Error('test varint too large');
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function rawOutput(action: string, hash: string, value: number): Buffer {
  const u64 = Buffer.alloc(8);
  u64.writeBigUInt64LE(BigInt(value));
  return Buffer.concat([
    u64,
    Buffer.from([0, 2, 0, 0]), // address version/size + 2-byte hash
    Buffer.from([ACTION_TYPE[action]]),
    varint(1),
    varint(32),
    Buffer.from(hash, 'hex'),
  ]);
}

function makeRawBlock(outputs: Array<{ action: string; hash: string; value?: number }>): string {
  const tx = Buffer.concat([
    u32(1), // version
    varint(1), // input count
    Buffer.alloc(40, 0), // prevout + sequence
    varint(outputs.length),
    ...outputs.map((output) => rawOutput(output.action, output.hash, output.value ?? 1)),
    u32(0), // locktime
    varint(0), // witness items
  ]);

  return Buffer.concat([
    Buffer.alloc(236, 0), // header
    varint(1), // tx count
    tx,
  ]).toString('hex');
}

function makeService(): NodeService {
  const blocks = new Map<number, string>([
    [900, makeRawBlock([{ action: 'OPEN', hash: HASH_A, value: 100_000 }])],
    [950, makeRawBlock([{ action: 'BID', hash: HASH_A, value: 200_000 }])],
    [960, makeRawBlock([{ action: 'BID', hash: HASH_A, value: 300_000 }])],
    [980, makeRawBlock([{ action: 'REVEAL', hash: HASH_A }])],
    [995, makeRawBlock([{ action: 'OPEN', hash: HASH_B, value: 100_000 }])],
  ]);

  const nodeClient = {
    async getInfo() {
      return { chain: { height: 1000 } };
    },
    async execute(method: string, params: unknown[]) {
      if (method === 'getblockbyheight') {
        const height = Number(params[0]);
        return blocks.get(height) ?? makeRawBlock([]);
      }
      if (method === 'getnamebyhash') {
        if (params[0] === HASH_A) return 'alpha';
        if (params[0] === HASH_B) return 'beta';
        return null;
      }
      if (method === 'getnameinfo') {
        if (params[0] === 'alpha') {
          return {
            info: {
              state: 'BIDDING',
              height: 900,
              highest: 250_000,
              stats: { bidPeriodStart: 937, bidPeriodEnd: 1657, blocksUntilReveal: 657 },
            },
          };
        }
        if (params[0] === 'beta') {
          return {
            info: {
              state: 'OPENING',
              height: 995,
              highest: 0,
              stats: { openPeriodEnd: 1032, blocksUntilBidding: 32 },
            },
          };
        }
      }
      throw new Error(`Unexpected RPC ${method}`);
    },
  };

  const connection = {
    getClients: () => ({ nodeClient }),
    getNetwork: () => 'main',
  } as unknown as HSDConnectionService;

  return new NodeService(connection);
}

describe('NodeService.scanGlobalAuctions', () => {
  it('scans the bidding window and returns only names that can be bid on', async () => {
    const service = makeService();
    const result = await service.scanGlobalAuctions();

    expect(result.currentHeight).toBe(1000);
    expect(result.scannedFrom).toBe(180);
    expect(result.scannedTo).toBe(1000);
    expect(result.totalActive).toBe(1);
    expect(result.totalWithBids).toBe(1);
    expect(result.endingSoon.map((auction) => auction.name)).toEqual(['alpha']);
    expect(result.mostBids.map((auction) => auction.name)).toEqual(['alpha']);

    const alpha = result.endingSoon.find((auction) => auction.name === 'alpha')!;
    expect(alpha.state).toBe('BIDDING');
    expect(alpha.openHeight).toBe(900);
    expect(alpha.bidCount).toBe(2);
    expect(alpha.revealCount).toBe(1);
    expect(alpha.highestLockup).toBe(300_000);
    expect(alpha.blocksUntilNext).toBe(657);
    expect(alpha.blocksUntilClose).toBe(2097);

  });
});
