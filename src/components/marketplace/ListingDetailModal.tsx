import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { formatHNS } from '../../lib/name-utils';
import {
  MARKETPLACE_ESCROW_FEE_BUFFER,
  getEscrowArbiterFee,
  isCanonicalListing,
  isEscrowListing,
  isListingExpired,
} from '../../lib/marketplace-signing';
import type { MarketplaceListing } from '../../types/marketplace';
import type { NameDetail } from '../../types/explore';

interface ListingDetailModalProps {
  listing: MarketplaceListing;
  verified: boolean | undefined;
  verifying: boolean;
  isOwn: boolean;
  hnsUsd: number | null;
  onVerify: () => void;
  onBuy: () => void;
  onClose: () => void;
}

function short(value: string | null | undefined, length = 24): string {
  if (!value) return '—';
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

export function ListingDetailModal({
  listing,
  verified,
  verifying,
  isOwn,
  hnsUsd,
  onVerify,
  onBuy,
  onClose,
}: ListingDetailModalProps) {
  const [nameDetail, setNameDetail] = useState<NameDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    window.api.node.getNameDetail(listing.name)
      .then((detail) => {
        if (!cancelled) setNameDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setDetailError('Could not load on-chain name details.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listing.name]);

  const canonical = isCanonicalListing(listing);
  const expired = isListingExpired(listing);
  const escrow = isEscrowListing(listing);
  const arbiterFee = getEscrowArbiterFee(listing);
  const usd = hnsUsd != null ? (listing.price / 1_000_000) * hnsUsd : null;
  const canBuy = canonical && !expired && !isOwn && verified === true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="listing-detail-title"
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="listing-detail-title" className="text-lg font-semibold">
              {listing.name}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Listing details and on-chain ownership check
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500">Price</div>
            <div className="font-semibold text-hns-600">{formatHNS(listing.price)}</div>
            {usd != null && (
              <div className="text-xs text-gray-400">~${usd.toFixed(2)} USD</div>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500">Expires</div>
            <div className="font-medium">
              {listing.expiresAt
                ? new Date(listing.expiresAt).toLocaleString()
                : 'Legacy listing'}
            </div>
            {expired && <div className="text-xs text-amber-600">Expired</div>}
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Seller address</span>
            <span className="font-mono text-xs break-all text-right">{listing.sellerAddr || '—'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Seller Nostr key</span>
            <span className="font-mono text-xs" title={listing.sellerPubKey}>
              {short(listing.sellerPubKey)}
            </span>
          </div>
          {escrow && (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Escrow arbiter</span>
                <span className="font-mono text-xs" title={listing.escrowArbiterPubKey}>
                  {short(listing.escrowArbiterPubKey)}
                </span>
              </div>
              {arbiterFee > 0 && (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Arbitration fee</span>
                    <span className="font-medium">{formatHNS(arbiterFee)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Arbiter payout</span>
                    <span className="font-mono text-xs break-all text-right" title={listing.escrowArbiterPayoutAddress}>
                      {listing.escrowArbiterPayoutAddress || '—'}
                    </span>
                  </div>
                </>
              )}
            </>
          )}
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Contact</span>
            <span className="text-right break-all">{listing.contact || '—'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Listing ID</span>
            <span className="font-mono text-xs" title={listing.listingId}>
              {short(listing.listingId)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Listed</span>
            <span className="text-xs">{new Date(listing.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {!canonical ? (
                <ShieldAlert className="w-4 h-4 text-gray-400" />
              ) : verified === true ? (
                <ShieldCheck className="w-4 h-4 text-green-600" />
              ) : verified === false ? (
                <ShieldAlert className="w-4 h-4 text-red-500" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-amber-500" />
              )}
              Ownership proof
            </div>
            {canonical && verified !== true && (
              <button
                onClick={onVerify}
                disabled={verifying}
                className="px-3 py-1.5 text-xs bg-hns-600 text-white rounded hover:bg-hns-700 disabled:opacity-50 flex items-center gap-1"
              >
                {verifying && <Loader2 className="w-3 h-3 animate-spin" />}
                {verified === false ? 'Re-check' : 'Verify proof'}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {!canonical
              ? 'This is a legacy listing without a full-terms ownership proof.'
              : verified === true
                ? 'The seller signed the name, price, payout address, seller key, and expiry.'
                : verified === false
                  ? 'The proof is invalid, expired, or the seller no longer owns the name.'
                  : 'Verify the signed proof before buying.'}
          </p>
          {listing.signedMessage && (
            <details className="text-xs">
              <summary className="cursor-pointer text-hns-600">View signed payload</summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-50 dark:bg-gray-900 p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                {listing.signedMessage}
              </pre>
            </details>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">On-chain name</span>
            <Link
              to={`/explore/name/${encodeURIComponent(listing.name)}`}
              className="text-xs text-hns-600 hover:underline flex items-center gap-1"
            >
              View <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          {detailLoading ? (
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </div>
          ) : detailError ? (
            <div className="text-xs text-amber-600">{detailError}</div>
          ) : nameDetail ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-gray-500">State</span>
              <span className="font-medium">{nameDetail.state}</span>
              <span className="text-gray-500">Owner hash</span>
              <span className="font-mono" title={nameDetail.owner || undefined}>
                {short(nameDetail.owner, 20)}
              </span>
              <span className="text-gray-500">Value locked</span>
              <span>{formatHNS(nameDetail.value)}</span>
              <span className="text-gray-500">Expiry block</span>
              <span>{nameDetail.expiryBlock ?? '—'}</span>
              <span className="text-gray-500">Renewals</span>
              <span>{nameDetail.renewals}</span>
              <span className="text-gray-500">DNS records</span>
              <span>{nameDetail.records.length}</span>
            </div>
          ) : (
            <div className="text-xs text-gray-400">No on-chain data returned.</div>
          )}
        </div>

        {escrow ? (
          <div className="p-3 rounded-lg bg-hns-50 dark:bg-hns-900/20 text-hns-800 dark:text-hns-200 text-xs leading-relaxed space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="w-4 h-4" />
              2-of-3 escrow available
            </div>
            <p>
              At checkout, you can fund{' '}
              {formatHNS(listing.price + arbiterFee + MARKETPLACE_ESCROW_FEE_BUFFER)} into a
              multisig address controlled by you, the seller, and the independent arbiter. The seller
              transfers only after the funding confirms, and the funds release only after you finalize the
              name.
            </p>
            {arbiterFee > 0 && (
              <p>
                The {formatHNS(arbiterFee)} arbitration fee is returned to you on a normal release.
                It is paid to the arbiter only if the trade goes to a refund or arbitration release.
              </p>
            )}
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs leading-relaxed">
            Transfer-first trade, not trustless escrow. The seller can cancel before you finalize, and
            the chain does not enforce the payment amount. Only trade with sellers you trust.
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Close
          </button>
          {isOwn ? (
            <button
              disabled
              className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-500 rounded-lg"
            >
              Your listing
            </button>
          ) : (
            <button
              onClick={onBuy}
              disabled={!canBuy}
              className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50"
              title={
                !canonical
                  ? 'Legacy listing — cannot purchase'
                  : expired
                    ? 'This listing has expired'
                    : verified !== true
                      ? 'Verify the ownership proof first'
                      : undefined
              }
            >
              {expired ? 'Expired' : verified === true ? 'Buy' : 'Verify to buy'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
