import { useState } from 'react';
import { useSwapStore } from '../../stores/swap-store';
import { useConnectionStore } from '../../stores/connection-store';
import { SwapProgressWizard } from './SwapProgressWizard';
import { Clock, Loader2, AlertCircle } from 'lucide-react';
import type { LocalSwap } from '../../types/swap';

type SwapAction =
  | 'start'
  | 'fundDgb'
  | 'claimDgb'
  | 'claimHns'
  | 'rebroadcastHns'
  | 'refundHns'
  | 'refundDgb';

export function MySwapsList() {
  const {
    mySwaps, loading, error, autoComplete, setSwapAutoComplete,
    executeSwapAsInitiator, fundDgbHtlc, claimFromDgbHtlc, claimFromHnsHtlc,
    rebroadcastHnsClaim, refundHnsHtlc, refundDgbHtlc,
  } = useSwapStore();
  const { walletInfo } = useConnectionStore();
  const [actionSwapId, setActionSwapId] = useState<string | null>(null);
  const [autoSwapId, setAutoSwapId] = useState<string | null>(null);
  const [passphrases, setPassphrases] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState('');
  const needsPassphrase = (walletInfo?.master?.encrypted ?? false)
    && (walletInfo?.master?.until ?? 0) <= Math.floor(Date.now() / 1000);

  if (mySwaps.length === 0) {
    return (
      <div className="text-center text-gray-400 py-6">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No swaps yet</p>
      </div>
    );
  }

  const updatePassphrase = (id: string, val: string) => {
    setPassphrases(prev => ({ ...prev, [id]: val }));
  };

  const handleEnableAuto = async (swapId: string) => {
    setLocalError('');
    setAutoSwapId(swapId);
    try {
      await setSwapAutoComplete(swapId, true);
    } catch { /* handled by store */ }
    setAutoSwapId(null);
  };

  const handleAction = async (swapId: string, action: SwapAction) => {
    setLocalError('');
    const pw = passphrases[swapId] || '';
    if (action === 'start' && needsPassphrase && !pw) {
      setLocalError('Wallet passphrase required to fund the HNS HTLC');
      return;
    }
    setActionSwapId(swapId);
    try {
      if (action === 'start') await executeSwapAsInitiator(swapId, pw);
      else if (action === 'fundDgb') await fundDgbHtlc(swapId);
      else if (action === 'claimDgb') await claimFromDgbHtlc(swapId);
      else if (action === 'claimHns') await claimFromHnsHtlc(swapId);
      else if (action === 'rebroadcastHns') await rebroadcastHnsClaim(swapId);
      else if (action === 'refundHns') await refundHnsHtlc(swapId);
      else if (action === 'refundDgb') await refundDgbHtlc(swapId);
    } catch { /* handled by store */ }
    setActionSwapId(null);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">My Swaps ({mySwaps.length})</h3>
      {mySwaps.map((swap) => {
        const isInitiator = swap.role === 'initiator';
        const state = swap.state;
        const pw = passphrases[swap.id] || '';
        const actionBtn = getAction(swap, isInitiator);

        return (
          <div key={swap.id} className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">
                  {swap.offer.direction === 'hnsToDgb' ? 'HNS → DGB' : 'DGB → HNS'}
                </span>
                <span className="text-xs text-gray-400 ml-2">
                  {isInitiator ? 'HNS side' : 'DGB side'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {swap.autoComplete && !['completed', 'failed', 'refunded'].includes(state) && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-hns-50 text-hns-700 dark:bg-hns-900/30 dark:text-hns-300">
                    Auto
                  </span>
                )}
                <StateBadge state={state} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-400">HNS:</span>
                <span className="ml-1 font-mono">{swap.offer.hnsAmount.toFixed(6)}</span>
              </div>
              <div>
                <span className="text-gray-400">DGB:</span>
                <span className="ml-1 font-mono">{swap.offer.dgbAmount.toFixed(8)}</span>
              </div>
              {swap.hnsHtlcTxid && (
                <div className="col-span-2 text-xs font-mono text-gray-400 truncate" title={swap.hnsHtlcTxid}>
                  HNS HTLC: {swap.hnsHtlcTxid.slice(0, 32)}...
                  {swap.hnsConfirmations != null ? ` (${swap.hnsConfirmations} conf)` : ''}
                </div>
              )}
              {swap.dgbHtlcTxid && (
                <div className="col-span-2 text-xs font-mono text-gray-400 truncate" title={swap.dgbHtlcTxid}>
                  DGB HTLC: {swap.dgbHtlcTxid.slice(0, 32)}...
                  {swap.dgbConfirmations != null ? ` (${swap.dgbConfirmations} conf)` : ''}
                </div>
              )}
              {swap.hnsClaimTxid && (
                <div className="col-span-2 text-xs font-mono text-gray-400 truncate" title={swap.hnsClaimTxid}>
                  HNS claim: {swap.hnsClaimTxid.slice(0, 32)}...
                  {swap.hnsClaimConfirmed
                    ? ' (confirmed)'
                    : swap.hnsClaimMissing ? ' (not found)' : ' (broadcast)'}
                </div>
              )}
              {swap.hnsClaimAddress && (
                <div className="col-span-2 text-xs font-mono text-gray-400 truncate" title={swap.hnsClaimAddress}>
                  HNS received at: {swap.hnsClaimAddress}
                </div>
              )}
              {swap.hnsClaimValue != null && (
                <div className="col-span-2 text-xs text-gray-400">
                  HNS claim amount: {(swap.hnsClaimValue / 1_000_000).toFixed(6)} HNS
                </div>
              )}
              {swap.hnsTimeout > 0 && (
                <div className="col-span-2 text-xs text-gray-400">
                  HNS refund after block {swap.hnsTimeout}
                  {swap.dgbTimeout > 0 ? ` · DGB refund after block ${swap.dgbTimeout}` : ''}
                </div>
              )}
            </div>

            {swap.hnsClaimMissing && !swap.hnsClaimConfirmed && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                The HNS claim transaction is no longer visible to the node. If it was dropped before
                mining, select the HNS wallet that should receive the swap and click
                <strong> Rebroadcast HNS Claim</strong>. If it was broadcast to another wallet,
                switch to that wallet to see the funds.
              </div>
            )}

            <div className="text-xs text-gray-400">
              {isInitiator
                ? 'You lock HNS first, then claim DGB and reveal the secret.'
                : 'You lock DGB after HNS confirms, then claim HNS using the revealed secret.'}
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-gray-400 hover:text-gray-600 font-medium">
                Show Progress
              </summary>
              <div className="mt-2 pl-1">
                <SwapProgressWizard swap={swap} />
              </div>
            </details>

            {autoComplete && !swap.autoComplete && !['offered', 'completed', 'failed', 'refunded', 'refunding'].includes(state) && (
              <button
                onClick={() => { void handleEnableAuto(swap.id); }}
                disabled={autoSwapId === swap.id}
                className="text-xs text-hns-600 hover:text-hns-700 disabled:opacity-50 font-medium"
              >
                {autoSwapId === swap.id ? 'Enabling auto-complete...' : 'Enable auto-complete for this swap'}
              </button>
            )}

            {swap.autoComplete && !autoComplete && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                Auto-complete is paused because the global auto-complete toggle is off.
              </div>
            )}

            {autoComplete
              && swap.autoComplete
              && isInitiator
              && !swap.hnsHtlcTxid
              && ['accepted', 'terms_ready', 'hns_funding'].includes(state) && (
                <div className={`text-xs ${needsPassphrase ? 'text-amber-600 dark:text-amber-400' : 'text-hns-600'}`}>
                  {needsPassphrase
                    ? 'Auto-complete paused — enter your wallet passphrase to lock the HNS HTLC. The rest will continue automatically.'
                    : 'Auto-complete will lock the HNS HTLC automatically.'}
                </div>
              )}

            {actionBtn && (
              <div className="space-y-2">
                {actionBtn.action === 'start' && needsPassphrase && (
                  <input
                    type="password"
                    value={pw}
                    onChange={e => { updatePassphrase(swap.id, e.target.value); setLocalError(''); }}
                    placeholder="Wallet passphrase to fund the HNS HTLC"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                  />
                )}
                <button
                  onClick={() => handleAction(swap.id, actionBtn.action)}
                  disabled={loading || actionSwapId === swap.id}
                  className={`w-full px-3 py-2 text-white rounded-lg disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2 ${actionBtn.color}`}
                >
                  {actionSwapId === swap.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  {actionSwapId === swap.id ? 'Processing...' : actionBtn.label}
                </button>
              </div>
            )}

            <div className="text-xs text-gray-400">
              {new Date(swap.createdAt).toLocaleString()}
            </div>
          </div>
        );
      })}
      {(localError || error) && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {localError || error}
        </div>
      )}
    </div>
  );
}

function getAction(
  swap: LocalSwap,
  isInitiator: boolean,
): { label: string; action: SwapAction; color: string } | null {
  const state = swap.state;

  if (
    swap.role === 'counterparty'
    && swap.hnsClaimMissing
    && !swap.hnsClaimConfirmed
    && swap.hnsHtlcTxid
  ) {
    return {
      label: 'Rebroadcast HNS Claim',
      action: 'rebroadcastHns',
      color: 'bg-amber-600 hover:bg-amber-700',
    };
  }

  if (state === 'completed' || state === 'failed') return null;

  if (isInitiator) {
    if (swap.dgbRefunded && !swap.hnsRefunded && swap.hnsHtlcTxid) {
      return {
        label: 'Refund HNS (after timeout)',
        action: 'refundHns',
        color: 'bg-amber-600 hover:bg-amber-700',
      };
    }
    if (state === 'accepted' || state === 'terms_ready' || state === 'hns_funding') {
      return {
        label: 'Start Swap (Fund HNS HTLC)',
        action: 'start',
        color: 'bg-hns-600 hover:bg-hns-700',
      };
    }
    if (state === 'dgb_htlc_funded'
      || (state === 'hns_claimed' && !swap.dgbClaimed)) {
      return {
        label: 'Claim DGB',
        action: 'claimDgb',
        color: 'bg-green-600 hover:bg-green-700',
      };
    }
    if (state === 'hns_htlc_funded'
      && !swap.dgbHtlcTxid
      && swap.hnsHtlcTxid) {
      return {
        label: 'Refund HNS (after timeout)',
        action: 'refundHns',
        color: 'bg-amber-600 hover:bg-amber-700',
      };
    }
    return null;
  }

  if (swap.hnsRefunded && !swap.dgbRefunded && swap.dgbHtlcTxid) {
    return {
      label: 'Refund DGB (after timeout)',
      action: 'refundDgb',
      color: 'bg-amber-600 hover:bg-amber-700',
    };
  }
  if (state === 'hns_htlc_funded') {
    return {
      label: 'Fund DGB HTLC',
      action: 'fundDgb',
      color: 'bg-blue-600 hover:bg-blue-700',
    };
  }
  if (state === 'dgb_funding' && swap.dgbHtlcTxid) {
    return {
      label: 'Republish DGB Funding',
      action: 'fundDgb',
      color: 'bg-blue-600 hover:bg-blue-700',
    };
  }
  if (state === 'secret_revealed' || state === 'dgb_claimed') {
    return {
      label: 'Claim HNS',
      action: 'claimHns',
      color: 'bg-green-600 hover:bg-green-700',
    };
  }
  if ((state === 'dgb_funding' || state === 'dgb_htlc_funded') && !swap.dgbClaimed) {
    return {
      label: 'Refund DGB (after timeout)',
      action: 'refundDgb',
      color: 'bg-amber-600 hover:bg-amber-700',
    };
  }
  return null;
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    offered: 'bg-gray-100 text-gray-700',
    active: 'bg-blue-100 text-blue-700',
    accepted: 'bg-blue-100 text-blue-700',
    terms_ready: 'bg-purple-100 text-purple-700',
    hns_funding: 'bg-amber-100 text-amber-700',
    hns_htlc_funded: 'bg-amber-100 text-amber-700',
    dgb_funding: 'bg-amber-100 text-amber-700',
    dgb_htlc_funded: 'bg-amber-100 text-amber-700',
    dgb_claimed: 'bg-green-100 text-green-700',
    secret_revealed: 'bg-green-100 text-green-700',
    hns_claimed: 'bg-green-100 text-green-700',
    completed: 'bg-green-100 text-green-700',
    refunding: 'bg-orange-100 text-orange-700',
    refunded: 'bg-gray-100 text-gray-700',
    failed: 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = {
    offered: 'Offered',
    active: 'Active',
    accepted: 'Accepted',
    terms_ready: 'Terms Ready',
    hns_funding: 'HNS Funding',
    hns_htlc_funded: 'HNS Locked',
    dgb_funding: 'DGB Funding',
    dgb_htlc_funded: 'DGB Locked',
    dgb_claimed: 'DGB Claimed',
    secret_revealed: 'Secret Revealed',
    hns_claimed: 'HNS Claimed',
    completed: 'Completed',
    refunding: 'Refunding',
    refunded: 'Refunded',
    failed: 'Failed',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[state] || 'bg-gray-100 text-gray-700'}`}>
      {labels[state] || state}
    </span>
  );
}
