/**
 * Wallet and transaction type definitions.
 *
 * Represents the hsd wallet state as exposed by the wallet API.
 * The CRM never handles private keys -- all signing is done by hsd.
 *
 * Reference: HSD_API_REFERENCE.md "Wallet API"
 */

// ============================================================
// Wallet Types
// ============================================================

/**
 * Wallet info as returned by `getwalletinfo` RPC.
 */
export interface WalletInfo {
  /** Wallet identifier (e.g., "primary") */
  id: string;

  /** Wallet database ID */
  wid: number;

  /** Whether this is a watch-only wallet */
  watchOnly: boolean;

  /** Number of accounts in the wallet */
  accountDepth: number;

  /** Authentication token (for wallet-auth mode) */
  token: string;

  /** Master key fingerprint */
  master: {
    encrypted: boolean;
    until: number; // Unix timestamp when wallet re-locks (0 if locked)
  };

  /** Wallet balance */
  balance: WalletBalance;

  /** Wallet's last processed block height (behind chain.height during catch-up) */
  height?: number;
}

/**
 * Wallet balance as returned by `getbalance` RPC or REST endpoint.
 *
 * IMPORTANT: Values are in dollarydoos (1 HNS = 1,000,000 dollarydoos).
 * Use the `dollaryDoosToHNS()` utility to convert for display.
 */
export interface WalletBalance {
  /** Total confirmed balance (dollarydoos) */
  confirmed: number;

  /** Unconfirmed balance including mempool (dollarydoos) */
  unconfirmed: number;

  /** Confirmed balance locked in covenants (dollarydoos) */
  lockedConfirmed: number;

  /** Unconfirmed balance locked in covenants (dollarydoos) */
  lockedUnconfirmed: number;

  /** Computed: spendable confirmed (confirmed - lockedConfirmed) */
  spendable: number;
}

/**
 * Result of signing a message with one owned name.
 * Used by the multi-sign / CSV export flow.
 */
export interface NameSignatureResult {
  /** Canonical wallet name (punycode) used for signing. */
  name: string;

  /** Base64 signature, or null when signing this name failed. */
  signature: string | null;

  /** Reason signing this name failed, when applicable. */
  error?: string;
}

// ============================================================
// Transaction Types
// ============================================================

/**
 * Handshake covenant types used in transactions.
 * Each name operation is represented by a covenant in the transaction.
 */
export type CovenantType =
  | 'NONE'       // Regular HNS transfer
  | 'CLAIM'      // DNSSEC claim
  | 'OPEN'       // Open name for auction
  | 'BID'        // Place blinded bid
  | 'REVEAL'     // Reveal bid
  | 'REDEEM'     // Redeem losing bid funds
  | 'REGISTER'   // Register won name (first UPDATE)
  | 'UPDATE'     // Update DNS records
  | 'RENEW'      // Renew name
  | 'TRANSFER'   // Initiate name transfer
  | 'FINALIZE'   // Complete name transfer
  | 'REVOKE';    // Permanently revoke name

/**
 * Transaction as returned by hsd wallet API.
 */
export interface Transaction {
  /** Transaction hash */
  hash: string;

  /** Block height (null if unconfirmed) */
  height: number | null;

  /** Block hash (null if unconfirmed) */
  block: string | null;

  /** Timestamp */
  time: number;

  /** Transaction index in block */
  index: number;

  /** Transaction version */
  version: number;

  /** Transaction fee (dollarydoos) */
  fee: number;

  /** Net amount change for this wallet (dollarydoos, negative = sent) */
  amount: number;

  /** Transaction category (send, receive, bid, reveal, redeem, etc.) */
  category?: string;

  /** Name involved in the transaction (for name-related covenants) */
  name?: string;

  /** Human-readable event description (e.g. "Bid on name example", "Received HNS") */
  event?: string;

  /** Number of confirmations */
  confirmations: number;

  /**
   * Unique row id when one transaction expands into multiple name rows
   * (for example a batched FINALIZE). Falls back to `hash` when absent.
   */
  rowId?: string;

  /** Transaction inputs */
  inputs: TransactionInput[];

  /** Transaction outputs */
  outputs: TransactionOutput[];
}

export interface TransactionInput {
  /** Previous output hash */
  prevout: {
    hash: string;
    index: number;
  };
  /** Witness data */
  witness: string[];
  /** Sequence number */
  sequence: number;
  /** Address (if resolvable) */
  address: string | null;
  /** Covenant on the input */
  covenant: {
    type: number;
    action: CovenantType;
  };
}

export interface TransactionOutput {
  /** Output value (dollarydoos) */
  value: number;
  /** Destination address */
  address: string;
  /** Covenant on the output */
  covenant: {
    type: number;
    action: CovenantType;
    items: string[]; // covenant data (name hash, etc.)
  };
}

// ============================================================
// Connection Types
// ============================================================

/**
 * HSD node info as returned by `GET /` or `getinfo` RPC.
 */
export interface NodeInfo {
  /** Software version */
  version: string;

  /** Network name (main, testnet, regtest) */
  network: string;

  /** Current chain height */
  chain: {
    height: number;
    tip: string;
    progress: number; // 0.0 to 1.0 sync progress
  };

  /** Memory pool info */
  pool: {
    host: string;
    port: number;
    agent: string;
    services: string;
    outbound: number;
    inbound: number;
  };

  /** Memory usage */
  mempool: {
    tx: number;
    size: number;
  };
}

/**
 * Connection configuration for hsd.
 */
export interface HSDConnectionConfig {
  /** HSD node host */
  host: string;

  /** Node API port (default: 12037 mainnet) */
  nodePort: number;

  /** Wallet API port (default: 12039 mainnet) */
  walletPort: number;

  /** Common API key (used if specific keys are not provided) */
  apiKey: string;

  /** Specific API key for HSD node authentication */
  nodeApiKey?: string;

  /** Specific API key for Wallet authentication */
  walletApiKey?: string;

  /** Network: main, testnet, regtest */
  network: 'main' | 'testnet' | 'regtest';

  /**
   * Wallet ID to use.
   *
   * An empty string means "use the wallet hsd already has selected" — this
   * is what auto-detection returns so the app follows Bob's logged-in
   * wallet instead of forcing `primary`. Manual connections should set an
   * explicit name.
   */
  walletId: string;

  /** Whether to use SSL */
  ssl: boolean;
}

/** Default connection config */
export const DEFAULT_CONNECTION_CONFIG: HSDConnectionConfig = {
  host: '127.0.0.1',
  nodePort: 12037,
  walletPort: 12039,
  apiKey: '',
  network: 'main',
  walletId: 'primary',
  ssl: false,
};

/**
 * Connection state for the UI.
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

// ============================================================
// Managed Node Types
// ============================================================

/**
 * Status of the managed hsd process.
 */
export type HSDProcessState = 'stopped' | 'starting' | 'running' | 'error';

/**
 * Configuration for the managed hsd node process.
 */
export interface ManagedNodeConfig {
  /** hsd data directory (where blockchain + wallet data lives) */
  dataDir: string;
  /** Optional path to hsd binary */
  binaryPath?: string;
  /** Optional path to node.exe when using a private runtime */
  nodePath?: string;
  /** Network: main, testnet, regtest */
  network: 'main' | 'testnet' | 'regtest';
  /** API key (auto-generated if not provided) */
  apiKey?: string;
  /** Wallet ID to select after startup */
  walletId?: string;
}

/**
 * Status report from the managed hsd process.
 */
export interface HSDProcessStatus {
  state: HSDProcessState;
  pid: number | null;
  dataDir: string;
  network: string;
  error?: string;
}

// ============================================================
// Wallet Address Types
// ============================================================

/**
 * A wallet address as returned by hsd.
 */
export interface WalletAddress {
  address: string;
  type: string;
  account: number;
  publicKey?: string;
}

/**
 * A transaction sent via sendtoaddress.
 */
export interface SendResult {
  hash: string;
  fee?: number;
  confirmations?: number;
}

// ============================================================
// Advanced HSD Configuration
// ============================================================

/**
 * Advanced hsd node configuration settings.
 * These are written to hsd.conf in the data directory.
 * When any of these are set, the conf file is used; otherwise
 * hardcoded CLI defaults apply.
 */
export interface HsdAdvancedConfig {
  /** Number of worker child processes (CPU-bound tasks) */
  workers?: number;
  /** Size of worker pool (default: 2) */
  workersSize?: number;

  /** Index all transactions for wallet queries */
  indexTx?: boolean;
  /** Index all addresses for wallet queries */
  indexAddress?: boolean;
  /** Skip wallet rescan on chain migration (trusted source) */
  migrateNoRescan?: boolean;

  /** Skip DNS seeding on startup */
  noDns?: boolean;
  /** Accept incoming connections */
  listen?: boolean;
  /** Max inbound connections */
  maxInbound?: number;
  /** Max outbound connections */
  maxOutbound?: number;

  /** BIP37 Bloom filter support */
  bip37?: boolean;
  /** Use checkpoints for faster initial sync */
  checkpoints?: boolean;
  /** Selfish mode (no address relay) */
  selfish?: boolean;

  /** Prune historical blocks (saves disk space) */
  prune?: boolean;
  /** Compact storage (smaller DB, slower writes) */
  compact?: boolean;
  /** Store chain/tree/mempool in memory (fast but uses RAM) */
  memory?: boolean;

  /** Log level: debug, info, warning, error */
  logLevel?: string;
  /** Log to a file in the data directory */
  logFile?: boolean;
  /** Log to stdout/console */
  logConsole?: boolean;

  /** RPC server host */
  rsHost?: string;
  /** RPC server port */
  rsPort?: number;
  /** Wallet server host */
  walletHost?: string;
  /** Wallet server port */
  walletPort?: number;
  /** Enable SSL for RPC */
  ssl?: boolean;
}
