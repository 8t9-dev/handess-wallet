/**
 * Batch Operation Hook
 *
 * Provides batch operation submission and progress tracking.
 * Handles the complexities of chunking and progress updates.
 */

import { useCallback } from 'react';
import { useBatchStore } from '../stores/batch-store';
import type { BatchRequest, BatchActionType } from '../types/batch';

export function useBatchOperation() {
  const store = useBatchStore();

  const submitBatch = useCallback(
    async (operationType: BatchActionType, names: string[], passphrase: string, params?: Record<string, unknown>) => {
      const request: BatchRequest = {
        operationType,
        names,
        params,
        passphrase,
      };

      return await store.submitBatch(request);
    },
    [store],
  );

  const renewSelected = useCallback(
    async (names: string[], passphrase: string) => {
      return submitBatch('RENEW', names, passphrase);
    },
    [submitBatch],
  );

  const transferSelected = useCallback(
    async (names: string[], address: string, passphrase: string) => {
      return submitBatch('TRANSFER', names, passphrase, { address });
    },
    [submitBatch],
  );

  const openSelected = useCallback(
    async (names: string[], passphrase: string) => {
      return submitBatch('OPEN', names, passphrase);
    },
    [submitBatch],
  );

  const finalizeSelected = useCallback(
    async (names: string[], passphrase: string) => {
      return submitBatch('FINALIZE', names, passphrase);
    },
    [submitBatch],
  );

  return {
    queue: store.queue,
    history: store.history,
    activeJob: store.activeJob,
    isLoading: store.isLoading,

    submitBatch,
    cancelBatch: store.cancelBatch,
    retryChunk: store.retryChunk,
    refreshQueue: store.fetchQueue,

    // Convenience methods
    renewSelected,
    transferSelected,
    openSelected,
    finalizeSelected,
  };
}
