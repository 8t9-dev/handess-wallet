/**
 * Compatibility patch for @keep-network/electrum-client-js.
 *
 * The library's notification handler calls `this.subscribe.emit(...)`, but its
 * constructor only initializes `this.events`. The first unsolicited server
 * notification (for example a `blockchain.headers.subscribe` update) therefore
 * throws `Cannot read properties of undefined (reading 'emit')` inside the
 * Electron main process.
 *
 * Alias `subscribe` to `events` and contain notification parsing failures so a
 * bad server message cannot take down the app.
 */

interface ElectrumClientInternals {
  events?: { emit: (event: string, ...args: unknown[]) => boolean };
  subscribe?: { emit: (event: string, ...args: unknown[]) => boolean };
  onMessage?: (body: string, requestId: number) => void;
}

export function patchElectrumClientNotifications<T extends object>(client: T): T {
  const internals = client as T & ElectrumClientInternals;

  if (internals.events && !internals.subscribe) {
    internals.subscribe = internals.events;
  }

  if (typeof internals.onMessage === 'function') {
    const original = internals.onMessage.bind(internals);
    internals.onMessage = (body: string, requestId: number) => {
      try {
        original(body, requestId);
      } catch (error) {
        console.warn('[ElectrumDGB] Ignoring malformed server notification:', error);
      }
    };
  }

  return client;
}
