/**
 * HSD Connection Hook
 *
 * Provides easy access to connection state from any component.
 * Wraps the connection store with convenience methods.
 */

import { useConnectionStore } from '../stores/connection-store';

export function useHSD() {
  // Deliberately no auto-connect here. The app always opens on Settings with
  // the node stopped; the user must click "Start Node" (or explicitly connect
  // to an external node) before any wallet data is available.
  const store = useConnectionStore();

  return {
    // State
    connectionState: store.connectionState,
    isConnected: store.connectionState === 'connected',
    isConnecting: store.connectionState === 'connecting',
    isLoggedIn: store.isLoggedIn,
    nodeInfo: store.nodeInfo,
    blockHeight: store.blockHeight,
    network: store.network,
    error: store.error,

    // Actions
    connect: store.connect,
    disconnect: store.disconnect,
    testConnection: store.testConnection,
    setBlockHeight: store.setBlockHeight,
    refreshWallet: store.refreshWallet,

    // Wallet info shortcuts
    walletInfo: store.walletInfo,
    balance: store.balance,
  };
}
