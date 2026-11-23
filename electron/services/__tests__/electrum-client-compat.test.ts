import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  connectElectrumClient,
  patchElectrumClientNotifications,
} from '../electrum-client-compat';

describe('patchElectrumClientNotifications', () => {
  it('routes server notifications through the events emitter', () => {
    const events = new EventEmitter();
    const client = {
      events,
      subscribe: undefined as EventEmitter | undefined,
      onMessage(body: string, _requestId?: number) {
        const message = JSON.parse(body);
        if (message.id !== undefined) return;
        this.subscribe?.emit(message.method, message.params);
      },
    };

    patchElectrumClientNotifications(client);
    const listener = vi.fn();
    events.on('blockchain.headers.subscribe', listener);

    expect(() => client.onMessage(JSON.stringify({
      method: 'blockchain.headers.subscribe',
      params: [{ height: 123 }],
    }))).not.toThrow();
    expect(listener).toHaveBeenCalledWith([{ height: 123 }]);
  });

  it('contains malformed notifications instead of crashing the process', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = {
      events: new EventEmitter(),
      onMessage: vi.fn(() => {
        throw new Error('bad notification');
      }),
    };

    patchElectrumClientNotifications(client);

    expect(() => client.onMessage('not-json', 1)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('connectElectrumClient', () => {
  it('negotiates server.version before the bundled client requests the banner', async () => {
    const calls: string[] = [];
    const client = {
      server_banner: vi.fn(async () => {
        calls.push('banner');
        return '';
      }),
      async connect(clientName: string, protocolVersion: string) {
        // Mirrors @keep-network/electrum-client-js 0.2.0: banner first.
        await this.server_banner();
        calls.push(`version:${clientName}:${protocolVersion}`);
      },
    };

    await connectElectrumClient(client, 'Handess Wallet', '1.4');

    expect(calls).toEqual(['version:Handess Wallet:1.4']);
  });

  it('restores the original banner method after connecting', async () => {
    const originalBanner = vi.fn(async () => 'welcome');
    const client = {
      server_banner: originalBanner,
      async connect() { /* no-op */ },
    };

    await connectElectrumClient(client, 'Handess Wallet', '1.4');

    expect(client.server_banner).toBe(originalBanner);
  });

  it('restores the original banner method when the connection fails', async () => {
    const originalBanner = vi.fn(async () => 'welcome');
    const client = {
      server_banner: originalBanner,
      async connect() {
        throw new Error('connection refused');
      },
    };

    await expect(connectElectrumClient(client, 'Handess Wallet', '1.4'))
      .rejects.toThrow('connection refused');
    expect(client.server_banner).toBe(originalBanner);
  });
});
