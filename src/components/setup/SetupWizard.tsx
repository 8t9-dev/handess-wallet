import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Loader2,
  Server,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { useConnectionStore } from '../../stores/connection-store';
import { useSetupStore } from '../../stores/setup-store';
import { HSD_RUNTIME, formatRuntimeSize } from '../../lib/setup-runtime';
import type {
  SetupEnvironmentStatus,
  SetupMode,
  SetupRuntimeInstallResult,
  SetupRuntimeProgress,
} from '../../types/setup';

const STEPS = ['Setup type', 'Node & HSD', 'Data folder', 'Start'];

function shortPath(value: string, length = 64): string {
  if (value.length <= length) return value;
  return `${value.slice(0, 28)}…${value.slice(-30)}`;
}

export function SetupWizard() {
  const { isOpen, closeWizard } = useSetupStore();
  const {
    connect,
    startManagedNode,
    config: connectionConfig,
  } = useConnectionStore();

  const [status, setStatus] = useState<SetupEnvironmentStatus | null>(null);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<SetupMode>('new');
  const [runtime, setRuntime] = useState<SetupRuntimeInstallResult | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [nodePath, setNodePath] = useState('');
  const [binaryPath, setBinaryPath] = useState('');
  const [progress, setProgress] = useState<SetupRuntimeProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [nodeReady, setNodeReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLinux = navigator.userAgent.includes('Linux');

  const loadStatus = async () => {
    try {
      const next = await window.api.setup.getStatus();
      setStatus(next);
      setRuntime(next.runtime.installed ? {
        path: next.runtime.path || '',
        nodePath: next.runtime.nodePath || '',
        hsdPath: next.runtime.hsdPath || '',
        nodeVersion: next.runtime.nodeVersion || HSD_RUNTIME.nodeVersion,
        hsdVersion: next.runtime.hsdVersion || HSD_RUNTIME.hsdVersion,
      } : null);
      setDataDir((current) => current
        || next.hsdDataDir
        || next.existingDataDirs.find((item) => item.hasChain)?.path
        || next.defaultDataDir);
      setNodePath((current) => current
        || next.runtime.nodePath
        || next.systemNode?.path
        || '');
      setBinaryPath((current) => current
        || next.systemHsd?.path
        || next.runtime.hsdPath
        || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not inspect this machine.');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setError(null);
    setNodeReady(false);
    void loadStatus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !window.api?.on?.setupProgress) return;
    return window.api.on.setupProgress((next) => setProgress(next));
  }, [isOpen]);

  if (!isOpen) return null;

  const chooseMode = (next: SetupMode) => {
    setMode(next);
    setError(null);
    setNodeReady(false);
    if (next === 'new') {
      setNodePath(runtime?.nodePath || status?.runtime.nodePath || '');
      setBinaryPath(runtime?.hsdPath || status?.runtime.hsdPath || '');
    } else if (next === 'node') {
      setNodePath(status?.systemNode?.path || runtime?.nodePath || '');
      setBinaryPath(status?.systemHsd?.path || runtime?.hsdPath || '');
    } else if (next === 'hsd') {
      setNodePath(status?.systemNode?.path || runtime?.nodePath || '');
      setBinaryPath(status?.systemHsd?.path || '');
    }
  };

  const chooseDataDir = async () => {
    try {
      const picked = await window.api.setup.chooseDataDir();
      if (picked) setDataDir(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the folder picker.');
    }
  };

  const installDownloadedRuntime = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const installed = await window.api.setup.downloadRuntime();
      setRuntime(installed);
      if (mode === 'new') {
        setNodePath(installed.nodePath);
        setBinaryPath(installed.hsdPath);
      } else if (!binaryPath) {
        setBinaryPath(installed.hsdPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the HSD runtime.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const installLocalRuntime = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const installed = await window.api.setup.installRuntimeFromFile();
      if (installed) {
        setRuntime(installed);
        if (mode === 'new') {
          setNodePath(installed.nodePath);
          setBinaryPath(installed.hsdPath);
        } else if (!binaryPath) {
          setBinaryPath(installed.hsdPath);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not install the runtime zip.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const cancelDownload = async () => {
    try {
      await window.api.setup.cancelRuntime();
    } catch {
      // Best-effort.
    }
  };

  const componentsReady = (() => {
    if (mode === 'new') return Boolean(runtime);
    if (mode === 'node') return Boolean(nodePath) && Boolean(binaryPath);
    if (mode === 'hsd') return Boolean(nodePath) && Boolean(binaryPath);
    return true;
  })();

  const finish = async (skip = false) => {
    if (skip) {
      try {
        await window.api.setup.cancelRuntime().catch(() => false);
        await window.api.setup.complete({ mode: 'skip' });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save setup.');
        return;
      }
      closeWizard();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.api.setup.complete({
        mode,
        dataDir: dataDir || undefined,
        binaryPath: binaryPath || undefined,
        nodePath: nodePath || undefined,
        network: connectionConfig?.network || 'main',
      });
      closeWizard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save setup.');
    } finally {
      setBusy(false);
    }
  };

  const startNode = async () => {
    if (!dataDir.trim()) {
      setError('Choose an HSD data folder first.');
      return;
    }
    setStarting(true);
    setError(null);
    setNodeReady(false);
    try {
      const network = connectionConfig?.network || 'main';
      const walletId = connectionConfig?.walletId || 'primary';

      // Let the existing-node helpers read hsd.conf from the chosen folder.
      try {
        await window.api.hsd.setDataDir(dataDir.trim());
      } catch {
        // The setup completion will save it anyway.
      }

      if (mode === 'hsd' && status?.runningNode) {
        const existing = await window.api.hsd.getExistingNodeConfig();
        if (existing) {
          const connected = await connect(existing);
          if (connected) {
            setNodeReady(true);
            return;
          }
        }
      }

      const started = await startManagedNode({
        dataDir: dataDir.trim(),
        binaryPath: binaryPath.trim() || undefined,
        nodePath: nodePath.trim() || undefined,
        network,
        walletId,
      });
      if (started) {
        setNodeReady(true);
        return;
      }
      const message = useConnectionStore.getState().error;
      setError(message || 'The node did not start. You can still finish and configure it in Settings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the node.');
    } finally {
      setStarting(false);
    }
  };

  const title = mode === 'new'
    ? 'New to Handshake'
    : mode === 'node'
      ? 'Use existing Node.js'
      : mode === 'hsd'
        ? 'Use existing HSD'
        : 'Set up Handess';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6 dark:border-gray-700">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-hns-600" />
              <h1 className="text-xl font-semibold">Set up Handess Wallet</h1>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Choose how this machine should connect to Handshake. You can change this later in Settings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void finish(true)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            title="Skip setup for now"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-gray-200 px-6 py-3 text-xs dark:border-gray-700">
          {STEPS.map((label, index) => (
            <div
              key={label}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                index === step
                  ? 'bg-hns-600 text-white'
                  : index < step
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}
            >
              {index < step ? <Check className="h-3 w-3" /> : <span>{index + 1}</span>}
              {label}
            </div>
          ))}
        </div>

        <div className="space-y-4 p-6">
          {step === 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">How do you want to set up Handshake?</h2>
              {[
                {
                  value: 'new' as SetupMode,
                  icon: Download,
                  title: 'New to Handshake',
                  body: `Download a verified ${formatRuntimeSize()} private Node.js + HSD runtime. Best for a new machine.`,
                  badge: 'Recommended for new users',
                },
                {
                  value: 'node' as SetupMode,
                  icon: Terminal,
                  title: 'I already have Node.js',
                  body: status?.systemNode
                    ? `Use your installed Node.js ${status.systemNode.version} with a private HSD runtime.`
                    : 'Use an existing Node.js installation with HSD.',
                  badge: status?.systemNode ? 'Detected' : 'Node.js not detected',
                },
                {
                  value: 'hsd' as SetupMode,
                  icon: Server,
                  title: 'I already have HSD',
                  body: status?.systemHsd
                    ? 'Use your existing HSD installation and data folder. No new chain sync.'
                    : 'Point Handess at your existing HSD binary and data folder.',
                  badge: status?.systemHsd ? 'Detected' : 'HSD not detected',
                },
              ].map((option) => {
                const Icon = option.icon;
                const selected = mode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => chooseMode(option.value)}
                    className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition ${
                      selected
                        ? 'border-hns-500 bg-hns-50 dark:bg-hns-900/20'
                        : 'border-gray-200 hover:border-hns-300 dark:border-gray-700 dark:hover:border-hns-700'
                    }`}
                  >
                    <div className="rounded-lg bg-hns-100 p-2 text-hns-700 dark:bg-hns-900/40 dark:text-hns-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{option.title}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                          {option.badge}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{option.body}</p>
                    </div>
                    {selected && <Check className="mt-1 h-4 w-4 text-hns-600" />}
                  </button>
                );
              })}
              {status?.existingDataDirs.some((item) => item.hasChain) && (
                <div className="rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
                  Existing HSD data detected:{' '}
                  {status.existingDataDirs
                    .filter((item) => item.hasChain)
                    .map((item) => item.path)
                    .join(', ')}
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {mode === 'new'
                    ? 'The runtime is downloaded separately so the Handess installer stays small.'
                    : 'Handess can use components already on this machine.'}
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-700">
                <div className="flex items-center gap-2 font-medium">
                  <Server className="h-4 w-4 text-gray-400" />
                  Node.js
                </div>
                <div className="mt-1 text-gray-500 dark:text-gray-400">
                  {status?.systemNode
                    ? `System Node.js ${status.systemNode.version}: ${shortPath(status.systemNode.path)}`
                    : 'No system Node.js detected.'}
                </div>
                {runtime && (
                  <div className="mt-1 text-green-600 dark:text-green-400">
                    Private runtime Node.js {runtime.nodeVersion}: {shortPath(runtime.nodePath)}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-700">
                <div className="flex items-center gap-2 font-medium">
                  <HardDrive className="h-4 w-4 text-gray-400" />
                  HSD
                </div>
                <div className="mt-1 text-gray-500 dark:text-gray-400">
                  {status?.systemHsd
                    ? `Existing HSD: ${shortPath(status.systemHsd.path)}`
                    : 'No system HSD detected.'}
                </div>
                {runtime && (
                  <div className="mt-1 text-green-600 dark:text-green-400">
                    Private HSD {runtime.hsdVersion}: {shortPath(runtime.hsdPath)}
                  </div>
                )}
              </div>

              {(mode === 'new' || !status?.systemHsd) && (
                <div className="space-y-2 rounded-lg border border-hns-200 bg-hns-50/50 p-3 dark:border-hns-900/50 dark:bg-hns-900/10">
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    The official Handess HSD runtime includes Node.js {HSD_RUNTIME.nodeVersion} and
                    HSD {HSD_RUNTIME.hsdVersion}. It is checksum-verified before installation.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void installDownloadedRuntime()}
                      disabled={busy || Boolean(runtime)}
                      className="inline-flex items-center gap-2 rounded-lg bg-hns-600 px-3 py-2 text-sm font-medium text-white hover:bg-hns-700 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {runtime ? 'Runtime installed' : `Download runtime (${formatRuntimeSize(status?.runtimeDownload?.sizeBytes)})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void installLocalRuntime()}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Browse zip
                    </button>
                    <button
                      type="button"
                      onClick={() => void window.api.setup.openReleasePage()}
                      className="inline-flex items-center gap-1 px-2 py-2 text-xs text-hns-600 hover:underline"
                    >
                      Release page <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  {progress && (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                        <span>{progress.message}</span>
                        <span>{progress.percent}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div className="h-full bg-hns-600 transition-all" style={{ width: `${progress.percent}%` }} />
                      </div>
                      {progress.phase === 'downloading' && (
                        <button
                          type="button"
                          onClick={() => void cancelDownload()}
                          className="mt-1 text-[11px] text-gray-500 underline"
                        >
                          Cancel download
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Node.js path
                  <input
                    value={nodePath}
                    onChange={(event) => setNodePath(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-900"
                    placeholder={isLinux ? '/usr/local/bin/node' : 'C:\\...\\node.exe'}
                  />
                </label>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  HSD script path
                  <input
                    value={binaryPath}
                    onChange={(event) => setBinaryPath(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-900"
                    placeholder={isLinux ? '/usr/local/lib/node_modules/hsd/bin/hsd' : 'C:\\...\\hsd\\bin\\hsd'}
                  />
                </label>
              </div>

              {mode === 'new' && !runtime && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Install the runtime to continue, or choose a different setup type.
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Where should HSD store its data?</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This folder contains the blockchain, blocks, and wallet data. It can be large and
                  does not need to be inside the Handess install folder.
                </p>
              </div>

              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                HSD data folder
                <div className="mt-1 flex gap-2">
                  <input
                    value={dataDir}
                    onChange={(event) => setDataDir(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-900"
                    placeholder={isLinux ? '~/.hsd' : 'C:\\Users\\...\\ .hsd'}
                  />
                  <button
                    type="button"
                    onClick={() => void chooseDataDir()}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> Browse
                  </button>
                </div>
              </label>

              {status?.existingDataDirs.length ? (
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Detected folders</div>
                  {status.existingDataDirs.map((item) => (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => setDataDir(item.path)}
                      className={`block w-full rounded-lg border px-3 py-2 text-left font-mono text-xs ${
                        dataDir === item.path
                          ? 'border-hns-500 bg-hns-50 dark:bg-hns-900/20'
                          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40'
                      }`}
                    >
                      <span className="block truncate">{item.path}</span>
                      <span className="text-[10px] text-gray-400">
                        {item.hasChain ? 'Existing chain data' : 'Folder exists'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className={`rounded-lg p-3 text-xs ${
                status?.existingDataDirs.find((item) => item.path === dataDir)?.hasChain
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
              }`}>
                {status?.existingDataDirs.find((item) => item.path === dataDir)?.hasChain
                  ? 'Existing HSD data will be reused. HSD will continue from its current chain state.'
                  : 'A new HSD data folder will be created. The initial mainnet sync can take hours or days and a significant amount of disk space.'}
              </div>

              {status?.runningNode && (
                <div className="rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
                  An HSD node is already listening on 127.0.0.1:12037. Handess can attach to it instead
                  of starting a second node.
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Ready to start</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Handess will save these paths and start or attach to HSD. The wallet setup follows.
                </p>
              </div>

              <div className="space-y-2 rounded-lg border border-gray-200 p-4 text-xs dark:border-gray-700">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Setup type</span>
                  <span className="font-medium">{title}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Node.js</span>
                  <span className="max-w-[60%] truncate font-mono" title={nodePath}>{nodePath || 'Not set'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">HSD</span>
                  <span className="max-w-[60%] truncate font-mono" title={binaryPath}>{binaryPath || 'Not set'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Data folder</span>
                  <span className="max-w-[60%] truncate font-mono" title={dataDir}>{dataDir || 'Not set'}</span>
                </div>
              </div>

              {nodeReady && (
                <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
                  <Check className="h-4 w-4" /> Node started or connected. You can finish setup.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void startNode()}
                  disabled={starting || busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-hns-600 px-4 py-2 text-sm font-medium text-white hover:bg-hns-700 disabled:opacity-50"
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
                  {nodeReady ? 'Restart / reconnect' : 'Start node'}
                </button>
                <button
                  type="button"
                  onClick={() => void finish(false)}
                  disabled={busy || starting}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  <Check className="h-4 w-4" /> Save and finish
                </button>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                If the node does not start, you can save these paths and finish; Settings will show the
                node controls and the error details.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0 || busy || starting}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void finish(true)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              Skip for now
            </button>
            {step < 3 && (
              <button
                type="button"
                onClick={() => setStep((current) => Math.min(3, current + 1))}
                disabled={busy || (step === 1 && !componentsReady) || (step === 2 && !dataDir.trim())}
                className="inline-flex items-center gap-2 rounded-lg bg-hns-600 px-4 py-2 text-sm font-medium text-white hover:bg-hns-700 disabled:opacity-50"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
