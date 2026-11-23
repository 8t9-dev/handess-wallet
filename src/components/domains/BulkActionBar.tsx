import { useState, useEffect } from 'react';
import { useDomains } from '../../hooks/useDomains';
import { useConnectionStore } from '../../stores/connection-store';
import { useBatchOperation } from '../../hooks/useBatchOperation';
import { RotateCcw, Send, Loader2, Globe, X } from 'lucide-react';
import { PassphraseModal } from '../common/PassphraseModal';
import { DNSRecordEditor } from '../domains/DNSRecordEditor';
import { useRecordValidation } from '../domains/DNSRecordEditor';
import type { DNSRecord } from '../../types/domain';

export function BulkActionBar() {
  const { selectedNames, selectedCount, deselectAll } = useDomains();
  const { renewSelected, transferSelected } = useBatchOperation();
  const walletInfo = useConnectionStore(s => s.walletInfo);

  const [showPassphrase, setShowPassphrase] = useState<'renew' | 'transfer' | 'dns' | 'dns-save' | null>(null);
  const [showTransferAddr, setShowTransferAddr] = useState(false);
  const [transferAddr, setTransferAddr] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // DNS Settings state
  const [showDnsSettings, setShowDnsSettings] = useState(false);
  const [dnsRecords, setDnsRecords] = useState<DNSRecord[]>([]);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsSaving, setDnsSaving] = useState(false);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [dnsSuccess, setDnsSuccess] = useState(false);

  const names = Array.from(selectedNames);
  const singleName = names.length === 1 ? names[0] : null;
  const isMultiSelect = selectedCount > 1;

  const { hasErrors } = useRecordValidation(dnsRecords);

  // Fetch DNS records when opening settings
  useEffect(() => {
    if (showDnsSettings && singleName) {
      setDnsLoading(true);
      setDnsError(null);
      setDnsSuccess(false);
      window.api.node.getNameResource(singleName)
        .then((res) => {
          setDnsRecords(res?.records || []);
        })
        .catch((err) => {
          setDnsError(err instanceof Error ? err.message : 'Failed to load DNS records');
        })
        .finally(() => setDnsLoading(false));
    }
  }, [showDnsSettings, singleName]);

  const triggerAction = (action: 'renew' | 'transfer') => {
    if (action === 'transfer' && !showTransferAddr) {
      setShowTransferAddr(true);
      return;
    }
    const isEncrypted = walletInfo?.master?.encrypted ?? false;
    if (isEncrypted) {
      setShowPassphrase(action);
    } else {
      handleAction(action, '');
    }
  };

  const handleAction = async (action: 'renew' | 'transfer', passphrase: string) => {
    setBusyAction(action);
    try {
      if (action === 'transfer') {
        await transferSelected(names, transferAddr, passphrase);
      } else if (action === 'renew') {
        await renewSelected(names, passphrase);
      }
      deselectAll();
    } catch {
      // error handled by store
    } finally {
      setBusyAction(null);
      setShowTransferAddr(false);
      setTransferAddr('');
    }
  };

  const handleSaveDns = async (passphrase: string) => {
    if (!singleName) return;
    setDnsSaving(true);
    setDnsError(null);
    try {
      await window.api.wallet.sendUpdate(singleName, { records: dnsRecords }, passphrase);
      setDnsSuccess(true);
      setTimeout(() => {
        setShowDnsSettings(false);
        setDnsSuccess(false);
      }, 1500);
    } catch (err) {
      setDnsError(err instanceof Error ? err.message : 'Failed to update DNS records');
    } finally {
      setDnsSaving(false);
    }
  };

  const triggerDnsSettings = () => {
    const isEncrypted = walletInfo?.master?.encrypted ?? false;
    if (isEncrypted) {
      setShowPassphrase('dns');
    } else {
      setShowDnsSettings(true);
    }
  };

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 flex items-center gap-4 z-50">
        <div className="text-sm">
          <span className="font-semibold">{selectedCount}</span> names selected
        </div>

        <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />

        <button onClick={() => triggerAction('renew')} disabled={busyAction !== null}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-hns-50 dark:bg-hns-900/30 text-hns-700 dark:text-hns-300 rounded-lg hover:bg-hns-100 dark:hover:bg-hns-900/50 disabled:opacity-50">
          {busyAction === 'renew' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          {busyAction === 'renew' ? 'Renewing...' : 'Renew'}
        </button>

        <button onClick={() => triggerAction('transfer')} disabled={busyAction !== null}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/50 disabled:opacity-50">
          {busyAction === 'transfer' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {busyAction === 'transfer' ? 'Transferring...' : 'Transfer'}
        </button>

        {!isMultiSelect && (
          <button onClick={triggerDnsSettings} disabled={busyAction !== null}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50">
            <Globe className="w-4 h-4" />
            DNS Settings
          </button>
        )}

        <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />

        <button onClick={() => deselectAll()} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>

      {showTransferAddr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setShowTransferAddr(false); setTransferAddr(''); }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-3">Transfer Names</h3>
            <p className="text-sm text-gray-500 mb-4">
              Enter the recipient address to transfer {selectedCount} selected name{selectedCount > 1 ? 's' : ''} to:
            </p>
            <input type="text" value={transferAddr} onChange={e => setTransferAddr(e.target.value)}
              placeholder="hs1q..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-hns-500 text-sm font-mono mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowTransferAddr(false); setTransferAddr(''); }}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
              <button onClick={() => { setShowTransferAddr(false); triggerAction('transfer'); }}
                disabled={!transferAddr.trim()}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                Start Transfer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DNS Settings Modal */}
      {showDnsSettings && singleName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDnsSettings(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg">DNS Settings</h3>
                <p className="text-sm text-gray-500">Configure DNS records for <span className="font-mono font-medium">{singleName}</span></p>
              </div>
              <button onClick={() => setShowDnsSettings(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {dnsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading DNS records...</span>
              </div>
            ) : dnsError ? (
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 text-sm mb-4">
                {dnsError}
              </div>
            ) : dnsSuccess ? (
              <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 text-sm text-center py-8">
                DNS records updated successfully!
              </div>
            ) : (
              <>
                <DNSRecordEditor
                  records={dnsRecords}
                  onChange={setDnsRecords}
                />

                {dnsRecords.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    No DNS records configured. Click &quot;+ Add Record&quot; to add one.
                  </div>
                )}

                <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button onClick={() => setShowDnsSettings(false)}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const isEncrypted = walletInfo?.master?.encrypted ?? false;
                      if (isEncrypted) {
                        setShowPassphrase('dns-save');
                      } else {
                        handleSaveDns('');
                      }
                    }}
                    disabled={dnsSaving || hasErrors}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {dnsSaving ? 'Saving...' : 'Save DNS Records'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showPassphrase && (
        <PassphraseModal
          title={showPassphrase === 'renew' ? 'Bulk Renew' : showPassphrase === 'transfer' ? 'Bulk Transfer' : 'Update DNS Records'}
          onSubmit={(pwd) => {
            const action = showPassphrase;
            setShowPassphrase(null);
            if (action === 'dns') {
              setShowDnsSettings(true);
            } else if (action === 'dns-save') {
              handleSaveDns(pwd);
            } else {
              handleAction(action, pwd);
            }
          }}
          onCancel={() => setShowPassphrase(null)}
        />
      )}
    </>
  );
}
