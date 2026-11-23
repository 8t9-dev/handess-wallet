/**
 * HSD Connection Service
 *
 * Manages the connection to a running hsd node (typically Bob Wallet's embedded node).
 * Provides NodeClient and WalletClient instances to other services.
 */

import { EventEmitter } from 'events';
import { createConnection } from 'net';
import { NodeClient, WalletClient } from 'hs-client';
import type { HSDConnectionConfig, ConnectionState, NodeInfo as HSDNodeInfo } from '../../src/types/wallet';

const RPC_TIMEOUT = 15000; // 15 seconds — prevents indefinite hangs on slow wallet RPCs

export function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = createConnection({ host, port });
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

/** Wait until hsd has actually released its HTTP port. */
async function waitForPortClosed(host: string, port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(host, port, 500))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export class HSDConnectionService extends EventEmitter {
  private nodeClient: NodeClient | null = null;
  private walletClient: WalletClient | null = null;
  private config: HSDConnectionConfig | null = null;
  private network: 'main' | 'testnet' | 'regtest' = 'main';
  private state: ConnectionState = 'disconnected';
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private _lastError: string | null = null;
  /** Wallet the user explicitly picked at runtime (e.g. onboarding log-in). */
  private selectedWalletId: string | null = null;

  /** Human-readable reason for the most recent failed connection attempt. */
  get lastError(): string | null {
    return this._lastError;
  }

  async connect(config: HSDConnectionConfig): Promise<boolean> {
    this.state = 'connecting';
    this._lastError = null;
    this.selectedWalletId = null;
    this.emit('stateChange', this.state);

    try {
      this.nodeClient = new NodeClient({
        host: config.host,
        port: config.nodePort,
        apiKey: config.nodeApiKey || config.apiKey,
        ssl: config.ssl,
        timeout: RPC_TIMEOUT,
      });

      this.walletClient = new WalletClient({
        host: config.host,
        port: config.walletPort,
        apiKey: config.walletApiKey || config.apiKey,
        ssl: config.ssl,
        walletID: config.walletId,
        timeout: RPC_TIMEOUT,
      });

      // Test Node connection
      try {
        await this.nodeClient.getInfo();
      } catch (err) {
        let msg = err instanceof Error ? err.message : 'Unknown error';
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          msg = 'Invalid Node API Key';
        }
        throw new Error(`Node connection failed: ${msg}`);
      }

      // Verify Wallet connectivity/auth. hsd's JSON-RPC wallet pointer is
      // global, so `getwalletinfo` reports whichever wallet is selected.
      try {
        const current = await this.walletClient.execute('getwalletinfo') as Record<string, unknown>;
        const requested = (config.walletId || '').trim();
        let requestedExists = true;

        // Only change the global wallet when the caller explicitly named one.
        // Auto-detected configs leave walletId empty so we follow Bob's
        // selection instead of forcing `primary` (which is often empty).
        if (requested) {
          const available = await this.getWalletIds();
          if (available.length === 0 || available.includes(requested)) {
            await this.walletClient.execute('selectwallet', [requested]);
          } else {
            requestedExists = false;
            console.warn(
              `[HSDConnection] Wallet "${requested}" not found; keeping "${String(current.walletid || 'current')}"`,
            );
          }
        }

        // If the requested wallet did not exist, don't scope reads to it.
        this.config = requestedExists ? config : { ...config, walletId: '' };
        this.network = config.network ?? 'main';
      } catch (err) {
        let msg = err instanceof Error ? err.message : 'Unknown error';
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          msg = 'Invalid Wallet API Key';
        } else if (msg.includes('ECONNREFUSED')) {
          msg = `Connection refused on port ${config.walletPort}. Is Bob Wallet running?`;
        }
        throw new Error(`Wallet connection failed: ${msg}`);
      }

      this.state = 'connected';
      this.reconnectAttempts = 0;
      this.emit('stateChange', this.state);
      this.startHealthCheck();
      return true;
    } catch (error) {
      this._lastError = error instanceof Error ? error.message : String(error);
      this.state = 'error';
      this.emit('stateChange', this.state);
      this.emit('error', this._lastError);
      console.error('[HSDConnection] Connection failed:', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.stopHealthCheck();
    this.nodeClient = null;
    this.walletClient = null;
    this.config = null;
    this.selectedWalletId = null;
    this.state = 'disconnected';
    this.emit('stateChange', this.state);
  }

  /**
   * Ask a connected local node to shut down gracefully through its own
   * `stop` RPC. This never kills a process by PID, so the app can only
   * affect the node it is already authenticated to. Remote nodes are not
   * shut down; the caller should just disconnect those.
   */
  async shutdownNode(): Promise<void> {
    const client = this.nodeClient;
    const config = this.config;
    if (!client || !config) {
      throw new Error('Not connected to an external node');
    }

    const { host, nodePort } = config;
    try {
      await client.execute('stop', []);
    } catch {
      // hsd closes the HTTP socket before it can reply to `stop`, so an
      // ECONNRESET here is expected rather than a failure.
    }

    await this.disconnect();
    if (!(await waitForPortClosed(host, nodePort))) {
      throw new Error(
        `The node did not release ${host}:${nodePort} within 15 seconds. It may still be shutting down.`,
      );
    }
  }

  getStatus(): { state: ConnectionState; nodeInfo: HSDNodeInfo | null } {
    return { state: this.state, nodeInfo: null };
  }

  getClients(): { nodeClient: NodeClient; walletClient: WalletClient } {
    if (!this.nodeClient || !this.walletClient) {
      throw new Error('Not connected to hsd');
    }
    return { nodeClient: this.nodeClient, walletClient: this.walletClient };
  }

  /**
   * The wallet explicitly requested by the connection config, or `''` when
   * the app should follow whatever wallet hsd currently has selected.
   *
   * Managed-node connections never call `connect()`, so they also return
   * `''` here; the wallet services then resolve the active wallet with
   * `getwalletinfo`.
   */
  getConfiguredWalletId(): string {
    return this.selectedWalletId || (this.config?.walletId || '').trim();
  }

  /** Active network, used for protocol constants (auction windows, expiry). */
  getNetwork(): 'main' | 'testnet' | 'regtest' {
    return this.network;
  }

  /** Managed-node connections bypass connect(), so the main process sets this. */
  setNetwork(network: 'main' | 'testnet' | 'regtest'): void {
    this.network = network;
  }

  /**
   * Pin the wallet for subsequent scoped reads after the user explicitly
   * selects one at runtime.
   */
  setSelectedWallet(walletId: string): void {
    this.selectedWalletId = walletId.trim() || null;
  }

  /**
   * Enumerate wallets through hsd's HTTP API (`GET /wallet`).
   *
   * hsd has no `listwallets` RPC (that method only exists in Bitcoin Core),
   * and multiple wallets live inside one LevelDB, so they cannot be
   * discovered by scanning the data directory.
   */
  private async getWalletIds(): Promise<string[]> {
    if (!this.walletClient) return [];
    try {
      const ids = await this.walletClient.getWallets();
      return Array.isArray(ids) ? ids.map(String) : [];
    } catch {
      return [];
    }
  }

  /**
   * Set clients from the managed HSD process.
   * This allows the connection service to use the same clients
   * as the spawned hsd child process.
   */
  setClients(nodeClient: NodeClient, walletClient: WalletClient): void {
    this.nodeClient = nodeClient;
    this.walletClient = walletClient;
    // Managed-node wallet selection is performed by the process service and
    // tracked by hsd itself. Drop any stale external config so wallet-scoped
    // reads resolve the active wallet with `getwalletinfo`.
    this.config = null;
    this.selectedWalletId = null;
    this.state = 'connected';
    this.emit('stateChange', this.state);
    this.startHealthCheck();
  }

  async testConnection(config: HSDConnectionConfig): Promise<{ success: boolean; error?: string }> {
    const errors: string[] = [];

    // Test 1: Node endpoint
    try {
      const testNode = new NodeClient({
        host: config.host,
        port: config.nodePort,
        apiKey: config.nodeApiKey || config.apiKey,
        ssl: config.ssl,
        timeout: RPC_TIMEOUT,
      });
      await testNode.getInfo();
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        msg = 'Invalid Node API Key';
      }
      errors.push(`Node connection failed: ${msg}`);
    }

    // Test 2: Wallet endpoint
    try {
      const testWallet = new WalletClient({
        host: config.host,
        port: config.walletPort,
        apiKey: config.walletApiKey || config.apiKey,
        ssl: config.ssl,
        walletID: config.walletId || 'primary',
        timeout: RPC_TIMEOUT,
      });
      // Verify connectivity and auth without mutating the node's global
      // wallet selection — testing a connection should be side-effect free.
      await testWallet.execute('getwalletinfo');

      // If the user explicitly named a wallet, make sure it exists.
      const requested = (config.walletId || '').trim();
      if (requested) {
        const available = await testWallet.getWallets();
        if (Array.isArray(available) && !available.includes(requested)) {
          throw new Error(`Wallet "${requested}" not found`);
        }
      }
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        msg = 'Invalid Wallet API Key';
      } else if (msg.includes('ECONNREFUSED')) {
        msg = `Connection refused on port ${config.walletPort}. Is Bob Wallet running?`;
      }
      errors.push(`Wallet connection failed: ${msg}`);
    }

    if (errors.length === 0) {
      return { success: true };
    }

    return {
      success: false,
      error: errors.join(' | '),
    };
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        if (this.nodeClient) {
          await this.nodeClient.getInfo();
        }
        // Also check wallet responsiveness — a stalled wallet RPC
        // means the wallet block processor may be stuck
        if (this.walletClient) {
          await this.walletClient.execute('getwalletinfo');
        }
      } catch {
        this.stopHealthCheck();
        this.state = 'error';
        this.emit('stateChange', this.state);
        this.attemptReconnect();
      }
    }, 30000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.config) return;
    this.reconnectAttempts++;
    setTimeout(async () => {
      if (this.config) {
        await this.connect(this.config);
      }
    }, 5000 * this.reconnectAttempts);
  }
}
