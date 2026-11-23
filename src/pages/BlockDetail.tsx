import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useConnectionStore } from '../stores/connection-store';
import type { BlockDetail as BlockDetailType } from '../types/explore';

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function formatHNS(value: number): string {
  return (value / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function BlockDetail() {
  const { height } = useParams<{ height: string }>();
  const { connectionState, blockHeight } = useConnectionStore();
  const [block, setBlock] = useState<BlockDetailType | null>(null);
  const [loading, setLoading] = useState(true);

  const blockNum = parseInt(height || '0', 10);

  useEffect(() => {
    if (connectionState !== 'connected' || isNaN(blockNum)) return;
    setLoading(true);
    window.api.node.getBlockDetails(blockNum)
      .then(setBlock)
      .catch(() => setBlock(null))
      .finally(() => setLoading(false));
  }, [blockNum, connectionState]);

  if (connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
        <p className="text-gray-500">Connect to your full node to view block details.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-gray-400">Loading block #{blockNum}...</div>
      </div>
    );
  }

  if (!block) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-gray-400">Block #{blockNum} not found.</div>
        <div className="text-center">
          <Link to="/explore" className="text-hns-600 hover:underline">Back to Explorer</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Link to="/explore" className="flex items-center gap-1 text-sm text-hns-600 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Explorer
        </Link>
        <div className="flex items-center gap-2">
          {blockNum > 0 && (
            <Link
              to={`/explore/block/${blockNum - 1}`}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Prev
            </Link>
          )}
          {blockNum < blockHeight && (
            <Link
              to={`/explore/block/${blockNum + 1}`}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Next <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* Block Header */}
      <div>
        <h1 className="text-2xl font-bold">Block #{block.height.toLocaleString()}</h1>
      </div>

      {/* Block Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <InfoRow label="Hash" value={block.hash} mono />
          <InfoRow label="Previous Block" value={block.previousBlockHash} mono link={`/explore/block/${blockNum - 1}`} />
          {block.nextBlockHash && (
            <InfoRow label="Next Block" value={block.nextBlockHash} mono link={`/explore/block/${blockNum + 1}`} />
          )}
          <InfoRow label="Timestamp" value={formatTime(block.time)} />
          <InfoRow label="Merkle Root" value={block.merkleRoot} mono />
        </div>
        <div className="card space-y-3">
          <InfoRow label="Size" value={`${(block.size / 1000).toFixed(2)} kB`} />
          <InfoRow label="Weight" value={`${(block.weight / 1000).toFixed(2)} kWU`} />
          <InfoRow label="Version" value={String(block.version)} />
          <InfoRow label="Bits" value={String(block.bits)} />
          <InfoRow label="Difficulty" value={block.difficulty.toLocaleString()} />
          <InfoRow label="Total Fees" value={`${formatHNS(block.totalFee)} HNS`} />
        </div>
      </div>

      {/* Transactions */}
      <div className="card">
        <h3 className="font-semibold mb-4">
          Transactions ({block.txs.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 font-medium">Hash</th>
                <th className="pb-2 font-medium text-right">Inputs</th>
                <th className="pb-2 font-medium text-right">Outputs</th>
                <th className="pb-2 font-medium text-right">Size</th>
                <th className="pb-2 font-medium text-right">Fee</th>
              </tr>
            </thead>
            <tbody>
              {block.txs.map((tx) => (
                <tr key={tx.hash} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-2.5 font-mono text-xs text-hns-600">{(tx.hash || '').slice(0, 24)}...</td>
                  <td className="py-2.5 text-right font-mono">{tx.inputs?.length || 0}</td>
                  <td className="py-2.5 text-right font-mono">{tx.outputs?.length || 0}</td>
                  <td className="py-2.5 text-right font-mono">{tx.size || 0} B</td>
                  <td className="py-2.5 text-right font-mono">{formatHNS(tx.fee)} HNS</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: string }) {
  const content = (
    <div className="flex items-start gap-2">
      <span className="text-gray-500 text-sm min-w-[110px] shrink-0">{label}</span>
      <span className={`text-sm break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
  if (link) {
    return <Link to={link} className="hover:text-hns-600">{content}</Link>;
  }
  return content;
}
