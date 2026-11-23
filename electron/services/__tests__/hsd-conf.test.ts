import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureApiKeyConf, generateApiKey, readApiKeyConf } from '../hsd-conf';

const createdDirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hsd-conf-test-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('generateApiKey', () => {
  it('generates a unique 256-bit hex key', () => {
    const first = generateApiKey();
    const second = generateApiKey();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});

describe('ensureApiKeyConf', () => {
  it('creates hsd.conf with the API key', () => {
    const dir = makeDir();
    const confPath = ensureApiKeyConf(dir, 'abc123');

    expect(confPath).toBe(join(dir, 'hsd.conf'));
    expect(readFileSync(confPath!, 'utf8')).toBe('api-key: abc123\n');
  });

  it('preserves unrelated settings', () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'hsd.conf'), 'network: main\nworkers: 2\n');

    ensureApiKeyConf(dir, 'abc123');
    const content = readFileSync(join(dir, 'hsd.conf'), 'utf8');

    expect(content).toContain('network: main');
    expect(content).toContain('workers: 2');
    expect(content).toContain('api-key: abc123');
  });

  it('replaces an existing API key without duplicating it', () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, 'hsd.conf'),
      'network: main\napi-key: old-key\nindex-tx: true\n'
    );

    ensureApiKeyConf(dir, 'new-key');
    ensureApiKeyConf(dir, 'new-key');
    const content = readFileSync(join(dir, 'hsd.conf'), 'utf8');

    expect(content).not.toContain('old-key');
    expect(content.match(/^api-key:/gm)).toHaveLength(1);
    expect(content).toContain('api-key: new-key');
    expect(content).toContain('index-tx: true');
  });

  it('uses the network subdirectory for non-main networks', () => {
    const dir = makeDir();
    const confPath = ensureApiKeyConf(dir, 'abc123', 'regtest');

    expect(confPath).toBe(join(dir, 'regtest', 'hsd.conf'));
    expect(readFileSync(confPath!, 'utf8')).toBe('api-key: abc123\n');
  });

  it('reads back the stored API key', () => {
    const dir = makeDir();
    ensureApiKeyConf(dir, 'abc123');

    expect(readApiKeyConf(dir)).toBe('abc123');
  });

  it('reads the key from the network subdirectory', () => {
    const dir = makeDir();
    ensureApiKeyConf(dir, 'test-key', 'testnet');

    expect(readApiKeyConf(dir, 'testnet')).toBe('test-key');
    expect(readApiKeyConf(dir)).toBeNull();
  });

  it('returns null when no conf or key exists', () => {
    const dir = makeDir();

    expect(readApiKeyConf(dir)).toBeNull();
  });

  it('does nothing when the API key is empty', () => {
    const dir = makeDir();

    expect(ensureApiKeyConf(dir, '')).toBeNull();
    expect(existsSync(join(dir, 'hsd.conf'))).toBe(false);
  });
});
