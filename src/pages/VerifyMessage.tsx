import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionStore } from '../stores/connection-store';
import { CheckCircle, XCircle, Loader2, Settings } from 'lucide-react';

export function VerifyMessage() {
  const { connectionState } = useConnectionStore();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = useCallback(async () => {
    if (!name.trim() || !message.trim() || !signature.trim()) return;
    setVerifying(true);
    setResult(null);
    setError(null);
    try {
      const ok = await window.api.node.verifyMessageWithName(name.trim(), signature.trim(), message);
      setResult(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify message');
    } finally {
      setVerifying(false);
    }
  }, [name, message, signature]);

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
          Connect to your Handshake node to verify messages.
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

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Verify Message</h1>
        <p className="text-sm text-gray-500 mt-1">
          Verify that a message was signed by the owner of a Handshake name.
        </p>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name:</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="e.g. example"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Message:</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono resize-y bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="Enter the original message..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Signature:</label>
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono resize-y bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="Paste the signature to verify..."
          />
        </div>

        <button
          onClick={handleVerify}
          disabled={verifying || !name.trim() || !message.trim() || !signature.trim()}
          className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
        >
          {verifying && <Loader2 className="w-4 h-4 animate-spin" />}
          {verifying ? 'Verifying...' : 'Verify Message'}
        </button>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm">{error}</div>
        )}

        {result !== null && (
          <div className={`p-4 rounded-lg flex items-center gap-3 ${
            result
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}>
            {result ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            <div>
              <p className="font-medium">
                {result ? 'Valid signature' : 'Invalid signature'}
              </p>
              <p className="text-sm opacity-80">
                {result
                  ? `The message was signed by ${name}.`
                  : 'The signature does not match this name and message.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
