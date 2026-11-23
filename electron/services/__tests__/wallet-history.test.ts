import { describe, expect, it, vi } from 'vitest';
import { WalletService } from '../wallet-service';
import type { HSDConnectionService } from '../hsd-connection';

const WALLET_ID = 'testagain';
const TX_HASH = 'aa'.repeat(32);
const BLOCK_HASH = 'bb'.repeat(32);
const WALLET_ADDRESS = 'hs1qwalletaddress';
const RECIPIENT_ADDRESS = 'hs1qrecipientaddress';
const SENDER_ADDRESS = 'hs1qsenderaddress';

function makeHarness() {
  const walletClient = {
    execute: vi.fn(async (method: string) => {
      if (method === 'getaddressesbyaccount') return [WALLET_ADDRESS];
      if (method === 'getnames' || method === 'getbids' || method === 'getauctions') return [];
      return null;
    }),
    get: vi.fn(async (path: string) => {
      if (path === `/wallet/${WALLET_ID}/tx/history`) {
        return [
          {
            // The wallet-scoped HTTP endpoint uses `hash`/`height`/`block`,
            // while the legacy JSON-RPC path used `txid`/`blockheight`.
            hash: TX_HASH,
            height: 353_168,
            block: BLOCK_HASH,
            time: 1_793_094_193,
            fee: 10_300,
            confirmations: 1,
            inputs: [{ address: WALLET_ADDRESS, value: 6_884_000 }],
            outputs: [
              { address: RECIPIENT_ADDRESS, value: 6_873_700 },
              { address: WALLET_ADDRESS, value: 10_000 },
            ],
          },
        ];
      }
      throw new Error(`Unexpected GET ${path}`);
    }),
    getAccounts: vi.fn(async () => ['default']),
    getTX: vi.fn(async () => null),
    post: vi.fn(async () => ({ success: true })),
    send: vi.fn(async () => ({ hash: TX_HASH, fee: 10_300 })),
  };

  const nodeClient = {
    getTX: vi.fn(async () => ({
      fee: '0.010300',
      outputs: [
        { address: RECIPIENT_ADDRESS, value: 6_873_700 },
        { address: WALLET_ADDRESS, value: 10_000 },
      ],
      inputs: [
        { address: WALLET_ADDRESS, value: 1_993_000 },
        { address: WALLET_ADDRESS, value: 4_891_000 },
      ],
    })),
    execute: vi.fn(async (_method: string, _params?: unknown[]) => null as string | null),
  };

  const connectionService = {
    getClients: () => ({ walletClient, nodeClient }),
    getConfiguredWalletId: () => WALLET_ID,
  } as unknown as HSDConnectionService;

  return { service: new WalletService(connectionService), walletClient, nodeClient };
}

describe('WalletService.getTxHistory', () => {
  it('uses the active wallet HTTP history and maps its fields', async () => {
    const { service, walletClient } = makeHarness();

    const [tx] = await service.getTxHistory();

    expect(walletClient.get).toHaveBeenCalledWith(
      `/wallet/${WALLET_ID}/tx/history`,
      expect.objectContaining({ account: 'default', limit: 100, reverse: true }),
    );
    // hsd's listhistory RPC throws "Assertion failed" on wallets with
    // unresolved history records, so it must not be used when HTTP works.
    expect(walletClient.execute).not.toHaveBeenCalledWith('listhistory', expect.anything());
    expect(tx).toMatchObject({
      hash: TX_HASH,
      height: 353_168,
      block: BLOCK_HASH,
      time: 1_793_094_193,
      category: 'send',
      amount: -6_873_700,
      fee: 10_300,
      confirmations: 1,
    });
    expect(tx.event).toContain('Sent HNS');
  });

  it('expands a batched FINALIZE into one row per name with a single fee', async () => {
    const { service, walletClient, nodeClient } = makeHarness();
    const names = ['alpha', 'beta', 'gamma'];
    const outputs = [
      ...names.map((name, index) => ({
        address: WALLET_ADDRESS,
        value: 100_000,
        covenant: {
          type: 10,
          action: 'FINALIZE',
          items: [`${index}`.padStart(2, '0').repeat(32), '00000000', Buffer.from(name).toString('hex')],
        },
      })),
      { address: WALLET_ADDRESS, value: 200_000 },
    ];

    walletClient.get.mockResolvedValueOnce([{
      hash: TX_HASH,
      height: 354_000,
      block: BLOCK_HASH,
      time: 1_793_094_193,
      fee: 30_000,
      confirmations: 2,
      inputs: [{ address: WALLET_ADDRESS, value: 500_000, path: { account: 0, index: 0 } }],
      outputs,
    }]);
    nodeClient.getTX.mockResolvedValueOnce({
      fee: '0.030000',
      inputs: [{ address: WALLET_ADDRESS, value: 500_000 }],
      outputs,
    });

    const rows = await service.getTxHistory();

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.name)).toEqual(names);
    expect(rows.map((row) => row.category)).toEqual(['finalize', 'finalize', 'finalize']);
    expect(rows.map((row) => row.event)).toEqual([
      'Finalize transfer of alpha',
      'Finalize transfer of beta',
      'Finalize transfer of gamma',
    ]);
    expect(rows.map((row) => row.fee)).toEqual([30_000, 0, 0]);
    expect(rows.map((row) => row.amount)).toEqual([-30_000, 0, 0]);
    expect(new Set(rows.map((row) => row.rowId)).size).toBe(3);
    expect(rows.every((row) => row.hash === TX_HASH)).toBe(true);
  });

  it('does not charge the recipient a fee for an incoming name transfer', async () => {
    const { service, walletClient, nodeClient } = makeHarness();
    const nameHash = 'cc'.repeat(32);
    const outputs = [
      {
        address: WALLET_ADDRESS,
        value: 500_000,
        covenant: { type: 9, action: 'TRANSFER', items: [nameHash, '00000000'] },
      },
      { address: SENDER_ADDRESS, value: 480_000 },
    ];

    walletClient.get.mockResolvedValueOnce([{
      hash: TX_HASH,
      height: 354_001,
      block: BLOCK_HASH,
      time: 1_793_094_500,
      fee: 0,
      confirmations: 1,
      inputs: [{ address: SENDER_ADDRESS, value: 1_000_000 }],
      outputs,
    }]);
    nodeClient.getTX.mockResolvedValueOnce({
      fee: '0.000200',
      inputs: [{ address: SENDER_ADDRESS, value: 1_000_000 }],
      outputs,
    });
    nodeClient.execute.mockImplementation(async (method: string) =>
      method === 'getnamebyhash' ? 'incomingname' : null);

    const rows = await service.getTxHistory();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hash: TX_HASH,
      category: 'transfer',
      name: 'incomingname',
      amount: 500_000,
      fee: 0,
      event: 'Transfer name incomingname',
    });
  });
});

describe('WalletService.deepClean', () => {
  it('calls the hsd wallet HTTP endpoint with the backup acknowledgement', async () => {
    const { service, walletClient } = makeHarness();

    await service.deepClean();

    expect(walletClient.post).toHaveBeenCalledWith('/deepclean', {
      I_HAVE_BACKED_UP_MY_WALLET: true,
    });
    expect(walletClient.execute).not.toHaveBeenCalledWith('deepclean');
  });
});

describe('WalletService.sendToAddress', () => {
  it('sends from the selected wallet instead of the global pointer', async () => {
    const { service, walletClient } = makeHarness();

    await service.sendToAddress(RECIPIENT_ADDRESS, 6_873_700, 'passphrase', { feeRate: 50_000 });

    expect(walletClient.send).toHaveBeenCalledWith(
      WALLET_ID,
      expect.objectContaining({
        outputs: [{ address: RECIPIENT_ADDRESS, value: 6_873_700 }],
        passphrase: 'passphrase',
        rate: 50_000,
        // The recipient receives the exact amount and the fee is added on top.
        subtractFee: false,
      }),
    );
    expect(walletClient.execute).not.toHaveBeenCalledWith('getwalletinfo');
  });

  it('only subtracts the fee from the amount when explicitly requested', async () => {
    const { service, walletClient } = makeHarness();

    await service.sendToAddress(RECIPIENT_ADDRESS, 6_873_700, 'passphrase', {
      feeRate: 50_000,
      subtractFee: true,
    });

    expect(walletClient.send).toHaveBeenCalledWith(
      WALLET_ID,
      expect.objectContaining({ subtractFee: true }),
    );
  });
});
