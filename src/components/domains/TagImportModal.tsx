import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Upload, X } from 'lucide-react';
import type { DomainWithMeta, TagUpdate, TagUpdateResult } from '../../types/domain';
import type { TagCsvParseResult } from '../../lib/tag-csv';
import { extractDomainTags, formatTags, sameTags } from '../../lib/domain-tags';
import { useConnectionStore } from '../../stores/connection-store';
import { PassphraseModal } from '../common/PassphraseModal';

interface TagImportModalProps {
  fileName: string;
  parsed: TagCsvParseResult;
  domains: DomainWithMeta[];
  onClose: () => void;
  onComplete: () => Promise<void> | void;
}

interface PreviewRow {
  name: string;
  newTags: string[];
  currentTags: string[];
  known: boolean;
  changed: boolean;
}

export function TagImportModal({
  fileName,
  parsed,
  domains,
  onClose,
  onComplete,
}: TagImportModalProps) {
  const encrypted = useConnectionStore((s) => s.walletInfo?.master?.encrypted ?? false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<TagUpdateResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const domainMap = useMemo(
    () => new Map(domains.map((domain) => [domain.name.toLowerCase(), domain])),
    [domains],
  );

  const preview = useMemo<PreviewRow[]>(() => {
    return parsed.rows.map((row) => {
      const domain = domainMap.get(row.name);
      const currentTags = domain ? extractDomainTags(domain.dnsRecords) : [];
      return {
        name: row.name,
        newTags: row.tags,
        currentTags,
        known: Boolean(domain),
        changed: Boolean(domain) && !sameTags(currentTags, row.tags),
      };
    });
  }, [parsed.rows, domainMap]);

  const updates: TagUpdate[] = preview
    .filter((row) => row.known && row.changed)
    .map((row) => ({ name: row.name, tags: row.newTags }));
  const unchanged = preview.filter((row) => row.known && !row.changed).length;
  const unknown = preview.filter((row) => !row.known);

  const apply = async (passphrase: string) => {
    setApplying(true);
    setError(null);
    try {
      const next = await window.api.wallet.applyTags(updates, passphrase);
      setResults(next);
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply tags.');
    } finally {
      setApplying(false);
      setShowPassphrase(false);
    }
  };

  const triggerApply = () => {
    if (updates.length === 0) return;
    if (encrypted) setShowPassphrase(true);
    else void apply('');
  };

  const successful = results?.filter((result) => result.success && !result.skipped).length ?? 0;
  const skipped = results?.filter((result) => result.skipped).length ?? 0;
  const failed = results?.filter((result) => !result.success) ?? [];

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div
          className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-200 dark:border-gray-700">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-hns-600" />
                Import TXT tags
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 truncate">
                {fileName} · {parsed.rows.length} name{parsed.rows.length === 1 ? '' : 's'}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {parsed.errors.length > 0 && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
                <div className="font-medium mb-1">Fix these rows before importing:</div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {parsed.errors.slice(0, 12).map((message) => <li key={message}>{message}</li>)}
                </ul>
                {parsed.errors.length > 12 && <p className="mt-1">…and {parsed.errors.length - 12} more.</p>}
              </div>
            )}

            {parsed.duplicates.length > 0 && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-300">
                Duplicate names found (the last row wins): {[...new Set(parsed.duplicates)].join(', ')}
              </div>
            )}

            {unknown.length > 0 && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-300">
                {unknown.length} name{unknown.length === 1 ? ' is' : 's are'} not owned by this wallet and will be skipped:{' '}
                {unknown.map((row) => row.name).join(', ')}
              </div>
            )}

            <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Current tags</th>
                    <th className="text-left px-3 py-2">New tags</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {preview.map((row) => (
                    <tr key={row.name}>
                      <td className="px-3 py-2 font-mono text-xs">{row.name}</td>
                      <td className="px-3 py-2 text-gray-500">{formatTags(row.currentTags) || '—'}</td>
                      <td className="px-3 py-2">{formatTags(row.newTags) || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {!row.known ? (
                          <span className="text-amber-600 dark:text-amber-400">Not in wallet</span>
                        ) : row.changed ? (
                          <span className="text-blue-600 dark:text-blue-400">Will update</span>
                        ) : (
                          <span className="text-gray-400">Unchanged</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!results && (
              <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-700 dark:text-blue-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  This will broadcast <strong>{updates.length}</strong> update transaction
                  {updates.length === 1 ? '' : 's'} and cost network fees.
                  {unchanged > 0 && ` ${unchanged} name${unchanged === 1 ? ' is' : 's are'} already up to date.`}
                  {' '}Existing non-tag TXT records are preserved. Empty tag cells remove existing tags.
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            {results && (
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-300">
                  <Check className="w-4 h-4" />
                  Tags submitted
                </div>
                <p className="mt-1 text-green-700 dark:text-green-300">
                  {successful} updated, {skipped} already up to date
                  {failed.length > 0 ? `, ${failed.length} failed` : ''}. Tags appear once the
                  update transactions confirm.
                </p>
                {failed.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-red-600 dark:text-red-400">
                    {failed.map((result) => (
                      <li key={result.name}>{result.name}: {result.error || 'Unknown error'}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              {results ? 'Close' : 'Cancel'}
            </button>
            {!results && (
              <button
                onClick={triggerApply}
                disabled={applying || updates.length === 0 || parsed.errors.length > 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50"
              >
                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {applying ? 'Applying…' : `Apply to ${updates.length} name${updates.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {showPassphrase && (
        <PassphraseModal
          title="Apply TXT tags"
          onSubmit={(passphrase) => void apply(passphrase)}
          onCancel={() => setShowPassphrase(false)}
        />
      )}
    </>
  );
}
