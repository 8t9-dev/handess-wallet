import { createHash } from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync, gunzipSync } from 'zlib';

import { SearchIndexService } from '../search-index-service';
import type { HSDConnectionService } from '../hsd-connection';
import type { HnsIndexRecord } from '../../../src/types/search-engine';
import { buildRawBlock } from '../../../src/lib/__tests__/hns-block-fixture';

interface FakeNode {
  infos: Record<string, Record<string, unknown> | null>;
  resources: Record<string, Array<Record<string, unknown>>>;
  failResources: Set<string>;
  resourceCalls: string[];
  namesByHash: Record<string, string>;
  blocks: Record<number, string>;
  failBlocks: Set<number>;
  height: number;
  onBlock?: (height: number) => void;
}

const EMPTY_BLOCK = buildRawBlock([]);

function makeNode(): FakeNode {
  return {
    infos: {},
    resources: {},
    failResources: new Set(),
    resourceCalls: [],
    namesByHash: {},
    blocks: {},
    failBlocks: new Set(),
    height: 500,
  };
}

function hashOf(name: string): string {
  return createHash('sha3-256').update(name).digest('hex');
}

type RefreshAction = 'REGISTER' | 'UPDATE' | 'RENEW' | 'FINALIZE' | 'REVOKE';

const COVENANT_TYPES: Record<RefreshAction, number> = {
  REGISTER: 6,
  UPDATE: 7,
  RENEW: 8,
  FINALIZE: 10,
  REVOKE: 11,
};

function blockWithCovenant(
  action: RefreshAction,
  hash: string,
  resource: Buffer = Buffer.from([0]),
): string {
  const nameHash = Buffer.from(hash, 'hex');
  const height = Buffer.alloc(4);
  const blockHash = Buffer.alloc(32, 0xff);
  let items: Buffer[];

  if (action === 'REGISTER') {
    items = [nameHash, height, resource, blockHash];
  } else if (action === 'UPDATE') {
    items = [nameHash, height, resource];
  } else if (action === 'RENEW') {
    items = [nameHash, height, blockHash];
  } else if (action === 'REVOKE') {
    items = [nameHash];
  } else {
    items = [nameHash, height];
  }

  return buildRawBlock([{ type: COVENANT_TYPES[action], items }]);
}

/** Resource data longer than one byte means the name publishes records. */
function resourceData(): Buffer {
  return Buffer.from([0, 6, 1, 1, 0x41]);
}

function makeService(
  seedPath: string,
  userIndexPath: string,
  node: FakeNode,
): SearchIndexService {
  const connection = {
    getClients: () => ({
      nodeClient: {
        async execute(method: string, params: unknown[]) {
          if (method === 'getnameinfo') {
            const name = String(params[0]);
            return { info: node.infos[name] ?? null };
          }
          if (method === 'getnameresource') {
            const name = String(params[0]);
            node.resourceCalls.push(name);
            if (node.failResources.has(name)) {
              throw new Error(`RPC unavailable for ${name}`);
            }
            const records = node.resources[name];
            return records ? { records } : null;
          }
          if (method === 'getnamebyhash') {
            return node.namesByHash[String(params[0])] ?? null;
          }
          if (method === 'getblockbyheight') {
            const height = Number(params[0]);
            node.onBlock?.(height);
            if (node.failBlocks.has(height)) return null;
            return node.blocks[height] ?? EMPTY_BLOCK;
          }
          throw new Error(`Unexpected RPC ${method}`);
        },
        async getInfo() {
          return { chain: { height: node.height } };
        },
      },
    }),
  } as unknown as HSDConnectionService;

  return new SearchIndexService(connection, { seedPath, userIndexPath });
}

function writeSeed(filePath: string, records: HnsIndexRecord[]): void {
  const lines = [
    JSON.stringify({ type: 'header', version: 1, network: 'main', height: 400 }),
    ...records.map((record) => JSON.stringify(record)),
  ];
  writeFileSync(filePath, gzipSync(`${lines.join('\n')}\n`));
}

function record(name: string, overrides: Partial<HnsIndexRecord> = {}): HnsIndexRecord {
  return {
    name,
    state: 'CLOSED',
    renewal: 100,
    expiryBlock: 200,
    recordTypes: ['NS'],
    ns: [`ns.${name}.`],
    addresses: [],
    tags: [],
    txt: [],
    hasNS: true,
    hasDS: false,
    hasTXT: false,
    hasWebsite: true,
    ...overrides,
  };
}

describe('SearchIndexService', () => {
  let dir: string;
  let seedPath: string;
  let userIndexPath: string;
  let node: FakeNode;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hns-index-'));
    seedPath = join(dir, 'seed.ndjson.gz');
    userIndexPath = join(dir, 'user-index.ndjson.gz');
    node = makeNode();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads the bundled seed and searches it', async () => {
    writeSeed(seedPath, [
      record('alpha'),
      record('beta', {
        recordTypes: ['TXT'],
        ns: [],
        hasNS: false,
        hasWebsite: false,
        hasTXT: true,
        txt: ['tag:coffee'],
        tags: ['coffee'],
      }),
    ]);

    const service = makeService(seedPath, userIndexPath, node);
    const status = await service.getStatus();
    expect(status.source).toBe('bundled-seed');
    expect(status.nameCount).toBe(2);

    const byName = await service.search({ query: 'alp' });
    expect(byName.records.map((item) => item.name)).toEqual(['alpha']);

    const byTag = await service.search({ query: 'tag:coffee' });
    expect(byTag.records.map((item) => item.name)).toEqual(['beta']);
  });

  it('layers refreshed names on top of the seed and persists only the overlay', async () => {
    writeSeed(seedPath, [record('alpha'), record('beta')]);
    node.infos.gamma = { state: 'CLOSED', renewal: 300 };
    node.resources.gamma = [{ type: 'NS', ns: 'ns.gamma.' }];

    const service = makeService(seedPath, userIndexPath, node);
    await service.getStatus();

    const refreshed = await service.refreshName('gamma');
    expect(refreshed?.name).toBe('gamma');
    expect((await service.getStatus()).source).toBe('bundled-seed+node');
    expect((await service.getStatus()).nameCount).toBe(3);
    // A single-name lookup must not pretend the whole directory reached tip.
    expect((await service.getStatus()).blockHeight).toBe(400);

    // A name that is no longer registered becomes a tombstone.
    node.infos.alpha = null;
    expect(await service.refreshName('alpha')).toBeNull();
    expect((await service.getStatus()).nameCount).toBe(2);

    await service.flush();

    const overlay = gunzipSync(readFileSync(userIndexPath));
    const text = overlay.toString('utf8');
    expect(text).not.toContain('"beta"');
    expect(text).toContain('"gamma"');
    expect(text).toContain('"deleted":true');
  });

  it('does not tombstone a name when its resource lookup fails', async () => {
    writeSeed(seedPath, [record('alpha')]);
    node.infos.alpha = { state: 'CLOSED', renewal: 450 };
    node.failResources.add('alpha');

    const service = makeService(seedPath, userIndexPath, node);
    await service.getStatus();

    await expect(service.refreshName('alpha')).rejects.toThrow('RPC unavailable');
    const alpha = (await service.search({ query: 'alpha' })).records[0];
    expect(alpha.name).toBe('alpha');
    expect(alpha.ns).toEqual(['ns.alpha.']);
    expect((await service.getStatus()).nameCount).toBe(1);
  });

  it('refreshes names found in recent block covenants', async () => {
    writeSeed(seedPath, [record('alpha')]);
    node.height = 500;
    node.blocks[500] = blockWithCovenant('UPDATE', hashOf('alpha'), resourceData());
    node.infos.alpha = { state: 'CLOSED', renewal: 450 };
    node.resources.alpha = [{ type: 'NS', ns: 'ns.updated.alpha.' }];

    const service = makeService(seedPath, userIndexPath, node);
    await service.getStatus();
    const result = await service.refreshRecent(100);

    expect(result.updated).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(result.scannedBlocks).toBe(100);
    expect(result.fromHeight).toBe(401);
    expect(result.toHeight).toBe(500);
    expect(result.blockHeight).toBe(500);
    expect((await service.getStatus()).source).toBe('bundled-seed+node');

    const alpha = (await service.search({ query: 'alpha' })).records[0];
    expect(alpha.ns).toEqual(['ns.updated.alpha.']);
    expect(alpha.renewal).toBe(450);
  });

  it('removes names when an update clears the resource data', async () => {
    writeSeed(seedPath, [record('alpha'), record('beta')]);
    node.blocks[500] = blockWithCovenant('UPDATE', hashOf('alpha'), Buffer.from([0]));

    const service = makeService(seedPath, userIndexPath, node);
    await service.getStatus();
    const result = await service.refreshRecent(100);

    expect(result.updated).toBe(0);
    expect(result.removed).toBe(1);
    expect((await service.search({ query: 'alpha' })).total).toBe(0);
    expect((await service.search({ query: 'beta' })).total).toBe(1);

    await service.flush();
    const text = gunzipSync(readFileSync(userIndexPath)).toString('utf8');
    expect(text).toContain('"deleted":true');
  });

  it('advances expiry for renewals without resolving resource records', async () => {
    writeSeed(seedPath, [record('alpha', { renewal: 100, expiryBlock: 105220 })]);
    node.blocks[500] = blockWithCovenant('RENEW', hashOf('alpha'));

    const service = makeService(seedPath, userIndexPath, node);
    await service.getStatus();
    const result = await service.refreshRecent(100);

    expect(result.updated).toBe(1);
    expect(node.resourceCalls).not.toContain('alpha');

    const alpha = (await service.search({ query: 'alpha' })).records[0];
    expect(alpha.renewal).toBe(500);
    expect(alpha.expiryBlock).toBe(500 + 105120);
  });

  it('adds tagged/custom-DNS registrations but skips plain TXT-only names', async () => {
    writeSeed(seedPath, [record('alpha')]);
    node.blocks[499] = blockWithCovenant('REGISTER', hashOf('tagged'), resourceData());
    node.blocks[500] = blockWithCovenant('REGISTER', hashOf('plain'), resourceData());
    node.namesByHash[hashOf('tagged')] = 'tagged';
    node.namesByHash[hashOf('plain')] = 'plain';
    node.infos.tagged = { state: 'CLOSED', renewal: 450 };
    node.infos.plain = { state: 'CLOSED', renewal: 450 };
    node.resources.tagged = [{ type: 'TXT', txt: ['tag: coffee'] }];
    node.resources.plain = [{ type: 'TXT', txt: ['hello bulk registration'] }];

    const service = makeService(seedPath, userIndexPath, node);
    await service.getStatus();
    const result = await service.refreshRecent(100);

    expect(result.updated).toBe(1);
    const tagged = (await service.search({ query: 'tagged' })).records[0];
    expect(tagged.tags).toEqual(['coffee']);
    expect((await service.search({ query: 'plain' })).total).toBe(0);
  });

  it('cancels without applying a partial scan', async () => {
    writeSeed(seedPath, [record('alpha')]);
    node.blocks[500] = blockWithCovenant('UPDATE', hashOf('alpha'), resourceData());
    node.infos.alpha = { state: 'CLOSED', renewal: 450 };
    node.resources.alpha = [{ type: 'NS', ns: 'ns.updated.alpha.' }];

    const service = makeService(seedPath, userIndexPath, node);
    await service.getStatus();
    node.onBlock = (height) => {
      if (height === 421) void service.cancelRefresh();
    };

    const result = await service.refreshRecent(100);

    expect(result.cancelled).toBe(true);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.scannedBlocks).toBeLessThan(100);
    expect(result.blockHeight).toBe(400);

    const alpha = (await service.search({ query: 'alpha' })).records[0];
    expect(alpha.ns).toEqual(['ns.alpha.']);
  });

  it('does not advance the refresh height when a block cannot be read', async () => {
    writeSeed(seedPath, [record('alpha')]);
    node.failBlocks.add(450);

    const service = makeService(seedPath, userIndexPath, node);
    await service.getStatus();

    await expect(service.refreshRecent(100)).rejects.toThrow('Could not read 1 block');
    expect((await service.getStatus()).blockHeight).toBe(400);
  });

  it('restores the completed refresh height after a restart', async () => {
    writeSeed(seedPath, [record('alpha')]);
    node.blocks[500] = blockWithCovenant('UPDATE', hashOf('alpha'), resourceData());
    node.infos.alpha = { state: 'CLOSED', renewal: 450 };
    node.resources.alpha = [{ type: 'NS', ns: 'ns.updated.alpha.' }];

    const first = makeService(seedPath, userIndexPath, node);
    await first.getStatus();
    await first.refreshRecent(100);
    await first.flush();

    const second = makeService(seedPath, userIndexPath, node);
    const status = await second.getStatus();
    expect(status.blockHeight).toBe(500);
    expect(status.source).toBe('bundled-seed+node');
  });

  it('applies the saved overlay on top of a newer bundled seed', async () => {
    writeSeed(seedPath, [record('alpha'), record('beta')]);
    node.infos.gamma = { state: 'CLOSED', renewal: 300 };
    node.resources.gamma = [{ type: 'NS', ns: 'ns.gamma.' }];

    const first = makeService(seedPath, userIndexPath, node);
    await first.getStatus();
    await first.refreshName('gamma');
    node.infos.alpha = null;
    await first.refreshName('alpha');
    await first.flush();

    // Simulate the next app release: new seed adds delta and still has alpha.
    writeSeed(seedPath, [record('alpha'), record('beta'), record('delta')]);

    const second = makeService(seedPath, userIndexPath, node);
    const status = await second.getStatus();
    expect(status.source).toBe('bundled-seed+node');
    expect(status.nameCount).toBe(3);

    const names = (await second.search({ sort: 'name' })).records.map((item) => item.name);
    expect(names).toEqual(['beta', 'delta', 'gamma']);
  });
});
