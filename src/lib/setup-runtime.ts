/**
 * Optional private HSD runtime downloaded by the setup wizard.
 *
 * The installer intentionally does not bundle Node.js or hsd. New users can
 * download this verified runtime; existing Node/hsd installations are detected
 * instead.
 */

export interface HsdRuntimeAsset {
  platform: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  url: string;
}

export const HSD_RUNTIME = {
  name: 'Handess HSD Runtime',
  hsdVersion: '8.0.0',
  nodeVersion: '24.15.0',
} as const;

/**
 * Per-platform runtime archives. Keep the URLs on the same release that hosts
 * the other optional runtime assets so the setup wizard can stay stable across
 * app versions.
 */
export const HSD_RUNTIME_ASSETS: Record<string, HsdRuntimeAsset> = {
  'win32-x64': {
    platform: 'win32-x64',
    fileName: 'Handess-HSD-Runtime-8.0.0-win-x64.zip',
    sizeBytes: 79_539_837,
    sha256: '332930EC7D336DD98F82408413FA539ED240D4B7976BE0D05B008C5C2BDBB8DA',
    url: 'https://github.com/8t9-dev/handess-wallet-releases/releases/download/v0.3.10/Handess-HSD-Runtime-8.0.0-win-x64.zip',
  },
  'linux-x64': {
    platform: 'linux-x64',
    fileName: 'Handess-HSD-Runtime-8.0.0-linux-x64.zip',
    sizeBytes: 53_316_677,
    sha256: '45BBB5B5BB8B1A9DC7AB9F5F1DBDAE9DB2F301EEE684D4EAC38A6BB1FD15DADE',
    url: 'https://github.com/8t9-dev/handess-wallet-releases/releases/download/v0.3.10/Handess-HSD-Runtime-8.0.0-linux-x64.zip',
  },
};

export function getHsdRuntimeAsset(platform: string, arch: string): HsdRuntimeAsset | null {
  return HSD_RUNTIME_ASSETS[`${platform}-${arch}`] ?? null;
}

export const SETUP_RELEASE_URL =
  'https://github.com/8t9-dev/handess-wallet-releases/releases/tag/v0.3.10';

export function formatRuntimeSize(bytes: number = HSD_RUNTIME_ASSETS['win32-x64'].sizeBytes): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
