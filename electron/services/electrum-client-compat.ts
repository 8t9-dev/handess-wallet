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
 *
 * ElectrumX 2.0 also requires `server.version` to be the first request on a
 * connection. The bundled client calls `server.banner` first, which newer
 * servers reject with "use server.version to identify client". Skip the
 * banner during connect so the client negotiates the protocol version first.
 */

interface ElectrumClientInternals {
  events?: { emit: (event: string, ...args: unknown[]) => boolean };
  subscribe?: { emit: (event: string, ...args: unknown[]) => boolean };
  onMessage?: (body: string, requestId: number) => void;
}

interface ElectrumHandshakeClient {
  connect: (clientName: string, protocolVersion: string) => Promise<void>;
  server_banner?: () => Promise<unknown>;
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

/**
 * Connect with the protocol version negotiated before any other request.
 *
 * The bundled client's `connect()` fetches the server banner first. ElectrumX
 * 2.0 rejects that until the client identifies itself, so temporarily suppress
 * the banner request; `connect()` then sends `server.version` immediately after
 * the socket opens.
 */
export async function connectElectrumClient(
  client: ElectrumHandshakeClient,
  clientName: string,
  protocolVersion: string,
): Promise<void> {
  const originalBanner = client.server_banner;
  client.server_banner = async () => '';

  try {
    await client.connect(clientName, protocolVersion);
  } finally {
    if (originalBanner) {
      client.server_banner = originalBanner;
    } else {
      delete client.server_banner;
    }
  }
}
