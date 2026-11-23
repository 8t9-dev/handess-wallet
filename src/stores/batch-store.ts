/**
 * Batch Store (Zustand)
 *
 * Manages the batch operation queue and progress tracking.
 * Receives progress updates from the main process via IPC events.
 */

import { create } from 'zustand';
import type { BatchJob, BatchProgress, BatchRequest } from '../types/batch';

interface BatchStore {
  // State
  /** Active batch queue (pending + in-progress) */
  queue: BatchJob[];
  /** Completed batch history */
  history: BatchJob[];
  /** Currently executing job (if any) */
  activeJob: BatchJob | null;
  isLoading: boolean;

  // Actions
  /** Submit a new batch operation */
  submitBatch: (request: BatchRequest) => Promise<BatchJob>;
  /** Cancel a queued batch job */
  cancelBatch: (jobId: string) => Promise<void>;
  /** Retry a failed chunk */
  retryChunk: (jobId: string, chunkIndex: number) => Promise<void>;
  /** Update progress (called from IPC event listener) */
  updateProgress: (progress: BatchProgress) => void;
  /** Fetch queue from main process */
  fetchQueue: () => Promise<void>;
  /** Fetch history from main process */
  fetchHistory: () => Promise<void>;
}

export const useBatchStore = create<BatchStore>((set) => ({
  queue: [],
  history: [],
  activeJob: null,
  isLoading: false,

  submitBatch: async (request) => {
    const job = await window.api.batch.execute(request);
    set((state) => ({ queue: [...state.queue, job] }));
    return job;
  },

  cancelBatch: async (jobId) => {
    await window.api.batch.cancel(jobId);
    set((state) => ({
      queue: state.queue.map(j =>
        j.id === jobId ? { ...j, status: 'cancelled' as const } : j
      ),
    }));
  },

  retryChunk: async (jobId, chunkIndex) => {
    await window.api.batch.retryChunk(jobId, chunkIndex);
  },

  updateProgress: (progress) => {
    set((state) => ({
      queue: state.queue.map(job => {
        if (job.id !== progress.jobId) return job;
        const updatedChunks = job.chunks.map((chunk, i) =>
          i === progress.currentChunk
            ? { ...chunk, status: progress.chunkStatus, txHash: progress.latestTxHash, error: progress.error }
            : chunk
        );
        const failed = progress.chunkStatus === 'failed' || Boolean(progress.error);
        return {
          ...job,
          chunks: updatedChunks,
          processedNames: Math.floor(progress.percentComplete / 100 * job.totalNames),
          status: failed
            ? 'failed' as const
            : progress.percentComplete >= 100
              ? 'completed' as const
              : 'broadcasting' as const,
        };
      }),
    }));
  },

  fetchQueue: async () => {
    const queue = await window.api.batch.getQueue();
    set({ queue });
  },

  fetchHistory: async () => {
    const history = await window.api.batch.getHistory();
    set({ history });
  },
}));
