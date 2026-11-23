/**
 * Electron Preload Script
 *
 * This script runs in a special context that has access to both
 * the Electron APIs and the renderer's DOM. It uses `contextBridge`
 * to safely expose a typed `window.api` object to the renderer.
 *
 * SECURITY:
 * - contextIsolation is enabled (renderer can't access Node.js)
 * - Only explicitly exposed methods are available to the renderer
 * - No raw ipcRenderer is exposed (prevents arbitrary IPC calls)
 *
 * Type contract: src/types/ipc.ts (ElectronAPI interface)
 */

import { contextBridge, ipcRenderer } from 'electron';
// Import types for reference (not used at runtime, just for structure)
// import type { ElectronAPI } from '../src/types/ipc';

/**
 * Expose the API to the renderer process as `window.api`.
 *
 * Each method wraps `ipcRenderer.invoke(channel, ...args)` which
 * sends a message to the main process and returns a Promise.
 *
 */
contextBridge.exposeInMainWorld('api', {
  // ===========================================================
  // Application lifecycle and legal documents
  // ===========================================================
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    quit: () => ipcRenderer.invoke('app:quit'),
    openThirdPartyNotices: () => ipcRenderer.invoke('app:openThirdPartyNotices'),
  },

  /** System clipboard (used by copyable transaction hashes) */
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  },

  // ===========================================================
  // Connection Management
  // ===========================================================
  connection: {
    /** Connect to an hsd node with the given config */
    connect: (config: unknown) =>
      ipcRenderer.invoke('connection:connect', config),

    /** Detailed reason for the most recent failed connection attempt */
    getLastError: () =>
      ipcRenderer.invoke('connection:getLastError'),

    /** Disconnect from the current hsd node */
    disconnect: () =>
      ipcRenderer.invoke('connection:disconnect'),

    /** Get current connection status and node info */
    getStatus: () =>
      ipcRenderer.invoke('connection:getStatus'),

    /** Auto-detect Bob Wallet's config (API key, ports) */
    detectBobConfig: () =>
      ipcRenderer.invoke('connection:detectBobConfig'),

    /** Test a connection config without persisting */
    testConnection: (config: unknown) =>
      ipcRenderer.invoke('connection:testConnection', config),

    /** Auto-detect available wallet names from HSD data directories */
    detectWalletNames: () =>
      ipcRenderer.invoke('connection:detectWalletNames'),

    /** Load the last saved connection settings (stored encrypted in the main process) */
    getSavedConfig: () =>
      ipcRenderer.invoke('connection:getSavedConfig'),

    /** Persist connection settings encrypted at rest in the main process */
    saveConfig: (config: unknown) =>
      ipcRenderer.invoke('connection:saveConfig', config),
  },

  // ===========================================================
  // Node (Blockchain) Queries
  // ===========================================================
  node: {
    /** Get node info (chain height, sync progress, network) */
    getInfo: () =>
      ipcRenderer.invoke('node:getInfo'),

    /** Ask a connected local hsd node to shut down gracefully */
    shutdown: () =>
      ipcRenderer.invoke('node:shutdown'),

    /** Look up a single name's info and availability */
    getNameInfo: (name: string) =>
      ipcRenderer.invoke('node:getNameInfo', name),

    /** Get DNS resource records for a name */
    getNameResource: (name: string) =>
      ipcRenderer.invoke('node:getNameResource', name),

    /** Bulk lookup: check availability for a list of names */
    bulkLookup: (names: string[]) =>
      ipcRenderer.invoke('node:bulkLookup', names),

    /** Estimate fee rate for N-block confirmation target */
    estimateFee: (blocks?: number) =>
      ipcRenderer.invoke('node:estimateFee', blocks),

    /** Get current block height */
    getBlockHeight: () =>
      ipcRenderer.invoke('node:getBlockHeight'),

    /** Get the most recent N blocks with summary data */
    getRecentBlocks: (count?: number) =>
      ipcRenderer.invoke('node:getRecentBlocks', count),

    /** Get mempool info */
    getMempoolInfo: () =>
      ipcRenderer.invoke('node:getMempoolInfo'),

    /** Get chain-wide coin supply stats */
    getCoinSupply: () =>
      ipcRenderer.invoke('node:getCoinSupply'),

    /** Get detailed block info with all transactions */
    getBlockDetails: (height: number) =>
      ipcRenderer.invoke('node:getBlockDetails', height),

    /** Get actual block timestamps for a list of heights */
    getBlockTimes: (heights: number[]) =>
      ipcRenderer.invoke('node:getBlockTimes', heights),

    /** Get tree update info for current height */
    getTreeUpdateInfo: (height: number) =>
      ipcRenderer.invoke('node:getTreeUpdateInfo', height),

    /** Get address info (balance, tx count, names) */
    getAddressInfo: (address: string) =>
      ipcRenderer.invoke('node:getAddressInfo', address),

    /** Scan the chain for active auctions across all names */
    scanGlobalAuctions: () =>
      ipcRenderer.invoke('node:scanGlobalAuctions'),

    /** Get detailed name info with resource records */
    getNameDetail: (name: string) =>
      ipcRenderer.invoke('node:getNameDetail', name),

    /** Get transaction by hash (node chain DB first, wallet fallback) */
    getTransaction: (hash: string) =>
      ipcRenderer.invoke('node:getTransaction', hash),

    /** Verify a signed message against a Handshake name */
    verifyMessageWithName: (name: string, signature: string, message: string) =>
      ipcRenderer.invoke('node:verifyMessageWithName', name, signature, message),
  },

  // ===========================================================
  // Handshake TLD Search Engine
  // ===========================================================
  searchEngine: {
    /** Load status and counts for the local TLD index */
    getStatus: () =>
      ipcRenderer.invoke('searchEngine:getStatus'),

    /** Search/filter indexed TLDs */
    search: (query: unknown) =>
      ipcRenderer.invoke('searchEngine:search', query),

    /** Refresh names whose DNS records changed in the selected block range */
    refreshRecent: (blockCount?: number) =>
      ipcRenderer.invoke('searchEngine:refreshRecent', blockCount),

    /** Cancel the running bulk refresh */
    cancelRefresh: () =>
      ipcRenderer.invoke('searchEngine:cancelRefresh'),

    /** Refresh a single name from the connected node */
    refreshName: (name: string) =>
      ipcRenderer.invoke('searchEngine:refreshName', name),
  },

  // ===========================================================
  // Wallet Operations
  // ===========================================================
  wallet: {
    /** Get wallet info (id, balance, encrypted status) */
    getInfo: () =>
      ipcRenderer.invoke('wallet:getInfo'),

    /** Get wallet balance */
    getBalance: () =>
      ipcRenderer.invoke('wallet:getBalance'),

    /** Get all names the wallet owns/tracks */
    getNames: (includeResources = false) =>
      ipcRenderer.invoke('wallet:getNames', includeResources),

    /** Get wallet-specific info for a single name */
    getNameInfo: (name: string) =>
      ipcRenderer.invoke('wallet:getNameInfo', name),

    /** Get all bids (optionally filter by name) */
    getBids: (name?: string) =>
      ipcRenderer.invoke('wallet:getBids', name),

    /** Get all reveals (optionally filter by name) */
    getReveals: (name?: string) =>
      ipcRenderer.invoke('wallet:getReveals', name),

    /** Get all auctions the wallet is involved in */
    getAuctions: () =>
      ipcRenderer.invoke('wallet:getAuctions'),

    /** Get names the wallet opened for auction, from transaction history */
    getOpenedNames: () =>
      ipcRenderer.invoke('wallet:getOpenedNames'),

    /** Get detailed auction info for a specific name */
    getAuctionInfo: (name: string) =>
      ipcRenderer.invoke('wallet:getAuctionInfo', name),

    /** Open a name for auction */
    sendOpen: (name: string, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendOpen', name, passphrase),

    /** Bulk open names for auction (single unlock) */
    sendBulkOpen: (names: string[], passphrase: string) =>
      ipcRenderer.invoke('wallet:sendBulkOpen', names, passphrase),

    /** Place a bid on a name */
    sendBid: (name: string, bid: number, lockup: number, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendBid', name, bid, lockup, passphrase),

    /** Reveal a bid (null name = reveal all) */
    sendReveal: (name: string | null, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendReveal', name, passphrase),

    /** Redeem a losing bid (null name = redeem all) */
    sendRedeem: (name: string | null, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendRedeem', name, passphrase),

    /** Update DNS records for a name */
    sendUpdate: (name: string, resource: unknown, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendUpdate', name, resource, passphrase),

    /** Apply on-chain TXT tags to several names with one wallet unlock */
    applyTags: (updates: unknown, passphrase: string) =>
      ipcRenderer.invoke('wallet:applyTags', updates, passphrase),

    /** Renew a name */
    sendRenewal: (name: string, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendRenewal', name, passphrase),

    /** Transfer a name to an address */
    sendTransfer: (name: string, address: string, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendTransfer', name, address, passphrase),

    /** Finalize a pending transfer */
    sendFinalize: (name: string, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendFinalize', name, passphrase),

    /** Cancel a pending transfer */
    sendCancel: (name: string, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendCancel', name, passphrase),

    /** Revoke a name (IRREVERSIBLE) */
    sendRevoke: (name: string, passphrase: string) =>
      ipcRenderer.invoke('wallet:sendRevoke', name, passphrase),

    /** Import a name to track its auction data (bids, reveals) */
    importName: (name: string, height?: number) =>
      ipcRenderer.invoke('wallet:importName', name, height),

    /** Unlock the wallet for signing operations */
    unlock: (passphrase: string, timeout: number) =>
      ipcRenderer.invoke('wallet:unlock', passphrase, timeout),

    /** Lock the wallet */
    lock: () =>
      ipcRenderer.invoke('wallet:lock'),

    /** Get transaction history */
    getTxHistory: () =>
      ipcRenderer.invoke('wallet:getTxHistory'),

    /** Create a new wallet */
    createWallet: (name: string, passphrase?: string) =>
      ipcRenderer.invoke('wallet:createWallet', name, passphrase),

    /** Get a receiving address */
    getAddress: (account?: string) =>
      ipcRenderer.invoke('wallet:getAddress', account),

    /** Create a new receiving address */
    createAddress: (account?: string) =>
      ipcRenderer.invoke('wallet:createAddress', account),

    /** List all wallet addresses */
    listAddresses: (account?: string) =>
      ipcRenderer.invoke('wallet:listAddresses', account),

    /** Send HNS to a recipient */
    sendToAddress: (address: string, amount: number, passphrase: string, options?: { feeRate?: number; subtractFee?: boolean }) =>
      ipcRenderer.invoke('wallet:sendToAddress', address, amount, passphrase, options),

    /** List all wallets */
    listWalletsDetailed: () =>
      ipcRenderer.invoke('wallet:listWalletsDetailed'),

    /** Get public key for an address */
    getPublicKey: (address: string) =>
      ipcRenderer.invoke('wallet:getPublicKey', address),

    /** Get fee estimates for each speed tier */
    getFeeEstimates: () =>
      ipcRenderer.invoke('wallet:getFeeEstimates'),

    /** Import a wallet from a BIP39 seed phrase */
    importWallet: (name: string, mnemonic: string, passphrase?: string) =>
      ipcRenderer.invoke('wallet:importWallet', name, mnemonic, passphrase),

    /** Select a wallet for subsequent operations */
    selectWallet: (walletId: string) =>
      ipcRenderer.invoke('wallet:selectWallet', walletId),

    /** Get master key info (includes mnemonic seed phrase if not encrypted) */
    getMasterKey: (name: string) =>
      ipcRenderer.invoke('wallet:getMasterKey', name),

    /** Encrypt an unencrypted wallet with a passphrase */
    encryptWallet: (name: string, passphrase: string) =>
      ipcRenderer.invoke('wallet:encryptWallet', name, passphrase),

    /** Sign a message with the private key associated with a Handshake name */
    signMessageWithName: (name: string, message: string, passphrase?: string) =>
      ipcRenderer.invoke('wallet:signMessageWithName', name, message, passphrase),

    /** Sign the same message with every supplied name (multi-sign CSV export) */
    signMessageBatch: (names: string[], message: string, passphrase?: string) =>
      ipcRenderer.invoke('wallet:signMessageBatch', names, message, passphrase),

    /** Deep clean the wallet DB (wipes balance/tx history, keeps keys) */
    deepClean: () =>
      ipcRenderer.invoke('wallet:deepClean'),

    /** Rescan the blockchain for wallet transactions */
    rescan: (height?: number) =>
      ipcRenderer.invoke('wallet:rescan', height),
  },

  // ===========================================================
  // Price Feed (CoinGecko proxy)
  // ===========================================================
  price: {
    getHnsUsd: () =>
      ipcRenderer.invoke('price:getHnsUsd'),
    getDgbUsd: () =>
      ipcRenderer.invoke('price:getDgbUsd'),
  },

  // ===========================================================
  // Batch Operations
  // ===========================================================
  batch: {
    /** Execute a batch operation (auto-chunks if needed) */
    execute: (request: unknown) =>
      ipcRenderer.invoke('batch:execute', request),

    /** Cancel a queued (not yet started) batch job */
    cancel: (jobId: string) =>
      ipcRenderer.invoke('batch:cancel', jobId),

    /** Get the current batch queue */
    getQueue: () =>
      ipcRenderer.invoke('batch:getQueue'),

    /** Get batch operation history */
    getHistory: () =>
      ipcRenderer.invoke('batch:getHistory'),

    /** Retry a failed chunk in a batch job */
    retryChunk: (jobId: string, chunkIndex: number) =>
      ipcRenderer.invoke('batch:retryChunk', jobId, chunkIndex),
  },

  // Marketplace
  marketplace: {
    /** Create a new listing (sell a name) */
    createListing: (input: unknown, passphrase: string) =>
      ipcRenderer.invoke('marketplace:createListing', input, passphrase),

    /** Cancel an active listing */
    cancelListing: (name: string, passphrase: string) =>
      ipcRenderer.invoke('marketplace:cancelListing', name, passphrase),

    /** Get all of the user's own listings */
    getMyListings: () =>
      ipcRenderer.invoke('marketplace:getMyListings'),

    /** Get available offers from relays */
    getOffers: (includeOwn?: boolean) =>
      ipcRenderer.invoke('marketplace:getOffers', includeOwn),

    /** Submit a purchase request (buyer side) */
    requestPurchase: (listing: unknown, buyerAddr: string, useEscrow?: boolean) =>
      ipcRenderer.invoke('marketplace:requestPurchase', listing, buyerAddr, useEscrow),

    /** Check escrow funding and confirmation status */
    getEscrowFundingStatus: (intentId: string) =>
      ipcRenderer.invoke('marketplace:getEscrowFundingStatus', intentId),

    /** Fund a created escrow from the buyer's wallet */
    fundEscrow: (intentId: string, passphrase: string) =>
      ipcRenderer.invoke('marketplace:fundEscrow', intentId, passphrase),

    /** Create a buyer/seller-signed release PSBT */
    createEscrowRelease: (intentId: string) =>
      ipcRenderer.invoke('marketplace:createEscrowRelease', intentId),

    /** Add the counterparty signature, finalize, and broadcast */
    signEscrowRelease: (intentId: string) =>
      ipcRenderer.invoke('marketplace:signEscrowRelease', intentId),

    /** Create a refund or arbitration-release PSBT for the arbiter */
    createEscrowDisputePsbt: (intentId: string, kind: 'refund' | 'release') =>
      ipcRenderer.invoke('marketplace:createEscrowDisputePsbt', intentId, kind),

    /** Import an arbiter-signed PSBT, finalize, and broadcast */
    importEscrowArbiterPsbt: (intentId: string, psbt: string) =>
      ipcRenderer.invoke('marketplace:importEscrowArbiterPsbt', intentId, psbt),

    /** Poll on-chain to check if seller initiated the transfer */
    checkTransferStatus: (name: string, buyerAddr: string, transferTxHash?: string) =>
      ipcRenderer.invoke('marketplace:checkTransferStatus', name, buyerAddr, transferTxHash),

    /** Send HNS payment after verifying transfer (buyer side) */
    confirmAndPay: (intentId: string, passphrase: string) =>
      ipcRenderer.invoke('marketplace:confirmAndPay', intentId, passphrase),

    /** Finalize a purchased transfer (buyer side, after lockup) */
    finalizePurchase: (intentId: string, passphrase: string) =>
      ipcRenderer.invoke('marketplace:finalizePurchase', intentId, passphrase),

    /** Get incoming purchase requests (seller side) */
    getPurchaseRequests: () =>
      ipcRenderer.invoke('marketplace:getPurchaseRequests'),

    /** Get the current user's purchases (buyer side) */
    getMyPurchases: () =>
      ipcRenderer.invoke('marketplace:getMyPurchases'),

    /** Verify a listing's full-terms ownership proof */
    verifyListing: (listing: unknown) =>
      ipcRenderer.invoke('marketplace:verifyListing', listing),

    /** Renew or reprice an existing listing */
    republishListing: (name: string, price: number, passphrase: string) =>
      ipcRenderer.invoke('marketplace:republishListing', name, price, passphrase),

    /** Test every configured Nostr relay */
    testRelays: () =>
      ipcRenderer.invoke('marketplace:testRelays'),

    /** Approve a purchase request: initiates transfer to buyer (seller side) */
    approvePurchase: (name: string, buyerAddr: string, passphrase: string) =>
      ipcRenderer.invoke('marketplace:approvePurchase', name, buyerAddr, passphrase),

    /** Reject a purchase request (seller side) */
    rejectPurchase: (name: string, buyerAddr: string) =>
      ipcRenderer.invoke('marketplace:rejectPurchase', name, buyerAddr),

    /** Dismiss a purchase request from the local view (no Nostr publish) */
    dismissPurchaseRequest: (name: string, buyerAddr: string) =>
      ipcRenderer.invoke('marketplace:dismissPurchaseRequest', name, buyerAddr),

    /** Force-publish a cancel event to Nostr for a listing name */
    forceCancelListing: (name: string) =>
      ipcRenderer.invoke('marketplace:forceCancelListing', name),

    /** Get the Nostr public key for this wallet instance */
    getNostrPubkey: () =>
      ipcRenderer.invoke('marketplace:getNostrPubkey'),

    /** Get configured Nostr relay URLs */
    getRelays: () =>
      ipcRenderer.invoke('marketplace:getRelays'),

    /** Set Nostr relay URLs */
    setRelays: (relays: string[]) =>
      ipcRenderer.invoke('marketplace:setRelays', relays),
  },

  // ===========================================================
  // Local Database (Tags, Watchlist, Search History)
  // ===========================================================
  db: {
    getTags: () => ipcRenderer.invoke('db:getTags'),
    createTag: (name: string, color: string) => ipcRenderer.invoke('db:createTag', name, color),
    updateTag: (id: number, name: string, color: string) => ipcRenderer.invoke('db:updateTag', id, name, color),
    deleteTag: (id: number) => ipcRenderer.invoke('db:deleteTag', id),
    assignTag: (domainName: string, tagId: number) => ipcRenderer.invoke('db:assignTag', domainName, tagId),
    removeTag: (domainName: string, tagId: number) => ipcRenderer.invoke('db:removeTag', domainName, tagId),
    getTagsForDomain: (domainName: string) => ipcRenderer.invoke('db:getTagsForDomain', domainName),
    getDomainsForTag: (tagId: number) => ipcRenderer.invoke('db:getDomainsForTag', tagId),
    addToWatchlist: (name: string, notes?: string, notifyOn?: string) => ipcRenderer.invoke('db:addToWatchlist', name, notes, notifyOn),
    removeFromWatchlist: (name: string) => ipcRenderer.invoke('db:removeFromWatchlist', name),
    getWatchlist: () => ipcRenderer.invoke('db:getWatchlist'),
    updateWatchlistNotifyOn: (name: string, notifyOn: string) => ipcRenderer.invoke('db:updateWatchlistNotifyOn', name, notifyOn),
    getSearchHistory: () => ipcRenderer.invoke('db:getSearchHistory'),
    saveSearchHistory: (names: string[], summary: unknown) => ipcRenderer.invoke('db:saveSearchHistory', names, summary),
    saveBidReceipt: (name: string, receipt: { bidAmount: number; nonce: string; lockup: number }) => ipcRenderer.invoke('db:saveBidReceipt', name, receipt),
    getBidReceipt: (name: string) => ipcRenderer.invoke('db:getBidReceipt', name),
    removeBidReceipt: (name: string) => ipcRenderer.invoke('db:removeBidReceipt', name),
    getAllBidReceipts: () => ipcRenderer.invoke('db:getAllBidReceipts'),

    getRevealedNames: () => ipcRenderer.invoke('db:getRevealedNames'),
    addRevealedName: (name: string) => ipcRenderer.invoke('db:addRevealedName', name),
    removeRevealedName: (name: string) => ipcRenderer.invoke('db:removeRevealedName', name),
    setRevealedNames: (names: string[]) => ipcRenderer.invoke('db:setRevealedNames', names),

    getOpenedHidden: () => ipcRenderer.invoke('db:getOpenedHidden'),
    addOpenedHidden: (name: string) => ipcRenderer.invoke('db:addOpenedHidden', name),
    removeOpenedHidden: (name: string) => ipcRenderer.invoke('db:removeOpenedHidden', name),

    getJustRedeemed: () => ipcRenderer.invoke('db:getJustRedeemed'),
    addJustRedeemed: (name: string) => ipcRenderer.invoke('db:addJustRedeemed', name),
    removeJustRedeemed: (name: string) => ipcRenderer.invoke('db:removeJustRedeemed', name),
    setJustRedeemed: (names: string[]) => ipcRenderer.invoke('db:setJustRedeemed', names),

    getJustRegistered: () => ipcRenderer.invoke('db:getJustRegistered'),
    addJustRegistered: (name: string) => ipcRenderer.invoke('db:addJustRegistered', name),
    removeJustRegistered: (name: string) => ipcRenderer.invoke('db:removeJustRegistered', name),
    setJustRegistered: (names: string[]) => ipcRenderer.invoke('db:setJustRegistered', names),

    getListingVerification: (name: string) => ipcRenderer.invoke('db:getListingVerification', name),
    setListingVerification: (name: string, verified: boolean) => ipcRenderer.invoke('db:setListingVerification', name, verified),
  },

  // ===========================================================
  // Config / Settings
  // ===========================================================
  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('config:set', key, value),
    getAll: () => ipcRenderer.invoke('config:getAll'),
    getDataDir: () => ipcRenderer.invoke('config:getDataDir'),
    getDefaultHsdDataDir: () => ipcRenderer.invoke('config:getDefaultHsdDataDir'),
  },

  // ===========================================================
  // Managed HSD Process
  // ===========================================================
  hsd: {
    /** Start the managed hsd node */
    startManagedNode: (config: unknown) =>
      ipcRenderer.invoke('hsd:start', config),

    /** Stop the managed hsd node */
    stopManagedNode: () =>
      ipcRenderer.invoke('hsd:stop'),

    /** Get managed hsd process status */
    getManagedStatus: () =>
      ipcRenderer.invoke('hsd:status'),

    /** Set hsd data directory */
    setDataDir: (path: string) =>
      ipcRenderer.invoke('hsd:setDataDir', path),

    /** Set hsd binary path */
    setBinaryPath: (path: string) =>
      ipcRenderer.invoke('hsd:setBinaryPath', path),

    /** Detect hsd binary on the system */
    detectHsd: () =>
      ipcRenderer.invoke('hsd:detectHsd'),

    /** Build a connection config from saved local hsd credentials */
    getExistingNodeConfig: () =>
      ipcRenderer.invoke('hsd:getExistingNodeConfig'),

    /** Check whether a loopback TCP port is accepting connections */
    isPortListening: (host: string, port: number) =>
      ipcRenderer.invoke('hsd:isPortListening', host, port),

    /** Get advanced HSD configuration */
    getAdvancedConfig: () =>
      ipcRenderer.invoke('hsd:getAdvancedConfig'),

    /** Save advanced HSD configuration (persists to store + writes hsd.conf) */
    saveAdvancedConfig: (config: unknown) =>
      ipcRenderer.invoke('hsd:saveAdvancedConfig', config),
  },

  // ===========================================================
  // First-run setup
  // ===========================================================
  setup: {
    getStatus: () => ipcRenderer.invoke('setup:getStatus'),
    downloadRuntime: () => ipcRenderer.invoke('setup:downloadRuntime'),
    installRuntimeFromFile: () => ipcRenderer.invoke('setup:installRuntimeFromFile'),
    chooseDataDir: () => ipcRenderer.invoke('setup:chooseDataDir'),
    cancelRuntime: () => ipcRenderer.invoke('setup:cancelRuntime'),
    complete: (input: unknown) => ipcRenderer.invoke('setup:complete', input),
    openReleasePage: () => ipcRenderer.invoke('setup:openReleasePage'),
  },

  // ===========================================================
  // Notifications
  // ===========================================================
  notifications: {
    /** Get expiring names with counts */
    getExpiring: () =>
      ipcRenderer.invoke('notifications:getExpiring'),

    /** Get pending action counts */
    getPendingActions: () =>
      ipcRenderer.invoke('notifications:getPendingActions'),
  },

  // ===========================================================
  // DigiByte (DGB) / Electrum
  // ===========================================================
  dgb: {
    connect: (host: string, port: number, ssl: boolean, network: string) =>
      ipcRenderer.invoke('dgb:connect', host, port, ssl, network),
    disconnect: () =>
      ipcRenderer.invoke('dgb:disconnect'),
    getBalance: (address: string) =>
      ipcRenderer.invoke('dgb:getBalance', address),
    getAddress: () =>
      ipcRenderer.invoke('dgb:getAddress'),
    getUnspent: (address: string) =>
      ipcRenderer.invoke('dgb:getUnspent', address),
    broadcast: (rawTxHex: string) =>
      ipcRenderer.invoke('dgb:broadcast', rawTxHex),
    estimateFee: (blocks?: number) =>
      ipcRenderer.invoke('dgb:estimateFee', blocks),
    getConfig: () =>
      ipcRenderer.invoke('dgb:getConfig'),
    saveConfig: (config: unknown) =>
      ipcRenderer.invoke('dgb:saveConfig', config),
    getStatus: () =>
      ipcRenderer.invoke('dgb:getStatus'),
    getWif: (passphrase?: string) =>
      ipcRenderer.invoke('dgb:getWif', passphrase),
  },

  // ===========================================================
  // Atomic Swap (HNS ↔ DGB)
  // ===========================================================
  swap: {
    publishOffer: (offer: unknown) =>
      ipcRenderer.invoke('swap:publishOffer', offer),
    cancelOffer: (offerId: string) =>
      ipcRenderer.invoke('swap:cancelOffer', offerId),
    fetchActiveOffers: () =>
      ipcRenderer.invoke('swap:fetchActiveOffers'),
    acceptOffer: (offer: unknown) =>
      ipcRenderer.invoke('swap:acceptOffer', offer),
    getMySwaps: () =>
      ipcRenderer.invoke('swap:getMySwaps'),
    getMySwapOffers: () =>
      ipcRenderer.invoke('swap:getMySwapOffers'),
    getSwapById: (swapId: string) =>
      ipcRenderer.invoke('swap:getSwapById', swapId),
    getNostrPubkey: () =>
      ipcRenderer.invoke('swap:getNostrPubkey'),
    fundDgbHtlc: (swapId: string) =>
      ipcRenderer.invoke('swap:fundDgbHtlc', swapId),
    claimFromDgbHtlc: (swapId: string) =>
      ipcRenderer.invoke('swap:claimFromDgbHtlc', swapId),
    claimFromHnsHtlc: (swapId: string) =>
      ipcRenderer.invoke('swap:claimFromHnsHtlc', swapId),
    rebroadcastHnsClaim: (swapId: string) =>
      ipcRenderer.invoke('swap:rebroadcastHnsClaim', swapId),
    refundHnsHtlc: (swapId: string) =>
      ipcRenderer.invoke('swap:refundHnsHtlc', swapId),
    refundDgbHtlc: (swapId: string) =>
      ipcRenderer.invoke('swap:refundDgbHtlc', swapId),
    setAutoComplete: (swapId: string, enabled: boolean) =>
      ipcRenderer.invoke('swap:setAutoComplete', swapId, enabled),
    startMonitor: () =>
      ipcRenderer.invoke('swap:startMonitor'),
    stopMonitor: () =>
      ipcRenderer.invoke('swap:stopMonitor'),
    executeSwapAsInitiator: (swapId: string, passphrase: string) =>
      ipcRenderer.invoke('swap:executeSwapAsInitiator', swapId, passphrase),
  },

  // ===========================================================
  // Event Listeners (main -> renderer)
  // ===========================================================
  on: {
    /** Listen for batch operation progress updates */
    batchProgress: (callback: (progress: unknown) => void) => {
      const handler = (_event: unknown, progress: unknown) => callback(progress);
      ipcRenderer.on('batch:progress', handler as (...args: unknown[]) => void);
      // Return unsubscribe function
      return () => ipcRenderer.removeListener('batch:progress', handler as (...args: unknown[]) => void);
    },

    /** Listen for connection state changes */
    connectionChange: (callback: (state: string) => void) => {
      const handler = (_event: unknown, state: string) => callback(state);
      ipcRenderer.on('connection:change', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('connection:change', handler as (...args: unknown[]) => void);
    },

    /** Listen for new block notifications */
    newBlock: (callback: (height: number) => void) => {
      const handler = (_event: unknown, height: number) => callback(height);
      ipcRenderer.on('node:newBlock', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('node:newBlock', handler as (...args: unknown[]) => void);
    },

    /** Listen for notification messages */
    notification: (callback: (message: { kind: string; title: string; body: string; count: number; names?: string[] }) => void) => {
      const handler = (_event: unknown, message: { kind: string; title: string; body: string; count: number; names?: string[] }) => callback(message);
      ipcRenderer.on('notification', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('notification', handler as (...args: unknown[]) => void);
    },

    /** Listen for managed hsd state changes */
    hsdStateChange: (callback: (state: string) => void) => {
      const handler = (_event: unknown, state: string) => callback(state);
      ipcRenderer.on('hsd:stateChange', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('hsd:stateChange', handler as (...args: unknown[]) => void);
    },

    /** Listen for managed hsd errors */
    hsdError: (callback: (error: string) => void) => {
      const handler = (_event: unknown, error: string) => callback(error);
      ipcRenderer.on('hsd:error', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('hsd:error', handler as (...args: unknown[]) => void);
    },

    /** Listen for managed hsd log messages */
    hsdLog: (callback: (message: string) => void) => {
      const handler = (_event: unknown, message: string) => callback(message);
      ipcRenderer.on('hsd:log', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('hsd:log', handler as (...args: unknown[]) => void);
    },

    /** Listen for swap state updates */
    swapUpdate: (callback: (swap: unknown) => void) => {
      const handler = (_event: unknown, swap: unknown) => callback(swap);
      ipcRenderer.on('swap:update', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('swap:update', handler as (...args: unknown[]) => void);
    },

    /** Listen for TLD index load/refresh progress */
    searchEngineProgress: (callback: (status: unknown) => void) => {
      const handler = (_event: unknown, status: unknown) => callback(status);
      ipcRenderer.on('searchEngine:progress', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('searchEngine:progress', handler as (...args: unknown[]) => void);
    },

    /** Listen for HSD runtime download/extract progress */
    setupProgress: (callback: (progress: unknown) => void) => {
      const handler = (_event: unknown, progress: unknown) => callback(progress);
      ipcRenderer.on('setup:progress', handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener('setup:progress', handler as (...args: unknown[]) => void);
    },
  },
});
