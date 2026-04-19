// Mock expo-sqlite with a minimal no-op DB so `persistence/db.ts`'s
// module-scope init succeeds on import. Individual tests override the
// shared handle via `db.__setDbForTests` with a richer fake.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

import { __setDbForTests } from '../db';
import {
  clearDetailTables,
  countAlbumDetails,
  countSongIndex,
  deleteAlbumDetail,
  deleteSongsForAlbums,
  hydrateAlbumDetails,
  upsertAlbumDetail,
  upsertSongsForAlbum,
} from '../detailTables';

/** Minimal InternalDb fake that records every row in Maps. */
function makeFakeDb() {
  const albumDetails = new Map<string, { id: string; json: string; retrievedAt: number }>();
  const songIndex = new Map<
    string,
    {
      id: string;
      albumId: string;
      title: string | null;
      artist: string | null;
      duration: number | null;
      coverArt: string | null;
      userRating: number | null;
      starred: number | null;
      year: number | null;
      track: number | null;
      disc: number | null;
    }
  >();

  const runSync = (sql: string, params: readonly unknown[] = []): void => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT OR REPLACE INTO album_details')) {
      const [id, json, retrievedAt] = params as [string, string, number];
      albumDetails.set(id, { id, json, retrievedAt });
    } else if (s.startsWith('INSERT OR REPLACE INTO song_index')) {
      const [id, albumId, title, artist, duration, coverArt, userRating, starred, year, track, disc] =
        params as [string, string, string | null, string | null, number | null, string | null,
          number | null, number | null, number | null, number | null, number | null];
      songIndex.set(id, { id, albumId, title, artist, duration, coverArt, userRating, starred, year, track, disc });
    } else if (s.startsWith('DELETE FROM album_details WHERE id = ?')) {
      albumDetails.delete(params[0] as string);
    } else if (s.startsWith('DELETE FROM album_details')) {
      albumDetails.clear();
    } else if (s.startsWith('DELETE FROM song_index WHERE albumId = ?')) {
      const albumId = params[0] as string;
      for (const [id, row] of songIndex.entries()) {
        if (row.albumId === albumId) songIndex.delete(id);
      }
    } else if (s.startsWith('DELETE FROM song_index')) {
      songIndex.clear();
    } else {
      throw new Error(`unhandled SQL in fake: ${s}`);
    }
  };

  return {
    albumDetails,
    songIndex,
    getFirstSync<T>(sql: string): T | undefined {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('COUNT(*) AS c FROM album_details')) {
        return { c: albumDetails.size } as T;
      }
      if (s.includes('COUNT(*) AS c FROM song_index')) {
        return { c: songIndex.size } as T;
      }
      return undefined;
    },
    getAllSync<T>(sql: string): T[] {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT id, json, retrievedAt FROM album_details')) {
        return Array.from(albumDetails.values()) as T[];
      }
      return [];
    },
    runSync,
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  };
}

function makeAlbum(id: string, songs: { id: string; title?: string }[] = []): any {
  return {
    id,
    name: `Album ${id}`,
    songCount: songs.length,
    duration: 0,
    created: '2020-01-01',
    song: songs.map((s) => ({
      id: s.id,
      title: s.title ?? `Song ${s.id}`,
      artist: 'Artist',
      duration: 180,
      coverArt: `ca-${s.id}`,
      userRating: 0,
      starred: undefined,
      year: 2020,
      track: 1,
      discNumber: 1,
    })),
  };
}

let fakeDb: ReturnType<typeof makeFakeDb>;

beforeEach(() => {
  fakeDb = makeFakeDb();
  __setDbForTests(fakeDb as any);
});

afterEach(() => {
  __setDbForTests(null);
});

describe('detailTables — album_details', () => {
  it('upsertAlbumDetail + hydrateAlbumDetails round-trip', () => {
    const album = makeAlbum('a1', [{ id: 's1' }]);
    upsertAlbumDetail('a1', album, 1700000000000);
    const restored = hydrateAlbumDetails();
    expect(restored['a1'].retrievedAt).toBe(1700000000000);
    expect(restored['a1'].album.id).toBe('a1');
    expect(restored['a1'].album.song?.[0].id).toBe('s1');
  });

  it('upsertAlbumDetail replaces a prior entry', () => {
    upsertAlbumDetail('a1', makeAlbum('a1'), 1);
    upsertAlbumDetail('a1', makeAlbum('a1'), 2);
    expect(countAlbumDetails()).toBe(1);
    expect(hydrateAlbumDetails()['a1'].retrievedAt).toBe(2);
  });

  it('deleteAlbumDetail removes both the album row and its songs', () => {
    upsertAlbumDetail('a1', makeAlbum('a1'), 1);
    upsertSongsForAlbum('a1', makeAlbum('a1', [{ id: 's1' }, { id: 's2' }]).song);
    expect(countAlbumDetails()).toBe(1);
    expect(countSongIndex()).toBe(2);
    deleteAlbumDetail('a1');
    expect(countAlbumDetails()).toBe(0);
    expect(countSongIndex()).toBe(0);
  });

  it('clearDetailTables wipes both tables atomically', () => {
    upsertAlbumDetail('a1', makeAlbum('a1'), 1);
    upsertAlbumDetail('a2', makeAlbum('a2'), 2);
    upsertSongsForAlbum('a1', makeAlbum('a1', [{ id: 's1' }]).song);
    upsertSongsForAlbum('a2', makeAlbum('a2', [{ id: 's2' }, { id: 's3' }]).song);
    clearDetailTables();
    expect(countAlbumDetails()).toBe(0);
    expect(countSongIndex()).toBe(0);
  });

  it('hydrateAlbumDetails returns empty when table is empty', () => {
    expect(hydrateAlbumDetails()).toEqual({});
  });

  it('hydrateAlbumDetails skips unparseable rows but returns the rest', () => {
    fakeDb.albumDetails.set('a1', { id: 'a1', json: '{not valid json', retrievedAt: 1 });
    fakeDb.albumDetails.set('a2', { id: 'a2', json: JSON.stringify(makeAlbum('a2')), retrievedAt: 2 });
    const restored = hydrateAlbumDetails();
    expect(Object.keys(restored).sort()).toEqual(['a2']);
  });
});

describe('detailTables — song_index', () => {
  it('upsertSongsForAlbum inserts every song with denormalized fields', () => {
    const album = makeAlbum('a1', [{ id: 's1' }, { id: 's2' }]);
    upsertSongsForAlbum('a1', album.song);
    expect(countSongIndex()).toBe(2);
    const s1 = fakeDb.songIndex.get('s1');
    expect(s1?.albumId).toBe('a1');
    expect(s1?.title).toBe('Song s1');
    expect(s1?.starred).toBe(0);
  });

  it('upsertSongsForAlbum clears prior songs for the same album (retag-safe)', () => {
    const a1 = makeAlbum('a1', [{ id: 's1' }, { id: 's2' }]);
    upsertSongsForAlbum('a1', a1.song);
    expect(countSongIndex()).toBe(2);
    const a1Rev = makeAlbum('a1', [{ id: 's3' }]);
    upsertSongsForAlbum('a1', a1Rev.song);
    expect(countSongIndex()).toBe(1);
    expect(fakeDb.songIndex.get('s3')?.albumId).toBe('a1');
    expect(fakeDb.songIndex.get('s1')).toBeUndefined();
    expect(fakeDb.songIndex.get('s2')).toBeUndefined();
  });

  it('upsertSongsForAlbum with empty list just clears the album', () => {
    upsertSongsForAlbum('a1', makeAlbum('a1', [{ id: 's1' }]).song);
    upsertSongsForAlbum('a1', []);
    expect(countSongIndex()).toBe(0);
  });

  it('upsertSongsForAlbum skips entries with no id', () => {
    const withOrphan = [
      { id: 's1', title: 'ok', artist: 'A', duration: 0, coverArt: null, userRating: 0, starred: undefined, year: 0, track: 1, discNumber: 1 },
      { /* no id */ title: 'bad', artist: 'A', duration: 0 },
    ] as any[];
    upsertSongsForAlbum('a1', withOrphan);
    expect(countSongIndex()).toBe(1);
  });

  it('upsertSongsForAlbum handles songs with every optional field missing', () => {
    // Forces every `field ?? null` default branch to fire.
    const bareSong = { id: 's1' } as any;
    upsertSongsForAlbum('a1', [bareSong]);
    const row = fakeDb.songIndex.get('s1');
    expect(row?.title).toBe(null);
    expect(row?.artist).toBe(null);
    expect(row?.duration).toBe(null);
    expect(row?.coverArt).toBe(null);
    expect(row?.userRating).toBe(null);
    expect(row?.starred).toBe(0);
    expect(row?.year).toBe(null);
    expect(row?.track).toBe(null);
    expect(row?.disc).toBe(null);
  });

  it('upsertSongsForAlbum marks starred rows with 1', () => {
    const starredSong = { id: 's1', title: 'x', starred: '2020-01-01' } as any;
    upsertSongsForAlbum('a1', [starredSong]);
    expect(fakeDb.songIndex.get('s1')?.starred).toBe(1);
  });

  it('deleteSongsForAlbums removes only the matching albums', () => {
    upsertSongsForAlbum('a1', makeAlbum('a1', [{ id: 's1' }]).song);
    upsertSongsForAlbum('a2', makeAlbum('a2', [{ id: 's2' }, { id: 's3' }]).song);
    upsertSongsForAlbum('a3', makeAlbum('a3', [{ id: 's4' }]).song);
    deleteSongsForAlbums(['a1', 'a3']);
    expect(countSongIndex()).toBe(2);
    expect(fakeDb.songIndex.get('s2')).toBeDefined();
    expect(fakeDb.songIndex.get('s3')).toBeDefined();
  });

  it('deleteSongsForAlbums with empty array is a no-op', () => {
    upsertSongsForAlbum('a1', makeAlbum('a1', [{ id: 's1' }]).song);
    deleteSongsForAlbums([]);
    expect(countSongIndex()).toBe(1);
  });
});

describe('detailTables — disabled db (healthy=false path)', () => {
  beforeEach(() => {
    __setDbForTests(null);
  });

  it('all mutations are no-ops when db is unavailable', () => {
    // None of these should throw; all return void / 0 / {}
    upsertAlbumDetail('a1', makeAlbum('a1'), 1);
    upsertSongsForAlbum('a1', makeAlbum('a1', [{ id: 's1' }]).song);
    deleteAlbumDetail('a1');
    deleteSongsForAlbums(['a1']);
    clearDetailTables();
    expect(countAlbumDetails()).toBe(0);
    expect(countSongIndex()).toBe(0);
    expect(hydrateAlbumDetails()).toEqual({});
  });

  it('deleteSongsForAlbums with empty array is still a no-op with null db', () => {
    expect(() => deleteSongsForAlbums([])).not.toThrow();
  });
});

describe('detailTables — db throws (error swallow path)', () => {
  const throwingDb = {
    getFirstSync() { throw new Error('boom'); },
    getAllSync() { throw new Error('boom'); },
    runSync() { throw new Error('boom'); },
    execSync() { throw new Error('boom'); },
    withTransactionSync() { throw new Error('boom'); },
  };

  beforeEach(() => {
    __setDbForTests(throwingDb as any);
  });

  it('mutations swallow errors and do not propagate', () => {
    expect(() => upsertAlbumDetail('a1', makeAlbum('a1'), 1)).not.toThrow();
    expect(() => upsertSongsForAlbum('a1', makeAlbum('a1', [{ id: 's1' }]).song)).not.toThrow();
    expect(() => deleteAlbumDetail('a1')).not.toThrow();
    expect(() => deleteSongsForAlbums(['a1'])).not.toThrow();
    expect(() => clearDetailTables()).not.toThrow();
  });

  it('reads return safe defaults on DB error', () => {
    expect(countAlbumDetails()).toBe(0);
    expect(countSongIndex()).toBe(0);
    expect(hydrateAlbumDetails()).toEqual({});
  });
});
