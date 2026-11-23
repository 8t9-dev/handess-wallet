/**
 * My Domains Page
 *
 * Main domain management page with sortable, filterable table
 * and bulk action bar.
 *
 * TODO: Implementation:
 * 1. Load domains on mount
 * 2. Set up TanStack Table with sorting, filtering, pagination
 * 3. Render DomainTable component
 * 4. Show BulkActionBar when domains are selected
 * 5. Handle filter panel toggle
 * 6. Tag editor modal
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { useConnectionStore } from '../stores/connection-store';
import { useDomains } from '../hooks/useDomains';
import { useBatchOperation } from '../hooks/useBatchOperation';
import { useExport } from '../hooks/useExport';
import { DomainTable } from '../components/domains/DomainTable';
import { DomainFilters } from '../components/domains/DomainFilters';
import { BulkActionBar } from '../components/domains/BulkActionBar';
import { TagImportModal } from '../components/domains/TagImportModal';
import { PassphraseModal } from '../components/common/PassphraseModal';
import { NETWORKS } from '../lib/constants';
import { isTransferReadyToFinalize } from '../lib/domain-transfer';
import { parseTagCsv } from '../lib/tag-csv';
import type { TagCsvParseResult } from '../lib/tag-csv';

export function MyDomains() {
  const { connectionState, walletInfo, blockHeight, network: networkName } = useConnectionStore();
  const { domains, fetchDomains, filteredDomains, isLoading, error, selectedCount } = useDomains();
  const { finalizeSelected, queue } = useBatchOperation();
  const { exportDomainsToCSV } = useExport();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<{
    fileName: string;
    parsed: TagCsvParseResult;
  } | null>(null);
  const [showFinalizePassphrase, setShowFinalizePassphrase] = useState(false);
  const [finalizeJobId, setFinalizeJobId] = useState<string | null>(null);
  const [finalizeMessage, setFinalizeMessage] = useState<string | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [recentlyFinalized, setRecentlyFinalized] = useState<Set<string>>(() => new Set());

  const network = (networkName === 'testnet' || networkName === 'regtest' ? networkName : 'main') as keyof typeof NETWORKS;
  const transferLockup = NETWORKS[network]?.transferLockup ?? 288;

  const readyToFinalize = useMemo(() => {
    if (blockHeight == null) return [];
    return domains
      .filter((domain) => (
        isTransferReadyToFinalize(domain, blockHeight, transferLockup)
        && !recentlyFinalized.has(domain.name)
      ))
      .map((domain) => domain.name);
  }, [domains, blockHeight, transferLockup, recentlyFinalized]);

  const finalizeJob = finalizeJobId
    ? queue.find((job) => job.id === finalizeJobId) ?? null
    : null;

  useEffect(() => {
    if (connectionState === 'connected') fetchDomains();
  }, [connectionState, fetchDomains]);

  useEffect(() => {
    if (!finalizeJobId || !finalizeJob) return;
    if (finalizeJob.status === 'completed') {
      setRecentlyFinalized((previous) => {
        const next = new Set(previous);
        for (const name of finalizeJob.names) next.add(name);
        return next;
      });
      setFinalizeMessage(`Finalized ${finalizeJob.totalNames} transfer${finalizeJob.totalNames === 1 ? '' : 's'}.`);
      setFinalizeJobId(null);
      void fetchDomains();
    } else if (finalizeJob.status === 'failed') {
      const error = finalizeJob.chunks.find((chunk) => chunk.error)?.error
        || 'Some finalize transactions failed.';
      setFinalizeError(error);
      setFinalizeMessage(null);
      setFinalizeJobId(null);
      void fetchDomains();
    }
  }, [finalizeJob, finalizeJobId, fetchDomains]);

  const submitFinalizeAll = async (passphrase: string) => {
    if (readyToFinalize.length === 0) return;
    setFinalizeError(null);
    setFinalizeMessage(`Finalizing ${readyToFinalize.length} transfer${readyToFinalize.length === 1 ? '' : 's'}...`);
    try {
      const job = await finalizeSelected(readyToFinalize, passphrase);
      setFinalizeJobId(job.id);
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : 'Could not finalize the transfers.');
      setFinalizeMessage(null);
    }
  };

  const handleFinalizeAll = () => {
    if (finalizeJobId || readyToFinalize.length === 0) return;
    if (walletInfo?.master?.encrypted) {
      setShowFinalizePassphrase(true);
      return;
    }
    void submitFinalizeAll('');
  };

  const handleTagFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setImportData({ fileName: file.name, parsed: parseTagCsv(text) });
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
          Connect to your Handshake node to view your domains.
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

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <h3 className="text-red-800 dark:text-red-200 font-medium">Error Loading Domains</h3>
          <p className="text-red-600 dark:text-red-400 text-sm mt-1">{error}</p>
          <button
            onClick={() => fetchDomains()}
            className="mt-3 px-3 py-1.5 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded text-sm hover:bg-red-200 dark:hover:bg-red-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Domains</h1>
          <p className="text-gray-500 dark:text-gray-400">
            {filteredDomains.length} domains {selectedCount > 0 && `(${selectedCount} selected)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {readyToFinalize.length > 2 && (
            <button
              onClick={handleFinalizeAll}
              disabled={Boolean(finalizeJobId) || isLoading}
              title={`Finalize all ${readyToFinalize.length} transfers that are ready`}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {finalizeJobId ? 'Finalizing...' : `Finalize All (${readyToFinalize.length})`}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void handleTagFile(file);
              event.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || domains.length === 0}
            title="Import name,tags rows and update on-chain TXT records"
            className="px-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Import Tags
          </button>
          <button
            onClick={() => exportDomainsToCSV(domains)}
            disabled={isLoading || domains.length === 0}
            title="Export all names in this wallet to CSV"
            className="px-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => fetchDomains()}
            disabled={isLoading}
            className="px-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {finalizeMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
          {finalizeMessage}
        </div>
      )}
      {finalizeError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {finalizeError}
        </div>
      )}

      {/* Filters */}
      <DomainFilters />

      {/* Domain Table */}
      <DomainTable domains={filteredDomains} isLoading={isLoading} />

      {/* Bulk Action Bar (shows when items selected) */}
      {selectedCount > 0 && <BulkActionBar />}

      {importData && (
        <TagImportModal
          fileName={importData.fileName}
          parsed={importData.parsed}
          domains={domains}
          onClose={() => setImportData(null)}
          onComplete={fetchDomains}
        />
      )}

      {showFinalizePassphrase && (
        <PassphraseModal
          title="Finalize All Transfers"
          onSubmit={(passphrase) => {
            setShowFinalizePassphrase(false);
            void submitFinalizeAll(passphrase);
          }}
          onCancel={() => setShowFinalizePassphrase(false)}
        />
      )}
    </div>
  );
}
