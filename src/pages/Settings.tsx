import { useState, useEffect } from 'react';
import { useConnectionStore } from '../stores/connection-store';
import { useSetupStore } from '../stores/setup-store';
import { migrateLegacyConnectionConfig } from '../lib/connection-config-migration';
import { isValidHnsAddress } from '../lib/address-utils';
import { formatHNS } from '../lib/name-utils';
import { MARKETPLACE_ARBITER_FEE } from '../lib/marketplace-signing';
import { PassphraseModal } from '../components/common/PassphraseModal';
import { LicenseDocument } from '../components/legal/LicenseDocument';
import { LICENSE_NAME, LICENSE_SHORT, LICENSE_SPDX } from '../lib/license';
import type { HSDConnectionConfig, HsdAdvancedConfig } from '../types/wallet';
import type { DgbServerConfig, DgbNetworkType } from '../types/swap';
import type { RelayHealth } from '../types/marketplace';
import { Server, Folder, Play, Square, AlertCircle, Loader2, Key, Radio, SlidersHorizontal, Check, Info, Wifi, WifiOff, ExternalLink, RefreshCw, AlertTriangle, Trash2, Eye, EyeOff, Copy, FileText, QrCode, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export function Settings() {
  const {
    connectionState,
    connect,
    disconnect,
    testConnection,
    error,
    processStatus,
    startManagedNode,
    stopNode,
    isLoggedIn,
    openOnboarding,
    walletEncryption,
  } = useConnectionStore();
  const openWizard = useSetupStore((state) => state.openWizard);
  const [config, setConfig] = useState<HSDConnectionConfig>({
    host: '127.0.0.1',
    nodePort: 12037,
    walletPort: 12039,
    apiKey: '',
    nodeApiKey: '',
    walletApiKey: '',
    network: 'main',
    walletId: 'primary',
    ssl: false,
  });
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [hsdDataDir, setHsdDataDir] = useState('');
  const [hsdBinary, setHsdBinary] = useState('');
  const [hsdNodePath, setHsdNodePath] = useState('');
  const [isStartingNode, setIsStartingNode] = useState(false);
  const [isStoppingNode, setIsStoppingNode] = useState(false);
  const [externalNodeDetected, setExternalNodeDetected] = useState(false);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [nostrPubkey, setNostrPubkey] = useState('');
  const [nostrRelays, setNostrRelays] = useState('');
  const [relayHealth, setRelayHealth] = useState<RelayHealth[] | null>(null);
  const [relayTesting, setRelayTesting] = useState(false);
  const [contact, setContact] = useState('');
  const [escrowArbiter, setEscrowArbiter] = useState('');
  const [escrowArbiterPayout, setEscrowArbiterPayout] = useState('');
  const [escrowArbiterStatus, setEscrowArbiterStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [advConfig, setAdvConfig] = useState<HsdAdvancedConfig>({});
  const [advConfigExpanded, setAdvConfigExpanded] = useState(false);
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [advSaving, setAdvSaving] = useState(false);
  const [advSaved, setAdvSaved] = useState(false);
  const [dgbExpanded, setDgbExpanded] = useState(false);
  const [dgbConfig, setDgbConfig] = useState<DgbServerConfig>({
    host: 'electrum1.cipig.net',
    port: 10059,
    ssl: false,
    network: 'mainnet',
  });
  const [dgbAddress, setDgbAddress] = useState('');
  const [dgbStatus, setDgbStatus] = useState<{ connected: boolean; host: string; port: number; network: string } | null>(null);
  const [dgbTesting, setDgbTesting] = useState(false);
  const [dgbTestResult, setDgbTestResult] = useState<string | null>(null);
  const [dgbConnected, setDgbConnected] = useState(false);
  const [dgbWif, setDgbWif] = useState('');
  const [dgbWifRevealed, setDgbWifRevealed] = useState(false);
  const [dgbWifCopied, setDgbWifCopied] = useState(false);
  const [dgbWifQrVisible, setDgbWifQrVisible] = useState(false);
  const [showWifPassphrase, setShowWifPassphrase] = useState(false);
  const [newWalletPassphrase, setNewWalletPassphrase] = useState('');
  const [confirmWalletPassphrase, setConfirmWalletPassphrase] = useState('');
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const [showDeepCleanConfirm, setShowDeepCleanConfirm] = useState(false);
  const [showRescanConfirm, setShowRescanConfirm] = useState(false);
  const [showStopNodeConfirm, setShowStopNodeConfirm] = useState(false);
  const [rescanHeight, setRescanHeight] = useState('');
  const [maintenanceBusy, setMaintenanceBusy] = useState<'idle' | 'deepcleaning' | 'rescanning'>('idle');
  const [maintenanceResult, setMaintenanceResult] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [appVersion, setAppVersion] = useState('0.2.2');
  const [legalError, setLegalError] = useState<string | null>(null);

  useEffect(() => {
    window.api.app.getVersion().then(setAppVersion).catch(() => {
      // Keep the build-time fallback if the IPC call is unavailable.
    });
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setDgbWif('');
      setDgbWifRevealed(false);
      setShowWifPassphrase(false);
    }
  }, [isLoggedIn]);

  // Load saved config on mount
  useEffect(() => {
    window.api.marketplace.getNostrPubkey().then(pk => {
      if (pk) setNostrPubkey(pk);
    });
    window.api.marketplace.getRelays().then(relays => {
      if (relays.length > 0) setNostrRelays(relays.join(', '));
    });
    window.api.config.get('marketplaceContact').then(val => {
      if (val) setContact(val);
    });
    window.api.config.get('marketplaceEscrowArbiter').then(val => {
      if (val) setEscrowArbiter(val);
    });
    window.api.config.get('marketplaceEscrowArbiterPayoutAddress').then(val => {
      if (val) setEscrowArbiterPayout(val);
    });
  }, []);

  // Load advanced HSD config on mount
  useEffect(() => {
    window.api.hsd.getAdvancedConfig().then(cfg => {
      if (cfg && Object.keys(cfg).length > 0) {
        setAdvConfig(cfg);
      }
    }).catch(() => {});
  }, []);

  // Load DGB settings on mount
  useEffect(() => {
    window.api.dgb.getConfig().then(cfg => {
      if (cfg) {
        setDgbConfig(cfg);
      }
    }).catch(() => {});
    window.api.dgb.getStatus().then(status => {
      setDgbStatus(status);
      setDgbConnected(status.connected);
    }).catch(() => {});
    window.api.dgb.getAddress().then(addr => {
      if (addr) setDgbAddress(addr);
    }).catch(() => {});
  }, []);

  // Load saved connection settings from the main process (encrypted at rest).
  // A legacy plaintext localStorage copy is migrated once, then deleted.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        await migrateLegacyConnectionConfig();
        const saved = await window.api.connection.getSavedConfig();
        if (saved && !cancelled) {
          setConfig((prev) => ({ ...prev, ...saved }));
        }
      } catch {
        // Fall back to the default settings
      } finally {
        if (!cancelled) setConfigLoaded(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load hsd settings from backend + auto-detect default .hsd dir
  useEffect(() => {
    const loadHsdSettings = async () => {
      try {
        const dir = await window.api.config.get('hsdDataDir');
        if (dir) {
          setHsdDataDir(dir);
        } else {
          const defaultDir = await window.api.config.getDefaultHsdDataDir();
          setHsdDataDir(defaultDir);
        }
        const bin = await window.api.config.get('hsdBinaryPath');
        if (bin) setHsdBinary(bin);
        const node = await window.api.config.get('hsdNodePath');
        if (node) setHsdNodePath(node);
      } catch {
        // Ignore
      }
    };
    loadHsdSettings();
  }, []);

  // Never keep a revealed DGB private key in renderer state after logout.
  useEffect(() => {
    if (!isLoggedIn) {
      setDgbWif('');
      setDgbWifRevealed(false);
      setDgbWifQrVisible(false);
      setDgbWifCopied(false);
    }
  }, [isLoggedIn]);

  // Persist connection settings in the main process (safeStorage-encrypted).
  useEffect(() => {
    if (!configLoaded) return;

    const timer = setTimeout(() => {
      window.api.connection.saveConfig(config).catch(() => {});
    }, 500);

    return () => clearTimeout(timer);
  }, [config, configLoaded]);

  const handleTest = async () => {
    setTestResult(null);
    const result = await testConnection(config);
    setTestResult(result);
  };

  const handleConnect = async () => {
    await connect(config);
  };

  /**
   * Attach to an hsd node that is already listening locally. Start Node calls
   * this instead of failing when another process owns the RPC port.
   */
  const connectToRunningNode = async (): Promise<boolean> => {
    setNodeError(null);

    let target: HSDConnectionConfig;
    try {
      const existing = await window.api.hsd.getExistingNodeConfig();
      target = existing || {
        ...config,
        host: '127.0.0.1',
        nodePort: config.network === 'testnet'
          ? 13037
          : config.network === 'regtest' ? 14037 : 12037,
        walletPort: config.network === 'testnet'
          ? 13039
          : config.network === 'regtest' ? 14039 : 12039,
      };
    } catch {
      target = config;
    }

    // A saved API key is not proof that a node is running. Probe the local
    // RPC and wallet ports before attempting to attach so the user gets the
    // real failure instead of a misleading API-key/wallet-name error.
    const isLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
      target.host.toLowerCase(),
    );
    if (isLoopback) {
      const [nodeProbe, walletProbe] = await Promise.allSettled([
        window.api.hsd.isPortListening(target.host, target.nodePort),
        window.api.hsd.isPortListening(target.host, target.walletPort),
      ]);
      const nodeListening = nodeProbe.status === 'fulfilled' && nodeProbe.value;
      const walletListening = walletProbe.status === 'fulfilled' && walletProbe.value;

      if (!nodeListening) {
        setConnectionExpanded(true);
        setNodeError(
          `No hsd node is listening on ${target.host}:${target.nodePort}. Start the node, then try again.`,
        );
        return false;
      }
      if (!walletListening) {
        setConnectionExpanded(true);
        setNodeError(
          `The hsd node is running, but its wallet server is not listening on ${target.host}:${target.walletPort}. Check the node's wallet configuration.`,
        );
        return false;
      }
    }

    const connected = await connect(target);
    if (connected) {
      setConfig((previous) => ({
        ...previous,
        ...target,
        walletId: target.walletId || previous.walletId,
      }));
      // The node exists outside the managed process service.
      useConnectionStore.setState({ processStatus: 'stopped' });
      setNodeError(null);
      return true;
    }

    setConnectionExpanded(true);
    setNodeError(
      useConnectionStore.getState().error
        || 'Could not attach to the running hsd node. Enter its API key under Advanced: External Connection.',
    );
    return false;
  };

  useEffect(() => {
    if (connectionState === 'connected') {
      setExternalNodeDetected(false);
      return;
    }

    let cancelled = false;
    let checking = false;

    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const existing = await window.api.hsd.getExistingNodeConfig();
        if (!existing) {
          if (!cancelled) setExternalNodeDetected(false);
          return;
        }
        const listening = await window.api.hsd.isPortListening(existing.host, existing.nodePort);
        if (!cancelled) setExternalNodeDetected(listening);
      } catch {
        if (!cancelled) setExternalNodeDetected(false);
      } finally {
        checking = false;
      }
    };

    void check();
    // Keep the banner honest when the node is started or stopped outside the
    // app, and clear it promptly after the app shuts down its managed child.
    const timer = setInterval(() => { void check(); }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectionState]);

  const handleStartManagedNode = async () => {
    setIsStartingNode(true);
    setNodeError(null);
    try {
      const success = await startManagedNode({
        dataDir: hsdDataDir,
        binaryPath: hsdBinary || undefined,
        nodePath: hsdNodePath || undefined,
        network: config.network,
        walletId: config.walletId,
      });
      if (!success) {
        const storeError = useConnectionStore.getState().error;
        if (storeError && /already running/i.test(storeError)) {
          await connectToRunningNode();
        } else {
          setNodeError(storeError || 'Failed to start hsd node.');
        }
      }
    } catch (err) {
      setNodeError(err instanceof Error ? err.message : 'Failed to start hsd');
    }
    setIsStartingNode(false);
  };

  const handleStopNode = async () => {
    setIsStoppingNode(true);
    setNodeError(null);
    try {
      await stopNode();
    } catch (err) {
      setNodeError(err instanceof Error ? err.message : 'Failed to stop hsd');
    } finally {
      setIsStoppingNode(false);
    }
  };

  const revealDgbWif = async (passphrase = '') => {
    try {
      const wif = await window.api.dgb.getWif(passphrase);
      setDgbWif(wif);
      setDgbWifRevealed(true);
      setDgbWifQrVisible(false);
      setDgbTestResult(null);
    } catch (err) {
      setDgbTestResult(
        `Could not reveal DGB private key: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleRevealDgbWif = () => {
    if (!isLoggedIn) {
      setDgbTestResult('Log in to the wallet before revealing the DGB private key.');
      return;
    }
    if (walletEncryption?.encrypted) {
      setShowWifPassphrase(true);
      return;
    }
    void revealDgbWif();
  };

  const handleEncryptWallet = async () => {
    if (!walletEncryption?.id) return;
    if (newWalletPassphrase.length < 8) {
      setSecurityMessage('Use a passphrase with at least 8 characters.');
      return;
    }
    if (newWalletPassphrase !== confirmWalletPassphrase) {
      setSecurityMessage('Passphrases do not match.');
      return;
    }

    setSecurityBusy(true);
    setSecurityMessage(null);
    try {
      await window.api.wallet.encryptWallet(walletEncryption.id, newWalletPassphrase);
      setNewWalletPassphrase('');
      setConfirmWalletPassphrase('');
      setSecurityMessage('Passphrase set. It will be required the next time you log in.');
      await useConnectionStore.getState().refreshWallet();
    } catch (err) {
      setSecurityMessage(
        `Could not set the wallet passphrase: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleHsdDirChange = async (dir: string) => {
    setHsdDataDir(dir);
    try {
      await window.api.config.set('hsdDataDir', dir);
    } catch {
      // Ignore
    }
  };

  const handleBinaryChange = async (path: string) => {
    setHsdBinary(path);
    try {
      await window.api.config.set('hsdBinaryPath', path);
    } catch {
      // Ignore
    }
  };

  const handleSaveAdvancedConfig = async () => {
    setAdvSaving(true);
    setAdvSaved(false);
    try {
      await window.api.hsd.saveAdvancedConfig(advConfig);
      setAdvSaved(true);
      setTimeout(() => setAdvSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save advanced config:', err);
    }
    setAdvSaving(false);
  };

  const clearAdvancedConfig = async () => {
    setAdvConfig({});
    try {
      await window.api.hsd.saveAdvancedConfig({});
      setAdvSaved(true);
      setTimeout(() => setAdvSaved(false), 3000);
    } catch (err) {
      console.error('Failed to clear advanced config:', err);
    }
  };

  const detectHsdBinary = async () => {
    try {
      const found = await window.api.hsd.detectHsd();
      if (found) {
        handleBinaryChange(found);
      } else {
        setNodeError('hsd binary not found. Install it via "npm install -g hsd"');
      }
    } catch {
      setNodeError('Failed to detect hsd binary');
    }
  };

  const handleTestRelays = async () => {
    setRelayTesting(true);
    try {
      const relays = nostrRelays.split(',').map((r) => r.trim()).filter(Boolean);
      if (relays.length > 0) {
        await window.api.marketplace.setRelays(relays);
      }
      setRelayHealth(await window.api.marketplace.testRelays());
    } catch (err) {
      setRelayHealth([{ url: 'configured relays', ok: false, error: err instanceof Error ? err.message : 'Test failed' }]);
    } finally {
      setRelayTesting(false);
    }
  };

  const handleSaveEscrowArbiter = async () => {
    const value = escrowArbiter.trim().toLowerCase();
    const payout = escrowArbiterPayout.trim();
    if (value && !/^[0-9a-f]{64}$/.test(value)) {
      setEscrowArbiterStatus('error');
      return;
    }
    if (value && nostrPubkey && value === nostrPubkey) {
      setEscrowArbiterStatus('error');
      return;
    }
    if (value && !isValidHnsAddress(payout)) {
      setEscrowArbiterStatus('error');
      return;
    }
    if (!value && payout) {
      setEscrowArbiterStatus('error');
      return;
    }
    try {
      await window.api.config.set('marketplaceEscrowArbiter', value);
      await window.api.config.set('marketplaceEscrowArbiterPayoutAddress', payout);
      setEscrowArbiter(value);
      setEscrowArbiterPayout(payout);
      setEscrowArbiterStatus('saved');
    } catch {
      setEscrowArbiterStatus('error');
    }
  };

  const nodeReachable = connectionState === 'connected';
  const managedNodeRunning = processStatus === 'running';
  const nodeRunning = nodeReachable || managedNodeRunning;
  const statusLabel =
    isStoppingNode
      ? 'Stopping...'
      : managedNodeRunning
        ? nodeReachable ? 'Node Running (managed)' : 'Node Running — connecting…'
        : nodeReachable
          ? 'Node Running (external)'
          : processStatus === 'starting'
            ? 'Starting...'
            : processStatus === 'error'
              ? 'Error'
              : 'Node Stopped';
  const statusDot =
    isStoppingNode
      ? 'bg-amber-500 animate-pulse'
      : nodeReachable || managedNodeRunning
        ? 'bg-green-500'
        : processStatus === 'starting'
          ? 'bg-amber-500 animate-pulse'
          : processStatus === 'error'
            ? 'bg-red-500'
            : 'bg-gray-400';

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Configure your Handshake full node wallet
        </p>
      </div>

      {/* Managed Node Section */}
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Server className="w-5 h-5 text-hns-600" />
          HSD Full Node
        </h2>

        <div className="space-y-4 pt-2">
          {/* Status */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
            <div className={`w-3 h-3 rounded-full ${statusDot}`} />
            <span className="text-sm font-medium">{statusLabel}</span>
            {nodeReachable && (
              <span className="text-xs text-green-600 ml-auto">
                {isLoggedIn ? 'Connected' : 'Wallet locked'}
              </span>
            )}
          </div>

          {externalNodeDetected && !nodeReachable && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-900/10">
              <div>
                <p className="text-sm font-medium">An hsd node is already running locally</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Connect to it instead of starting a second node.
                </p>
              </div>
              <button
                onClick={() => { void connectToRunningNode(); }}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
              >
                Connect
              </button>
            </div>
          )}

          {nodeReachable && !isLoggedIn && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-hns-200 dark:border-hns-900/40 bg-hns-50/40 dark:bg-hns-900/10">
              <div>
                <p className="text-sm font-medium">Wallet locked</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Log in to unlock balances and enable navigation.
                </p>
              </div>
              <button
                onClick={openOnboarding}
                className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors text-sm font-medium"
              >
                Log In
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-lg border border-hns-200 bg-hns-50/60 p-3 dark:border-hns-900/50 dark:bg-hns-900/10 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Node &amp; HSD setup</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Use the guided wizard to install a private runtime, reuse existing Node.js, or connect
                to an existing HSD folder.
              </p>
            </div>
            <button
              type="button"
              onClick={openWizard}
              className="shrink-0 rounded-lg border border-hns-300 px-3 py-2 text-xs font-medium text-hns-700 hover:bg-hns-100 dark:border-hns-700 dark:text-hns-300 dark:hover:bg-hns-900/30"
            >
              Run setup wizard
            </button>
          </div>

          {/* hsd Data Directory */}
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300 flex items-center gap-1">
              <Folder className="w-4 h-4" />
              hsd Data Directory
            </label>
            <input
              type="text"
              value={hsdDataDir}
              onChange={(e) => handleHsdDirChange(e.target.value)}
              placeholder="e.g. C:\Users\You\.hsd"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              Must contain &quot;chain&quot;, &quot;blocks&quot;, and &quot;wallet&quot; subdirectories (your full node data)
            </p>
          </div>

          {/* hsd Binary Path */}
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              hsd Binary Path (optional)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={hsdBinary}
                onChange={(e) => handleBinaryChange(e.target.value)}
                placeholder="Auto-detect from PATH"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500 font-mono text-sm"
              />
              <button
                onClick={detectHsdBinary}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Detect
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Install hsd globally (<code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">npm install -g hsd</code>)
              or use the setup wizard above to install a private runtime.
            </p>
          </div>

          {/* Network + Wallet ID */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Network</label>
              <select
                value={config.network}
                onChange={(e) => setConfig({ ...config, network: e.target.value as 'main' | 'testnet' | 'regtest' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500"
              >
                <option value="main">Mainnet</option>
                <option value="testnet">Testnet</option>
                <option value="regtest">Regtest</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Wallet Name</label>
              <input
                type="text"
                value={config.walletId}
                onChange={(e) => setConfig({ ...config, walletId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500"
                placeholder="primary"
              />
            </div>
          </div>

          {/* Start/Stop Button — the same control turns red while running. */}
          <div className="flex gap-3 pt-2">
            {nodeRunning ? (
              <button
                onClick={() => setShowStopNodeConfirm(true)}
                disabled={isStoppingNode || isStartingNode || processStatus === 'starting'}
                className="flex items-center justify-center gap-2 flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {isStoppingNode ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {isStoppingNode ? 'Stopping...' : 'Stop Node'}
              </button>
            ) : (
              <button
                onClick={externalNodeDetected ? () => { void connectToRunningNode(); } : handleStartManagedNode}
                disabled={isStartingNode || processStatus === 'starting' || !hsdDataDir}
                className="flex items-center justify-center gap-2 flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 transition-colors font-medium"
              >
                {isStartingNode || processStatus === 'starting' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {isStartingNode || processStatus === 'starting'
                  ? 'Connecting...'
                  : externalNodeDetected ? 'Connect to Node' : 'Start Node'}
              </button>
            )}
          </div>
          {nodeReachable && !managedNodeRunning && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Connected to an hsd node that was started outside the app. Stop Node
              asks it to shut down gracefully through its own API.
            </p>
          )}

          {nodeError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p>{nodeError}</p>
                {connectionState !== 'connected' && (
                  <button
                    onClick={() => { void connectToRunningNode(); }}
                    disabled={isStartingNode || connectionState === 'connecting'}
                    className="px-3 py-1.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 text-xs font-medium"
                  >
                    {isStartingNode || connectionState === 'connecting'
                      ? 'Connecting...'
                      : 'Connect to Running Node'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Wallet Security */}
      {isLoggedIn && walletEncryption && !walletEncryption.encrypted && (
        <section className="card space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-500" />
            Wallet Security
          </h2>
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
            This wallet has no passphrase. Anyone with access to this computer account can spend its funds.
            Set a passphrase before adding significant funds.
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">New Passphrase</label>
              <input
                type="password"
                value={newWalletPassphrase}
                onChange={(e) => { setNewWalletPassphrase(e.target.value); setSecurityMessage(null); }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Confirm Passphrase</label>
              <input
                type="password"
                value={confirmWalletPassphrase}
                onChange={(e) => { setConfirmWalletPassphrase(e.target.value); setSecurityMessage(null); }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                placeholder="Repeat passphrase"
              />
            </div>
          </div>
          {securityMessage && (
            <p className={`text-sm ${securityMessage.startsWith('Passphrase set') ? 'text-green-600' : 'text-red-500'}`}>
              {securityMessage}
            </p>
          )}
          <button
            onClick={() => { void handleEncryptWallet(); }}
            disabled={securityBusy || !newWalletPassphrase || !confirmWalletPassphrase}
            className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
          >
            {securityBusy && <Loader2 className="w-4 h-4 animate-spin" />}
            {securityBusy ? 'Setting Passphrase...' : 'Set Passphrase'}
          </button>
        </section>
      )}

      {/* Advanced HSD Configuration */}
      <section className="card space-y-4">
        <button
          onClick={() => setAdvConfigExpanded(!advConfigExpanded)}
          className="w-full flex items-center justify-between gap-2 text-lg font-semibold text-left"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-hns-600" />
            Advanced HSD Configuration
          </span>
          <svg
            className={`w-5 h-5 transition-transform ${advConfigExpanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <p className="text-xs text-gray-400 -mt-2">
          Configure hsd node behavior. Settings are written to <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">hsd.conf</code> in your data directory. Requires node restart to take effect.
        </p>

        {advConfigExpanded && (
          <div className="space-y-6 pt-2">
            {/* Performance */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-hns-500"></span>
                Performance &amp; Resources
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400 flex items-center gap-1">
                    Workers
                    <span title="Number of worker child processes for CPU-bound tasks" className="cursor-help text-gray-400">
                      <Info className="w-3 h-3" />
                    </span>
                  </label>
                  <input type="number" min={0} max={64}
                    value={advConfig.workers ?? ''}
                    onChange={e => setAdvConfig({ ...advConfig, workers: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Auto (default)"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400 flex items-center gap-1">
                    Workers Size
                    <span title="Size of the worker pool (default: 2)" className="cursor-help text-gray-400">
                      <Info className="w-3 h-3" />
                    </span>
                  </label>
                  <input type="number" min={0} max={64}
                    value={advConfig.workersSize ?? ''}
                    onChange={e => setAdvConfig({ ...advConfig, workersSize: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="2 (default)"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
              </div>
            </div>

            {/* Indexing & Migration */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-hns-500"></span>
                Indexing &amp; Migration
              </h3>
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors">
                  <input type="checkbox"
                    checked={advConfig.indexTx ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, indexTx: e.target.checked })}
                    className="mt-0.5 rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  <div>
                    <span className="text-sm font-medium block">Index Transactions</span>
                    <span className="text-xs text-gray-400">Required for transaction history lookup and certain wallet features.</span>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors">
                  <input type="checkbox"
                    checked={advConfig.indexAddress ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, indexAddress: e.target.checked })}
                    className="mt-0.5 rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  <div>
                    <span className="text-sm font-medium block">Index Addresses</span>
                    <span className="text-xs text-gray-400">Required for address-based queries and wallet features.</span>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors">
                  <input type="checkbox"
                    checked={advConfig.migrateNoRescan ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, migrateNoRescan: e.target.checked })}
                    className="mt-0.5 rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  <div>
                    <span className="text-sm font-medium block">Skip Rescan on Migration</span>
                    <span className="text-xs text-gray-400">
                      Skip wallet rescan when migrating databases. Safe to enable if you trust your existing chain data
                      (e.g., copied from a trusted source or a previous Bob Wallet install).
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Network */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-hns-500"></span>
                Network
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400 flex items-center gap-1">
                    Max Inbound
                    <span title="Maximum number of inbound peer connections" className="cursor-help text-gray-400">
                      <Info className="w-3 h-3" />
                    </span>
                  </label>
                  <input type="number" min={0} max={256}
                    value={advConfig.maxInbound ?? ''}
                    onChange={e => setAdvConfig({ ...advConfig, maxInbound: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Default"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400 flex items-center gap-1">
                    Max Outbound
                    <span title="Maximum number of outbound peer connections" className="cursor-help text-gray-400">
                      <Info className="w-3 h-3" />
                    </span>
                  </label>
                  <input type="number" min={0} max={256}
                    value={advConfig.maxOutbound ?? ''}
                    onChange={e => setAdvConfig({ ...advConfig, maxOutbound: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Default"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
              </div>
              <div className="flex gap-4 mt-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={advConfig.listen ?? true}
                    onChange={e => setAdvConfig({ ...advConfig, listen: e.target.checked })}
                    className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  Listen (accept connections)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={advConfig.noDns ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, noDns: e.target.checked })}
                    className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  No DNS seeding
                </label>
              </div>
            </div>

            {/* Protocol */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-hns-500"></span>
                Protocol Options
              </h3>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={advConfig.bip37 ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, bip37: e.target.checked })}
                    className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  BIP37 (Bloom filters)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={advConfig.checkpoints ?? true}
                    onChange={e => setAdvConfig({ ...advConfig, checkpoints: e.target.checked })}
                    className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  Checkpoints
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={advConfig.selfish ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, selfish: e.target.checked })}
                    className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  Selfish mode
                </label>
              </div>
            </div>

            {/* Storage */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-hns-500"></span>
                Storage
              </h3>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={advConfig.prune ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, prune: e.target.checked })}
                    className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  Prune (save disk space)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={advConfig.compact ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, compact: e.target.checked })}
                    className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  Compact (slower writes, smaller DB)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={advConfig.memory ?? false}
                    onChange={e => setAdvConfig({ ...advConfig, memory: e.target.checked })}
                    className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                  In-memory (fast, uses RAM)
                </label>
              </div>
            </div>

            {/* Logging */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-hns-500"></span>
                Logging
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">Log Level</label>
                  <select
                    value={advConfig.logLevel || ''}
                    onChange={e => setAdvConfig({ ...advConfig, logLevel: e.target.value || undefined })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="">Default (info)</option>
                    <option value="debug">Debug</option>
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                  </select>
                </div>
                <div className="flex items-end gap-4 pb-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={advConfig.logFile ?? true}
                      onChange={e => setAdvConfig({ ...advConfig, logFile: e.target.checked })}
                      className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                    Log to File
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={advConfig.logConsole ?? true}
                      onChange={e => setAdvConfig({ ...advConfig, logConsole: e.target.checked })}
                      className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                    Log to Console
                  </label>
                </div>
              </div>
            </div>

            {/* RPC */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-hns-500"></span>
                RPC / Ports
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">RPC Host</label>
                  <input type="text"
                    value={advConfig.rsHost ?? ''}
                    onChange={e => setAdvConfig({ ...advConfig, rsHost: e.target.value || undefined })}
                    placeholder="127.0.0.1"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">RPC Port</label>
                  <input type="number" min={0} max={65535}
                    value={advConfig.rsPort ?? ''}
                    onChange={e => setAdvConfig({ ...advConfig, rsPort: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="12037 (mainnet)"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">Wallet Host</label>
                  <input type="text"
                    value={advConfig.walletHost ?? ''}
                    onChange={e => setAdvConfig({ ...advConfig, walletHost: e.target.value || undefined })}
                    placeholder="127.0.0.1"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">Wallet Port</label>
                  <input type="number" min={0} max={65535}
                    value={advConfig.walletPort ?? ''}
                    onChange={e => setAdvConfig({ ...advConfig, walletPort: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="12039 (mainnet)"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer mt-2">
                <input type="checkbox"
                  checked={advConfig.ssl ?? false}
                  onChange={e => setAdvConfig({ ...advConfig, ssl: e.target.checked })}
                  className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
                SSL for RPC connections
              </label>
            </div>

            {/* Save / Reset buttons */}
            <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleSaveAdvancedConfig}
                disabled={advSaving}
                className="flex items-center justify-center gap-2 px-6 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 transition-colors font-medium text-sm"
              >
                {advSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {advSaving ? 'Saving...' : 'Save to hsd.conf'}
              </button>
              <button
                onClick={clearAdvancedConfig}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Reset to Defaults
              </button>
              {advSaved && (
                <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                  <Check className="w-4 h-4" /> Saved
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
              <p className="font-medium mb-1">How it works:</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Configure the settings above to match your hardware and preferences</li>
                <li>Click &quot;Save to hsd.conf&quot; — this writes a <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">hsd.conf</code> file to your data directory</li>
                <li>Stop the node and start it again for changes to take effect</li>
                <li>Leave a field empty to use hsd&apos;s default value</li>
                <li>To revert to app defaults, click &quot;Reset to Defaults&quot; — this removes the conf file and the app falls back to its hardcoded settings</li>
              </ol>
            </div>
          </div>
        )}
      </section>

      {/* Connection Section */}
      <section className="card space-y-4">
        <button
          onClick={() => setConnectionExpanded(!connectionExpanded)}
          className="w-full flex items-center justify-between gap-2 text-lg font-semibold text-left"
        >
          <span className="flex items-center gap-2">
            Advanced: External Connection
          </span>
          <svg
            className={`w-5 h-5 transition-transform ${connectionExpanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <p className="text-xs text-gray-400 -mt-2">Connect to an already-running external hsd node</p>

        {connectionExpanded && (<div className="space-y-6 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Host</label>
              <input
                type="text"
                value={config.host}
                onChange={(e) => setConfig({ ...config, host: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Node Port</label>
              <input
                type="number"
                value={config.nodePort}
                onChange={(e) => setConfig({ ...config, nodePort: parseInt(e.target.value) || 12037 })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Wallet Port</label>
              <input
                type="number"
                value={config.walletPort}
                onChange={(e) => setConfig({ ...config, walletPort: parseInt(e.target.value) || 12039 })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-hns-500 focus:border-hns-500"
              />
            </div>
          </div>

          <div className="space-y-4 p-5 border border-hns-100 dark:border-hns-900/30 rounded-xl bg-hns-50/20 dark:bg-hns-900/5 shadow-sm">
            <h3 className="font-semibold text-hns-700 dark:text-hns-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-hns-500"></span>
              API Authentication
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Node API Key (Port {config.nodePort})</label>
                <input
                  type="password"
                  value={config.nodeApiKey || ''}
                  onChange={(e) => setConfig({ ...config, nodeApiKey: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-hns-500 focus:border-hns-500"
                  placeholder="Enter Handshake Node API Key"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Wallet API Key (Port {config.walletPort})</label>
                <input
                  type="password"
                  value={config.walletApiKey || ''}
                  onChange={(e) => setConfig({ ...config, walletApiKey: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-hns-500 focus:border-hns-500"
                  placeholder="Enter API Key"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleTest}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
            >
              Test Connection
            </button>
            <button
              onClick={handleConnect}
              disabled={connectionState === 'connected'}
              className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 transition-colors font-medium"
            >
              {connectionState === 'connected' ? 'Connected' : 'Connect'}
            </button>
            {connectionState === 'connected' && (
              <button
                onClick={() => disconnect()}
                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
              >
                Disconnect
              </button>
            )}
          </div>

          {testResult && (
            <div className={`p-4 rounded-lg font-medium shadow-sm ${testResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 border border-green-100 dark:border-green-800/30' : 'bg-red-50 dark:bg-red-900/20 text-red-700 border border-red-100 dark:border-red-800/30'}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${testResult.success ? 'bg-green-500' : 'bg-red-500'}`}></span>
                {testResult.success ? 'Connection successful!' : testResult.error}
              </div>
            </div>
          )}

          {error && connectionState === 'error' && (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 border border-red-100 dark:border-red-800/30 font-medium shadow-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                {error}
              </div>
            </div>
          )}
        </div>
        )}
      </section>

      {/* Marketplace Settings */}
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Radio className="w-5 h-5 text-hns-600" />
          Nostr Marketplace
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300 flex items-center gap-1">
              <Key className="w-4 h-4" />
              Nostr Public Key
            </label>
            <input type="text" value={nostrPubkey} readOnly
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm font-mono"
              placeholder="Generating..." />
            <p className="text-xs text-gray-400 mt-1">
              Auto-generated on first launch. Listings you create are signed with this key and broadcast over Nostr relays.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Nostr Relays</label>
            <div className="flex gap-2">
              <input type="text" value={nostrRelays} onChange={e => setNostrRelays(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                placeholder="wss://relay.damus.io, wss://nos.lol" />
              <button onClick={() => {
                const relays = nostrRelays.split(',').map(r => r.trim()).filter(Boolean);
                window.api.marketplace.setRelays(relays);
              }}
                className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 text-sm font-medium">
                Save
              </button>
              <button
                onClick={handleTestRelays}
                disabled={relayTesting}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium disabled:opacity-50"
              >
                {relayTesting ? 'Testing...' : 'Test'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Comma-separated list of Nostr relay WebSocket URLs. Listings are published to and discovered from these relays.
            </p>
            {relayHealth && (
              <div className="mt-2 space-y-1">
                {relayHealth.map((relay) => (
                  <div key={relay.url} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${relay.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-mono truncate">{relay.url}</span>
                    <span className={`truncate ${relay.ok ? 'text-green-600' : 'text-red-500'}`}>
                      {relay.ok ? 'Connected' : relay.error || 'Unreachable'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Contact Info (optional)</label>
            <div className="flex gap-2">
              <input type="text" value={contact} onChange={e => setContact(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                placeholder="Telegram: @user, email@example.com, X: @handle, +2712345678" />
              <button onClick={() => window.api.config.set('marketplaceContact', contact)}
                className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 text-sm font-medium">
                Save
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Optional. Published with your listings so buyers can reach you. This is public on Nostr relays.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Escrow Arbiter (optional)</label>
            <div className="space-y-2">
              <input
                type="text"
                value={escrowArbiter}
                onChange={(e) => {
                  setEscrowArbiter(e.target.value);
                  setEscrowArbiterStatus('idle');
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-xs font-mono"
                placeholder="Independent arbiter's 64-character Nostr public key"
              />
              <input
                type="text"
                value={escrowArbiterPayout}
                onChange={(e) => {
                  setEscrowArbiterPayout(e.target.value);
                  setEscrowArbiterStatus('idle');
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-xs font-mono"
                placeholder="Arbiter's HNS payout address (e.g. hs1...)"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleSaveEscrowArbiter}
                  className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 text-sm font-medium"
                >
                  Save Escrow Settings
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Required to offer 2-of-3 escrow. The arbiter is an independent third party. Buyers
              fund an additional {formatHNS(MARKETPLACE_ARBITER_FEE)} arbitration fee: it is
              returned to the buyer on a normal release and paid to the arbiter only if the trade
              goes to a refund or arbitration release. Leave both fields blank to offer
              transfer-first trades only.
            </p>
            {escrowArbiterStatus === 'saved' && (
              <p className="text-xs text-green-600 mt-1">
                Saved. New listings will offer paid escrow.
              </p>
            )}
            {escrowArbiterStatus === 'error' && (
              <p className="text-xs text-red-500 mt-1">
                Enter a valid 64-character hex arbiter key that is not your own, plus a valid HNS
                payout address for the arbiter, or leave both blank.
              </p>
            )}
          </div>
          <div className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
            <p className="font-medium mb-1">How it works:</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>A Nostr keypair is auto-generated when you first use the wallet</li>
              <li>Listing names for sale publishes a signed event to all configured relays</li>
              <li>Other wallets query the same relays to discover listings</li>
              <li>No central server needed &mdash; the relay network is the discovery layer</li>
            </ol>
          </div>
        </div>
      </section>

      {/* DigiByte (DGB) Settings */}
      <section className="card space-y-4">
        <button
          onClick={() => setDgbExpanded(!dgbExpanded)}
          className="w-full flex items-center justify-between gap-2 text-lg font-semibold text-left"
        >
          <span className="flex items-center gap-2">
            <Wifi className={`w-5 h-5 ${dgbConnected ? 'text-green-500' : 'text-gray-400'}`} />
            DigiByte (DGB) Server
          </span>
          <div className="flex items-center gap-2">
            {dgbConnected && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Connected</span>
            )}
            <svg
              className={`w-5 h-5 transition-transform ${dgbExpanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        <p className="text-xs text-gray-400 -mt-2">
          Connect to an Electrum-DGB server for DigiByte balance queries, UTXO management, and transaction broadcasting. Required for HNS ↔ DGB atomic swaps.
        </p>

        {dgbExpanded && (
          <div className="space-y-4 pt-2">
            {/* Status indicator */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
              <div className={`w-3 h-3 rounded-full ${dgbConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
              <span className="text-sm font-medium">
                {dgbConnected ? `Connected to ${dgbStatus?.host || dgbConfig.host}` : 'Disconnected'}
              </span>
            </div>

            {/* Derived DGB Address */}
            {dgbAddress && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300 flex items-center gap-1">
                  <ExternalLink className="w-4 h-4" />
                  Derived DGB Address
                </label>
                <input type="text" value={dgbAddress} readOnly
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm font-mono" />
                <p className="text-xs text-gray-400 mt-1">
                  Derived from this wallet&apos;s local DGB seed. It is used for DGB deposits and swaps on the selected network.
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Only send DGB on the {dgbStatus?.network === 'testnet' ? 'Testnet' : 'Mainnet'} network to this address.
                  Mainnet and testnet addresses are different.
                </p>
              </div>
            )}

            {/* DGB Private Key (WIF) */}
            {dgbAddress && (
              <div>
                {isLoggedIn ? (
                  <>
                    <button
                      onClick={() => {
                        if (dgbWifRevealed) {
                          setDgbWifRevealed(false);
                          // Do not leave the secret in renderer memory.
                          setDgbWif('');
                          setDgbWifCopied(false);
                          setDgbWifQrVisible(false);
                        } else {
                          handleRevealDgbWif();
                        }
                      }}
                      className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    >
                      {dgbWifRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      {dgbWifRevealed ? 'Hide Private Key' : 'Show Private Key (WIF)'}
                    </button>
                    {dgbWifRevealed && dgbWif && (
                      <>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input type="text" value={dgbWif} readOnly
                            className="min-w-[12rem] flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm font-mono" />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(dgbWif);
                              setDgbWifCopied(true);
                              setTimeout(() => setDgbWifCopied(false), 2000);
                            }}
                            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            title="Copy WIF"
                          >
                            <Copy className={`w-4 h-4 ${dgbWifCopied ? 'text-green-500' : 'text-gray-400'}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDgbWifQrVisible((visible) => !visible)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                            title={dgbWifQrVisible ? 'Hide private-key QR code' : 'Show private-key QR code'}
                          >
                            <QrCode className="w-4 h-4" />
                            {dgbWifQrVisible ? 'Hide QR' : 'Show QR'}
                          </button>
                        </div>
                        {dgbWifQrVisible && (
                          <div className="mt-3 flex flex-col items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-900/20">
                            <div className="rounded-lg bg-white p-3 shadow-sm">
                              <QRCodeSVG value={dgbWif} size={192} level="M" />
                            </div>
                            <p className="max-w-sm text-center text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                              This QR code contains the private key for this DGB address. Anyone who
                              scans it can spend the DGB. Keep it offline, do not screenshot it, and
                              never share it.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      This is the same private key encoded for the selected network. Import it into a
                      DigiByte wallet on the same network only.
                      {walletEncryption?.encrypted ? ' Your wallet passphrase is required each time.' : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Log in to the wallet to reveal the DGB private key.
                  </p>
                )}
              </div>
            )}

            {/* Network */}
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Network</label>
              <select
                value={dgbConfig.network}
                onChange={(e) => {
                  setDgbConfig({ ...dgbConfig, network: e.target.value as DgbNetworkType });
                  // The address and WIF are network-specific. Clear them until
                  // the new network is connected so the user cannot fund an
                  // address from the wrong network.
                  setDgbAddress('');
                  setDgbWif('');
                  setDgbWifRevealed(false);
                  setDgbWifQrVisible(false);
                  setDgbTestResult('Network changed. Click Reconnect to apply.');
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
              >
                <option value="mainnet">Mainnet</option>
                <option value="testnet">Testnet</option>
              </select>
            </div>

            {/* Server */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Server Host</label>
                <input type="text"
                  value={dgbConfig.host}
                  onChange={(e) => setDgbConfig({ ...dgbConfig, host: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                  placeholder="electrum1.cipig.net" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Port</label>
                <input type="number"
                  value={dgbConfig.port}
                  onChange={(e) => setDgbConfig({ ...dgbConfig, port: parseInt(e.target.value) || 50002 })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm" />
              </div>
            </div>

            {/* SSL Toggle */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox"
                checked={dgbConfig.ssl}
                onChange={(e) => setDgbConfig({ ...dgbConfig, ssl: e.target.checked })}
                className="rounded border-gray-300 text-hns-600 focus:ring-hns-500" />
              SSL / TLS
            </label>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={async () => {
                  setDgbTesting(true);
                  setDgbTestResult(null);
                  try {
                    await window.api.dgb.connect(dgbConfig.host, dgbConfig.port, dgbConfig.ssl, dgbConfig.network);
                    await window.api.dgb.saveConfig(dgbConfig);
                    const addr = await window.api.dgb.getAddress();
                    if (addr) setDgbAddress(addr);
                    setDgbWif('');
                    setDgbWifRevealed(false);
                    setDgbWifQrVisible(false);
                    const status = await window.api.dgb.getStatus();
                    setDgbStatus(status);
                    setDgbConnected(true);
                    setDgbTestResult('Connected successfully!');
                  } catch (err) {
                    setDgbConnected(false);
                    setDgbStatus(null);
                    setDgbAddress('');
                    setDgbWif('');
                    setDgbWifRevealed(false);
                    setDgbWifQrVisible(false);
                    setDgbTestResult(`Connection failed: ${err}`);
                  }
                  setDgbTesting(false);
                }}
                disabled={dgbTesting}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {dgbTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                {dgbTesting ? 'Connecting...' : dgbConnected ? 'Reconnect' : 'Connect'}
              </button>
              {dgbConnected && (
                <button
                  onClick={async () => {
                    await window.api.dgb.disconnect();
                    setDgbConnected(false);
                    setDgbWif('');
                    setDgbWifRevealed(false);
                    setDgbWifQrVisible(false);
                    setDgbTestResult('Disconnected');
                  }}
                  className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium"
                >
                  <WifiOff className="w-4 h-4 inline mr-1" />
                  Disconnect
                </button>
              )}
              <button
                onClick={async () => {
                  await window.api.dgb.saveConfig(dgbConfig);
                  setDgbTestResult('Settings saved');
                }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
              >
                Save Settings
              </button>
            </div>

            {dgbTestResult && (
              <div className={`p-3 rounded-lg text-sm ${
                dgbTestResult.includes('successfully') || dgbTestResult === 'Settings saved'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 border border-green-100'
                  : dgbTestResult === 'Disconnected'
                  ? 'bg-gray-50 text-gray-600 border border-gray-200'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 border border-red-100'
              }`}>
                {dgbTestResult}
              </div>
            )}

            <div className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
              <p className="font-medium mb-1">How it works:</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Connect to a public Electrum-DGB server or your own</li>
                <li>The app derives a DGB address from a separate local DGB seed stored on this device</li>
                <li>Use the Swap page to publish HTLC-based atomic swap offers between HNS and DGB</li>
                <li>All swaps are trustless: hash time lock contracts ensure neither party can cheat</li>
              </ol>
            </div>
          </div>
        )}
      </section>

      {/* Wallet Maintenance */}
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-hns-600" />
          Wallet Maintenance
        </h2>
        <p className="text-xs text-gray-400">
          Advanced wallet database operations. Use with caution.
        </p>

        {/* Deep Clean */}
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3">
          <h3 className="font-medium">Deep Clean Wallet</h3>
          <p className="text-sm text-gray-500">
            Clears cached balance and transaction history while keeping your keys and name mappings intact.
            Use if your wallet shows incorrect balances or stale transaction data.
          </p>
          <button
            onClick={() => setShowDeepCleanConfirm(true)}
            disabled={maintenanceBusy !== 'idle'}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-amber-200 text-amber-600 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/10 disabled:opacity-50 transition-colors font-medium"
          >
            {maintenanceBusy === 'deepcleaning' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            {maintenanceBusy === 'deepcleaning' ? 'Cleaning...' : 'Deep Clean'}
          </button>
        </div>

        {/* Rescan */}
        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3">
          <h3 className="font-medium">Rescan Blockchain</h3>
          <p className="text-sm text-gray-500">
            Re-scan the blockchain from a given height to recover wallet transactions.
            Useful after restoring from seed or when transaction history is missing.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number" min={0}
              value={rescanHeight}
              onChange={e => setRescanHeight(e.target.value)}
              placeholder="Start height (0 = full rescan)"
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
            />
            <button
              onClick={() => setShowRescanConfirm(true)}
              disabled={maintenanceBusy !== 'idle'}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/10 disabled:opacity-50 transition-colors font-medium whitespace-nowrap"
            >
              {maintenanceBusy === 'rescanning' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {maintenanceBusy === 'rescanning' ? 'Rescanning...' : 'Rescan'}
            </button>
          </div>
        </div>

        {maintenanceResult && (
          <div className="p-3 rounded-lg text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 border border-blue-100">
            {maintenanceResult}
          </div>
        )}
      </section>

      {/* About and Legal */}
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5 text-hns-600" />
          About &amp; Legal
        </h2>

        <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">Handess Wallet {appVersion} beta</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Free/open-source software. Created by 8t9.dev.
              </p>
            </div>
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-full px-2.5 py-1">
              {LICENSE_SHORT}
            </span>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400">
            Handess Wallet is free software under the {LICENSE_NAME} ({LICENSE_SPDX}).
            You may use, modify, and redistribute it under that license. Third-party
            components remain under their own licenses. The Handess name and logo are
            branding of 8t9.dev and are not licensed under the GPL.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowLicenseModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium transition-colors"
            >
              <FileText className="w-4 h-4" />
              View License ({LICENSE_SHORT})
            </button>
            <button
              type="button"
              onClick={() => {
                setLegalError(null);
                window.api.app.openThirdPartyNotices().catch((err) => {
                  setLegalError(
                    err instanceof Error ? err.message : 'Could not open the third-party notices.',
                  );
                });
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Third-Party Notices
            </button>
          </div>

          {legalError && (
            <p className="text-xs text-red-600 dark:text-red-400">{legalError}</p>
          )}
        </div>
      </section>

      {/* Deep Clean Confirmation Modal */}
      {showDeepCleanConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold">Deep Clean Wallet?</h3>
            </div>
            <p className="text-sm text-gray-500">
              This clears transaction history and balance state for every wallet managed by this node.
              Private keys, accounts, and name data are preserved. Run Rescan Blockchain afterward to
              rebuild history; a full rescan can take a long time.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={async () => {
                  setShowDeepCleanConfirm(false);
                  setMaintenanceBusy('deepcleaning');
                  setMaintenanceResult(null);
                  try {
                    await window.api.wallet.deepClean();
                    setMaintenanceResult('Deep clean completed. Run Rescan Blockchain to rebuild transaction history.');
                  } catch (err) {
                    setMaintenanceResult(`Deep clean failed: ${err instanceof Error ? err.message : String(err)}`);
                  }
                  setMaintenanceBusy('idle');
                }}
                className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium"
              >
                Confirm Deep Clean
              </button>
              <button
                onClick={() => setShowDeepCleanConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rescan Confirmation Modal */}
      {showRescanConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold">Rescan Blockchain?</h3>
            </div>
            <p className="text-sm text-gray-500">
              This will rescan the blockchain
              {rescanHeight ? ` from height ${parseInt(rescanHeight) || 0}` : ' from the beginning'}.
              This can take a significant amount of time and may slow down your node during the process.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={async () => {
                  setShowRescanConfirm(false);
                  setMaintenanceBusy('rescanning');
                  setMaintenanceResult(null);
                  try {
                    const height = rescanHeight ? parseInt(rescanHeight) || 0 : 0;
                    await window.api.wallet.rescan(height);
                    setMaintenanceResult('Rescan started successfully.');
                  } catch (err) {
                    setMaintenanceResult(`Rescan failed: ${err instanceof Error ? err.message : String(err)}`);
                  }
                  setMaintenanceBusy('idle');
                }}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                Start Rescan
              </button>
              <button
                onClick={() => setShowRescanConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showStopNodeConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <h3 className="text-lg font-semibold">Stop the Handshake node?</h3>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {managedNodeRunning
                ? 'This stops the node started by Handess Wallet.'
                : 'This asks the externally started hsd node to shut down through its own API. Other applications using that node will be disconnected.'}
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  setShowStopNodeConfirm(false);
                  void handleStopNode();
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                Stop Node
              </button>
              <button
                onClick={() => setShowStopNodeConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showLicenseModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Handess Wallet license"
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-semibold">Handess Wallet License</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {LICENSE_NAME} · {LICENSE_SPDX}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLicenseModal(false)}
                aria-label="Close license"
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <LicenseDocument className="flex-1 min-h-0" />
            <div className="flex justify-end px-6 py-3 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setShowLicenseModal(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-hns-600 text-white hover:bg-hns-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showWifPassphrase && (
        <PassphraseModal
          title="Reveal DGB Private Key"
          onSubmit={(pwd) => {
            setShowWifPassphrase(false);
            void revealDgbWif(pwd);
          }}
          onCancel={() => setShowWifPassphrase(false)}
        />
      )}
    </div>
  );
}
