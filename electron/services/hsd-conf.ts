/**
 * hsd.conf helpers.
 *
 * The API key must never be passed on the process command line: argv is
 * readable by other local processes. Instead it is written to hsd.conf,
 * which hsd loads from its prefix directory.
 */

import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { userInfo } from 'os';
import { join } from 'path';

/** Generate a 256-bit API key for the node/wallet RPC endpoints. */
export function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

/** hsd appends the network name to its prefix for non-main networks. */
export function hsdPrefixDir(dataDir: string, network: string): string {
  return network === 'main' ? dataDir : join(dataDir, network);
}

/**
 * Create or update `<prefix>/hsd.conf` with the given API key.
 * Existing settings are preserved. Returns the conf path, or null when the
 * key is empty.
 */
export function ensureApiKeyConf(
  dataDir: string,
  apiKey: string,
  network = 'main'
): string | null {
  if (!apiKey) return null;

  const prefixDir = hsdPrefixDir(dataDir, network);
  if (!existsSync(prefixDir)) {
    mkdirSync(prefixDir, { recursive: true });
  }

  const confPath = join(prefixDir, 'hsd.conf');
  const existing = existsSync(confPath) ? readFileSync(confPath, 'utf8') : '';
  const line = `api-key: ${apiKey}`;
  const apiKeyPattern = /^[ \t]*api-key[ \t]*[:=].*$/m;

  let content: string;
  if (apiKeyPattern.test(existing)) {
    content = existing.replace(apiKeyPattern, line);
  } else {
    const trimmed = existing.replace(/\s*$/, '');
    content = `${trimmed ? `${trimmed}\n` : ''}${line}\n`;
  }

  writeFileSync(confPath, content, { encoding: 'utf8', mode: 0o600 });
  restrictFilePermissions(confPath);
  return confPath;
}

/**
 * Read the API key already stored in `<prefix>/hsd.conf`, if any.
 * Reusing it keeps RPC authentication stable across node restarts.
 */
export function readApiKeyConf(dataDir: string, network = 'main'): string | null {
  const confPath = join(hsdPrefixDir(dataDir, network), 'hsd.conf');
  if (!existsSync(confPath)) return null;

  try {
    const content = readFileSync(confPath, 'utf8');
    const match = content.match(/^[ \t]*api-key[ \t]*[:=][ \t]*(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Limit file access to the current user, SYSTEM and Administrators.
 * On Windows Node's chmod does not translate to ACLs, so use icacls.
 */
export function restrictFilePermissions(filePath: string): void {
  try {
    if (process.platform === 'win32') {
      const account = process.env.USERDOMAIN && process.env.USERNAME
        ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
        : userInfo().username;

      const run = (args: string[]) =>
        execFileSync('icacls', args, { windowsHide: true, stdio: 'ignore' });

      // Drop inherited ACEs first, then remove any explicit broad ACEs left
      // over from a pre-existing conf file.
      run([filePath, '/inheritance:r']);
      for (const sid of ['*S-1-5-11', '*S-1-5-32-545', '*S-1-5-4', '*S-1-1-0']) {
        try {
          run([filePath, '/remove:g', sid]);
        } catch {
          // ACE was not present.
        }
      }

      run([
        filePath,
        '/grant:r',
        `${account}:F`,
        'SYSTEM:F',
        'BUILTIN\\Administrators:F',
      ]);
    } else {
      chmodSync(filePath, 0o600);
    }
  } catch (error) {
    // Non-fatal: the key is still out of the process list.
    console.warn('[HSDProcess] Could not restrict hsd.conf permissions:', error);
  }
}
