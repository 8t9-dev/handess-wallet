import { describe, it, expect, vi } from 'vitest';
import { WalletService } from '../wallet-service';
import type { HSDConnectionService } from '../hsd-connection';

interface FakeOptions {
  encrypted: boolean;
  unlockedUntil: number;
  sign?: (name: string) => Promise<string>;
  wrongPassphrase?: boolean;
}

function makeService(options: FakeOptions) {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const execute = vi.fn(async (method: string, args: unknown[] = []) => {
    calls.push({ method, args });

    switch (method) {
      case 'getwalletinfo':
        return { walletid: 'test-wallet', unlocked_until: options.unlockedUntil };
      case 'walletpassphrase':
        if (options.wrongPassphrase) throw new Error('Invalid passphrase');
        return null;
      case 'walletlock':
        return null;
      case 'signmessagewithname':
        return options.sign
          ? await options.sign(String(args[0]))
          : `sig:${String(args[0])}`;
      default:
        throw new Error(`Unexpected RPC: ${method}`);
    }
  });

  const walletClient = {
    execute,
    getMaster: vi.fn(async () => ({ encrypted: options.encrypted })),
  };

  const connectionService = {
    getClients: () => ({ nodeClient: {}, walletClient }),
  } as unknown as HSDConnectionService;

  return {
    service: new WalletService(connectionService),
    calls,
    walletClient,
  };
}

function methods(calls: Array<{ method: string }>): string[] {
  return calls.map((call) => call.method);
}

describe('WalletService message signing', () => {
  it('signs an unencrypted wallet without unlocking or locking', async () => {
    const { service, calls } = makeService({
      encrypted: false,
      unlockedUntil: 0,
    });

    const signatures = await service.signMessageBatch(
      ['alpha', 'beta'],
      'hello',
      '',
    );

    expect(signatures).toEqual([
      { name: 'alpha', signature: 'sig:alpha' },
      { name: 'beta', signature: 'sig:beta' },
    ]);
    expect(methods(calls)).not.toContain('walletpassphrase');
    expect(methods(calls)).not.toContain('walletlock');
  });

  it('unlocks a locked encrypted wallet once, then locks after the batch', async () => {
    const { service, calls } = makeService({
      encrypted: true,
      unlockedUntil: 0,
    });

    await service.signMessageBatch(['alpha', 'beta'], 'hello', 'secret');

    expect(methods(calls)).toEqual([
      'getwalletinfo',
      'walletpassphrase',
      'signmessagewithname',
      'signmessagewithname',
      'walletlock',
    ]);
    expect(calls[1].args).toEqual(['secret', 300]);
  });

  it('uses an already-unlocked session without a passphrase', async () => {
    const { service, calls } = makeService({
      encrypted: true,
      unlockedUntil: Math.floor(Date.now() / 1000) + 120,
    });

    await service.signMessageBatch(['alpha'], 'hello', '');

    expect(methods(calls)).not.toContain('walletpassphrase');
    expect(methods(calls)).not.toContain('walletlock');
  });

  it('re-authenticates when a passphrase is supplied for an unlocked wallet', async () => {
    const { service, calls } = makeService({
      encrypted: true,
      unlockedUntil: Math.floor(Date.now() / 1000) + 120,
    });

    await service.signMessageBatch(['alpha'], 'hello', 'secret');

    expect(methods(calls)).toContain('walletpassphrase');
    expect(methods(calls)).toContain('walletlock');
  });

  it('rejects a locked wallet when no passphrase is supplied', async () => {
    const { service, calls } = makeService({
      encrypted: true,
      unlockedUntil: 0,
    });

    await expect(
      service.signMessageBatch(['alpha'], 'hello', ''),
    ).rejects.toThrow(/locked/i);

    expect(methods(calls)).not.toContain('signmessagewithname');
  });

  it('locks the wallet again when the passphrase is wrong', async () => {
    const { service, calls } = makeService({
      encrypted: true,
      unlockedUntil: 0,
      wrongPassphrase: true,
    });

    await expect(
      service.signMessageBatch(['alpha'], 'hello', 'wrong'),
    ).rejects.toThrow(/passphrase/i);

    expect(methods(calls)).toContain('walletlock');
    expect(methods(calls)).not.toContain('signmessagewithname');
  });

  it('keeps signing other names when one name fails', async () => {
    const { service } = makeService({
      encrypted: false,
      unlockedUntil: 0,
      sign: async (name) => {
        if (name === 'bad') throw new Error('Cannot find the name owner.');
        return `sig:${name}`;
      },
    });

    const results = await service.signMessageBatch(
      ['good', 'bad', 'also-good'],
      'hello',
      '',
    );

    expect(results).toEqual([
      { name: 'good', signature: 'sig:good' },
      {
        name: 'bad',
        signature: null,
        error: 'Cannot find the name owner.',
      },
      { name: 'also-good', signature: 'sig:also-good' },
    ]);
  });

  it('signs a single name with the supplied passphrase', async () => {
    const { service, calls } = makeService({
      encrypted: true,
      unlockedUntil: 0,
    });

    const signature = await service.signMessageWithName(
      'alpha',
      'hello',
      'secret',
    );

    expect(signature).toBe('sig:alpha');
    expect(methods(calls)).toEqual([
      'getwalletinfo',
      'walletpassphrase',
      'signmessagewithname',
      'walletlock',
    ]);
  });
});
