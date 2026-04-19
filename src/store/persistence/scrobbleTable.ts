/**
 * Per-row SQLite persistence for `completedScrobbleStore` — query helpers
 * only. The shared handle, PRAGMAs, schema, health reporting, and test
 * injection live in `./db.ts`.
 *
 * Writes become silent no-ops when `getDb()` returns null (DB init failed)
 * — callers don't need to handle exceptions.
 */
import { getDb } from './db';
import { type CompletedScrobble } from '../completedScrobbleStore';

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
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
  if (db === null) return;
  try {
    db.withTransactionSync(() => {
      db.runSync('DELETE FROM scrobble_events;');
      const seen = new Set<string>();
      for (const s of scrobbles) {
        if (!s?.id || !s.song?.id || !s.song.title) continue;
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        db.runSync(
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
  const db = getDb();
  if (db === null) return;
  try {
    db.runSync('DELETE FROM scrobble_events;');
  } catch {
    /* dropped */
  }
}
