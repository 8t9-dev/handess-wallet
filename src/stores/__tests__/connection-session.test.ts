import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useConnectionStore } from '../connection-store';
import type { HSDConnectionConfig, NodeInfo, WalletBalance, WalletInfo } from '../../types/wallet';

const CONFIG: HSDConnectionConfig = {
  host: '127.0.0.1',
  nodePort: 12037,
  walletPort: 12039,
  apiKey: 'test-key',
  network: 'main',
  walletId: 'primary',
  ssl: false,
};

const NODE_INFO = {
  version: '8.0.0',
  network: 'main',
  chain: { height: 352_867, tip: '00', progress: 1 },
  pool: { host: '127.0.0.1', port: 12038, agent: 'hsd', services: '', outbound: 8, inbound: 0 },
  mempool: { tx: 0, size: 0 },
} as NodeInfo;

const BALANCE = {
  confirmed: 60_532_131_112,
  unconfirmed: 60_532_131_112,
  lockedConfirmed: 0,
  lockedUnconfirmed: 0,
  spendable: 60_532_131_112,
} as WalletBalance;

function walletInfo(overrides: { encrypted?: boolean; until?: number } = {}): WalletInfo {
  return {
    id: 'primary',
    wid: 1,
    watchOnly: false,
    accountDepth: 1,
    token: '',
    master: {
      encrypted: overrides.encrypted ?? true,
      until: overrides.until ?? 0,
    },
    balance: BALANCE,
    height: 352_867,
  };
}

function makeApi(options: { encrypted?: boolean; until?: number; wallets?: string[] } = {}) {
  const api = {
    connection: {
      connect: vi.fn().mockResolvedValue(true),
      getLastError: vi.fn().mockResolvedValue(null),
      disconnect: vi.fn().mockResolvedValue(undefined),
      detectBobConfig: vi.fn().mockResolvedValue(CONFIG),
    },
    node: {
      getInfo: vi.fn().mockResolvedValue(NODE_INFO),
      shutdown: vi.fn().mockResolvedValue(undefined),
    },
    wallet: {
      getInfo: vi.fn().mockResolvedValue(walletInfo(options)),
      getBalance: vi.fn().mockResolvedValue(BALANCE),
      listWalletsDetailed: vi.fn().mockResolvedValue(options.wallets ?? ['primary']),
      selectWallet: vi.fn().mockResolvedValue(undefined),
      unlock: vi.fn().mockResolvedValue(undefined),
      lock: vi.fn().mockResolvedValue(undefined),
    },
    hsd: {
      startManagedNode: vi.fn().mockResolvedValue({ success: true }),
      stopManagedNode: vi.fn().mockResolvedValue(undefined),
    },
  };
  vi.stubGlobal('window', { api });
  return api;
}

function resetStore() {
  useConnectionStore.setState({
    connectionState: 'disconnected',
    config: null,
    nodeInfo: null,
    walletInfo: null,
    walletHeight: 0,
    balance: null,
    blockHeight: 0,
    syncProgress: 0,
    chainSynced: false,
    network: 'main',
    error: null,
    processStatus: 'stopped',
    managedNodeConfig: null,
    wallets: [],
    walletEncryption: null,
    walletState: 'unchecked',
    isUnlocking: false,
    showOnboarding: false,
    isLoggedIn: false,
  });
}

beforeEach(resetStore);

afterEach(() => {
  // Clears the sync polling interval without touching the stubbed API.
  useConnectionStore.getState().handleNodeStopped();
  vi.unstubAllGlobals();
});

describe('connection session gating', () => {
  it('opens the login card after connecting but does not load or expose wallet data', async () => {
    const api = makeApi({ encrypted: true });
    const store = useConnectionStore.getState();

    await store.connect(CONFIG);

    const state = useConnectionStore.getState();
    expect(state.connectionState).toBe('connected');
    expect(state.showOnboarding).toBe(true);
    expect(state.isLoggedIn).toBe(false);
    expect(state.balance).toBeNull();
    expect(state.walletInfo).toBeNull();
    expect(state.walletEncryption).toEqual({ id: 'primary', encrypted: true, until: 0 });
    expect(api.wallet.getBalance).not.toHaveBeenCalled();
  });

  it('clears a previous session when reconnecting', async () => {
    makeApi({ encrypted: true });
    useConnectionStore.setState({
      connectionState: 'connected',
      isLoggedIn: true,
      showOnboarding: false,
      balance: BALANCE,
      walletInfo: walletInfo(),
      wallets: ['primary'],
      blockHeight: 100,
    });

    await useConnectionStore.getState().connect(CONFIG);

    const state = useConnectionStore.getState();
    expect(state.isLoggedIn).toBe(false);
    expect(state.balance).toBeNull();
    expect(state.showOnboarding).toBe(true);
  });

  it('marks the session logged in only after a successful unlock', async () => {
    const api = makeApi({ encrypted: true, until: 0 });
    await useConnectionStore.getState().connect(CONFIG);

    const ok = await useConnectionStore.getState().unlockWallet('correct horse');

    expect(ok).toBe(true);
    expect(api.wallet.unlock).toHaveBeenCalledWith('correct horse', 300);
    const state = useConnectionStore.getState();
    expect(state.isLoggedIn).toBe(true);
    expect(state.showOnboarding).toBe(false);
    expect(state.balance).toEqual(BALANCE);
  });

  it('opens an explicit session for unencrypted wallets without requiring a passphrase', async () => {
    const api = makeApi({ encrypted: false });
    useConnectionStore.setState({
      connectionState: 'connected',
      showOnboarding: true,
      wallets: ['primary'],
      walletState: 'unlocked',
    });

    const ok = await useConnectionStore.getState().unlockWallet('');

    expect(ok).toBe(true);
    expect(api.wallet.unlock).toHaveBeenCalledWith('', 300);
    const state = useConnectionStore.getState();
    expect(state.isLoggedIn).toBe(true);
    expect(state.showOnboarding).toBe(false);
  });

  it('locking the wallet clears the balance and requires a new login', async () => {
    makeApi();
    useConnectionStore.setState({
      connectionState: 'connected',
      isLoggedIn: true,
      showOnboarding: false,
      balance: BALANCE,
      walletInfo: walletInfo({ encrypted: true, until: 123 }),
      wallets: ['primary'],
    });

    await useConnectionStore.getState().lockWallet();

    const state = useConnectionStore.getState();
    expect(state.isLoggedIn).toBe(false);
    expect(state.balance).toBeNull();
    expect(state.walletInfo).toBeNull();
    expect(state.showOnboarding).toBe(true);
  });

  it('stopping the node clears wallet data, balance, and session', () => {
    useConnectionStore.setState({
      connectionState: 'connected',
      isLoggedIn: true,
      showOnboarding: false,
      balance: BALANCE,
      walletInfo: walletInfo(),
      wallets: ['primary', 'bcorewallet'],
      blockHeight: 352_867,
      processStatus: 'running',
    });

    useConnectionStore.getState().handleNodeStopped();

    const state = useConnectionStore.getState();
    expect(state.connectionState).toBe('disconnected');
    expect(state.processStatus).toBe('stopped');
    expect(state.isLoggedIn).toBe(false);
    expect(state.balance).toBeNull();
    expect(state.walletInfo).toBeNull();
    expect(state.wallets).toEqual([]);
    expect(state.blockHeight).toBe(0);
    expect(state.showOnboarding).toBe(false);
  });

  it('starting a managed node requires an explicit login afterwards', async () => {
    const api = makeApi({ encrypted: true });
    const store = useConnectionStore.getState();

    const started = await store.startManagedNode({
      dataDir: 'E:\\.hsd',
      network: 'main',
      walletId: 'primary',
    });

    expect(started).toBe(true);
    const state = useConnectionStore.getState();
    expect(state.processStatus).toBe('running');
    expect(state.connectionState).toBe('connected');
    expect(state.showOnboarding).toBe(true);
    expect(state.isLoggedIn).toBe(false);
    expect(state.balance).toBeNull();
    expect(api.wallet.getBalance).not.toHaveBeenCalled();
  });

  it('an unreachable node invalidates the session and cached data', () => {
    useConnectionStore.setState({
      connectionState: 'connected',
      isLoggedIn: true,
      balance: BALANCE,
      walletInfo: walletInfo(),
      wallets: ['primary'],
      blockHeight: 352_867,
    });

    useConnectionStore.getState().handleNodeUnreachable();

    const state = useConnectionStore.getState();
    expect(state.connectionState).toBe('error');
    expect(state.isLoggedIn).toBe(false);
    expect(state.balance).toBeNull();
    expect(state.walletInfo).toBeNull();
    expect(state.wallets).toEqual([]);
    expect(state.blockHeight).toBe(0);
  });

  it('stops a managed node through the process service, not the RPC', async () => {
    const api = makeApi();
    useConnectionStore.setState({
      connectionState: 'connected',
      processStatus: 'running',
      isLoggedIn: true,
      showOnboarding: false,
      balance: BALANCE,
      walletInfo: walletInfo(),
      wallets: ['primary'],
      blockHeight: 352_867,
    });

    await useConnectionStore.getState().stopNode();

    expect(api.hsd.stopManagedNode).toHaveBeenCalledTimes(1);
    expect(api.node.shutdown).not.toHaveBeenCalled();
    const state = useConnectionStore.getState();
    expect(state.connectionState).toBe('disconnected');
    expect(state.processStatus).toBe('stopped');
    expect(state.isLoggedIn).toBe(false);
    expect(state.balance).toBeNull();
  });

  it('stops a connected external local node through the shutdown RPC', async () => {
    const api = makeApi();
    useConnectionStore.setState({
      connectionState: 'connected',
      config: CONFIG,
      processStatus: 'stopped',
      isLoggedIn: true,
      showOnboarding: false,
      balance: BALANCE,
      walletInfo: walletInfo(),
      wallets: ['primary'],
      blockHeight: 352_867,
    });

    await useConnectionStore.getState().stopNode();

    expect(api.node.shutdown).toHaveBeenCalledTimes(1);
    expect(api.hsd.stopManagedNode).not.toHaveBeenCalled();
    const state = useConnectionStore.getState();
    expect(state.connectionState).toBe('disconnected');
    expect(state.processStatus).toBe('stopped');
    expect(state.isLoggedIn).toBe(false);
    expect(state.balance).toBeNull();
    expect(state.walletInfo).toBeNull();
  });

  it('never sends a shutdown RPC to a remote node', async () => {
    const api = makeApi();
    useConnectionStore.setState({
      connectionState: 'connected',
      config: { ...CONFIG, host: '10.0.0.5' },
      processStatus: 'stopped',
      isLoggedIn: true,
      balance: BALANCE,
      walletInfo: walletInfo(),
      wallets: ['primary'],
    });

    await useConnectionStore.getState().stopNode();

    expect(api.node.shutdown).not.toHaveBeenCalled();
    expect(api.connection.disconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().connectionState).toBe('disconnected');
    expect(useConnectionStore.getState().balance).toBeNull();
  });
});
