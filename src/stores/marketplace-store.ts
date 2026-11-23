import { create } from 'zustand';
import type {
  MarketplaceListing,
  CreateListingInput,
  PurchaseIntent,
  TransferStatus,
} from '../types/marketplace';

interface MarketplaceStore {
  myListings: MarketplaceListing[];
  offers: MarketplaceListing[];
  purchaseRequests: PurchaseIntent[];
  myPurchases: PurchaseIntent[];
  isLoading: boolean;
  error: string | null;

  fetchMyListings: () => Promise<void>;
  fetchOffers: (includeOwn?: boolean) => Promise<void>;
  fetchPurchaseRequests: () => Promise<void>;
  fetchMyPurchases: () => Promise<void>;
  createListing: (input: CreateListingInput, passphrase: string) => Promise<MarketplaceListing>;
  cancelListing: (name: string, passphrase: string) => Promise<void>;
  republishListing: (name: string, price: number, passphrase: string) => Promise<MarketplaceListing>;
  requestPurchase: (listing: MarketplaceListing, buyerAddr: string, useEscrow?: boolean) => Promise<PurchaseIntent>;
  getEscrowFundingStatus: (intentId: string) => Promise<{ funded: boolean; value: number; vout: number; confirmations: number; address: string; amount: number }>;
  fundEscrow: (intentId: string, passphrase: string) => Promise<{ txHash: string; address: string; amount: number }>;
  createEscrowRelease: (intentId: string) => Promise<{ psbt: string; role: 'buyer' | 'seller' }>;
  signEscrowRelease: (intentId: string) => Promise<{ txId: string }>;
  createEscrowDisputePsbt: (intentId: string, kind: 'refund' | 'release') => Promise<{ psbt: string; kind: 'refund' | 'release' }>;
  importEscrowArbiterPsbt: (intentId: string, psbt: string) => Promise<{ txId: string }>;
  checkTransferStatus: (name: string, buyerAddr: string, transferTxHash?: string) => Promise<TransferStatus>;
  confirmAndPay: (intentId: string, passphrase: string) => Promise<{ txHash: string; fee: number }>;
  finalizePurchase: (intentId: string, passphrase: string) => Promise<{ txHash: string }>;
  approvePurchase: (name: string, buyerAddr: string, passphrase: string) => Promise<{ txHash: string }>;
  rejectPurchase: (name: string, buyerAddr: string) => Promise<void>;
  dismissPurchaseRequest: (name: string, buyerAddr: string) => Promise<void>;
  verifyListing: (listing: MarketplaceListing) => Promise<boolean>;
}

function intentKey(intent: PurchaseIntent): string {
  return intent.intentId || `${intent.buyerPubKey || ''}:${intent.name}:${intent.buyerAddr}`;
}

export const useMarketplaceStore = create<MarketplaceStore>((set) => ({
  myListings: [],
  offers: [],
  purchaseRequests: [],
  myPurchases: [],
  isLoading: false,
  error: null,

  fetchMyListings: async () => {
    set({ isLoading: true });
    try {
      const listings = await window.api.marketplace.getMyListings();
      set({ myListings: listings, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchOffers: async (includeOwn = false) => {
    set({ isLoading: true });
    try {
      const offers = await window.api.marketplace.getOffers(includeOwn);
      set({ offers, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchPurchaseRequests: async () => {
    try {
      const requests = await window.api.marketplace.getPurchaseRequests();
      set({ purchaseRequests: requests });
    } catch {
      // silent
    }
  },

  fetchMyPurchases: async () => {
    try {
      const purchases = await window.api.marketplace.getMyPurchases();
      set({ myPurchases: purchases });
    } catch {
      // silent
    }
  },

  createListing: async (input, passphrase) => {
    const listing = await window.api.marketplace.createListing(input, passphrase);
    set((state) => ({ myListings: [...state.myListings, listing] }));
    return listing;
  },

  cancelListing: async (name, passphrase) => {
    await window.api.marketplace.cancelListing(name, passphrase);
    set((state) => ({
      myListings: state.myListings.filter((l) => l.name !== name),
    }));
  },

  republishListing: async (name, price, passphrase) => {
    const listing = await window.api.marketplace.republishListing(name, price, passphrase);
    set((state) => ({
      myListings: state.myListings.map((l) => (l.name === name ? listing : l)),
    }));
    return listing;
  },

  requestPurchase: async (listing, buyerAddr, useEscrow = false) => {
    const intent = await window.api.marketplace.requestPurchase(listing, buyerAddr, useEscrow);
    set((state) => {
      const key = intentKey(intent);
      return {
        myPurchases: [
          intent,
          ...state.myPurchases.filter((i) => intentKey(i) !== key),
        ],
      };
    });
    return intent;
  },

  getEscrowFundingStatus: async (intentId) => {
    return await window.api.marketplace.getEscrowFundingStatus(intentId);
  },

  fundEscrow: async (intentId, passphrase) => {
    const result = await window.api.marketplace.fundEscrow(intentId, passphrase);
    set((state) => ({
      myPurchases: state.myPurchases.map((intent) =>
        intentKey(intent) === intentId && intent.escrow
          ? {
              ...intent,
              escrow: {
                ...intent.escrow,
                fundingTxHash: result.txHash,
                state: 'funded',
              },
              updatedAt: new Date().toISOString(),
            }
          : intent,
      ),
    }));
    return result;
  },

  createEscrowRelease: async (intentId) => {
    const result = await window.api.marketplace.createEscrowRelease(intentId);
    set((state) => ({
      myPurchases: state.myPurchases.map((intent) =>
        intentKey(intent) === intentId && intent.escrow
          ? {
              ...intent,
              escrow: {
                ...intent.escrow,
                releasePsbt: result.psbt,
                releaseRole: result.role,
              },
              updatedAt: new Date().toISOString(),
            }
          : intent,
      ),
      purchaseRequests: state.purchaseRequests.map((intent) =>
        intentKey(intent) === intentId && intent.escrow
          ? {
              ...intent,
              escrow: {
                ...intent.escrow,
                releasePsbt: result.psbt,
                releaseRole: result.role,
              },
              updatedAt: new Date().toISOString(),
            }
          : intent,
      ),
    }));
    return result;
  },

  signEscrowRelease: async (intentId) => {
    const result = await window.api.marketplace.signEscrowRelease(intentId);
    set((state) => {
      const update = (intent: PurchaseIntent): PurchaseIntent =>
        intentKey(intent) === intentId && intent.escrow
          ? {
              ...intent,
              escrow: {
                ...intent.escrow,
                state: 'released',
                releaseTxHash: result.txId,
                releasePsbt: undefined,
                releaseRole: undefined,
              },
              updatedAt: new Date().toISOString(),
            }
          : intent;
      return {
        myPurchases: state.myPurchases.map(update),
        purchaseRequests: state.purchaseRequests.map(update),
      };
    });
    return result;
  },

  createEscrowDisputePsbt: async (intentId, kind) => {
    const result = await window.api.marketplace.createEscrowDisputePsbt(intentId, kind);
    set((state) => {
      const update = (intent: PurchaseIntent): PurchaseIntent =>
        intentKey(intent) === intentId && intent.escrow
          ? {
              ...intent,
              escrow: {
                ...intent.escrow,
                state: 'disputed',
                disputePsbt: result.psbt,
                disputeKind: result.kind,
              },
              updatedAt: new Date().toISOString(),
            }
          : intent;
      return {
        myPurchases: state.myPurchases.map(update),
        purchaseRequests: state.purchaseRequests.map(update),
      };
    });
    return result;
  },

  importEscrowArbiterPsbt: async (intentId, psbt) => {
    const result = await window.api.marketplace.importEscrowArbiterPsbt(intentId, psbt);
    set((state) => {
      const update = (intent: PurchaseIntent): PurchaseIntent =>
        intentKey(intent) === intentId && intent.escrow
          ? {
              ...intent,
              escrow: {
                ...intent.escrow,
                state: intent.escrow.disputeKind === 'refund' ? 'refunded' : 'released',
                refundTxHash: intent.escrow.disputeKind === 'refund' ? result.txId : intent.escrow.refundTxHash,
                releaseTxHash: intent.escrow.disputeKind === 'release' ? result.txId : intent.escrow.releaseTxHash,
                disputePsbt: undefined,
                disputeKind: undefined,
              },
              updatedAt: new Date().toISOString(),
            }
          : intent;
      return {
        myPurchases: state.myPurchases.map(update),
        purchaseRequests: state.purchaseRequests.map(update),
      };
    });
    return result;
  },

  checkTransferStatus: async (name, buyerAddr, transferTxHash) => {
    return await window.api.marketplace.checkTransferStatus(
      name,
      buyerAddr,
      transferTxHash,
    );
  },

  confirmAndPay: async (intentId, passphrase) => {
    const result = await window.api.marketplace.confirmAndPay(intentId, passphrase);
    set((state) => ({
      myPurchases: state.myPurchases.map((intent) =>
        intentKey(intent) === intentId
          ? {
              ...intent,
              status: 'paid',
              paymentTxHash: result.txHash,
              updatedAt: new Date().toISOString(),
            }
          : intent,
      ),
    }));
    return result;
  },

  finalizePurchase: async (intentId, passphrase) => {
    const result = await window.api.marketplace.finalizePurchase(intentId, passphrase);
    set((state) => ({
      myPurchases: state.myPurchases.map((intent) =>
        intentKey(intent) === intentId
          ? {
              ...intent,
              status: 'sold',
              finalizeTxHash: result.txHash,
              updatedAt: new Date().toISOString(),
            }
          : intent,
      ),
    }));
    return result;
  },

  approvePurchase: async (name, buyerAddr, passphrase) => {
    const result = await window.api.marketplace.approvePurchase(name, buyerAddr, passphrase);
    set((state) => ({
      purchaseRequests: state.purchaseRequests.map((intent) =>
        intent.name === name && intent.buyerAddr === buyerAddr
          ? {
              ...intent,
              status: 'transferred',
              transferTxHash: result.txHash,
              updatedAt: new Date().toISOString(),
            }
          : intent,
      ),
    }));
    return result;
  },

  rejectPurchase: async (name, buyerAddr) => {
    await window.api.marketplace.rejectPurchase(name, buyerAddr);
    set((state) => ({
      purchaseRequests: state.purchaseRequests.filter(
        (r) => !(r.name === name && r.buyerAddr === buyerAddr),
      ),
    }));
  },

  dismissPurchaseRequest: async (name, buyerAddr) => {
    await window.api.marketplace.dismissPurchaseRequest(name, buyerAddr);
    set((state) => ({
      purchaseRequests: state.purchaseRequests.filter(
        (r) => !(r.name === name && r.buyerAddr === buyerAddr),
      ),
    }));
  },

  verifyListing: async (listing) => {
    return await window.api.marketplace.verifyListing(listing);
  },
}));
