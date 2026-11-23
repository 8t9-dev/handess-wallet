import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { patchElectrumClientNotifications } from '../electrum-client-compat';

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
