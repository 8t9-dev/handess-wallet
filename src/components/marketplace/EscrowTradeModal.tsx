import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clipboard,
  Clock,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useMarketplaceStore } from '../../stores/marketplace-store';
import { PassphraseModal } from '../common/PassphraseModal';
import { formatHNS } from '../../lib/name-utils';
import type { PurchaseIntent } from '../../types/marketplace';
import type { WalletInfo } from '../../types/wallet';

interface EscrowTradeModalProps {
  intent: PurchaseIntent;
  role: 'buyer' | 'seller';
  walletInfo: WalletInfo | null;
  onClose: () => void;
  onChanged: () => void;
}

interface FundingStatus {
  funded: boolean;
  value: number;
  vout: number;
  confirmations: number;
  address: string;
  amount: number;
}

function intentKey(intent: PurchaseIntent): string {
  return intent.intentId || `${intent.buyerPubKey || ''}:${intent.name}:${intent.buyerAddr}`;
}

function short(value: string | null | undefined, length = 24): string {
  if (!value) return '—';
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

export function EscrowTradeModal({
  intent: initialIntent,
  role,
  walletInfo,
  onClose,
  onChanged,
}: EscrowTradeModalProps) {
  const latest = useMarketplaceStore((state) =>
    [...state.myPurchases, ...state.purchaseRequests]
      .find((intent) => intentKey(intent) === intentKey(initialIntent)),
  ) || initialIntent;

  const {
    getEscrowFundingStatus,
    fundEscrow,
    createEscrowRelease,
    signEscrowRelease,
    createEscrowDisputePsbt,
    importEscrowArbiterPsbt,
  } = useMarketplaceStore();

  const escrow = latest.escrow;
  const key = intentKey(latest);
  const walletEncrypted = walletInfo?.master?.encrypted ?? false;
  const walletUnlocked = (walletInfo?.master?.until ?? 0) > Math.floor(Date.now() / 1000);

  const [funding, setFunding] = useState<FundingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [arbiterPsbt, setArbiterPsbt] = useState('');
  const [copied, setCopied] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<
    { kind: 'release' } | { kind: 'arbiter' } | null
  >(null);

  const refreshFunding = async () => {
    if (!escrow) return;
    try {
      setFunding(await getEscrowFundingStatus(key));
    } catch {
      setFunding(null);
    }
  };

  useEffect(() => {
    refreshFunding();
    const id = setInterval(refreshFunding, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, escrow?.state, escrow?.fundingTxHash]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      await onChanged();
      await refreshFunding();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Escrow action failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleFund = () => {
    if (walletEncrypted && !walletUnlocked) {
      setShowPassphrase(true);
      return;
    }
    void run(
      () => fundEscrow(key, ''),
      'Escrow funded. Wait for confirmation before the seller transfers the name.',
    );
  };

  const handleFundWithPassphrase = (passphrase: string) => {
    setShowPassphrase(false);
    void run(
      () => fundEscrow(key, passphrase),
      'Escrow funded. Wait for confirmation before the seller transfers the name.',
    );
  };

  const copyPsbt = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable.
    }
  };

  if (!escrow) return null;

  const canCreateRelease = (escrow.state === 'funded' || escrow.state === 'disputed')
    && latest.status === 'sold';
  const waitingForCounterparty = Boolean(
    escrow.releasePsbt && escrow.releaseRole === role,
  );
  const canSignRelease = Boolean(
    escrow.releasePsbt && escrow.releaseRole && escrow.releaseRole !== role,
  );
  const canRequestRefund = escrow.state === 'funded'
    && role === 'buyer'
    && latest.status !== 'sold';
  const canRequestArbitrationRelease = escrow.state === 'funded'
    && role === 'seller'
    && latest.status === 'sold';
  const canRequestDispute = canRequestRefund
    || canRequestArbitrationRelease
    || escrow.state === 'disputed';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="escrow-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="escrow-title" className="text-lg font-semibold">
              Escrow — {latest.name}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              You are the {role}. Funds move only through the 2-of-3 escrow.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500">Escrow amount</div>
            <div className="font-semibold text-hns-600">{formatHNS(escrow.amount)}</div>
            <div className="text-[10px] text-gray-400">
              {(escrow.arbiterFee || 0) > 0
                ? `${formatHNS(escrow.arbiterFee || 0)} arbitration fee + 0.05 HNS network fee`
                : 'includes 0.05 HNS network fee'}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500">State</div>
            <div className="font-medium capitalize flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-hns-600" />
              {escrow.state}
            </div>
          </div>
        </div>

        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Escrow address</span>
            <span className="font-mono break-all text-right">{escrow.address}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Arbiter</span>
            <span className="font-mono" title={escrow.arbiterPubKey}>
              {short(escrow.arbiterPubKey, 20)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Seller payout</span>
            <span className="font-mono break-all text-right" title={latest.sellerAddr}>
              {latest.sellerAddr}
            </span>
          </div>
          {(escrow.arbiterFee || 0) > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Arbitration fee</span>
              <span className="font-medium">
                {formatHNS(escrow.arbiterFee || 0)} on dispute
              </span>
            </div>
          )}
          {escrow.arbiterPayoutAddress && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Arbiter payout</span>
              <span className="font-mono break-all text-right" title={escrow.arbiterPayoutAddress}>
                {escrow.arbiterPayoutAddress}
              </span>
            </div>
          )}
          {latest.listingId && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Signed listing</span>
              <span className="font-mono" title={latest.listingId}>
                {short(latest.listingId, 24)}
              </span>
            </div>
          )}
          {escrow.fundingTxHash && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Funding tx</span>
              <span className="font-mono" title={escrow.fundingTxHash}>
                {short(escrow.fundingTxHash, 20)}
              </span>
            </div>
          )}
          {escrow.releaseTxHash && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Release tx</span>
              <span className="font-mono" title={escrow.releaseTxHash}>
                {short(escrow.releaseTxHash, 20)}
              </span>
            </div>
          )}
          {escrow.refundTxHash && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Refund tx</span>
              <span className="font-mono" title={escrow.refundTxHash}>
                {short(escrow.refundTxHash, 20)}
              </span>
            </div>
          )}
        </div>

        {escrow.state === 'created' && role === 'buyer' && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-2">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Fund the escrow from your wallet. The seller should not transfer the name until
              this funding is confirmed on-chain. Your wallet also pays the funding transaction fee.
              {(escrow.arbiterFee || 0) > 0 && (
                <>
                  {' '}The {formatHNS(escrow.arbiterFee || 0)} arbitration fee is returned to you
                  on a normal release and paid to the arbiter only if the trade is disputed.
                </>
              )}
            </p>
            <button
              onClick={handleFund}
              disabled={busy}
              className="w-full py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Fund Escrow
            </button>
          </div>
        )}

        {escrow.state === 'funded' && (
          <div className="rounded-lg border border-green-200 dark:border-green-900/40 bg-green-50/50 dark:bg-green-900/10 p-3 space-y-1 text-xs">
            <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-300">
              <Check className="w-4 h-4" />
              Escrow funded
            </div>
            {funding ? (
              <div className="text-gray-600 dark:text-gray-300">
                {funding.confirmations > 0
                  ? `${funding.confirmations} confirmation${funding.confirmations === 1 ? '' : 's'}`
                  : 'Waiting for confirmation'}
              </div>
            ) : (
              <div className="text-gray-500">Checking funding…</div>
            )}
            {role === 'seller' && funding && funding.confirmations < 1 && (
              <div className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <Clock className="w-3 h-3" /> Wait for at least one confirmation before transferring.
              </div>
            )}
          </div>
        )}

        {escrow.state === 'funded' && (
          <div className="space-y-2">
            {(escrow.arbiterFee || 0) > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                A normal buyer + seller release returns the{' '}
                {formatHNS(escrow.arbiterFee || 0)} arbitration fee to the buyer. The arbiter is
                not paid unless the trade is disputed.
              </p>
            )}
            {waitingForCounterparty ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Release PSBT created by you. Waiting for the counterparty to sign and broadcast.
              </p>
            ) : canSignRelease ? (
              <button
                onClick={() => setPendingConfirm({ kind: 'release' })}
                disabled={busy}
                className="w-full py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Sign &amp; Release Escrow
              </button>
            ) : canCreateRelease ? (
              <button
                onClick={() => void run(
                  () => createEscrowRelease(key),
                  'Release PSBT created. The counterparty must sign it.',
                )}
                disabled={busy}
                className="w-full py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Release PSBT
              </button>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Escrow releases after the buyer finalizes the name transfer.
              </p>
            )}
          </div>
        )}

        {canRequestDispute && (
          <details className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Arbitration / dispute
            </summary>
            <div className="mt-2 space-y-2 text-xs text-gray-500 dark:text-gray-400">
              <p>
                Use this only if the other party is not completing the trade. The arbiter must
                review the trade and sign the PSBT with their escrow key.
              </p>
              {(escrow.arbiterFee || 0) > 0 && (
                <p>
                  If the arbiter resolves this dispute, they receive{' '}
                  {formatHNS(escrow.arbiterFee || 0)} from the escrow.
                </p>
              )}
              {!escrow.disputePsbt ? (
                <button
                  onClick={() => void run(
                    () => createEscrowDisputePsbt(key, role === 'buyer' ? 'refund' : 'release'),
                    'Arbitration PSBT created. Send it to the arbiter.',
                  )}
                  disabled={busy}
                  className="w-full py-2 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-50 text-sm"
                >
                  {role === 'buyer' ? 'Request Refund PSBT' : 'Request Arbitration Release PSBT'}
                </button>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Arbitration PSBT</span>
                    <button
                      onClick={() => void copyPsbt(escrow.disputePsbt!)}
                      className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Clipboard className="w-3 h-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={escrow.disputePsbt}
                    rows={3}
                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 font-mono text-[10px]"
                  />
                  <textarea
                    value={arbiterPsbt}
                    onChange={(e) => setArbiterPsbt(e.target.value)}
                    rows={3}
                    placeholder="Paste the arbiter-signed PSBT here"
                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-[10px]"
                  />
                  <button
                    onClick={() => setPendingConfirm({ kind: 'arbiter' })}
                    disabled={busy || !arbiterPsbt.trim()}
                    className="w-full py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 text-sm"
                  >
                    Broadcast Arbiter Signature
                  </button>
                </>
              )}
            </div>
          </details>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 text-sm flex items-start gap-2">
            <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        <button
          onClick={onClose}
          disabled={busy}
          className="w-full py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Close
        </button>
      </div>

      {showPassphrase && (
        <PassphraseModal
          title="Fund Escrow"
          onSubmit={handleFundWithPassphrase}
          onCancel={() => setShowPassphrase(false)}
        />
      )}

      {pendingConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800 space-y-4">
            <h3 className="text-lg font-semibold">
              {pendingConfirm.kind === 'release' ? 'Release escrow funds?' : 'Broadcast arbiter signature?'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {pendingConfirm.kind === 'release'
                ? 'This signs and broadcasts the release transaction. The seller will receive the escrow funds.'
                : 'This broadcasts the arbiter-signed escrow transaction. It cannot be undone.'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const kind = pendingConfirm.kind;
                  setPendingConfirm(null);
                  if (kind === 'release') {
                    void run(
                      () => signEscrowRelease(key),
                      'Escrow released. The transaction was broadcast.',
                    );
                  } else {
                    void run(
                      () => importEscrowArbiterPsbt(key, arbiterPsbt.trim()),
                      'Arbitration transaction broadcast.',
                    );
                  }
                }}
                className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 font-medium"
              >
                Confirm
              </button>
              <button
                onClick={() => setPendingConfirm(null)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
