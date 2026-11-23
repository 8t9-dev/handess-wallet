import { create } from 'zustand';
import type { WalletAddress, SendResult } from '../types/wallet';
import type { HSDProcessState } from '../types/wallet';
import type { ManagedNodeConfig } from '../types/wallet';
import { useConnectionStore } from './connection-store';

interface WalletStore {
  addresses: WalletAddress[];
  currentAddress: string | null;
  isSending: boolean;
  sendResult: SendResult | null;
  sendError: string | null;
  processStatus: HSDProcessState;
  managedNodeConfig: ManagedNodeConfig | null;

  fetchAddresses: () => Promise<void>;
  generateAddress: (account?: string) => Promise<string>;
  sendHns: (address: string, amount: number, passphrase: string, options?: { feeRate?: number; subtractFee?: boolean }) => Promise<SendResult>;
  setProcessStatus: (status: HSDProcessState) => void;
  clearSendResult: () => void;
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  addresses: [],
  currentAddress: null,
  isSending: false,
  sendResult: null,
  sendError: null,
  processStatus: 'stopped',
  managedNodeConfig: null,

  fetchAddresses: async () => {
    try {
      const result = await window.api.wallet.listAddresses();
      const addresses = result as WalletAddress[];
      set({
        addresses,
        currentAddress: addresses.length > 0 ? addresses[0].address : null,
      });
    } catch {
      // Not connected
    }
  },

  generateAddress: async (account) => {
    const result = await window.api.wallet.createAddress(account);
    const address = result.address;
    await get().fetchAddresses();
    set({ currentAddress: address });
    return address;
  },

  sendHns: async (address, amount, passphrase, options) => {
    set({ isSending: true, sendError: null, sendResult: null });
    try {
      const result = await window.api.wallet.sendToAddress(address, amount, passphrase, options);
      set({ sendResult: result as SendResult, isSending: false });
      // refresh balance after successful send
      useConnectionStore.getState().refreshWallet();
      return result as SendResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      set({ sendError: msg, isSending: false });
      throw err;
    }
  },

  setProcessStatus: (status) => {
    set({ processStatus: status });
  },

  clearSendResult: () => {
    set({ sendResult: null, sendError: null });
  },
}));
