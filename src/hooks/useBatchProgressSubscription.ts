import { useEffect } from 'react';
import { useBatchStore } from '../stores/batch-store';

/** Bridge batch progress events into the batch store for the whole app. */
export function useBatchProgressSubscription(): void {
  useEffect(() => {
    if (!window.api?.on?.batchProgress) return;
    return window.api.on.batchProgress((progress) => {
      useBatchStore.getState().updateProgress(progress);
    });
  }, []);
}
