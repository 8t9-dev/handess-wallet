/**
 * Connection Store (Zustand)
 *
 * Manages the connection state to the hsd node.
 * Provides connection status, node info, block height,
 * and methods to connect/disconnect.
 */

import { create } from 'zustand';
import type { ConnectionState, HSDConnectionConfig, NodeInfo, WalletInfo, WalletBalance, ManagedNodeConfig, HSDProcessState } from '../types/wallet';

let syncPollInterval: ReturnType<typeof setInterval> | null = null;
let prevHeight = 0;
let prevWalletHeight = 0;
let stableCount = 0;
let seenHeightIncrease = false;
let consecutiveNodeErrors = 0;
let consecutiveWalletStuck = 0;
const STABLE_THRESHOLD = 3; // 3 consecutive polls (30s) without height change = synced
const NODE_ERROR_THRESHOLD = 3; // 3 consecutive RPC failures = node unreachable
const WALLET_STUCK_THRESHOLD = 6; // 6 consecutive polls (60s) with wallet behind node = wallet stuck

/**
 * Wallet data that must never survive a node stop, disconnect, or lock.
 * Keeping this in one place prevents stale balances from being rendered
 * behind the login gate.
 */
function clearedWalletSession() {
  return {
    walletInfo: null,
    walletEncryption: null,
    balance: null,
    wallets: [] as string[],
    walletState: 'unchecked' as 'unchecked' | 'no-wallet' | 'locked' | 'unlocked',
    isLoggedIn: false,
    isUnlocking: false,
    showOnboarding: false,
  };
}

function startSyncPolling() {
  stopSyncPolling();
  prevHeight = 0;
  prevWalletHeight = 0;
  stableCount = 0;
  seenHeightIncrease = false;
  consecutiveNodeErrors = 0;
  consecutiveWalletStuck = 0;
  syncPollInterval = setInterval(async () => {
    const store = useConnectionStore.getState();
    await store.refreshNodeInfo();

    // Wallet data is only refreshed for an authenticated session. Polling
    // wallet RPCs while logged out would keep stale balances in the store.
    if (useConnectionStore.getState().isLoggedIn) {
      useConnectionStore.getState().refreshWallet().catch(() => {});
    }

    // Check if node became unreachable
    if (consecutiveNodeErrors >= NODE_ERROR_THRESHOLD) {
      useConnectionStore.getState().handleNodeUnreachable();
      return;
    }

    // Detect stability: if height hasn't changed, increment counter
    const currentHeight = useConnectionStore.getState().blockHeight;
    const currentWalletHeight = useConnectionStore.getState().walletHeight;
    const currentProgress = useConnectionStore.getState().syncProgress;

    // Check if wallet is stuck behind the node
    if (currentWalletHeight > 0 && currentHeight > 0 && currentWalletHeight < currentHeight - 3) {
      if (prevWalletHeight > 0 && currentWalletHeight === prevWalletHeight) {
        consecutiveWalletStuck++;
      } else {
        consecutiveWalletStuck = 0;
      }
      if (consecutiveWalletStuck >= WALLET_STUCK_THRESHOLD) {
        useConnectionStore.setState({
          error: `Wallet stuck at block ${currentWalletHeight.toLocaleString()} — node is at ${currentHeight.toLocaleString()}. Try restarting from Settings.`,
        });
      }
    } else {
      consecutiveWalletStuck = 0;
    }

    if (prevHeight === 0) {
      // First poll after connect — just record baseline
      stableCount = 0;

      // If node is already at chain tip (progress === 1), mark as synced immediately
      if (currentHeight > 0 && currentProgress >= 1) {
        useConnectionStore.getState().setSyncProgress(1);
        useConnectionStore.setState({ chainSynced: true });
      }
    } else if (currentHeight > prevHeight) {
      // Height increased — node is actively syncing
      seenHeightIncrease = true;
      stableCount = 0;
      useConnectionStore.setState({ chainSynced: false });
    } else if (currentHeight === prevHeight) {
      // Height stable — increment counter toward "synced"
      stableCount++;
      if (stableCount >= STABLE_THRESHOLD) {
        // Either we saw a height increase before, or the node was already at tip
        if (seenHeightIncrease || currentProgress >= 1) {
          useConnectionStore.getState().setSyncProgress(1);
          useConnectionStore.setState({ chainSynced: true });
        }
      }
    } else {
      // Height went backwards (shouldn't happen) — reset
      stableCount = 0;
    }
    prevHeight = currentHeight;
    prevWalletHeight = currentWalletHeight;
  }, 10000);
}
function stopSyncPolling() {
  if (syncPollInterval !== null) {
    clearInterval(syncPollInterval);
    syncPollInterval = null;
  }
  prevHeight = 0;
  prevWalletHeight = 0;
  stableCount = 0;
  seenHeightIncrease = false;
  consecutiveNodeErrors = 0;
  consecutiveWalletStuck = 0;
}

interface ConnectionStore {
  connectionState: ConnectionState;
  config: HSDConnectionConfig | null;
  nodeInfo: NodeInfo | null;
  walletInfo: WalletInfo | null;
  walletHeight: number; // wallet's last processed block (behind blockHeight during catch-up)
  balance: WalletBalance | null;
  blockHeight: number;
  syncProgress: number; // 0.0 to 1.0 from hsd getProgress()
  chainSynced: boolean;  // true when height has been stable for 30s
  network: string;
  error: string | null;
  processStatus: HSDProcessState;
  managedNodeConfig: ManagedNodeConfig | null;

  // Wallet auth state
  wallets: string[];
  /** Non-sensitive lock metadata for the selected wallet (safe pre-login). */
  walletEncryption: { id: string; encrypted: boolean; until: number } | null;
  walletState: 'unchecked' | 'no-wallet' | 'locked' | 'unlocked';
  isUnlocking: boolean;
  showOnboarding: boolean;
  /**
   * True only after an explicit, successful wallet login in this app session.
   * Never persisted and never derived from the node connection alone.
   */
  isLoggedIn: boolean;

  connect: (config: HSDConnectionConfig) => Promise<boolean>;
  disconnect: () => Promise<void>;
  autoConnect: () => Promise<boolean>;
  testConnection: (config: HSDConnectionConfig) => Promise<{ success: boolean; error?: string }>;
  setBlockHeight: (height: number) => void;
  setSyncProgress: (progress: number) => void;
  refreshWallet: () => Promise<void>;
  refreshNodeInfo: () => Promise<void>;
  checkWalletState: () => Promise<void>;
  unlockWallet: (passphrase: string, timeout?: number) => Promise<boolean>;
  lockWallet: () => Promise<void>;
  dismissOnboarding: () => void;
  openOnboarding: () => void;
  setError: (error: string | null) => void;
  startManagedNode: (config: ManagedNodeConfig) => Promise<boolean>;
  stopManagedNode: () => Promise<void>;
  /** Stop whichever node the app is currently running/connected to. */
  stopNode: () => Promise<void>;
  setProcessStatus: (status: HSDProcessState) => void;
  /** Node lifecycle transitions that must invalidate the wallet session. */
  handleNodeStopped: () => void;
  handleNodeError: (message: string) => void;
  handleNodeUnreachable: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
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

  connect: async (config) => {
    stopSyncPolling();
    set({
      connectionState: 'connecting',
      config: null,
      nodeInfo: null,
      blockHeight: 0,
      walletHeight: 0,
      syncProgress: 0,
      chainSynced: false,
      error: null,
      ...clearedWalletSession(),
    });

    try {
      const success = await window.api.connection.connect(config);
      if (success) {
        const nodeInfo = await window.api.node.getInfo();
        set({
          connectionState: 'connected',
          config,
          nodeInfo,
          blockHeight: nodeInfo.chain.height,
          walletHeight: 0,
          syncProgress: nodeInfo.chain.progress,
          chainSynced: false,
          network: nodeInfo.network,
          error: null,
        });
        startSyncPolling();
        // Discover wallet names and lock state, but never fetch or expose
        // balances until the user explicitly logs in.
        await get().checkWalletState();
        set({ showOnboarding: true });
        return true;
      }
      let detail: string | null = null;
      try {
        detail = await window.api.connection.getLastError();
      } catch {
        detail = null;
      }
      set({
        connectionState: 'error',
        error: detail || 'Connection failed. Check your API key and wallet name.',
      });
      return false;
    } catch (err) {
      set({
        connectionState: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return false;
    }
  },

  disconnect: async () => {
    stopSyncPolling();
    await window.api.connection.disconnect();
    set({
      connectionState: 'disconnected',
      config: null,
      nodeInfo: null,
      blockHeight: 0,
      walletHeight: 0,
      syncProgress: 0,
      chainSynced: false,
      error: null,
      ...clearedWalletSession(),
    });
  },

  autoConnect: async () => {
    const config = await window.api.connection.detectBobConfig();
    if (config && config.apiKey) {
      return await get().connect(config);
    }
    return false;
  },

  testConnection: async (config) => {
    return await window.api.connection.testConnection(config);
  },

  setBlockHeight: (height) => {
    set({ blockHeight: height });
  },

  setSyncProgress: (progress) => {
    set({ syncProgress: progress });
  },

  refreshNodeInfo: async () => {
    try {
      const nodeInfo = await window.api.node.getInfo();
      let walletHeight: number | undefined;
      // Only query wallet sync progress for an authenticated session.
      if (get().isLoggedIn) {
        try {
          const wInfo = await window.api.wallet.getInfo();
          walletHeight = wInfo?.height;
        } catch {
          // Wallet may not be ready yet — keep last known walletHeight
          // instead of assuming it's at chain height
          walletHeight = undefined;
        }
      }
      consecutiveNodeErrors = 0;
      set({
        nodeInfo,
        blockHeight: nodeInfo.chain.height,
        walletHeight: walletHeight ?? get().walletHeight,
        syncProgress: nodeInfo.chain.progress,
      });
    } catch {
      consecutiveNodeErrors++;
    }
  },

  refreshWallet: async () => {
    // Never fetch wallet data for a logged-out session.
    if (!get().isLoggedIn) return;
    try {
      const walletInfo = await window.api.wallet.getInfo();
      const balance = await window.api.wallet.getBalance();
      set({
        walletInfo,
        balance,
        walletEncryption: walletInfo
          ? {
              id: walletInfo.id,
              encrypted: walletInfo.master?.encrypted ?? false,
              until: walletInfo.master?.until ?? 0,
            }
          : null,
        walletHeight: walletInfo?.height ?? get().walletHeight,
      });
    } catch {
      // Ignore refresh errors
    }
  },

  checkWalletState: async () => {
    try {
      const wallets = await window.api.wallet.listWalletsDetailed();
      if (!wallets || wallets.length === 0) {
        set({
          wallets: [],
          walletState: 'no-wallet',
          walletInfo: null,
          walletEncryption: null,
          balance: null,
          isLoggedIn: false,
        });
        return;
      }
      set({ wallets });

      // Check whether the currently selected wallet is encrypted/locked.
      // Only non-sensitive metadata is stored before login; wallet balances
      // and info are fetched after authentication.
      try {
        const info = await window.api.wallet.getInfo();
        const isEncrypted = info?.master?.encrypted ?? false;
        const until = info?.master?.until ?? 0;
        const isUnlocked = until > Math.floor(Date.now() / 1000);
        const loggedIn = get().isLoggedIn;
        set({
          walletEncryption: info
            ? { id: info.id, encrypted: isEncrypted, until }
            : null,
          walletInfo: loggedIn ? info : null,
          walletState: !isEncrypted || isUnlocked ? 'unlocked' : 'locked',
          walletHeight: info?.height ?? get().walletHeight,
          balance: loggedIn ? info.balance : null,
        });
      } catch {
        // Wallet info failed — wallet might not be selected yet
        set({ walletState: 'locked', walletEncryption: null });
      }
    } catch {
      set({
        wallets: [],
        walletState: 'no-wallet',
        walletInfo: null,
        walletEncryption: null,
        balance: null,
        isLoggedIn: false,
      });
    }
  },

  unlockWallet: async (passphrase: string, timeout = 300) => {
    set({ isUnlocking: true });
    try {
      // The main process owns the session gate. It handles unencrypted and
      // already-unlocked wallets without requiring a passphrase, and verifies
      // the passphrase for a locked encrypted wallet.
      await window.api.wallet.unlock(passphrase, timeout);

      const walletInfo = await window.api.wallet.getInfo();
      const balance = await window.api.wallet.getBalance();
      set({
        walletInfo,
        balance,
        walletEncryption: {
          id: walletInfo.id,
          encrypted: walletInfo.master?.encrypted ?? false,
          until: walletInfo.master?.until ?? 0,
        },
        walletHeight: walletInfo?.height ?? get().walletHeight,
        walletState: 'unlocked',
        isLoggedIn: true,
        isUnlocking: false,
        showOnboarding: false,
        error: null,
      });
      return true;
    } catch {
      set({ isUnlocking: false });
      return false;
    }
  },

  lockWallet: async () => {
    try {
      await window.api.wallet.lock();
    } catch { /* ignore */ }
    set({
      walletInfo: null,
      walletEncryption: null,
      balance: null,
      walletHeight: 0,
      walletState: 'locked',
      isLoggedIn: false,
      isUnlocking: false,
      showOnboarding: true,
    });
  },

  dismissOnboarding: () => {
    set({ showOnboarding: false });
  },

  openOnboarding: () => {
    set({ showOnboarding: true });
  },

  setError: (error) => {
    set({ error, connectionState: error ? 'error' : 'disconnected' });
  },

  startManagedNode: async (config) => {
    stopSyncPolling();
    set({
      connectionState: 'connecting',
      error: null,
      processStatus: 'starting',
      managedNodeConfig: config,
      config: null,
      nodeInfo: null,
      blockHeight: 0,
      walletHeight: 0,
      syncProgress: 0,
      chainSynced: false,
      ...clearedWalletSession(),
    });
    try {
      const result = await window.api.hsd.startManagedNode(config);
      const success = typeof result === 'boolean' ? result : result.success;
      const errorMsg = typeof result === 'object' && result.error ? result.error : null;
      if (!success) {
        set({
          connectionState: 'error',
          processStatus: 'error',
          error: errorMsg || 'Failed to start hsd node',
        });
        return false;
      }

      // Node is running — fetch node info (critical)
      let nodeInfo = null;
      try {
        nodeInfo = await window.api.node.getInfo();
      } catch {
        // Node info fetch failed — but node is running
      }

      set({
        connectionState: 'connected',
        config: {
          host: '127.0.0.1',
          nodePort: config.network === 'testnet' ? 13037 : config.network === 'regtest' ? 14037 : 12037,
          walletPort: config.network === 'testnet' ? 13039 : config.network === 'regtest' ? 14039 : 12039,
          apiKey: config.apiKey || '',
          network: config.network,
          walletId: config.walletId || 'primary',
          ssl: false,
        },
        nodeInfo,
        blockHeight: nodeInfo?.chain?.height ?? 0,
        walletHeight: 0,
        syncProgress: nodeInfo?.chain?.progress ?? 0,
        chainSynced: false,
        network: nodeInfo?.network ?? config.network,
        processStatus: 'running',
        error: null,
        ...clearedWalletSession(),
      });
      startSyncPolling();
      // Discover wallets only. The user must still log in.
      await get().checkWalletState();
      set({ showOnboarding: true });
      return true;
    } catch (err) {
      set({
        connectionState: 'error',
        processStatus: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return false;
    }
  },

  stopManagedNode: async () => {
    await window.api.hsd.stopManagedNode();
    get().handleNodeStopped();
  },

  stopNode: async () => {
    const { processStatus, connectionState, config } = get();

    // A node spawned by this app is terminated through the process service,
    // which waits for the child to exit.
    if (processStatus === 'running') {
      await get().stopManagedNode();
      return;
    }

    if (connectionState !== 'connected') {
      get().handleNodeStopped();
      return;
    }

    const host = (config?.host || '').trim().toLowerCase();
    const isLocalNode =
      host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';

    if (isLocalNode) {
      // Graceful shutdown through the authenticated hsd RPC. This only
      // affects the node we are connected to; no PID is ever killed.
      await window.api.node.shutdown();
    } else {
      // Never send a shutdown command to a remote node — only disconnect.
      await window.api.connection.disconnect();
    }

    get().handleNodeStopped();
  },

  setProcessStatus: (status) => {
    set({ processStatus: status });
  },

  handleNodeStopped: () => {
    stopSyncPolling();
    set({
      connectionState: 'disconnected',
      config: null,
      nodeInfo: null,
      blockHeight: 0,
      walletHeight: 0,
      syncProgress: 0,
      chainSynced: false,
      error: null,
      processStatus: 'stopped',
      ...clearedWalletSession(),
    });
  },

  handleNodeError: (message) => {
    stopSyncPolling();
    set({
      connectionState: 'error',
      config: null,
      nodeInfo: null,
      blockHeight: 0,
      walletHeight: 0,
      syncProgress: 0,
      chainSynced: false,
      error: message,
      processStatus: 'error',
      ...clearedWalletSession(),
    });
  },

  handleNodeUnreachable: () => {
    stopSyncPolling();
    set({
      connectionState: 'error',
      nodeInfo: null,
      blockHeight: 0,
      syncProgress: 0,
      chainSynced: false,
      error: 'Node unreachable — start it from Settings and log in again.',
      ...clearedWalletSession(),
    });
  },
}));
