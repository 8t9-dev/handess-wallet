/**
 * Batch operation type definitions.
 *
 * Bulk operations are the CRM's core differentiator. They use hsd's
 * `sendbatch` / `createbatch` RPC which accepts an array of action tuples
 * and combines them into a single transaction.
 *
 * Large batches (100+ names) must be chunked into multiple transactions
 * because each TX has a weight/size limit (~85 operations per TX).
 *
 * Reference: HSD_API_REFERENCE.md "Batch Operations"
 */

// ============================================================
// Batch Action Types
// ============================================================

/**
 * Supported batch operation types.
 * Maps to the first element of a `createbatch` action tuple.
 */
export type BatchActionType =
  | 'OPEN'
  | 'BID'
  | 'REVEAL'
  | 'REDEEM'
  | 'UPDATE'
  | 'RENEW'
  | 'TRANSFER'
  | 'FINALIZE'
  | 'CANCEL'
  | 'REVOKE';

/**
 * A single action within a batch.
 * Format matches hsd's `createbatch` tuple format.
 *
 * Examples:
 *   ['OPEN', 'myname']
 *   ['BID', 'myname', 5.0, 10.0]
 *   ['RENEW', 'myname']
 *   ['TRANSFER', 'myname', 'hs1q...']
 *   ['UPDATE', 'myname', { records: [...] }]
 *   ['REVEAL']        // reveal all
 *   ['RENEW']         // renew all
 *   ['FINALIZE']      // finalize all
 */
export type BatchAction =
  | [type: 'OPEN', name: string]
  | [type: 'BID', name: string, bid: number, lockup: number]
  | [type: 'REVEAL']
  | [type: 'REVEAL', name: string]
  | [type: 'REDEEM']
  | [type: 'REDEEM', name: string]
  | [type: 'UPDATE', name: string, resource: { records: unknown[] }]
  | [type: 'RENEW']
  | [type: 'RENEW', name: string]
  | [type: 'TRANSFER', name: string, address: string]
  | [type: 'FINALIZE']
  | [type: 'FINALIZE', name: string]
  | [type: 'CANCEL', name: string]
  | [type: 'REVOKE', name: string];

// ============================================================
// Batch Job Types (Queue Management)
// ============================================================

/**
 * Status of a batch job in the queue.
 */
export type BatchJobStatus =
  | 'queued'        // Waiting to execute
  | 'signing'       // Wallet is signing the transaction
  | 'broadcasting'  // Transaction is being broadcast to the network
  | 'confirming'    // Waiting for on-chain confirmation (optional)
  | 'completed'     // All chunks successfully broadcast
  | 'failed'        // One or more chunks failed
  | 'cancelled';    // User cancelled before execution

/**
 * A single chunk within a batch job.
 * Each chunk is a separate on-chain transaction.
 */
export interface BatchChunk {
  /** Chunk index (0-based) */
  index: number;

  /** Actions in this chunk */
  actions: BatchAction[];

  /** Status of this chunk */
  status: BatchJobStatus;

  /** Transaction hash after broadcast (null if not yet broadcast) */
  txHash: string | null;

  /** Fee paid for this chunk's transaction (dollarydoos, null if not yet known) */
  fee: number | null;

  /** Error message if this chunk failed */
  error: string | null;
}

/**
 * A batch job representing a complete bulk operation.
 * May contain multiple chunks if the operation exceeds TX size limits.
 */
export interface BatchJob {
  /** Unique job ID (UUID) */
  id: string;

  /** Type of operation being performed */
  operationType: BatchActionType;

  /** Human-readable description (e.g., "Renew 500 names") */
  description: string;

  /** All domain names involved in this batch */
  names: string[];

  /** Individual chunks (each becomes a separate TX) */
  chunks: BatchChunk[];

  /** Overall job status */
  status: BatchJobStatus;

  /** Total number of names in the batch */
  totalNames: number;

  /** Number of names processed so far */
  processedNames: number;

  /** Estimated total fee in HNS (calculated before execution) */
  estimatedFeeHNS: number | null;

  /** Actual total fee in HNS (calculated after completion) */
  actualFeeHNS: number | null;

  /** ISO timestamp when the job was created */
  createdAt: string;

  /** ISO timestamp when the job completed (or failed) */
  completedAt: string | null;
}

// ============================================================
// Batch Request Types (UI -> Service)
// ============================================================

/**
 * Request to create a new batch operation.
 * Sent from the UI to the BatchService via IPC.
 */
export interface BatchRequest {
  /** Type of operation */
  operationType: BatchActionType;

  /** Names to operate on */
  names: string[];

  /** Additional parameters depending on operation type */
  params?: BatchParams;

  /** Wallet passphrase for signing */
  passphrase: string;
}

/**
 * Additional parameters for batch operations.
 */
export interface BatchParams {
  /** For TRANSFER: destination address */
  address?: string;

  /** For BID: bid amount per name (HNS) */
  bidAmount?: number;

  /** For BID: lockup amount per name (HNS) */
  lockupAmount?: number;

  /** For UPDATE: DNS resource records to set */
  resource?: { records: unknown[] };

  /** Override chunk size (default from constants) */
  chunkSize?: number;
}

// ============================================================
// Batch Progress (Service -> UI events)
// ============================================================

/**
 * Progress update emitted during batch execution.
 * Sent from BatchService to the renderer via IPC events.
 */
export interface BatchProgress {
  /** Job ID */
  jobId: string;

  /** Current chunk index being processed */
  currentChunk: number;

  /** Total number of chunks */
  totalChunks: number;

  /** Status of the current chunk */
  chunkStatus: BatchJobStatus;

  /** Transaction hash of the latest broadcast chunk */
  latestTxHash: string | null;

  /** Error message if the current chunk failed */
  error: string | null;

  /** Overall completion percentage (0-100) */
  percentComplete: number;
}
