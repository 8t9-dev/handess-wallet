import { useState, useEffect } from 'react';
import { useConnectionStore } from '../stores/connection-store';
import { useWalletStore } from '../stores/wallet-store';
import { Wallet, ArrowUpRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { dollaryDoosToHNS } from '../lib/name-utils';
import { isValidHnsAddress } from '../lib/address-utils';
import { Link } from 'react-router-dom';

const FEE_RATE_MAP: Record<string, number> = {
  slow: 10_000,
  standard: 50_000,
  fast: 100_000,
};

export function Send() {
  const { connectionState, balance, blockHeight } = useConnectionStore();
  const { sendHns, isSending, sendResult, sendError, clearSendResult } = useWalletStore();

  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedSpeed, setSelectedSpeed] = useState('standard');
  const [feeEstimates, setFeeEstimates] = useState<Array<{ speed: string; feeDollarydoos: number; feeHns: string }>>([]);

  useEffect(() => {
    window.api.wallet.getFeeEstimates().then(setFeeEstimates).catch(() => {});
  }, []);

  const spendableHNS = balance ? dollaryDoosToHNS(balance.confirmed - balance.lockedConfirmed) : 0;

  const handleMax = () => {
    const totalHns = parseFloat(spendableHNS.toFixed(6));
    const estFee = feeEstimates.find(f => f.speed === selectedSpeed);
    const feeHns = estFee ? parseFloat(estFee.feeHns) : 0;
    const maxSend = Math.max(0, totalHns - feeHns);
    setAmount(maxSend.toFixed(6));
  };

  const validate = (): boolean => {
    if (!address.trim()) {
      setValidationError('Recipient address is required');
      return false;
    }
    if (!isValidHnsAddress(address)) {
      setValidationError('Invalid Handshake address');
      return false;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setValidationError('Amount must be greater than 0');
      return false;
    }
    if (parseFloat(amount) > spendableHNS) {
      setValidationError('Insufficient balance');
      return false;
    }
    // Check total cost (amount + fee) doesn't exceed spendable balance
    const estFeeHns = selectedFee ? parseFloat(selectedFee.feeHns) : 0;
    const totalCost = parseFloat(amount) + estFeeHns;
    if (totalCost > spendableHNS) {
      setValidationError(`Total cost (${totalCost.toFixed(6)} HNS) exceeds available balance (${spendableHNS.toFixed(6)} HNS). Use MAX to leave room for the fee.`);
      return false;
    }
    setValidationError(null);
    return true;
  };

  const handleSend = () => {
    if (!validate()) return;
    setShowPassphrase(true);
  };

  const confirmSend = async () => {
    if (!passphrase) return;
    const hnsAmount = parseFloat(amount);
    const dollarydoos = Math.round(hnsAmount * 1000000);
    const feeRate = FEE_RATE_MAP[selectedSpeed];
    try {
      // The entered amount is what the recipient receives. The network fee is
      // added on top and paid by the sender's wallet.
      await sendHns(address.trim(), dollarydoos, passphrase, { feeRate, subtractFee: false });
      setShowPassphrase(false);
      setPassphrase('');
      setAddress('');
      setAmount('');
    } catch {
      // Error is set in store
    }
  };

  const cancelSend = () => {
    setShowPassphrase(false);
    setPassphrase('');
  };

  const selectedFee = feeEstimates.find(f => f.speed === selectedSpeed);

  if (connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
          <Wallet className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Connect to your Handshake node to send HNS.
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

  if (sendResult) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-center h-full">
          <div className="card max-w-md w-full text-center p-8">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Transaction Sent</h2>
            <p className="text-sm font-mono text-gray-500 mb-4 break-all">
              TX: {(sendResult.hash || '').slice(0, 32)}...
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => clearSendResult()}
                className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors"
              >
                Send Another
              </button>
              <Link
                to="/history"
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                View History
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Send HNS</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Send Handshake coins to any address
        </p>
      </div>

      {/* Balance Card */}
      <div className="card">
        <div className="text-sm text-gray-500 mb-1">Available Balance</div>
        <div className="text-3xl font-bold text-hns-600">{spendableHNS.toFixed(6)} HNS</div>
        <div className="text-xs text-gray-400 mt-1">
          Block Height: {blockHeight.toLocaleString()}
        </div>
      </div>

      {/* Send Form */}
      <div className="card space-y-4">
        {(validationError || sendError) && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {validationError || sendError}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Recipient Address
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => { setAddress(e.target.value); setValidationError(null); }}
            placeholder="hs1q... or ts1q..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500 font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Amount (HNS)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setValidationError(null); }}
              placeholder="0.000000"
              step="0.000001"
              min="0"
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500"
            />
            <button
              onClick={handleMax}
              className="px-3 py-2 text-sm border border-hns-300 text-hns-600 rounded-lg hover:bg-hns-50 dark:hover:bg-hns-900/20 transition-colors font-medium"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Fee Speed Selector */}
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Network Fee
          </label>
          <div className="grid grid-cols-3 gap-2">
            {feeEstimates.map((fee) => (
              <button
                key={fee.speed}
                type="button"
                onClick={() => setSelectedSpeed(fee.speed)}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  selectedSpeed === fee.speed
                    ? 'border-hns-500 bg-hns-50 dark:bg-hns-900/20 text-hns-700 dark:text-hns-300'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <div className="text-xs font-medium capitalize mb-1">{fee.speed}</div>
                <div className="text-sm font-bold">{fee.feeHns} HNS</div>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSend}
          disabled={isSending || !address || !amount}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 transition-colors font-medium"
        >
          <ArrowUpRight className="w-5 h-5" />
          {isSending ? 'Sending...' : 'Send HNS'}
        </button>
      </div>

      {/* Passphrase Modal */}
      {showPassphrase && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Confirm Transaction</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Recipient:</span>
                <span className="font-mono text-xs">{address.slice(0, 24)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount (to recipient):</span>
                <span className="font-bold">{parseFloat(amount || '0').toFixed(6)} HNS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Fee ({selectedSpeed}):</span>
                <span className="font-medium">{selectedFee?.feeHns ?? '...'} HNS</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                <span className="font-semibold">Total Cost:</span>
                <span className="font-bold">{(parseFloat(amount || '0') + parseFloat(selectedFee?.feeHns || '0')).toFixed(6)} HNS</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                Wallet Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter your wallet passphrase"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') confirmSend(); }}
              />
            </div>
            {sendError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 text-sm">
                {sendError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={cancelSend}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmSend}
                disabled={!passphrase || isSending}
                className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 transition-colors"
              >
                {isSending ? 'Sending...' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
