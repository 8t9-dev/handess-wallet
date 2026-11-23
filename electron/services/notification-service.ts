import { EventEmitter } from 'events';
import { Notification } from 'electron';
import type { NodeService } from './node-service';
import type { WalletService } from './wallet-service';
import type { DBService } from './db-service';

const EXPIRY_CRITICAL_BLOCKS = 720;
const EXPIRY_WARNING_BLOCKS = 1440;
const EXPIRY_NOTICE_BLOCKS = 4320;

/**
 * Payload emitted to the renderer on every notification.
 * The renderer uses this to drive the bell dropdown and desktop pop-ups.
 */
export interface NotificationPayload {
  kind: 'reveal' | 'redeem' | 'register' | 'finalize' | 'expire-critical' | 'expire-warning' | 'general';
  title: string;
  body: string;
  count: number;
  /** Optional list of names this notification refers to. */
  names?: string[];
}

/**
 * Result of getPendingActions — returned to the renderer for the
 * dashboard pending-actions widget.
 */
export interface PendingActionsResult {
  pendingReveals: number;
  pendingRedeems: number;
  pendingRegistrations: number;
  pendingFinalizations: number;
  /** Sample of names in each bucket, capped at 10 for the UI. */
  pendingRevealNames: string[];
  pendingRedeemNames: string[];
  pendingRegisterNames: string[];
}

const MAX_NAMES_IN_PAYLOAD = 10;

export class NotificationService extends EventEmitter {
  private nodeService: NodeService;
  private walletService: WalletService;
  private dbService: DBService;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastBlockHeight = 0;
  private notifiedExpiryBlocks = new Set<string>();
  /** Last count we sent to the renderer per kind, so we only re-notify on change. */
  private lastNotifiedCounts: Partial<Record<NotificationPayload['kind'], number>> = {};

  constructor(nodeService: NodeService, walletService: WalletService, dbService: DBService) {
    super();
    this.nodeService = nodeService;
    this.walletService = walletService;
    this.dbService = dbService;
  }

  start(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.checkAll(), 60000);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async checkAll(): Promise<void> {
    try {
      const height = await this.nodeService.getBlockHeight();
      if (height !== this.lastBlockHeight) {
        this.lastBlockHeight = height;
        this.emit('newBlock', height);
        await this.checkExpiryAlerts(height);
        await this.checkAuctionAlerts(height);
      }
    } catch {
      // retry next poll
    }
  }

  async getExpiringNames(height: number): Promise<{ critical: Array<{ name: string; blocksLeft: number }>; warning: Array<{ name: string; blocksLeft: number }>; notice: Array<{ name: string; blocksLeft: number }> }> {
    const critical: Array<{ name: string; blocksLeft: number }> = [];
    const warning: Array<{ name: string; blocksLeft: number }> = [];
    const notice: Array<{ name: string; blocksLeft: number }> = [];

    try {
      const names = await this.walletService.getNames();
      for (const n of names) {
        const expiryBlock = n.renewalBlock ? n.renewalBlock + 105120 : null;
        if (!expiryBlock) continue;
        const remaining = expiryBlock - height;
        if (remaining <= 0) continue;
        if (remaining <= EXPIRY_CRITICAL_BLOCKS) critical.push({ name: n.name, blocksLeft: remaining });
        else if (remaining <= EXPIRY_WARNING_BLOCKS) warning.push({ name: n.name, blocksLeft: remaining });
        else if (remaining <= EXPIRY_NOTICE_BLOCKS) notice.push({ name: n.name, blocksLeft: remaining });
      }
    } catch {
      // wallet may not be ready
    }

    return { critical, warning, notice };
  }

  /**
   * Compute all pending actions that require user attention.
   *
   * Logic (phase-aware, cross-referenced with wallet auction data to
   * defeat stale `revealed` flags):
   *
   *   REVEAL  — name in REVEAL phase, user has an unrevealed bid
   *   REDEEM  — name in CLOSED phase, user has a revealed + unredeemed losing bid
   *   REGISTER — name in CLOSED phase, user won (owns the name) but hasn't sent UPDATE yet
   *   FINALIZE — wallet has an auction in CLOSING/CLOSED with a pending transfer
   */
  async getPendingActions(_height: number): Promise<PendingActionsResult> {
    let pendingReveals = 0;
    let pendingRedeems = 0;
    let pendingRegistrations = 0;
    let pendingFinalizations = 0;
    const pendingRevealNames: string[] = [];
    const pendingRedeemNames: string[] = [];
    const pendingRegisterNames: string[] = [];

    // Load locally-persisted action markers to account for the gap
    // between user action (reveal/redeem) and hsd wallet sync.
    const locallyRevealed = new Set<string>();
    const locallyRedeemed = new Set<string>();
    try {
      const revealed = this.dbService.getRevealedNames();
      if (Array.isArray(revealed)) revealed.forEach(n => locallyRevealed.add(n));
      const redeemed = this.dbService.getJustRedeemed();
      if (Array.isArray(redeemed)) redeemed.forEach(n => locallyRedeemed.add(n));
    } catch { /* DB not ready */ }

    try {
      const bids = await this.walletService.getBids();

      // Cross-reference each bid with its on-chain name state.
      const nameInfos = await Promise.allSettled(
        bids.map((b) => this.nodeService.getNameInfo(b.name)),
      );

      // Fetch wallet auction data for reliable isWinner determination.
      // walletService.getAuctions() cross-references wallet-owned names,
      // which is more reliable than comparing bid values against highest
      // (which involves unit conversion and edge cases).
      const winnerNames = new Set<string>();
      try {
        const auctions = await this.walletService.getAuctions();
        for (const a of auctions) {
          if (a.isWinner === true && a.state === 'CLOSED') {
            winnerNames.add(a.name);
          }
        }
      } catch {
        // best-effort; fall back to value comparison below
      }

      // Deduplicate by name — multiple bids on the same name should only
      // count once, matching the Dashboard and Reveal Phase tab logic.
      const seenReveal = new Set<string>();
      const seenRedeem = new Set<string>();
      const seenRegister = new Set<string>();

      for (let i = 0; i < bids.length; i++) {
        const result = nameInfos[i];
        if (result.status === 'rejected') continue;
        const info = result.value;
        const state = info.status as string;
        const bid = bids[i];

        // Trust the per-bid revealed flag from hsd's wallet RPC. Vickrey
        // privacy means only the bid owner's own REVEAL covenant reveals
        // their bid; another bidder's reveal does not reveal mine.
        // The getBids() cross-reference in wallet-service already patches
        // stale `false` flags using nameHash-based matching, so we can
        // rely on `bid.revealed` here without auction-level workarounds
        // (which were prone to false positives when the auction had any
        // reveal by other bidders).
        // Also check the locally-revealed list to account for the gap
        // between user action and hsd wallet sync.
        const isRevealed = Boolean(bid.revealed) || locallyRevealed.has(bid.name);
        const isRedeemed = Boolean(bid.redeemed) || locallyRedeemed.has(bid.name);

        if (state === 'REVEAL' && !isRevealed && !seenReveal.has(bid.name)) {
          seenReveal.add(bid.name);
          pendingReveals++;
          if (pendingRevealNames.length < MAX_NAMES_IN_PAYLOAD) pendingRevealNames.push(bid.name);
        } else if (state === 'CLOSED' && isRevealed && !isRedeemed && !seenRedeem.has(bid.name)) {
          seenRedeem.add(bid.name);
          pendingRedeems++;
          if (pendingRedeemNames.length < MAX_NAMES_IN_PAYLOAD) pendingRedeemNames.push(bid.name);
        } else if (state === 'CLOSED' && isRevealed && !isRedeemed && !seenRegister.has(bid.name)) {
          // Determine if the user won: prefer wallet's isWinner from
          // getAuctions() (which checks wallet-owned names), fall back
          // to comparing bid value against highest (normalized to dollarydoos).
          const isWinner = winnerNames.has(bid.name)
            || (typeof info.highestBid === 'number' && bid.value >= info.highestBid * 1_000_000);
          if (isWinner) {
            seenRegister.add(bid.name);
            pendingRegistrations++;
            if (pendingRegisterNames.length < MAX_NAMES_IN_PAYLOAD) pendingRegisterNames.push(bid.name);
          }
        }
      }

      // getAuctions is best-effort (may fail when node is catching up);
      // don't let failure here lose the reveal/redeem/register counts.
      try {
        const walletAuctions = await this.walletService.getAuctions();
        for (const a of walletAuctions) {
          const state = a.state as string;
          if (state === 'CLOSING' || state === 'CLOSED') {
            pendingFinalizations++;
          }
        }
      } catch {
        // auctions may not be ready — finalization count stays 0
      }
    } catch {
      // wallet may not be ready
    }

    return {
      pendingReveals,
      pendingRedeems,
      pendingRegistrations,
      pendingFinalizations,
      pendingRevealNames,
      pendingRedeemNames,
      pendingRegisterNames,
    };
  }

  private async checkExpiryAlerts(height: number): Promise<void> {
    try {
      const expiring = await this.getExpiringNames(height);
      // Critical alerts.
      for (const item of expiring.critical) {
        const key = `${item.name}:critical`;
        if (this.notifiedExpiryBlocks.has(key)) continue;
        this.notifiedExpiryBlocks.add(key);
        this.sendNotification({
          kind: 'expire-critical',
          title: `Name Expiry CRITICAL: ${item.name}`,
          body: `${item.name} expires in ${item.blocksLeft} blocks (~${Math.round(item.blocksLeft * 10 / 3600)}h). Renew now to avoid losing the name.`,
          count: 1,
          names: [item.name],
        });
      }
      // Warning alerts.
      for (const item of expiring.warning) {
        const key = `${item.name}:warning`;
        if (this.notifiedExpiryBlocks.has(key)) continue;
        this.notifiedExpiryBlocks.add(key);
        this.sendNotification({
          kind: 'expire-warning',
          title: `Name Expiry Warning: ${item.name}`,
          body: `${item.name} expires in ${item.blocksLeft} blocks (~${Math.round(item.blocksLeft * 10 / 3600)}h). Consider renewing soon.`,
          count: 1,
          names: [item.name],
        });
      }
    } catch {
      // retry next poll
    }
  }

  private async checkAuctionAlerts(height: number): Promise<void> {
    try {
      const actions = await this.getPendingActions(height);

      // REVEAL
      if (actions.pendingReveals > 0) {
        this.maybeSend('reveal', actions.pendingReveals, actions.pendingRevealNames, () => ({
          kind: 'reveal',
          title: '⚠️ Pending Reveals',
          body: `You have ${actions.pendingReveals} name${actions.pendingReveals === 1 ? '' : 's'} to reveal. Reveal before the deadline or lose your bid.`,
        }));
      } else {
        this.clearNotified('reveal');
      }

      // REDEEM
      if (actions.pendingRedeems > 0) {
        this.maybeSend('redeem', actions.pendingRedeems, actions.pendingRedeemNames, () => ({
          kind: 'redeem',
          title: '⚠️ Pending Redeems',
          body: `You have ${actions.pendingRedeems} losing bid${actions.pendingRedeems === 1 ? '' : 's'} to redeem and recover your locked HNS.`,
        }));
      } else {
        this.clearNotified('redeem');
      }

      // REGISTER
      if (actions.pendingRegistrations > 0) {
        this.maybeSend('register', actions.pendingRegistrations, actions.pendingRegisterNames, () => ({
          kind: 'register',
          title: '⚠️ Auctions Won — Claim Your Names',
          body: `You won ${actions.pendingRegistrations} auction${actions.pendingRegistrations === 1 ? '' : 's'}. Claim & register the names to take ownership.`,
        }));
      } else {
        this.clearNotified('register');
      }
    } catch {
      // retry next poll
    }
  }

  /**
   * De-duplication helper.
   *
   * We only re-notify when the count actually changes (e.g. user just
   * revealed one of three pending bids). The desktop pop-up is shown
   * alongside the in-app bell notification every time, so the user
   * gets up-to-date info without spam.
   */
  private maybeSend(
    kind: NotificationPayload['kind'],
    count: number,
    names: string[],
    build: () => Omit<NotificationPayload, 'count' | 'names'>,
  ): void {
    const last = this.lastNotifiedCounts[kind];
    if (last === count) return;
    this.lastNotifiedCounts[kind] = count;
    const base = build();
    this.sendNotification({ ...base, count, names: names.slice(0, MAX_NAMES_IN_PAYLOAD) });
  }

  private clearNotified(kind: NotificationPayload['kind']): void {
    if (this.lastNotifiedCounts[kind] !== undefined) {
      this.lastNotifiedCounts[kind] = undefined;
    }
  }

  private sendNotification(payload: NotificationPayload): void {
    if (Notification.isSupported()) {
      new Notification({
        title: `Handess Wallet — ${payload.title}`,
        body: payload.body,
      }).show();
    }
    this.emit('notification', payload);
  }
}
