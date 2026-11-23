/**
 * Batch operation chunking utility.
 *
 * Splits large bulk operations into transaction-sized chunks.
 * Each chunk becomes a separate on-chain transaction because
 * hsd has a per-transaction weight/size limit.
 *
 * Default chunk size: 85 operations (conservative).
 * Bob Wallet uses ~100 (MAX_BLOCK_RENEWALS / 6).
 *
 * Reference: ARCHITECTURE.md "Batch Chunking Strategy"
 */

import { BATCH_CHUNK_SIZE } from './constants';
import type { BatchAction, BatchActionType, BatchChunk } from '../types/batch';

// ============================================================
// Core Chunking
// ============================================================

/**
 * Split an array of batch actions into chunks that each fit
 * within a single transaction's size limit.
 *
 * @param actions - Full array of batch actions
 * @param chunkSize - Max operations per chunk (default: BATCH_CHUNK_SIZE)
 * @returns Array of action arrays, each small enough for one TX
 *
 * @example
 * const actions = names.map(n => ['RENEW', n] as BatchAction);
 * const chunks = chunkBatchActions(actions, 85);
 * // 500 names -> 6 chunks (85, 85, 85, 85, 85, 75)
 */
export function chunkBatchActions(
  actions: BatchAction[],
  chunkSize: number = BATCH_CHUNK_SIZE,
): BatchAction[][] {
  if (actions.length === 0) return [];
  if (actions.length <= chunkSize) return [actions];

  const chunks: BatchAction[][] = [];
  for (let i = 0; i < actions.length; i += chunkSize) {
    chunks.push(actions.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Create BatchChunk objects from chunked actions.
 * Initializes each chunk with 'queued' status and null TX hash.
 *
 * @param actionChunks - Array of action arrays from chunkBatchActions()
 * @returns Array of BatchChunk objects ready for the queue
 */
export function createBatchChunks(actionChunks: BatchAction[][]): BatchChunk[] {
  return actionChunks.map((actions, index) => ({
    index,
    actions,
    status: 'queued' as const,
    txHash: null,
    fee: null,
    error: null,
  }));
}

// ============================================================
// Action Builders
// ============================================================

/**
 * Build batch actions for a RENEW operation on multiple names.
 *
 * @param names - Array of domain names to renew
 * @returns Array of BatchAction tuples
 */
export function buildRenewActions(names: string[]): BatchAction[] {
  return names.map((name): BatchAction => ['RENEW', name]);
}

/**
 * Build batch actions for a TRANSFER operation on multiple names.
 *
 * @param names - Array of domain names to transfer
 * @param address - Destination Handshake address (hs1q...)
 * @returns Array of BatchAction tuples
 */
export function buildTransferActions(names: string[], address: string): BatchAction[] {
  return names.map((name): BatchAction => ['TRANSFER', name, address]);
}

/**
 * Build batch actions for an OPEN operation on multiple names.
 *
 * @param names - Array of available names to open for auction
 * @returns Array of BatchAction tuples
 */
export function buildOpenActions(names: string[]): BatchAction[] {
  return names.map((name): BatchAction => ['OPEN', name]);
}

/**
 * Build batch actions for a BID operation on multiple names.
 *
 * @param bids - Array of { name, bidAmount, lockupAmount }
 * @returns Array of BatchAction tuples
 */
export function buildBidActions(
  bids: Array<{ name: string; bidAmount: number; lockupAmount: number }>,
): BatchAction[] {
  return bids.map(({ name, bidAmount, lockupAmount }): BatchAction =>
    ['BID', name, bidAmount, lockupAmount],
  );
}

/**
 * Build batch actions for FINALIZE on multiple names.
 *
 * @param names - Array of names with pending transfers to finalize
 * @returns Array of BatchAction tuples
 */
export function buildFinalizeActions(names: string[]): BatchAction[] {
  return names.map((name): BatchAction => ['FINALIZE', name]);
}

/**
 * Build batch actions for UPDATE (register) on multiple names.
 * Registers won names with empty DNS records.
 *
 * @param names - Array of won but unregistered names
 * @returns Array of BatchAction tuples
 */
export function buildRegisterActions(names: string[]): BatchAction[] {
  return names.map((name): BatchAction => ['UPDATE', name, { records: [] }]);
}

/**
 * Build batch actions for a CANCEL operation on multiple names.
 *
 * @param names - Array of names with pending transfers to cancel
 * @returns Array of BatchAction tuples
 */
export function buildCancelActions(names: string[]): BatchAction[] {
  return names.map((name): BatchAction => ['CANCEL', name]);
}

// ============================================================
// Estimation
// ============================================================

/**
 * Estimate the number of transactions needed for a batch operation.
 *
 * @param nameCount - Number of names in the operation
 * @param chunkSize - Max operations per transaction
 * @returns Number of transactions needed
 */
export function estimateTransactionCount(
  nameCount: number,
  chunkSize: number = BATCH_CHUNK_SIZE,
): number {
  return Math.ceil(nameCount / chunkSize);
}

/**
 * Estimate total fees for a batch operation.
 *
 * @param nameCount - Number of names in the operation
 * @param feePerTx - Estimated fee per transaction in HNS
 * @param chunkSize - Max operations per transaction
 * @returns Estimated total fee in HNS
 */
export function estimateTotalFee(
  nameCount: number,
  feePerTx: number,
  chunkSize: number = BATCH_CHUNK_SIZE,
): number {
  const txCount = estimateTransactionCount(nameCount, chunkSize);
  return txCount * feePerTx;
}

/**
 * Get a human-readable description for a batch operation.
 *
 * @param operationType - The type of batch operation
 * @param nameCount - Number of names
 * @returns Description string like "Renew 500 names (6 transactions)"
 */
export function getBatchDescription(
  operationType: BatchActionType,
  nameCount: number,
  chunkSize: number = BATCH_CHUNK_SIZE,
): string {
  const txCount = estimateTransactionCount(nameCount, chunkSize);
  const labels: Record<BatchActionType, string> = {
    OPEN: 'Open for auction',
    BID: 'Place bids on',
    REVEAL: 'Reveal bids for',
    REDEEM: 'Redeem bids for',
    UPDATE: 'Update DNS for',
    RENEW: 'Renew',
    TRANSFER: 'Transfer',
    FINALIZE: 'Finalize transfer of',
    CANCEL: 'Cancel transfer of',
    REVOKE: 'Revoke',
  };

  const label = labels[operationType] || operationType;
  const names = nameCount === 1 ? 'name' : 'names';
  const txs = txCount === 1 ? 'transaction' : 'transactions';

  return `${label} ${nameCount} ${names} (${txCount} ${txs})`;
}
