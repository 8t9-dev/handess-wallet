import { describe, expect, it } from 'vitest';
import { formatRuntimeSize, getHsdRuntimeAsset } from '../setup-runtime';

describe('HSD runtime assets', () => {
  it('selects the Windows x64 runtime', () => {
    const asset = getHsdRuntimeAsset('win32', 'x64');

    expect(asset).toMatchObject({
      platform: 'win32-x64',
      fileName: 'Handess-HSD-Runtime-8.0.0-win-x64.zip',
    });
    expect(asset?.sha256).toMatch(/^[0-9A-F]{64}$/);
    expect(asset?.sizeBytes).toBeGreaterThan(0);
  });

  it('selects the Linux x64 runtime', () => {
    const asset = getHsdRuntimeAsset('linux', 'x64');

    expect(asset).toMatchObject({
      platform: 'linux-x64',
      fileName: 'Handess-HSD-Runtime-8.0.0-linux-x64.zip',
    });
    expect(asset?.sha256).toMatch(/^[0-9A-F]{64}$/);
    expect(asset?.sizeBytes).toBeGreaterThan(0);
  });

  it('does not offer a runtime for unsupported platforms', () => {
    expect(getHsdRuntimeAsset('darwin', 'arm64')).toBeNull();
  });

  it('formats runtime sizes', () => {
    expect(formatRuntimeSize(1024 * 1024)).toBe('1.0 MB');
  });
});
