import { afterEach, describe, expect, it } from 'vitest';
import { createServer, Server } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HSDProcessService } from '../hsd-process';

describe('HSDProcessService safety', () => {
  let server: Server | null = null;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('refuses to start when a node is already listening and leaves it running', async () => {
    server = createServer();
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(13037, '127.0.0.1', resolve);
    });

    const dataDir = mkdtempSync(join(tmpdir(), 'hsd-process-test-'));
    tempDirs.push(dataDir);

    const service = new HSDProcessService();
    const started = await service.start({ dataDir, network: 'testnet' });

    expect(started).toBe(false);
    expect(service.lastError).toMatch(/already running/i);
    expect(server.listening).toBe(true);
  });
});
