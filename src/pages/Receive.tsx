import { useEffect, useState } from 'react';
import { useConnectionStore } from '../stores/connection-store';
import { useWalletStore } from '../stores/wallet-store';
import { QRCodeSVG } from 'qrcode.react';
import { Wallet, Copy, Check, RefreshCw, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Receive() {
  const { connectionState } = useConnectionStore();
  const { currentAddress, fetchAddresses, generateAddress } = useWalletStore();
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (connectionState === 'connected') {
      fetchAddresses();
    }
  }, [connectionState, fetchAddresses]);

  const handleCopy = async () => {
    if (currentAddress) {
      try {
        await navigator.clipboard.writeText(currentAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = currentAddress;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const handleGenerateNew = async () => {
    setIsGenerating(true);
    try {
      await generateAddress();
    } catch {
      // Ignore errors
    }
    setIsGenerating(false);
  };

  if (connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
          <Wallet className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Connect to your Handshake node to receive HNS.
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Receive HNS</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Share your address to receive Handshake coins
        </p>
      </div>

      {/* Address QR Code Card */}
      <div className="card max-w-md mx-auto">
        <div className="flex flex-col items-center space-y-6 p-6">
          {/* QR Code */}
          <div className="bg-white p-4 rounded-xl">
            {currentAddress ? (
              <QRCodeSVG value={currentAddress} size={200} level="M" />
            ) : (
              <div className="w-[200px] h-[200px] bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">
                No address available
              </div>
            )}
          </div>

          {/* Address Display */}
          <div className="w-full text-center">
            <label className="block text-sm font-medium text-gray-500 mb-2">Your Address</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-lg font-mono text-xs break-all border border-gray-200 dark:border-gray-700">
                {currentAddress || 'No address loaded'}
              </div>
              <button
                onClick={handleCopy}
                className="p-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors flex-shrink-0"
                title="Copy address"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            {copied && (
              <p className="text-xs text-green-600 mt-2">Copied to clipboard!</p>
            )}
          </div>

          {/* Generate New */}
          <button
            onClick={handleGenerateNew}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
          >
            {isGenerating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Generate New Address
          </button>
        </div>
      </div>


    </div>
  );
}
