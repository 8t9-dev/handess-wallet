import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../common/Tabs';
import { ActiveBidsList } from './ActiveBidsList';
import { RevealPhaseList } from './RevealPhaseList';
import { SettledPhaseList } from './SettledPhaseList';
import { OpenedList } from './OpenedList';
import { useAuctionsStore } from '../../stores/auctions-store';
import { bucketAuctions } from '../../lib/auction-buckets';
import type { UnifiedHnsAuction } from '../../types/auction';
import type { NetworkName } from '../../lib/constants';

/**
 * AuctionLifecycleTabs
 *
 * The 5-tab lifecycle interface for the Auctions page.
 *
 * Tabs map directly to on-chain phases derived from `blockchainState`:
 *   Opened        = names this wallet opened, sourced from tx history
 *                   (stays until dismissed, independent of current phase)
 *   Active Bids   = BIDDING (also OPENING when the user already bid)
 *   Reveal Phase  = REVEAL
 *   Won           = CLOSED && userBidData.isWinner === true
 *   Lost          = REDEEM (or CLOSED && isWinner === false)
 *
 * The Won and Lost tabs each have a "Pending / Completed" sub-section split
 * so the user can see what's still actionable at a glance while keeping a
 * historical record of settled auctions.
 *
 * Tab state is persisted in localStorage so the user comes back to the same
 * tab after a restart.
 */

type LifecycleTab = 'opened' | 'active' | 'reveal' | 'won' | 'lost';
const TAB_STORAGE_KEY = 'auctions:activeTab';
const TAB_ORDER: LifecycleTab[] = ['opened', 'active', 'reveal', 'won', 'lost'];

const TAB_LABELS: Record<LifecycleTab, string> = {
  opened: 'Opened',
  active: 'Active Bids',
  reveal: 'Reveal Phase',
  won: 'Won',
  lost: 'Lost',
};

const TAB_BADGE_CLASSES: Record<LifecycleTab, string> = {
  opened: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  active: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  reveal: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  won: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  lost: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

// ============================================================
// Per-tab action payload (passed up to Auctions.tsx)
// ============================================================

export interface AuctionAction {
  name: string;
  type: string;
  loading: boolean;
  msg: string;
  ok: boolean;
}

interface AuctionLifecycleTabsProps {
  auctions: UnifiedHnsAuction[];
  network: NetworkName;
  currentAction: AuctionAction | null;
  isEncrypted: boolean;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  onPlaceBid: (name: string, bidAmount: number, lockup: number) => void;
  onReveal: (name: string) => void;
  onRevealAll: (names: string[]) => void;
  onRedeem: (name: string) => void;
  onRedeemAll?: (names: string[]) => void;
  onRegister: (name: string, records?: string) => void;
  onRegisterAll?: (names: string[]) => void;
}

// ============================================================
// Empty states
// ============================================================

function EmptyState({ kind }: { kind: LifecycleTab }) {
  const copy: Record<LifecycleTab, { title: string; subtitle: string }> = {
    opened: {
      title: 'No names opened yet',
      subtitle: 'Open a name on the Explore page to start an auction — opened names appear here with their current status.',
    },
    active: {
      title: 'No active bids',
      subtitle: 'Search for names on the Explore page to place a bid.',
    },
    reveal: {
      title: 'Nothing to reveal right now',
      subtitle: 'When the reveal phase begins for your bids, they will show here.',
    },
    won: {
      title: 'No wins yet',
      subtitle: 'Your winning auctions will appear here. Claim & register to claim the name.',
    },
    lost: {
      title: 'No losing bids to redeem',
      subtitle: 'Losing bids with locked funds will appear here.',
    },
  };
  const { title, subtitle } = copy[kind];
  return (
    <div className="card text-center py-10 text-gray-500">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs mt-1">
        {kind === 'opened' || kind === 'active' ? (
          <>
            Head to the <Link to="/explore" className="text-hns-600 hover:underline">Explore</Link> page to find names.
          </>
        ) : (
          subtitle
        )}
      </p>
    </div>
  );
}

// ============================================================
// Loading / Error overlay
// ============================================================

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-center py-10 text-gray-500 text-sm">{children}</div>
  );
}

// ============================================================
// Main component
// ============================================================

export function AuctionLifecycleTabs({
  auctions,
  network,
  currentAction,
  isEncrypted: _isEncrypted,
  isLoading,
  hasError,
  onRetry,
  onPlaceBid: _onPlaceBid,
  onReveal,
  onRevealAll,
  onRedeem,
  onRedeemAll,
  onRegister,
  onRegisterAll,
}: AuctionLifecycleTabsProps) {
  const [activeTab, setActiveTab] = useState<LifecycleTab>(() => {
    if (typeof window === 'undefined') return 'opened';
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return (TAB_ORDER as string[]).includes(stored ?? '')
      ? (stored as LifecycleTab)
      : 'opened';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {
      // localStorage may be unavailable in some contexts; safe to ignore.
    }
  }, [activeTab]);

  const openedHidden = useAuctionsStore(s => s.openedHidden);
  const openedNames = useAuctionsStore(s => s.openedNames);
  const fetchUnifiedAuctions = useAuctionsStore(s => s.fetchUnifiedAuctions);
  const justRegistered = useAuctionsStore(s => s.justRegistered);

  const buckets = useMemo(
    () => bucketAuctions(
      auctions,
      openedHidden,
      justRegistered,
      openedNames.map(o => o.name),
    ),
    [auctions, openedHidden, justRegistered, openedNames],
  );

  const handleDeleteOpened = async (name: string) => {
    await window.api.db.addOpenedHidden(name);
    await fetchUnifiedAuctions();
  };

  const handleClearOpened = async () => {
    // Only hide the rows currently visible under Opened. The old version
    // looped every auction without a bid, which could hide names that were
    // not even in the Opened list.
    await Promise.all(
      buckets.opened.map(a => window.api.db.addOpenedHidden(a.name)),
    );
    await fetchUnifiedAuctions();
  };

  const isEmpty = auctions.length === 0;

  return (
    <div className="space-y-4">
      {hasError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          Failed to load auction data.{' '}
          <button onClick={onRetry} className="underline hover:no-underline">Retry</button>
        </div>
      )}

      <Tabs value={activeTab} onChange={(v) => setActiveTab(v as LifecycleTab)}>
        <TabsList>
          <TabsTrigger
            value="opened"
            badge={buckets.opened.length || undefined}
            badgeClassName={TAB_BADGE_CLASSES.opened}
          >
            {TAB_LABELS.opened}
          </TabsTrigger>
          <TabsTrigger
            value="active"
            badge={buckets.active.length || undefined}
            badgeClassName={TAB_BADGE_CLASSES.active}
          >
            {TAB_LABELS.active}
          </TabsTrigger>
          <TabsTrigger
            value="reveal"
            badge={buckets.reveal.length || undefined}
            badgeClassName={TAB_BADGE_CLASSES.reveal}
          >
            {TAB_LABELS.reveal}
          </TabsTrigger>
          <TabsTrigger
            value="won"
            badge={
              buckets.wonPending.length + buckets.wonSettled.length || undefined
            }
            badgeClassName={TAB_BADGE_CLASSES.won}
          >
            {TAB_LABELS.won}
          </TabsTrigger>
          <TabsTrigger
            value="lost"
            badge={
              buckets.lostPending.length + buckets.lostSettled.length || undefined
            }
            badgeClassName={TAB_BADGE_CLASSES.lost}
          >
            {TAB_LABELS.lost}
          </TabsTrigger>
        </TabsList>

        {/* Opened — list/table view of names the user has opened */}
        <TabsContent value="opened">
          {isLoading && buckets.opened.length === 0 ? (
            <CenteredMessage>
              <Loader2 className="w-5 h-5 animate-spin" />
            </CenteredMessage>
          ) : isEmpty ? (
            <EmptyState kind="opened" />
          ) : buckets.opened.length === 0 ? (
            <EmptyState kind="opened" />
          ) : (
            <OpenedList auctions={buckets.opened} network={network} onDelete={handleDeleteOpened} onClearAll={handleClearOpened} />
          )}
        </TabsContent>

        {/* Active Bids — list/table view with countdown */}
        <TabsContent value="active">
          {isLoading && buckets.active.length === 0 ? (
            <CenteredMessage>
              <Loader2 className="w-5 h-5 animate-spin" />
            </CenteredMessage>
          ) : buckets.active.length === 0 ? (
            <EmptyState kind="active" />
          ) : (
            <ActiveBidsList auctions={buckets.active} network={network} />
          )}
        </TabsContent>

        {/* Reveal Phase — list/table view matching Active Bids layout */}
        <TabsContent value="reveal">
          {isLoading && buckets.reveal.length === 0 ? (
            <CenteredMessage>
              <Loader2 className="w-5 h-5 animate-spin" />
            </CenteredMessage>
          ) : buckets.reveal.length === 0 ? (
            <EmptyState kind="reveal" />
          ) : (
            <RevealPhaseList
              auctions={buckets.reveal}
              network={network}
              currentAction={currentAction}
              onReveal={onReveal}
              onRevealAll={onRevealAll}
            />
          )}
        </TabsContent>

        {/* Won — table view matching Active Bids / Reveal Phase layout */}
        <TabsContent value="won">
          {isLoading &&
          buckets.wonPending.length === 0 &&
          buckets.wonSettled.length === 0 ? (
            <CenteredMessage>
              <Loader2 className="w-5 h-5 animate-spin" />
            </CenteredMessage>
          ) : buckets.wonPending.length === 0 && buckets.wonSettled.length === 0 ? (
            <EmptyState kind="won" />
          ) : (
            <SettledPhaseList
              auctions={[...buckets.wonPending, ...buckets.wonSettled]}
              variant="won"
              currentAction={currentAction}
              justRegistered={justRegistered}
              onRedeem={onRedeem}
              onRegister={onRegister}
              onRegisterAll={onRegisterAll}
            />
          )}
        </TabsContent>

        {/* Lost — table view matching Active Bids / Reveal Phase layout */}
        <TabsContent value="lost">
          {isLoading &&
          buckets.lostPending.length === 0 &&
          buckets.lostSettled.length === 0 ? (
            <CenteredMessage>
              <Loader2 className="w-5 h-5 animate-spin" />
            </CenteredMessage>
          ) : buckets.lostPending.length === 0 && buckets.lostSettled.length === 0 ? (
            <EmptyState kind="lost" />
          ) : (
            <SettledPhaseList
              auctions={[...buckets.lostPending, ...buckets.lostSettled]}
              variant="lost"
              currentAction={currentAction}
              onRedeem={onRedeem}
              onRedeemAll={onRedeemAll}
              onRegister={onRegister}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
