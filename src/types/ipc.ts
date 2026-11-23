/**
 * IPC (Inter-Process Communication) type definitions.
 *
 * Defines the contract between the Electron main process and the React renderer.
 * All communication goes through `contextBridge` in preload.ts, which exposes
 * a typed `window.api` object.
 *
 * The renderer NEVER has direct access to Node.js APIs, hsd, or the filesystem.
 * Everything goes through these typed IPC channels.
 */

import type { Domain, DNSResource, Tag, TagUpdate, TagUpdateResult } from './domain';
import type { Auction, Bid, BidReceipt, GlobalAuctionsScanResult, OpenedName } from './auction';
import type { WalletInfo, WalletBalance, NodeInfo, HSDConnectionConfig, Transaction, ManagedNodeConfig, HSDProcessStatus, WalletAddress, SendResult, HsdAdvancedConfig, NameSignatureResult } from './wallet';
import type { BatchJob, BatchRequest, BatchProgress } from './batch';
import type {
  SetupCompleteInput,
  SetupEnvironmentStatus,
  SetupRuntimeInstallResult,
  SetupRuntimeProgress,
} from './setup';
import type { MarketplaceListing, CreateListingInput, PurchaseIntent, TransferStatus, RelayHealth } from './marketplace';
import type { NameLookupResult, BulkSearchResult, SearchHistoryEntry } from './search';
import type { BlockSummary, ChainStats, BlockDetail, AddressInfo, NameDetail } from './explore';
import type { SwapOffer, LocalSwap, DgbServerConfig, DgbBalance, DgbNetworkType } from './swap';
import type {
  HnsIndexRecord,
  HnsIndexRefreshResult,
  HnsIndexSearchQuery,
  HnsIndexSearchResponse,
  HnsIndexStatus,
} from './search-engine';

// ============================================================
// IPC Channel Names
// ============================================================

/**
 * Payload emitted by the main process to the renderer on every notification.
 * Mirrors `NotificationPayload` in `electron/services/notification-service.ts`.
 */
export interface NotificationPayload {
  kind: 'reveal' | 'redeem' | 'register' | 'finalize' | 'expire-critical' | 'expire-warning' | 'general';
  title: string;
  body: string;
  count: number;
  names?: string[];
}

/**
 * IPC channel names.
 * Convention: 'service:method'
 *
 * These are used in:
 *   - electron/main.ts: ipcMain.handle(channel, handler)
 *   - electron/preload.ts: ipcRenderer.invoke(channel, ...args)
 */
export const IPC_CHANNELS = {
  // Application lifecycle and legal documents
  'app:getVersion': 'app:getVersion',
  'app:quit': 'app:quit',
  'app:openThirdPartyNotices': 'app:openThirdPartyNotices',

  // Connection
  'connection:connect': 'connection:connect',
  'connection:disconnect': 'connection:disconnect',
  'connection:getStatus': 'connection:getStatus',
  'connection:detectBobConfig': 'connection:detectBobConfig',
  'connection:testConnection': 'connection:testConnection',
  'connection:detectWalletNames': 'connection:detectWalletNames',
  'connection:getSavedConfig': 'connection:getSavedConfig',
  'connection:saveConfig': 'connection:saveConfig',

  // Node
  'node:getInfo': 'node:getInfo',
  'node:shutdown': 'node:shutdown',
  'node:getNameInfo': 'node:getNameInfo',
  'node:getNameResource': 'node:getNameResource',
  'node:bulkLookup': 'node:bulkLookup',
  'node:estimateFee': 'node:estimateFee',
  'node:getBlockHeight': 'node:getBlockHeight',
  'node:getRecentBlocks': 'node:getRecentBlocks',
  'node:getMempoolInfo': 'node:getMempoolInfo',
  'node:getCoinSupply': 'node:getCoinSupply',
  'node:getBlockDetails': 'node:getBlockDetails',
  'node:getBlockTimes': 'node:getBlockTimes',
  'node:getTreeUpdateInfo': 'node:getTreeUpdateInfo',
  'node:getAddressInfo': 'node:getAddressInfo',
  'node:getNameDetail': 'node:getNameDetail',
  'node:scanGlobalAuctions': 'node:scanGlobalAuctions',
  'node:getTransaction': 'node:getTransaction',
  'node:verifyMessageWithName': 'node:verifyMessageWithName',

  // TLD search engine
  'searchEngine:getStatus': 'searchEngine:getStatus',
  'searchEngine:search': 'searchEngine:search',
  'searchEngine:refreshRecent': 'searchEngine:refreshRecent',
  'searchEngine:refreshName': 'searchEngine:refreshName',

  // Wallet
  'wallet:getInfo': 'wallet:getInfo',
  'wallet:getBalance': 'wallet:getBalance',
  'wallet:getNames': 'wallet:getNames',
  'wallet:getNameInfo': 'wallet:getNameInfo',
  'wallet:getBids': 'wallet:getBids',
  'wallet:getReveals': 'wallet:getReveals',
  'wallet:getAuctions': 'wallet:getAuctions',
  'wallet:getOpenedNames': 'wallet:getOpenedNames',
  'wallet:getAuctionInfo': 'wallet:getAuctionInfo',
  'wallet:sendOpen': 'wallet:sendOpen',
  'wallet:sendBid': 'wallet:sendBid',
  'wallet:sendReveal': 'wallet:sendReveal',
  'wallet:sendRedeem': 'wallet:sendRedeem',
  'wallet:sendUpdate': 'wallet:sendUpdate',
  'wallet:applyTags': 'wallet:applyTags',
  'wallet:sendRenewal': 'wallet:sendRenewal',
  'wallet:sendTransfer': 'wallet:sendTransfer',
  'wallet:sendFinalize': 'wallet:sendFinalize',
  'wallet:sendCancel': 'wallet:sendCancel',
  'wallet:sendRevoke': 'wallet:sendRevoke',
  'wallet:importName': 'wallet:importName',
  'wallet:unlock': 'wallet:unlock',
  'wallet:lock': 'wallet:lock',
  'wallet:getTxHistory': 'wallet:getTxHistory',
  'wallet:signMessageWithName': 'wallet:signMessageWithName',
  'wallet:signMessageBatch': 'wallet:signMessageBatch',
  'wallet:deepClean': 'wallet:deepClean',
  'wallet:rescan': 'wallet:rescan',

  // Price
  'price:getHnsUsd': 'price:getHnsUsd',
  'price:getDgbUsd': 'price:getDgbUsd',

  // Batch
  'batch:execute': 'batch:execute',
  'batch:cancel': 'batch:cancel',
  'batch:getQueue': 'batch:getQueue',
  'batch:getHistory': 'batch:getHistory',
  'batch:retryChunk': 'batch:retryChunk',

  // Marketplace
  'marketplace:createListing': 'marketplace:createListing',
  'marketplace:cancelListing': 'marketplace:cancelListing',
  'marketplace:getMyListings': 'marketplace:getMyListings',
  'marketplace:getOffers': 'marketplace:getOffers',
  'marketplace:requestPurchase': 'marketplace:requestPurchase',
  'marketplace:getEscrowFundingStatus': 'marketplace:getEscrowFundingStatus',
  'marketplace:fundEscrow': 'marketplace:fundEscrow',
  'marketplace:createEscrowRelease': 'marketplace:createEscrowRelease',
  'marketplace:signEscrowRelease': 'marketplace:signEscrowRelease',
  'marketplace:createEscrowDisputePsbt': 'marketplace:createEscrowDisputePsbt',
  'marketplace:importEscrowArbiterPsbt': 'marketplace:importEscrowArbiterPsbt',
  'marketplace:checkTransferStatus': 'marketplace:checkTransferStatus',
  'marketplace:confirmAndPay': 'marketplace:confirmAndPay',
  'marketplace:finalizePurchase': 'marketplace:finalizePurchase',
  'marketplace:getPurchaseRequests': 'marketplace:getPurchaseRequests',
  'marketplace:getMyPurchases': 'marketplace:getMyPurchases',
  'marketplace:verifyListing': 'marketplace:verifyListing',
  'marketplace:republishListing': 'marketplace:republishListing',
  'marketplace:testRelays': 'marketplace:testRelays',
  'marketplace:approvePurchase': 'marketplace:approvePurchase',
  'marketplace:rejectPurchase': 'marketplace:rejectPurchase',
  'marketplace:dismissPurchaseRequest': 'marketplace:dismissPurchaseRequest',
  'marketplace:forceCancelListing': 'marketplace:forceCancelListing',
  'marketplace:getNostrPubkey': 'marketplace:getNostrPubkey',
  'marketplace:getRelays': 'marketplace:getRelays',
  'marketplace:setRelays': 'marketplace:setRelays',

  // Database (tags, watchlist, search history)
  'db:getTags': 'db:getTags',
  'db:createTag': 'db:createTag',
  'db:updateTag': 'db:updateTag',
  'db:deleteTag': 'db:deleteTag',
  'db:assignTag': 'db:assignTag',
  'db:removeTag': 'db:removeTag',
  'db:getTagsForDomain': 'db:getTagsForDomain',
  'db:getDomainsForTag': 'db:getDomainsForTag',
  'db:addToWatchlist': 'db:addToWatchlist',
  'db:removeFromWatchlist': 'db:removeFromWatchlist',
  'db:getWatchlist': 'db:getWatchlist',
  'db:getSearchHistory': 'db:getSearchHistory',
  'db:saveSearchHistory': 'db:saveSearchHistory',
  'db:saveBidReceipt': 'db:saveBidReceipt',
  'db:getBidReceipt': 'db:getBidReceipt',
  'db:removeBidReceipt': 'db:removeBidReceipt',
  'db:getAllBidReceipts': 'db:getAllBidReceipts',
  'db:getRevealedNames': 'db:getRevealedNames',
  'db:addRevealedName': 'db:addRevealedName',
  'db:removeRevealedName': 'db:removeRevealedName',
  'db:setRevealedNames': 'db:setRevealedNames',
  'db:getListingVerification': 'db:getListingVerification',
  'db:setListingVerification': 'db:setListingVerification',

  // Config / Settings
  'config:get': 'config:get',
  'config:set': 'config:set',
  'config:getAll': 'config:getAll',
  'config:getDataDir': 'config:getDataDir',
  'config:getDefaultHsdDataDir': 'config:getDefaultHsdDataDir',

  // Notifications
  'notifications:getExpiring': 'notifications:getExpiring',
  'notifications:getPendingActions': 'notifications:getPendingActions',

  // HSD Process Management
  'hsd:start': 'hsd:start',
  'hsd:stop': 'hsd:stop',
  'hsd:status': 'hsd:status',
  'hsd:setDataDir': 'hsd:setDataDir',
  'hsd:setBinaryPath': 'hsd:setBinaryPath',
  'hsd:detectHsd': 'hsd:detectHsd',
  'hsd:getAdvancedConfig': 'hsd:getAdvancedConfig',
  'hsd:saveAdvancedConfig': 'hsd:saveAdvancedConfig',

  // New Wallet Operations
  'wallet:createWallet': 'wallet:createWallet',
  'wallet:getAddress': 'wallet:getAddress',
  'wallet:createAddress': 'wallet:createAddress',
  'wallet:listAddresses': 'wallet:listAddresses',
  'wallet:sendToAddress': 'wallet:sendToAddress',
  'wallet:listWalletsDetailed': 'wallet:listWalletsDetailed',
  'wallet:getPublicKey': 'wallet:getPublicKey',
  'wallet:importWallet': 'wallet:importWallet',
  'wallet:selectWallet': 'wallet:selectWallet',
  'wallet:getMasterKey': 'wallet:getMasterKey',
  'wallet:encryptWallet': 'wallet:encryptWallet',
  'wallet:getFeeEstimates': 'wallet:getFeeEstimates',

  // DGB / Electrum
  'dgb:connect': 'dgb:connect',
  'dgb:disconnect': 'dgb:disconnect',
  'dgb:getBalance': 'dgb:getBalance',
  'dgb:getAddress': 'dgb:getAddress',
  'dgb:getUnspent': 'dgb:getUnspent',
  'dgb:broadcast': 'dgb:broadcast',
  'dgb:estimateFee': 'dgb:estimateFee',
  'dgb:getConfig': 'dgb:getConfig',
  'dgb:saveConfig': 'dgb:saveConfig',
  'dgb:getStatus': 'dgb:getStatus',

  // Swap
  'swap:publishOffer': 'swap:publishOffer',
  'swap:cancelOffer': 'swap:cancelOffer',
  'swap:fetchActiveOffers': 'swap:fetchActiveOffers',
  'swap:subscribeOffers': 'swap:subscribeOffers',
  'swap:acceptOffer': 'swap:acceptOffer',
  'swap:getMySwaps': 'swap:getMySwaps',
  'swap:getMySwapOffers': 'swap:getMySwapOffers',
  'swap:getSwapById': 'swap:getSwapById',
  'swap:startHtlcPhase': 'swap:startHtlcPhase',
  'swap:markHnsHtlcFunded': 'swap:markHnsHtlcFunded',
  'swap:markDgbHtlcFunded': 'swap:markDgbHtlcFunded',
  'swap:markHnsClaimed': 'swap:markHnsClaimed',
  'swap:markDgbClaimed': 'swap:markDgbClaimed',
  'swap:markCompleted': 'swap:markCompleted',
  'swap:markRefunded': 'swap:markRefunded',
  'swap:getNostrPubkey': 'swap:getNostrPubkey',
  'swap:setAutoComplete': 'swap:setAutoComplete',
} as const;

export type IPCChannel = keyof typeof IPC_CHANNELS;

// ============================================================
// API Shape (exposed via window.api in preload.ts)
// ============================================================

/**
 * The complete API shape exposed to the renderer process.
 * This is the TypeScript definition for `window.api`.
 *
 * Implementation: electron/preload.ts (contextBridge.exposeInMainWorld)
 * Usage: src/hooks/useHSD.ts, src/stores/*.ts
 */
export interface ElectronAPI {
  /** Application lifecycle and legal documents */
  app: {
    getVersion(): Promise<string>;
    quit(): Promise<void>;
    openThirdPartyNotices(): Promise<void>;
  };

  /** System clipboard helpers */
  clipboard: {
    writeText(text: string): Promise<void>;
  };

  /** Connection management */
  connection: {
    connect(config: HSDConnectionConfig): Promise<boolean>;
    getLastError(): Promise<string | null>;
    disconnect(): Promise<void>;
    getStatus(): Promise<{ state: string; nodeInfo: NodeInfo | null }>;
    detectBobConfig(): Promise<HSDConnectionConfig | null>;
    testConnection(config: HSDConnectionConfig): Promise<{ success: boolean; error?: string }>;
    detectWalletNames(): Promise<string[]>;
    getSavedConfig(): Promise<HSDConnectionConfig | null>;
    saveConfig(config: HSDConnectionConfig): Promise<void>;
  };

  /** Node (blockchain) queries */
  node: {
    getInfo(): Promise<NodeInfo>;
    /** Ask a connected local hsd node to shut down gracefully */
    shutdown(): Promise<void>;
    getNameInfo(name: string): Promise<NameLookupResult>;
    getNameResource(name: string): Promise<DNSResource | null>;
    bulkLookup(names: string[]): Promise<BulkSearchResult>;
    estimateFee(blocks?: number): Promise<number>;
    getBlockHeight(): Promise<number>;
    getRecentBlocks(count?: number): Promise<BlockSummary[]>;
    getMempoolInfo(): Promise<Record<string, unknown>>;
    getCoinSupply(): Promise<ChainStats>;
    getBlockDetails(height: number): Promise<BlockDetail>;
    getBlockTimes(heights: number[]): Promise<Record<number, number>>;
    getTreeUpdateInfo(height: number): Promise<{ nextBlock: number; blocksAway: number; estimatedMinutes: number }>;
    getAddressInfo(address: string): Promise<AddressInfo>;
    getNameDetail(name: string): Promise<NameDetail>;
    scanGlobalAuctions(): Promise<GlobalAuctionsScanResult>;
    getTransaction(hash: string): Promise<{ hash: string; height: number | null; fee: number }>;
    verifyMessageWithName(name: string, signature: string, message: string): Promise<boolean>;
  };

  /** Handshake TLD search engine */
  searchEngine: {
    getStatus(): Promise<HnsIndexStatus>;
    search(query: HnsIndexSearchQuery): Promise<HnsIndexSearchResponse>;
    refreshRecent(blockCount?: number): Promise<HnsIndexRefreshResult>;
    cancelRefresh(): Promise<boolean>;
    refreshName(name: string): Promise<HnsIndexRecord | null>;
  };

  /** Wallet operations */
  wallet: {
    getInfo(): Promise<WalletInfo>;
    getBalance(): Promise<WalletBalance>;
    getNames(includeResources?: boolean): Promise<Domain[]>;
    getNameInfo(name: string): Promise<Domain | null>;
    getBids(name?: string): Promise<Bid[]>;
    getReveals(name?: string): Promise<unknown[]>;
    getAuctions(): Promise<Auction[]>;
    /** Names the wallet opened for auction, derived from transaction history */
    getOpenedNames(): Promise<OpenedName[]>;
    getAuctionInfo(name: string): Promise<Auction | null>;
    sendOpen(name: string, passphrase: string): Promise<Transaction>;
    sendBulkOpen(names: string[], passphrase: string): Promise<{ name: string; hash: string; success: boolean; error?: string }[]>;
    sendBid(name: string, bid: number, lockup: number, passphrase: string): Promise<Transaction>;
    sendReveal(name: string | null, passphrase: string): Promise<Transaction>;
    sendRedeem(name: string | null, passphrase: string): Promise<Transaction>;
    sendUpdate(name: string, resource: DNSResource, passphrase: string): Promise<Transaction>;
    applyTags(updates: TagUpdate[], passphrase: string): Promise<TagUpdateResult[]>;
    sendRenewal(name: string, passphrase: string): Promise<Transaction>;
    sendTransfer(name: string, address: string, passphrase: string): Promise<Transaction>;
    sendFinalize(name: string, passphrase: string): Promise<Transaction>;
    sendCancel(name: string, passphrase: string): Promise<Transaction>;
    sendRevoke(name: string, passphrase: string): Promise<Transaction>;
    importName(name: string, height?: number): Promise<void>;
    unlock(passphrase: string, timeout: number): Promise<void>;
    lock(): Promise<void>;
    getTxHistory(): Promise<Transaction[]>;
    /** Create a new wallet */
    createWallet(name: string, passphrase?: string): Promise<{ id: string }>;
    /** Get a receiving address */
    getAddress(account?: string): Promise<{ address: string }>;
    /** Create a new receiving address */
    createAddress(account?: string): Promise<{ address: string }>;
    /** List all wallet addresses */
    listAddresses(account?: string): Promise<WalletAddress[]>;
    /** Send HNS to a recipient */
    sendToAddress(address: string, amount: number, passphrase: string, options?: { feeRate?: number; subtractFee?: boolean }): Promise<SendResult>;
    /** List all wallets */
    listWalletsDetailed(): Promise<string[]>;
    /** Get public key for an address */
    getPublicKey(address: string): Promise<{ publicKey: string }>;
    /** Import a wallet from a BIP39 seed phrase */
    importWallet(name: string, mnemonic: string, passphrase?: string): Promise<{ id: string }>;
    /** Select a wallet for subsequent operations */
    selectWallet(walletId: string): Promise<void>;
    /** Get master key info (includes mnemonic seed phrase if not encrypted) */
    getMasterKey(name: string): Promise<{ mnemonic: string | null; encrypted: boolean }>;
    /** Encrypt an unencrypted wallet with a passphrase */
    encryptWallet(name: string, passphrase: string): Promise<void>;
    /** Get fee estimates for each speed tier */
    getFeeEstimates(): Promise<Array<{ speed: string; feeDollarydoos: number; feeHns: string }>>;
    signMessageWithName(name: string, message: string, passphrase?: string): Promise<string>;
    /** Sign the same message with every supplied name (multi-sign CSV export) */
    signMessageBatch(names: string[], message: string, passphrase?: string): Promise<NameSignatureResult[]>;
    deepClean(): Promise<void>;
    rescan(height?: number): Promise<void>;
  };

  /** Price feed (CoinGecko proxy) */
  price: {
    getHnsUsd(): Promise<number | null>;
    getDgbUsd(): Promise<number | null>;
  };

  /** Batch operations */
  batch: {
    execute(request: BatchRequest): Promise<BatchJob>;
    cancel(jobId: string): Promise<void>;
    getQueue(): Promise<BatchJob[]>;
    getHistory(): Promise<BatchJob[]>;
    retryChunk(jobId: string, chunkIndex: number): Promise<void>;
  };

  /** Marketplace */
  marketplace: {
    createListing(input: CreateListingInput, passphrase: string): Promise<MarketplaceListing>;
    cancelListing(name: string, passphrase: string): Promise<void>;
    getMyListings(): Promise<MarketplaceListing[]>;
    getOffers(includeOwn?: boolean): Promise<MarketplaceListing[]>;
    requestPurchase(listing: MarketplaceListing, buyerAddr: string, useEscrow?: boolean): Promise<PurchaseIntent>;
    getEscrowFundingStatus(intentId: string): Promise<{ funded: boolean; value: number; vout: number; confirmations: number; address: string; amount: number }>;
    fundEscrow(intentId: string, passphrase: string): Promise<{ txHash: string; address: string; amount: number }>;
    createEscrowRelease(intentId: string): Promise<{ psbt: string; role: 'buyer' | 'seller' }>;
    signEscrowRelease(intentId: string): Promise<{ txId: string }>;
    createEscrowDisputePsbt(intentId: string, kind: 'refund' | 'release'): Promise<{ psbt: string; kind: 'refund' | 'release' }>;
    importEscrowArbiterPsbt(intentId: string, psbt: string): Promise<{ txId: string }>;
    checkTransferStatus(name: string, buyerAddr: string, transferTxHash?: string): Promise<TransferStatus>;
    confirmAndPay(intentId: string, passphrase: string): Promise<{ txHash: string; fee: number }>;
    finalizePurchase(intentId: string, passphrase: string): Promise<{ txHash: string }>;
    getPurchaseRequests(): Promise<PurchaseIntent[]>;
    getMyPurchases(): Promise<PurchaseIntent[]>;
    approvePurchase(name: string, buyerAddr: string, passphrase: string): Promise<{ txHash: string }>;
    rejectPurchase(name: string, buyerAddr: string): Promise<void>;
    dismissPurchaseRequest(name: string, buyerAddr: string): Promise<void>;
    forceCancelListing(name: string): Promise<void>;
    verifyListing(listing: MarketplaceListing): Promise<boolean>;
    /** Renew or reprice an existing listing. */
    republishListing(name: string, price: number, passphrase: string): Promise<MarketplaceListing>;
    /** Test every configured Nostr relay. */
    testRelays(): Promise<RelayHealth[]>;
    getNostrPubkey(): Promise<string>;
    getRelays(): Promise<string[]>;
    setRelays(relays: string[]): Promise<void>;
  };

  /** Local database operations */
  db: {
    getTags(): Promise<Tag[]>;
    createTag(name: string, color: string): Promise<Tag>;
    updateTag(id: number, name: string, color: string): Promise<Tag>;
    deleteTag(id: number): Promise<void>;
    assignTag(domainName: string, tagId: number): Promise<void>;
    removeTag(domainName: string, tagId: number): Promise<void>;
    getTagsForDomain(domainName: string): Promise<Tag[]>;
    getDomainsForTag(tagId: number): Promise<string[]>;
    addToWatchlist(name: string, notes?: string, notifyOn?: string): Promise<void>;
    removeFromWatchlist(name: string): Promise<void>;
    getWatchlist(): Promise<Array<{ name: string; notes: string; notifyOn: string; addedAt: string }>>;
    updateWatchlistNotifyOn(name: string, notifyOn: string): Promise<void>;
    getSearchHistory(): Promise<SearchHistoryEntry[]>;
    saveSearchHistory(names: string[], summary: unknown): Promise<void>;
    saveBidReceipt(name: string, receipt: { bidAmount: number; nonce: string; lockup: number; name: string; createdAt: string }): Promise<void>;
    getBidReceipt(name: string): Promise<BidReceipt | null>;
    removeBidReceipt(name: string): Promise<void>;
    getAllBidReceipts(): Promise<Record<string, BidReceipt>>;
    getRevealedNames(): Promise<string[]>;
    addRevealedName(name: string): Promise<void>;
    removeRevealedName(name: string): Promise<void>;
    setRevealedNames(names: string[]): Promise<void>;
    getOpenedHidden(): Promise<string[]>;
    addOpenedHidden(name: string): Promise<void>;
    removeOpenedHidden(name: string): Promise<void>;
    getJustRedeemed(): Promise<string[]>;
    addJustRedeemed(name: string): Promise<void>;
    removeJustRedeemed(name: string): Promise<void>;
    setJustRedeemed(names: string[]): Promise<void>;

    getJustRegistered(): Promise<string[]>;
    addJustRegistered(name: string): Promise<void>;
    removeJustRegistered(name: string): Promise<void>;
    setJustRegistered(names: string[]): Promise<void>;

    getListingVerification(name: string): Promise<boolean | undefined>;
    setListingVerification(name: string, verified: boolean): Promise<void>;
  };

  /** Config / Settings */
  config: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    getAll(): Promise<Record<string, string>>;
    getDataDir(): Promise<string>;
    getDefaultHsdDataDir(): Promise<string>;
  };

  /** Managed HSD process management */
  hsd: {
    /** Start the managed hsd node */
    startManagedNode(config: ManagedNodeConfig): Promise<{ success: boolean; error?: string | null }>;
    /** Stop the managed hsd node */
    stopManagedNode(): Promise<void>;
    /** Get managed hsd process status */
    getManagedStatus(): Promise<HSDProcessStatus>;
    /** Set hsd data directory */
    setDataDir(path: string): Promise<void>;
    /** Set hsd binary path */
    setBinaryPath(path: string): Promise<void>;
    /** Detect hsd binary on the system */
    detectHsd(): Promise<string | null>;
    /** Build a connection config from saved local hsd credentials */
    getExistingNodeConfig(): Promise<HSDConnectionConfig | null>;
    /** Check whether a loopback TCP port is accepting connections */
    isPortListening(host: string, port: number): Promise<boolean>;
    /** Get advanced HSD configuration */
    getAdvancedConfig(): Promise<HsdAdvancedConfig>;
    /** Save advanced HSD configuration (persists to store + writes hsd.conf) */
    saveAdvancedConfig(config: HsdAdvancedConfig): Promise<void>;
  };

  /** First-run setup wizard */
  setup: {
    getStatus(): Promise<SetupEnvironmentStatus>;
    downloadRuntime(): Promise<SetupRuntimeInstallResult>;
    installRuntimeFromFile(): Promise<SetupRuntimeInstallResult | null>;
    chooseDataDir(): Promise<string | null>;
    cancelRuntime(): Promise<boolean>;
    complete(input: SetupCompleteInput): Promise<void>;
    openReleasePage(): Promise<void>;
  };

  /** Notification queries */
  notifications: {
    getExpiring(): Promise<{ critical: Array<{ name: string; blocksLeft: number }>; warning: Array<{ name: string; blocksLeft: number }>; notice: Array<{ name: string; blocksLeft: number }> }>;
    getPendingActions(): Promise<{
      pendingReveals: number;
      pendingRedeems: number;
      pendingRegistrations: number;
      pendingFinalizations: number;
      pendingRevealNames: string[];
      pendingRedeemNames: string[];
      pendingRegisterNames: string[];
    }>;
  };

  /** DigiByte (DGB) operations via Electrum protocol */
  dgb: {
    connect(host: string, port: number, ssl: boolean, network: DgbNetworkType): Promise<void>;
    disconnect(): Promise<void>;
    getBalance(address: string): Promise<DgbBalance>;
    getAddress(): Promise<string>;
    getWif(passphrase?: string): Promise<string>;
    getUnspent(address: string): Promise<Array<{ txHash: string; vout: number; value: number; height: number; confirmations: number; address: string; scriptPubKey: string }>>;
    broadcast(rawTxHex: string): Promise<string>;
    estimateFee(blocks?: number): Promise<number>;
    getConfig(): Promise<DgbServerConfig | null>;
    saveConfig(config: DgbServerConfig): Promise<void>;
    getStatus(): Promise<{ connected: boolean; host: string; port: number; network: DgbNetworkType }>;
  };

  /** Atomic swap operations (HNS → DGB) */
  swap: {
    publishOffer(offer: {
      direction: 'hnsToDgb' | 'dgbToHns';
      hnsAmount: number;
      dgbAmount: number;
      exchangeRate: number;
      dgbAddress: string;
      expiresAt: number | null;
    }): Promise<SwapOffer>;
    cancelOffer(offerId: string): Promise<void>;
    fetchActiveOffers(): Promise<SwapOffer[]>;
    acceptOffer(offer: SwapOffer): Promise<LocalSwap>;
    getMySwaps(): Promise<LocalSwap[]>;
    getMySwapOffers(): Promise<SwapOffer[]>;
    getSwapById(swapId: string): Promise<LocalSwap | null>;
    getNostrPubkey(): Promise<string>;
    setAutoComplete(swapId: string, enabled: boolean): Promise<void>;
    startMonitor(): Promise<void>;
    stopMonitor(): Promise<void>;
    executeSwapAsInitiator(swapId: string, passphrase: string): Promise<void>;
    fundDgbHtlc(swapId: string): Promise<void>;
    claimFromDgbHtlc(swapId: string): Promise<string>;
    claimFromHnsHtlc(swapId: string): Promise<string>;
    rebroadcastHnsClaim(swapId: string): Promise<string>;
    refundHnsHtlc(swapId: string): Promise<string>;
    refundDgbHtlc(swapId: string): Promise<string>;
  };

  /** Event listeners for progress updates from main process */
  on: {
    batchProgress(callback: (progress: BatchProgress) => void): () => void;
    connectionChange(callback: (state: string) => void): () => void;
    newBlock(callback: (height: number) => void): () => void;
    notification(callback: (message: NotificationPayload) => void): () => void;
    hsdStateChange(callback: (state: string) => void): () => void;
    hsdError(callback: (error: string) => void): () => void;
    hsdLog(callback: (message: string) => void): () => void;
    swapUpdate(callback: (swap: LocalSwap) => void): () => void;
    searchEngineProgress(callback: (status: HnsIndexStatus) => void): () => void;
  setupProgress(callback: (progress: SetupRuntimeProgress) => void): () => void;
  };
}

// ============================================================
// Global Window Extension
// ============================================================

/**
 * Extend the Window interface so `window.api` is typed throughout the app.
 */
declare global {
  interface Window {
    api: ElectronAPI;
  }
}
