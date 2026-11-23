import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionStore } from '../stores/connection-store';
import { PassphraseModal } from '../components/common/PassphraseModal';
import { MultiSignModal } from '../components/wallet/MultiSignModal';
import { Copy, Check, FileDown, Settings } from 'lucide-react';

export function SignMessage() {
  const { connectionState, walletInfo } = useConnectionStore();
  const [names, setNames] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showMultiSign, setShowMultiSign] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (connectionState !== 'connected') return;
    window.api.wallet.getNames().then(domains => {
      const owned = [
        ...new Set(
          domains
            .filter((d) => d.state === 'CLOSED')
            .map((d) => d.name),
        ),
      ].sort((a, b) => a.localeCompare(b));
      setNames(owned);
      if (owned.length > 0 && !selectedName) setSelectedName(owned[0]);
    }).catch(() => {});
  }, [connectionState, selectedName]);

  const handleSign = useCallback(async (passphrase: string) => {
    if (!selectedName || !message.trim()) return;
    setSigning(true);
    setError(null);
    setSignature('');
    try {
      const result = await window.api.wallet.signMessageWithName(
        selectedName,
        message,
        passphrase,
      );
      setSignature(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sign message';
      setError(msg);
      // The store's unlock metadata can be a few seconds stale. If the
      // backend reports a locked wallet, ask for the passphrase.
      if (/locked/i.test(msg)) setShowPassphrase(true);
    } finally {
      setSigning(false);
      // Signing may have unlocked and then re-locked the wallet. Refresh the
      // store so the next attempt knows the correct lock state.
      useConnectionStore.getState().refreshWallet().catch(() => {});
    }
  }, [selectedName, message]);

  const triggerSign = () => {
    const isEncrypted = walletInfo?.master?.encrypted ?? false;
    const isUnlocked =
      (walletInfo?.master?.until ?? 0) > Math.floor(Date.now() / 1000);

    // Only prompt when the wallet is actually locked. If it is still unlocked
    // from login, sign with the current session.
    if (isEncrypted && !isUnlocked) {
      setShowPassphrase(true);
    } else {
      handleSign('');
    }
  };

  const copySig = async () => {
    try {
      await navigator.clipboard.writeText(signature);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard write failed */ }
  };

  const isWatchOnly = walletInfo?.watchOnly ?? false;
  const isMultisig = walletInfo && 'n' in walletInfo ? Number((walletInfo as unknown as Record<string, unknown>).n) > 1 : false;

  if (connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Connect to your Handshake node to sign messages.
        </p>
        <Link
          to="/settings"
          className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors"
        >
          <Settings className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          Go to Settings
        </Link>
      </div>
    );
  }

  if (isWatchOnly) {
    return (
      <div className="p-6">
        <div className="card p-6 text-center">
          <p className="text-gray-500">Not currently supported with Ledger wallet.</p>
        </div>
      </div>
    );
  }

  if (isMultisig) {
    return (
      <div className="p-6">
        <div className="card p-6 text-center">
          <p className="text-gray-500">Not currently supported with multisig wallets.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Sign Message</h1>
        <p className="text-sm text-gray-500 mt-1">
          Sign a message with the private key associated with one of your Handshake names.
        </p>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Select Name to Sign:</label>
          <select
            value={selectedName}
            onChange={(e) => setSelectedName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            {names.length === 0 && <option value="">No owned names</option>}
            {names.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Message:</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono resize-y bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="Enter the message to sign..."
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={triggerSign}
            disabled={signing || !selectedName || !message.trim()}
            className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 text-sm font-medium"
          >
            {signing ? 'Signing...' : 'Sign Message'}
          </button>
          <button
            onClick={() => setShowMultiSign(true)}
            disabled={signing || names.length === 0}
            title={
              names.length === 0
                ? 'No owned names available'
                : 'Sign this message with every owned name and export a CSV'
            }
            className="px-4 py-2 border border-hns-300 dark:border-hns-700 text-hns-700 dark:text-hns-300 rounded-lg hover:bg-hns-50 dark:hover:bg-hns-900/20 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
          >
            <FileDown className="w-4 h-4" />
            Multi-Sign CSV
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Multi-sign signs the same message with every owned name and downloads
          a CSV containing the name, message, and signature.
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm">{error}</div>
        )}

        {signature && (
          <div>
            <label className="block text-sm font-medium mb-1">Signature:</label>
            <div className="relative">
              <textarea
                value={signature}
                readOnly
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono resize-none bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
              <button
                onClick={copySig}
                className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                title="Copy signature"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {showPassphrase && (
        <PassphraseModal
          title="Sign Message"
          onSubmit={(pwd) => {
            setShowPassphrase(false);
            handleSign(pwd);
          }}
          onCancel={() => setShowPassphrase(false)}
        />
      )}

      {showMultiSign && (
        <MultiSignModal
          names={names}
          initialMessage={message}
          walletInfo={walletInfo}
          onClose={() => setShowMultiSign(false)}
        />
      )}
    </div>
  );
}
