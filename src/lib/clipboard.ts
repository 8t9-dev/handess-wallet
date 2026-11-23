/**
 * Clipboard helper.
 *
 * The renderer may not be a secure context in the packaged Electron app
 * (`file://`), where `navigator.clipboard` can be unavailable. Prefer the
 * Electron preload bridge, then fall back to the Web Clipboard API and the
 * legacy execCommand path.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (window.api?.clipboard?.writeText) {
      await window.api.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the browser APIs.
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
