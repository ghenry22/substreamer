/**
 * Per-row SQLite persistence for `completedScrobbleStore`.
 *
 * The blob-based `persist(createJSONStorage(sqliteStorage))` model rewrites the
 * full scrobble array + derived stats + aggregates on every `addCompleted`,
 * which scales poorly over years of listening history. This module owns a
 * dedicated `scrobble_events` table in the same `substreamer7.db` and exposes
 * typed row-level helpers.
 *
 * The connection is separate from `sqliteStorage.ts` and `detailTables.ts`
 * but points at the same database file; WAL mode (enabled by those modules
 * and re-asserted here for safety) makes concurrent writes from multiple
 * handles safe.
 *
 * Table is authoritative on disk. `completedScrobbleStore.completedScrobbles`
 * is an in-memory mirror populated once at launch via `hydrateScrobbles` and
 * kept in sync by every write action.
 */
import * as SQLite from 'expo-sqlite';

import { type CompletedScrobble } from '../completedScrobbleStore';

interface InternalDb {
  getFirstSync<T>(sql: string, params?: readonly unknown[]): T | undefined;
  getAllSync<T>(sql: string, params?: readonly unknown[]): T[];
  runSync(sql: string, params?: readonly unknown[]): void;
  execSync(sql: string): void;
  withTransactionSync(fn: () => void): void;
}

let db: InternalDb | null = null;
let initError: Error | null = null;

try {
  db = SQLite.openDatabaseSync('substreamer7.db') as unknown as InternalDb;
  db.execSync('PRAGMA journal_mode = WAL;');
  db.execSync('PRAGMA synchronous = NORMAL;');
  db.execSync(
    `CREATE TABLE IF NOT EXISTS scrobble_events (
       id TEXT PRIMARY KEY NOT NULL,
       song_json TEXT NOT NULL,
       time INTEGER NOT NULL
     );`,
  );
  db.execSync(
    'CREATE INDEX IF NOT EXISTS idx_scrobble_events_time ON scrobble_events (time);',
  );
} catch (e) {
  db = null;
  initError = e instanceof Error ? e : new Error(String(e));
  // eslint-disable-next-line no-console
  console.warn(
    '[scrobbleTable] init failed; per-row persistence unavailable:',
    initError.message,
  );
}

/** True when the scrobble table is wired up and functioning. */
export const scrobbleTableHealthy: boolean = db !== null;
export const scrobbleTableInitError: Error | null = initError;

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

/**
 * Read every scrobble row in time order. Used once on app start to hydrate
 * `completedScrobbleStore.completedScrobbles`. Unparseable rows are skipped;
 * invalid rows (missing id / song.id / song.title) are filtered out so the
 * store never sees the same garbage the old `onRehydrateStorage` guarded
 * against.
 */
export function hydrateScrobbles(): CompletedScrobble[] {
  if (db === null) return [];
  try {
    const rows = db.getAllSync<{ id: string; song_json: string; time: number }>(
      'SELECT id, song_json, time FROM scrobble_events ORDER BY time ASC;',
    );
    const out: CompletedScrobble[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.id || seen.has(row.id)) continue;
      let song: unknown;
      try {
        song = JSON.parse(row.song_json);
      } catch {
        continue;
      }
      if (
        !song ||
        typeof song !== 'object' ||
        !(song as { id?: unknown }).id ||
        !(song as { title?: unknown }).title
      ) {
        continue;
      }
      seen.add(row.id);
      out.push({ id: row.id, song: song as CompletedScrobble['song'], time: row.time });
    }
    return out;
  } catch {
    return [];
  }
}

/** Return the total scrobble row count. Used by diagnostics. */
export function countScrobbles(): number {
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM scrobble_events;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Writes                                                             */
/* ------------------------------------------------------------------ */

/**
 * Insert one scrobble. Uses INSERT OR IGNORE so re-inserting the same id is a
 * silent no-op (the store already dedupes in memory but this protects against
 * concurrent-call edge cases without throwing).
 */
export function insertScrobble(scrobble: CompletedScrobble): void {
  if (db === null) return;
  if (!scrobble.id || !scrobble.song?.id || !scrobble.song.title) return;
  try {
    db.runSync(
      'INSERT OR IGNORE INTO scrobble_events (id, song_json, time) VALUES (?, ?, ?);',
      [scrobble.id, JSON.stringify(scrobble.song), scrobble.time],
    );
  } catch {
    /* dropped */
  }
}

/**
 * Wipe and bulk-insert the full scrobble set inside a single transaction.
 * Used by backup restore and the one-shot blob → per-row migration (task #13).
 * Invalid/duplicate records are filtered before insertion.
 */
export function replaceAllScrobbles(scrobbles: readonly CompletedScrobble[]): void {
  if (db === null) return;
  try {
    db.withTransactionSync(() => {
      db!.runSync('DELETE FROM scrobble_events;');
      const seen = new Set<string>();
      for (const s of scrobbles) {
        if (!s?.id || !s.song?.id || !s.song.title) continue;
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        db!.runSync(
          'INSERT OR IGNORE INTO scrobble_events (id, song_json, time) VALUES (?, ?, ?);',
          [s.id, JSON.stringify(s.song), s.time],
        );
      }
    });
  } catch {
    /* dropped */
  }
}

/** Remove every row. Used on logout / server switch via resetAllStores. */
export function clearScrobbles(): void {
  if (db === null) return;
  try {
    db.runSync('DELETE FROM scrobble_events;');
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  Test-only helpers (guarded)                                        */
/* ------------------------------------------------------------------ */

/**
 * Replace the module-private db handle. Used exclusively by the test mock so
 * tests can exercise the real SQL-building logic against an in-memory fake.
 */
export function __setDbForTests(mockDb: InternalDb | null): void {
  db = mockDb;
}
