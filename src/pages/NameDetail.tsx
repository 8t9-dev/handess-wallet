import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Gavel, Loader2,
  Copy, CheckCircle2, Clock, Hash,
} from 'lucide-react';
import { useConnectionStore } from '../stores/connection-store';
import type { NameDetail as NameDetailType } from '../types/explore';
import type { Auction, Bid, Reveal } from '../types/auction';
import {
  toUnicode, dollaryDoosToHNS, blocksToTimeLeft,
  getNameMetadata, formatNameHash,
} from '../lib/name-utils';
import { NETWORKS } from '../lib/constants';
import type { NetworkName } from '../lib/constants';
import { formatResourceRecord } from '../lib/record-helpers';
import { BidModal } from '../components/batch/BidModal';
import { PassphraseModal } from '../components/common/PassphraseModal';

const HNS_DECIMALS = 6;

function formatHNS(dollarydoos: number): string {
  const hns = dollaryDoosToHNS(dollarydoos);
  return hns.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: HNS_DECIMALS });
}

function statusBadge(state: string): { label: string; cls: string } {
  switch (state) {
    case 'OPENING': return { label: 'Opening', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'BIDDING': return { label: 'Bidding', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' };
    case 'REVEAL': return { label: 'Reveal', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };
    case 'CLOSED': return { label: 'Closed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    case 'AVAILABLE': return { label: 'Available', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
    case 'REVOKED': return { label: 'Revoked', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    case 'RESERVED': return { label: 'Reserved', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' };
    default: return { label: state, cls: 'bg-gray-100 text-gray-700' };
  }
}

/**
 * Format a UTC date in the user's locale.
 * If the date is null, returns null. The page should decide what to render.
 */
function formatDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Resolve a block's timestamp. Past blocks use the real header time from the
 * node; future blocks are clearly marked estimates from the network's target
 * block time. Mempool (height=0) is shown as such.
 */
function blockTimestamp(
  block: number,
  currentBlock: number,
  blockTimes: Record<number, number>,
  network: NetworkName,
): { display: string; iso: string | null; estimated: boolean } {
  if (!block || block <= 0) return { display: 'Mempool', iso: null, estimated: false };

  const actual = blockTimes[block];
  if (actual) {
    const date = new Date(actual * 1000);
    return { display: formatDate(date) || '—', iso: date.toISOString(), estimated: false };
  }

  if (block > currentBlock) {
    const ms = NETWORKS[network].blockTimeMinutes * 60 * 1000;
    const date = new Date(Date.now() + (block - currentBlock) * ms);
    return {
      display: `${formatDate(date) || '—'} (est.)`,
      iso: date.toISOString(),
      estimated: true,
    };
  }

  // A historical block should always be fetchable; don't fabricate a date.
  return { display: 'Unknown', iso: null, estimated: false };
}

export function NameDetail() {
  const { name } = useParams<{ name: string }>();
  const { connectionState, walletInfo, blockHeight, network: connectionNetwork } = useConnectionStore();
  const network = (
    connectionNetwork === 'testnet' || connectionNetwork === 'regtest'
      ? connectionNetwork
      : 'main'
  ) as NetworkName;
  const [detail, setDetail] = useState<NameDetailType | null>(null);
  const [walletAuction, setWalletAuction] = useState<Auction | null>(null);
  const [blockTimes, setBlockTimes] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [showBid, setShowBid] = useState(false);

  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openSuccess, setOpenSuccess] = useState(false);
  const [showPassphraseForOpen, setShowPassphraseForOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    const [nodeDetail, auction] = await Promise.all([
      window.api.node.getNameDetail(name).catch(() => null),
      window.api.wallet.getAuctionInfo(name).catch(() => null),
    ]);
    setDetail(nodeDetail);
    setWalletAuction(auction);

    if (nodeDetail) {
      const heights = [
        nodeDetail.openHeight,
        nodeDetail.biddingStart,
        nodeDetail.revealStart,
        nodeDetail.auctionClose,
        nodeDetail.renewal ?? 0,
        nodeDetail.claim ?? 0,
        nodeDetail.revoked ?? 0,
        nodeDetail.transfer ?? 0,
        ...((auction?.bids || []).map((bid) => bid.height)),
        ...((auction?.reveals || []).map((reveal) => reveal.height)),
      ].filter((height) => Number.isInteger(height) && height > 0);
      const times = await window.api.node.getBlockTimes(heights).catch(() => ({}));
      setBlockTimes(times);
    } else {
      setBlockTimes({});
    }

    setLoading(false);
  }, [name]);

  useEffect(() => {
    if (connectionState !== 'connected' || !name) return;
    fetchData();
  }, [name, connectionState, fetchData]);

  const handleBid = async (n: string, bid: number, lockup: number, passphrase: string) => {
    await window.api.wallet.sendBid(n, bid, lockup, passphrase);
    await fetchData();
  };

  const triggerOpenAuction = () => {
    if (walletInfo?.master?.encrypted) {
      setShowPassphraseForOpen(true);
    } else {
      handleOpen('');
    }
  };

  const handleOpen = async (passphrase: string) => {
    setOpening(true);
    setOpenError(null);
    setOpenSuccess(false);
    try {
      await window.api.wallet.sendOpen(name!, passphrase);
      setOpenSuccess(true);
      await fetchData();
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Failed to open auction');
    } finally {
      setOpening(false);
    }
  };

  if (connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
        <p className="text-gray-500">Connect to your full node to view name details.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-gray-400">Loading name details...</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-gray-400">Name &quot;{name}&quot; not found.</div>
        <div className="text-center">
          <Link to="/explore" className="text-hns-600 hover:underline">Back to Explorer</Link>
        </div>
      </div>
    );
  }

  // Fall back to wallet auction state when node returns AVAILABLE
  // (getnameinfo can return null for names the wallet has bid on if
  // the node's NameState DB is out of sync or the wallet learned of
  // the auction through a bid covenant from a different wallet).
  const effectiveState = detail.state === 'AVAILABLE' && walletAuction?.state
    ? walletAuction.state === 'CLOSED' ? 'CLOSED' : walletAuction.state
    : detail.state;
  const badge = statusBadge(effectiveState);
  const displayName = toUnicode(detail.name);
  const isInAuction = ['OPENING', 'BIDDING', 'REVEAL'].includes(effectiveState);
  const canBid = ['OPENING', 'BIDDING'].includes(effectiveState);
  const isAvailable = effectiveState === 'AVAILABLE';
  const isRevoked = effectiveState === 'REVOKED';

  // Auction stats computed from wallet auction data
  const walletBids = walletAuction?.bids || [];
  const walletReveals = walletAuction?.reveals || [];
  const totalBids = walletBids.length;
  const totalReveals = walletReveals.length;
  const totalLockup = walletBids.reduce((s, b) => s + b.lockup, 0);
  const totalBidValue = walletBids.filter(b => b.revealed).reduce((s, b) => s + (b.value || 0), 0);
  const totalBlinds = walletBids.reduce((s, b) => s + (b.lockup - (b.revealed ? (b.value || 0) : 0)), 0);
  const unrevealedCount = walletBids.filter(b => !b.revealed).length;
  const highestLockup = walletBids.reduce((max, b) => Math.max(max, b.lockup), 0);
  const highestBidValue = walletBids.filter(b => b.revealed).reduce((max, b) => Math.max(max, b.value || 0), 0);
  const resultValue = detail.highest > 0 ? detail.highest : highestBidValue;

  // Derived: name metadata (Type, Length, Script, etc.) + lifecycle info.
  // Cheap pure computation — no need to memoize, and we can compute it
  // after the early-return guards because it's not a React hook.
  const metadata = getNameMetadata(detail.name);

  return (
    <div className="p-6 space-y-6">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Link to="/explore" className="flex items-center gap-1 text-sm text-hns-600 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Explorer
        </Link>
      </div>

      {showBid && name && (
        <BidModal name={name} onClose={() => setShowBid(false)} onBid={handleBid} />
      )}

      {/* =================================================== */}
      {/* Name Header */}
      {/* =================================================== */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">{displayName}</h1>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${badge.cls}`}>{badge.label}</span>
        {detail.name !== displayName && (
          <span className="text-xs text-gray-400 font-mono">{detail.name}</span>
        )}
        <div className="flex gap-2 ml-auto flex-wrap">
          {canBid && (
            <button onClick={() => setShowBid(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium">
              <Gavel className="w-4 h-4" /> Bid Now
            </button>
          )}
          {isAvailable && (
            <button onClick={triggerOpenAuction} disabled={opening}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50">
              {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gavel className="w-4 h-4" />}
              {opening ? 'Opening...' : 'Open Auction'}
            </button>
          )}
        </div>
      </div>

      {openError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm">{openError}</div>
      )}
      {openSuccess && (
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 text-sm">
          Auction successfully opened!
        </div>
      )}

      {showPassphraseForOpen && (
        <PassphraseModal
          title="Open Auction"
          onSubmit={(pwd) => { setShowPassphraseForOpen(false); handleOpen(pwd); }}
          onCancel={() => setShowPassphraseForOpen(false)}
        />
      )}

      {/* =================================================== */}
      {/* Top row: Name Metadata + Lifecycle */}
      {/* =================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NameMetadataCard metadata={metadata} nameHash={detail.nameHash} />
        <LifecycleCard
          detail={detail}
          blockHeight={blockHeight}
          blockTimes={blockTimes}
          network={network}
        />
      </div>

      {/* =================================================== */}
      {/* Visual Timeline */}
      {/* =================================================== */}
      {(isInAuction || detail.openHeight > 0) && (
        <PhaseTimeline
          detail={detail}
          blockHeight={blockHeight}
          effectiveState={effectiveState}
          blockTimes={blockTimes}
          network={network}
        />
      )}

      <NameEvents
        detail={detail}
        blockHeight={blockHeight}
        blockTimes={blockTimes}
        network={network}
      />

      {/* =================================================== */}
      {/* Name Details + Blockchain Info */}
      {/* =================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wider">Name Details</h3>
          <InfoRow label="State" value={badge.label} />
          <InfoRow
            label="Owner"
            value={detail.owner
              ? <span className="font-mono text-xs">{formatNameHash(detail.owner, 10, 8)}</span>
              : '—'}
          />
          <InfoRow label="Value Locked" value={`${formatHNS(detail.value)} HNS`} />
          {detail.renewals > 0 && <InfoRow label="Renewals" value={String(detail.renewals)} />}
          {detail.claim != null && <InfoRow label="Claimed" value={`Block ${detail.claim.toLocaleString()}`} />}
          {detail.revoked != null && <InfoRow label="Revoked" value={`Block ${detail.revoked.toLocaleString()}`} />}
          {detail.reserved && <InfoRow label="Reserved" value="Yes (ICANN)" />}
          {isRevoked && <InfoRow label="Revoked At" value={`Block ${detail.revoked?.toLocaleString() || '—'}`} />}
        </div>
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wider">Blockchain Info</h3>
          {detail.openHeight > 0 && (
            <>
              <InfoRow label="Open Block" value={detail.openHeight.toLocaleString()} />
              {isInAuction && detail.biddingStart > 0 && (
                <InfoRow label="Bidding Starts" value={phaseEstimate(detail.biddingStart, blockHeight, blockTimes, network)} />
              )}
              {detail.revealStart > 0 && (
                <InfoRow label="Reveal Starts" value={phaseEstimate(detail.revealStart, blockHeight, blockTimes, network)} />
              )}
              {detail.auctionClose > 0 && (
                <InfoRow label="Auction Close" value={phaseEstimate(detail.auctionClose, blockHeight, blockTimes, network)} />
              )}
            </>
          )}
          {isInAuction && detail.nextPhaseBlock > 0 && detail.blocksUntilNext != null && (
            <InfoRow
              label="Next Phase In"
              value={detail.blocksUntilNext > 0
                ? `${detail.blocksUntilNext.toLocaleString()} blocks (${blocksToTimeLeft(detail.blocksUntilNext, network)})`
                : 'Transitioning'}
            />
          )}
          {!isInAuction && detail.expiryBlock && (
            <InfoRow label="Expiry Block" value={detail.expiryBlock.toLocaleString()} />
          )}
          {detail.highest > 0 && (
            <InfoRow label="Highest Bid" value={`${formatHNS(detail.highest)} HNS`} />
          )}
        </div>
      </div>

      {/* =================================================== */}
      {/* Auction Details (from wallet data if available) */}
      {/* =================================================== */}
      {totalBids > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4">Auction Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatBox label="State" value={badge.label} />
            <StatBox label="Result" value={`${formatHNS(resultValue)} HNS`} />
            <StatBox label="Bids" value={String(totalBids)} />
            <StatBox label="Reveals" value={String(totalReveals)} />
            <StatBox label="Lockup Total" value={`${formatHNS(totalLockup)} HNS`} />
            <StatBox label="Unrevealed" value={unrevealedCount > 0 ? String(unrevealedCount) : '—'} />
            <StatBox label="Bid Value Total" value={`${formatHNS(totalBidValue)} HNS`} />
            <StatBox label="Blinds Total" value={`${formatHNS(totalBlinds)} HNS`} />
            <StatBox label="Highest Lockup" value={`${formatHNS(highestLockup)} HNS`} />
            {highestBidValue > 0 && (
              <StatBox label="Highest Bid" value={`${formatHNS(highestBidValue)} HNS`} />
            )}
          </div>
        </div>
      )}

      {/* =================================================== */}
      {/* Bids Table (with date column) */}
      {/* =================================================== */}
      {walletBids.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4">Bids ({totalBids})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">Block</th>
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Lockup</th>
                  <th className="pb-2 pr-3 font-medium">Bid</th>
                  <th className="pb-2 pr-3 font-medium">Blind</th>
                  <th className="pb-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {walletBids.map((b, i) => {
                  const blindAmt = b.lockup - (b.revealed ? (b.value || 0) : 0);
                  let bidState = 'Unrevealed';
                  if (b.redeemed) bidState = 'Redeemed';
                  else if (b.revealed && walletAuction?.isWinner === true) bidState = 'Registered';
                  else if (b.revealed) bidState = 'Revealed';
                  const ts = blockTimestamp(b.height, blockHeight, blockTimes, network);
                  return (
                    <tr key={b.txHash || i} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="py-2.5 pr-3 text-gray-500">{i + 1}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{b.height > 0 ? b.height.toLocaleString() : '—'}</td>
                      <td className="py-2.5 pr-3 text-xs text-gray-500">{ts.display}</td>
                      <td className="py-2.5 pr-3 font-mono">{formatHNS(b.lockup)} HNS</td>
                      <td className="py-2.5 pr-3 font-mono">{b.revealed ? `${formatHNS(b.value)} HNS` : '—'}</td>
                      <td className="py-2.5 pr-3 font-mono">{blindAmt > 0 ? `${formatHNS(blindAmt)} HNS` : '—'}</td>
                      <td className="py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          bidState === 'Registered' ? 'bg-green-100 text-green-700' :
                          bidState === 'Redeemed' ? 'bg-gray-100 text-gray-600' :
                          bidState === 'Revealed' ? 'bg-orange-100 text-orange-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>{bidState}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================== */}
      {/* Covenants History (from wallet bid/reveal data) */}
      {/* =================================================== */}
      {(walletBids.length > 0 || walletReveals.length > 0) && (
        <CovenantsTable
          bids={walletBids}
          reveals={walletReveals}
          blockHeight={blockHeight}
          blockTimes={blockTimes}
          network={network}
        />
      )}

      {/* =================================================== */}
      {/* DNS Records Section (read-only on this page; use */}
      {/* My Domains to edit records for names you own) */}
      {/* =================================================== */}
      <div className="card">
        <h3 className="font-semibold mb-4">Resource Records ({detail.records.length})</h3>
        {detail.records.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 pr-3 font-medium">Type</th>
                  <th className="pb-2 pr-3 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {detail.records.map((rec, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2.5 pr-3 font-mono text-xs">{rec.type}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs break-all">
                      {formatResourceRecord(rec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-4 text-gray-400 text-sm">No resource records</div>
        )}
        <p className="mt-3 text-xs text-gray-500">
          To edit DNS records, go to <Link to="/domains" className="text-hns-600 hover:underline">My Domains</Link>.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function phaseEstimate(
  targetBlock: number,
  currentBlock: number,
  blockTimes: Record<number, number>,
  network: NetworkName,
): string {
  const actual = dateForBlock(targetBlock, blockTimes);
  if (actual) return `${targetBlock.toLocaleString()} · ${formatDate(actual)}`;

  if (targetBlock <= currentBlock) {
    return `${targetBlock.toLocaleString()} · passed`;
  }

  return `${targetBlock.toLocaleString()} (~${blocksToTimeLeft(targetBlock - currentBlock, network)}, est.)`;
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-500 text-sm min-w-[110px] shrink-0">{label}</span>
      <span className={`text-sm break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold font-mono">{value}</div>
    </div>
  );
}

// ============================================================
// NameMetadataCard
// ============================================================
//
// Identity info: Type, Length, Script, Composition, IDNA2008 status,
// and the 64-char name hash. Mirrors what explorers like shakeshift
// display as the "metadata" panel.
// ============================================================

function NameMetadataCard({
  metadata, nameHash,
}: { metadata: ReturnType<typeof getNameMetadata>; nameHash: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopyHash = useCallback(() => {
    if (!nameHash) return;
    navigator.clipboard?.writeText(nameHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [nameHash]);

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wider">Name Metadata</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <InfoRow label="Type" value={metadata.type} />
        <InfoRow label="Length" value={String(metadata.length)} />
        <InfoRow label="Code Points" value={String(metadata.codePoints)} />
        <InfoRow label="Graphemes" value={String(metadata.graphemes)} />
        <InfoRow label="Script" value={metadata.script} />
        <InfoRow label="Composition" value={metadata.composition} />
        <InfoRow
          label="Requires Unicode"
          value={metadata.requiresUnicode ? 'Yes (1993+)' : 'No (ASCII only)'}
        />
        <InfoRow
          label="IDNA2008"
          value={metadata.idna2008Compliant ? 'Compliant' : 'Non-Compliant'}
        />
      </div>
      {nameHash && (
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Hash className="w-3 h-3" /> Name Hash
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all flex-1">
              {nameHash}
            </code>
            <button
              onClick={handleCopyHash}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Copy hash"
            >
              {copied
                ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                : <Copy className="w-4 h-4 text-gray-400" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// LifecycleCard
// ============================================================
//
// Lifecycle info: mint block + date estimate, current cycle, age,
// renewal block, expiry. Uses block→time math (10 min/block) since
// hsd's getnameinfo doesn't return historical mint dates.
// ============================================================

function dateForBlock(
  block: number | null | undefined,
  blockTimes: Record<number, number>,
): Date | null {
  if (!block || block <= 0) return null;
  const time = blockTimes[block];
  return time ? new Date(time * 1000) : null;
}

function estimateBlockDate(
  targetBlock: number,
  currentBlock: number,
  network: NetworkName,
): Date | null {
  if (targetBlock <= 0 || currentBlock <= 0 || targetBlock <= currentBlock) return null;
  const minutes = (targetBlock - currentBlock) * NETWORKS[network].blockTimeMinutes;
  return new Date(Date.now() + minutes * 60_000);
}

function NameEvents({
  detail, blockHeight, blockTimes, network,
}: {
  detail: NameDetailType;
  blockHeight: number;
  blockTimes: Record<number, number>;
  network: NetworkName;
}) {
  const events: Array<{ label: string; block: number; tone: string }> = [];
  const add = (label: string, block: number | null | undefined, tone = 'text-gray-600 dark:text-gray-300') => {
    if (block && block > 0) events.push({ label, block, tone });
  };

  const isClaimed = Boolean(detail.claim && detail.claim > 0);
  const inAuction = ['OPENING', 'BIDDING', 'REVEAL'].includes(detail.state);
  if (!isClaimed) {
    add('Auction opened', detail.openHeight);
    add('Bidding started', detail.biddingStart);
    add('Reveal started', detail.revealStart);
    add('Auction closed', detail.auctionClose);
  } else {
    add('Name claimed', detail.claim);
    add('Claim lockup ends', detail.lockupEnd);
  }
  if (!inAuction) add('Last renewal', detail.renewal);
  add('Transfer started', detail.transfer);
  add('Revoked', detail.revoked);
  if (!inAuction) add('Expiry (estimated)', detail.expiryBlock);

  if (events.length === 0) return null;
  events.sort((a, b) => a.block - b.block);

  return (
    <div className="card">
      <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wider mb-3">Name Events</h3>
      <ul className="space-y-2">
        {events.map((event) => {
          const actual = dateForBlock(event.block, blockTimes);
          const future = !actual && event.block > blockHeight
            ? estimateBlockDate(event.block, blockHeight, network)
            : null;
          const date = actual || future;
          return (
            <li key={`${event.label}-${event.block}`} className="flex items-center justify-between gap-3 text-sm">
              <span className={`flex items-center gap-2 ${event.tone}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-hns-500" />
                {event.label}
              </span>
              <span className="text-right text-xs text-gray-500 dark:text-gray-400">
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  Block {event.block.toLocaleString()}
                </span>
                {date && (
                  <span className="ml-2">
                    {formatDate(date)}{!actual && future ? ' (est.)' : ''}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-gray-400">
        Chain events are derived from the current name state. Your bid and reveal history is
        listed separately below.
      </p>
    </div>
  );
}

function LifecycleCard({
  detail, blockHeight, blockTimes, network,
}: {
  detail: NameDetailType;
  blockHeight: number;
  blockTimes: Record<number, number>;
  network: NetworkName;
}) {
  const inAuction = ['OPENING', 'BIDDING', 'REVEAL'].includes(detail.state);
  const lifecycleStartTs = dateForBlock(detail.openHeight, blockTimes);
  const lifecycleAgeDays = lifecycleStartTs
    ? Math.floor((Date.now() - lifecycleStartTs.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const renewalTs = dateForBlock(detail.renewal, blockTimes);
  const claimTs = dateForBlock(detail.claim, blockTimes);
  const revokedTs = dateForBlock(detail.revoked, blockTimes);
  const transferTs = dateForBlock(detail.transfer, blockTimes);
  const lockupTs = detail.lockupEnd
    ? (dateForBlock(detail.lockupEnd, blockTimes)
      ?? estimateBlockDate(detail.lockupEnd, blockHeight, network))
    : null;
  const expiryTs = estimateBlockDate(detail.expiryBlock ?? 0, blockHeight, network);

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wider">Lifecycle</h3>
      {detail.openHeight > 0 ? (
        <>
          <InfoRow
            label="Lifecycle Start"
            value={
              <span>
                Block {detail.openHeight.toLocaleString()}
                {lifecycleStartTs && (
                  <span className="text-gray-400 text-xs ml-1">· {formatDate(lifecycleStartTs)}</span>
                )}
              </span>
            }
          />
          {lifecycleAgeDays !== null && (
            <InfoRow
              label="Lifecycle Age"
              value={lifecycleAgeDays >= 365
                ? `${Math.floor(lifecycleAgeDays / 365)} yr ${Math.floor((lifecycleAgeDays % 365) / 30)} mo`
                : lifecycleAgeDays >= 30
                  ? `${Math.floor(lifecycleAgeDays / 30)} mo ${lifecycleAgeDays % 30} d`
                  : `${lifecycleAgeDays} day${lifecycleAgeDays === 1 ? '' : 's'}`}
            />
          )}
          <InfoRow label="Lifecycle #" value={String(detail.renewals + 1)} />
          {detail.value > 0 && (
            <InfoRow label="Name Value" value={`${formatHNS(detail.value)} HNS`} />
          )}
        </>
      ) : (
        <div className="text-sm text-gray-400">
          {detail.claim
            ? 'Claimed name — no auction lifecycle.'
            : 'No lifecycle data — name is available.'}
        </div>
      )}

      {detail.claim != null && detail.claim > 0 && (
        <InfoRow
          label="Claimed"
          value={
            <span>
              Block {detail.claim.toLocaleString()}
              {claimTs && <span className="text-gray-400 text-xs ml-1">· {formatDate(claimTs)}</span>}
            </span>
          }
        />
      )}
      {detail.lockupEnd != null && detail.lockupEnd > 0 && (
        <InfoRow
          label="Lockup Ends"
          value={
            <span>
              Block {detail.lockupEnd.toLocaleString()}
              {lockupTs && (
                <span className="text-gray-400 text-xs ml-1">
                  · {formatDate(lockupTs)}{detail.lockupEnd > blockHeight ? ' (est.)' : ''}
                </span>
              )}
            </span>
          }
        />
      )}
      {!inAuction && detail.renewal != null && detail.renewal > 0 && (
        <InfoRow
          label="Last Renewal"
          value={
            <span>
              Block {detail.renewal.toLocaleString()}
              {renewalTs && <span className="text-gray-400 text-xs ml-1">· {formatDate(renewalTs)}</span>}
            </span>
          }
        />
      )}
      {detail.transfer != null && detail.transfer > 0 && (
        <InfoRow
          label="Transfer Started"
          value={
            <span>
              Block {detail.transfer.toLocaleString()}
              {transferTs && <span className="text-gray-400 text-xs ml-1">· {formatDate(transferTs)}</span>}
            </span>
          }
        />
      )}
      {detail.revoked != null && detail.revoked > 0 && (
        <InfoRow
          label="Revoked"
          value={
            <span>
              Block {detail.revoked.toLocaleString()}
              {revokedTs && <span className="text-gray-400 text-xs ml-1">· {formatDate(revokedTs)}</span>}
            </span>
          }
        />
      )}
      {!inAuction && detail.expiryBlock != null && detail.expiryBlock > 0 && (
        <InfoRow
          label="Expires"
          value={
            <span>
              Block {detail.expiryBlock.toLocaleString()}
              {expiryTs && <span className="text-gray-400 text-xs ml-1">· {formatDate(expiryTs)} (est.)</span>}
            </span>
          }
        />
      )}
    </div>
  );
}

// ============================================================
// PhaseTimeline
// ============================================================
//
// Visual horizontal timeline of the auction lifecycle. Each phase
// shows its block + estimated date. The current state is highlighted
// and a vertical marker indicates "now".
// ============================================================

function PhaseTimeline({
  detail, blockHeight, effectiveState, blockTimes, network,
}: {
  detail: NameDetailType;
  blockHeight: number;
  effectiveState: string;
  blockTimes: Record<number, number>;
  network: NetworkName;
}) {
  // Claimed names have no auction phases; their height is the claim block.
  if (detail.claim != null && detail.claim > 0) return null;

  const phases: Array<{
    key: string;
    label: string;
    block: number;
    icon: React.ReactNode;
    cls: string;
  }> = [];

  // Available phase is implicit: the block before openHeight
  if (detail.openHeight > 0) {
    phases.push({
      key: 'opening',
      label: 'Auction Opened',
      block: detail.openHeight,
      icon: <Gavel className="w-3 h-3" />,
      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    });
  }
  if (detail.biddingStart > 0) {
    phases.push({
      key: 'bidding',
      label: 'Bidding Period',
      block: detail.biddingStart,
      icon: <Gavel className="w-3 h-3" />,
      cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    });
  }
  if (detail.revealStart > 0) {
    phases.push({
      key: 'reveal',
      label: 'Reveal Period',
      block: detail.revealStart,
      icon: <Clock className="w-3 h-3" />,
      cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    });
  }
  if (detail.auctionClose > 0) {
    phases.push({
      key: 'close',
      label: 'Auction Close',
      block: detail.auctionClose,
      icon: <CheckCircle2 className="w-3 h-3" />,
      cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    });
  }

  if (phases.length === 0) return null;

  // Determine the "current" phase index
  const currentIdx = phases.findIndex(p => {
    if (effectiveState === 'OPENING') return p.key === 'opening';
    if (effectiveState === 'BIDDING') return p.key === 'bidding';
    if (effectiveState === 'REVEAL') return p.key === 'reveal';
    if (effectiveState === 'CLOSED' || effectiveState === 'REVOKED') return p.key === 'close';
    return -1;
  });

  return (
    <div className="card">
      <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wider mb-4">Timeline</h3>
      <div className="relative pt-6 pb-2">
        {/* Connector line */}
        <div className="absolute left-0 right-0 top-[2.25rem] h-0.5 bg-gray-200 dark:bg-gray-700" />
        {/* Phase markers */}
        <div className="flex justify-between relative">
          {phases.map((p, i) => {
            const actual = dateForBlock(p.block, blockTimes);
            const future = p.block > blockHeight ? estimateBlockDate(p.block, blockHeight, network) : null;
            const ts = actual || future;
            const estimated = !actual && Boolean(future);
            const isCurrent = i === currentIdx;
            const isPast = blockHeight > 0 && p.block > 0 && p.block <= blockHeight;
            return (
              <div key={p.key} className="flex flex-col items-center" style={{ flex: 1 }}>
                {/* Marker dot */}
                <div
                  className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                    isCurrent
                      ? 'bg-hns-500 border-hns-700 text-white ring-4 ring-hns-200 dark:ring-hns-900/40'
                      : isPast
                        ? 'bg-green-500 border-green-700 text-white'
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-400'
                  }`}
                >
                  {p.icon}
                </div>
                <div className={`mt-2 text-[10px] uppercase tracking-wide font-semibold ${isCurrent ? 'text-hns-700 dark:text-hns-300' : 'text-gray-500'}`}>
                  {p.label}
                </div>
                <div className="text-[11px] font-mono text-gray-700 dark:text-gray-300">
                  {p.block > 0 ? p.block.toLocaleString() : '—'}
                </div>
                <div className="text-[10px] text-gray-400">
                  {ts ? `${formatDate(ts)}${estimated ? ' (est.)' : ''}` : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CovenantsTable
// ============================================================
//
// User's covenant history (BID + REVEAL covenants for the wallet).
// For names the wallet has bid on, this is the source of truth.
// Full chain-wide covenant history would require a block scan.
// ============================================================

function CovenantsTable({
  bids, reveals, blockHeight, blockTimes, network,
}: {
  bids: Bid[];
  reveals: Reveal[];
  blockHeight: number;
  blockTimes: Record<number, number>;
  network: NetworkName;
}) {
  type Row = {
    type: 'BID' | 'REVEAL' | 'REDEEM' | 'REGISTER';
    block: number;
    value: number | null;
    txid: string;
  };

  const rows: Row[] = [
    ...bids.map(b => ({
      type: 'BID' as const,
      block: b.height,
      value: b.revealed ? b.value : null, // revealed: real bid; unrevealed: hidden
      txid: b.txHash,
    })),
    ...reveals.map(r => ({
      type: 'REVEAL' as const,
      block: r.height,
      value: r.value,
      txid: r.txHash,
    })),
  ].sort((a, b) => b.block - a.block); // newest first

  return (
    <div className="card">
      <h3 className="font-semibold mb-1">Covenants</h3>
      <p className="text-xs text-gray-500 mb-4">
        Your covenant history for this name. Full chain-wide history requires a block scan.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
              <th className="pb-2 pr-3 font-medium">Type</th>
              <th className="pb-2 pr-3 font-medium">Block</th>
              <th className="pb-2 pr-3 font-medium">Date</th>
              <th className="pb-2 pr-3 font-medium">Value</th>
              <th className="pb-2 font-medium">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ts = blockTimestamp(r.block, blockHeight, blockTimes, network);
              const typeCls = r.type === 'BID' ? 'bg-blue-100 text-blue-700'
                : r.type === 'REVEAL' ? 'bg-orange-100 text-orange-700'
                : r.type === 'REDEEM' ? 'bg-gray-100 text-gray-700'
                : 'bg-green-100 text-green-700';
              return (
                <tr key={`${r.type}-${r.txid}-${i}`} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-2.5 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeCls}`}>{r.type}</span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs">{r.block > 0 ? r.block.toLocaleString() : '—'}</td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500">{ts.display}</td>
                  <td className="py-2.5 pr-3 font-mono">
                    {r.value != null ? `${formatHNS(r.value)} HNS` : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2.5 font-mono text-xs text-gray-500">
                    {r.txid
                      ? <span>{formatNameHash(r.txid, 8, 6)}</span>
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
