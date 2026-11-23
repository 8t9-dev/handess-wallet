/**
 * Connection Hook
 *
 * Simple hook for connection status.
 * Used by components that just need to know if connected.
 */

import { useConnectionStore } from '../stores/connection-store';

export function useConnection() {
  return useConnectionStore();
}
