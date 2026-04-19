/**
 * Central SQLite persistence service.
 *
 * Owns the single `SQLite.openDatabaseSync('substreamer7.db')` call, PRAGMAs,
 * schema creation for every table the app uses, health reporting, and the
 * test-injection seam. Every other module in `src/store/persistence/` (the
 * Zustand StateStorage adapter + the three row-table query helpers) pulls its
 * handle from `getDb()` instead of opening its own.
 *
 * Why one module:
 * - Before consolidation, four modules each called `openDatabaseSync` at
 *   import and each ran their own PRAGMA block. Expo-sqlite pools native
 *   connections by filename so runtime was fine, but the PRAGMAs drifted
 *   during the migration-14 bug hunt and kept us editing four files in
 *   lockstep. One PRAGMA block removes that class of bug.
 * - Schema CREATE statements ran in whatever order the import graph
 *   happened to resolve. With a single init block here, FK-dependent
 *   tables are created after their parents in explicit source order.
 * - Init-failure handling lives in one place. The KV-blob adapter
 *   (`kvStorage.ts`) still falls back to an in-memory Map so the UI
 *   can render; row-table modules still become safe no-ops. Both paths
 *   read the same `dbHealthy` / `dbInitError` here.
 *
 * Tests: call `__setDbForTests(fake)` to swap the handle. The single seam
 * replaces four per-module `__setDbForTests` exports.
 */
import * as SQLite from 'expo-sqlite';

export interface InternalDb {
  getFirstSync<T>(sql: string, params?: readonly unknown[]): T | undefined;
  getAllSync<T>(sql: string, params?: readonly unknown[]): T[];
  runSync(sql: string, params?: readonly unknown[]): void;
  execSync(sql: string): void;
  withTransactionSync(fn: () => void): void;
}

const DB_NAME = 'substreamer7.db';

let db: InternalDb | null = null;
let initError: Error | null = null;

/**
 * In-memory fallback for the KV (blob) storage when the DB is unavailable.
 * Used only by `kvStorage.ts`. Row-table modules refuse writes when the
 * DB is null rather than falling back (row data silently going to memory is
 * worse than not writing at all).
 */
export const kvFallback = new Map<string, string>();

try {
  db = SQLite.openDatabaseSync(DB_NAME) as unknown as InternalDb;
  // PRAGMAs are per-connection. We set them once here on the shared handle;
  // because expo-sqlite pools connections by filename, every consumer that
  // calls `openDatabaseSync(DB_NAME)` (not that anyone should after this
  // refactor) gets a handle backed by the same native connection and sees
  // these settings.
  db.execSync('PRAGMA journal_mode = WAL;');
  // NORMAL matches the long-standing setting for this database; it has
  // persisted reliably for years. FULL was briefly tried during the
  // migration-14 bug hunt — the real cause was unrelated (INSERT OR REPLACE
  // cascade + hydration race), so we reverted.
  db.execSync('PRAGMA synchronous = NORMAL;');
  db.execSync('PRAGMA foreign_keys = ON;');

  // ---- Schema ----
  // Created in FK-safe order: parents before children. Every CREATE is
  // `IF NOT EXISTS` so a second launch against an existing DB is a no-op.

  // storage (KV blob) — no FK, no dependencies.
  db.execSync(
    'CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
  );

  // album_details + song_index — detail cache for albums/songs.
  db.execSync(
    `CREATE TABLE IF NOT EXISTS album_details (
       id TEXT PRIMARY KEY NOT NULL,
       json TEXT NOT NULL,
       retrievedAt INTEGER NOT NULL
     );`,
  );
  db.execSync(
    `CREATE TABLE IF NOT EXISTS song_index (
       id TEXT PRIMARY KEY NOT NULL,
       albumId TEXT NOT NULL,
       title TEXT,
       artist TEXT,
       duration INTEGER,
       coverArt TEXT,
       userRating INTEGER,
       starred INTEGER,
       year INTEGER,
       track INTEGER,
       disc INTEGER
     );`,
  );
  db.execSync(
    'CREATE INDEX IF NOT EXISTS idx_song_index_albumId ON song_index (albumId);',
  );
  db.execSync(
    'CREATE INDEX IF NOT EXISTS idx_song_index_title ON song_index (lower(title));',
  );

  // scrobble_events — completed scrobbles.
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

  // Music-cache tables — FK graph: cached_item_songs.item_id → cached_items
  // (ON DELETE CASCADE), cached_item_songs.song_id → cached_songs.
  db.execSync(
    `CREATE TABLE IF NOT EXISTS cached_songs (
       song_id TEXT PRIMARY KEY NOT NULL,
       title TEXT NOT NULL,
       artist TEXT,
       album TEXT,
       album_id TEXT NOT NULL,
       cover_art TEXT,
       bytes INTEGER NOT NULL,
       duration INTEGER NOT NULL,
       suffix TEXT NOT NULL,
       bit_rate INTEGER,
       bit_depth INTEGER,
       sampling_rate INTEGER,
       format_captured_at INTEGER NOT NULL,
       downloaded_at INTEGER NOT NULL
     );`,
  );
  db.execSync(
    'CREATE INDEX IF NOT EXISTS idx_cached_songs_album_id ON cached_songs(album_id);',
  );
  db.execSync(
    `CREATE TABLE IF NOT EXISTS cached_items (
       item_id TEXT PRIMARY KEY NOT NULL,
       type TEXT NOT NULL,
       name TEXT NOT NULL,
       artist TEXT,
       cover_art_id TEXT,
       expected_song_count INTEGER NOT NULL,
       parent_album_id TEXT,
       last_sync_at INTEGER NOT NULL,
       downloaded_at INTEGER NOT NULL
     );`,
  );
  db.execSync(
    `CREATE TABLE IF NOT EXISTS cached_item_songs (
       item_id TEXT NOT NULL,
       position INTEGER NOT NULL,
       song_id TEXT NOT NULL,
       PRIMARY KEY (item_id, position),
       FOREIGN KEY (item_id) REFERENCES cached_items(item_id) ON DELETE CASCADE,
       FOREIGN KEY (song_id) REFERENCES cached_songs(song_id)
     );`,
  );
  db.execSync(
    'CREATE INDEX IF NOT EXISTS idx_cached_item_songs_song_id ON cached_item_songs(song_id);',
  );
  db.execSync(
    `CREATE TABLE IF NOT EXISTS download_queue (
       queue_id TEXT PRIMARY KEY NOT NULL,
       item_id TEXT NOT NULL,
       type TEXT NOT NULL,
       name TEXT NOT NULL,
       artist TEXT,
       cover_art_id TEXT,
       status TEXT NOT NULL,
       total_songs INTEGER NOT NULL,
       completed_songs INTEGER NOT NULL,
       error TEXT,
       added_at INTEGER NOT NULL,
       queue_position INTEGER NOT NULL,
       songs_json TEXT NOT NULL
     );`,
  );
  db.execSync(
    'CREATE INDEX IF NOT EXISTS idx_download_queue_status ON download_queue(status);',
  );
  db.execSync(
    'CREATE INDEX IF NOT EXISTS idx_download_queue_position ON download_queue(queue_position);',
  );
} catch (e) {
  db = null;
  initError = e instanceof Error ? e : new Error(String(e));
  // eslint-disable-next-line no-console
  console.warn(
    '[persistence/db] init failed; SQLite unavailable, KV falls back to memory, row tables refuse writes:',
    initError.message,
  );
}

/** Shared handle accessor. Returns null when the DB failed to open. */
export function getDb(): InternalDb | null {
  return db;
}

/** True when the SQLite-backing store initialized successfully. */
export const dbHealthy: boolean = db !== null;

/** The error captured at init time, or null on success. */
export const dbInitError: Error | null = initError;

/**
 * Test-only: swap the shared handle. The sole `__setDbForTests` seam for
 * every persistence module — replaces four per-module exports.
 */
export function __setDbForTests(fake: InternalDb | null): void {
  db = fake;
}
