import { describe, it, expect, beforeEach } from 'vitest';
import { WalletService } from '../wallet-service';
import type { HSDConnectionService } from '../hsd-connection';
import type { DNSRecord } from '../../../src/types/domain';

interface Calls {
  sendUpdate: Array<{ name: string; records: DNSRecord[] }>;
}

function makeService(
  records: DNSRecord[],
  calls: Calls,
  options: { failSend?: boolean } = {},
): WalletService {
  const walletClient = {
    async execute(method: string, params: unknown[]) {
      if (method === 'getwalletinfo') return { walletid: '' };
      if (method === 'walletlock') return null;
      if (method === 'sendupdate') {
        if (options.failSend) throw new Error('not enough funds');
        calls.sendUpdate.push({
          name: String(params[0]),
          records: (params[1] as { records: DNSRecord[] }).records,
        });
        return { txid: 'tx-1' };
      }
      throw new Error(`Unexpected wallet method ${method}`);
    },
  };

  const nodeClient = {
    async execute(method: string) {
      if (method === 'getnameresource') return { records };
      throw new Error(`Unexpected node method ${method}`);
    },
  };

  const connection = {
    getClients: () => ({ walletClient, nodeClient }),
    getNetwork: () => 'main',
  } as unknown as HSDConnectionService;

  return new WalletService(connection);
}

describe('WalletService.applyTags', () => {
  let calls: Calls;

  beforeEach(() => {
    calls = { sendUpdate: [] };
  });

  it('preserves other records and writes one tag: TXT per tag', async () => {
    const service = makeService([
      { type: 'NS', ns: 'ns1.example.' },
      { type: 'TXT', txt: ['verification'] },
      { type: 'TXT', txt: ['tag: old'] },
    ], calls);

    const result = await service.applyTags([
      { name: 'example', tags: ['sale', 'coffee'] },
    ], '');

    expect(result).toEqual([
      { name: 'example', success: true, skipped: false, txid: 'tx-1' },
    ]);
    expect(calls.sendUpdate).toHaveLength(1);
    expect(calls.sendUpdate[0].records).toEqual([
      { type: 'NS', ns: 'ns1.example.' },
      { type: 'TXT', txt: ['verification'] },
      { type: 'TXT', txt: ['tag: coffee'] },
      { type: 'TXT', txt: ['tag: sale'] },
    ]);
  });

  it('skips names whose tags already match', async () => {
    const service = makeService([
      { type: 'TXT', txt: ['tag: coffee'] },
      { type: 'TXT', txt: ['tag: sale'] },
    ], calls);

    const result = await service.applyTags([
      { name: 'example', tags: ['sale', 'coffee'] },
    ], '');

    expect(result).toEqual([
      { name: 'example', success: true, skipped: true },
    ]);
    expect(calls.sendUpdate).toHaveLength(0);
  });

  it('clears tags when the list is empty', async () => {
    const service = makeService([
      { type: 'TXT', txt: ['keep'] },
      { type: 'TXT', txt: ['tag: old'] },
    ], calls);

    await service.applyTags([{ name: 'example', tags: [] }], '');
    expect(calls.sendUpdate[0].records).toEqual([
      { type: 'TXT', txt: ['keep'] },
    ]);
  });

  it('returns a per-name error without aborting the batch', async () => {
    const service = makeService([{ type: 'TXT', txt: ['keep'] }], calls, { failSend: true });

    const result = await service.applyTags([
      { name: 'one', tags: ['coffee'] },
      { name: 'two', tags: ['sale'] },
    ], '');

    expect(result.every((item) => !item.success)).toBe(true);
    expect(result[0].error).toContain('not enough funds');
    expect(calls.sendUpdate).toHaveLength(0);
  });
});
