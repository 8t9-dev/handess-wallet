/**
 * Typed wrapper for HSD API calls.
 *
 * This module provides typed functions that map to `window.api.*` IPC calls.
 * It serves as an abstraction layer so components and hooks don't call
 * `window.api` directly -- making it easier to mock for testing and
 * keeping IPC usage centralized.
 *
 * Each function:
 * 1. Calls the appropriate IPC method via window.api
 * 2. Transforms/normalizes the response
 * 3. Returns typed data
 *
 * TODO: Implement each function by calling window.api.* IPC methods.
 *       The function signatures and JSDoc are complete -- just add the body.
 */

import type { Domain, DNSResource, Tag } from '../types/domain';
import type { WalletInfo, WalletBalance, NodeInfo, HSDConnectionConfig, Transaction } from '../types/wallet';
import type { BatchJob, BatchRequest } from '../types/batch';
import type { MarketplaceListing, CreateListingInput, PurchaseIntent } from '../types/marketplace';
import type { NameLookupResult, BulkSearchResult } from '../types/search';

// ============================================================
// Connection API
// ============================================================

/**
 * Connect to an hsd node.
 *
 * @param config - Connection configuration (host, ports, API key)
 * @returns true if connection succeeded
 *
 * TODO: Call window.api.connection.connect(config)
 */
export async function connect(_config: HSDConnectionConfig): Promise<boolean> {
  // TODO: return await window.api.connection.connect(config);
  throw new Error('Not implemented');
}

/**
 * Disconnect from the current hsd node.
 *
 * TODO: Call window.api.connection.disconnect()
 */
export async function disconnect(): Promise<void> {
  // TODO: return await window.api.connection.disconnect();
  throw new Error('Not implemented');
}

/**
 * Auto-detect Bob Wallet's configuration.
 * Reads API key and ports from Bob Wallet's data directory.
 *
 * @returns Detected config, or null if Bob Wallet not found
 *
 * TODO: Call window.api.connection.detectBobConfig()
 */
export async function detectBobConfig(): Promise<HSDConnectionConfig | null> {
  // TODO: return await window.api.connection.detectBobConfig();
  throw new Error('Not implemented');
}

/**
 * Test a connection configuration without persisting it.
 *
 * @param config - Config to test
 * @returns Object with success boolean and optional error message
 *
 * TODO: Call window.api.connection.testConnection(config)
 */
export async function testConnection(
  _config: HSDConnectionConfig,
): Promise<{ success: boolean; error?: string }> {
  // TODO: return await window.api.connection.testConnection(config);
  throw new Error('Not implemented');
}

// ============================================================
// Node (Blockchain) API
// ============================================================

/**
 * Get node info including chain height and sync progress.
 *
 * TODO: Call window.api.node.getInfo()
 */
export async function getNodeInfo(): Promise<NodeInfo> {
  // TODO: return await window.api.node.getInfo();
  throw new Error('Not implemented');
}

/**
 * Look up a single name's availability and state.
 *
 * Uses hsd's `getnameinfo` RPC under the hood.
 *
 * @param name - The Handshake TLD name to look up
 * @returns Name lookup result with availability status
 *
 * TODO: Call window.api.node.getNameInfo(name)
 */
export async function getNameInfo(_name: string): Promise<NameLookupResult> {
  // TODO: return await window.api.node.getNameInfo(name);
  throw new Error('Not implemented');
}

/**
 * Get DNS resource records for a name.
 *
 * @param name - The name to get records for
 * @returns DNS resource object, or null if no records set
 *
 * TODO: Call window.api.node.getNameResource(name)
 */
export async function getNameResource(_name: string): Promise<DNSResource | null> {
  // TODO: return await window.api.node.getNameResource(name);
  throw new Error('Not implemented');
}

/**
 * Bulk lookup: check availability for a list of names.
 * Names are looked up in parallel (rate-limited by BULK_LOOKUP_CONCURRENCY).
 *
 * @param names - Array of names to look up
 * @returns Complete search result with summary
 *
 * TODO: Call window.api.node.bulkLookup(names)
 */
export async function bulkLookup(_names: string[]): Promise<BulkSearchResult> {
  // TODO: return await window.api.node.bulkLookup(names);
  throw new Error('Not implemented');
}

/**
 * Get current block height.
 *
 * TODO: Call window.api.node.getBlockHeight()
 */
export async function getBlockHeight(): Promise<number> {
  // TODO: return await window.api.node.getBlockHeight();
  throw new Error('Not implemented');
}

/**
 * Estimate fee rate for a given confirmation target.
 *
 * @param blocks - Target number of blocks (default: 6)
 * @returns Fee rate in HNS per KB
 *
 * TODO: Call window.api.node.estimateFee(blocks)
 */
export async function estimateFee(_blocks: number = 6): Promise<number> {
  // TODO: return await window.api.node.estimateFee(blocks);
  throw new Error('Not implemented');
}

// ============================================================
// Wallet API
// ============================================================

/**
 * Get wallet info.
 *
 * TODO: Call window.api.wallet.getInfo()
 */
export async function getWalletInfo(): Promise<WalletInfo> {
  // TODO: return await window.api.wallet.getInfo();
  throw new Error('Not implemented');
}

/**
 * Get wallet balance.
 *
 * TODO: Call window.api.wallet.getBalance()
 */
export async function getWalletBalance(): Promise<WalletBalance> {
  // TODO: return await window.api.wallet.getBalance();
  throw new Error('Not implemented');
}

/**
 * Get all names the wallet owns or tracks.
 *
 * TODO: Call window.api.wallet.getNames()
 * TODO: Enrich with tags from window.api.db
 * TODO: Calculate expiry dates and urgency
 */
export async function getWalletNames(): Promise<Domain[]> {
  // TODO: return await window.api.wallet.getNames();
  throw new Error('Not implemented');
}

/**
 * Send a name operation (open, bid, reveal, etc.).
 * Requires wallet passphrase for signing.
 *
 * @param operation - The operation type
 * @param name - The name to operate on
 * @param passphrase - Wallet passphrase
 * @param params - Additional parameters (address, bid amount, etc.)
 * @returns The broadcast transaction
 *
 * TODO: Route to the appropriate window.api.wallet.send* method
 */
export async function sendNameOperation(
  _operation: string,
  _name: string,
  _passphrase: string,
  _params?: Record<string, unknown>,
): Promise<Transaction> {
  // TODO: Switch on operation type and call the appropriate IPC method
  throw new Error('Not implemented');
}

// ============================================================
// Batch API
// ============================================================

/**
 * Execute a batch operation.
 *
 * @param request - Batch request (operation type, names, params, passphrase)
 * @returns The created batch job with queue status
 *
 * TODO: Call window.api.batch.execute(request)
 */
export async function executeBatch(_request: BatchRequest): Promise<BatchJob> {
  // TODO: return await window.api.batch.execute(request);
  throw new Error('Not implemented');
}

/**
 * Get the current batch operation queue.
 *
 * TODO: Call window.api.batch.getQueue()
 */
export async function getBatchQueue(): Promise<BatchJob[]> {
  // TODO: return await window.api.batch.getQueue();
  throw new Error('Not implemented');
}

// ============================================================
// Marketplace API
// ============================================================

/**
 * Create a marketplace listing to sell a name.
 *
 * @param input - Listing parameters (name, price, seller address)
 * @param passphrase - Wallet passphrase for signing
 * @returns Created listing object
 */
export async function createListing(
  input: CreateListingInput,
  passphrase: string,
): Promise<MarketplaceListing> {
  return await window.api.marketplace.createListing(input, passphrase);
}

/**
 * Submit a purchase request for a marketplace listing (transfer escrow).
 *
 * @param name - The domain name
 * @param price - The price in HNS
 * @param sellerAddr - Seller's HNS address
 * @param buyerAddr - Buyer's receiving address
 * @param passphrase - Wallet passphrase
 * @returns Purchase intent object
 */
export async function requestPurchase(
  name: string,
  price: number,
  sellerAddr: string,
  buyerAddr: string,
  passphrase: string,
): Promise<PurchaseIntent> {
  return await window.api.marketplace.requestPurchase(name, price, sellerAddr, buyerAddr, passphrase);
}

// ============================================================
// Database API (Tags, Watchlist)
// ============================================================

/**
 * Get all user-defined tags.
 *
 * TODO: Call window.api.db.getTags()
 */
export async function getTags(): Promise<Tag[]> {
  // TODO: return await window.api.db.getTags();
  throw new Error('Not implemented');
}

/**
 * Create a new tag.
 *
 * @param name - Tag name
 * @param color - Hex color string
 * @returns Created tag with ID
 *
 * TODO: Call window.api.db.createTag(name, color)
 */
export async function createTag(_name: string, _color: string): Promise<Tag> {
  // TODO: return await window.api.db.createTag(name, color);
  throw new Error('Not implemented');
}

/**
 * Get watchlist entries.
 *
 * TODO: Call window.api.db.getWatchlist()
 */
export async function getWatchlist(): Promise<Array<{ name: string; notes: string; addedAt: string }>> {
  // TODO: return await window.api.db.getWatchlist();
  throw new Error('Not implemented');
}
