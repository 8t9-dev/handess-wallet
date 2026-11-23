/**
 * Passphrase Modal Component
 */

import { useState } from 'react';
import { KeyRound } from 'lucide-react';

interface PassphraseModalProps {
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
  title?: string;
}

export function PassphraseModal({ onSubmit, onCancel, title = 'Enter Passphrase' }: PassphraseModalProps) {
  const [passphrase, setPassphrase] = useState('');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-hns-100 dark:bg-hns-900 rounded-lg flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-hns-600" />
          </div>
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>

        <p className="text-sm text-gray-500">
          Enter your wallet passphrase to sign this transaction.
        </p>

        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
          placeholder="Wallet passphrase"
          autoFocus
        />

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => onSubmit(passphrase)}
            disabled={!passphrase}
            className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border rounded-lg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
