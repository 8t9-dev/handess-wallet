import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'net';
import type { Server } from 'net';
import { isPortOpen } from '../hsd-connection';

describe('isPortOpen', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    server = null;
  });

  it('distinguishes a listening port from a closed port', async () => {
    server = createServer();
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    await expect(isPortOpen('127.0.0.1', address.port, 500)).resolves.toBe(true);

    await new Promise<void>((resolve) => server!.close(() => resolve()));

    await expect(isPortOpen('127.0.0.1', address.port, 500)).resolves.toBe(false);
  });
});
