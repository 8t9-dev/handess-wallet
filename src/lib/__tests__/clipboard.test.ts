import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('uses the Electron clipboard bridge when available', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('window', { api: { clipboard: { writeText } } });

    await expect(copyText('abc123')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc123');
  });

  it('falls back to the Web Clipboard API when the bridge fails', async () => {
    const bridge = vi.fn(async () => {
      throw new Error('bridge unavailable');
    });
    const web = vi.fn(async () => undefined);
    vi.stubGlobal('window', { api: { clipboard: { writeText: bridge } } });
    vi.stubGlobal('navigator', { clipboard: { writeText: web } });

    await expect(copyText('abc123')).resolves.toBe(true);
    expect(bridge).toHaveBeenCalledWith('abc123');
    expect(web).toHaveBeenCalledWith('abc123');
  });

  it('does not attempt to copy empty text', async () => {
    await expect(copyText('')).resolves.toBe(false);
  });
});
