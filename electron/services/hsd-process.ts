import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { createConnection, Socket } from 'net';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { NodeClient, WalletClient } from 'hs-client';
import type { DBService } from './db-service';
import {
  ensureApiKeyConf,
  generateApiKey,
  hsdPrefixDir,
  readApiKeyConf,
} from './hsd-conf';

const RPC_TIMEOUT = 15000; // 15 seconds — prevents indefinite hangs on slow wallet RPCs

export type HSDProcessState = 'stopped' | 'starting' | 'running' | 'error';

export interface ManagedNodeConfig {
  dataDir: string;
  binaryPath?: string;
  /** Optional node.exe path for a private Node.js runtime. */
  nodePath?: string;
  network: 'main' | 'testnet' | 'regtest';
  apiKey?: string;
  walletId?: string;
}

interface HSDProcessStatus {
  state: HSDProcessState;
  pid: number | null;
  dataDir: string;
  network: string;
  error?: string;
}

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

export class HSDProcessService extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: HSDProcessState = 'stopped';
  private config: ManagedNodeConfig | null = null;
  private nodeClient: NodeClient | null = null;
  private walletClient: WalletClient | null = null;
  private adminWalletClient: WalletClient | null = null;
  private detectedApiKey: string | null = null;
  private healthInterval: NodeJS.Timeout | null = null;
  private outputBuffer = '';
  private _lastError: string | null = null;
  private _stderrLines: string[] = [];
  private dbService: DBService | null = null;

  get lastError(): string | null {
    return this._lastError;
  }

  constructor(dbService?: DBService) {
    super();
    this.dbService = dbService || null;
  }

  getState(): HSDProcessState {
    return this.state;
  }

  getStatus(): HSDProcessStatus {
    return {
      state: this.state,
      pid: this.process?.pid ?? null,
      dataDir: this.config?.dataDir ?? '',
      network: this.config?.network ?? 'main',
    };
  }

  getClients(): { nodeClient: NodeClient; walletClient: WalletClient } {
    if (!this.nodeClient || !this.walletClient) {
      throw new Error('Managed node not running');
    }
    return { nodeClient: this.nodeClient, walletClient: this.walletClient };
  }

  async start(config: ManagedNodeConfig): Promise<boolean> {
    if (this.state === 'running') return true;

    // Serialize concurrent start requests. Two parallel starts used to race:
    // the second one treated the first one's child as a zombie and killed it.
    if (this._startPromise) return this._startPromise;

    this._startPromise = this.startInternal(config).finally(() => {
      this._startPromise = null;
    });
    return this._startPromise;
  }

  private async startInternal(config: ManagedNodeConfig): Promise<boolean> {
    try {
      this.config = config;
      this._lastError = null;
      this._stderrLines = [];
      this._portInUse = false;
      this.state = 'starting';
      this.emit('stateChange', this.state);

      // First attempt: start without any special flags
      const result = await this.tryStart(config);
      if (result) return true;

      // A node already owns the port: connect to it instead of interfering.
      if (this._portInUse) return false;

      const stderr = this._stderrLines.join('\n');

      // Chain migrations are never run automatically: they rewrite the chain
      // database and must be an explicit operator decision.
      if (/--chain-migrate=(\d+)/.test(stderr)) {
        this.handleError(
          'The chain database requires a migration. Add --chain-migrate=<version> in Settings > Advanced hsd Configuration, then start the node again.'
        );
        await this.terminateChild();
        return false;
      }

      // ---- Retry: index flags mismatch (Bob Wallet DB) ----
      // "Cannot retroactively disable TX indexing" means the DB has indexTX=true
      // "Cannot retroactively disable address indexing" means the DB has indexAddress=true
      const needsIndexTX = /cannot retroactively disable.*tx.*indexing/i.test(stderr);
      const needsIndexAddress = /cannot retroactively disable.*address.*indexing/i.test(stderr);
      if (needsIndexTX || needsIndexAddress) {
        const extraArgs: string[] = [];
        if (needsIndexTX) extraArgs.push('--index-tx');
        if (needsIndexAddress) extraArgs.push('--index-address');
        console.log('[HSDProcess] Index flags mismatch detected, retrying with:', extraArgs.join(' '));
        await this.terminateChild();
        this.cleanupAfterExit();
        this.state = 'starting';
        this.emit('stateChange', this.state);
        const indexed = await this.tryStart(config, undefined, extraArgs);
        if (indexed) return true;
      }

      // Never delete LevelDB LOCK files or kill processes we do not own.
      // A held lock means another node is using the database.
      if (/IO error/i.test(stderr) || /LOCK/i.test(stderr) || /being used by another process/i.test(stderr)) {
        this._lastError =
          'The hsd database is locked by another process. Stop that process before starting the managed node.';
      }

      await this.terminateChild();
      return false;
    } catch (err) {
      console.error('[HSDProcess] start error:', err);
      this.handleError(err instanceof Error ? err.message : 'Failed to start hsd');
      await this.terminateChild();
      return false;
    }
  }

  private _startPromise: Promise<boolean> | null = null;
  private _portInUse = false;

  /** Terminate only the child process this service spawned. */
  private async terminateChild(): Promise<void> {
    const child = this.process;
    if (!child) return;

    this.process = null;
    child.removeAllListeners();

    if (child.exitCode !== null || child.signalCode !== null) return;

    try {
      child.kill('SIGTERM');
    } catch {
      // Already gone
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }
  }

  private async tryStart(config: ManagedNodeConfig, chainMigrate?: number, extraArgs?: string[]): Promise<boolean> {
    try {
      this.ensureDataDir();

      // Never kill or displace a node we do not own. If the port already
      // serves RPC, the app must connect to that node instead of starting a
      // second one against the same database.
      const nodePort = getDefaultNodePort(config.network);
      if (await this.isPortInUse(nodePort)) {
        const message =
          `An hsd node is already running on 127.0.0.1:${nodePort}. ` +
          'The app will not stop it. Use Connect to attach to the running node, or stop that node first.';
        console.warn(`[HSDProcess] ${message}`);
        this._lastError = message;
        this._portInUse = true;
        this.state = 'stopped';
        this.emit('stateChange', this.state);
        return false;
      }

      const hsdScript = this.resolveHsdScript();
      const nodePath = this.resolveNodePath();
      const apiKey =
        config.apiKey ||
        readApiKeyConf(config.dataDir, config.network) ||
        generateApiKey();

      // Spawn hsd via `node <script> <args>` on all platforms.
      // On Windows we MUST avoid spawning .cmd/.bat wrapper files because
      // Node.js v24+ throws spawn EINVAL when spawning .cmd files directly.
      // Using `node` + the JS script bypasses cmd.exe entirely.
      const spawnArgs = [hsdScript, ...this.buildArgs(config, apiKey, chainMigrate, extraArgs)];

      console.log('[HSDProcess] Spawning:', nodePath, JSON.stringify(spawnArgs));

      try {
        this.process = spawn(nodePath, spawnArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });
      } catch (spawnErr) {
        console.error('[HSDProcess] Spawn threw:', spawnErr);
        this.handleError(spawnErr instanceof Error ? spawnErr.message : 'Spawn failed');
        return false;
      }

      this.process.on('error', (err) => {
        this.handleError(`Process error: ${err.message}`);
      });

      this.process.on('exit', (code, signal) => {
        if (this.state !== 'stopped') {
          const stderr = this._stderrLines.slice(-5).join(' | ');
          const detail = stderr ? ` -- ${stderr}` : '';
          this.handleError(`Process exited unexpectedly (code: ${code}, signal: ${signal})${detail}`);
        }
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleOutput(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        this.handleOutput(data.toString());
      });

      return await this.waitForReady(apiKey);
    } catch (err) {
      console.error('[HSDProcess] tryStart error:', err);
      this.handleError(err instanceof Error ? err.message : 'Failed to start hsd');
      return false;
    }
  }

  private cleanupAfterExit(): void {
    this.process?.removeAllListeners();
    this.process = null;
    this._lastError = null;
    this._stderrLines = [];
    this.outputBuffer = '';
  }

  async stop(): Promise<void> {
    this.state = 'stopped';
    this.emit('stateChange', this.state);
    this.stopHealthCheck();
    this.nodeClient = null;
    this.walletClient = null;
    this.adminWalletClient = null;
    this._resolvedHsdScript = null;

    if (this.process) {
      if (this.process.exitCode !== null || this.process.signalCode !== null) {
        this.process = null;
        return;
      }
      try {
        this.process.removeAllListeners();
        this.process.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            try { this.process?.kill('SIGKILL'); } catch { /* ignore */ }
            resolve();
          }, 10000);
          this.process?.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } catch {
        // Ignore kill errors
      }
      this.process = null;
    }
  }

  private ensureDataDir(): void {
    if (this.config && !existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }
  }

  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket: Socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  private _resolvedHsdScript: string | null = null;

  /**
   * Returns the hsd script path to pass as the script argument to `node`.
   * On Windows, we avoid spawning .cmd/.bat files directly (Node.js v24+ has
   * spawn EINVAL issues with them). Instead we resolve the actual hsd JS script
   * and spawn it via `node <script>`.
   */
  private resolveHsdScript(): string {
    if (this._resolvedHsdScript) return this._resolvedHsdScript;

    // 1. User-specified binary path
    if (this.config?.binaryPath) {
      const p = this.config.binaryPath;
      // If user pointed to the script directly
      if (existsSync(p)) {
        this._resolvedHsdScript = p;
        return p;
      }
      // If user pointed to the hsd module directory
      const inBin = join(p, 'bin', 'hsd');
      if (existsSync(inBin)) {
        this._resolvedHsdScript = inBin;
        return inBin;
      }
    }

    // 2. Try resolving via require (bundled dependency or globally linked)
    try {
      const p = require.resolve('hsd/bin/hsd');
      this._resolvedHsdScript = p;
      return p;
    } catch {
      // Fall through
    }

    // 3. Find the hsd module directory via npm global prefix
    //    On Windows with npm -g, the module is at <prefix>/node_modules/hsd/bin/hsd
    const candidates: string[] = [];
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || '';
      const localAppData = process.env.LOCALAPPDATA || '';
      // npm global modules at %APPDATA%/npm/node_modules/
      candidates.push(join(appData, 'npm', 'node_modules', 'hsd', 'bin', 'hsd'));
      // Alternate install location
      candidates.push(join(localAppData, 'Programs', 'nodejs', 'node_modules', 'hsd', 'bin', 'hsd'));
    } else {
      const home = process.env.HOME || '';
      candidates.push(
        '/usr/local/lib/node_modules/hsd/bin/hsd',
        '/usr/local/bin/hsd',
        join(home, '.npm-global', 'lib', 'node_modules', 'hsd', 'bin', 'hsd'),
        join(home, '.nvm', 'versions', 'node', '*', 'bin', 'hsd'),
      );
    }

    for (const p of candidates) {
      if (existsSync(p)) {
        this._resolvedHsdScript = p;
        return p;
      }
    }

    throw new Error(
      'hsd not found. Install it via "npm install -g hsd" or set the binary path in Settings.'
    );
  }

  /**
   * Returns the node executable path to use when spawning hsd.
   * In Electron, process.execPath points to electron.exe, not node.exe,
   * so we use 'node' and let the OS resolve it via PATH.
   */
  private resolveNodePath(): string {
    // Prefer an explicitly configured private runtime.
    if (this.config?.nodePath && existsSync(this.config.nodePath)) {
      return this.config.nodePath;
    }
    // On Windows, resolve the actual node.exe via PATH to avoid shell issues
    if (process.platform === 'win32') {
      const nodeFromPath = this.findNodeOnPath();
      if (nodeFromPath) return nodeFromPath;
    }
    return 'node';
  }

  private findNodeOnPath(): string | null {
    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(';').filter(Boolean);
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of pathDirs) {
      for (const ext of exts) {
        const fullPath = join(dir.trim(), `node${ext}`);
        if (existsSync(fullPath) && fullPath.toLowerCase() !== process.execPath.toLowerCase()) {
          return fullPath;
        }
      }
    }
    // Fallback: just use 'node' and let cmd.exe resolve it
    return null;
  }

  /**
   * Generate an hsd.conf file from the advanced config stored in electron-store.
   * This is called automatically before the node starts, and also when the user
   * saves advanced settings from the UI.
   *
   * @param config       The advanced config object (from db-service)
   * @param dataDir      hsd data directory (prefix)
   * @param network      Network name
   * @param apiKey       API key for RPC auth
   */
  static generateHsdConf(config: Record<string, unknown>, dataDir: string, network: string, apiKey: string): void {
    // Skip writing if no advanced settings are configured
    const hasSettings = Object.keys(config).length > 0;
    if (!hasSettings) return;

    const lines: string[] = [];
    lines.push('# HSD Configuration - Generated by Handess Wallet');
    lines.push(`# https://github.com/handshake-org/hsd`);
    lines.push(`# Data directory: ${dataDir}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('network: ' + network);
    lines.push('api-key: ' + apiKey);
    lines.push('');

    // Map of config key -> hsd.conf key name
    const keyMap: Record<string, string> = {
      workers: 'workers',
      workersSize: 'workers-size',
      indexTx: 'index-tx',
      indexAddress: 'index-address',
      migrateNoRescan: 'migrate-no-rescan',
      noDns: 'no-dns',
      listen: 'listen',
      maxInbound: 'max-inbound',
      maxOutbound: 'max-outbound',
      bip37: 'bip37',
      checkpoints: 'checkpoints',
      selfish: 'selfish',
      prune: 'prune',
      compact: 'compact',
      memory: 'memory',
      logLevel: 'log-level',
      logFile: 'log-file',
      logConsole: 'log-console',
      rsHost: 'rs-host',
      rsPort: 'rs-port',
      walletHost: 'wallet-host',
      walletPort: 'wallet-port',
      ssl: 'ssl',
    };

    for (const [key, val] of Object.entries(config)) {
      const confKey = keyMap[key];
      if (!confKey) continue;
      if (val === undefined || val === null) continue;

      if (typeof val === 'boolean') {
        lines.push(`${confKey}: ${val ? 'true' : 'false'}`);
      } else if (typeof val === 'number') {
        lines.push(`${confKey}: ${val}`);
      } else if (typeof val === 'string' && val.trim()) {
        lines.push(`${confKey}: ${val.trim()}`);
      }
    }

    lines.push('');

    // hsd reads its config from <prefix>/<network>/ for non-main networks.
    const prefixDir = hsdPrefixDir(dataDir, network);
    if (!existsSync(prefixDir)) {
      mkdirSync(prefixDir, { recursive: true });
    }

    const confPath = join(prefixDir, 'hsd.conf');
    writeFileSync(confPath, lines.join('\n'), 'utf8');
    // Never leave a secret-bearing conf file with inherited broad access.
    try {
      ensureApiKeyConf(dataDir, apiKey, network);
    } catch (error) {
      console.error('[HSDProcess] Failed to restrict hsd.conf permissions:', error);
    }
    console.log(`[HSDProcess] Generated ${confPath}`);
  }

  private buildArgs(config: ManagedNodeConfig, apiKey: string, chainMigrate?: number, extraArgs?: string[]): string[] {
    const args: string[] = [];

    args.push('--prefix', config.dataDir);
    args.push('--network', config.network);
    // The API key is written to hsd.conf below instead of argv: command lines
    // are readable by other local processes, config files are not.

    // Check if advanced config has user-specified settings.
    // If yes, the generated hsd.conf will handle those settings.
    // If no, use hardcoded defaults compatible with existing DB.
    let hasAdvancedSettings = false;
    try {
      const advancedConfig = this.dbService?.getHsdAdvancedConfig() || {};
      hasAdvancedSettings = Object.keys(advancedConfig).length > 0;
    } catch {
      // DB not ready — treat as no advanced config
    }

    if (!hasAdvancedSettings) {
      // Default flags: compatible with existing DBs
      // These ensure the copied database works without re-indexing.
      args.push('--index-tx');
      args.push('--index-address');
      args.push('--migrate-no-rescan');
    }

    if (chainMigrate !== undefined) {
      args.push('--chain-migrate', String(chainMigrate));
    }

    if (config.network === 'regtest') {
      args.push('--listen', 'false');
    }

    if (extraArgs) {
      args.push(...extraArgs);
    }

    // Regenerate hsd.conf to ensure it reflects the latest saved config.
    // When advanced settings exist, the conf file is the source of truth.
    // When empty, we skip generating so CLI args remain the source.
    try {
      const advancedConfig = this.dbService?.getHsdAdvancedConfig() || {};
      if (Object.keys(advancedConfig).length > 0) {
        HSDProcessService.generateHsdConf(advancedConfig as Record<string, unknown>, config.dataDir, config.network, apiKey);
      }
    } catch {
      // Silently skip — conf file is optional
    }

    // Always ensure the API key lives in hsd.conf, never in the argv.
    try {
      ensureApiKeyConf(config.dataDir, apiKey, config.network);
    } catch (error) {
      console.error('[HSDProcess] Failed to write api-key to hsd.conf:', error);
    }

    return args;
  }

  private handleOutput(data: string): void {
    this.outputBuffer += data;
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        const trimmed = line.trim();
        this.emit('log', trimmed);
        // Store last 20 lines for error diagnosis
        this._stderrLines.push(trimmed);
        if (this._stderrLines.length > 20) this._stderrLines.shift();
        // If hsd prints [error], also capture it
        if (trimmed.startsWith('[error]')) {
          this._lastError = trimmed;
        }
      }
    }
  }

  private async waitForReady(apiKey: string): Promise<boolean> {
    if (!this.config) return false;

    const nodePort = getDefaultNodePort(this.config.network);
    const walletPort = getDefaultWalletPort(this.config.network);

    this.nodeClient = new NodeClient({
      host: '127.0.0.1',
      port: nodePort,
      apiKey,
      ssl: false,
      timeout: RPC_TIMEOUT,
    });

    this.walletClient = new WalletClient({
      host: '127.0.0.1',
      port: walletPort,
      apiKey,
      ssl: false,
      walletID: this.config.walletId || 'primary',
      timeout: RPC_TIMEOUT,
    });

    // Separate client WITHOUT walletID for wallet-server-level RPCs (selectwallet, createwallet, etc.)
    this.adminWalletClient = new WalletClient({
      host: '127.0.0.1',
      port: walletPort,
      apiKey,
      ssl: false,
      timeout: RPC_TIMEOUT,
    });

    const maxAttempts = 120;

    for (let i = 0; i < maxAttempts; i++) {
      if (this.state === 'stopped' || this.state === 'error') return false;

      try {
        await this.nodeClient.getInfo();
      } catch {
        if ((this.state as HSDProcessState) === 'error') return false;
        await this.sleep(2000);
        continue;
      }

      // Node is up — now verify wallet RPC is ready
      let walletReady = false;
      for (let w = 0; w < 15; w++) {
        if ((this.state as HSDProcessState) === 'stopped' || (this.state as HSDProcessState) === 'error') return false;
        try {
          await this.adminWalletClient!.execute('selectwallet', [this.config.walletId || 'primary']);
          await this.walletClient!.execute('getwalletinfo');
          walletReady = true;
          break;
        } catch {
          try {
            await this.adminWalletClient!.execute('selectwallet', ['primary']);
            await this.walletClient!.execute('getwalletinfo');
            walletReady = true;
            break;
          } catch {
            if (w < 14) await this.sleep(2000);
          }
        }
      }

      // If wallet not found, try to create it via admin client
      if (!walletReady) {
        try {
          const walletId = this.config.walletId || 'primary';
          await this.adminWalletClient!.execute('createwallet', [walletId]);
          await this.adminWalletClient!.execute('selectwallet', [walletId]);
          await this.walletClient!.execute('getwalletinfo');
          walletReady = true;
        } catch (createErr) {
          console.warn('[HSDProcess] Could not create wallet:', createErr);
        }
      }

      this.state = 'running';
      this.emit('stateChange', this.state);
      this.startHealthCheck();
      return true;
    }

    this.handleError('hsd failed to start within timeout (4 minutes)');
    await this.terminateChild();
    return false;
  }

  private startHealthCheck(): void {
    this.healthInterval = setInterval(async () => {
      if (!this.nodeClient || this.state !== 'running') return;
      try {
        await this.nodeClient.getInfo();
      } catch {
        // Don't permanently fail on health check - hsd might be busy syncing
        console.warn('[HSDProcess] Health check failed, will retry');
      }
    }, 30000);
  }

  private stopHealthCheck(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  private handleError(message: string): void {
    this._lastError = message;
    this.state = 'error';
    this.emit('stateChange', this.state);
    this.emit('error', message);
    this.stopHealthCheck();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
