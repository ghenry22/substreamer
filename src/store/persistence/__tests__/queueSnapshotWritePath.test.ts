/**
 * The queue-snapshot repository against REAL SQL on the better-sqlite3-backed
 * op-SQLite substitute: order preservation, the SPLIT write (a cursor move must not touch
 * the songs), positional truncation, the FK cascades, and the parent upsert that must
 * NOT behave like `INSERT OR REPLACE`.
 *
 * Per AGENTS.md §11 the substitute proves SQL semantics, never concurrency.
 */
import type { Child } from 'subsonic-api';

import { __setDbForTests, getDb, type InternalDb } from '../db';
import {
  deleteSnapshot,
  listBookmarks,
  readSnapshotSync,
  replaceSnapshotTracks,
  SNAPSHOT_LIVE_ID,
  updateSnapshotIndex,
  upsertSnapshot,
  type QueueSnapshotMeta,
} from '../queueSnapshotTable';

const handle = getDb();
if (handle === null) throw new Error('test DB unavailable — the op-SQLite substitute failed to open');
const realDb: InternalDb = handle;

/** Every column the snapshot table carries, plus the five arrays. */
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
  channelCount: 2,
  transcodedContentType: 'audio/mpeg',
  transcodedSuffix: 'mp3',
  size: 12_345_678,
  contentType: 'audio/flac',
  bpm: 128,
  comment: 'a comment',
  type: 'music',
  bookmarkPosition: 12,
  originalWidth: 1000,
  originalHeight: 1000,
  path: 'The Artist/The Album/04 Full Song.flac',
  parent: 'al-1',
  sortName: 'Full Song, The',
  musicBrainzId: 'mb-1',
  explicitStatus: 'clean',
  userRating: 4,
  averageRating: 4.5,
  playCount: 12,
  created: new Date('2020-05-06T07:08:09.000Z'),
  starred: new Date('2021-06-07T08:09:10.000Z'),
  played: '2024-01-02T03:04:05Z',
  displayArtist: 'The Artist feat. Feature',
  displayAlbumArtist: 'Various',
  displayComposer: 'Composer',
  replayGain: {
    trackGain: -7.5,
    albumGain: -6.5,
    trackPeak: 0.98,
    albumPeak: 0.99,
    baseGain: 1,
    fallbackGain: -2,
  },
  // Real OpenSubsonic servers return `{name}[]` here despite the `string[]` type.
  genres: [{ name: 'Rock' }, { name: 'Indie' }],
  artists: [
    { id: 'ar-1', name: 'The Artist' },
    { id: 'ar-2', name: 'Feature' },
  ],
  albumArtists: [{ id: 'ar-3', name: 'Various' }],
  contributors: [
    { role: 'composer', subRole: 'lyrics', artist: { id: 'ar-4', name: 'Composer' } },
    { role: 'producer' },
  ],
  moods: ['energetic', 'happy'],
} as unknown as Child;

const song = (id: string): Child => ({ ...fullSong, id, title: `Title ${id}` });

const queueOf = (n: number): Child[] =>
  Array.from({ length: n }, (_, i) => song(`s-${String(i).padStart(2, '0')}`));

const liveMeta: Omit<QueueSnapshotMeta, 'trackCount'> = {
  id: SNAPSHOT_LIVE_ID,
  kind: 'live',
  name: null,
  createdAt: 1_700_000_000_000,
  currentIndex: 0,
  positionSec: 0,
};

const countRows = (table: string, snapshotId: string): number =>
  realDb.getFirstSync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${table} WHERE snapshot_id = ?;`,
    [snapshotId],
  )?.c ?? 0;

const CHILD_TABLES = [
  'queue_snapshot_song_genres',
  'queue_snapshot_song_artists',
  'queue_snapshot_song_album_artists',
  'queue_snapshot_song_contributors',
  'queue_snapshot_song_moods',
];

/** Counts the statements each op issues, so the split write can be asserted rather
 *  than assumed. Delegates everything to the real handle. */
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

beforeEach(() => {
  __setDbForTests(realDb);
  // ON DELETE CASCADE clears the songs and their five array tables with it.
  realDb.runSync('DELETE FROM queue_snapshots;');
});

afterEach(() => {
  __setDbForTests(realDb);
});

/* ------------------------------------------------------------------ */
/*  Round trip                                                         */
/* ------------------------------------------------------------------ */

describe('replaceSnapshotTracks + readSnapshotSync', () => {
  it('round-trips a queue of N tracks with the order preserved', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, queueOf(25));

    const snapshot = readSnapshotSync(SNAPSHOT_LIVE_ID);
    expect(snapshot?.tracks.map((t) => t.id)).toEqual(queueOf(25).map((t) => t.id));
    expect(snapshot?.trackCount).toBe(25);
  });

  it('rebuilds a usable Child — scalars, dates, replay gain and the five arrays', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, [fullSong]);

    const track = readSnapshotSync(SNAPSHOT_LIVE_ID)?.tracks[0];
    // What childToTrack + QueueItemRow render from.
    expect(track).toMatchObject({
      id: 's-full',
      title: 'Full Song',
      artist: 'The Artist',
      album: 'The Album',
      coverArt: 'cov-1',
      duration: 210,
      albumId: 'al-1',
      userRating: 4,
    });
    // What stampQueueFormat reads.
    expect(track).toMatchObject({ suffix: 'flac', bitRate: 960, bitDepth: 24, samplingRate: 96_000 });
    // What TrackDetailsModal reads beyond the above.
    expect(track).toMatchObject({
      year: 1999,
      track: 4,
      discNumber: 2,
      size: 12_345_678,
      bpm: 128,
      contentType: 'audio/flac',
      displayComposer: 'Composer',
      musicBrainzId: 'mb-1',
      path: 'The Artist/The Album/04 Full Song.flac',
      played: '2024-01-02T03:04:05Z',
      playCount: 12,
    });
    expect(track?.replayGain).toEqual({
      trackGain: -7.5,
      albumGain: -6.5,
      trackPeak: 0.98,
      albumPeak: 0.99,
      baseGain: 1,
      fallbackGain: -2,
    });
    expect(track?.created).toEqual(new Date('2020-05-06T07:08:09.000Z'));
    expect(track?.starred).toEqual(new Date('2021-06-07T08:09:10.000Z'));
    // Booleans survive the 0/1 round trip as booleans, not numbers.
    expect(track?.isDir).toBe(false);
    expect(track?.isVideo).toBe(false);
    // The five arrays — what the scrobble write path snapshots out of the queue.
    expect(track?.genres).toEqual(['Rock', 'Indie']);
    expect(track?.artists).toEqual([
      { id: 'ar-1', name: 'The Artist', albumCount: 0 },
      { id: 'ar-2', name: 'Feature', albumCount: 0 },
    ]);
    expect(track?.albumArtists).toEqual([{ id: 'ar-3', name: 'Various', albumCount: 0 }]);
    expect(track?.contributors).toEqual([
      { role: 'composer', subRole: 'lyrics', artist: { id: 'ar-4', name: 'Composer', albumCount: 0 } },
      { role: 'producer' },
    ]);
    expect(track?.moods).toEqual(['energetic', 'happy']);
  });

  it('keeps each track’s arrays against its own position', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, [
      { ...fullSong, id: 'a', moods: ['calm'] } as unknown as Child,
      { ...fullSong, id: 'b', moods: ['loud', 'fast'] } as unknown as Child,
    ]);

    const tracks = readSnapshotSync(SNAPSHOT_LIVE_ID)?.tracks ?? [];
    expect(tracks[0].moods).toEqual(['calm']);
    expect(tracks[1].moods).toEqual(['loud', 'fast']);
  });

  it('returns null for a snapshot that does not exist', () => {
    expect(readSnapshotSync('nope')).toBeNull();
  });

  it('stores live queue origins and treats missing values as manual', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(
      SNAPSHOT_LIVE_ID,
      [song('manual'), song('automatic'), song('default')],
      ['manual', 'autoplay'],
    );

    expect(readSnapshotSync(SNAPSHOT_LIVE_ID)?.origins).toEqual([
      'manual',
      'autoplay',
      'manual',
    ]);
  });

  it('drops entries with no id rather than aborting the batch', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, [
      song('keep-1'),
      { title: 'No id' } as unknown as Child,
      song('keep-2'),
    ]);

    const snapshot = readSnapshotSync(SNAPSHOT_LIVE_ID);
    expect(snapshot?.tracks.map((t) => t.id)).toEqual(['keep-1', 'keep-2']);
    expect(snapshot?.trackCount).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  The split write — the whole point of the table                     */
/* ------------------------------------------------------------------ */

describe('updateSnapshotIndex — one statement, songs untouched', () => {
  it('issues exactly ONE statement and never names the songs table', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, queueOf(10));

    const { db, sql } = countingDb();
    __setDbForTests(db);
    await updateSnapshotIndex(SNAPSHOT_LIVE_ID, 7, 42.5);

    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('UPDATE queue_snapshots');
    expect(sql[0]).not.toContain('queue_snapshot_songs');
  });

  it('moves the cursor while leaving every song row byte-identical', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, queueOf(10));
    const before = realDb.getAllSync(
      'SELECT * FROM queue_snapshot_songs WHERE snapshot_id = ? ORDER BY pos;',
      [SNAPSHOT_LIVE_ID],
    );

    await updateSnapshotIndex(SNAPSHOT_LIVE_ID, 7, 42.5);

    const snapshot = readSnapshotSync(SNAPSHOT_LIVE_ID);
    expect(snapshot?.currentIndex).toBe(7);
    expect(snapshot?.positionSec).toBe(42.5);
    expect(snapshot?.trackCount).toBe(10);
    expect(
      realDb.getAllSync('SELECT * FROM queue_snapshot_songs WHERE snapshot_id = ? ORDER BY pos;', [
        SNAPSHOT_LIVE_ID,
      ]),
    ).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/*  Positional truncation + cascades                                   */
/* ------------------------------------------------------------------ */

describe('replaceSnapshotTracks — a shorter queue leaves no tail', () => {
  it('drops the surplus song rows and their array rows', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, queueOf(12));
    expect(countRows('queue_snapshot_songs', SNAPSHOT_LIVE_ID)).toBe(12);
    expect(countRows('queue_snapshot_song_genres', SNAPSHOT_LIVE_ID)).toBe(24);

    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, queueOf(3));

    expect(countRows('queue_snapshot_songs', SNAPSHOT_LIVE_ID)).toBe(3);
    for (const table of CHILD_TABLES) {
      expect(
        realDb.getAllSync<{ song_pos: number }>(
          `SELECT DISTINCT song_pos FROM ${table} WHERE snapshot_id = ?;`,
          [SNAPSHOT_LIVE_ID],
        ).map((r) => r.song_pos),
      ).toEqual([0, 1, 2]);
    }
    const snapshot = readSnapshotSync(SNAPSHOT_LIVE_ID);
    expect(snapshot?.tracks).toHaveLength(3);
    expect(snapshot?.trackCount).toBe(3);
    expect(snapshot?.tracks[2].moods).toEqual(['energetic', 'happy']);
  });
});

describe('deleteSnapshot — cascades', () => {
  it('takes the songs and their five array tables with it', async () => {
    await upsertSnapshot({ ...liveMeta, id: 'bm-1', kind: 'bookmark', name: 'Saved' });
    await replaceSnapshotTracks('bm-1', queueOf(4));
    expect(countRows('queue_snapshot_songs', 'bm-1')).toBe(4);

    await deleteSnapshot('bm-1');

    expect(countRows('queue_snapshot_songs', 'bm-1')).toBe(0);
    for (const table of CHILD_TABLES) expect(countRows(table, 'bm-1')).toBe(0);
    expect(readSnapshotSync('bm-1')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  The parent upsert is NOT INSERT OR REPLACE                         */
/* ------------------------------------------------------------------ */

describe('upsertSnapshot — ON CONFLICT DO UPDATE', () => {
  it('re-upserting an existing snapshot does NOT cascade its songs away', async () => {
    await upsertSnapshot({ ...liveMeta, id: 'bm-2', kind: 'bookmark', name: 'First' });
    await replaceSnapshotTracks('bm-2', queueOf(5));

    await upsertSnapshot({
      ...liveMeta,
      id: 'bm-2',
      kind: 'bookmark',
      name: 'Renamed',
      currentIndex: 3,
      positionSec: 9.5,
    });

    const snapshot = readSnapshotSync('bm-2');
    expect(snapshot?.name).toBe('Renamed');
    expect(snapshot?.currentIndex).toBe(3);
    expect(snapshot?.positionSec).toBe(9.5);
    expect(snapshot?.tracks).toHaveLength(5);
    expect(snapshot?.trackCount).toBe(5);
    for (const table of CHILD_TABLES) expect(countRows(table, 'bm-2')).toBeGreaterThan(0);
  });

  it('leaves track_count to replaceSnapshotTracks, so it can never disagree', async () => {
    await upsertSnapshot({ ...liveMeta, id: 'bm-3', kind: 'bookmark', name: 'Counted' });
    expect(readSnapshotSync('bm-3')?.trackCount).toBe(0);

    await replaceSnapshotTracks('bm-3', queueOf(6));
    await upsertSnapshot({ ...liveMeta, id: 'bm-3', kind: 'bookmark', name: 'Counted again' });

    expect(readSnapshotSync('bm-3')?.trackCount).toBe(6);
  });
});

/* ------------------------------------------------------------------ */
/*  listBookmarks                                                      */
/* ------------------------------------------------------------------ */

describe('listBookmarks', () => {
  it('returns only bookmarks, newest first, without reading the songs', async () => {
    await upsertSnapshot(liveMeta);
    await replaceSnapshotTracks(SNAPSHOT_LIVE_ID, queueOf(2));
    await upsertSnapshot({
      ...liveMeta,
      id: 'bm-old',
      kind: 'bookmark',
      name: 'Older',
      createdAt: 1,
    });
    await replaceSnapshotTracks('bm-old', queueOf(3));
    await upsertSnapshot({
      ...liveMeta,
      id: 'bm-new',
      kind: 'bookmark',
      name: 'Newer',
      createdAt: 2,
    });

    const bookmarks = await listBookmarks();
    expect(bookmarks.map((b) => b.id)).toEqual(['bm-new', 'bm-old']);
    expect(bookmarks[1]).toMatchObject({ name: 'Older', kind: 'bookmark', trackCount: 3 });
  });

  it('is empty when nothing is saved', async () => {
    await expect(listBookmarks()).resolves.toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  DB unavailable                                                     */
/* ------------------------------------------------------------------ */

describe('no DB handle', () => {
  beforeEach(() => {
    __setDbForTests(null);
  });

  it('degrades to no-ops and empty reads', async () => {
    await expect(upsertSnapshot(liveMeta)).resolves.toBeUndefined();
    await expect(replaceSnapshotTracks(SNAPSHOT_LIVE_ID, queueOf(2))).resolves.toBeUndefined();
    await expect(updateSnapshotIndex(SNAPSHOT_LIVE_ID, 1, 1)).resolves.toBeUndefined();
    await expect(deleteSnapshot(SNAPSHOT_LIVE_ID)).resolves.toBeUndefined();
    await expect(listBookmarks()).resolves.toEqual([]);
    expect(readSnapshotSync(SNAPSHOT_LIVE_ID)).toBeNull();
  });
});
