import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileDown,
  Loader2,
  Users,
  X,
} from 'lucide-react';
import {
  downloadFile,
  signaturesToCSV,
  type MessageSignatureRow,
} from '../../lib/export-utils';
import { useConnectionStore } from '../../stores/connection-store';
import type { NameSignatureResult, WalletInfo } from '../../types/wallet';

interface MultiSignModalProps {
  /** Owned (CLOSED) names from the current wallet. */
  names: string[];
  /** Prefill from the single-sign message field, if one is typed. */
  initialMessage?: string;
  /** Used for the initial lock state; refreshed through the wallet API on open. */
  walletInfo: WalletInfo | null;
  onClose: () => void;
}

function friendlySignError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid passphrase|wrong passphrase|incorrect passphrase|bad passphrase/i.test(msg)) {
    return 'Incorrect passphrase.';
  }
  if (/wallet is locked/i.test(msg)) {
    return 'The wallet is locked. Enter your passphrase and try again.';
  }
  return msg || 'Failed to sign messages.';
}

export function MultiSignModal({
  names,
  initialMessage = '',
  walletInfo,
  onClose,
}: MultiSignModalProps) {
  const [message, setMessage] = useState(initialMessage);
  const [passphrase, setPassphrase] = useState('');
  const [encrypted, setEncrypted] = useState(walletInfo?.master?.encrypted ?? false);
  const [unlocked, setUnlocked] = useState(
    () => (walletInfo?.master?.until ?? 0) > Math.floor(Date.now() / 1000),
  );
  const [lockStateLoaded, setLockStateLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<NameSignatureResult[] | null>(null);
  const [csv, setCsv] = useState<{ content: string; filename: string } | null>(null);

  // Refresh the lock state when the card opens. The store value may be up to
  // one polling interval old, and the wallet may have auto-locked since login.
  useEffect(() => {
    let cancelled = false;
    window.api.wallet.getInfo()
      .then((info) => {
        if (cancelled) return;
        setEncrypted(info.master?.encrypted ?? false);
        setUnlocked((info.master?.until ?? 0) > Math.floor(Date.now() / 1000));
      })
      .catch(() => {
        // Keep the metadata supplied by the page.
      })
      .finally(() => {
        if (!cancelled) setLockStateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const successes = results?.filter((r) => r.signature) ?? [];
  const failures = results?.filter((r) => !r.signature) ?? [];
  const canSign =
    lockStateLoaded &&
    names.length > 0 &&
    message.trim().length > 0 &&
    !busy &&
    (!encrypted || unlocked || passphrase.length > 0);

  const downloadCsv = () => {
    if (!csv) return;
    downloadFile(`\uFEFF${csv.content}`, csv.filename, 'text/csv');
  };

  const handleSign = async () => {
    if (!canSign) return;

    setBusy(true);
    setError(null);
    setResults(null);
    setCsv(null);

    try {
      const batch = await window.api.wallet.signMessageBatch(
        names,
        message,
        passphrase,
      );
      setResults(batch);

      const rows: MessageSignatureRow[] = batch
        .filter((r): r is NameSignatureResult & { signature: string } => Boolean(r.signature))
        .map((r) => ({ name: r.name, message, signature: r.signature }));

      if (rows.length > 0) {
        const content = signaturesToCSV(rows);
        const filename = `handshake-signatures-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadFile(`\uFEFF${content}`, filename, 'text/csv');
        setCsv({ content, filename });
      } else {
        setError('No signatures were created. Check the failures below.');
      }
    } catch (err) {
      setError(friendlySignError(err));
    } finally {
      setBusy(false);
      // Never keep the passphrase in component state after an attempt.
      setPassphrase('');

      // The batch may have locked the wallet (or the session may have timed
      // out). Refresh the lock metadata so the next attempt shows the right
      // passphrase requirement.
      window.api.wallet.getInfo()
        .then((info) => {
          setEncrypted(info.master?.encrypted ?? false);
          setUnlocked((info.master?.until ?? 0) > Math.floor(Date.now() / 1000));
        })
        .catch(() => {
          // Keep the previous state on transient RPC errors.
        });

      // Keep the page/store lock metadata in sync with the backend.
      useConnectionStore.getState().refreshWallet().catch(() => {});
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="multi-sign-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-hns-100 dark:bg-hns-900">
              <FileDown className="h-5 w-5 text-hns-600" />
            </div>
            <div>
              <h2 id="multi-sign-title" className="text-lg font-semibold">
                Multi-Sign &amp; Export CSV
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Sign the same message with every owned name.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Users className="h-4 w-4 text-hns-600" />
            {names.length} {names.length === 1 ? 'name' : 'names'} will be signed
          </div>
          <div className="mt-2 max-h-28 overflow-y-auto rounded bg-gray-50 dark:bg-gray-900 p-2 font-mono text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
            {names.length === 0 ? (
              <div className="text-gray-400">No owned names available.</div>
            ) : (
              <>
                {names.slice(0, 50).map((name) => <div key={name}>{name}</div>)}
                {names.length > 50 && (
                  <div className="text-gray-400">
                    …and {names.length - 50} more
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            disabled={busy}
            placeholder="Enter the message to sign..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono resize-y bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            The exact text is signed and repeated for every name.
          </p>
        </div>

        {encrypted ? (
          <div>
            <label className="block text-sm font-medium mb-1">Passphrase</label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={busy}
              placeholder={unlocked ? 'Optional — wallet is already unlocked' : 'Wallet passphrase'}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 disabled:opacity-60"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSign) handleSign();
              }}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {unlocked
                ? 'The wallet is already unlocked. Leave blank to use the current session, or enter it to re-authenticate.'
                : 'Required to unlock the wallet for this batch.'}
            </p>
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            This wallet is not encrypted; no passphrase is required.
          </p>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {results && (
          <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {failures.length === 0 ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600" />
              )}
              Exported {successes.length} of {results.length}{' '}
              {results.length === 1 ? 'signature' : 'signatures'}.
            </div>
            {failures.length > 0 && (
              <div className="mt-2 max-h-32 overflow-y-auto text-xs text-red-600 space-y-1">
                {failures.map((failure) => (
                  <div key={failure.name}>
                    <span className="font-mono">{failure.name}</span>
                    {': '}
                    {failure.error || 'Signing failed'}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={handleSign}
            disabled={!canSign}
            className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4" />
            )}
            {busy ? `Signing ${names.length}...` : 'Sign & Export CSV'}
          </button>
        </div>

        {csv && !busy && (
          <button
            onClick={downloadCsv}
            className="w-full px-4 py-2 text-sm border border-hns-200 dark:border-hns-900/40 text-hns-700 dark:text-hns-300 rounded-lg hover:bg-hns-50 dark:hover:bg-hns-900/20 flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download CSV again
          </button>
        )}
      </div>
    </div>
  );
}
