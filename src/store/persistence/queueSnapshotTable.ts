/**
 * Per-row SQLite persistence for the ordered play queues: the LIVE player queue
 * (one row, `SNAPSHOT_LIVE_ID`) and the user's saved bookmarks. One table pair
 * serves both — they are the same thing (an ordered `Child[]` plus a cursor) and
 * differ only in `kind` and whether the user named it.
 *
 * The write is SPLIT, which is the whole point: a track change is
 * {@link updateSnapshotIndex} — one UPDATE on the parent row — while only a queue
 * change pays for {@link replaceSnapshotTracks}. The blob it replaces was rewritten
 * in full on every skip.
 *
 * Snapshots are SELF-CONTAINED: every row is a full `Child` copy, never a reference
 * into `songs`, so a library resync or a reap can never empty a saved queue.
 *
 * Writes become silent no-ops when `getDb()` returns null (DB init failed) — callers
 * don't need to handle exceptions.
 */
import { getDb, type BatchCommand } from './db';
import {
  childFromSnapshotRow,
  childSnapshotArrayCommands,
  childSnapshotArrayKey,
  childSnapshotInsertCommand,
  childSnapshotRowFromRaw,
  readChildSnapshotArraysAsync,
  readChildSnapshotArraysSync,
  CHILD_SNAPSHOT_SELECT,
  type ChildSnapshotArrays,
} from '../../db/childSnapshot';

import type { Child } from 'subsonic-api';
import type { QueueTrackOrigin } from '../../types/queue';

/** The single live-queue row's id. Bookmarks carry their own UUIDs. */
export const SNAPSHOT_LIVE_ID = 'live';

export type QueueSnapshotKind = 'live' | 'bookmark';

/** A snapshot's parent row — everything the bookmarks list renders without
 *  touching the songs. */
export interface QueueSnapshotMeta {
  id: string;
  kind: QueueSnapshotKind;
  name: string | null;
  createdAt: number;
  currentIndex: number;
  /** Playback offset within the current track, seconds. */
  positionSec: number | null;
  trackCount: number;
}

/** A snapshot with its songs rebuilt into real `Child` objects. */
export interface QueueSnapshot extends QueueSnapshotMeta {
  tracks: Child[];
  /** Positional ownership aligned with `tracks`; old/missing values are manual. */
  origins: QueueTrackOrigin[];
}

/* ------------------------------------------------------------------ */
/*  Writes                                                             */
/* ------------------------------------------------------------------ */

/**
 * The parent-row write: `INSERT … ON CONFLICT DO UPDATE`, NEVER `INSERT OR REPLACE` —
 * the latter is DELETE-then-INSERT and would cascade the whole queue away
 * (AGENTS.md §11).
 *
 * `track_count` is owned by the songs write ({@link snapshotTrackCommands}) and left
 * alone on conflict, so the count can never disagree with the rows actually stored.
 */
const SNAPSHOT_UPSERT_SQL =
  `INSERT INTO queue_snapshots (id, kind, name, created_at, current_index, position_sec, track_count)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       name = excluded.name,
       created_at = excluded.created_at,
       current_index = excluded.current_index,
       position_sec = excluded.position_sec;`;

const snapshotUpsertParams = (
  meta: Omit<QueueSnapshotMeta, 'trackCount'>,
): (string | number | null)[] => [
  meta.id,
  meta.kind,
  meta.name,
  meta.createdAt,
  meta.currentIndex,
  meta.positionSec,
];

/** Create or update a snapshot's parent row. See {@link SNAPSHOT_UPSERT_SQL}. */
export async function upsertSnapshot(meta: Omit<QueueSnapshotMeta, 'trackCount'>): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAsync(SNAPSHOT_UPSERT_SQL, snapshotUpsertParams(meta));
  } catch {
    /* dropped */
  }
}

/**
 * The statements that make a snapshot's songs exactly `tracks`. The leading DELETE is
 * what makes a rewrite with FEWER tracks correct: `pos` is positional, so without it a
 * shorter queue leaves stale tail rows — and it cascades each removed song's five array
 * rows with it.
 *
 * Entries with no id are dropped: `childToTrack` cannot play them, and `song_id` is
 * NOT NULL so one would abort the whole batch.
 */
function snapshotTrackCommands(
  snapshotId: string,
  tracks: readonly Child[],
  origins?: readonly QueueTrackOrigin[],
): BatchCommand[] {
  const usable = tracks
    .map((track, index) => ({ track, origin: origins?.[index] ?? 'manual' as const }))
    .filter(({ track }) => !!track?.id);
  const commands: BatchCommand[] = [
    ['DELETE FROM queue_snapshot_songs WHERE snapshot_id = ?;', [snapshotId]],
  ];
  usable.forEach(({ track: child, origin }, pos) => {
    commands.push(
      childSnapshotInsertCommand({
        table: 'queue_snapshot_songs',
        key: { snapshot_id: snapshotId, pos, origin },
        child,
      }),
      ...childSnapshotArrayCommands({
        tablePrefix: 'queue_snapshot_song',
        key: { snapshot_id: snapshotId, song_pos: pos },
        child,
      }),
    );
  });
  commands.push([
    'UPDATE queue_snapshots SET track_count = ? WHERE id = ?;',
    [usable.length, snapshotId],
  ]);
  return commands;
}

/**
 * Replace a snapshot's songs wholesale, as ONE atomic batch (`runAtomicBatchAsync` —
 * `runBatchAsync` is not atomic).
 *
 * The parent row must already exist ({@link upsertSnapshot}); the songs FK to it.
 */
export async function replaceSnapshotTracks(
  snapshotId: string,
  tracks: readonly Child[],
  origins?: readonly QueueTrackOrigin[],
): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAtomicBatchAsync(snapshotTrackCommands(snapshotId, tracks, origins));
  } catch {
    /* dropped */
  }
}

/** A bookmark as {@link writeBookmarkSnapshots} takes it. `kind` and `track_count`
 *  are the table's own, so they are not part of the input. */
export interface BookmarkSnapshotInput {
  id: string;
  name: string | null;
  createdAt: number;
  currentIndex: number;
  positionSec: number | null;
  tracks: readonly Child[];
}

/**
 * Write a SET of bookmarks — parent rows and songs — as ONE atomic batch, which is what
 * a backup restore needs. `replaceExisting` puts a `DELETE … WHERE kind = 'bookmark'`
 * at the head of that same batch, so replace-mode restore removes the old set before
 * writing the file's and a statement failure part-way rolls the lot back to the old set
 * rather than leaving a mix of both (`runBatchAsync` would not — AGENTS.md §11).
 *
 * The live queue's row is never touched: the DELETE is scoped to `kind = 'bookmark'`.
 */
export async function writeBookmarkSnapshots(
  bookmarks: readonly BookmarkSnapshotInput[],
  options: { replaceExisting: boolean },
): Promise<void> {
  const db = getDb();
  if (db === null) return;
  const commands: BatchCommand[] = [];
  if (options.replaceExisting) {
    commands.push(["DELETE FROM queue_snapshots WHERE kind = 'bookmark';", []]);
  }
  for (const { tracks, ...meta } of bookmarks) {
    commands.push([SNAPSHOT_UPSERT_SQL, snapshotUpsertParams({ ...meta, kind: 'bookmark' })]);
    commands.push(...snapshotTrackCommands(meta.id, tracks));
  }
  if (commands.length === 0) return;
  try {
    await db.runAtomicBatchAsync(commands);
  } catch {
    /* dropped */
  }
}

/**
 * Move the playback cursor. ONE UPDATE on the parent row and nothing else — this is
 * the hot path a track change takes, and it is what the split buys: the songs are
 * never touched.
 */
export async function updateSnapshotIndex(
  snapshotId: string,
  currentIndex: number,
  positionSec: number,
): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAsync(
      'UPDATE queue_snapshots SET current_index = ?, position_sec = ? WHERE id = ?;',
      [currentIndex, positionSec, snapshotId],
    );
  } catch {
    /* dropped */
  }
}

/** Remove a snapshot. Its songs, and their five array tables, cascade with it. */
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAsync('DELETE FROM queue_snapshots WHERE id = ?;', [snapshotId]);
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

interface SnapshotRow {
  id: string;
  kind: string;
  name: string | null;
  created_at: number;
  current_index: number;
  position_sec: number | null;
  track_count: number;
}

const metaFromRow = (r: SnapshotRow): QueueSnapshotMeta => ({
  id: r.id,
  kind: r.kind === 'bookmark' ? 'bookmark' : 'live',
  name: r.name,
  createdAt: r.created_at,
  currentIndex: r.current_index,
  positionSec: r.position_sec,
  trackCount: r.track_count,
});

const META_SELECT =
  'id, kind, name, created_at, current_index, position_sec, track_count FROM queue_snapshots';

/** The array tables key a song by `(snapshot_id, song_pos)`; the shared reader groups
 *  on those two columns. ONE query per table whatever the snapshot count — a per-song
 *  query would be 5×N round trips on the restore path. */
const arrayScope = (
  where: string,
  params: ReadonlyArray<string | number | null>,
): Parameters<typeof readChildSnapshotArraysSync>[1] => ({
  tablePrefix: 'queue_snapshot_song',
  keyColumns: ['snapshot_id', 'song_pos'],
  where,
  params,
});

const NO_ARRAYS: ChildSnapshotArrays = {};

/**
 * Read one snapshot with its full `Child[]`, SYNCHRONOUSLY — `restorePersistedQueue`
 * seeds the store on the JS thread so the mini player paints immediately, and must
 * stay synchronous. Returns null when the snapshot does not exist.
 */
export function readSnapshotSync(snapshotId: string): QueueSnapshot | null {
  const db = getDb();
  if (db === null) return null;
  try {
    const meta = db.getFirstSync<SnapshotRow>(`SELECT ${META_SELECT} WHERE id = ?;`, [snapshotId]);
    if (meta === undefined || meta === null) return null;
    const rows = db.getAllSync<Record<string, unknown>>(
      `SELECT pos, origin, ${CHILD_SNAPSHOT_SELECT} FROM queue_snapshot_songs ` +
        'WHERE snapshot_id = ? ORDER BY pos;',
      [snapshotId],
    );
    const arrays = readChildSnapshotArraysSync(db, arrayScope('snapshot_id = ?', [snapshotId]));
    const tracks = rows.map((raw) =>
      childFromSnapshotRow(
        childSnapshotRowFromRaw(raw),
        arrays.get(childSnapshotArrayKey([snapshotId, raw.pos as number])) ?? NO_ARRAYS,
      ),
    );
    const origins = rows.map((raw) => raw.origin === 'autoplay' ? 'autoplay' : 'manual');
    return { ...metaFromRow(meta), tracks, origins };
  } catch {
    return null;
  }
}

/** One snapshot's parent row, nothing else. Null when it does not exist — which is
 *  how a caller asks "is there a live queue already?" without rebuilding its `Child`s. */
export async function readSnapshotMeta(snapshotId: string): Promise<QueueSnapshotMeta | null> {
  const db = getDb();
  if (db === null) return null;
  try {
    const row = await db.getFirstAsync<SnapshotRow>(`SELECT ${META_SELECT} WHERE id = ?;`, [
      snapshotId,
    ]);
    return row === undefined || row === null ? null : metaFromRow(row);
  } catch {
    return null;
  }
}

/**
 * The REAL song-row count per snapshot — the whole table grouped, one query. Read
 * back after a write to prove the songs landed, rather than trusting the denormalized
 * `track_count`. Null (not an empty map) when the rows could not be read at all.
 */
export async function readSnapshotSongCounts(): Promise<Map<string, number> | null> {
  const db = getDb();
  if (db === null) return null;
  try {
    const rows = await db.getAllAsync<{ snapshot_id: string; c: number }>(
      'SELECT snapshot_id, COUNT(*) AS c FROM queue_snapshot_songs GROUP BY snapshot_id;',
    );
    return new Map(rows.map((r) => [r.snapshot_id, r.c]));
  } catch {
    return null;
  }
}

/** Every saved bookmark's parent row, newest first. The songs are not read — the
 *  list renders from `name`/`created_at`/`track_count` alone. */
export async function listBookmarks(): Promise<QueueSnapshotMeta[]> {
  const db = getDb();
  if (db === null) return [];
  try {
    const rows = await db.getAllAsync<SnapshotRow>(
      `SELECT ${META_SELECT} WHERE kind = 'bookmark' ORDER BY created_at DESC;`,
    );
    return rows.map(metaFromRow);
  } catch {
    return [];
  }
}

/** Predicate selecting every bookmark's rows in the child tables, so the bulk read
 *  needs no id list and no parameter-count ceiling. */
const BOOKMARK_SNAPSHOTS = "snapshot_id IN (SELECT id FROM queue_snapshots WHERE kind = 'bookmark')";

/**
 * Every bookmark with its full `Child[]`, newest first — what `bookmarksStore`
 * hydrates its in-memory map from. ASYNC and bulk: 7 queries for the whole set, not
 * 7 per bookmark, and off the JS thread because nothing paints from it before boot
 * completes (the live queue is the one that must read synchronously).
 *
 * **Null means "could not read", `[]` means "no bookmarks".** The caller replaces its
 * whole map from this, and a failed DB open answering `[]` would blank a set that is
 * not re-derivable.
 */
export async function readBookmarkSnapshots(): Promise<QueueSnapshot[] | null> {
  const db = getDb();
  if (db === null) return null;
  try {
    const metas = await listBookmarks();
    if (metas.length === 0) return [];
    const [rows, arrays] = await Promise.all([
      db.getAllAsync<Record<string, unknown>>(
        `SELECT snapshot_id, pos, ${CHILD_SNAPSHOT_SELECT} FROM queue_snapshot_songs ` +
          `WHERE ${BOOKMARK_SNAPSHOTS} ORDER BY snapshot_id, pos;`,
      ),
      readChildSnapshotArraysAsync(db, arrayScope(BOOKMARK_SNAPSHOTS, [])),
    ]);
    const tracks = new Map<string, Child[]>();
    for (const raw of rows) {
      const snapshotId = String(raw.snapshot_id);
      let list = tracks.get(snapshotId);
      if (list === undefined) {
        list = [];
        tracks.set(snapshotId, list);
      }
      list.push(
        childFromSnapshotRow(
          childSnapshotRowFromRaw(raw),
          arrays.get(childSnapshotArrayKey([snapshotId, raw.pos as number])) ?? NO_ARRAYS,
        ),
      );
    }
    return metas.map((meta) => {
      const snapshotTracks = tracks.get(meta.id) ?? [];
      return { ...meta, tracks: snapshotTracks, origins: snapshotTracks.map(() => 'manual') };
    });
  } catch {
    return null;
  }
}
