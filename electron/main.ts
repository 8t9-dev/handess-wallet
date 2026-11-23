/**
 * Electron Main Process Entry Point
 *
 * Creates the browser window, initializes all backend services,
 * and registers IPC handlers for renderer communication.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, Menu, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { randomBytes, createHash } from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const APP_DISPLAY_NAME = 'Handess Wallet';
const APP_ID = 'com.handesswallet.app';
// Keep this internal folder stable across release names. Renaming the app must
// never orphan the wallet database stored in electron-store.
const STABLE_USER_DATA_DIR = 'handshake-wallet';
const appDataDir = app.getPath('appData');
const userDataDir = join(appDataDir, STABLE_USER_DATA_DIR);

app.setName(APP_DISPLAY_NAME);
mkdirSync(userDataDir, { recursive: true });
app.setPath('userData', userDataDir);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

function migrateLegacyUserData(): void {
  const target = join(userDataDir, 'crm-data.json');
  if (existsSync(target)) return;

  const candidates = [
    join(appDataDir, 'Handess Wallet', 'crm-data.json'),
    join(appDataDir, 'Handshake Wallet', 'crm-data.json'),
    join(appDataDir, 'handess-wallet', 'crm-data.json'),
    join(appDataDir, 'bob-wallet-crm', 'crm-data.json'),
    join(appDataDir, 'Bob Wallet CRM', 'crm-data.json'),
    join(appDataDir, 'Bob', 'crm-data.json'),
  ].filter((candidate) => existsSync(candidate));

  if (candidates.length === 0) return;

  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  try {
    mkdirSync(userDataDir, { recursive: true });
    copyFileSync(candidates[0], target);
    console.log(`[Main] Migrated wallet data from ${candidates[0]}`);
  } catch (error) {
    console.error('[Main] Could not migrate legacy wallet data:', error);
  }
}

migrateLegacyUserData();

// Polyfill crypto.getRandomValues for nostr-tools in Node.js
type CryptoGlobal = {
  crypto?: {
    getRandomValues?: (array: Uint8Array) => Uint8Array;
  };
};
const cryptoGlobal = globalThis as unknown as CryptoGlobal;
if (!cryptoGlobal.crypto) {
  cryptoGlobal.crypto = {};
}
if (!cryptoGlobal.crypto.getRandomValues) {
  cryptoGlobal.crypto.getRandomValues = (array: Uint8Array) => {
    const bytes = randomBytes(array.length);
    array.set(bytes);
    return array;
  };
}

// Service imports
import { HSDConnectionService, isPortOpen } from './services/hsd-connection';
import { WalletService } from './services/wallet-service';
import { NodeService } from './services/node-service';
import { SearchIndexService } from './services/search-index-service';
import { BatchService } from './services/batch-service';
import { MarketplaceService } from './services/shakedex-service';
import { NostrMarketplaceService } from './services/nostr-marketplace-service';
import { ConfigService } from './services/config-service';
import { DBService } from './services/db-service';
import { NotificationService } from './services/notification-service';
import { SetupService } from './services/setup-service';
import { HSDProcessService } from './services/hsd-process';
import {
  ensureApiKeyConf,
  generateApiKey,
  hsdPrefixDir,
  readApiKeyConf,
} from './services/hsd-conf';
import type { HSDProcessState } from './services/hsd-process';
import { electrumDgbService } from './services/electrum-dgb-service';
import { SwapService } from './services/swap-service';
import { getDgbNetwork } from './dgb-networks';
import * as bitcoin from 'bitcoinjs-lib';
import { toBitcoinJsNetwork } from './dgb-networks';
import type { DgbNetworkType, DgbServerConfig, SwapOffer, LocalSwap } from '../src/types/swap';
import type { HSDConnectionConfig, ManagedNodeConfig } from '../src/types/wallet';
import { SETUP_RELEASE_URL } from '../src/lib/setup-runtime';
import type { SetupCompleteInput } from '../src/types/setup';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Service instances
let connectionService: HSDConnectionService;
let walletService: WalletService;
let nodeService: NodeService;
let searchIndexService: SearchIndexService;
let batchService: BatchService;
let marketplaceService: MarketplaceService;
let nostrService: NostrMarketplaceService;
let configService: ConfigService;
let dbService: DBService;
let notificationService: NotificationService;
let setupService: SetupService;
let hsdProcessService: HSDProcessService;
let swapService: SwapService;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

let mainWindow: BrowserWindow | null = null;
let appSessionUnlocked = false;
let seedBackupWallet: string | null = null;
let seedBackupUntil = 0;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted IPC sender.');
  }
}

// ============================================================
// Window Management
// ============================================================

function createWindow(): void {
  // In dev mode: __dirname = out/main, preload at out/preload/preload.js
  // In packaged mode: __dirname = resources/app.asar/out/main, preload at resources/app.asar/out/preload/preload.js
  // Both cases: join(__dirname, '..', 'preload', 'preload.js') works
  const preloadPath = join(__dirname, '..', 'preload', 'preload.js');

  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '..', '..', 'resources', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Handess Wallet',
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // Ignore malformed URLs.
    }
    return { action: 'deny' };
  });

  // electron-vite injects the actual dev server URL. Hardcoding a port lets
  // another local Vite project on the same port get loaded instead.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5180';
  const appUrl = isDev
    ? devServerUrl
    : pathToFileURL(join(__dirname, '../renderer/index.html')).toString();
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
    }
  });

  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase();
      const devToolsShortcut = key === 'f12'
        || (input.control && input.shift && ['i', 'j', 'c'].includes(key));
      const reloadShortcut = key === 'f5' || (input.control && key === 'r');
      if (devToolsShortcut || reloadShortcut) {
        event.preventDefault();
      }
    });
  }

  if (isDev) {
    mainWindow.loadURL(devServerUrl);
    if (process.env.HANDRESS_DEVTOOLS !== '0') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================
// Service Initialization
// ============================================================

async function createServices(): Promise<void> {
  configService = new ConfigService();
  await configService.initialize();

  dbService = new DBService();

  // Migrate old dead DGB servers
  const oldDgbConfig = dbService.getDgbServerConfig();
  const deadHosts = ['electrum1.digibyte.host', 'electrum2.digibyte.host', 'dgb-cn1.electrum.digibyte.io'];
  if (oldDgbConfig && deadHosts.includes(oldDgbConfig.host)) {
    dbService.setDgbServerConfig({
      host: 'electrum1.cipig.net',
      port: 10059,
      ssl: false,
      network: oldDgbConfig.network || 'mainnet',
    });
  }

  connectionService = new HSDConnectionService();
  hsdProcessService = new HSDProcessService(dbService);
  setupService = new SetupService(
    dbService,
    configService,
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || userDataDir, 'Handess', 'runtime')
      : join(userDataDir, 'runtime'),
  );
  nodeService = new NodeService(connectionService);
  searchIndexService = new SearchIndexService(connectionService, {
    seedPath: app.isPackaged
      ? join(process.resourcesPath, 'hns-index.ndjson.gz')
      : join(app.getAppPath(), 'resources', 'hns-index.ndjson.gz'),
    userIndexPath: join(userDataDir, 'hns-index.ndjson.gz'),
  });
  walletService = new WalletService(connectionService);
  batchService = new BatchService(walletService, nodeService, dbService, connectionService);
  nostrService = new NostrMarketplaceService(dbService);
  marketplaceService = new MarketplaceService(walletService, connectionService, dbService, nostrService);
  notificationService = new NotificationService(nodeService, walletService, dbService);
  swapService = new SwapService(dbService, electrumDgbService, walletService);

  // Forward swap state updates to renderer
  swapService.onSwapUpdate((swap: LocalSwap) => {
    mainWindow?.webContents.send('swap:update', swap);
  });
  // Swaps must keep progressing even when the user navigates away from the
  // Swap page. The monitor is a no-op when there are no active swaps.
  void swapService.startMonitor().catch((err) => {
    console.warn('[Swap] Monitor failed to start:', err);
  });

  // Forward events from services to renderer
  connectionService.on('stateChange', (state: string) => {
    if (state !== 'connected') appSessionUnlocked = false;
    mainWindow?.webContents.send('connection:change', state);
  });

  connectionService.on('error', (err: unknown) => {
    console.error('[Main] Connection error:', err);
  });

  hsdProcessService.on('stateChange', (state: HSDProcessState) => {
    if (state !== 'running') appSessionUnlocked = false;
    mainWindow?.webContents.send('hsd:stateChange', state);
  });

  hsdProcessService.on('error', (err: unknown) => {
    console.error('[Main] HSD process error:', err);
    mainWindow?.webContents.send('hsd:error', err);
  });

  hsdProcessService.on('log', (msg: string) => {
    mainWindow?.webContents.send('hsd:log', msg);
  });

  batchService.on('progress', (progress: unknown) => {
    mainWindow?.webContents.send('batch:progress', progress);
  });

  searchIndexService.on('progress', (status: unknown) => {
    mainWindow?.webContents.send('searchEngine:progress', status);
  });

  setupService.on('progress', (progress: unknown) => {
    mainWindow?.webContents.send('setup:progress', progress);
  });

  notificationService.on('newBlock', (height: number) => {
    mainWindow?.webContents.send('node:newBlock', height);
  });

  notificationService.on('notification', (msg: unknown) => {
    mainWindow?.webContents.send('notification', msg);
  });

  console.log('[Main] Services initialized');
}

// ============================================================
// IPC Handler Registration
// ============================================================

function registerIPCHandlers(): void {
  // Application lifecycle and legal documents
  ipcMain.handle('app:getVersion', (event) => {
    assertTrustedSender(event);
    return app.getVersion();
  });

  ipcMain.handle('app:quit', (event) => {
    assertTrustedSender(event);
    app.quit();
  });

  ipcMain.handle('app:openThirdPartyNotices', async (event) => {
    assertTrustedSender(event);
    const noticesPath = app.isPackaged
      ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.md')
      : join(__dirname, '..', '..', 'THIRD_PARTY_NOTICES.md');
    if (!existsSync(noticesPath)) {
      throw new Error('Third-party notices file was not found.');
    }
    const error = await shell.openPath(noticesPath);
    // Some Windows installs have no default handler for .md files. In that
    // case, reveal the installed file so it can still be opened manually.
    if (error) shell.showItemInFolder(noticesPath);
  });

  ipcMain.handle('clipboard:writeText', (event, text) => {
    assertTrustedSender(event);
    clipboard.writeText(String(text ?? ''));
  });

  // Connection
  ipcMain.handle('connection:connect', async (_event, config) => {
    return await connectionService.connect(config);
  });

  ipcMain.handle('connection:getLastError', async () => {
    return connectionService.lastError;
  });

  ipcMain.handle('connection:disconnect', async () => {
    appSessionUnlocked = false;
    seedBackupWallet = null;
    seedBackupUntil = 0;
    return await connectionService.disconnect();
  });

  ipcMain.handle('connection:getStatus', async () => {
    return connectionService.getStatus();
  });

  ipcMain.handle('connection:detectBobConfig', async () => {
    return await configService.detectBobWalletConfig();
  });

  ipcMain.handle('connection:testConnection', async (_event, config) => {
    return await connectionService.testConnection(config);
  });

  ipcMain.handle('connection:detectWalletNames', async () => {
    return configService.detectWalletNames();
  });

  ipcMain.handle('connection:getSavedConfig', async () => {
    return dbService.getSavedConnectionConfig();
  });

  ipcMain.handle('connection:saveConfig', async (_event, config: unknown) => {
    if (!config || typeof config !== 'object') return;
    const value = config as Record<string, unknown>;
    const network: HSDConnectionConfig['network'] =
      value.network === 'testnet' || value.network === 'regtest' ? value.network : 'main';
    const nodePort = Number(value.nodePort);
    const walletPort = Number(value.walletPort);

    dbService.setSavedConnectionConfig({
      host: typeof value.host === 'string' ? value.host : '127.0.0.1',
      nodePort: Number.isFinite(nodePort) ? nodePort : 12037,
      walletPort: Number.isFinite(walletPort) ? walletPort : 12039,
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
      nodeApiKey: typeof value.nodeApiKey === 'string' ? value.nodeApiKey : undefined,
      walletApiKey: typeof value.walletApiKey === 'string' ? value.walletApiKey : undefined,
      network,
      walletId: typeof value.walletId === 'string' ? value.walletId : 'primary',
      ssl: Boolean(value.ssl),
    });
  });

  // Node
  ipcMain.handle('node:getInfo', async () => {
    return await nodeService.getInfo();
  });

  // Gracefully shut down a connected local node via hsd's own `stop` RPC.
  // Used only from Settings > Stop Node; managed nodes are stopped through
  // hsdProcessService instead (see hsd:stop).
  ipcMain.handle('node:shutdown', async () => {
    await connectionService.shutdownNode();
  });

  ipcMain.handle('node:getNameInfo', async (_event, name) => {
    return await nodeService.getNameInfo(name);
  });

  ipcMain.handle('node:getNameResource', async (_event, name) => {
    return await nodeService.getNameResource(name);
  });

  ipcMain.handle('node:bulkLookup', async (_event, names) => {
    return await nodeService.bulkLookup(names);
  });

  ipcMain.handle('node:estimateFee', async (_event, blocks) => {
    return await nodeService.estimateFee(blocks);
  });

  ipcMain.handle('node:getBlockHeight', async () => {
    return await nodeService.getBlockHeight();
  });

  ipcMain.handle('node:getRecentBlocks', async (_event, count) => {
    return await nodeService.getRecentBlocks(count);
  });

  ipcMain.handle('node:getMempoolInfo', async () => {
    return await nodeService.getMempoolInfo();
  });

  ipcMain.handle('node:getCoinSupply', async () => {
    return await nodeService.getCoinSupply();
  });

  ipcMain.handle('node:getBlockDetails', async (_event, height) => {
    return await nodeService.getBlockDetails(height);
  });

  ipcMain.handle('node:getBlockTimes', async (_event, heights) => {
    return await nodeService.getBlockTimes(heights);
  });

  ipcMain.handle('node:getTreeUpdateInfo', async (_event, height) => {
    return await nodeService.getTreeUpdateInfo(height);
  });

  ipcMain.handle('node:getAddressInfo', async (_event, address) => {
    return await nodeService.getAddressInfo(address);
  });

  ipcMain.handle('node:scanGlobalAuctions', async () => {
    return await nodeService.scanGlobalAuctions();
  });

  ipcMain.handle('node:getNameDetail', async (_event, name) => {
    return await nodeService.getNameDetail(name);
  });

  ipcMain.handle('node:getTransaction', async (_event, hash) => {
    return await nodeService.getTransaction(hash);
  });

  ipcMain.handle('node:verifyMessageWithName', async (_event, name, signature, message) => {
    return await nodeService.verifyMessageWithName(name, signature, message);
  });

  // Handshake TLD search engine
  ipcMain.handle('searchEngine:getStatus', async () => {
    return await searchIndexService.getStatus();
  });

  ipcMain.handle('searchEngine:search', async (_event, query) => {
    return await searchIndexService.search(query);
  });

  ipcMain.handle('searchEngine:refreshRecent', async (_event, blockCount) => {
    return await searchIndexService.refreshRecent(blockCount);
  });

  ipcMain.handle('searchEngine:cancelRefresh', async () => {
    return await searchIndexService.cancelRefresh();
  });

  ipcMain.handle('searchEngine:refreshName', async (_event, name) => {
    return await searchIndexService.refreshName(name);
  });

  // Wallet
  ipcMain.handle('wallet:getInfo', async () => {
    return await walletService.getInfo();
  });

  ipcMain.handle('wallet:getBalance', async () => {
    return await walletService.getBalance();
  });

  ipcMain.handle('wallet:getNames', async (_event, includeResources) => {
    return await walletService.getNames(includeResources === true);
  });

  ipcMain.handle('wallet:getNameInfo', async (_event, name) => {
    return await walletService.getNameInfo(name);
  });

  ipcMain.handle('wallet:getBids', async (_event, name) => {
    return await walletService.getBids(name);
  });

  ipcMain.handle('wallet:getReveals', async (_event, name) => {
    return await walletService.getReveals(name);
  });

  ipcMain.handle('wallet:getAuctions', async () => {
    return await walletService.getAuctions();
  });

  ipcMain.handle('wallet:getOpenedNames', async () => {
    const opened = await walletService.getOpenedNames(dbService.getJustOpened());

    // Pending opens are now present in history — stop tracking them locally.
    const confirmed = new Set(opened.filter(o => !o.pending).map(o => o.name));
    for (const name of confirmed) {
      dbService.removeJustOpened(name);
    }

    return opened;
  });

  ipcMain.handle('wallet:getAuctionInfo', async (_event, name) => {
    return await walletService.getAuctionInfo(name);
  });

  ipcMain.handle('wallet:sendOpen', async (_event, name, passphrase) => {
    const result = await walletService.sendOpen(name, passphrase);
    // Re-opening a previously dismissed name should make it visible again.
    dbService.removeOpenedHidden(name);
    dbService.addJustOpened(name);
    return result;
  });

  ipcMain.handle('wallet:sendBulkOpen', async (_event, names, passphrase) => {
    const results = await walletService.sendBulkOpen(names, passphrase);
    for (const result of results) {
      if (!result.success) continue;
      dbService.removeOpenedHidden(result.name);
      dbService.addJustOpened(result.name);
    }
    return results;
  });

  ipcMain.handle('wallet:sendBid', async (_event, name, bid, lockup, passphrase) => {
    return await walletService.sendBid(name, bid, lockup, passphrase);
  });

  ipcMain.handle('wallet:sendReveal', async (_event, name, passphrase) => {
    return await walletService.sendReveal(name, passphrase);
  });

  ipcMain.handle('wallet:sendRedeem', async (_event, name, passphrase) => {
    return await walletService.sendRedeem(name, passphrase);
  });

  ipcMain.handle('wallet:sendUpdate', async (_event, name, resource, passphrase) => {
    return await walletService.sendUpdate(name, resource, passphrase);
  });

  ipcMain.handle('wallet:applyTags', async (_event, updates, passphrase) => {
    return await walletService.applyTags(updates, passphrase);
  });

  ipcMain.handle('wallet:sendRenewal', async (_event, name, passphrase) => {
    return await walletService.sendRenewal(name, passphrase);
  });

  ipcMain.handle('wallet:sendTransfer', async (_event, name, address, passphrase) => {
    return await walletService.sendTransfer(name, address, passphrase);
  });

  ipcMain.handle('wallet:sendFinalize', async (_event, name, passphrase) => {
    return await walletService.sendFinalize(name, passphrase);
  });

  ipcMain.handle('wallet:sendCancel', async (_event, name, passphrase) => {
    return await walletService.sendCancel(name, passphrase);
  });

  ipcMain.handle('wallet:sendRevoke', async (_event, name, passphrase) => {
    return await walletService.sendRevoke(name, passphrase);
  });

  ipcMain.handle('wallet:importName', async (_event, name, height) => {
    return await walletService.importName(name, height);
  });

  ipcMain.handle('wallet:unlock', async (event, passphrase, timeout) => {
    assertTrustedSender(event);
    const info = await walletService.getInfo();
    const encrypted = info?.master?.encrypted ?? false;
    const until = info?.master?.until ?? 0;
    const alreadyUnlocked = until > Math.floor(Date.now() / 1000);

    if (!encrypted || alreadyUnlocked) {
      appSessionUnlocked = true;
      return;
    }

    await walletService.unlock(passphrase, timeout);
    appSessionUnlocked = true;
  });

  ipcMain.handle('wallet:lock', async () => {
    appSessionUnlocked = false;
    seedBackupWallet = null;
    seedBackupUntil = 0;
    return await walletService.lock();
  });

  ipcMain.handle('wallet:getTxHistory', async () => {
    return await walletService.getTxHistory();
  });

  ipcMain.handle('wallet:createWallet', async (event, name) => {
    assertTrustedSender(event);
    const result = await walletService.createWallet(name);
    dbService.addKnownWallet(name);
    // The seed may only be retrieved immediately after this creation, so the
    // generic IPC cannot be used to dump an existing wallet's mnemonic later.
    seedBackupWallet = name;
    seedBackupUntil = Date.now() + 10 * 60_000;
    return result;
  });

  ipcMain.handle('wallet:getAddress', async (_event, account) => {
    return await walletService.getAddress(account);
  });

  ipcMain.handle('wallet:createAddress', async (_event, account) => {
    return await walletService.createAddress(account);
  });

  ipcMain.handle('wallet:listAddresses', async (_event, account) => {
    return await walletService.listAddresses(account);
  });

  ipcMain.handle('wallet:sendToAddress', async (_event, address, amount, passphrase, options) => {
    return await walletService.sendToAddress(address, amount, passphrase, options);
  });

  ipcMain.handle('wallet:getFeeEstimates', async () => {
    return await walletService.getFeeEstimates();
  });

  ipcMain.handle('wallet:listWalletsDetailed', async () => {
    const rpcWallets = await walletService.listWalletsDetailed();
    const knownWallets = dbService.getKnownWallets();
    const merged = [...new Set([...rpcWallets, ...knownWallets])];
    return merged.filter(Boolean);
  });

  ipcMain.handle('wallet:getPublicKey', async (_event, address) => {
    return await walletService.getPublicKey(address);
  });

  ipcMain.handle('wallet:importWallet', async (_event, name, mnemonic, passphrase) => {
    const result = await walletService.importWallet(name, mnemonic, passphrase);
    dbService.addKnownWallet(name);
    return result;
  });

  ipcMain.handle('wallet:selectWallet', async (_event, walletId) => {
    const result = await walletService.selectWallet(walletId);
    dbService.addKnownWallet(walletId);
    return result;
  });

  ipcMain.handle('wallet:getMasterKey', async (event, name) => {
    assertTrustedSender(event);
    if (seedBackupWallet !== name || Date.now() > seedBackupUntil) {
      throw new Error(
        'Seed backup is only available immediately after creating a new wallet. '
        + 'Log in to the existing wallet instead.',
      );
    }
    const result = await walletService.getMasterKey(name);
    if (result.mnemonic) {
      seedBackupWallet = null;
      seedBackupUntil = 0;
    }
    return result;
  });

  ipcMain.handle('wallet:encryptWallet', async (_event, name, passphrase) => {
    return await walletService.encryptWallet(name, passphrase);
  });

  ipcMain.handle('wallet:signMessageWithName', async (_event, name, message, passphrase) => {
    return await walletService.signMessageWithName(name, message, passphrase);
  });

  ipcMain.handle('wallet:signMessageBatch', async (_event, names, message, passphrase) => {
    return await walletService.signMessageBatch(names, message, passphrase);
  });

  ipcMain.handle('wallet:deepClean', async () => {
    return await walletService.deepClean();
  });

  ipcMain.handle('wallet:rescan', async (_event, height) => {
    return await walletService.rescan(height);
  });

  // Batch
  ipcMain.handle('batch:execute', async (_event, request) => {
    const job = await batchService.execute(request);
    return job;
  });

  ipcMain.handle('batch:cancel', async (_event, jobId) => {
    return await batchService.cancel(jobId);
  });

  ipcMain.handle('batch:getQueue', async () => {
    return batchService.getQueue();
  });

  ipcMain.handle('batch:getHistory', async () => {
    return await batchService.getHistory();
  });

  ipcMain.handle('batch:retryChunk', async (_event, jobId, chunkIndex) => {
    return await batchService.retryChunk(jobId, chunkIndex);
  });

  // Marketplace
  ipcMain.handle('marketplace:createListing', async (_event, input, passphrase) => {
    return await marketplaceService.createListing(input, passphrase);
  });

  ipcMain.handle('marketplace:cancelListing', async (_event, name, passphrase) => {
    return await marketplaceService.cancelListing(name, passphrase);
  });

  ipcMain.handle('marketplace:getMyListings', async () => {
    return await marketplaceService.getMyListings();
  });

  ipcMain.handle('marketplace:getOffers', async (_event, includeOwn) => {
    return await marketplaceService.getOffers(Boolean(includeOwn));
  });

  ipcMain.handle('marketplace:requestPurchase', async (_event, listing, buyerAddr, useEscrow) => {
    return await marketplaceService.requestPurchase(listing, buyerAddr, Boolean(useEscrow));
  });

  ipcMain.handle('marketplace:getEscrowFundingStatus', async (_event, intentId) => {
    return await marketplaceService.getEscrowFundingStatus(intentId);
  });

  ipcMain.handle('marketplace:fundEscrow', async (_event, intentId, passphrase) => {
    return await marketplaceService.fundEscrow(intentId, passphrase);
  });

  ipcMain.handle('marketplace:createEscrowRelease', async (_event, intentId) => {
    return await marketplaceService.createEscrowRelease(intentId);
  });

  ipcMain.handle('marketplace:signEscrowRelease', async (_event, intentId) => {
    return await marketplaceService.signEscrowRelease(intentId);
  });

  ipcMain.handle('marketplace:createEscrowDisputePsbt', async (_event, intentId, kind) => {
    return await marketplaceService.createEscrowDisputePsbt(intentId, kind);
  });

  ipcMain.handle('marketplace:importEscrowArbiterPsbt', async (_event, intentId, psbt) => {
    return await marketplaceService.importEscrowArbiterPsbt(intentId, psbt);
  });

  ipcMain.handle('marketplace:checkTransferStatus', async (_event, name, buyerAddr, transferTxHash) => {
    return await marketplaceService.checkTransferStatus(name, buyerAddr, transferTxHash);
  });

  ipcMain.handle('marketplace:confirmAndPay', async (_event, intentId, passphrase) => {
    return await marketplaceService.confirmAndPay(intentId, passphrase);
  });

  ipcMain.handle('marketplace:finalizePurchase', async (_event, intentId, passphrase) => {
    return await marketplaceService.finalizePurchase(intentId, passphrase);
  });

  ipcMain.handle('marketplace:getPurchaseRequests', async () => {
    return await marketplaceService.getPurchaseRequests();
  });

  ipcMain.handle('marketplace:getMyPurchases', async () => {
    return await marketplaceService.getMyPurchases();
  });

  ipcMain.handle('marketplace:verifyListing', async (_event, listing) => {
    return await marketplaceService.verifyListing(listing);
  });

  ipcMain.handle('marketplace:republishListing', async (_event, name, price, passphrase) => {
    return await marketplaceService.republishListing(name, price, passphrase);
  });

  ipcMain.handle('marketplace:testRelays', async () => {
    return await marketplaceService.testRelays();
  });

  ipcMain.handle('marketplace:approvePurchase', async (_event, name, buyerAddr, passphrase) => {
    return await marketplaceService.approvePurchase(name, buyerAddr, passphrase);
  });

  ipcMain.handle('marketplace:rejectPurchase', async (_event, name, buyerAddr) => {
    return await marketplaceService.rejectPurchase(name, buyerAddr);
  });

   ipcMain.handle('marketplace:dismissPurchaseRequest', async (_event, name, buyerAddr) => {
     marketplaceService.dismissPurchaseRequest(name, buyerAddr);
   });

   ipcMain.handle('marketplace:forceCancelListing', async (_event, name) => {
     await marketplaceService.forceCancelListing(name);
   });

  ipcMain.handle('marketplace:getNostrPubkey', async () => {
    return marketplaceService.nostrPublicKey;
  });

  ipcMain.handle('marketplace:getRelays', async () => {
    return marketplaceService.relays;
  });

  ipcMain.handle('marketplace:setRelays', async (_event, relays) => {
    marketplaceService.setRelays(relays);
  });

  // Notifications
  ipcMain.handle('notifications:getExpiring', async () => {
    const height = await nodeService.getBlockHeight();
    return await notificationService.getExpiringNames(height);
  });

  ipcMain.handle('notifications:getPendingActions', async () => {
    const height = await nodeService.getBlockHeight();
    return await notificationService.getPendingActions(height);
  });

  // Database
  ipcMain.handle('db:getTags', async () => {
    return dbService.getTags();
  });

  ipcMain.handle('db:createTag', async (_event, name, color) => {
    return dbService.createTag(name, color);
  });

  ipcMain.handle('db:updateTag', async (_event, id, name, color) => {
    return dbService.updateTag(id, name, color);
  });

  ipcMain.handle('db:deleteTag', async (_event, id) => {
    return dbService.deleteTag(id);
  });

  ipcMain.handle('db:assignTag', async (_event, domainName, tagId) => {
    return dbService.assignTag(domainName, tagId);
  });

  ipcMain.handle('db:removeTag', async (_event, domainName, tagId) => {
    return dbService.removeTag(domainName, tagId);
  });

  ipcMain.handle('db:getTagsForDomain', async (_event, domainName) => {
    return dbService.getTagsForDomain(domainName);
  });

  ipcMain.handle('db:getDomainsForTag', async (_event, tagId) => {
    return dbService.getDomainsForTag(tagId);
  });

  ipcMain.handle('db:addToWatchlist', async (_event, name, notes, notifyOn) => {
    return dbService.addToWatchlist(name, notes, notifyOn);
  });

  ipcMain.handle('db:removeFromWatchlist', async (_event, name) => {
    return dbService.removeFromWatchlist(name);
  });

  ipcMain.handle('db:getWatchlist', async () => {
    return dbService.getWatchlist();
  });

  ipcMain.handle('db:updateWatchlistNotifyOn', async (_event, name, notifyOn) => {
    return dbService.updateWatchlistNotifyOn(name, notifyOn);
  });

  ipcMain.handle('db:getSearchHistory', async () => {
    return dbService.getSearchHistory();
  });

  ipcMain.handle('db:saveSearchHistory', async (_event, names, summary) => {
    return dbService.saveSearchHistory(names, summary);
  });

  ipcMain.handle('db:saveBidReceipt', async (_event, name, receipt) => {
    return dbService.saveBidReceipt(name, receipt);
  });

  ipcMain.handle('db:getBidReceipt', async (_event, name) => {
    return dbService.getBidReceipt(name);
  });

  ipcMain.handle('db:removeBidReceipt', async (_event, name) => {
    return dbService.removeBidReceipt(name);
  });

  ipcMain.handle('db:getAllBidReceipts', async () => {
    return dbService.getAllBidReceipts();
  });

  ipcMain.handle('db:getRevealedNames', async () => {
    return dbService.getRevealedNames();
  });

  ipcMain.handle('db:addRevealedName', async (_event, name) => {
    return dbService.addRevealedName(name);
  });

  ipcMain.handle('db:removeRevealedName', async (_event, name) => {
    return dbService.removeRevealedName(name);
  });

  ipcMain.handle('db:setRevealedNames', async (_event, names) => {
    return dbService.setRevealedNames(names);
  });

  ipcMain.handle('db:getOpenedHidden', async () => {
    return dbService.getOpenedHidden();
  });

  ipcMain.handle('db:addOpenedHidden', async (_event, name) => {
    return dbService.addOpenedHidden(name);
  });

  ipcMain.handle('db:removeOpenedHidden', async (_event, name) => {
    return dbService.removeOpenedHidden(name);
  });

  ipcMain.handle('db:getJustRedeemed', async () => {
    return dbService.getJustRedeemed();
  });

  ipcMain.handle('db:addJustRedeemed', async (_event, name) => {
    return dbService.addJustRedeemed(name);
  });

  ipcMain.handle('db:removeJustRedeemed', async (_event, name) => {
    return dbService.removeJustRedeemed(name);
  });

  ipcMain.handle('db:setJustRedeemed', async (_event, names) => {
    return dbService.setJustRedeemed(names);
  });

  ipcMain.handle('db:getJustRegistered', async () => {
    return dbService.getJustRegistered();
  });

  ipcMain.handle('db:addJustRegistered', async (_event, name) => {
    return dbService.addJustRegistered(name);
  });

  ipcMain.handle('db:removeJustRegistered', async (_event, name) => {
    return dbService.removeJustRegistered(name);
  });

   ipcMain.handle('db:setJustRegistered', async (_event, names) => {
    return dbService.setJustRegistered(names);
  });

  ipcMain.handle('db:getListingVerification', async (_event, name) => {
    return dbService.getListingVerification(name);
  });

  ipcMain.handle('db:setListingVerification', async (_event, name, verified) => {
    dbService.setListingVerification(name, verified);
  });

  // Config
  ipcMain.handle('config:get', async (_event, key) => {
    return dbService.getSetting(key);
  });

  ipcMain.handle('config:set', async (_event, key, value) => {
    return dbService.setSetting(key, value);
  });

  ipcMain.handle('config:getAll', async () => {
    return dbService.getAllSettings();
  });

  ipcMain.handle('config:getDataDir', async () => {
    return dbService.getDataDir();
  });

  ipcMain.handle('config:getDefaultHsdDataDir', async () => {
    return configService.getDefaultHsdDataDir();
  });

  // HSD Process Management
  ipcMain.handle('hsd:start', async (_event, config) => {
    const storedNodePath = dbService.getSetting('hsdNodePath');
    const startConfig = {
      ...(config as Record<string, unknown> | null),
      nodePath: (config as { nodePath?: string } | null)?.nodePath
        || (typeof storedNodePath === 'string' && storedNodePath ? storedNodePath : undefined),
    } as ManagedNodeConfig;
    const success = await hsdProcessService.start(startConfig);
    if (success) {
      // Sync the managed node's clients to the HSDConnectionService
      // so all backend services (nodeService, walletService, etc.) use them
      const clients = hsdProcessService.getClients();
      connectionService.setClients(clients.nodeClient, clients.walletClient);
      const network = startConfig.network;
      connectionService.setNetwork(
        network === 'testnet' || network === 'regtest' ? network : 'main',
      );
    }
    return { success, error: hsdProcessService.lastError };
  });

  ipcMain.handle('hsd:stop', async () => {
    appSessionUnlocked = false;
    seedBackupWallet = null;
    seedBackupUntil = 0;
    await hsdProcessService.stop();
    await connectionService.disconnect();
  });

  ipcMain.handle('hsd:status', async () => {
    return hsdProcessService.getStatus();
  });

  ipcMain.handle('hsd:setDataDir', async (_event, path) => {
    dbService.setHsdDataDir(path);
  });

  ipcMain.handle('hsd:setBinaryPath', async (_event, path) => {
    dbService.setHsdBinaryPath(path);
  });

  ipcMain.handle('hsd:detectHsd', async () => {
    return await configService.detectHsdBinary();
  });

  // First-run setup wizard
  ipcMain.handle('setup:getStatus', async () => {
    return await setupService.getStatus();
  });

  ipcMain.handle('setup:downloadRuntime', async () => {
    return await setupService.downloadRuntime();
  });

  ipcMain.handle('setup:installRuntimeFromFile', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Select the Handess HSD runtime zip',
      properties: ['openFile'],
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return await setupService.installRuntimeFromZip(result.filePaths[0]);
  });

  ipcMain.handle('setup:chooseDataDir', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the HSD data folder',
      defaultPath: dbService.getHsdDataDir() || configService.getDefaultHsdDataDir(),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('setup:cancelRuntime', async () => {
    return setupService.cancelRuntime();
  });

  ipcMain.handle('setup:complete', async (_event, input: SetupCompleteInput) => {
    await setupService.complete(input);
  });

  ipcMain.handle('setup:openReleasePage', async () => {
    await shell.openExternal(SETUP_RELEASE_URL);
  });

  // Build an external connection config for a local hsd node. This only proves
  // that credentials exist; callers must probe the ports before deciding that
  // the node is actually running.
  ipcMain.handle('hsd:getExistingNodeConfig', async (): Promise<HSDConnectionConfig | null> => {
    const dataDir = dbService.getHsdDataDir();
    const saved = dbService.getSavedConnectionConfig();
    const network: HSDConnectionConfig['network'] =
      saved?.network === 'testnet' || saved?.network === 'regtest'
        ? saved.network
        : 'main';
    const apiKey = (dataDir ? readApiKeyConf(dataDir, network) : null)
      || saved?.apiKey
      || '';
    if (!apiKey) return null;

    const ports = network === 'testnet'
      ? { nodePort: 13037, walletPort: 13039 }
      : network === 'regtest'
        ? { nodePort: 14037, walletPort: 14039 }
        : { nodePort: 12037, walletPort: 12039 };

    return {
      host: '127.0.0.1',
      ...ports,
      apiKey,
      nodeApiKey: apiKey,
      walletApiKey: apiKey,
      network,
      walletId: saved?.walletId || '',
      ssl: false,
    };
  });

  // Probe a loopback TCP port without making an RPC request. The renderer uses
  // this to distinguish a saved API key from a node that is actually listening.
  ipcMain.handle('hsd:isPortListening', async (_event, host: unknown, port: unknown) => {
    if (typeof host !== 'string' || typeof port !== 'number') return false;

    const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized !== '127.0.0.1' && normalized !== 'localhost' && normalized !== '::1') {
      return false;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;

    return await isPortOpen(normalized, port, 750);
  });

  // Advanced HSD Configuration
  ipcMain.handle('hsd:getAdvancedConfig', async () => {
    return dbService.getHsdAdvancedConfig();
  });

  ipcMain.handle('hsd:saveAdvancedConfig', async (_event, config) => {
    dbService.setHsdAdvancedConfig(config);
    const dataDir = dbService.getHsdDataDir();
    if (!dataDir) return;

    const network = dbService.getSavedConnectionConfig()?.network || 'main';
    // The conf file is now the source of truth for the API key. Never
    // overwrite it with a hardcoded or stale value.
    const apiKey =
      readApiKeyConf(dataDir, network) ||
      dbService.getHsdApiKey() ||
      generateApiKey();

    const hasAnySetting = config && typeof config === 'object' && Object.keys(config).length > 0;
    if (hasAnySetting) {
      try {
        HSDProcessService.generateHsdConf(
          config as Record<string, unknown>,
          dataDir,
          network,
          apiKey
        );
      } catch (err) {
        console.error('[Main] Failed to write hsd.conf:', err);
      }
    } else {
      // Empty config = reset advanced settings, but keep the API key so the
      // running node and the app remain in sync.
      const confPath = join(hsdPrefixDir(dataDir, network), 'hsd.conf');
      try {
        if (existsSync(confPath)) {
          unlinkSync(confPath);
          console.log('[Main] Deleted hsd.conf (reset to defaults)');
        }
        ensureApiKeyConf(dataDir, apiKey, network);
      } catch (err) {
        console.error('[Main] Failed to reset hsd.conf:', err);
      }
    }
  });

  // ============================================================
  // DGB (DigiByte / Electrum)
  // ============================================================

  ipcMain.handle('dgb:connect', async (_event, host, port, ssl, network) => {
    try {
      await electrumDgbService.connect(host, port, ssl, network as DgbNetworkType);
    } catch (err) {
      throw new Error(`DGB connection failed: ${err}`);
    }
  });

  ipcMain.handle('dgb:disconnect', async () => {
    await electrumDgbService.disconnect();
  });

  ipcMain.handle('dgb:getWif', async (event, passphrase) => {
    assertTrustedSender(event);
    if (!appSessionUnlocked) {
      throw new Error('Log in to the wallet before revealing the DGB private key.');
    }

    const walletInfo = await walletService.getInfo();
    if (walletInfo?.master?.encrypted) {
      if (!passphrase) {
        throw new Error('Wallet passphrase is required to reveal the DGB private key.');
      }
      // Re-authenticate even if the wallet is already temporarily unlocked.
      await walletService.unlock(passphrase, 300);
    }

    const seed = dbService.getDgbSeed();
    if (!seed) return '';
    const config = dbService.getDgbServerConfig();
    const network = config?.network || 'mainnet';
    const dgbNet = getDgbNetwork(network);
    const privKey = Buffer.from(seed, 'hex').slice(0, 32);
    const payload = Buffer.concat([Buffer.from([dgbNet.wif]), privKey, Buffer.from([0x01])]);
    const hash = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest();
    const buf = Buffer.concat([payload, hash.slice(0, 4)]);
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const base = BigInt(58);
    let num = BigInt('0x' + buf.toString('hex'));
    let encoded = '';
    while (num > 0n) {
      encoded = ALPHABET[Number(num % base)] + encoded;
      num /= base;
    }
    for (let i = 0; i < buf.length && buf[i] === 0; i++) encoded = '1' + encoded;
    return encoded;
  });

  ipcMain.handle('dgb:getBalance', async (_event, address) => {
    return await electrumDgbService.getBalance(address);
  });

  ipcMain.handle('dgb:getAddress', async () => {
    let seed = dbService.getDgbSeed();
    if (!seed) {
      seed = bytesToHex(randomBytes(32));
      dbService.setDgbSeed(seed);
    }
    const config = dbService.getDgbServerConfig();
    const network = config?.network || 'mainnet';
    const dgbNet = getDgbNetwork(network);
    const btcNet = toBitcoinJsNetwork(dgbNet);
    const privateKey = Buffer.from(seed, 'hex').slice(0, 32);
    const pubKeyBytes = secp256k1.getPublicKey(privateKey, true);
    const { address } = bitcoin.payments.p2pkh({ pubkey: Buffer.from(pubKeyBytes), network: btcNet });
    if (address) {
      dbService.setDgbDerivedAddress(address);
    }
    return address || '';
  });

  ipcMain.handle('dgb:getUnspent', async (_event, address) => {
    return await electrumDgbService.listUnspent(address);
  });

  ipcMain.handle('dgb:broadcast', async (_event, rawTxHex) => {
    return await electrumDgbService.broadcastTransaction(rawTxHex);
  });

  ipcMain.handle('dgb:estimateFee', async (_event, blocks) => {
    return await electrumDgbService.estimateFee(blocks);
  });

  ipcMain.handle('dgb:getConfig', async () => {
    return dbService.getDgbServerConfig();
  });

  ipcMain.handle('dgb:saveConfig', async (_event, config) => {
    dbService.setDgbServerConfig(config as DgbServerConfig);
  });

  ipcMain.handle('dgb:getStatus', async () => {
    return {
      connected: electrumDgbService.isConnected(),
      ...electrumDgbService.getServerInfo(),
    };
  });

  // ============================================================
  // Swap
  // ============================================================

  ipcMain.handle('swap:publishOffer', async (_event, offer) => {
    return await swapService.publishOffer(offer as Omit<
      SwapOffer,
      'id' | 'nostrPubkey' | 'createdAt' | 'status' | 'dgbPubKey'
    >);
  });

  ipcMain.handle('swap:cancelOffer', async (_event, offerId) => {
    await swapService.cancelOffer(offerId);
  });

  ipcMain.handle('swap:fetchActiveOffers', async () => {
    return await swapService.fetchActiveOffers();
  });

  ipcMain.handle('swap:acceptOffer', async (_event, offer) => {
    return await swapService.acceptOffer(offer as SwapOffer);
  });

  ipcMain.handle('swap:getMySwaps', async () => {
    return await swapService.getMySwaps();
  });

  ipcMain.handle('swap:getMySwapOffers', async () => {
    return await swapService.getMySwapOffers();
  });

  ipcMain.handle('swap:getSwapById', async (_event, swapId) => {
    return await swapService.getSwapById(swapId);
  });

  ipcMain.handle('swap:getNostrPubkey', async () => {
    return swapService.publicKey;
  });

  // Swap Execution (on-chain HTLC)
  ipcMain.handle('swap:fundDgbHtlc', async (_event, swapId) => {
    return await swapService.fundDgbHtlc(swapId);
  });

  ipcMain.handle('swap:claimFromDgbHtlc', async (_event, swapId) => {
    return await swapService.claimFromDgbHtlc(swapId);
  });

  ipcMain.handle('swap:claimFromHnsHtlc', async (_event, swapId) => {
    return await swapService.claimFromHnsHtlc(swapId);
  });

  ipcMain.handle('swap:rebroadcastHnsClaim', async (_event, swapId) => {
    return await swapService.rebroadcastHnsClaim(swapId);
  });

  ipcMain.handle('swap:refundHnsHtlc', async (_event, swapId) => {
    return await swapService.refundHnsHtlc(swapId);
  });

  ipcMain.handle('swap:refundDgbHtlc', async (_event, swapId) => {
    return await swapService.refundDgbHtlc(swapId);
  });

  ipcMain.handle('swap:setAutoComplete', async (_event, swapId, enabled) => {
    await swapService.setSwapAutoComplete(swapId, Boolean(enabled));
  });

  ipcMain.handle('swap:startMonitor', async () => {
    await swapService.startMonitor();
  });

  ipcMain.handle('swap:stopMonitor', async () => {
    swapService.stopMonitor();
  });

  ipcMain.handle('swap:executeSwapAsInitiator', async (_event, swapId, passphrase) => {
    return await swapService.executeSwapAsInitiator(swapId, passphrase);
  });

  // ============================================================
  // Price Feed (CoinGecko proxy - avoids CORS in renderer)
  // ============================================================

  ipcMain.handle('price:getHnsUsd', async () => {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=handshake&vs_currencies=usd');
      const data = await res.json() as Record<string, Record<string, number>>;
      const usd = data?.handshake?.usd;
      return typeof usd === 'number' && usd > 0 ? usd : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('price:getDgbUsd', async () => {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=digibyte&vs_currencies=usd');
      const data = await res.json() as Record<string, Record<string, number>>;
      const usd = data?.digibyte?.usd;
      return typeof usd === 'number' && usd > 0 ? usd : null;
    } catch {
      return null;
    }
  });

  console.log('[Main] IPC handlers registered');
}

// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  // Wallet UI needs no browser permissions (camera, microphone, geolocation,
  // notifications, etc.). Deny every request by default.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  await createServices();
  registerIPCHandlers();
  createWindow();

  // Start notification monitoring
  notificationService.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let shutdownStarted = false;

app.on('before-quit', (event) => {
  if (shutdownStarted) return;

  // Electron does not wait for async `before-quit` handlers. Prevent the
  // first quit, stop the managed child (and close the wallet DB cleanly),
  // then quit again. This avoids leaving an orphaned hsd process behind.
  event.preventDefault();
  shutdownStarted = true;

  void (async () => {
    try {
      notificationService.stop();
      // Persist any debounced TLD index overlay before shutting down.
      await searchIndexService?.flush();
      await connectionService.disconnect();
      await electrumDgbService.disconnect();
      if (hsdProcessService) {
        await hsdProcessService.stop();
      }
    } catch (err) {
      console.error('[Main] Shutdown error:', err);
    } finally {
      console.log('[Main] App shutting down');
      app.quit();
    }
  })();
});
