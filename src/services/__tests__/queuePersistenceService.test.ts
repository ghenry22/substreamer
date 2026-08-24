/**
 * The LIVE queue's persistence against REAL SQL on the better-sqlite3-backed op-SQLite
 * substitute.
 *
 * The first describe asserts that a track change is ONE UPDATE on the parent row, not
 * a re-serialize-and-rewrite of the whole queue. The statement counts are asserted
 * directly rather than inferred from the stored result.
 *
 * `coldStart()` re-evaluates the service with its in-memory state empty and the same
 * DB underneath, which is what a relaunch looks like — the restore then has to come
 * out of the rows.
 *
 * Per AGENTS.md §11 the substitute proves SQL semantics, never concurrency.
 */
import type { Child } from 'subsonic-api';

import { settleDbWrites } from '../../test-utils/settleDbWrites';
import { __setDbForTests, getDb, type InternalDb } from '../../store/persistence/db';
import {
  clearPersistedQueue,
  flushPersistedQueue,
  flushPosition,
  getPersistedPosition,
  getPersistedQueue,
  persistCurrentIndex,
  persistPositionIfDue,
  persistQueue,
} from '../queuePersistenceService';

const handle = getDb();
if (handle === null) throw new Error('test DB unavailable — the op-SQLite substitute failed to open');
const realDb: InternalDb = handle;

const QUEUE_DEBOUNCE_MS = 1500;
const PERSIST_INTERVAL_MS = 10_000;

/* ------------------------------------------------------------------ */
/*  Fixtures + helpers                                                 */
/* ------------------------------------------------------------------ */

/** A track carrying every shape the restore has to rebuild — scalars, dates, replay
 *  gain and the five arrays, which the scrobble write path reads off the queue. */
const fullSong = {
  id: 's-full',
  title: 'Full Song',
  artist: 'The Artist',
  album: 'The Album',
  isDir: false,
  isVideo: false,
  coverArt: 'cov-1',
  duration: 210,
  albumId: 'al-1',
  artistId: 'ar-1',
  year: 1999,
  track: 4,
  discNumber: 2,
  suffix: 'flac',
  bitRate: 960,
  bitDepth: 24,
  samplingRate: 96_000,
  size: 12_345_678,
  contentType: 'audio/flac',
  userRating: 4,
  playCount: 12,
  path: 'The Artist/The Album/04 Full Song.flac',
  created: new Date('2020-05-06T07:08:09.000Z'),
  starred: new Date('2021-06-07T08:09:10.000Z'),
  played: '2024-01-02T03:04:05Z',
  replayGain: { trackGain: -7.5, albumGain: -6.5, trackPeak: 0.98 },
  genres: [{ name: 'Rock' }, { name: 'Indie' }],
  artists: [
    { id: 'ar-1', name: 'The Artist' },
    { id: 'ar-2', name: 'Feature' },
  ],
  albumArtists: [{ id: 'ar-3', name: 'Various' }],
  contributors: [{ role: 'composer', subRole: 'lyrics', artist: { id: 'ar-4', name: 'Composer' } }],
  moods: ['energetic', 'happy'],
} as unknown as Child;

const song = (id: string): Child => ({ ...fullSong, id, title: `Title ${id}` });

const queueOf = (n: number): Child[] =>
  Array.from({ length: n }, (_, i) => song(`s-${String(i).padStart(2, '0')}`));

const countOf = (table: string): number =>
  realDb.getFirstSync<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table};`)?.c ?? 0;

const liveRow = (): { current_index: number; position_sec: number | null; track_count: number } | undefined =>
  realDb.getFirstSync('SELECT current_index, position_sec, track_count FROM queue_snapshots WHERE id = ?;', [
    'live',
  ]);

/** Let the fire-and-forget writes reach the engine. Microtasks are not enough: a batch
 *  is parked on op-SQLite's transaction lock and started from a `setImmediate`, which
 *  this suite's fake timers own. */
const drain = settleDbWrites;

/** Fire the queue debounce and let its write land. */
async function flushDebounce(): Promise<void> {
  jest.advanceTimersByTime(QUEUE_DEBOUNCE_MS);
  await drain();
}

type QueuePersistence = typeof import('../queuePersistenceService');

/** A relaunch: a fresh copy of the service, empty in memory, over the same rows. */
function coldStart(): QueuePersistence {
  let fresh!: QueuePersistence;
  jest.isolateModules(() => {
    const freshDb = require('../../store/persistence/db') as typeof import('../../store/persistence/db');
    freshDb.__setDbForTests(realDb);
    fresh = require('../queuePersistenceService') as QueuePersistence;
  });
  return fresh;
}

/** Counts the statements each write issues, so the split can be asserted rather than
 *  assumed. Delegates everything to the real handle. */
function countingDb(): { db: InternalDb; sql: string[] } {
  const sql: string[] = [];
  const db: InternalDb = {
    ...realDb,
    getFirstSync: (...a) => realDb.getFirstSync(...a),
    getAllSync: (...a) => realDb.getAllSync(...a),
    getAllAsync: (...a) => realDb.getAllAsync(...a),
    getFirstAsync: (...a) => realDb.getFirstAsync(...a),
    runSync: (s, p) => {
      sql.push(s);
      return realDb.runSync(s, p);
    },
    runAsync: (s, p) => {
      sql.push(s);
      return realDb.runAsync(s, p);
    },
    runBatchAsync: (c) => {
      for (const [s] of c) sql.push(s);
      return realDb.runBatchAsync(c);
    },
    runAtomicBatchAsync: (c) => {
      for (const [s] of c) sql.push(s);
      return realDb.runAtomicBatchAsync(c);
    },
    execSync: (s) => {
      sql.push(s);
      realDb.execSync(s);
    },
    withTransactionSync: (f) => realDb.withTransactionSync(f),
  };
  return { db, sql };
}

beforeAll(() => {
  // The debounce window is what this suite steps through; `setImmediate` is op-SQLite's
  // transaction lock, not a timer under test, so it stays real and `drain()` costs no
  // clock movement.
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  __setDbForTests(realDb);
  // Resets the module: the pending write + its timer, the position throttle, and the
  // stored row. ON DELETE CASCADE clears the songs and their five array tables.
  clearPersistedQueue();
  realDb.runSync('DELETE FROM queue_snapshots;');
});

afterEach(() => {
  __setDbForTests(realDb);
});

/* ------------------------------------------------------------------ */
/*  The split write — the whole point of the change                    */
/* ------------------------------------------------------------------ */

describe('the split write', () => {
  it('a track change is ONE statement and never names the songs table', async () => {
    persistQueue(queueOf(5), 0);
    await flushDebounce();
    const songsBefore = realDb.getAllSync('SELECT * FROM queue_snapshot_songs ORDER BY pos;');

    const { db, sql } = countingDb();
    __setDbForTests(db);
    persistCurrentIndex(3);
    await drain();

    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('UPDATE queue_snapshots');
    expect(sql[0]).not.toContain('queue_snapshot_songs');
    expect(liveRow()?.current_index).toBe(3);
    // Every song row byte-identical: the cursor moved, the queue did not.
    expect(realDb.getAllSync('SELECT * FROM queue_snapshot_songs ORDER BY pos;')).toEqual(songsBefore);
  });

  it('a burst of skips costs one statement each, not a queue rewrite each', async () => {
    persistQueue(queueOf(40), 0);
    await flushDebounce();

    const { db, sql } = countingDb();
    __setDbForTests(db);
    for (let i = 1; i <= 10; i++) persistCurrentIndex(i);
    await drain();

    expect(sql).toHaveLength(10);
    expect(sql.every((s) => s.startsWith('UPDATE queue_snapshots'))).toBe(true);
    expect(liveRow()).toMatchObject({ current_index: 10, track_count: 40 });
  });

  it('a position tick folds into the parent row, also one statement', async () => {
    persistQueue(queueOf(3), 1);
    await flushDebounce();

    const { db, sql } = countingDb();
    __setDbForTests(db);
    expect(persistPositionIfDue(42.5, 's-01')).toBe(true);
    await drain();

    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('UPDATE queue_snapshots');
    expect(liveRow()).toMatchObject({ current_index: 1, position_sec: 42.5 });
  });

  it('a queue change writes the tracks', async () => {
    const { db, sql } = countingDb();
    __setDbForTests(db);
    persistQueue([fullSong, song('s-2')], 0);
    await flushDebounce();

    expect(sql.filter((s) => s.startsWith('INSERT INTO queue_snapshot_songs'))).toHaveLength(2);
    expect(sql.some((s) => s.startsWith('INSERT INTO queue_snapshots'))).toBe(true);
    expect(sql.some((s) => s.startsWith('DELETE FROM queue_snapshot_songs'))).toBe(true);
    expect(countOf('queue_snapshot_songs')).toBe(2);
    expect(liveRow()?.track_count).toBe(2);
  });

  it('a shorter queue leaves no stale tail', async () => {
    persistQueue(queueOf(6), 0);
    await flushDebounce();

    persistQueue(queueOf(2), 0);
    await flushDebounce();

    expect(countOf('queue_snapshot_songs')).toBe(2);
    expect(countOf('queue_snapshot_song_moods')).toBe(4);
    expect(liveRow()?.track_count).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  The debounce                                                       */
/* ------------------------------------------------------------------ */

describe('the queue-change debounce', () => {
  it('coalesces a burst of queue changes into one write', async () => {
    const spy = jest.spyOn(realDb, 'runAtomicBatchAsync');

    persistQueue(queueOf(1), 0);
    jest.advanceTimersByTime(500);
    persistQueue(queueOf(2), 0);
    jest.advanceTimersByTime(500);
    persistQueue(queueOf(3), 0);
    expect(countOf('queue_snapshot_songs')).toBe(0);

    await flushDebounce();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(countOf('queue_snapshot_songs')).toBe(3);
    spy.mockRestore();
  });

  it('flushPersistedQueue writes without waiting for the window (app background)', async () => {
    persistQueue(queueOf(4), 1);
    expect(countOf('queue_snapshot_songs')).toBe(0);

    flushPersistedQueue();
    await drain();

    expect(countOf('queue_snapshot_songs')).toBe(4);
    expect(liveRow()).toMatchObject({ current_index: 1, track_count: 4 });
  });

  it('flushing twice does not write twice', async () => {
    persistQueue(queueOf(2), 0);
    flushPersistedQueue();
    await drain();

    const spy = jest.spyOn(realDb, 'runAtomicBatchAsync');
    flushPersistedQueue();
    await flushDebounce();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a position tick inside the window rides out with the pending write', async () => {
    persistQueue(queueOf(5), 0);
    const { db, sql } = countingDb();
    __setDbForTests(db);

    expect(persistPositionIfDue(31, 's-00')).toBe(true);
    await drain();
    expect(sql).toHaveLength(0);

    await flushDebounce();
    expect(liveRow()).toMatchObject({ position_sec: 31, track_count: 5 });
  });

  it('a track change inside the window rides out with the pending write', async () => {
    persistQueue(queueOf(5), 0);
    const { db, sql } = countingDb();
    __setDbForTests(db);

    persistCurrentIndex(2);
    await drain();
    // Nothing yet: the cursor must not move onto song rows that are not stored.
    expect(sql).toHaveLength(0);

    await flushDebounce();
    expect(liveRow()).toMatchObject({ current_index: 2, track_count: 5 });
  });
});

/* ------------------------------------------------------------------ */
/*  Restore                                                            */
/* ------------------------------------------------------------------ */

describe('restore', () => {
  it('rebuilds complete Child objects, arrays included', async () => {
    persistQueue([fullSong, song('s-2')], 1, ['manual', 'autoplay']);
    await flushDebounce();

    const restored = coldStart().getPersistedQueue();
    expect(restored?.currentTrackIndex).toBe(1);
    expect(restored?.queue.map((t) => t.id)).toEqual(['s-full', 's-2']);
    expect(restored?.origins).toEqual(['manual', 'autoplay']);

    const track = restored!.queue[0];
    expect(track).toMatchObject({
      id: 's-full',
      title: 'Full Song',
      artist: 'The Artist',
      album: 'The Album',
      coverArt: 'cov-1',
      duration: 210,
      albumId: 'al-1',
      userRating: 4,
      suffix: 'flac',
      bitRate: 960,
      bitDepth: 24,
      samplingRate: 96_000,
      year: 1999,
      track: 4,
      discNumber: 2,
      size: 12_345_678,
      contentType: 'audio/flac',
      playCount: 12,
      played: '2024-01-02T03:04:05Z',
      path: 'The Artist/The Album/04 Full Song.flac',
    });
    expect(track.created).toEqual(new Date('2020-05-06T07:08:09.000Z'));
    expect(track.starred).toEqual(new Date('2021-06-07T08:09:10.000Z'));
    expect(track.isDir).toBe(false);
    expect(track.isVideo).toBe(false);
    expect(track.replayGain).toEqual({ trackGain: -7.5, albumGain: -6.5, trackPeak: 0.98 });
    // The five arrays: a restored queue is what reportPlay scrobbles from.
    expect(track.genres).toEqual(['Rock', 'Indie']);
    expect(track.artists).toEqual([
      { id: 'ar-1', name: 'The Artist', albumCount: 0 },
      { id: 'ar-2', name: 'Feature', albumCount: 0 },
    ]);
    expect(track.albumArtists).toEqual([{ id: 'ar-3', name: 'Various', albumCount: 0 }]);
    expect(track.contributors).toEqual([
      { role: 'composer', subRole: 'lyrics', artist: { id: 'ar-4', name: 'Composer', albumCount: 0 } },
    ]);
    expect(track.moods).toEqual(['energetic', 'happy']);
  });

  it('clamps a current index past the end of the queue', async () => {
    persistQueue(queueOf(3), 9);
    await flushDebounce();

    expect(coldStart().getPersistedQueue()?.currentTrackIndex).toBe(2);
  });

  it('restores the position for the track it was measured on', async () => {
    const queue = queueOf(3);
    persistQueue(queue, 0);
    flushPosition(42, queue[0].id);
    await flushDebounce();

    const fresh = coldStart();
    expect(fresh.getPersistedQueue()?.currentTrackIndex).toBe(0);
    expect(fresh.getPersistedPosition()).toEqual({ position: 42, trackId: 's-00' });
  });

  it('drops the position when the track changed under it', async () => {
    const queue = queueOf(3);
    persistQueue(queue, 0);
    flushPosition(42, queue[0].id);
    await flushDebounce();

    persistCurrentIndex(1);
    await drain();

    const fresh = coldStart();
    expect(fresh.getPersistedQueue()?.currentTrackIndex).toBe(1);
    // Position 0 for the new track: the restore has nothing to seek to.
    expect(fresh.getPersistedPosition()).toEqual({ position: 0, trackId: 's-01' });
  });

  it('keeps the position when a queue change leaves the same track current', async () => {
    const queue = queueOf(3);
    persistQueue(queue, 1);
    flushPosition(42, queue[1].id);
    await flushDebounce();

    // The track before the current one was removed — same track, new index.
    persistQueue([queue[1], queue[2]], 0);
    await flushDebounce();

    const fresh = coldStart();
    expect(fresh.getPersistedQueue()?.currentTrackIndex).toBe(0);
    expect(fresh.getPersistedPosition()).toEqual({ position: 42, trackId: 's-01' });
  });

  it('an empty queue restores as nothing', async () => {
    persistQueue([], 0);
    await flushDebounce();

    const fresh = coldStart();
    expect(fresh.getPersistedQueue()).toBeNull();
    expect(fresh.getPersistedPosition()).toBeNull();
  });

  it('nothing stored restores as nothing', () => {
    const fresh = coldStart();
    expect(fresh.getPersistedQueue()).toBeNull();
    expect(fresh.getPersistedPosition()).toBeNull();
  });

  it('serves the live queue from memory rather than re-reading the rows', async () => {
    const queue = queueOf(3);
    persistQueue(queue, 2);
    await flushDebounce();

    expect(getPersistedQueue()).toEqual({
      queue,
      currentTrackIndex: 2,
      origins: ['manual', 'manual', 'manual'],
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Position throttle                                                  */
/* ------------------------------------------------------------------ */

describe('persistPositionIfDue', () => {
  beforeEach(async () => {
    persistQueue(queueOf(2), 0);
    await flushDebounce();
  });

  it('writes on the first call and skips inside the interval', async () => {
    expect(persistPositionIfDue(10, 's-00')).toBe(true);
    expect(persistPositionIfDue(20, 's-00')).toBe(false);
    await drain();

    expect(liveRow()?.position_sec).toBe(10);
    expect(getPersistedPosition()).toEqual({ position: 10, trackId: 's-00' });
  });

  it('writes again once the interval has elapsed', async () => {
    persistPositionIfDue(10, 's-00');
    jest.advanceTimersByTime(PERSIST_INTERVAL_MS + 1);

    expect(persistPositionIfDue(50, 's-00')).toBe(true);
    await drain();
    expect(liveRow()?.position_sec).toBe(50);
  });

  it('clamps a position past the duration down to the duration', async () => {
    // e.g. a transcoded stream reporting position beyond its estimated length.
    persistPositionIfDue(1721, 's-00', 1061);
    await drain();

    expect(liveRow()?.position_sec).toBe(1061);
  });

  it('leaves an in-range position unchanged when a duration is given', async () => {
    persistPositionIfDue(500, 's-00', 1061);
    await drain();

    expect(liveRow()?.position_sec).toBe(500);
  });
});

describe('flushPosition', () => {
  it('writes regardless of the throttle and re-arms it', async () => {
    persistQueue(queueOf(2), 0);
    await flushDebounce();
    persistPositionIfDue(10, 's-00');

    flushPosition(99, 's-00');
    await drain();

    expect(liveRow()?.position_sec).toBe(99);
    expect(persistPositionIfDue(60, 's-00')).toBe(false);
  });

  it('takes a pending queue change out with it', async () => {
    persistQueue(queueOf(3), 0);

    flushPosition(12, 's-00');
    await drain();

    expect(countOf('queue_snapshot_songs')).toBe(3);
    expect(liveRow()).toMatchObject({ position_sec: 12, track_count: 3 });
  });

  it('clamps a position past the duration down to the duration', async () => {
    persistQueue(queueOf(2), 0);
    await flushDebounce();

    flushPosition(1721, 's-00', 1061);
    await drain();

    expect(liveRow()?.position_sec).toBe(1061);
  });
});

/* ------------------------------------------------------------------ */
/*  Clearing                                                           */
/* ------------------------------------------------------------------ */

describe('clearPersistedQueue', () => {
  it('deletes the row and cancels a pending write', async () => {
    persistQueue(queueOf(3), 0);
    await flushDebounce();
    persistQueue(queueOf(5), 0);

    clearPersistedQueue();
    await flushDebounce();

    expect(countOf('queue_snapshots')).toBe(0);
    expect(countOf('queue_snapshot_songs')).toBe(0);
    expect(getPersistedQueue()).toBeNull();
    expect(getPersistedPosition()).toBeNull();
  });

  it('resets the position throttle', async () => {
    persistQueue(queueOf(2), 0);
    await flushDebounce();
    flushPosition(10, 's-00');

    clearPersistedQueue();

    expect(persistPositionIfDue(20, 's-00')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  DB unavailable                                                     */
/* ------------------------------------------------------------------ */

describe('no DB handle', () => {
  it('degrades to no-ops without throwing, and memory still answers', async () => {
    __setDbForTests(null);

    persistQueue(queueOf(2), 0);
    await flushDebounce();
    persistCurrentIndex(1);
    expect(persistPositionIfDue(5, 's-01')).toBe(true);
    flushPosition(6, 's-01');
    await drain();

    expect(getPersistedQueue()?.queue).toHaveLength(2);
    expect(getPersistedPosition()).toEqual({ position: 6, trackId: 's-01' });

    clearPersistedQueue();
    expect(getPersistedQueue()).toBeNull();
  });
});
