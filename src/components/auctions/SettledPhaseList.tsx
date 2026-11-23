import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, DollarSign, TrendingUp, Check, Siren, Loader2 } from 'lucide-react';
import { toPunycode, toUnicode, dollaryDoosToHNS } from '../../lib/name-utils';
import type { UnifiedHnsAuction } from '../../types/auction';

interface SettledPhaseListProps {
  auctions: UnifiedHnsAuction[];
  variant: 'won' | 'lost';
  currentAction: { name: string; type: string; loading: boolean; ok: boolean; msg: string } | null;
  justRegistered?: string[];
  onRedeem: (name: string) => void;
  onRedeemAll?: (names: string[]) => void;
  onRegister: (name: string) => void;
  onRegisterAll?: (names: string[]) => void;
}

function formatHNS(dollarydoos: number, decimals: number = 4): string {
  return `${dollaryDoosToHNS(dollarydoos).toFixed(decimals)} HNS`;
}

export function SettledPhaseList({ auctions, variant, currentAction, justRegistered = [], onRedeem, onRedeemAll, onRegister, onRegisterAll }: SettledPhaseListProps) {
  const sorted = useMemo(
    () => [...auctions].sort((a, b) => a.name.localeCompare(b.name)),
    [auctions],
  );

  const redeemableNames = useMemo(
    () => variant === 'lost'
      ? sorted
          .filter(a => !a.userBidData?.redeemed && a.userBidData?.isWinner !== true)
          .map(a => a.name)
      : [],
    [sorted, variant],
  );

  const registerableNames = useMemo(
    () => variant === 'won'
      ? sorted
          .filter(a => !a.userBidData?.redeemed && a.userBidData?.isWinner === true && !justRegistered.includes(a.name))
          .map(a => a.name)
      : [],
    [sorted, variant, justRegistered],
  );

  const isBatchRedeeming = currentAction?.type === 'redeem-all';
  const isBatchRegistering = currentAction?.type === 'register-all';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800">
      {/* Register All action bar (Won tab only) */}
      {variant === 'won' && registerableNames.length >= 2 && onRegisterAll && (
        <div className="flex items-center justify-between px-4 py-3 bg-hns-50/70 dark:bg-hns-900/15 border-b border-hns-200 dark:border-hns-800/50">
          <span className="text-sm text-hns-700 dark:text-hns-300">
            {registerableNames.length} name{registerableNames.length !== 1 ? 's' : ''} to register
          </span>
          <button
            onClick={() => onRegisterAll(registerableNames)}
            disabled={isBatchRegistering || currentAction?.loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-hns-600 hover:bg-hns-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isBatchRegistering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {isBatchRegistering ? 'Registering…' : 'Register All'}
          </button>
        </div>
      )}

      {/* Redeem All action bar (Lost tab only) */}
      {variant === 'lost' && redeemableNames.length >= 2 && onRedeemAll && (
        <div className="flex items-center justify-between px-4 py-3 bg-orange-50/70 dark:bg-orange-900/15 border-b border-orange-200 dark:border-orange-800/50">
          <span className="text-sm text-orange-700 dark:text-orange-300">
            {redeemableNames.length} name{redeemableNames.length !== 1 ? 's' : ''} to redeem
          </span>
          <button
            onClick={() => onRedeemAll(redeemableNames)}
            disabled={isBatchRedeeming || currentAction?.loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isBatchRedeeming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Siren className="w-4 h-4" />
            )}
            {isBatchRedeeming ? 'Redeeming…' : 'Redeem All'}
          </button>
        </div>
      )}

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-right px-4 py-2.5">Your Bid</th>
              <th className="text-right px-4 py-2.5">{variant === 'won' ? 'Amount Paid' : 'Highest Current Bid'}</th>
              <th className="text-right px-4 py-2.5">Status</th>
              <th className="text-right px-4 py-2.5 w-36">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {sorted.map(a => {
              const userValue = a.userBidData?.value ?? 0;
              // Consider settled if:
              // 1. hsd reports redeemed (persistent truth)
              // 2. Current session action was successful redeem/register for this name
              //    (covers the gap before hsd syncs the redeemed flag)
              // 3. Name is in justRegistered list (persisted across restarts)
              const justRedeemedInSession = currentAction?.name === a.name
                && currentAction?.type === 'redeem'
                && currentAction?.ok === true
                && !currentAction?.loading;
              const justRegisteredInSession = currentAction?.name === a.name
                && currentAction?.type === 'register'
                && currentAction?.ok === true
                && !currentAction?.loading;
              const isJustRegistered = justRegistered.includes(a.name);
              const isSettled = a.userBidData?.redeemed === true || justRedeemedInSession || justRegisteredInSession || isJustRegistered;
              const isBusy = currentAction?.name === a.name && currentAction?.loading;
              const isActioned = currentAction?.name === a.name && !currentAction?.loading;

              return (
                <tr key={a.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                      className="font-semibold text-hns-600 hover:underline truncate block max-w-[12rem]"
                    >
                      {toUnicode(a.name)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-600 dark:text-green-400">
                    {userValue > 0 ? formatHNS(userValue) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">
                    {variant === 'won' && a.secondHighestBid != null && a.secondHighestBid > 0
                      ? formatHNS(a.secondHighestBid)
                      : a.highestBid > 0
                        ? formatHNS(a.highestBid)
                        : 'No bids'}
                  </td>
                  <td className="px-4 py-3 text-right">
{variant === 'won' ? (
                        isSettled ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                            <Check className="w-3 h-3" />
                            Registered
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                            <Siren className="w-3 h-3" />
                            Register
                          </span>
                        )
                    ) : (
                      isSettled ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                          <Check className="w-3 h-3" />
                          Redeemed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400">
                          <Siren className="w-3 h-3" />
                          Redeem HNS
                        </span>
                      )
                    )}
</td>
                    <td className="px-4 py-3 text-right">
                      {isSettled ? (
                        <Link
                          to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                          className="inline-flex items-center text-gray-400 hover:text-hns-600 transition-colors"
                          title="Open name detail"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </Link>
                      ) : variant === 'won' ? (
                        <>
                        {a.secondHighestBid != null && a.secondHighestBid > 0 ? (
                          <button
                            onClick={() => onRegister(a.name)}
                            disabled={isBusy}
                            className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-hns-600 hover:bg-hns-700 text-white disabled:opacity-50 transition-colors"
                            title={`You will pay ${formatHNS(a.secondHighestBid)} (2nd highest bid). Your bid excess will be returned as change.`}
                          >
                            {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                            {isBusy ? 'Registering…' : `Register (${formatHNS(a.secondHighestBid)})`}
                          </button>
                        ) : (
                          <button
                            onClick={() => onRegister(a.name)}
                            disabled={isBusy}
                            className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-hns-600 hover:bg-hns-700 text-white disabled:opacity-50 transition-colors"
                          >
                            {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                            {isBusy ? 'Registering…' : isActioned && !currentAction.ok ? 'Retry' : 'Register'}
                          </button>
                        )}
                        </>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => onRedeem(a.name)}
                          disabled={isBusy}
                          className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 transition-colors"
                        >
                          {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                          {isBusy ? 'Redeeming…' : isActioned && !currentAction.ok ? 'Retry' : 'Redeem'}
                        </button>
                        {currentAction?.name === a.name && !currentAction?.loading && !currentAction?.ok && (
                          <span className="text-xs text-red-500 max-w-[10rem] text-right leading-tight">
                            {currentAction.msg}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Register All action bar (Won tab, mobile) */}
      {variant === 'won' && registerableNames.length >= 2 && onRegisterAll && (
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-hns-50/70 dark:bg-hns-900/15 border-b border-hns-200 dark:border-hns-800/50">
          <span className="text-sm text-hns-700 dark:text-hns-300">
            {registerableNames.length} name{registerableNames.length !== 1 ? 's' : ''} to register
          </span>
          <button
            onClick={() => onRegisterAll(registerableNames)}
            disabled={isBatchRegistering || currentAction?.loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-hns-600 hover:bg-hns-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isBatchRegistering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {isBatchRegistering ? 'Registering…' : 'Register All'}
          </button>
        </div>
      )}

      {/* Redeem All action bar (Lost tab, mobile) */}
      {variant === 'lost' && redeemableNames.length >= 2 && onRedeemAll && (
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-orange-50/70 dark:bg-orange-900/15 border-b border-orange-200 dark:border-orange-800/50">
          <span className="text-sm text-orange-700 dark:text-orange-300">
            {redeemableNames.length} name{redeemableNames.length !== 1 ? 's' : ''} to redeem
          </span>
          <button
            onClick={() => onRedeemAll(redeemableNames)}
            disabled={isBatchRedeeming || currentAction?.loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isBatchRedeeming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Siren className="w-4 h-4" />
            )}
            {isBatchRedeeming ? 'Redeeming…' : 'Redeem All'}
          </button>
        </div>
      )}

      {/* Mobile: stacked rows */}
      <ul className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {sorted.map(a => {
          const userValue = a.userBidData?.value ?? 0;
          // Same session-level tracking as desktop table above
          const justRedeemedInSession = currentAction?.name === a.name
            && currentAction?.type === 'redeem'
            && currentAction?.ok === true
            && !currentAction?.loading;
          const justRegisteredInSession = currentAction?.name === a.name
            && currentAction?.type === 'register'
            && currentAction?.ok === true
            && !currentAction?.loading;
          const isJustRegistered = justRegistered.includes(a.name);
          const isSettled = a.userBidData?.redeemed === true || justRedeemedInSession || justRegisteredInSession || isJustRegistered;
          const isBusy = currentAction?.name === a.name && currentAction?.loading;
          const isActioned = currentAction?.name === a.name && !currentAction?.loading;

          return (
            <li key={a.name} className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={`/explore/name/${encodeURIComponent(toPunycode(a.name))}`}
                  className="font-semibold text-hns-600 hover:underline truncate"
                >
                  {toUnicode(a.name)}
                </Link>
                {variant === 'won' ? (
                  isSettled ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                      <Check className="w-3 h-3" />
                      Registered
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      <Siren className="w-3 h-3" />
                      Register
                    </span>
                  )
                ) : (
                  isSettled ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                      <Check className="w-3 h-3" />
                      Redeemed
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400">
                      <Siren className="w-3 h-3" />
                      Redeem
                    </span>
                  )
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <DollarSign className="w-3 h-3" /> Your Bid
                  </div>
                  <div className="font-mono text-green-600 dark:text-green-400">
                    {userValue > 0 ? formatHNS(userValue) : '—'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <TrendingUp className="w-3 h-3" /> {variant === 'won' ? 'Paid' : 'Highest'}
                  </div>
                  <div className="font-mono text-gray-700 dark:text-gray-300">
                    {variant === 'won' && a.secondHighestBid != null && a.secondHighestBid > 0
                      ? formatHNS(a.secondHighestBid)
                      : a.highestBid > 0
                        ? formatHNS(a.highestBid)
                        : 'No bids'}
                  </div>
                </div>
              </div>
              {!isSettled && (
                variant === 'won' ? (
                  <>
                  {a.secondHighestBid != null && a.secondHighestBid > 0 ? (
                    <button
                      onClick={() => onRegister(a.name)}
                      disabled={isBusy}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-md bg-hns-600 hover:bg-hns-700 text-white disabled:opacity-50 transition-colors"
                      title={`You will pay ${formatHNS(a.secondHighestBid)} (2nd highest bid). Your bid excess will be returned as change.`}
                    >
                      {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                      {isBusy ? 'Registering…' : `Register (${formatHNS(a.secondHighestBid)})`}
                    </button>
                  ) : (
                    <button
                      onClick={() => onRegister(a.name)}
                      disabled={isBusy}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-md bg-hns-600 hover:bg-hns-700 text-white disabled:opacity-50 transition-colors"
                    >
                      {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                      {isBusy ? 'Registering…' : isActioned && !currentAction.ok ? 'Retry' : 'Register'}
                    </button>
                  )}
                  </>
                ) : (
                  <div className="space-y-1">
                    <button
                      onClick={() => onRedeem(a.name)}
                      disabled={isBusy}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-md bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 transition-colors"
                    >
                      {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                      {isBusy ? 'Redeeming…' : isActioned && !currentAction.ok ? 'Retry' : 'Redeem HNS'}
                    </button>
                    {currentAction?.name === a.name && !currentAction?.loading && !currentAction?.ok && (
                      <p className="text-xs text-red-500 text-center leading-tight">{currentAction.msg}</p>
                    )}
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
