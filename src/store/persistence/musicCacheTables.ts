/**
 * Per-row SQLite persistence for the v2 music-downloads stack.
 *
 * Owns four tables in the shared `substreamer7.db`:
 *   - `cached_songs`       — canonical song pool (one row per unique song)
 *   - `cached_items`       — download intents (album/playlist/favorites/song)
 *   - `cached_item_songs`  — many-to-many edges (refcount-via-COUNT)
 *   - `download_queue`     — persisted download queue
 *
 * Error-swallowing: every read returns a safe default ({}, [], 0) and every
 * write is a silent no-op on failure, matching the pattern in
 * `scrobbleTable.ts` / `detailTables.ts`. Consumers never need to handle
 * exceptions from this module.
 */
import * as SQLite from 'expo-sqlite';

export interface CachedSongRow {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumId: string;
  coverArt?: string;
  bytes: number;
  duration: number;
  suffix: string;
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
  formatCapturedAt: number;
  downloadedAt: number;
}

export interface CachedItemRow {
  itemId: string;
  type: 'album' | 'playlist' | 'favorites' | 'song';
  name: string;
  artist?: string;
  coverArtId?: string;
  expectedSongCount: number;
  parentAlbumId?: string;
  lastSyncAt: number;
  downloadedAt: number;
  /** Joined from cached_item_songs on hydrate, in position order. */
  songIds: string[];
}

export interface DownloadQueueRow {
  queueId: string;
  itemId: string;
  type: 'album' | 'playlist' | 'favorites' | 'song';
  name: string;
  artist?: string;
  coverArtId?: string;
  status: 'queued' | 'downloading' | 'complete' | 'error';
  totalSongs: number;
  completedSongs: number;
  error?: string;
  addedAt: number;
  queuePosition: number;
  /** JSON-serialized Child[] still needed at download time. */
  songsJson: string;
}

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
  // NORMAL matches every other connection on this database and has persisted
  // reliably since day one. FULL adds ~1–5 ms per commit for no observed
  // benefit on mobile — the music-downloads-v2 data loss we chased was an
  // INSERT OR REPLACE + ON DELETE CASCADE footgun, not a WAL durability gap.
  db.execSync('PRAGMA synchronous = NORMAL;');
  db.execSync('PRAGMA foreign_keys = ON;');
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
    '[musicCacheTables] init failed; per-row persistence unavailable:',
    initError.message,
  );
}

/** True when the music-cache tables are wired up and functioning. */
export const musicCacheTablesHealthy: boolean = db !== null;
export const musicCacheTablesInitError: Error | null = initError;

/* ------------------------------------------------------------------ */
/*  Row <-> object mapping helpers                                     */
/* ------------------------------------------------------------------ */

interface RawSongRow {
  song_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  album_id: string;
  cover_art: string | null;
  bytes: number;
  duration: number;
  suffix: string;
  bit_rate: number | null;
  bit_depth: number | null;
  sampling_rate: number | null;
  format_captured_at: number;
  downloaded_at: number;
}

interface RawItemRow {
  item_id: string;
  type: string;
  name: string;
  artist: string | null;
  cover_art_id: string | null;
  expected_song_count: number;
  parent_album_id: string | null;
  last_sync_at: number;
  downloaded_at: number;
}

interface RawQueueRow {
  queue_id: string;
  item_id: string;
  type: string;
  name: string;
  artist: string | null;
  cover_art_id: string | null;
  status: string;
  total_songs: number;
  completed_songs: number;
  error: string | null;
  added_at: number;
  queue_position: number;
  songs_json: string;
}

function mapSongRow(row: RawSongRow): CachedSongRow {
  const out: CachedSongRow = {
    id: row.song_id,
    title: row.title,
    albumId: row.album_id,
    bytes: row.bytes,
    duration: row.duration,
    suffix: row.suffix,
    formatCapturedAt: row.format_captured_at,
    downloadedAt: row.downloaded_at,
  };
  if (row.artist !== null) out.artist = row.artist;
  if (row.album !== null) out.album = row.album;
  if (row.cover_art !== null) out.coverArt = row.cover_art;
  if (row.bit_rate !== null) out.bitRate = row.bit_rate;
  if (row.bit_depth !== null) out.bitDepth = row.bit_depth;
  if (row.sampling_rate !== null) out.samplingRate = row.sampling_rate;
  return out;
}

function mapItemRow(row: RawItemRow, songIds: string[]): CachedItemRow {
  const out: CachedItemRow = {
    itemId: row.item_id,
    type: row.type as CachedItemRow['type'],
    name: row.name,
    expectedSongCount: row.expected_song_count,
    lastSyncAt: row.last_sync_at,
    downloadedAt: row.downloaded_at,
    songIds,
  };
  if (row.artist !== null) out.artist = row.artist;
  if (row.cover_art_id !== null) out.coverArtId = row.cover_art_id;
  if (row.parent_album_id !== null) out.parentAlbumId = row.parent_album_id;
  return out;
}

function mapQueueRow(row: RawQueueRow): DownloadQueueRow {
  const out: DownloadQueueRow = {
    queueId: row.queue_id,
    itemId: row.item_id,
    type: row.type as DownloadQueueRow['type'],
    name: row.name,
    status: row.status as DownloadQueueRow['status'],
    totalSongs: row.total_songs,
    completedSongs: row.completed_songs,
    addedAt: row.added_at,
    queuePosition: row.queue_position,
    songsJson: row.songs_json,
  };
  if (row.artist !== null) out.artist = row.artist;
  if (row.cover_art_id !== null) out.coverArtId = row.cover_art_id;
  if (row.error !== null) out.error = row.error;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Hydrate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Read all cached song rows into a Record keyed by song_id. Used once at
 * launch to populate the store's in-memory mirror.
 */
export function hydrateCachedSongs(): Record<string, CachedSongRow> {
  if (db === null) return {};
  try {
    const rows = db.getAllSync<RawSongRow>(
      `SELECT song_id, title, artist, album, album_id, cover_art, bytes,
              duration, suffix, bit_rate, bit_depth, sampling_rate,
              format_captured_at, downloaded_at
         FROM cached_songs;`,
    );
    const out: Record<string, CachedSongRow> = {};
    for (const row of rows) {
      if (!row.song_id) continue;
      out[row.song_id] = mapSongRow(row);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read all cached items with their songId arrays joined in position order.
 * Implemented as two queries + merge in JS (simpler than GROUP_CONCAT).
 */
export function hydrateCachedItems(): Record<string, CachedItemRow> {
  if (db === null) return {};
  try {
    const items = db.getAllSync<RawItemRow>(
      `SELECT item_id, type, name, artist, cover_art_id, expected_song_count,
              parent_album_id, last_sync_at, downloaded_at
         FROM cached_items;`,
    );
    const edges = db.getAllSync<{ item_id: string; song_id: string }>(
      'SELECT item_id, song_id FROM cached_item_songs ORDER BY item_id, position ASC;',
    );
    const edgesByItem = new Map<string, string[]>();
    for (const edge of edges) {
      const list = edgesByItem.get(edge.item_id);
      if (list) list.push(edge.song_id);
      else edgesByItem.set(edge.item_id, [edge.song_id]);
    }
    const out: Record<string, CachedItemRow> = {};
    for (const row of items) {
      if (!row.item_id) continue;
      const songIds = edgesByItem.get(row.item_id) ?? [];
      out[row.item_id] = mapItemRow(row, songIds);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read the full download queue ordered by queue_position ASC. Used at launch
 * and whenever the queue needs a full refresh.
 */
export function hydrateDownloadQueue(): DownloadQueueRow[] {
  if (db === null) return [];
  try {
    const rows = db.getAllSync<RawQueueRow>(
      `SELECT queue_id, item_id, type, name, artist, cover_art_id, status,
              total_songs, completed_songs, error, added_at, queue_position,
              songs_json
         FROM download_queue
         ORDER BY queue_position ASC;`,
    );
    return rows.map(mapQueueRow);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Counts                                                             */
/* ------------------------------------------------------------------ */

export function countCachedSongs(): number {
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM cached_songs;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export function countCachedItems(): number {
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM cached_items;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Read a single PRAGMA value from the current connection. Used by the
 * migration diagnostics to verify FK enforcement / journal mode state.
 * Returns `null` on error.
 */
export function readPragma(name: string): string | null {
  if (db === null) return null;
  try {
    const row = db.getFirstSync<Record<string, unknown>>(`PRAGMA ${name};`);
    if (!row) return null;
    // PRAGMA results come back with the pragma name as the key.
    const val = row[name];
    if (val === undefined || val === null) return null;
    return String(val);
  } catch {
    return null;
  }
}

export function countCachedItemSongs(): number {
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM cached_item_songs;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export function countDownloadQueueItems(): number {
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM download_queue;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Refcount for a song — how many items reference it. When this returns 0,
 * the song is an orphan and its file can be deleted.
 */
export function countSongRefs(songId: string): number {
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM cached_item_songs WHERE song_id = ?;',
      [songId],
    );
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/*  cached_songs writes                                                */
/* ------------------------------------------------------------------ */

function upsertCachedSongInternal(song: CachedSongRow): void {
  // UPSERT rather than `INSERT OR REPLACE` — see `upsertCachedItemInternal`
  // for the rationale. Applies the same pattern here for consistency so
  // nobody can accidentally reintroduce the cascade-delete footgun.
  db!.runSync(
    `INSERT INTO cached_songs
       (song_id, title, artist, album, album_id, cover_art, bytes, duration,
        suffix, bit_rate, bit_depth, sampling_rate, format_captured_at,
        downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(song_id) DO UPDATE SET
         title = excluded.title,
         artist = excluded.artist,
         album = excluded.album,
         album_id = excluded.album_id,
         cover_art = excluded.cover_art,
         bytes = excluded.bytes,
         duration = excluded.duration,
         suffix = excluded.suffix,
         bit_rate = excluded.bit_rate,
         bit_depth = excluded.bit_depth,
         sampling_rate = excluded.sampling_rate,
         format_captured_at = excluded.format_captured_at,
         downloaded_at = excluded.downloaded_at;`,
    [
      song.id,
      song.title,
      song.artist ?? null,
      song.album ?? null,
      song.albumId,
      song.coverArt ?? null,
      song.bytes,
      song.duration,
      song.suffix,
      song.bitRate ?? null,
      song.bitDepth ?? null,
      song.samplingRate ?? null,
      song.formatCapturedAt,
      song.downloadedAt,
    ],
  );
}

export function upsertCachedSong(song: CachedSongRow): void {
  if (db === null) return;
  if (!song.id || !song.albumId) return;
  try {
    upsertCachedSongInternal(song);
  } catch {
    /* dropped */
  }
}

export function deleteCachedSong(songId: string): void {
  if (db === null) return;
  try {
    db.runSync('DELETE FROM cached_songs WHERE song_id = ?;', [songId]);
  } catch {
    /* dropped */
  }
}

/**
 * Return all song_ids that have zero cached_item_songs edges — songs whose
 * files are on disk but no item references them any more.
 */
export function findOrphanSongs(): string[] {
  if (db === null) return [];
  try {
    const rows = db.getAllSync<{ song_id: string }>(
      `SELECT song_id FROM cached_songs
         WHERE song_id NOT IN (SELECT song_id FROM cached_item_songs);`,
    );
    return rows.map((r) => r.song_id);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  cached_items writes                                                */
/* ------------------------------------------------------------------ */

function upsertCachedItemInternal(item: Omit<CachedItemRow, 'songIds'>): void {
  // UPSERT (not `INSERT OR REPLACE`): SQLite implements `OR REPLACE` as
  // DELETE-then-INSERT, which would fire `ON DELETE CASCADE` on the
  // `cached_item_songs` edges table and silently wipe every edge for this
  // item_id. UPSERT updates the row in place with no DELETE, preserving
  // children. This is the root-cause fix for the music-downloads-v2
  // durability bug where offline playlists evaporated after the first
  // downstream write touched the parent item.
  db!.runSync(
    `INSERT INTO cached_items
       (item_id, type, name, artist, cover_art_id, expected_song_count,
        parent_album_id, last_sync_at, downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         type = excluded.type,
         name = excluded.name,
         artist = excluded.artist,
         cover_art_id = excluded.cover_art_id,
         expected_song_count = excluded.expected_song_count,
         parent_album_id = excluded.parent_album_id,
         last_sync_at = excluded.last_sync_at,
         downloaded_at = excluded.downloaded_at;`,
    [
      item.itemId,
      item.type,
      item.name,
      item.artist ?? null,
      item.coverArtId ?? null,
      item.expectedSongCount,
      item.parentAlbumId ?? null,
      item.lastSyncAt,
      item.downloadedAt,
    ],
  );
}

export function upsertCachedItem(item: Omit<CachedItemRow, 'songIds'>): void {
  if (db === null) return;
  if (!item.itemId) return;
  try {
    upsertCachedItemInternal(item);
  } catch {
    /* dropped */
  }
}

/**
 * Delete an item row. FOREIGN KEY ON DELETE CASCADE removes the associated
 * cached_item_songs edges in the same SQLite statement.
 */
export function deleteCachedItem(itemId: string): void {
  if (db === null) return;
  try {
    db.runSync('DELETE FROM cached_items WHERE item_id = ?;', [itemId]);
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  cached_item_songs (edge) writes                                    */
/* ------------------------------------------------------------------ */

export function insertCachedItemSong(itemId: string, position: number, songId: string): void {
  if (db === null) return;
  if (!itemId || !songId) return;
  try {
    db.runSync(
      'INSERT OR IGNORE INTO cached_item_songs (item_id, position, song_id) VALUES (?, ?, ?);',
      [itemId, position, songId],
    );
  } catch {
    /* dropped */
  }
}

/**
 * Remove an edge at a specific position and shift higher positions down by 1
 * so positions remain contiguous within the item.
 */
export function removeCachedItemSong(itemId: string, position: number): void {
  if (db === null) return;
  try {
    db.withTransactionSync(() => {
      db!.runSync(
        'DELETE FROM cached_item_songs WHERE item_id = ? AND position = ?;',
        [itemId, position],
      );
      db!.runSync(
        'UPDATE cached_item_songs SET position = position - 1 WHERE item_id = ? AND position > ?;',
        [itemId, position],
      );
    });
  } catch {
    /* dropped */
  }
}

/**
 * Reorder one edge within an item from `fromPosition` to `toPosition`. Uses a
 * sentinel position (-1) to avoid primary-key collisions during the shift.
 */
export function reorderCachedItemSongs(
  itemId: string,
  fromPosition: number,
  toPosition: number,
): void {
  if (db === null) return;
  if (fromPosition === toPosition) return;
  try {
    db.withTransactionSync(() => {
      // Stash the moving row at a sentinel position that can't collide.
      db!.runSync(
        'UPDATE cached_item_songs SET position = -1 WHERE item_id = ? AND position = ?;',
        [itemId, fromPosition],
      );
      if (fromPosition < toPosition) {
        // Shift (fromPosition, toPosition] down by 1.
        db!.runSync(
          `UPDATE cached_item_songs
             SET position = position - 1
             WHERE item_id = ? AND position > ? AND position <= ?;`,
          [itemId, fromPosition, toPosition],
        );
      } else {
        // Shift [toPosition, fromPosition) up by 1.
        db!.runSync(
          `UPDATE cached_item_songs
             SET position = position + 1
             WHERE item_id = ? AND position >= ? AND position < ?;`,
          [itemId, toPosition, fromPosition],
        );
      }
      // Drop the moving row into its final slot.
      db!.runSync(
        'UPDATE cached_item_songs SET position = ? WHERE item_id = ? AND position = -1;',
        [toPosition, itemId],
      );
    });
  } catch {
    /* dropped */
  }
}

/** Return song_ids for an item in position order. */
export function getSongIdsForItem(itemId: string): string[] {
  if (db === null) return [];
  try {
    const rows = db.getAllSync<{ song_id: string }>(
      'SELECT song_id FROM cached_item_songs WHERE item_id = ? ORDER BY position ASC;',
      [itemId],
    );
    return rows.map((r) => r.song_id);
  } catch {
    return [];
  }
}

/** Return the items that reference a given song. */
export function getItemIdsForSong(songId: string): string[] {
  if (db === null) return [];
  try {
    const rows = db.getAllSync<{ item_id: string }>(
      'SELECT item_id FROM cached_item_songs WHERE song_id = ?;',
      [songId],
    );
    return rows.map((r) => r.item_id);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  download_queue writes                                              */
/* ------------------------------------------------------------------ */

function insertDownloadQueueItemInternal(item: DownloadQueueRow): void {
  // `download_queue` has no FK children so `INSERT OR REPLACE` is safe here,
  // but we use UPSERT anyway for consistency with the other tables — one
  // pattern everywhere means nobody introduces a regression by copying the
  // wrong line later.
  db!.runSync(
    `INSERT INTO download_queue
       (queue_id, item_id, type, name, artist, cover_art_id, status,
        total_songs, completed_songs, error, added_at, queue_position,
        songs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(queue_id) DO UPDATE SET
         item_id = excluded.item_id,
         type = excluded.type,
         name = excluded.name,
         artist = excluded.artist,
         cover_art_id = excluded.cover_art_id,
         status = excluded.status,
         total_songs = excluded.total_songs,
         completed_songs = excluded.completed_songs,
         error = excluded.error,
         added_at = excluded.added_at,
         queue_position = excluded.queue_position,
         songs_json = excluded.songs_json;`,
    [
      item.queueId,
      item.itemId,
      item.type,
      item.name,
      item.artist ?? null,
      item.coverArtId ?? null,
      item.status,
      item.totalSongs,
      item.completedSongs,
      item.error ?? null,
      item.addedAt,
      item.queuePosition,
      item.songsJson,
    ],
  );
}

export function insertDownloadQueueItem(item: DownloadQueueRow): void {
  if (db === null) return;
  if (!item.queueId) return;
  try {
    insertDownloadQueueItemInternal(item);
  } catch {
    /* dropped */
  }
}

export function removeDownloadQueueItem(queueId: string): void {
  if (db === null) return;
  try {
    db.runSync('DELETE FROM download_queue WHERE queue_id = ?;', [queueId]);
  } catch {
    /* dropped */
  }
}

/**
 * Partial update of a queue row. Only status / completedSongs / error can be
 * updated via this path; other fields are immutable once the item is queued.
 */
export function updateDownloadQueueItem(
  queueId: string,
  update: Partial<Pick<DownloadQueueRow, 'status' | 'completedSongs' | 'error'>>,
): void {
  if (db === null) return;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (update.status !== undefined) {
    clauses.push('status = ?');
    params.push(update.status);
  }
  if (update.completedSongs !== undefined) {
    clauses.push('completed_songs = ?');
    params.push(update.completedSongs);
  }
  if (update.error !== undefined) {
    clauses.push('error = ?');
    params.push(update.error ?? null);
  }
  if (clauses.length === 0) return;
  params.push(queueId);
  try {
    db.runSync(
      `UPDATE download_queue SET ${clauses.join(', ')} WHERE queue_id = ?;`,
      params,
    );
  } catch {
    /* dropped */
  }
}

/**
 * Move a queue row from one position to another. Shifts all affected rows'
 * positions inside a single transaction so the contiguous ordering is
 * preserved.
 */
export function reorderDownloadQueue(fromPosition: number, toPosition: number): void {
  if (db === null) return;
  if (fromPosition === toPosition) return;
  try {
    db.withTransactionSync(() => {
      // Stash the moving row at a sentinel position.
      db!.runSync(
        'UPDATE download_queue SET queue_position = -1 WHERE queue_position = ?;',
        [fromPosition],
      );
      if (fromPosition < toPosition) {
        db!.runSync(
          `UPDATE download_queue
             SET queue_position = queue_position - 1
             WHERE queue_position > ? AND queue_position <= ?;`,
          [fromPosition, toPosition],
        );
      } else {
        db!.runSync(
          `UPDATE download_queue
             SET queue_position = queue_position + 1
             WHERE queue_position >= ? AND queue_position < ?;`,
          [toPosition, fromPosition],
        );
      }
      db!.runSync(
        'UPDATE download_queue SET queue_position = ? WHERE queue_position = -1;',
        [toPosition],
      );
    });
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  Complex transactional ops                                          */
/* ------------------------------------------------------------------ */

/**
 * Atomically finalise a download: delete the queue row, upsert the item,
 * upsert all songs, and insert every edge — all in a single transaction so
 * consumers never observe a half-committed state.
 */
export function markDownloadComplete(
  queueId: string,
  item: Omit<CachedItemRow, 'songIds'>,
  songs: CachedSongRow[],
  edges: Array<{ songId: string; position: number }>,
): void {
  if (db === null) return;
  try {
    db.withTransactionSync(() => {
      db!.runSync('DELETE FROM download_queue WHERE queue_id = ?;', [queueId]);
      upsertCachedItemInternal(item);
      for (const song of songs) {
        if (!song.id || !song.albumId) continue;
        upsertCachedSongInternal(song);
      }
      for (const edge of edges) {
        if (!edge.songId) continue;
        db!.runSync(
          'INSERT OR IGNORE INTO cached_item_songs (item_id, position, song_id) VALUES (?, ?, ?);',
          [item.itemId, edge.position, edge.songId],
        );
      }
    });
  } catch {
    /* dropped */
  }
}

/**
 * Wipe all four tables and replace their contents in a single transaction.
 * Used by migration task #14 after parsing the v1 blob.
 */
export function bulkReplace(params: {
  items: Array<Omit<CachedItemRow, 'songIds'>>;
  songs: CachedSongRow[];
  edges: Array<{ itemId: string; position: number; songId: string }>;
  queue: DownloadQueueRow[];
}): void {
  if (db === null) return;
  try {
    db.withTransactionSync(() => {
      db!.runSync('DELETE FROM cached_item_songs;');
      db!.runSync('DELETE FROM download_queue;');
      db!.runSync('DELETE FROM cached_items;');
      db!.runSync('DELETE FROM cached_songs;');

      for (const song of params.songs) {
        if (!song.id || !song.albumId) continue;
        upsertCachedSongInternal(song);
      }

      for (const item of params.items) {
        if (!item.itemId) continue;
        upsertCachedItemInternal(item);
      }

      for (const edge of params.edges) {
        if (!edge.itemId || !edge.songId) continue;
        db!.runSync(
          'INSERT OR IGNORE INTO cached_item_songs (item_id, position, song_id) VALUES (?, ?, ?);',
          [edge.itemId, edge.position, edge.songId],
        );
      }

      for (const q of params.queue) {
        if (!q.queueId) continue;
        insertDownloadQueueItemInternal(q);
      }
    });
  } catch {
    /* dropped */
  }
}

/**
 * Truncate all four tables. Used by `resetAllStores` on logout / server
 * switch. Edges are deleted first to sidestep the FK constraint regardless of
 * PRAGMA state.
 */
export function clearAllMusicCacheRows(): void {
  if (db === null) return;
  try {
    db.withTransactionSync(() => {
      db!.runSync('DELETE FROM cached_item_songs;');
      db!.runSync('DELETE FROM download_queue;');
      db!.runSync('DELETE FROM cached_items;');
      db!.runSync('DELETE FROM cached_songs;');
    });
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
