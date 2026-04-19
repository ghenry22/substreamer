import { type StateStorage } from 'zustand/middleware';

import { getDb, kvFallback } from './db';

/**
 * Zustand `StateStorage` adapter backed by the shared SQLite handle. Stores
 * each Zustand-persist blob as one row in the `storage(key, value)` table.
 *
 * Named `kvStorage` (rather than `kvStorage`) to distinguish it from the
 * other persistence modules in this directory — *everything* here is backed
 * by SQLite; this is the one that exposes a key-value blob shape for the
 * ~30 Zustand-persist stores across the app.
 *
 * When `db.ts` fails to open SQLite (seen on stripped / corrupted Android
 * OEM ROMs), all four operations fall through to an in-memory `Map` owned
 * by `db.ts` so the UI can still render. Writes in that mode don't survive
 * a relaunch — `dbHealthy` (exported from `db.ts`) lets the UI surface the
 * degraded state if needed.
 *
 * Row-table modules (musicCacheTables, scrobbleTable, detailTables) don't
 * get this memory fallback — silently writing per-row data nowhere is worse
 * than not writing at all. They treat `getDb() === null` as a no-op.
 */
export const kvStorage: StateStorage = {
  getItem(key: string): string | null {
    const db = getDb();
    if (db === null) return kvFallback.get(key) ?? null;
    try {
      const row = db.getFirstSync<{ value: string }>(
        'SELECT value FROM storage WHERE key = ?;',
        [key],
      );
      return row?.value ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    const db = getDb();
    if (db === null) {
      kvFallback.set(key, value);
      return;
    }
    try {
      db.runSync(
        'INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?);',
        [key, value],
      );
    } catch {
      /* persistence dropped this write; nothing else to do */
    }
  },
  removeItem(key: string): void {
    const db = getDb();
    if (db === null) {
      kvFallback.delete(key);
      return;
    }
    try {
      db.runSync('DELETE FROM storage WHERE key = ?;', [key]);
    } catch {
      /* dropped */
    }
  },
};

/** Delete every row from the `storage` table — used by logout. */
export function clearKvStorage(): void {
  const db = getDb();
  if (db === null) {
    kvFallback.clear();
    return;
  }
  try {
    db.runSync('DELETE FROM storage;');
  } catch {
    /* dropped */
  }
}
