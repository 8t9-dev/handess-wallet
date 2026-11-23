import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConnectionStore } from '../../stores/connection-store';
import { Wallet, FileDown, Unlock, X, Loader2, Copy, Check, ShieldAlert } from 'lucide-react';

type Tab = 'login' | 'create' | 'import';

export function WalletOnboardingModal() {
  const { connectionState, wallets, walletEncryption, showOnboarding, isLoggedIn, dismissOnboarding, checkWalletState, unlockWallet } = useConnectionStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('login');
  const [walletName, setWalletName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [seedPhrase, setSeedPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create flow sub-steps
  const [createStep, setCreateStep] = useState<'name' | 'seed' | 'verify' | 'passphrase'>('name');
  const [createdWalletId, setCreatedWalletId] = useState('');
  const [newSeedPhrase, setNewSeedPhrase] = useState('');
  const [seedCopied, setSeedCopied] = useState(false);

  // Seed verification: pick 3 random word positions
  const verifyIndices = useMemo(() => {
    if (!newSeedPhrase) return [];
    const words = newSeedPhrase.split(' ');
    const total = words.length;
    const indices = new Set<number>();
    while (indices.size < 3) {
      indices.add(Math.floor(Math.random() * total));
    }
    return Array.from(indices).sort((a, b) => a - b);
  }, [newSeedPhrase]);

  const [verifyAnswers, setVerifyAnswers] = useState<string[]>([]);

  // Reset modal state whenever it opens and refresh wallet lock metadata.
  // Wallet data is not loaded by the store until login succeeds.
  useEffect(() => {
    if (showOnboarding) {
      reset();
      checkWalletState().catch(() => {});
    }
  }, [showOnboarding, checkWalletState]);

  if (connectionState !== 'connected' || !showOnboarding || isLoggedIn) return null;

  const dismissable = wallets.length > 0;
  const selectedWallet = walletName || walletEncryption?.id || wallets[0] || '';
  // If metadata is unavailable, require a passphrase rather than silently
  // attempting a login. Unencrypted wallets can log in with an empty field.
  const currentWalletMeta = walletEncryption?.id === selectedWallet ? walletEncryption : null;
  const requiresPassphrase = !currentWalletMeta
    || (currentWalletMeta.encrypted
      && currentWalletMeta.until <= Math.floor(Date.now() / 1000));

  function reset() {
    setWalletName('');
    setPassphrase('');
    setPassphraseConfirm('');
    setSeedPhrase('');
    setError(null);
    setCreateStep('name');
    setCreatedWalletId('');
    setNewSeedPhrase('');
    setSeedCopied(false);
    setVerifyAnswers([]);
  }

  const handleCreate = async () => {
    if (!walletName.trim()) { setError('Enter a wallet name.'); return; }
    // Check for duplicate
    if (wallets.includes(walletName.trim())) { setError(`Wallet "${walletName.trim()}" already exists. Switch to Log In to unlock it.`); return; }
    setError(null);
    setBusy(true);
    try {
      // Step 1: Create wallet WITHOUT passphrase so we can read the mnemonic
      await window.api.wallet.createWallet(walletName.trim());
      await window.api.wallet.selectWallet(walletName.trim());

      // Step 2: Read the generated seed phrase (retry if key generation not complete)
      let master = await window.api.wallet.getMasterKey(walletName.trim());
      for (let attempt = 0; attempt < 10 && !master.mnemonic; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        master = await window.api.wallet.getMasterKey(walletName.trim());
      }
      if (master.mnemonic) {
        setCreatedWalletId(walletName.trim());
        setNewSeedPhrase(master.mnemonic);
        setCreateStep('seed');
      } else {
        await checkWalletState();
        setError(
          'The wallet was created, but hsd did not return its seed phrase. '
          + 'Log in from Settings and back up the wallet before sending funds.',
        );
      }
    } catch (err) {
      console.error('[Onboarding] createWallet failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to create wallet.';
      if (msg.toLowerCase().includes('already exists')) {
        setError(`Wallet "${walletName.trim()}" already exists. Go to Log In to unlock it.`);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSeedSaved = () => {
    setCreateStep('verify');
    setVerifyAnswers(verifyIndices.map(() => ''));
  };

  const handleVerify = () => {
    const words = newSeedPhrase.split(' ');
    const allMatch = verifyIndices.every((idx, i) => verifyAnswers[i]?.trim().toLowerCase() === words[idx].toLowerCase());
    if (!allMatch) { setError('One or more words are incorrect. Please check your saved seed phrase and try again.'); return; }
    setError(null);
    setCreateStep('passphrase');
    setPassphrase('');
    setPassphraseConfirm('');
  };

  const handleSetPassphrase = async () => {
    if (!passphrase) {
      // No passphrase — the wallet is unencrypted, but the user still has to
      // complete an explicit login before the app unlocks.
      setBusy(true);
      try {
        await window.api.wallet.selectWallet(createdWalletId);
        await checkWalletState();
        const ok = await unlockWallet('');
        if (ok) navigate('/dashboard');
        else setError('Failed to finish wallet setup. Try logging in from Settings.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (passphrase !== passphraseConfirm) { setError('Passphrases do not match.'); return; }
    setError(null);
    setBusy(true);
    try {
      await window.api.wallet.encryptWallet(createdWalletId, passphrase);
      // After encryption, select and auto-unlock so user is logged in
      await window.api.wallet.selectWallet(createdWalletId);
      const ok = await unlockWallet(passphrase);
      if (ok) navigate('/dashboard');
      else setError('Wallet encrypted, but automatic login failed. Log in from Settings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set passphrase.');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    const words = seedPhrase.trim().split(/\s+/);
    if (words.length < 12) { setError('Enter a valid seed phrase (12-24 words).'); return; }
    if (!walletName.trim()) { setError('Enter a wallet name.'); return; }
    if (wallets.includes(walletName.trim())) { setError(`Wallet "${walletName.trim()}" already exists. Choose a different name or go to Log In.`); return; }
    if (passphrase !== passphraseConfirm) { setError('Passphrases do not match.'); return; }
    setError(null);
    setBusy(true);
    try {
      // Only pass passphrase if they set one
      const pwd = passphrase || undefined;
      await window.api.wallet.importWallet(walletName.trim(), seedPhrase.trim(), pwd);
      await window.api.wallet.selectWallet(walletName.trim());

      // Fire-and-forget rescan to discover names, bids, and transaction history.
      // hsd's wallet rescan iterates blocks looking for wallet addresses; the
      // 10-second auto-refresh polls will pick up results as it progresses.
      window.api.wallet.rescan(0).catch(err => {
        console.warn('[Onboarding] Background rescan failed:', err);
      });

      await checkWalletState();
      const ok = await unlockWallet(pwd || '');
      if (ok) navigate('/dashboard');
      else setError('Wallet imported, but login failed. Try logging in from Settings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import wallet.');
    } finally {
      setBusy(false);
    }
  };

  const handleWalletSelect = async (name: string) => {
    setWalletName(name);
    setPassphrase('');
    setError(null);
    try {
      await window.api.wallet.selectWallet(name);
      await checkWalletState();
    } catch {
      // Keep the selection; login will surface any real error.
    }
  };

  const handleLogin = async () => {
    if (requiresPassphrase && !passphrase) {
      setError('Enter your wallet passphrase.');
      return;
    }
    const effectiveWallet = selectedWallet;
    setError(null);
    setBusy(true);
    try {
      if (effectiveWallet) {
        await window.api.wallet.selectWallet(effectiveWallet);
      }
      const ok = await unlockWallet(passphrase);
      if (ok) navigate('/dashboard');
      else setError('Wrong passphrase or unlock failed.');
    } catch {
      setError('Failed to select wallet. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof Wallet }[] = [
    ...(wallets.length > 0 ? [{ id: 'login' as Tab, label: 'Log In', icon: Unlock }] : []),
    { id: 'create', label: 'Create Wallet', icon: Wallet },
    { id: 'import', label: 'Import Wallet', icon: FileDown },
  ];

  // Initial tab: if wallets exist show login, otherwise show create
  const effectiveTab = activeTab === 'login' && wallets.length === 0 ? 'create' : activeTab;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Wallet Setup</h2>
          {dismissable && (
            <button onClick={dismissOnboarding} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tabs (hide during create seed step) */}
        {createStep === 'name' && (
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); reset(); }}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    effectiveTab === tab.id
                      ? 'border-hns-600 text-hns-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm">{error}</div>
        )}

        {/* ───── LOG IN TAB ───── */}
        {effectiveTab === 'login' && createStep === 'name' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Unlock your wallet to access your domains and transactions.
            </p>
            {wallets.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Wallet</label>
                <select
                  value={selectedWallet}
                  onChange={e => { if (!busy) handleWalletSelect(e.target.value); }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                >
                  {wallets.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
            )}
            {requiresPassphrase ? (
              <div>
                <label className="block text-sm font-medium mb-1">Passphrase</label>
                <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                  placeholder="Wallet passphrase" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && !busy) handleLogin(); }} />
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                This wallet has no passphrase. Click Log In to continue.
              </p>
            )}
            <button onClick={handleLogin} disabled={busy}
              className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? 'Unlocking...' : 'Log In'}
            </button>
          </div>
        )}

        {/* ───── CREATE TAB ───── */}
        {effectiveTab === 'create' && createStep === 'name' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Create a new Handshake wallet. Your seed phrase will be shown once so you can save it.</p>
            <div>
              <label className="block text-sm font-medium mb-1">Wallet Name</label>
              <input type="text" value={walletName} onChange={e => setWalletName(e.target.value)} onBlur={e => setWalletName(e.target.value.trim())}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800" placeholder="primary" autoFocus />
            </div>
            <button onClick={handleCreate} disabled={busy}
              className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? 'Creating...' : 'Create Wallet'}
            </button>
          </div>
        )}

        {/* ───── CREATE STEP: SHOW SEED ───── */}
        {createStep === 'seed' && newSeedPhrase && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-1">Save Your Seed Phrase</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300">
                This is the ONLY backup of your wallet. Write it down and store it somewhere safe. Never share it with anyone.
              </p>
            </div>
            <div className="relative">
              <div className="grid grid-cols-3 gap-2 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg font-mono text-sm">
                {newSeedPhrase.split(' ').map((word, i) => (
                  <div key={i} className="flex gap-1">
                    <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
                    <span>{word}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(newSeedPhrase); setSeedCopied(true); setTimeout(() => setSeedCopied(false), 2000); }}
                className="absolute top-2 right-2 p-1.5 bg-white dark:bg-gray-800 border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                title="Copy seed phrase"
              >
                {seedCopied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={handleSeedSaved}
              className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700">
              I&apos;ve Saved My Seed Phrase
            </button>
          </div>
        )}

        {/* ───── CREATE STEP: VERIFY SEED ───── */}
        {createStep === 'verify' && newSeedPhrase && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">Verify Your Seed Phrase</p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Enter the missing words below to confirm you&apos;ve saved them correctly.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {verifyIndices.map((idx, i) => (
                <div key={idx}>
                  <label className="block text-sm font-medium mb-1">Word #{idx + 1}</label>
                  <input
                    type="text"
                    value={verifyAnswers[i] || ''}
                    onChange={e => {
                      const next = [...verifyAnswers];
                      next[i] = e.target.value;
                      setVerifyAnswers(next);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 font-mono"
                    placeholder="Enter word..."
                    autoFocus={i === 0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !busy) handleVerify();
                    }}
                  />
                </div>
              ))}
            </div>
            <button onClick={handleVerify} disabled={busy || verifyAnswers.some(a => !a?.trim())}
              className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Verify & Continue
            </button>
          </div>
        )}

        {/* ───── CREATE STEP: SET PASSPHRASE ───── */}
        {createStep === 'passphrase' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Optionally set a passphrase to encrypt your wallet. You&apos;ll need it every time you log in.
            </p>
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs">
              Without a passphrase, anyone who can access this computer account can spend your funds.
              A passphrase is strongly recommended for a real wallet.
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Passphrase <span className="text-gray-400">(optional)</span></label>
              <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800" placeholder="Leave empty for no passphrase" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Confirm Passphrase</label>
              <input type="password" value={passphraseConfirm} onChange={e => setPassphraseConfirm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800" placeholder="Repeat passphrase" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSetPassphrase} disabled={busy}
                className="flex-1 py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {passphrase ? 'Set Passphrase & Finish' : 'Skip — No Passphrase'}
              </button>
            </div>
          </div>
        )}

        {/* ───── IMPORT TAB ───── */}
        {effectiveTab === 'import' && createStep === 'name' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Restore a wallet from its 12-24 word BIP39 seed phrase.</p>
            <div>
              <label className="block text-sm font-medium mb-1">Wallet Name</label>
              <input type="text" value={walletName} onChange={e => setWalletName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800" placeholder="imported" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Seed Phrase</label>
              <textarea value={seedPhrase} onChange={e => setSeedPhrase(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 font-mono text-sm"
                rows={3} placeholder="Enter your seed phrase words here..." />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">New Passphrase <span className="text-gray-400">(optional)</span></label>
              <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800" placeholder="Encrypt wallet with a passphrase" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Confirm Passphrase</label>
              <input type="password" value={passphraseConfirm} onChange={e => setPassphraseConfirm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800" placeholder="Repeat passphrase" />
            </div>
            <button onClick={handleImport} disabled={busy}
              className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? 'Importing...' : 'Import Wallet'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
