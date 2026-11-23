/**
 * Batch Service
 *
 * Handles bulk name operations by chunking large batches into
 * multiple transactions and managing a queue with progress tracking.
 */

import { EventEmitter } from 'events';
import type { WalletService } from './wallet-service';
import type { NodeService } from './node-service';
import type { DBService } from './db-service';
import type { HSDConnectionService } from './hsd-connection';
import type { BatchJob, BatchRequest, BatchProgress, BatchAction } from '../../src/types/batch';
import { BATCH_CHUNK_SIZE } from '../../src/lib/constants';
import {
  chunkBatchActions,
  createBatchChunks,
  getBatchDescription,
  buildRenewActions,
  buildTransferActions,
  buildOpenActions,
  buildFinalizeActions,
  buildRegisterActions,
  buildCancelActions,
} from '../../src/lib/batch-chunker';

export class BatchService extends EventEmitter {
  private walletService: WalletService;
  private nodeService: NodeService;
  private dbService: DBService;
  private connectionService: HSDConnectionService;
  private queue: BatchJob[] = [];
  private isProcessing = false;

  constructor(
    walletService: WalletService,
    nodeService: NodeService,
    dbService: DBService,
    connectionService: HSDConnectionService,
  ) {
    super();
    this.walletService = walletService;
    this.nodeService = nodeService;
    this.dbService = dbService;
    this.connectionService = connectionService;
  }

  async execute(request: BatchRequest): Promise<BatchJob> {
    const actions = this.buildActions(request);
    const chunkSize = request.params?.chunkSize || BATCH_CHUNK_SIZE;
    const actionChunks = chunkBatchActions(actions, chunkSize);
    const chunks = createBatchChunks(actionChunks);

    const job: BatchJob = {
      id: this.generateId(),
      operationType: request.operationType,
      description: getBatchDescription(request.operationType, request.names.length, chunkSize),
      names: request.names,
      chunks,
      status: 'queued',
      totalNames: request.names.length,
      processedNames: 0,
      estimatedFeeHNS: null,
      actualFeeHNS: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.queue.push(job);
    this.dbService.logBatchOperation(request.operationType, request.names, chunks.length);

    if (!this.isProcessing) {
      this.processQueue(request.passphrase);
    }

    return job;
  }

  private buildActions(request: BatchRequest): BatchAction[] {
    const { operationType, names, params } = request;
    switch (operationType) {
      case 'RENEW': return buildRenewActions(names);
      case 'TRANSFER': return buildTransferActions(names, params?.address || '');
      case 'OPEN': return buildOpenActions(names);
      case 'FINALIZE': return buildFinalizeActions(names);
      case 'UPDATE': return buildRegisterActions(names);
      case 'CANCEL': return buildCancelActions(names);
      case 'REVEAL': return names.map(n => ['REVEAL', n] as BatchAction);
      case 'REDEEM': return names.map(n => ['REDEEM', n] as BatchAction);
      case 'REVOKE': return names.map(n => ['REVOKE', n] as BatchAction);
      case 'BID':
        return names.map(n => ['BID', n, params?.bidAmount || 1, params?.lockupAmount || 2] as BatchAction);
      default:
        throw new Error(`Unknown batch operation: ${operationType}`);
    }
  }

  private async processQueue(passphrase: string): Promise<void> {
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const job = this.queue.find(j => j.status === 'queued');
      if (!job) break;

      job.status = 'signing';

      try {
        const { walletClient } = this.connectionService.getClients();
        const walletInfo = await this.walletService.getInfo();
        const encrypted = walletInfo?.master?.encrypted === true;
        if (encrypted) {
          await walletClient.execute('walletpassphrase', [passphrase, 600]);
        }

        for (let i = 0; i < job.chunks.length; i++) {
          const chunk = job.chunks[i];
          try {
            chunk.status = 'broadcasting';
            this.emitProgress(job, i, 'broadcasting');

            const actions = chunk.actions.map(a => [...a] as (string | number | object)[]);
            const result = await walletClient.execute('sendbatch', [actions]) as Record<string, unknown>;
            chunk.txHash = (result?.hash as string) || '';
            chunk.fee = (result?.fee as number) || 0;
            chunk.status = 'completed';

            job.processedNames += chunk.actions.length;
            this.emitProgress(job, i, 'completed');
          } catch (err) {
            chunk.status = 'failed';
            chunk.error = err instanceof Error ? err.message : 'Unknown error';
            job.status = 'failed';
            this.emitProgress(job, i, 'failed');
            break;
          }
        }

        if (encrypted) {
          await walletClient.execute('walletlock');
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Batch signing failed';
        job.status = 'failed';
        job.completedAt = new Date().toISOString();
        if (job.chunks[0]) {
          job.chunks[0].status = 'failed';
          job.chunks[0].error = error;
        }
        const progress: BatchProgress = {
          jobId: job.id,
          currentChunk: 0,
          totalChunks: job.chunks.length,
          chunkStatus: 'failed',
          latestTxHash: null,
          error,
          percentComplete: 0,
        };
        this.emit('progress', progress);
        this.dbService.updateBatchLog(
          this.getDbLogId(job),
          job.chunks.filter(c => c.status === 'completed').length,
          'failed',
          job.chunks.map(c => c.txHash || '').filter(Boolean),
        );
        this.queue = this.queue.filter(j => j.id !== job.id);
        continue;
      }

      if (job.status !== 'failed') {
        job.status = 'completed';
      }
      job.completedAt = new Date().toISOString();
      job.actualFeeHNS = job.chunks.reduce((sum, c) => sum + ((c.fee || 0) / 1000000), 0);

      this.dbService.updateBatchLog(
        this.getDbLogId(job),
        job.chunks.filter(c => c.status === 'completed').length,
        job.status,
        job.chunks.map(c => c.txHash || '').filter(Boolean),
      );

      this.queue = this.queue.filter(j => j.id !== job.id);
      this.emit('jobComplete', job);
    }

    this.isProcessing = false;
  }

  private emitProgress(job: BatchJob, chunkIndex: number, status: string): void {
    const progress: BatchProgress = {
      jobId: job.id,
      currentChunk: chunkIndex,
      totalChunks: job.chunks.length,
      chunkStatus: status as BatchProgress['chunkStatus'],
      latestTxHash: job.chunks[chunkIndex]?.txHash || null,
      error: job.chunks[chunkIndex]?.error || null,
      percentComplete: Math.round((job.processedNames / job.totalNames) * 100),
    };
    this.emit('progress', progress);
  }

  private generateId(): string {
    return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getDbLogId(job: BatchJob): number {
    const history = this.dbService.getBatchHistory();
    const entry = history.find((h: Record<string, unknown>) =>
      h.names && Array.isArray(h.names) &&
      JSON.stringify(h.names) === JSON.stringify(job.names) &&
      h.operation === job.operationType &&
      (h as Record<string, string>).status === 'pending'
    );
    return entry ? (entry as unknown as Record<string, number>).id : 1;
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.queue.find(j => j.id === jobId);
    if (job && job.status === 'queued') {
      job.status = 'cancelled';
      this.queue = this.queue.filter(j => j.id !== jobId);
    }
  }

  async retryChunk(jobId: string, chunkIndex: number): Promise<void> {
    const job = this.queue.find(j => j.id === jobId);
    if (job && job.chunks[chunkIndex]) {
      job.chunks[chunkIndex].status = 'queued';
      job.chunks[chunkIndex].error = null;
      job.status = 'queued';
    }
  }

  getQueue(): BatchJob[] {
    return this.queue;
  }

  async getHistory(): Promise<unknown[]> {
    return this.dbService.getBatchHistory();
  }
}
