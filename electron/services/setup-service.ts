import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, promises as fs, readFileSync } from 'fs';
import { homedir } from 'os';
import { createConnection } from 'net';
import { dirname, join } from 'path';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';
import extract from 'extract-zip';
import type { DBService } from './db-service';
import type { ConfigService } from './config-service';
import { HSD_RUNTIME, getHsdRuntimeAsset, type HsdRuntimeAsset } from '../../src/lib/setup-runtime';
import type {
  SetupCompleteInput,
  SetupDetectedDataDir,
  SetupEnvironmentStatus,
  SetupRuntimeInstallResult,
  SetupRuntimeProgress,
  SetupRuntimeStatus,
} from '../../src/types/setup';

const SETUP_COMPLETED_KEY = 'setupCompleted';
const PREFS_KEY = 'setupMode';
const NODE_PATH_KEY = 'hsdNodePath';

interface RuntimeVersionFile {
  node?: string;
  hsd?: string;
  platform?: string;
  builtAt?: string;
}

function runtimeNodeName(): string {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function runtimePlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function runtimeTargetPath(root: string): string {
  return join(root, `hsd-${HSD_RUNTIME.hsdVersion}-node-${HSD_RUNTIME.nodeVersion}`);
}

function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = createConnection({ host, port });
    const done = (value: boolean) => {
      request.removeAllListeners();
      request.destroy();
      resolve(value);
    };
    request.setTimeout(1200, () => done(false));
    request.once('connect', () => done(true));
    request.once('error', () => done(false));
  });
}

export class SetupService extends EventEmitter {
  private db: DBService;
  private config: ConfigService;
  private runtimeRoot: string;
  private abortController: AbortController | null = null;
  private activeDownload = false;

  constructor(db: DBService, config: ConfigService, runtimeRoot: string) {
    super();
    this.db = db;
    this.config = config;
    this.runtimeRoot = runtimeRoot;
  }

  private emitProgress(progress: SetupRuntimeProgress): void {
    this.emit('progress', progress);
  }

  private readRuntimeVersion(path: string): RuntimeVersionFile | null {
    try {
      return JSON.parse(readFileSync(join(path, 'VERSION.json'), 'utf8')) as RuntimeVersionFile;
    } catch {
      return null;
    }
  }

  private requireRuntimeAsset(): HsdRuntimeAsset {
    const asset = getHsdRuntimeAsset(process.platform, process.arch);
    if (!asset || !asset.sha256) {
      throw new Error(`No HSD runtime is available for ${runtimePlatformKey()}.`);
    }
    return asset;
  }

  private inspectRuntime(): SetupRuntimeStatus {
    const candidates = [
      runtimeTargetPath(this.runtimeRoot),
      this.runtimeRoot,
    ];

    for (const path of candidates) {
      const nodePath = join(path, runtimeNodeName());
      const hsdPath = join(path, 'hsd', 'bin', 'hsd');
      if (!existsSync(nodePath) || !existsSync(hsdPath)) continue;
      const version = this.readRuntimeVersion(path);
      if (version?.platform && version.platform !== runtimePlatformKey()) continue;
      return {
        installed: true,
        path,
        nodePath,
        hsdPath,
        nodeVersion: version?.node ?? HSD_RUNTIME.nodeVersion,
        hsdVersion: version?.hsd ?? HSD_RUNTIME.hsdVersion,
      };
    }

    return {
      installed: false,
      path: null,
      nodePath: null,
      hsdPath: null,
      nodeVersion: null,
      hsdVersion: null,
    };
  }

  private findSystemNode(): { path: string; version: string } | null {
    const pathEnv = process.env.PATH || '';
    const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
    const names = process.platform === 'win32' ? ['node.exe'] : ['node'];

    for (const dir of dirs) {
      for (const name of names) {
        const candidate = join(dir.trim(), name);
        if (!existsSync(candidate)) continue;
        try {
          const version = execFileSync(candidate, ['--version'], {
            timeout: 5000,
            encoding: 'utf8',
            windowsHide: true,
          }).trim().replace(/^v/, '');
          return { path: candidate, version };
        } catch {
          // Keep looking.
        }
      }
    }
    return null;
  }

  private async findSystemHsd(): Promise<{ path: string } | null> {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const candidates = new Set<string>();

    const configured = this.db.getHsdBinaryPath();
    if (configured) candidates.add(configured);
    try {
      const detected = await this.config.detectHsdBinary();
      if (detected) candidates.add(detected);
    } catch {
      // Detection is best-effort.
    }
    if (appData) candidates.add(join(appData, 'npm', 'node_modules', 'hsd', 'bin', 'hsd'));
    if (localAppData) {
      candidates.add(join(localAppData, 'Programs', 'nodejs', 'node_modules', 'hsd', 'bin', 'hsd'));
    }
    if (process.platform !== 'win32') {
      const home = process.env.HOME || homedir();
      candidates.add('/usr/local/lib/node_modules/hsd/bin/hsd');
      candidates.add('/usr/bin/hsd');
      candidates.add(join(home, '.npm-global', 'lib', 'node_modules', 'hsd', 'bin', 'hsd'));
    }

    const systemNode = this.findSystemNode();
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      if (!systemNode) return { path: candidate };
      try {
        // A stale/broken local node_modules copy can exist in development.
        // Only offer an HSD script that actually starts.
        execFileSync(systemNode.path, [candidate, '--version'], {
          timeout: 8000,
          encoding: 'utf8',
          windowsHide: true,
        });
        return { path: candidate };
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  private getExistingDataDirs(): SetupDetectedDataDir[] {
    const appData = process.env.APPDATA || '';
    const home = process.env.HOME || homedir();
    const candidates = [
      this.db.getHsdDataDir(),
      this.config.getDefaultHsdDataDir(),
      join(home, '.hsd'),
      join(appData, 'Bob', 'hsd_data'),
      join(appData, 'Bob', 'hsd'),
      ...(process.platform === 'win32'
        ? []
        : [join(home, '.config', 'Bob', 'hsd_data'), join(home, '.config', 'Bob')]),
    ].filter(Boolean);

    const seen = new Set<string>();
    const result: SetupDetectedDataDir[] = [];
    for (const path of candidates) {
      const normalized = path.replace(/[\\/]+$/, '');
      if (!normalized || seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      if (!existsSync(normalized)) continue;
      const hasChain = ['chain', 'blocks', 'wallet']
        .some((name) => existsSync(join(normalized, name)));
      result.push({ path: normalized, hasChain });
    }
    return result;
  }

  async getStatus(): Promise<SetupEnvironmentStatus> {
    const explicitCompleted = this.db.getSetting(SETUP_COMPLETED_KEY);
    const hasDataDir = Boolean(this.db.getHsdDataDir());
    const hasSavedConnection = Boolean(this.db.getSavedConnectionConfig());
    const completed = explicitCompleted === 'true'
      || (explicitCompleted == null && (hasDataDir || hasSavedConnection));

    const systemNode = this.findSystemNode();
    const systemHsd = await this.findSystemHsd();
    const runtime = this.inspectRuntime();
    const runtimeAsset = getHsdRuntimeAsset(process.platform, process.arch);
    const runningNode = await isPortListening('127.0.0.1', 12037);

    return {
      completed,
      hasSavedConnection,
      hsdDataDir: this.db.getHsdDataDir(),
      defaultDataDir: this.config.getDefaultHsdDataDir(),
      runtime,
      runtimeDownload: runtimeAsset
        ? { fileName: runtimeAsset.fileName, sizeBytes: runtimeAsset.sizeBytes }
        : null,
      systemNode,
      systemHsd,
      existingDataDirs: this.getExistingDataDirs(),
      runningNode,
    };
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash('sha256');
    const handle = await fs.open(path, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let bytesRead = 1;
      while (bytesRead > 0) {
        const result = await handle.read(buffer, 0, buffer.length, null);
        bytesRead = result.bytesRead;
        if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
    return hash.digest('hex');
  }

  private async downloadFile(
    url: string,
    destination: string,
    signal: AbortSignal,
    redirects = 0,
  ): Promise<void> {
    if (redirects > 6) throw new Error('Too many download redirects.');
    if (signal.aborted) throw new Error('Download cancelled.');

    await fs.mkdir(dirname(destination), { recursive: true });

    return await new Promise<void>((resolve, reject) => {
      const request = (url.startsWith('https:') ? httpsGet : httpGet)(
        url,
        { headers: { 'User-Agent': 'Handess-Wallet-Setup' } },
        (response) => {
          const status = response.statusCode || 0;

          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            const next = new URL(response.headers.location, url).toString();
            this.downloadFile(next, destination, signal, redirects + 1).then(resolve, reject);
            return;
          }

          if (status !== 200) {
            response.resume();
            reject(new Error(`Runtime download failed (HTTP ${status}).`));
            return;
          }

          const total = Number(response.headers['content-length']) || HSD_RUNTIME.sizeBytes;
          const file = createWriteStream(destination);
          let received = 0;
          let lastEmit = 0;
          let settled = false;

          const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            file.destroy();
            reject(error);
          };

          const onAbort = () => {
            request.destroy();
            fail(new Error('Download cancelled.'));
          };
          signal.addEventListener('abort', onAbort, { once: true });

          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            const now = Date.now();
            if (now - lastEmit >= 200 || received >= total) {
              lastEmit = now;
              this.emitProgress({
                phase: 'downloading',
                received,
                total,
                percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
                message: `Downloading HSD runtime${total ? ` — ${Math.round((received / total) * 100)}%` : ''}`,
              });
            }
          });
          response.on('error', (error) => fail(error));
          file.on('error', (error) => fail(error));
          file.on('finish', () => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            resolve();
          });
          response.pipe(file);
        },
      );

      request.on('error', (error) => reject(error));
    });
  }

  async downloadRuntime(): Promise<SetupRuntimeInstallResult> {
    if (this.activeDownload) throw new Error('A runtime download is already running.');
    this.activeDownload = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const asset = this.requireRuntimeAsset();
    const tempZip = join(this.runtimeRoot, `.download-${Date.now()}.zip`);

    try {
      await fs.mkdir(this.runtimeRoot, { recursive: true });
      this.emitProgress({
        phase: 'downloading',
        received: 0,
        total: asset.sizeBytes,
        percent: 0,
        message: 'Starting HSD runtime download...',
      });
      // Allow an offline mirror or test server. The checksum still has to
      // match the official runtime, so this cannot install a modified payload.
      const runtimeUrl = process.env.HANDESS_RUNTIME_URL || asset.url;
      await this.downloadFile(runtimeUrl, tempZip, signal);
      if (signal.aborted) throw new Error('Download cancelled.');

      this.emitProgress({
        phase: 'verifying',
        received: asset.sizeBytes,
        total: asset.sizeBytes,
        percent: 100,
        message: 'Verifying runtime checksum...',
      });
      const hash = await this.hashFile(tempZip);
      if (hash.toUpperCase() !== asset.sha256.toUpperCase()) {
        throw new Error('The downloaded HSD runtime failed checksum verification.');
      }

      return await this.installRuntimeFromZip(tempZip);
    } catch (error) {
      if (signal.aborted) throw new Error('Download cancelled.');
      throw error;
    } finally {
      this.activeDownload = false;
      this.abortController = null;
      await fs.rm(tempZip, { force: true }).catch(() => {});
    }
  }

  async installRuntimeFromZip(zipPath: string): Promise<SetupRuntimeInstallResult> {
    if (!existsSync(zipPath)) throw new Error('Runtime archive not found.');
    const asset = this.requireRuntimeAsset();
    this.emitProgress({
      phase: 'verifying',
      received: 0,
      total: 100,
      percent: 0,
      message: 'Verifying runtime checksum...',
    });
    const hash = await this.hashFile(zipPath);
    if (hash.toUpperCase() !== asset.sha256.toUpperCase()) {
      throw new Error('This is not the official Handess HSD runtime archive.');
    }

    await fs.mkdir(this.runtimeRoot, { recursive: true });
    const temp = join(this.runtimeRoot, `.extract-${Date.now()}`);
    await fs.rm(temp, { recursive: true, force: true });
    await fs.mkdir(temp, { recursive: true });

    try {
      this.emitProgress({
        phase: 'extracting',
        received: 0,
        total: 100,
        percent: 0,
        message: 'Extracting Node.js and HSD...',
      });
      await extract(zipPath, { dir: temp });
      const nodeName = runtimeNodeName();
      const nodePath = join(temp, nodeName);
      const hsdPath = join(temp, 'hsd', 'bin', 'hsd');
      if (!existsSync(nodePath) || !existsSync(hsdPath)) {
        throw new Error(`The runtime archive does not contain ${nodeName} and hsd/bin/hsd.`);
      }
      if (process.platform !== 'win32') {
        await fs.chmod(nodePath, 0o755);
        await fs.chmod(hsdPath, 0o755).catch(() => {});
      }

      const target = runtimeTargetPath(this.runtimeRoot);
      if (!existsSync(join(target, nodeName)) || !existsSync(join(target, 'hsd', 'bin', 'hsd'))) {
        await fs.rm(target, { recursive: true, force: true });
        this.emitProgress({
          phase: 'installing',
          received: 0,
          total: 100,
          percent: 50,
          message: 'Installing the private runtime...',
        });
        await fs.rename(temp, target);
      }

      const version = this.readRuntimeVersion(target);
      if (version?.platform && version.platform !== runtimePlatformKey()) {
        throw new Error('The runtime archive was built for a different platform.');
      }
      this.emitProgress({
        phase: 'installing',
        received: 100,
        total: 100,
        percent: 100,
        message: 'Private Node.js and HSD runtime installed.',
      });

      return {
        path: target,
        nodePath: join(target, nodeName),
        hsdPath: join(target, 'hsd', 'bin', 'hsd'),
        nodeVersion: version?.node ?? HSD_RUNTIME.nodeVersion,
        hsdVersion: version?.hsd ?? HSD_RUNTIME.hsdVersion,
      };
    } finally {
      await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  cancelRuntime(): boolean {
    if (!this.abortController) return false;
    this.abortController.abort();
    return true;
  }

  async complete(input: SetupCompleteInput): Promise<void> {
    if (input.mode !== 'skip') {
      if (input.dataDir) {
        mkdirSync(input.dataDir, { recursive: true });
        this.db.setHsdDataDir(input.dataDir);
      }
      if (input.binaryPath) this.db.setHsdBinaryPath(input.binaryPath);
      if (input.nodePath) this.db.setSetting(NODE_PATH_KEY, input.nodePath);
    }
    this.db.setSetting(SETUP_COMPLETED_KEY, 'true');
    this.db.setSetting(PREFS_KEY, input.mode);
  }
}
