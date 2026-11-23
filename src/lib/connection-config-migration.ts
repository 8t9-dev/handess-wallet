/**
 * One-time migration of the legacy plaintext connection settings that used to
 * live in `localStorage['crm-connection-config']`.
 *
 * Secrets are moved into the main process, where they are stored with
 * safeStorage, and the renderer copy is deleted.
 */

import type { HSDConnectionConfig } from '../types/wallet';

const LEGACY_KEY = 'crm-connection-config';

let migration: Promise<void> | null = null;

async function runMigration(): Promise<void> {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) return;

  try {
    const parsed = JSON.parse(legacy) as Partial<HSDConnectionConfig>;
    const existing = await window.api.connection.getSavedConfig();
    if (!existing) {
      await window.api.connection.saveConfig(parsed as HSDConnectionConfig);
    }
  } catch {
    // Ignore malformed legacy data; it is removed below regardless.
  } finally {
    localStorage.removeItem(LEGACY_KEY);
  }
}

/** Safe to call from multiple components: the work runs only once. */
export function migrateLegacyConnectionConfig(): Promise<void> {
  if (!migration) {
    migration = runMigration().catch(() => {
      // Never block startup on migration failure.
    });
  }
  return migration;
}
