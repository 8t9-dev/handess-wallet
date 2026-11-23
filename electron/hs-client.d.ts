declare module 'hs-client' {
  interface ClientOptions {
    host?: string;
    port?: number;
    apiKey?: string;
    ssl?: boolean;
    timeout?: number;
  }

  interface NameInfo {
    start: { reserved: boolean; week: number; start: number };
    info: {
      name: string;
      nameHash: string;
      state: string;
      height: number;
      renewal: number;
      owner: { hash: string; index: number };
      value: number;
      highest: number;
      data: unknown;
      transfer: number;
      revoked: boolean;
      claimed: number;
      renewals: number;
      registered: boolean;
      expired: boolean;
      weak: boolean;
    } | null;
  }

  interface Resource {
    records: Array<{
      type: string;
      ns?: string;
      address?: string;
      keyTag?: number;
      algorithm?: number;
      digestType?: number;
      digest?: string;
      txt?: string[];
    }>;
  }

  interface WalletInfo {
    id: string;
    wid: number;
    watchOnly: boolean;
    accountDepth: number;
    token: string;
    master: { encrypted: boolean; until: number };
    balance: {
      confirmed: number;
      unconfirmed: number;
      lockedConfirmed: number;
      lockedUnconfirmed: number;
    };
  }

  interface Transaction {
    hash: string;
    height: number | null;
    block: string | null;
    time: number;
    index: number;
    version: number;
    fee: number;
    amount: number;
    confirmations: number;
    inputs: unknown[];
    outputs: unknown[];
  }

  export class NodeClient {
    constructor(options?: ClientOptions);
    getInfo(): Promise<{
      version: string;
      network: string;
      chain: { height: number; tip: string; progress: number };
      pool: { host: string; port: number; agent: string; services: string; outbound: number; inbound: number };
      mempool: { tx: number; size: number };
    }>;
    execute(method: string, params?: unknown[]): Promise<unknown>;
    getTX(hash: string): Promise<Transaction | null>;
    getCoin(hash: string, index: number): Promise<unknown>;
    broadcast(tx: string): Promise<void>;
  }

  interface WalletClientOptions extends ClientOptions {
    walletID?: string;
  }

  export class WalletClient {
    constructor(options?: WalletClientOptions);
    getInfo(): Promise<WalletInfo>;
    /** HTTP: GET /wallet — list every wallet id on the node. */
    getWallets(): Promise<string[]>;
    getBalance(account?: string): Promise<{
      account: string;
      tx: number;
      coin: number;
      confirmed: number;
      unconfirmed: number;
      lockedConfirmed: number;
      lockedUnconfirmed: number;
    }>;
    execute(method: string, params?: unknown[]): Promise<unknown>;
    get(name: string, params?: Record<string, unknown>): Promise<unknown>;
    /** HTTP: POST to a wallet REST endpoint (for example /deepclean or /rescan). */
    post(path: string, body?: Record<string, unknown>): Promise<unknown>;
    /** HTTP: GET /wallet/:id/account */
    getAccounts(id: string): Promise<unknown[]>;
    getName(name: string): Promise<unknown>;
    getNames(): Promise<unknown[]>;
    getBids(name?: string): Promise<unknown[]>;
    getBidsByName(name: string): Promise<unknown[]>;
    getReveals(name?: string): Promise<unknown[]>;
    getRevealsByName(name: string): Promise<unknown[]>;
    getAuctions(): Promise<unknown[]>;
    getAuctionInfo(name: string): Promise<unknown>;
    getTX(hash: string): Promise<Transaction | null>;
    getHistory(): Promise<unknown[]>;
    createOpen(name: string): Promise<unknown>;
    createBid(name: string, bid: number, lockup: number): Promise<unknown>;
    createReveal(name?: string): Promise<unknown>;
    createRedeem(name?: string): Promise<unknown>;
    createUpdate(name: string, resource: unknown): Promise<unknown>;
    createRenewal(name: string): Promise<unknown>;
    createTransfer(name: string, address: string): Promise<unknown>;
    createFinalize(name: string): Promise<unknown>;
    createCancel(name: string): Promise<unknown>;
    createRevoke(name: string): Promise<unknown>;
    createBatch(actions: unknown[][]): Promise<unknown>;
    /** Rescan the blockchain for wallet transactions (REST: POST /rescan) */
    rescan(start: number): Promise<void>;
  }
}
