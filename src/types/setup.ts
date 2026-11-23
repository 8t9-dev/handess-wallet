export type SetupMode = 'new' | 'node' | 'hsd' | 'skip';

export interface SetupRuntimeStatus {
  installed: boolean;
  path: string | null;
  nodePath: string | null;
  hsdPath: string | null;
  nodeVersion: string | null;
  hsdVersion: string | null;
}

export interface SetupDetectedDataDir {
  path: string;
  hasChain: boolean;
}

export interface SetupEnvironmentStatus {
  completed: boolean;
  hasSavedConnection: boolean;
  hsdDataDir: string;
  defaultDataDir: string;
  runtime: SetupRuntimeStatus;
  /** Download metadata for the current platform's optional runtime. */
  runtimeDownload: { fileName: string; sizeBytes: number } | null;
  systemNode: { path: string; version: string } | null;
  systemHsd: { path: string } | null;
  existingDataDirs: SetupDetectedDataDir[];
  runningNode: boolean;
}

export interface SetupRuntimeProgress {
  phase: 'downloading' | 'verifying' | 'extracting' | 'installing';
  received: number;
  total: number;
  percent: number;
  message: string;
}

export interface SetupRuntimeInstallResult {
  path: string;
  nodePath: string;
  hsdPath: string;
  nodeVersion: string;
  hsdVersion: string;
}

export interface SetupCompleteInput {
  mode: SetupMode;
  dataDir?: string;
  binaryPath?: string;
  nodePath?: string;
  network?: 'main' | 'testnet' | 'regtest';
}
