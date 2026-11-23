import { create } from 'zustand';
import type { SwapOffer, LocalSwap, DgbServerConfig, DgbBalance } from '../types/swap';

type CreateSwapOfferInput = Omit<
  SwapOffer,
  'id' | 'nostrPubkey' | 'createdAt' | 'status' | 'dgbPubKey'
>;

interface SwapStore {
  dgbConnected: boolean;
  dgbAddress: string;
  dgbBalance: DgbBalance;
  dgbServerConfig: DgbServerConfig | null;
  activeOffers: SwapOffer[];
  mySwaps: LocalSwap[];
  mySwapOffers: SwapOffer[];
  autoComplete: boolean;
  loading: boolean;
  error: string | null;

  connectDgb: (config: DgbServerConfig) => Promise<void>;
  disconnectDgb: () => Promise<void>;
  refreshDgbConnection: () => Promise<void>;
  loadAutoComplete: () => Promise<void>;
  setAutoComplete: (enabled: boolean) => Promise<void>;
  setSwapAutoComplete: (swapId: string, enabled: boolean) => Promise<void>;
  fetchDgbAddress: () => Promise<void>;
  fetchDgbBalance: () => Promise<void>;
  fetchActiveOffers: () => Promise<void>;
  fetchMySwaps: () => Promise<void>;
  refreshDgbStatus: () => Promise<void>;
  publishOffer: (offer: CreateSwapOfferInput) => Promise<void>;
  acceptOffer: (offer: SwapOffer) => Promise<void>;
  cancelOffer: (offerId: string) => Promise<void>;
  executeSwapAsInitiator: (swapId: string, passphrase: string) => Promise<void>;
  fundDgbHtlc: (swapId: string) => Promise<void>;
  claimFromDgbHtlc: (swapId: string) => Promise<void>;
  claimFromHnsHtlc: (swapId: string) => Promise<void>;
  rebroadcastHnsClaim: (swapId: string) => Promise<void>;
  refundHnsHtlc: (swapId: string) => Promise<void>;
  refundDgbHtlc: (swapId: string) => Promise<void>;
  startMonitor: () => Promise<void>;
  stopMonitor: () => Promise<void>;
  handleSwapUpdate: (swap: LocalSwap) => void;
  loadDgbConfig: () => Promise<void>;
  clearError: () => void;
}

export const useSwapStore = create<SwapStore>((set, get) => ({
  dgbConnected: false,
  dgbAddress: '',
  dgbBalance: { confirmed: 0, unconfirmed: 0 },
  dgbServerConfig: null,
  activeOffers: [],
  mySwaps: [],
  mySwapOffers: [],
  autoComplete: false,
  loading: false,
  error: null,

  connectDgb: async (config) => {
    set({ loading: true, error: null });
    try {
      await window.api.dgb.connect(config.host, config.port, config.ssl, config.network);
      await window.api.dgb.saveConfig(config);
      set({ dgbConnected: true, dgbServerConfig: config, loading: false });
      await get().fetchDgbAddress();
      await get().fetchDgbBalance();
    } catch (err) {
      set({
        loading: false,
        dgbConnected: false,
        dgbAddress: '',
        dgbBalance: { confirmed: 0, unconfirmed: 0 },
        error: `Failed to connect to DGB: ${err}`,
      });
      throw err;
    }
  },

  disconnectDgb: async () => {
    try {
      await window.api.dgb.disconnect();
      set({
        dgbConnected: false,
        dgbAddress: '',
        dgbBalance: { confirmed: 0, unconfirmed: 0 },
      });
    } catch (err) {
      set({ error: `Failed to disconnect: ${err}` });
    }
  },

  refreshDgbConnection: async () => {
    const config = get().dgbServerConfig ?? await window.api.dgb.getConfig();
    if (!config) {
      const message = 'No DGB server is configured.';
      set({ error: message });
      throw new Error(message);
    }
    await get().connectDgb(config);
    await get().fetchActiveOffers();
    await get().fetchMySwaps();
  },

  loadAutoComplete: async () => {
    try {
      const value = await window.api.config.get('swapAutoComplete');
      set({ autoComplete: value === '1' });
    } catch { /* keep the default off state */ }
  },

  setAutoComplete: async (enabled) => {
    const previous = get().autoComplete;
    set({ autoComplete: enabled, error: null });
    try {
      await window.api.config.set('swapAutoComplete', enabled ? '1' : '0');
    } catch (err) {
      set({ autoComplete: previous, error: `Failed to save auto-complete setting: ${err}` });
      throw err;
    }
  },

  setSwapAutoComplete: async (swapId, enabled) => {
    try {
      await window.api.swap.setAutoComplete(swapId, enabled);
      await get().fetchMySwaps();
    } catch (err) {
      set({ error: `Failed to update auto-complete: ${err}` });
      throw err;
    }
  },

  refreshDgbStatus: async () => {
    try {
      const status = await window.api.dgb.getStatus();
      if (!status.connected) {
        set({
          dgbConnected: false,
          dgbAddress: '',
          dgbBalance: { confirmed: 0, unconfirmed: 0 },
        });
        return;
      }
      const previous = get().dgbServerConfig;
      set({
        dgbConnected: true,
        dgbServerConfig: previous
          ? {
              ...previous,
              host: status.host,
              port: status.port,
              network: status.network,
            }
          : {
              host: status.host,
              port: status.port,
              ssl: false,
              network: status.network,
            },
      });
      await get().fetchDgbAddress();
      await get().fetchDgbBalance();
    } catch {
      // Leave the last known state if the status query fails.
    }
  },

  fetchDgbAddress: async () => {
    try {
      const addr = await window.api.dgb.getAddress();
      set({ dgbAddress: addr });
    } catch { /* ignore */ }
  },

  fetchDgbBalance: async () => {
    const { dgbAddress } = get();
    if (!dgbAddress) return;
    try {
      const balance = await window.api.dgb.getBalance(dgbAddress);
      set({ dgbBalance: balance });
    } catch { /* ignore */ }
  },

  loadDgbConfig: async () => {
    try {
      const config = await window.api.dgb.getConfig();
      if (config) set({ dgbServerConfig: config });
    } catch { /* ignore */ }
  },

  fetchActiveOffers: async () => {
    try {
      const offers = await window.api.swap.fetchActiveOffers();
      set({ activeOffers: offers });
    } catch { /* ignore */ }
  },

  fetchMySwaps: async () => {
    try {
      const [swaps, offers] = await Promise.all([
        window.api.swap.getMySwaps(),
        window.api.swap.getMySwapOffers(),
      ]);
      set({ mySwaps: swaps, mySwapOffers: offers });
    } catch { /* ignore */ }
  },

  publishOffer: async (offer) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.publishOffer(offer);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to publish offer: ${err}` });
      throw err;
    }
  },

  acceptOffer: async (offer) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.acceptOffer(offer);
      await get().fetchMySwaps();
      set(state => ({
        loading: false,
        activeOffers: state.activeOffers.filter(item => item.id !== offer.id),
      }));
    } catch (err) {
      set({ loading: false, error: `Failed to accept offer: ${err}` });
      throw err;
    }
  },

  cancelOffer: async (offerId) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.cancelOffer(offerId);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to cancel offer: ${err}` });
      throw err;
    }
  },

  executeSwapAsInitiator: async (swapId, passphrase) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.executeSwapAsInitiator(swapId, passphrase);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to start swap: ${err}` });
    }
  },

  fundDgbHtlc: async (swapId) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.fundDgbHtlc(swapId);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to fund DGB HTLC: ${err}` });
    }
  },

  claimFromDgbHtlc: async (swapId) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.claimFromDgbHtlc(swapId);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to claim DGB: ${err}` });
    }
  },

  claimFromHnsHtlc: async (swapId) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.claimFromHnsHtlc(swapId);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to claim HNS: ${err}` });
    }
  },

  rebroadcastHnsClaim: async (swapId) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.rebroadcastHnsClaim(swapId);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to rebroadcast HNS claim: ${err}` });
    }
  },

  refundHnsHtlc: async (swapId) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.refundHnsHtlc(swapId);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to refund HNS: ${err}` });
    }
  },

  refundDgbHtlc: async (swapId) => {
    set({ loading: true, error: null });
    try {
      await window.api.swap.refundDgbHtlc(swapId);
      await get().fetchMySwaps();
      set({ loading: false });
    } catch (err) {
      set({ loading: false, error: `Failed to refund DGB: ${err}` });
    }
  },

  startMonitor: async () => {
    try {
      await window.api.swap.startMonitor();
    } catch { /* ignore */ }
  },

  stopMonitor: async () => {
    try {
      await window.api.swap.stopMonitor();
    } catch { /* ignore */ }
  },

  handleSwapUpdate: (swap) => {
    set(state => {
      const exists = state.mySwaps.some(item => item.id === swap.id);
      return {
        mySwaps: exists
          ? state.mySwaps.map(item => item.id === swap.id ? swap : item)
          : [swap, ...state.mySwaps],
      };
    });
  },

  clearError: () => set({ error: null }),
}));
