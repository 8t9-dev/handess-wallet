import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useMarketplaceStore } from '../stores/marketplace-store';
import { useConnectionStore } from '../stores/connection-store';
import { formatHNS } from '../lib/name-utils';
import {
  MARKETPLACE_ARBITER_FEE,
  MARKETPLACE_ESCROW_FEE_BUFFER,
  getEscrowArbiterFee,
  isCanonicalListing,
  isEscrowListing,
  isListingExpired,
} from '../lib/marketplace-signing';
import { isValidHnsAddress } from '../lib/address-utils';
import {
  canPaySeller,
  effectivePurchaseStatus,
  shouldTrackTransfer,
} from '../lib/marketplace-purchase';
import { PassphraseModal } from '../components/common/PassphraseModal';
import { ListingDetailModal } from '../components/marketplace/ListingDetailModal';
import { EscrowTradeModal } from '../components/marketplace/EscrowTradeModal';
import { useHnsPrice } from '../hooks/useHnsPrice';
import {
  Loader2,
  Plus,
  X,
  ShoppingCart,
  Check,
  Ban,
  ArrowRight,
  XCircle,
  RefreshCw,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import type {
  MarketplaceListing,
  PurchaseIntent,
  PurchaseIntentStatus,
  TransferStatus,
  RelayHealth,
} from '../types/marketplace';
import type { Domain } from '../types/domain';

type Tab = 'sell' | 'requests' | 'purchases' | 'history' | 'buy';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active for sale',
  pending: 'Transfer in progress',
  sold: 'Sold',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  pending: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  sold: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-300',
};

const PURCHASE_STATUS_LABELS: Record<PurchaseIntentStatus, string> = {
  pending: 'Waiting for seller',
  transferred: 'Transfer detected',
  paid: 'Payment sent',
  sold: 'Completed',
  cancelled: 'Cancelled',
};

const PURCHASE_STATUS_COLORS: Record<PurchaseIntentStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  transferred: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  paid: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  sold: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-300',
};

function listingKey(listing: MarketplaceListing): string {
  return listing.listingId || listing.name;
}

/**
 * Verification is tied to the exact signed terms. A price/address change
 * produces a new signature, so it must not reuse the old "verified" cache.
 */
function verificationKey(listing: MarketplaceListing): string {
  return `${listingKey(listing)}:${listing.signature || ''}`;
}

function purchaseKey(intent: PurchaseIntent): string {
  return intent.intentId || `${intent.buyerPubKey || ''}:${intent.name}:${intent.buyerAddr}`;
}

function shortAddr(value: string): string {
  return value ? `${value.slice(0, 20)}...` : '—';
}

interface TradeHistoryRow {
  key: string;
  role: 'Bought' | 'Sold';
  name: string;
  price: number;
  counterparty: string;
  status: PurchaseIntentStatus;
  updatedAt: string;
  txHash?: string;
}

function buildHistory(
  purchases: PurchaseIntent[],
  requests: PurchaseIntent[],
): TradeHistoryRow[] {
  const rows: TradeHistoryRow[] = [];

  for (const intent of purchases) {
    if (intent.status !== 'sold' && intent.status !== 'cancelled') continue;
    rows.push({
      key: `bought:${purchaseKey(intent)}`,
      role: 'Bought',
      name: intent.name,
      price: intent.price,
      counterparty: intent.sellerAddr,
      status: intent.status,
      updatedAt: intent.updatedAt,
      txHash: intent.escrow?.releaseTxHash
        || intent.escrow?.refundTxHash
        || intent.finalizeTxHash
        || intent.paymentTxHash
        || intent.transferTxHash,
    });
  }

  for (const intent of requests) {
    if (intent.status !== 'sold' && intent.status !== 'cancelled') continue;
    rows.push({
      key: `sold:${purchaseKey(intent)}`,
      role: 'Sold',
      name: intent.name,
      price: intent.price,
      counterparty: intent.buyerAddr,
      status: intent.status,
      updatedAt: intent.updatedAt,
      txHash: intent.escrow?.releaseTxHash
        || intent.escrow?.refundTxHash
        || intent.finalizeTxHash
        || intent.paymentTxHash
        || intent.transferTxHash,
    });
  }

  return rows.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function formatLockup(status?: TransferStatus): string {
  if (status?.finalized) return 'Transfer finalized.';
  if (status?.cancelled) return 'Seller cancelled the transfer.';
  if (!status?.transferred) return 'Waiting for on-chain transfer…';
  const blocks = status.blocksRemaining ?? 0;
  if (blocks <= 0) return 'Lockup complete — finalize now.';
  const minutes = status.estimatedMinutesRemaining ?? blocks * 10;
  const hours = Math.floor(minutes / 60);
  const time = hours >= 24 ? `${Math.ceil(hours / 24)} days` : `${Math.max(1, hours)} hours`;
  return `${blocks} blocks remaining (~${time}).`;
}

type BuyStep =
  | 'enter_address'
  | 'submitted'
  | 'transfer_detected'
  | 'paid'
  | 'completed';

type BuyFlow = {
  listing: MarketplaceListing;
  intent?: PurchaseIntent;
  buyerAddr: string;
  step: BuyStep;
  txHash?: string;
  fee?: number;
  useEscrow?: boolean;
};

type ActionTarget = {
  intent: PurchaseIntent;
  action: 'pay' | 'finalize';
};

export function Marketplace() {
  const { connectionState, walletInfo } = useConnectionStore();
  const {
    myListings,
    offers,
    purchaseRequests,
    myPurchases,
    fetchMyListings,
    fetchOffers,
    fetchPurchaseRequests,
    fetchMyPurchases,
    cancelListing,
    republishListing,
    requestPurchase,
    checkTransferStatus,
    confirmAndPay,
    finalizePurchase,
    approvePurchase,
    rejectPurchase,
    verifyListing,
    getEscrowFundingStatus,
    isLoading,
  } = useMarketplaceStore();

  const walletEncrypted = walletInfo?.master?.encrypted ?? false;
  const walletUnlocked = (walletInfo?.master?.until ?? 0) > Math.floor(Date.now() / 1000);
  const needsPassphrase = walletEncrypted && !walletUnlocked;
  const { price: hnsUsd } = useHnsPrice();

  const [activeTab, setActiveTab] = useState<Tab>('sell');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPrice, setCreatePrice] = useState('');
  const [createSellerAddr, setCreateSellerAddr] = useState('');
  const [createPassphrase, setCreatePassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [buyFlow, setBuyFlow] = useState<BuyFlow | null>(null);
  const [ownedNames, setOwnedNames] = useState<Domain[]>([]);
  const [approveTarget, setApproveTarget] = useState<{ name: string; buyerAddr: string } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<
    { type: 'cancel'; name: string } | { type: 'reject'; name: string; buyerAddr: string } | null
  >(null);
  const [approvePassphrase, setApprovePassphrase] = useState('');
  const [editTarget, setEditTarget] = useState<MarketplaceListing | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editPassphrase, setEditPassphrase] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOwnListings, setShowOwnListings] = useState(false);
  const [nostrPubKey, setNostrPubKey] = useState('');
  const [verifyingMap, setVerifyingMap] = useState<Record<string, boolean>>({});
  const [verifiedMap, setVerifiedMap] = useState<Record<string, boolean>>({});
  const [transferStatus, setTransferStatus] = useState<Record<string, TransferStatus>>({});
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [relayHealth, setRelayHealth] = useState<RelayHealth[] | null>(null);
  const [relayTesting, setRelayTesting] = useState(false);
  const [detailTarget, setDetailTarget] = useState<MarketplaceListing | null>(null);
  const [escrowTarget, setEscrowTarget] = useState<PurchaseIntent | null>(null);
  const [sellerEscrowArbiter, setSellerEscrowArbiter] = useState('');
  const [sellerEscrowArbiterPayout, setSellerEscrowArbiterPayout] = useState('');
  const [escrowFunding, setEscrowFunding] = useState<Record<string, { funded: boolean; confirmations: number }>>({});

  const buyFlowRef = useRef<BuyFlow | null>(null);
  buyFlowRef.current = buyFlow;
  const activeIntentKey = buyFlow?.intent ? purchaseKey(buyFlow.intent) : null;
  const activeBuyStep = buyFlow?.step;

  useEffect(() => {
    fetchMyListings();
    fetchOffers();
    fetchPurchaseRequests();
    fetchMyPurchases();
    window.api.marketplace.getNostrPubkey().then(setNostrPubKey).catch(() => {});
    window.api.config.get('marketplaceEscrowArbiter')
      .then((value) => setSellerEscrowArbiter(value || ''))
      .catch(() => {});
    window.api.config.get('marketplaceEscrowArbiterPayoutAddress')
      .then((value) => setSellerEscrowArbiterPayout(value || ''))
      .catch(() => {});
  }, [fetchMyListings, fetchOffers, fetchPurchaseRequests, fetchMyPurchases]);

  useEffect(() => {
    if (showCreateForm) {
      window.api.wallet.getNames()
        .then((domains) => setOwnedNames(domains.filter((d) => d.state === 'CLOSED')))
        .catch(() => setOwnedNames([]));
    }
  }, [showCreateForm]);

  // Refresh the active tab.
  useEffect(() => {
    const id = setInterval(() => {
      if (activeTab === 'sell') fetchMyListings();
      if (activeTab === 'requests') fetchPurchaseRequests();
      if (activeTab === 'purchases') fetchMyPurchases();
      if (activeTab === 'history') {
        fetchPurchaseRequests();
        fetchMyPurchases();
      }
      if (activeTab === 'buy') fetchOffers(showOwnListings);
    }, 10000);
    return () => clearInterval(id);
  }, [activeTab, showOwnListings, fetchMyListings, fetchOffers, fetchPurchaseRequests, fetchMyPurchases]);

  // Keep purchase statuses fresh while the buyer is on the purchases tab.
  useEffect(() => {
    if (activeTab !== 'purchases') return;

    let cancelled = false;
    const check = async () => {
      await fetchMyPurchases();
      const purchases = useMarketplaceStore.getState().myPurchases;
      for (const intent of purchases) {
        if (!shouldTrackTransfer(intent)) continue;
        const status = await checkTransferStatus(
          intent.name,
          intent.buyerAddr,
          intent.transferTxHash,
        );
        if (!cancelled) {
          setTransferStatus(prev => ({ ...prev, [purchaseKey(intent)]: status }));
        }
      }
    };

    check();
    const id = setInterval(check, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeTab, fetchMyPurchases, checkTransferStatus]);

  // Poll the active buy flow. The on-chain transfer is the source of truth.
  useEffect(() => {
    const current = buyFlowRef.current;
    const intent = current?.intent;
    if (!intent) return;
    if (activeBuyStep !== 'submitted' && activeBuyStep !== 'transfer_detected' && activeBuyStep !== 'paid') {
      return;
    }

    let cancelled = false;
    const key = activeIntentKey ?? purchaseKey(intent);

    const check = async () => {
      const flow = buyFlowRef.current;
      if (!flow?.intent) return;

      await fetchMyPurchases();
      const latest = useMarketplaceStore.getState().myPurchases
        .find(i => purchaseKey(i) === key) ?? flow.intent;

      const status = await checkTransferStatus(
        latest.name,
        latest.buyerAddr,
        latest.transferTxHash,
      );
      if (cancelled) return;

      setTransferStatus(prev => ({ ...prev, [key]: status }));

      if (status.finalized) {
        setBuyFlow(prev => prev ? { ...prev, intent: latest, step: 'completed' } : prev);
        return;
      }
      if (status.transferred && flow.step === 'submitted') {
        setBuyFlow(prev => prev ? { ...prev, intent: latest, step: 'transfer_detected' } : prev);
        setSuccess('Name transfer detected on-chain.');
        return;
      }
      if (status.cancelled && flow.step !== 'paid') {
        setBuyFlow(null);
        setError('The seller cancelled the transfer.');
      }
      if (status.cancelled && flow.step === 'paid') {
        setError('The seller cancelled the transfer after your payment. Contact the seller immediately.');
      }
    };

    check();
    const id = setInterval(check, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeIntentKey, activeBuyStep, checkTransferStatus, fetchMyPurchases]);

  // Sellers cannot approve an escrow trade until its funding is confirmed.
  useEffect(() => {
    if (activeTab !== 'requests') return;

    const pending = purchaseRequests.filter(
      (request) => request.status === 'pending' && request.escrow,
    );
    if (pending.length === 0) {
      setEscrowFunding((previous) => (Object.keys(previous).length === 0 ? previous : {}));
      return;
    }

    let cancelled = false;
    const check = async () => {
      const next: Record<string, { funded: boolean; confirmations: number }> = {};
      await Promise.all(pending.map(async (request) => {
        const key = purchaseKey(request);
        try {
          const status = await getEscrowFundingStatus(key);
          next[key] = {
            funded: status.funded,
            confirmations: status.confirmations,
          };
        } catch {
          next[key] = { funded: false, confirmations: 0 };
        }
      }));
      if (!cancelled) setEscrowFunding(next);
    };

    void check();
    const id = setInterval(check, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeTab, purchaseRequests, getEscrowFundingStatus]);

  // Load persisted verification results when offers change.
  useEffect(() => {
    const loadVerifications = async () => {
      const newVerified: Record<string, boolean> = {};
      for (const offer of offers) {
        if (offer.signature && offer.signedMessage) {
          const vkey = verificationKey(offer);
          const cached = await window.api.db.getListingVerification(vkey);
          if (cached !== undefined) newVerified[vkey] = cached;
        }
      }
      setVerifiedMap(newVerified);
    };
    loadVerifications();
  }, [offers]);

  const handleCreate = async () => {
    if (!createName.trim() || !createPrice) {
      setError('Select a name and enter a price.');
      return;
    }

    const price = Number(createPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setError('Enter a price greater than zero.');
      return;
    }
    if (createSellerAddr.trim() && !isValidHnsAddress(createSellerAddr)) {
      setError('Enter a valid Handshake seller address, or leave it blank.');
      return;
    }
    if (needsPassphrase && !createPassphrase) {
      setError('Enter your wallet passphrase.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await useMarketplaceStore.getState().createListing(
        {
          name: createName.trim(),
          price,
          sellerAddr: createSellerAddr.trim(),
        },
        createPassphrase,
      );
      setShowCreateForm(false);
      setCreateName('');
      setCreatePrice('');
      setCreatePassphrase('');
      setCreateSellerAddr('');
      setSuccess(`Listing created for ${createName.trim()}.`);
      fetchMyListings();
      fetchOffers(showOwnListings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create listing');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (name: string) => {
    setBusy(true);
    try {
      await cancelListing(name, '');
      setSuccess(`Listing cancelled for ${name}.`);
      fetchOffers(showOwnListings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRepublish = async () => {
    if (!editTarget) return;

    const price = Number(editPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setError('Enter a valid price greater than zero.');
      return;
    }
    if (needsPassphrase && !editPassphrase) {
      setError('Enter your wallet passphrase.');
      return;
    }

    setEditBusy(true);
    setError(null);
    try {
      await republishListing(editTarget.name, price, editPassphrase);
      setSuccess(`${editTarget.name} listing renewed.`);
      setEditTarget(null);
      setEditPrice('');
      setEditPassphrase('');
      fetchMyListings();
      fetchOffers(showOwnListings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to renew listing');
    } finally {
      setEditBusy(false);
    }
  };

  const handleVerify = async (offer: MarketplaceListing) => {
    const key = verificationKey(offer);
    setVerifyingMap(prev => ({ ...prev, [key]: true }));
    try {
      const result = await verifyListing(offer);
      setVerifiedMap(prev => ({ ...prev, [key]: result }));
      window.api.db.setListingVerification(key, result);
      if (!result) {
        setError('The listing ownership proof is invalid, or the seller no longer owns the name.');
      }
    } catch {
      setVerifiedMap(prev => ({ ...prev, [key]: false }));
      window.api.db.setListingVerification(key, false);
    } finally {
      setVerifyingMap(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleStartBuy = async (offer: MarketplaceListing) => {
    setError(null);
    if (!isCanonicalListing(offer)) {
      setError('This listing is missing a full ownership proof and cannot be purchased.');
      return;
    }
    if (isListingExpired(offer)) {
      setError('This listing has expired. Ask the seller to relist it.');
      return;
    }

    const key = verificationKey(offer);
    setVerifyingMap(prev => ({ ...prev, [key]: true }));
    try {
      const valid = await verifyListing(offer);
      setVerifiedMap(prev => ({ ...prev, [key]: valid }));
      window.api.db.setListingVerification(key, valid);
      if (!valid) {
        setError('The seller ownership proof is invalid, or the name is no longer for sale.');
        return;
      }
      setBuyFlow({
        listing: offer,
        buyerAddr: '',
        step: 'enter_address',
        useEscrow: isEscrowListing(offer),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify this listing.');
    } finally {
      setVerifyingMap(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleTestRelays = async () => {
    setRelayTesting(true);
    try {
      setRelayHealth(await window.api.marketplace.testRelays());
    } catch (err) {
      setRelayHealth([{
        url: 'configured relays',
        ok: false,
        error: err instanceof Error ? err.message : 'Relay test failed',
      }]);
    } finally {
      setRelayTesting(false);
    }
  };

  const handleUseMyAddress = async () => {
    if (!buyFlow) return;
    try {
      const { address } = await window.api.wallet.getAddress();
      setBuyFlow({ ...buyFlow, buyerAddr: address });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get a wallet address.');
    }
  };

  const handleSubmitRequest = async () => {
    if (!buyFlow) return;
    if (!isValidHnsAddress(buyFlow.buyerAddr)) {
      setError('Enter a valid Handshake receiving address.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const intent = await requestPurchase(
        buyFlow.listing,
        buyFlow.buyerAddr.trim(),
        buyFlow.useEscrow === true,
      );
      setBuyFlow({ ...buyFlow, buyerAddr: buyFlow.buyerAddr.trim(), intent, step: 'submitted' });
      setSuccess(
        intent.escrow
          ? 'Purchase request sent. Fund the escrow from My Purchases.'
          : 'Purchase request sent. Track it in My Purchases.',
      );
      fetchMyPurchases();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit purchase request');
    } finally {
      setBusy(false);
    }
  };

  const requestPay = (intent: PurchaseIntent) => {
    const status = transferStatus[purchaseKey(intent)];
    if (status?.cancelled) {
      setError('The seller cancelled the transfer.');
      return;
    }
    if (!status?.transferred && !status?.finalized) {
      setError(
        'The name transfer has not been detected on-chain yet. Wait for it to confirm, then try again.',
      );
      return;
    }
    if (needsPassphrase) {
      setActionTarget({ intent, action: 'pay' });
    } else {
      void doPay({ intent, action: 'pay' }, '');
    }
  };

  const requestFinalize = (intent: PurchaseIntent) => {
    if (needsPassphrase) {
      setActionTarget({ intent, action: 'finalize' });
    } else {
      void doFinalize({ intent, action: 'finalize' }, '');
    }
  };

  const doPay = async (target: ActionTarget, passphrase: string) => {
    setActionTarget(null);
    setBusy(true);
    setError(null);
    try {
      const result = await confirmAndPay(purchaseKey(target.intent), passphrase);
      setBuyFlow(prev => prev && prev.intent && purchaseKey(prev.intent) === purchaseKey(target.intent)
        ? { ...prev, step: 'paid', txHash: result.txHash, fee: result.fee }
        : prev);
      setSuccess(`Payment sent. Network fee: ${formatHNS(result.fee)}.`);
      fetchMyPurchases();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed';
      setError(msg);
      if (/locked/i.test(msg)) setActionTarget(target);
    } finally {
      setBusy(false);
    }
  };

  const doFinalize = async (target: ActionTarget, passphrase: string) => {
    setActionTarget(null);
    setBusy(true);
    setError(null);
    try {
      const result = await finalizePurchase(purchaseKey(target.intent), passphrase);
      setBuyFlow(prev => prev && prev.intent && purchaseKey(prev.intent) === purchaseKey(target.intent)
        ? { ...prev, step: 'completed', txHash: result.txHash }
        : prev);
      setSuccess('Name finalized and claimed.');
      fetchMyPurchases();
      fetchOffers(showOwnListings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Finalization failed';
      setError(msg);
      if (/locked/i.test(msg)) setActionTarget(target);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (name: string, buyerAddr: string) => {
    if (walletEncrypted && !walletUnlocked && !approvePassphrase) {
      setError('Enter your wallet passphrase to approve.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await approvePurchase(name, buyerAddr, approvePassphrase);
      setSuccess(`Transfer initiated for ${name}. TX: ${result.txHash.slice(0, 16)}...`);
      setApproveTarget(null);
      setApprovePassphrase('');
      fetchPurchaseRequests();
      fetchMyListings();
      fetchOffers(showOwnListings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (name: string, buyerAddr: string) => {
    setBusy(true);
    try {
      await rejectPurchase(name, buyerAddr);
      setSuccess(`Purchase request rejected for ${name}.`);
      fetchPurchaseRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setBusy(false);
    }
  };

  if (connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Connect to your Handshake node to access the marketplace.
        </p>
        <Link
          to="/settings"
          className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors"
        >
          Go to Settings
        </Link>
      </div>
    );
  }

  const pendingRequestCount = purchaseRequests.filter(r => r.status === 'pending').length;
  const activePurchaseCount = myPurchases.filter(
    p => p.status === 'pending' || p.status === 'transferred' || p.status === 'paid',
  ).length;
  const approveRequest = approveTarget
    ? purchaseRequests.find(
      r => r.name === approveTarget.name && r.buyerAddr === approveTarget.buyerAddr,
    ) || null
    : null;
  const approveEscrowFunding = approveRequest?.escrow
    ? escrowFunding[purchaseKey(approveRequest)]
    : undefined;
  const approveEscrowReady = Boolean(
    approveRequest?.escrow
    && approveEscrowFunding?.funded
    && approveEscrowFunding.confirmations >= 1,
  );
  const escrowRole = escrowTarget && nostrPubKey
    ? escrowTarget.buyerPubKey === nostrPubKey
      ? 'buyer'
      : escrowTarget.sellerPubKey === nostrPubKey
        ? 'seller'
        : null
    : null;
  const buyEscrowFee = buyFlow ? getEscrowArbiterFee(buyFlow.listing) : 0;
  const history = buildHistory(myPurchases, purchaseRequests);
  const completedSales = history.filter(r => r.role === 'Sold' && r.status === 'sold').length;
  const completedPurchases = history.filter(r => r.role === 'Bought' && r.status === 'sold').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Marketplace</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Peer-to-peer Handshake name trading over Nostr relays
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (activeTab === 'buy') fetchOffers(showOwnListings);
              else if (activeTab === 'requests') fetchPurchaseRequests();
              else if (activeTab === 'purchases') fetchMyPurchases();
              else if (activeTab === 'history') {
                fetchPurchaseRequests();
                fetchMyPurchases();
              } else fetchMyListings();
            }}
            className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {activeTab === 'sell' && (
            <button
              onClick={() => { setShowCreateForm(true); setError(null); }}
              className="flex items-center gap-2 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700"
            >
              <Plus className="w-4 h-4" /> List for Sale
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          <button onClick={() => setActiveTab('sell')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'sell' ? 'border-hns-600 text-hns-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}>
            My Listings
            {myListings.length > 0 && <span className="ml-2 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-xs">{myListings.length}</span>}
          </button>
          <button onClick={() => setActiveTab('requests')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'requests' ? 'border-hns-600 text-hns-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}>
            Purchase Requests
            {pendingRequestCount > 0 && <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">{pendingRequestCount}</span>}
          </button>
          <button onClick={() => setActiveTab('purchases')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'purchases' ? 'border-hns-600 text-hns-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}>
            My Purchases
            {activePurchaseCount > 0 && <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">{activePurchaseCount}</span>}
          </button>
          <button onClick={() => setActiveTab('history')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'history' ? 'border-hns-600 text-hns-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}>
            History
            {history.length > 0 && <span className="ml-2 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-xs">{history.length}</span>}
          </button>
          <button onClick={() => setActiveTab('buy')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'buy' ? 'border-hns-600 text-hns-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}>
            Buy Names
            {offers.length > 0 && <span className="ml-2 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-xs">{offers.length}</span>}
          </button>
        </nav>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70">&times;</button>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Check className="w-4 h-4" /> {success}</span>
          <button onClick={() => setSuccess(null)} className="ml-2 hover:opacity-70">&times;</button>
        </div>
      )}

      {/* CREATE LISTING MODAL */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">List Name for Sale</h3>
              <button onClick={() => setShowCreateForm(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500">
              Your listing, price, and payout address are signed with the name&apos;s owner key and published to Nostr relays.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <select value={createName} onChange={e => setCreateName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500">
                <option value="">-- Select a name --</option>
                {ownedNames.map(d => (
                  <option key={d.name} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Price (HNS) *</label>
              <input type="number" value={createPrice} onChange={e => setCreatePrice(e.target.value)} min="0" step="0.01"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500" placeholder="100" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Seller Address (optional)</label>
              <input type="text" value={createSellerAddr} onChange={e => setCreateSellerAddr(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-sm" placeholder="Leave empty to use your wallet's receiving address" />
            </div>
            <p className="text-xs text-gray-400">
              Your contact info from Settings is attached to the listing and is public on Nostr relays.
            </p>
            {sellerEscrowArbiter && sellerEscrowArbiterPayout ? (
              <div className="p-3 rounded-lg bg-hns-50 dark:bg-hns-900/20 text-hns-800 dark:text-hns-200 text-xs leading-relaxed space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="w-4 h-4" />
                  2-of-3 escrow will be offered
                </div>
                <p>
                  Buyers fund the price plus {formatHNS(MARKETPLACE_ARBITER_FEE)} arbitration fee and{' '}
                  {formatHNS(MARKETPLACE_ESCROW_FEE_BUFFER)} network fee. On a normal release the
                  arbitration fee is returned to the buyer; on a dispute it goes to the arbiter. The
                  seller still receives the full listed price.
                </p>
                <p className="font-mono text-[10px] break-all text-gray-500 dark:text-gray-400">
                  Arbiter: {sellerEscrowArbiter}
                </p>
                <p className="font-mono text-[10px] break-all text-gray-500 dark:text-gray-400">
                  Arbiter payout: {sellerEscrowArbiterPayout}
                </p>
              </div>
            ) : sellerEscrowArbiter ? (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs leading-relaxed">
                <strong>Arbiter payout address missing.</strong> Add the arbiter&apos;s HNS payout
                address in Settings before creating an escrow listing.
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs leading-relaxed">
                <strong>Transfer-first listing.</strong> Set an independent escrow arbiter and payout
                address in Settings to offer optional 2-of-3 escrow to buyers.
              </div>
            )}
            {walletEncrypted && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Passphrase {needsPassphrase ? '*' : '(optional)'}
                </label>
                <input type="password" value={createPassphrase} onChange={e => setCreatePassphrase(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  placeholder={needsPassphrase ? 'Wallet passphrase' : 'Wallet is unlocked — leave blank'} />
              </div>
            )}
            <button onClick={handleCreate} disabled={busy}
              className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? 'Creating Listing...' : 'Create Listing'}
            </button>
          </div>
        </div>
      )}

      {/* RENEW / EDIT LISTING MODAL */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Renew / Edit {editTarget.name}</h3>
              <button
                onClick={() => { setEditTarget(null); setEditPassphrase(''); }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500">
              Update the price and extend the listing for another 30 days. The new terms are
              re-signed with the name&apos;s owner key and republished to relays.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">Price (HNS) *</label>
              <input
                type="number"
                value={editPrice}
                onChange={e => setEditPrice(e.target.value)}
                min="0"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            </div>
            <p className="text-xs text-gray-400">
              Payout address: <span className="font-mono">{shortAddr(editTarget.sellerAddr)}</span>
            </p>
            {walletEncrypted && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Passphrase {needsPassphrase ? '*' : '(optional)'}
                </label>
                <input
                  type="password"
                  value={editPassphrase}
                  onChange={e => setEditPassphrase(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  placeholder={needsPassphrase ? 'Wallet passphrase' : 'Wallet is unlocked — leave blank'}
                />
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => { setEditTarget(null); setEditPassphrase(''); }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleRepublish}
                disabled={editBusy}
                className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {editBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                {editBusy ? 'Publishing...' : 'Save & Renew'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BUY FLOW MODAL */}
      {buyFlow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Buy {buyFlow.listing.name}</h3>
              <button onClick={() => setBuyFlow(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><X className="w-5 h-5" /></button>
            </div>

            {buyFlow.step === 'enter_address' && (
              <>
                <p className="text-sm text-gray-500">
                  Price: <strong>{formatHNS(buyFlow.listing.price)}</strong>
                </p>
                {buyFlow.listing.contact && (
                  <p className="text-sm text-gray-500">
                    Contact seller: <span className="text-hns-600">{buyFlow.listing.contact}</span>
                  </p>
                )}
                {isEscrowListing(buyFlow.listing) ? (
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 p-3 rounded-lg border border-hns-200 dark:border-hns-800 bg-hns-50/50 dark:bg-hns-900/10 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={buyFlow.useEscrow === true}
                        onChange={(event) => setBuyFlow({ ...buyFlow, useEscrow: event.target.checked })}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium text-hns-700 dark:text-hns-300">
                          Use 2-of-3 escrow (recommended)
                        </span>
                        <span className="mt-1 block text-xs text-gray-600 dark:text-gray-300">
                          You fund{' '}
                          {formatHNS(
                            buyFlow.listing.price
                            + buyEscrowFee
                            + MARKETPLACE_ESCROW_FEE_BUFFER,
                          )}{' '}
                          into a multisig address controlled by you, the seller, and an independent
                          arbiter. The seller transfers only after funding confirms, and the funds
                          release only after you finalize the name transfer.
                        </span>
                        {buyEscrowFee > 0 && (
                          <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                            Includes a {formatHNS(buyEscrowFee)} arbitration fee, returned to you if
                            the seller delivers and you finalize. It goes to the arbiter only if the
                            trade is disputed.
                          </span>
                        )}
                        <span className="mt-1 block break-all font-mono text-[10px] text-gray-400">
                          Arbiter: {buyFlow.listing.escrowArbiterPubKey}
                        </span>
                        {buyFlow.listing.escrowArbiterPayoutAddress && (
                          <span className="mt-1 block break-all font-mono text-[10px] text-gray-400">
                            Arbiter payout: {buyFlow.listing.escrowArbiterPayoutAddress}
                          </span>
                        )}
                      </span>
                    </label>
                    {!buyFlow.useEscrow && (
                      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs leading-relaxed">
                        <strong>Transfer-first trade, not trustless escrow.</strong> The seller transfers the
                        name first. After the transfer is detected and the ~2-day lockup ends, you pay and
                        finalize. The seller can cancel the transfer before you finalize. The chain does not
                        enforce the payment amount, so a modified client could underpay. Only trade with
                        sellers you trust.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs leading-relaxed">
                    <strong>Transfer-first trade, not trustless escrow.</strong> The seller transfers the name
                    first. After the transfer is detected and the ~2-day lockup ends, you pay and finalize. The
                    seller can cancel the transfer before you finalize. The chain does not enforce the payment
                    amount, so a modified client could underpay. Only trade with sellers you trust.
                  </div>
                )}
                <p className="text-xs text-gray-400">
                  Purchase details are encrypted to the seller with NIP-44 before they are published.
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1">Your Receiving Address *</label>
                  <div className="flex gap-2">
                    <input type="text" value={buyFlow.buyerAddr} onChange={e => setBuyFlow({ ...buyFlow, buyerAddr: e.target.value })}
                      className="flex-1 px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 font-mono text-sm"
                      placeholder="hs1q..." />
                    <button onClick={handleUseMyAddress}
                      className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                      Use mine
                    </button>
                  </div>
                </div>
                <button onClick={handleSubmitRequest} disabled={busy || !buyFlow.buyerAddr}
                  className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Submit Purchase Request
                </button>
              </>
            )}

            {buyFlow.step === 'submitted' && (
              buyFlow.intent?.escrow ? (
                <div className="text-center py-4 space-y-3">
                  <ShieldCheck className="w-8 h-8 mx-auto text-hns-600" />
                  <p className="font-medium">Escrow request sent</p>
                  <p className="text-sm text-gray-500">
                    Fund the escrow so the seller can start the transfer. Your HNS stays in the 2-of-3
                    address until you finalize the name, or until you and the arbiter resolve a dispute.
                  </p>
                  <button
                    onClick={() => setEscrowTarget(buyFlow.intent!)}
                    className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 flex items-center justify-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Fund / Manage Escrow
                  </button>
                  <p className="text-xs text-gray-400">
                    This modal auto-detects the transfer. You can also close it and track the purchase in My
                    Purchases.
                  </p>
                </div>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-hns-600" />
                  <p className="font-medium">Waiting for seller...</p>
                  <p className="text-sm text-gray-500">
                    Your request was published. The seller needs to initiate the name transfer to your address.
                  </p>
                  <p className="text-xs text-gray-400">
                    This modal auto-detects the transfer. You can also close it and track the purchase in My Purchases.
                  </p>
                  <button
                    onClick={() => { setBuyFlow(null); setActiveTab('purchases'); }}
                    className="text-sm text-hns-600 underline"
                  >
                    View My Purchases
                  </button>
                </div>
              )
            )}

            {buyFlow.step === 'transfer_detected' && buyFlow.intent && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 text-sm flex items-center gap-2">
                  <Check className="w-4 h-4" /> Transfer detected on-chain!
                </div>
                {buyFlow.intent.escrow ? (
                  <p className="text-sm text-gray-500">
                    The seller is transferring <strong>{buyFlow.listing.name}</strong> to your address. Your
                    escrow funding is held in the 2-of-3 address. Finalize after the lockup to claim the name;
                    the escrow releases to the seller only after finalization.
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">
                    The seller is transferring <strong>{buyFlow.listing.name}</strong> to your address.
                    Send <strong>{formatHNS(buyFlow.listing.price)}</strong> to complete the purchase.
                  </p>
                )}
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-xs text-gray-600 dark:text-gray-300 flex items-start gap-2">
                  <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {formatLockup(transferStatus[purchaseKey(buyFlow.intent)])}
                </div>
                {buyFlow.intent.escrow ? (
                  <div className="space-y-2">
                    <button onClick={() => requestFinalize(buyFlow.intent!)} disabled={busy || (transferStatus[purchaseKey(buyFlow.intent)]?.blocksRemaining ?? 1) > 0}
                      className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                      Finalize &amp; Claim Name
                    </button>
                    <button onClick={() => setEscrowTarget(buyFlow.intent!)}
                      className="w-full py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm flex items-center justify-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      Manage Escrow
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      You can pay now, but the seller can still cancel until you finalize. Waiting until the
                      lockup ends reduces the window, but does not remove the trust requirement.
                    </p>
                    <button onClick={() => requestPay(buyFlow.intent!)} disabled={busy}
                      className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                      Send {formatHNS(buyFlow.listing.price)}
                    </button>
                  </>
                )}
              </div>
            )}

            {buyFlow.step === 'paid' && buyFlow.intent && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 text-sm flex items-center gap-2">
                  <Check className="w-4 h-4" /> Payment sent!
                </div>
                <p className="text-sm text-gray-500">
                  TX: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-xs">{buyFlow.txHash?.slice(0, 20)}...</code>
                </p>
                {buyFlow.fee != null && (
                  <p className="text-xs text-gray-500">Network fee: {formatHNS(buyFlow.fee)}</p>
                )}
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-xs text-gray-600 dark:text-gray-300 flex items-start gap-2">
                  <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {formatLockup(transferStatus[purchaseKey(buyFlow.intent)])}
                </div>
                <button
                  onClick={() => requestFinalize(buyFlow.intent!)}
                  disabled={busy || (transferStatus[purchaseKey(buyFlow.intent)]?.blocksRemaining ?? 1) > 0}
                  className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Finalize &amp; Claim Name
                </button>
                <button onClick={() => setBuyFlow(null)}
                  className="w-full py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
                  I&apos;ll do this later
                </button>
              </div>
            )}

            {buyFlow.step === 'completed' && (
              <div className="text-center py-4 space-y-3">
                <Check className="w-8 h-8 mx-auto text-green-600" />
                <p className="font-medium text-green-700">Purchase Complete!</p>
                <p className="text-sm text-gray-500">
                  {buyFlow.listing.name} is now yours.
                  {buyFlow.txHash ? ` TX: ${buyFlow.txHash.slice(0, 16)}...` : ''}
                </p>
                {buyFlow.intent?.escrow && (
                  <>
                    <p className="text-xs text-gray-500">
                      The escrow still holds your funds. Release them to the seller from the escrow panel.
                    </p>
                    <button onClick={() => setEscrowTarget(buyFlow.intent!)}
                      className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 flex items-center justify-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      Release Escrow
                    </button>
                  </>
                )}
                <button onClick={() => setBuyFlow(null)}
                  className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700">Done</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* APPROVE CONFIRMATION MODAL */}
      {approveTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Approve Purchase</h3>
              <button onClick={() => { setApproveTarget(null); setApprovePassphrase(''); }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500">
              Initiate transfer of <strong>{approveTarget.name}</strong> to <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-xs">{shortAddr(approveTarget.buyerAddr)}</code>
            </p>
            {approveRequest?.escrow ? (
              <div className="space-y-2">
                <div className="p-3 rounded-lg bg-hns-50 dark:bg-hns-900/20 text-hns-800 dark:text-hns-200 text-xs leading-relaxed">
                  <strong>2-of-3 escrow trade.</strong> The buyer funded the escrow with the independent
                  arbiter. Transfer only after the funding confirms. After the buyer finalizes the name,
                  create the release PSBT and the buyer signs it.
                </div>
                <div className={`p-3 rounded-lg text-xs ${
                  approveEscrowReady
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200'
                }`}>
                  {approveEscrowFunding
                    ? approveEscrowFunding.funded
                      ? approveEscrowFunding.confirmations >= 1
                        ? `Escrow funded and confirmed (${approveEscrowFunding.confirmations} confirmation${approveEscrowFunding.confirmations === 1 ? '' : 's'}).`
                        : 'Escrow funding detected. Waiting for one confirmation.'
                      : 'Escrow funding has not been detected yet. The buyer must fund the trade before you transfer.'
                    : 'Checking escrow funding...'}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs leading-relaxed">
                This is a transfer-first trade. The buyer pays after detecting the transfer. The buyer can
                finalize without paying, and you can cancel before they finalize. A modified buyer client could
                also pay less than the listed price; the chain does not enforce the payment amount. Only approve
                buyers you trust.
              </div>
            )}
            {walletEncrypted && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Passphrase {needsPassphrase ? '*' : '(optional)'}
                </label>
                <input type="password" value={approvePassphrase} onChange={e => setApprovePassphrase(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  placeholder={needsPassphrase ? 'Wallet passphrase' : 'Wallet is unlocked — leave blank'} />
              </div>
            )}
            <button onClick={() => handleApprove(approveTarget.name, approveTarget.buyerAddr)}
              disabled={busy || (needsPassphrase && !approvePassphrase) || Boolean(approveRequest?.escrow && !approveEscrowReady)}
              className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy
                ? 'Initiating Transfer...'
                : approveRequest?.escrow && !approveEscrowReady
                  ? 'Waiting for Escrow Funding'
                  : 'Initiate Transfer'}
            </button>
          </div>
        </div>
      )}

      {/* ACTION PASSPHRASE MODAL */}
      {actionTarget && (
        <PassphraseModal
          title={actionTarget.action === 'pay' ? 'Send Marketplace Payment' : 'Finalize Name'}
          onSubmit={(pwd) => {
            const target = actionTarget;
            if (actionTarget.action === 'pay') void doPay(target, pwd);
            else void doFinalize(target, pwd);
          }}
          onCancel={() => setActionTarget(null)}
        />
      )}

      {/* LISTING DETAIL MODAL */}
      {detailTarget && (
        <ListingDetailModal
          listing={detailTarget}
          verified={verifiedMap[verificationKey(detailTarget)]}
          verifying={Boolean(verifyingMap[verificationKey(detailTarget)])}
          isOwn={Boolean(nostrPubKey && detailTarget.sellerPubKey === nostrPubKey)}
          hnsUsd={hnsUsd}
          onVerify={() => handleVerify(detailTarget)}
          onBuy={() => {
            const target = detailTarget;
            setDetailTarget(null);
            void handleStartBuy(target);
          }}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {/* ESCROW MANAGEMENT MODAL */}
      {escrowTarget && escrowRole && (
        <EscrowTradeModal
          intent={escrowTarget}
          role={escrowRole}
          walletInfo={walletInfo}
          onClose={() => setEscrowTarget(null)}
          onChanged={async () => {
            await Promise.all([
              fetchMyPurchases(),
              fetchPurchaseRequests(),
              fetchMyListings(),
              fetchOffers(showOwnListings),
            ]);
          }}
        />
      )}

      {/* TAB: MY LISTINGS */}
      {activeTab === 'sell' && (
        <div className="table-container">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : myListings.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No active listings. Create one to sell a domain.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase border-b dark:border-gray-700">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Seller Address</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {myListings.map(listing => {
                  const expired = isListingExpired(listing);
                  return (
                    <tr key={listingKey(listing)} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium">
                        <button
                          onClick={() => setDetailTarget(listing)}
                          className="text-hns-600 hover:underline"
                        >
                          {listing.name}
                        </button>
                        {isEscrowListing(listing) && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-hns-100 px-2 py-0.5 text-[10px] font-medium text-hns-700 dark:bg-hns-900/30 dark:text-hns-300">
                            <ShieldCheck className="h-3 w-3" />
                            Escrow
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${expired ? 'bg-gray-100 text-gray-500' : STATUS_COLORS[listing.status] || 'bg-gray-100 text-gray-700'}`}>
                          {expired ? 'Expired' : STATUS_LABELS[listing.status] || listing.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-hns-600">{formatHNS(listing.price)}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{shortAddr(listing.sellerAddr)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {listing.expiresAt ? new Date(listing.expiresAt).toLocaleDateString() : 'Legacy'}
                      </td>
                      <td className="px-4 py-3">
                        {(listing.status === 'active' || expired) ? (
                          <div className="flex gap-2">
                            {listing.listingId && listing.sellerPubKey ? (
                              <button
                                onClick={() => {
                                  setEditTarget(listing);
                                  setEditPrice((listing.price / 1_000_000).toString());
                                  setEditPassphrase('');
                                  setError(null);
                                }}
                                disabled={busy}
                                className="text-xs px-2.5 py-1.5 border border-hns-300 dark:border-hns-700 text-hns-700 dark:text-hns-300 rounded hover:bg-hns-50 dark:hover:bg-hns-900/20 disabled:opacity-50"
                              >
                                Renew / Edit
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setCreateName(listing.name);
                                  setCreatePrice((listing.price / 1_000_000).toString());
                                  setCreateSellerAddr('');
                                  setShowCreateForm(true);
                                  setError(null);
                                }}
                                disabled={busy}
                                className="text-xs px-2.5 py-1.5 border border-hns-300 dark:border-hns-700 text-hns-700 dark:text-hns-300 rounded hover:bg-hns-50 dark:hover:bg-hns-900/20 disabled:opacity-50"
                              >
                                Relist
                              </button>
                            )}
                            <button onClick={() => setConfirmTarget({ type: 'cancel', name: listing.name })} disabled={busy}
                              className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50">
                              <XCircle className="w-3 h-3" />{expired ? 'Remove' : 'Cancel'}
                            </button>
                          </div>
                        ) : listing.status === 'sold' ? (
                          <span className="text-xs text-purple-600 font-medium">Sold</span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="p-3 text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-b-lg">
            Listings expire after 30 days. Ownership proofs cover the name, price, payout address, seller key,
            and expiry. Legacy listings were created before full-term proofs — cancel and relist them to make
            them verifiable.
          </div>
        </div>
      )}

      {/* TAB: PURCHASE REQUESTS */}
      {activeTab === 'requests' && (
        <div className="table-container">
          {purchaseRequests.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No incoming purchase requests.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase border-b dark:border-gray-700">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {purchaseRequests.filter(req => req.status !== 'cancelled').map(req => {
                  const key = purchaseKey(req);
                  const funding = escrowFunding[key];
                  const escrowReady = Boolean(
                    req.escrow && funding?.funded && funding.confirmations >= 1,
                  );
                  return (
                    <tr key={key} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium">
                        {req.name}
                        {req.escrow && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-hns-100 px-2 py-0.5 text-[10px] font-medium text-hns-700 dark:bg-hns-900/30 dark:text-hns-300">
                            <ShieldCheck className="h-3 w-3" />
                            Escrow
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{shortAddr(req.buyerAddr)}</td>
                      <td className="px-4 py-3 font-semibold text-hns-600">
                        {formatHNS(req.price)}
                        {req.escrow && (
                          <div className="text-[10px] font-normal text-gray-400">
                            escrow {formatHNS(req.escrow.amount)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PURCHASE_STATUS_COLORS[req.status]}`}>
                          {PURCHASE_STATUS_LABELS[req.status]}
                        </span>
                        {req.escrow && req.status === 'pending' && (
                          <span className="mt-1 block text-[10px] text-gray-500">
                            {escrowReady
                              ? 'Escrow funded and confirmed'
                              : funding?.funded
                                ? 'Escrow awaiting confirmation'
                                : 'Awaiting escrow funding'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {req.escrow && (
                            <button onClick={() => setEscrowTarget(req)}
                              className="flex items-center gap-1 text-xs px-3 py-1.5 border border-hns-300 dark:border-hns-700 text-hns-700 dark:text-hns-300 rounded hover:bg-hns-50 dark:hover:bg-hns-900/20">
                              <ShieldCheck className="w-3 h-3" />
                              Manage escrow
                            </button>
                          )}
                          {req.status === 'pending' && (
                            <>
                              <button
                                onClick={() => setApproveTarget({ name: req.name, buyerAddr: req.buyerAddr })}
                                disabled={busy || Boolean(req.escrow && !escrowReady)}
                                title={req.escrow && !escrowReady ? 'Wait for confirmed escrow funding before transferring' : undefined}
                                className="flex items-center gap-1 text-xs px-3 py-1.5 bg-hns-600 text-white rounded hover:bg-hns-700 disabled:opacity-50">
                                <Check className="w-3 h-3" />
                                {req.escrow && !escrowReady ? 'Awaiting funding' : 'Approve'}
                              </button>
                              <button
                                onClick={() => setConfirmTarget({
                                  type: 'reject',
                                  name: req.name,
                                  buyerAddr: req.buyerAddr,
                                })}
                                disabled={busy || Boolean(req.escrow && funding?.funded)}
                                title={req.escrow && funding?.funded ? 'The escrow is funded; use the escrow refund or release flow' : undefined}
                                className="flex items-center gap-1 text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50">
                                <Ban className="w-3 h-3" /> Reject
                              </button>
                            </>
                          )}
                          {req.status === 'transferred' && (
                            <span className="text-xs text-blue-600">
                              {req.escrow
                                ? 'Transfer sent — waiting for buyer to finalize'
                                : 'Transfer sent — waiting for buyer'}
                            </span>
                          )}
                          {req.status === 'paid' && (
                            <span className="text-xs text-purple-600">Buyer paid — waiting for finalize</span>
                          )}
                          {req.status === 'sold' && (
                            <span className="text-xs text-green-600 font-medium">
                              {req.escrow ? 'Finalized — release escrow' : 'Completed'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="p-3 text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-b-lg">
            Approving starts the on-chain name transfer. Escrow requests stay locked until the funding is
            confirmed; transfer-first requests rely on trust after the ~2-day lockup. Purchase details are
            encrypted to your Nostr key.
          </div>
        </div>
      )}

      {/* TAB: MY PURCHASES */}
      {activeTab === 'purchases' && (
        <div className="table-container">
          {myPurchases.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No purchases yet. Browse Buy Names to find a listing.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase border-b dark:border-gray-700">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Seller</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Transfer</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {myPurchases.map(intent => {
                  const key = purchaseKey(intent);
                  const status = transferStatus[key];
                  const isEscrow = Boolean(intent.escrow);
                  const displayStatus = effectivePurchaseStatus(intent, status);
                  const payEnabled = canPaySeller(intent, status);
                  const showPay = !isEscrow
                    && (intent.status === 'pending' || intent.status === 'transferred');
                  const escrowTransferDetected = isEscrow
                    && Boolean(status?.transferred || intent.status === 'transferred');
                  const canFinalize = (intent.status === 'paid' || escrowTransferDetected)
                    && status?.finalized !== true
                    && (status?.blocksRemaining ?? 1) <= 0;
                  const showFinalize = intent.status === 'paid' || escrowTransferDetected;
                  return (
                    <tr key={key} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium">
                        {intent.name}
                        {isEscrow && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-hns-100 px-2 py-0.5 text-[10px] font-medium text-hns-700 dark:bg-hns-900/30 dark:text-hns-300">
                            <ShieldCheck className="h-3 w-3" />
                            Escrow
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-hns-600">
                        {formatHNS(intent.price)}
                        {isEscrow && intent.escrow && (
                          <div className="text-[10px] font-normal text-gray-400">
                            escrow total {formatHNS(intent.escrow.amount)}
                            {(intent.escrow.arbiterFee || 0) > 0 && (
                              <div>
                                {formatHNS(intent.escrow.arbiterFee || 0)} refundable arbitration fee
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{shortAddr(intent.sellerAddr)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PURCHASE_STATUS_COLORS[displayStatus]}`}>
                          {PURCHASE_STATUS_LABELS[displayStatus]}
                        </span>
                        {isEscrow && intent.escrow && intent.status !== 'sold' && intent.status !== 'cancelled' && (
                          <span className="mt-1 block text-[10px] text-gray-500 capitalize">
                            Escrow: {intent.escrow.state}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                        {displayStatus === 'pending'
                          ? isEscrow
                            ? intent.escrow?.state === 'created'
                              ? 'Fund the escrow to start the transfer.'
                              : 'Escrow funded — waiting for the seller to transfer.'
                            : 'Waiting for on-chain transfer…'
                          : displayStatus === 'transferred' || displayStatus === 'paid'
                            ? formatLockup(status)
                            : displayStatus === 'sold'
                              ? isEscrow
                                ? intent.escrow?.state === 'released'
                                  ? 'Finalized — escrow released'
                                  : 'Finalized — release escrow'
                                : 'Finalized'
                              : displayStatus === 'cancelled'
                                ? status?.cancelled
                                  ? 'Seller cancelled or transferred elsewhere.'
                                  : isEscrow && intent.escrow?.state === 'refunded'
                                    ? 'Cancelled — escrow refunded'
                                    : 'Cancelled'
                                : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {isEscrow && intent.escrow && (
                            <button onClick={() => setEscrowTarget(intent)} disabled={busy}
                              className="flex items-center gap-1 text-xs px-3 py-1.5 border border-hns-300 dark:border-hns-700 text-hns-700 dark:text-hns-300 rounded hover:bg-hns-50 dark:hover:bg-hns-900/20 disabled:opacity-50">
                              <ShieldCheck className="w-3 h-3" />
                              {intent.escrow.state === 'created'
                                ? 'Fund escrow'
                                : intent.status === 'sold' && intent.escrow.state !== 'released'
                                  ? 'Release escrow'
                                  : 'Manage escrow'}
                            </button>
                          )}
                          {showPay && !status?.cancelled && (
                            <button onClick={() => requestPay(intent)}
                              disabled={busy || !payEnabled}
                              title={payEnabled
                                ? 'Pay the seller'
                                : 'Waiting for the name transfer to confirm on-chain'}
                              className="text-xs px-3 py-1.5 bg-hns-600 text-white rounded hover:bg-hns-700 disabled:opacity-50">
                              {payEnabled ? 'Pay seller' : 'Waiting for transfer'}
                            </button>
                          )}
                          {!isEscrow && status?.cancelled && (
                            <span className="text-xs text-red-600">Seller cancelled</span>
                          )}
                          {showFinalize && status?.finalized !== true && (
                            <button onClick={() => requestFinalize(intent)} disabled={busy || !canFinalize}
                              className="text-xs px-3 py-1.5 bg-hns-600 text-white rounded hover:bg-hns-700 disabled:opacity-50">
                              {canFinalize ? 'Finalize' : 'Waiting for lockup'}
                            </button>
                          )}
                          {intent.status === 'sold' && (!isEscrow || intent.escrow?.state === 'released') && (
                            <span className="text-xs text-green-600 font-medium">Complete</span>
                          )}
                          {intent.status === 'cancelled' && (
                            <span className="text-xs text-gray-400">Cancelled</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="p-3 text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-b-lg">
            Transfer status is read from the Handshake chain, so payment becomes available even if a seller
            status update is missed. Transfer-first payments are not trustless: the seller can cancel before
            you finalize. Escrow trades use a 2-of-3 address with an independent arbiter and release only
            after finalization.
          </div>
        </div>
      )}

      {/* TAB: HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4">
              <div className="text-xs text-gray-500">Completed sales</div>
              <div className="text-2xl font-semibold text-hns-600">{completedSales}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-500">Completed purchases</div>
              <div className="text-2xl font-semibold text-hns-600">{completedPurchases}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-500">Total completed</div>
              <div className="text-2xl font-semibold text-hns-600">{completedSales + completedPurchases}</div>
            </div>
          </div>
          <div className="table-container">
            {history.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No completed or cancelled trades yet.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase border-b dark:border-gray-700">
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Counterparty</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(row => (
                    <tr key={row.key} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.role === 'Sold'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {row.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3 font-semibold text-hns-600">{formatHNS(row.price)}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{shortAddr(row.counterparty)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.status === 'sold'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {row.status === 'sold' ? 'Completed' : 'Cancelled'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(row.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500" title={row.txHash}>
                        {row.txHash ? `${row.txHash.slice(0, 16)}...` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="p-3 text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-b-lg">
              Local trade history on this device. Cross-party reputation is not yet available.
            </div>
          </div>
        </div>
      )}

      {/* TAB: BUY NAMES */}
      {activeTab === 'buy' && (
        <div className="table-container">
          <div className="p-3 border-b dark:border-gray-700 flex items-center gap-3">
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-800"
              placeholder="Search names..." />
            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              <input
                type="checkbox"
                checked={showOwnListings}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setShowOwnListings(checked);
                  fetchOffers(checked);
                }}
              />
              Show my listings
            </label>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading offers...
            </div>
          ) : offers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No names available for sale.
              <div className="mt-2 text-xs text-gray-400">
                Listings are broadcast over Nostr relays. If this stays empty, test your relays.
              </div>
              <div className="mt-1 text-xs text-gray-400">
                If you have listed names yourself, enable <strong>Show my listings</strong> above to preview them.
              </div>
              <button
                onClick={handleTestRelays}
                disabled={relayTesting}
                className="mt-3 px-4 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                {relayTesting ? 'Testing relays...' : 'Test relays'}
              </button>
              {relayHealth && (
                <div className="mt-3 inline-flex flex-col items-start gap-1 text-left text-xs">
                  {relayHealth.map((relay) => (
                    <div key={relay.url} className="flex items-center gap-2 max-w-xl">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${relay.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="font-mono truncate">{relay.url}</span>
                      <span className={`truncate ${relay.ok ? 'text-green-600' : 'text-red-500'}`}>
                        {relay.ok ? 'Connected' : relay.error || 'Unreachable'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : offers.filter(o => o.name.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
            <div className="p-8 text-center text-gray-500">No names match your search.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase border-b dark:border-gray-700">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Seller</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Ownership</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {offers.filter(o => o.name.toLowerCase().includes(searchQuery.toLowerCase())).map(offer => {
                  const key = listingKey(offer);
                  const vkey = verificationKey(offer);
                  const isVerified = verifiedMap[vkey];
                  const isVerifying = verifyingMap[vkey];
                  const isOwn = Boolean(nostrPubKey && offer.sellerPubKey === nostrPubKey);
                  const escrowFee = getEscrowArbiterFee(offer);
                  return (
                    <tr key={key} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium">
                        <button
                          onClick={() => setDetailTarget(offer)}
                          className="text-hns-600 hover:underline"
                        >
                          {offer.name}
                        </button>
                        {isEscrowListing(offer) && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-hns-100 px-2 py-0.5 text-[10px] font-medium text-hns-700 dark:bg-hns-900/30 dark:text-hns-300">
                            <ShieldCheck className="h-3 w-3" />
                            Escrow
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-hns-600">
                        {formatHNS(offer.price)}
                        {isEscrowListing(offer) && (
                          <div className="text-[10px] font-normal text-gray-400">
                            escrow {formatHNS(
                              offer.price + escrowFee + MARKETPLACE_ESCROW_FEE_BUFFER,
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{shortAddr(offer.sellerAddr)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{offer.contact || '-'}</td>
                      <td className="px-4 py-3">
                        {!isCanonicalListing(offer) ? (
                          <span className="text-xs text-gray-400">Legacy proof</span>
                        ) : isVerified === true ? (
                          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                            <Check className="w-3 h-3" /> Valid proof
                          </span>
                        ) : isVerifying ? (
                          <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                        ) : isVerified === false ? (
                          <span className="flex items-center gap-1 text-xs text-red-500">
                            <Ban className="w-3 h-3" /> Invalid
                          </span>
                        ) : (
                          <button onClick={() => handleVerify(offer)}
                            className="text-xs text-hns-600 hover:underline flex items-center gap-1">
                            <Check className="w-3 h-3" /> Verify
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {offer.expiresAt ? new Date(offer.expiresAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleStartBuy(offer)}
                          disabled={busy || isVerifying || !isCanonicalListing(offer) || isOwn}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 bg-hns-600 text-white rounded hover:bg-hns-700 disabled:opacity-50"
                        >
                          {isOwn ? (
                            'Your listing'
                          ) : (
                            <>
                              <ShoppingCart className="w-3 h-3" /> Buy
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="p-3 text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-b-lg flex items-center gap-2">
            <ArrowRight className="w-3 h-3" />
            Transfer-first: the seller transfers the name, then the buyer pays and finalizes after the lockup.
            This is not trustless escrow — the seller can cancel before finalization, and the chain does not
            enforce the payment amount.
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <Ban className="w-5 h-5 text-red-500" />
              <h3 className="text-lg font-semibold">
                {confirmTarget.type === 'cancel' ? 'Cancel listing?' : 'Reject purchase request?'}
              </h3>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {confirmTarget.type === 'cancel'
                ? `Remove ${confirmTarget.name} from the marketplace? Buyers will no longer be able to request it.`
                : `Reject the purchase request for ${confirmTarget.name}? The buyer will need to submit a new request.`}
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  const target = confirmTarget;
                  setConfirmTarget(null);
                  if (target.type === 'cancel') void handleCancel(target.name);
                  else void handleReject(target.name, target.buyerAddr);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                {confirmTarget.type === 'cancel' ? 'Cancel Listing' : 'Reject Request'}
              </button>
              <button
                onClick={() => setConfirmTarget(null)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
