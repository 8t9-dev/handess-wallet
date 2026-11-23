/**
 * Config Service
 *
 * Manages application configuration and hsd discovery.
 */

import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import type { HSDConnectionConfig } from '../../src/types/wallet';

const BOB_DATA_DIRS: Record<string, string[]> = {
  win32: [
    join(process.env.APPDATA || '', 'Bob', 'hsd_data'),
    join(process.env.APPDATA || '', 'Bob', 'hsd'),
    join(process.env.APPDATA || '', 'Bob'),
  ],
  darwin: [
    join(process.env.HOME || '', 'Library', 'Application Support', 'Bob', 'hsd_data'),
    join(process.env.HOME || '', 'Library', 'Application Support', 'Bob'),
  ],
  linux: [
    join(process.env.HOME || '', '.config', 'Bob', 'hsd_data'),
    join(process.env.HOME || '', '.config', 'Bob'),
  ],
};

const HSD_DATA_DIRS: Record<string, string> = {
  win32: join(homedir(), '.hsd'),
  darwin: join(process.env.HOME || homedir(), '.hsd'),
  linux: join(process.env.HOME || homedir(), '.hsd'),
};

const CUSTOM_HSD_DIRS: string[] = [];

function getDefaultNodePort(network: string): number {
  switch (network) {
    case 'testnet': return 13037;
    case 'regtest': return 14037;
    default: return 12037;
  }
}

function getDefaultWalletPort(network: string): number {
  switch (network) {
    case 'testnet': return 13039;
    case 'regtest': return 14039;
    default: return 12039;
  }
}

function parseConfigValue(content: string, key: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.length === 0) continue;
    const match = trimmed.match(new RegExp(`^${key}\\s*[=:]\\s*(.+)$`));
    if (match) return match[1].trim();
  }
  return null;
}

export class ConfigService {
  private dataDir: string = '';

  async initialize(): Promise<void> {
    this.dataDir = app.getPath('userData');
  }

  getDataDir(): string {
    return this.dataDir || app.getPath('userData');
  }

  async detectBobWalletConfig(): Promise<HSDConnectionConfig | null> {
    const possibleDirs = [...(BOB_DATA_DIRS[process.platform] || []), ...CUSTOM_HSD_DIRS];
    
    let nodeApiKey: string | null = null;
    let walletApiKey: string | null = null;
    let detectedNetwork = 'main';

    for (const bobDataDir of possibleDirs) {
      if (!existsSync(bobDataDir)) continue;

      // 1. Try to find Node API Key
      if (!nodeApiKey) {
        // Try hsd.conf
        const confPath = join(bobDataDir, 'hsd.conf');
        if (existsSync(confPath)) {
          try {
            const confContent = readFileSync(confPath, 'utf-8');
            nodeApiKey = parseConfigValue(confContent, 'api-key');
            detectedNetwork = parseConfigValue(confContent, 'network') || detectedNetwork;
          } catch { /* ignore */ }
        }

        // Try direct api-key files if still not found
        if (!nodeApiKey) {
          const keyFiles = ['api-key', 'key', 'api_key'];
          for (const fileName of keyFiles) {
            const apiKeyPath = join(bobDataDir, fileName);
            if (existsSync(apiKeyPath)) {
              try {
                nodeApiKey = readFileSync(apiKeyPath, 'utf-8').trim();
                break;
              } catch { /* ignore */ }
            }
          }
        }
      }

      // 2. Try to find Wallet API Key
      if (!walletApiKey) {
        const walletConfPath = join(bobDataDir, 'wallet.conf');
        if (existsSync(walletConfPath)) {
          try {
            const confContent = readFileSync(walletConfPath, 'utf-8');
            walletApiKey = parseConfigValue(confContent, 'api-key');
            detectedNetwork = parseConfigValue(confContent, 'network') || detectedNetwork;
          } catch { /* ignore */ }
        }
      }

      // If we found both, we can stop early
      if (nodeApiKey && walletApiKey) break;
    }

    // If we found at least one key, build the config.
    //
    // Leave walletId empty: hsd's wallet RPC has one global "selected wallet"
    // pointer, and Bob Wallet sets it when the user logs in. Forcing
    // "primary" here would silently switch Bob (and this app) to an empty
    // wallet. An empty walletId tells the connection service to keep
    // whatever wallet the node already has selected.
    if (nodeApiKey || walletApiKey) {
      return this.buildConfig(
        nodeApiKey || walletApiKey || '', 
        detectedNetwork, 
        '',
        nodeApiKey || undefined,
        walletApiKey || undefined
      );
    }

    return null;
  }

  /**
   * Detect available wallet names by scanning the wallets directory.
   * hsd stores wallets in <dataDir>/wallet/wallets/<wallet-name>/
   * Also checks Bob Wallet's custom data directory from hosts.json.
   *
   * @returns Array of wallet names found, sorted alphabetically
   */
  detectWalletNames(): string[] {
    const wallets: Set<string> = new Set();

    // Check all possible HSD data directories
    const dirsToCheck: string[] = [];

    // Default Bob Wallet data directories
    const possibleDirs = BOB_DATA_DIRS[process.platform] || [];
    for (const dir of possibleDirs) {
      if (existsSync(dir)) {
        dirsToCheck.push(dir);
        // Also check for custom HSD directory from hosts.json in this dir
        const customDir = this.findCustomHSDirectory(dir);
        if (customDir && existsSync(customDir) && !dirsToCheck.includes(customDir)) {
          dirsToCheck.push(customDir);
        }
      }
    }

    // Custom HSD directories (common user-configured paths)
    for (const dir of CUSTOM_HSD_DIRS) {
      if (existsSync(dir) && !dirsToCheck.includes(dir)) {
        dirsToCheck.push(dir);
      }
    }

    // Scan each directory for wallets
    for (const baseDir of dirsToCheck) {
      // 1. Check if the root wallet directory is itself a LevelDB database (single-wallet setup)
      // hsd uses "CURRENT" file to indicate a LevelDB database
      const walletRoot = join(baseDir, 'wallet');
      if (existsSync(walletRoot) && existsSync(join(walletRoot, 'CURRENT'))) {
        wallets.add('primary');
      }

      // 2. hsd stores wallets in wallet/wallets/ (multi-wallet setup)
      const walletsSubDir = join(baseDir, 'wallet', 'wallets');
      if (existsSync(walletsSubDir)) {
        try {
          const entries = readdirSync(walletsSubDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              wallets.add(entry.name);
            }
          }
        } catch { /* ignore */ }
      }

      // 3. Some setups might use just wallets/ at the root
      const rootWalletsDir = join(baseDir, 'wallets');
      if (existsSync(rootWalletsDir)) {
        try {
          const entries = readdirSync(rootWalletsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              wallets.add(entry.name);
            }
          }
        } catch { /* ignore */ }
      }
    }

    return Array.from(wallets).sort();
  }

  /**
   * Find custom HSD directory from Bob Wallet's hosts.json file.
   */
  private findCustomHSDirectory(bobDataDir: string): string | null {
    const bobDir = join(bobDataDir, '..');
    const hostsPath = join(bobDir, 'hosts.json');

    if (existsSync(hostsPath)) {
      try {
        const hosts = JSON.parse(readFileSync(hostsPath, 'utf-8'));
        if (typeof hosts.hsdDir === 'string') return hosts.hsdDir;
        if (typeof hosts.hsdDirectory === 'string') return hosts.hsdDirectory;
        if (typeof hosts.dataDir === 'string') return hosts.dataDir;
        if (typeof hosts.directory === 'string') return hosts.directory;
        if (typeof hosts.path === 'string') return hosts.path;
        if (Array.isArray(hosts)) {
          for (const host of hosts) {
            if (typeof host.hsdDir === 'string') return host.hsdDir;
            if (typeof host.hsdDirectory === 'string') return host.hsdDirectory;
            if (typeof host.dataDir === 'string') return host.dataDir;
            if (typeof host.directory === 'string') return host.directory;
            if (typeof host.path === 'string') return host.path;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    return null;
  }

  private buildConfig(apiKey: string, network: string, walletId: string, nodeApiKey?: string, walletApiKey?: string): HSDConnectionConfig {
    return {
      host: '127.0.0.1',
      nodePort: getDefaultNodePort(network),
      walletPort: getDefaultWalletPort(network),
      apiKey,
      nodeApiKey: nodeApiKey || apiKey,
      walletApiKey: walletApiKey || apiKey,
      network: network as 'main' | 'testnet' | 'regtest',
      walletId,
      ssl: false,
    };
  }

  getBobDataDir(): string | null {
    const dirs = BOB_DATA_DIRS[process.platform];
    return dirs ? dirs[0] : null;
  }

  /**
   * Get the default hsd data directory for the current platform.
   */
  getDefaultHsdDataDir(): string {
    return HSD_DATA_DIRS[process.platform] || join(process.env.HOME || '', '.hsd');
  }

  /**
   * Detect hsd script location (the JS file, not the .cmd wrapper).
   * Returns the path to `hsd/bin/hsd` which can be spawned via `node <path>`.
   */
  async detectHsdBinary(): Promise<string | null> {
    // 1. Check if require.resolve can find it (bundled or globally linked)
    try {
      const resolved = require.resolve('hsd/bin/hsd');
      if (resolved) return resolved;
    } catch {
      // Fall through
    }

    // 2. Check common global npm installation paths
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || '';
      const p = join(appData, 'npm', 'node_modules', 'hsd', 'bin', 'hsd');
      if (existsSync(p)) return p;
      const localAppData = process.env.LOCALAPPDATA || '';
      const p2 = join(localAppData, 'Programs', 'nodejs', 'node_modules', 'hsd', 'bin', 'hsd');
      if (existsSync(p2)) return p2;
    } else {
      const paths = [
        '/usr/local/lib/node_modules/hsd/bin/hsd',
        '/usr/local/bin/hsd',
        join(process.env.HOME || '', '.npm-global', 'lib', 'node_modules', 'hsd', 'bin', 'hsd'),
      ];
      for (const p of paths) {
        if (existsSync(p)) return p;
      }
    }

    return null;
  }
}
