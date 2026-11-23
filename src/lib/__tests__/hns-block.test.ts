import { describe, it, expect } from 'vitest';
import { parseBlockCovenants } from '../hns-block';
import { buildRawBlock } from './hns-block-fixture';

function hash(byte: number): Buffer {
  return Buffer.alloc(32, byte);
}

describe('parseBlockCovenants', () => {
  it('reads auction and name-management covenants with resource sizes', () => {
    const name = Buffer.from('alpha', 'ascii');
    const blockHash = Buffer.alloc(32, 0xff);
    const height = Buffer.alloc(4);

    const raw = buildRawBlock([
      { type: 2, items: [hash(1), height, name, blockHash] }, // OPEN
      { type: 3, items: [hash(2), height, blockHash], value: 500 }, // BID
      { type: 4, items: [hash(3), height], value: 250 }, // REVEAL
      { type: 6, items: [hash(4), height, Buffer.from([0, 6, 1, 5]), blockHash] }, // REGISTER
      { type: 7, items: [hash(5), height, Buffer.from([0])] }, // UPDATE (empty)
      { type: 8, items: [hash(6), height, blockHash] }, // RENEW
      { type: 9, items: [hash(7), height] }, // TRANSFER
      { type: 10, items: [hash(8), height] }, // FINALIZE
      { type: 11, items: [hash(9)] }, // REVOKE
    ]);

    const covenants = parseBlockCovenants(raw);

    expect(covenants.map((covenant) => covenant.action)).toEqual([
      'OPEN',
      'BID',
      'REVEAL',
      'REGISTER',
      'UPDATE',
      'RENEW',
      'TRANSFER',
      'FINALIZE',
      'REVOKE',
    ]);
    expect(covenants[0].name).toBe('alpha');
    expect(covenants[1].value).toBe(500);
    expect(covenants[3].resourceSize).toBe(4);
    expect(covenants[4].resourceSize).toBe(1);
    expect(covenants[5].resourceSize).toBeUndefined();
    expect(covenants[8].hash).toBe(hash(9).toString('hex'));
  });
});
