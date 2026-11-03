import type { AlbumID3, Child } from 'subsonic-api';

import * as albumsRepo from '../../db/repository/albums';
import { countAlbums, upsertAlbums } from '../../db/repository/albums';
import * as songsRepo from '../../db/repository/songs';
import { countSongs } from '../../db/repository/songs';
import { getDb } from '../../store/persistence/db';
import { syncStatusStore } from '../../store/syncStatusStore';
import {
  releaseLibrarySyncQueue,
  runNormalizedLibrarySync,
  __setPageSizesForTest,
} from '../normalizedLibrarySync';

// Fixed server pages: 5 albums, 10 songs across those 5 albums (2 each). Prefixed
// `mock*` so jest permits referencing them inside the hoisted mock factory.
const mockAlbumsData: AlbumID3[] = Array.from({ length: 5 }, (_, i) => ({
  id: `al${i}`,
  name: `Album ${i}`,
  created: new Date('2020-01-01'),
  duration: 100,
  songCount: 2,
})) as unknown as AlbumID3[];
const mockSongsData: Child[] = Array.from({ length: 10 }, (_, i) => ({
  id: `s${i}`,
  title: `Song ${i}`,
  albumId: `al${Math.floor(i / 2)}`,
  isDir: false,
})) as unknown as Child[];

let mockApi: unknown = {};
let mockPlaylists: Array<Record<string, unknown>> = [];
const mockFetchPlaylistDetail = jest.fn((id: string) =>
  Promise.resolve({ id, entry: [] } as unknown),
);
const mockSyncCachedItemTracks = jest.fn();
/** The song pager and the per-album fetch are jest.fn()s so a test can inject a
 *  transient empty page, a hole in the library, or assert exactly which albums the gap
 *  repair asked the server about. */
// The real page fns resolve [] without throwing when there is no usable API
// (subsonicService.ts) — mirror that, or a test that drops the API still gets data
// and the loop's API-null guard is never exercised.
const mockGetAlbumsPageByName = jest.fn((size: number, offset: number) =>
  Promise.resolve(mockApi === null ? [] : mockAlbumsData.slice(offset, offset + size)),
);
const mockSearchAlbumsPage = jest.fn((count: number, offset: number) =>
  Promise.resolve(mockApi === null ? [] : mockAlbumsData.slice(offset, offset + count)),
);
const mockSearchSongsPage = jest.fn((count: number, offset: number) =>
  Promise.resolve(mockApi === null ? [] : mockSongsData.slice(offset, offset + count)),
);
/** `getAlbumResult` envelope for an album the server served. */
const mockAlbumOk = (id: string, song?: unknown[]) => ({
  status: 'ok',
  album: {
    ...mockAlbumsData.find((a) => a.id === id),
    song: song ?? mockSongsData.filter((s) => (s as { albumId?: string }).albumId === id),
  },
});
const mockGetAlbum = jest.fn((id: string) => Promise.resolve(mockAlbumOk(id) as unknown));
jest.mock('../subsonicService', () => ({
  probeEmptySearch3: () => Promise.resolve(true),
  searchAlbumsPage: (count: number, offset: number) => mockSearchAlbumsPage(count, offset),
  getAlbumsPageByName: (size: number, offset: number) => mockGetAlbumsPageByName(size, offset),
  searchSongsPage: (count: number, offset: number) => mockSearchSongsPage(count, offset),
  getAlbumResult: (id: string) => mockGetAlbum(id),
  // An empty page only means "end of library" when there was an API to ask; the loops
  // consult this to tell that apart from "no usable API, so everything resolves []".
  getApi: () => mockApi,
  ensureCoverArtAuth: () => Promise.resolve(),
  getAllArtists: () => Promise.resolve([]),
  getAllPlaylists: () => Promise.resolve(mockPlaylists),
}));
jest.mock('../detailFetchService', () => ({
  fetchPlaylistDetail: (id: string) => mockFetchPlaylistDetail(id),
}));
jest.mock('../musicCacheService', () => ({
  syncCachedItemTracks: (...a: unknown[]) => mockSyncCachedItemTracks(...a),
}));
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: { getState: () => ({ offlineMode: false }), subscribe: () => () => {} },
}));

const db = () => getDb()!;

/** The playlist detail reconcile is deliberately fire-and-forget, so every test has to
 *  drain it — otherwise one test's fan-out is still in flight (and holding the dedup
 *  promise) when the next one starts. */
const flush = async () => {
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0));
};

afterEach(flush);

beforeEach(() => {
  // Page sizes matched to the fixtures (5 albums, 10 songs) so the default flow is a
  // FULL page followed by an empty one — the exact-multiple case, which is what
  // exercises empty-page termination and the corroborator. Tests that need a
  // mid-enumeration hiccup shrink these themselves.
  __setPageSizesForTest({ album: 5, song: 10, basic: 5 });
  mockApi = {};
  mockPlaylists = [];
  // mockReset, not mockClear: one test overrides the implementation to drop the API
  // mid-fetch, and mockClear leaves that in place for the next test.
  mockFetchPlaylistDetail.mockReset();
  mockFetchPlaylistDetail.mockImplementation((id: string) =>
    Promise.resolve({ id, entry: [] } as unknown),
  );
  mockSyncCachedItemTracks.mockClear();
  mockSearchAlbumsPage.mockReset();
  mockSearchAlbumsPage.mockImplementation((count: number, offset: number) =>
    Promise.resolve(mockApi === null ? [] : mockAlbumsData.slice(offset, offset + count)),
  );
  mockSearchSongsPage.mockReset();
  mockSearchSongsPage.mockImplementation((count: number, offset: number) =>
    Promise.resolve(mockApi === null ? [] : mockSongsData.slice(offset, offset + count)),
  );
  mockGetAlbum.mockReset();
  mockGetAlbum.mockImplementation((id: string) => Promise.resolve(mockAlbumOk(id) as unknown));
  db().runSync('DELETE FROM playlists');
  db().runSync('DELETE FROM songs');
  db().runSync('DELETE FROM albums');
  // Full reset: cursors/completion flags carry between tests otherwise, and a
  // 'complete' library makes the next run short-circuit before the playlist phase.
  syncStatusStore.setState(syncStatusStore.getInitialState(), true);
});

describe('runNormalizedLibrarySync', () => {
  it('populates ONLY the normalized model + reports albums-with-songs / total-albums', async () => {
    await runNormalizedLibrarySync({ full: true });

    // Normalized tables populated.
    expect(await countAlbums(db())).toBe(5);
    expect(await countSongs(db())).toBe(10);

    // Both phases marked complete (the transient detailSync* progress fields are
    // reset to 0 by markSongSyncComplete, so we assert the completion outcome).
    const s = syncStatusStore.getState();
    expect(s.librarySyncComplete).toBe(true);
    expect(s.songSyncComplete).toBe(true);
  });

  it('is idempotent on a full re-run (upserts in place, no duplicates)', async () => {
    await runNormalizedLibrarySync({ full: true });
    await runNormalizedLibrarySync({ full: true });
    expect(await countAlbums(db())).toBe(5);
    expect(await countSongs(db())).toBe(10);
  });

  it('a full re-run does NOT drop rows the sync cannot rebuild', async () => {
    await runNormalizedLibrarySync({ full: true });
    // Playlist membership + artist bio have no sync writer — only the on-demand detail
    // fetch writes them. Dropping the tables on a full resync destroyed them for good.
    db().runSync("INSERT OR REPLACE INTO playlists (id, name) VALUES ('pl1', 'Mix')");
    db().runSync(
      "INSERT OR REPLACE INTO playlist_songs (playlist_id, position, song_id) VALUES ('pl1', 0, 's0')",
    );
    db().runSync("INSERT OR REPLACE INTO artists (id, name) VALUES ('ar1', 'A')");
    db().runSync(
      "INSERT OR REPLACE INTO artist_bio (artist_id, biography, checked_at) VALUES ('ar1', 'bio', 1)",
    );

    await runNormalizedLibrarySync({ full: true });

    expect(
      db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM playlist_songs')?.n,
    ).toBe(1);
    expect(
      db().getFirstSync<{ bio: string }>(
        "SELECT biography AS bio FROM artist_bio WHERE artist_id = 'ar1'",
      )?.bio,
    ).toBe('bio');
  });

  it('does not mark the library complete when the API vanishes mid-run', async () => {
    // With no usable API every page fn resolves [] without throwing. Reading that as
    // "end of library" marked a truncated library fully synced.
    mockApi = null;
    syncStatusStore.setState({ librarySyncComplete: false, songSyncComplete: false });
    await runNormalizedLibrarySync({ full: true });
    expect(syncStatusStore.getState().librarySyncComplete).toBe(false);
  });

  it('pauses the ALBUM phase for the user when a page keeps failing', async () => {
    // `librarySyncPhase` is PERSISTED: left on 'fetching' it survives the relaunch and
    // shows "Fetching library…" with nothing fetching. 'paused-error' is resumable and
    // carries the reason, so the user can see why and restart or resume.
    mockSearchAlbumsPage.mockImplementation(() => Promise.reject(new Error('boom')));

    await runNormalizedLibrarySync({ full: true });

    const s = syncStatusStore.getState();
    expect(s.librarySyncPhase).toBe('paused-error');
    expect(s.lastSyncError).toContain('boom');
    // Retried once before giving up, so a single transient failure never reaches here.
    expect(mockSearchAlbumsPage).toHaveBeenCalledTimes(2);
  });
});

/** Serve only the first `n` songs of the library, in pages of 4. Everything after that
 *  never arrives, so the albums those songs belong to end the walk with no tracks — the
 *  album-shaped hole this whole area exists to stop latching. */
const serveSongs = (n: number) =>
  mockSearchSongsPage.mockImplementation((count: number, offset: number) =>
    Promise.resolve(mockSongsData.slice(0, n).slice(offset, offset + count)),
  );

describe('an empty song page must be corroborated', () => {
  beforeEach(() => __setPageSizesForTest({ album: 1, song: 1, basic: 1 }));
  it('retries an empty page mid-walk instead of ending the library there', async () => {
    let asksAtFour = 0;
    mockSearchSongsPage.mockImplementation((count: number, offset: number) => {
      // One hiccup at offset 4: a 200 with no searchResult3 is indistinguishable from
      // exhaustion, and believing it costs every song after this offset.
      if (offset === 4 && (asksAtFour += 1) === 1) return Promise.resolve([]);
      return Promise.resolve(mockSongsData.slice(offset, offset + count));
    });

    await runNormalizedLibrarySync({ full: true });

    expect(asksAtFour).toBeGreaterThan(1); // it asked again rather than believing the []
    expect(await countSongs(db())).toBe(10);
    expect(syncStatusStore.getState().songSyncCursor).toBe(10);
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
    // The pager itself recovered — no per-album repair was needed.
    expect(mockGetAlbum).not.toHaveBeenCalled();
    // The budget is CONSECUTIVE empties, not empties-per-walk: the hiccup at offset 4
    // must not eat the corroboration the real end of the library gets.
    expect(mockSearchSongsPage.mock.calls.filter(([, offset]) => offset === 10)).toHaveLength(4);
  });

  it('still terminates on a genuinely exhausted library, with bounded retries', async () => {
    await runNormalizedLibrarySync({ full: true });

    const asksPastTheEnd = mockSearchSongsPage.mock.calls.filter(([, offset]) => offset === 10);
    expect(asksPastTheEnd.length).toBeGreaterThan(1); // corroborated
    expect(asksPastTheEnd.length).toBeLessThanOrEqual(4); // and bounded
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
  });
});

describe('an empty album page must be corroborated', () => {
  // One row per page: the fixture then yields five FULL pages and an empty one, so a
  // page can go missing part-way through without the short-page rule ending the walk.
  beforeEach(() => __setPageSizesForTest({ album: 1, song: 1, basic: 1 }));
  /** Serve the album list one at a time, so a page can go missing part-way through it. */
  const pagedAlbums = (count: number, offset: number) =>
    Promise.resolve(mockAlbumsData.slice(offset, offset + count));

  it('retries an empty page mid-enumeration instead of ending the album phase there', async () => {
    let asksAtTwo = 0;
    mockSearchAlbumsPage.mockImplementation((count: number, offset: number) => {
      // One hiccup at offset 2. Believing it latched a truncated album library
      // 'complete' — and the song phase only ever walks the albums it left behind.
      if (offset === 2 && (asksAtTwo += 1) === 1) return Promise.resolve([]);
      return pagedAlbums(count, offset);
    });

    await runNormalizedLibrarySync({ full: true });

    expect(asksAtTwo).toBeGreaterThan(1); // it asked again rather than believing the []
    expect(await countAlbums(db())).toBe(5);
    expect(await countSongs(db())).toBe(10);
    expect(syncStatusStore.getState().librarySyncComplete).toBe(true);
    // The budget is CONSECUTIVE empties: the hiccup at offset 2 must not eat the
    // corroboration the real end of the list gets.
    expect(mockSearchAlbumsPage.mock.calls.filter(([, offset]) => offset === 5)).toHaveLength(4);
  });

  it('still terminates on a genuinely exhausted album list, with bounded retries', async () => {
    mockSearchAlbumsPage.mockImplementation(pagedAlbums);

    await runNormalizedLibrarySync({ full: true });

    const asksPastTheEnd = mockSearchAlbumsPage.mock.calls.filter(([, offset]) => offset === 5);
    expect(asksPastTheEnd.length).toBeGreaterThan(1); // corroborated
    expect(asksPastTheEnd.length).toBeLessThanOrEqual(4); // and bounded
    expect(syncStatusStore.getState().librarySyncComplete).toBe(true);
    expect(await countAlbums(db())).toBe(5);
  });

  it('waits out the backoff between corroboration attempts', async () => {
    const asks: number[] = [];
    mockSearchAlbumsPage.mockImplementation((count: number, offset: number) => {
      if (offset >= 5) {
        asks.push(Date.now());
        return Promise.resolve([]);
      }
      return pagedAlbums(count, offset);
    });

    await runNormalizedLibrarySync({ full: true });

    // 200ms, 400ms, 800ms. Corroborating in a tight loop would just re-ask a rate-limiting
    // server three more times inside the same window and get the same empty answer.
    expect(asks).toHaveLength(4);
    const gaps = asks.slice(1).map((t, i) => t - asks[i]);
    expect(gaps[0]).toBeGreaterThanOrEqual(150);
    expect(gaps[1]).toBeGreaterThanOrEqual(300);
    expect(gaps[2]).toBeGreaterThanOrEqual(600);
  });

  it('returns without marking the library complete when the API vanishes mid-walk', async () => {
    mockSearchAlbumsPage.mockImplementation((count: number, offset: number) => {
      if (offset >= 2) {
        mockApi = null; // logout / auth restore mid-walk: every page fn now resolves []
        return Promise.resolve([]);
      }
      return pagedAlbums(count, offset);
    });

    await runNormalizedLibrarySync({ full: true });

    expect(syncStatusStore.getState().librarySyncComplete).toBe(false);
    expect(await countAlbums(db())).toBe(2);
    // Nothing to corroborate with no API to ask — it must bail, not sit out the ladder.
    expect(mockSearchAlbumsPage.mock.calls.filter(([, offset]) => offset === 2)).toHaveLength(1);
  });
});

describe('song-gap repair', () => {
  it('costs one indexed probe and no per-album request when the library is healthy', async () => {
    const getAll = jest.spyOn(db(), 'getAllAsync');
    try {
      await runNormalizedLibrarySync({ full: true });

      expect(mockGetAlbum).not.toHaveBeenCalled();
      expect(syncStatusStore.getState().songSyncComplete).toBe(true);
      // The gate is `hasAlbumWithoutSongs` — a `LIMIT 1` probe that stops at the first
      // hit. Materialising the two id lists the walk diffs is exactly what it exists to
      // avoid, on a library that can hold 200k albums.
      const idListReads = getAll.mock.calls.filter(([sql]) =>
        /^SELECT id FROM albums$|DISTINCT album_id/.test(String(sql)),
      );
      expect(idListReads).toHaveLength(0);
    } finally {
      getAll.mockRestore();
    }
  });

  it('fetches ONLY the albums left without songs, never the library', async () => {
    serveSongs(6); // al0..al2 populated; al3 and al4 end the walk empty

    await runNormalizedLibrarySync({ full: true });

    // A full resync leaves `fullWalkPending` set until completion; the repair must
    // ignore it, or two holes turn into a whole-library re-fetch.
    expect(mockGetAlbum.mock.calls.map(([id]) => id).sort()).toEqual(['al3', 'al4']);
    expect(await countSongs(db())).toBe(10);
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
    expect(syncStatusStore.getState().songGapRepairAttempted).toBe(false);
  });

  it('does not mark the song sync complete when the repair could not run', async () => {
    serveSongs(6);
    // every repair fetch fails at the transport
    mockGetAlbum.mockImplementation(() => Promise.resolve({ status: 'failed' } as unknown));

    await runNormalizedLibrarySync({ full: true });

    // Reaching the last page is necessary, not sufficient: the gap is still there and
    // nothing has established that the server has no tracks for it.
    expect(syncStatusStore.getState().songSyncComplete).toBe(false);
    expect(syncStatusStore.getState().songGapRepairAttempted).toBe(false);
  });

  it('stops re-triggering once the server says the gapped albums have no tracks', async () => {
    serveSongs(6);
    mockGetAlbum.mockImplementation((id: string) => Promise.resolve(mockAlbumOk(id, []) as unknown));

    await runNormalizedLibrarySync({ full: true });

    // Asked and answered — the albums are track-less on the server, not victims of a
    // lost page. Without recording that, the gate re-fires this run on every launch.
    expect(syncStatusStore.getState().songGapRepairAttempted).toBe(true);
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);

    mockGetAlbum.mockClear();
    await runNormalizedLibrarySync();
    expect(mockGetAlbum).not.toHaveBeenCalled();
  });

  it('asks again after the user forces a full resync', async () => {
    syncStatusStore.setState({ songGapRepairAttempted: true });
    syncStatusStore.getState().resetSongSync();
    expect(syncStatusStore.getState().songGapRepairAttempted).toBe(false);
  });
});

describe('the per-album walk', () => {
  it('runs the albumId sanity check on the first page of a RESUMED walk', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // A server that stops populating `albumId` part-way writes rows with album_id NULL:
    // the album reads empty while countSongs stays right, so nothing downstream sees it.
    // Gating the check on offset 0 meant a resumed walk never looked.
    mockSearchSongsPage.mockImplementation((count: number, offset: number) =>
      Promise.resolve(
        mockSongsData
          .slice(offset, offset + count)
          .map((s) => ({ ...s, albumId: undefined })),
      ),
    );
    syncStatusStore.setState({ songSyncCursor: 4 });

    await runNormalizedLibrarySync();

    expect(syncStatusStore.getState().songSyncStrategy).toBe('basic');
    expect(mockGetAlbum).toHaveBeenCalled();
    // The failure this test drives is reported, not swallowed.
    expect(warn.mock.calls.some((c) => String(c[0]).includes('songs missing albumId'))).toBe(true);
    warn.mockRestore();
  });

  /** The persisted strategy is what routes the run; on a basic server the probe has
   *  already stored 'basic' and the sync resumes on the walk. */
  const onBasicServer = () => syncStatusStore.setState({ syncStrategy: 'basic' });

  it('does not count an album the server returned no songs for as walked', async () => {
    mockGetAlbum.mockImplementation((id: string) => {
      // A transport failure, or any Subsonic code other than 70 (40 wrong credentials,
      // 30 incompatible version) — all of which must keep bailing.
      if (id === 'al4') return Promise.resolve({ status: 'failed' } as unknown);
      // al3 exists on the server but has no tracks at all.
      return Promise.resolve(mockAlbumOk(id, id === 'al3' ? [] : undefined) as unknown);
    });

    onBasicServer();

    await runNormalizedLibrarySync({ full: true });

    // The walk, not the search3 pager — the assertions below only mean anything on the
    // slow path, and the mocked pager would otherwise serve every song and hide it.
    expect(syncStatusStore.getState().songSyncStrategy).toBe('basic');
    expect(mockSearchSongsPage).not.toHaveBeenCalled();
    // al0, al1, al2 were walked. al3 answered empty and al4 failed — neither counts,
    // or the progress bar reads 100% over a library that still has holes in it.
    expect(syncStatusStore.getState().detailSyncCompleted).toBe(3);
    expect(syncStatusStore.getState().songSyncComplete).toBe(false);
    // A failed fetch is not a verdict about the album — nothing is recorded, so the
    // next run asks again.
    expect(syncStatusStore.getState().notFoundAlbumIds).toEqual([]);
  });

  it('completes the run when the server says an album is gone', async () => {
    // Subsonic error 70. Before this, one album the server had deleted bailed the whole
    // walk, and `fullWalkPending` (cleared only on completion) made every later sync
    // re-walk the entire library and bail on the same album.
    mockGetAlbum.mockImplementation((id: string) =>
      Promise.resolve((id === 'al4' ? { status: 'not-found' } : mockAlbumOk(id)) as unknown),
    );
    onBasicServer();

    await runNormalizedLibrarySync({ full: true });

    expect(syncStatusStore.getState().songSyncStrategy).toBe('basic');
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
    expect(syncStatusStore.getState().fullWalkPending).toBe(false);
    // The other four albums' songs all landed; only the deleted album's are missing.
    expect(await countSongs(db())).toBe(8);
    expect(syncStatusStore.getState().notFoundAlbumIds).toEqual(['al4']);
  });

  it('stops asking about an album the server has already said is gone', async () => {
    mockGetAlbum.mockImplementation((id: string) => {
      if (id === 'al4') return Promise.resolve({ status: 'not-found' } as unknown);
      return Promise.resolve(mockAlbumOk(id, id === 'al3' ? [] : undefined) as unknown);
    });
    onBasicServer();

    await runNormalizedLibrarySync({ full: true });

    mockGetAlbum.mockClear();
    await runNormalizedLibrarySync();

    // al3 is still track-less on the server so the walk re-asks about it; al4 is not
    // re-asked, or a deleted album costs a request on every sync forever.
    expect(mockGetAlbum.mock.calls.map(([id]) => id)).toEqual(['al3']);
  });

  it('asks about a gone album again after the user forces a full resync', async () => {
    syncStatusStore.setState({ notFoundAlbumIds: ['al4'] });
    syncStatusStore.getState().resetSongSync();
    expect(syncStatusStore.getState().notFoundAlbumIds).toEqual([]);
  });
});

describe('the reap epoch', () => {
  /** Oldest stamp in a table, plus how many rows carry none. */
  const stamps = (table: 'albums' | 'songs') =>
    db().getFirstSync<{ oldest: number | null; unstamped: number }>(
      `SELECT MIN(synced_at) AS oldest, SUM(synced_at IS NULL) AS unstamped FROM ${table}`,
    );

  it('a completed full run mints an epoch no later than any row it wrote', async () => {
    expect(syncStatusStore.getState().fullResyncEpoch).toBeNull();

    await runNormalizedLibrarySync({ full: true });

    const epoch = syncStatusStore.getState().fullResyncEpoch;
    expect(epoch).toBeGreaterThan(0);
    // The invariant the reap deletes against: `WHERE synced_at < epoch` must not be able
    // to match anything this run wrote.
    for (const table of ['albums', 'songs'] as const) {
      expect(stamps(table)?.unstamped).toBe(0);
      expect(stamps(table)?.oldest).toBeGreaterThanOrEqual(epoch!);
    }
  });

  it('mints nothing when the album phase never completes', async () => {
    mockSearchAlbumsPage.mockImplementation(() => Promise.reject(new Error('boom')));

    await runNormalizedLibrarySync({ full: true });

    expect(syncStatusStore.getState().librarySyncComplete).toBe(false);
    expect(syncStatusStore.getState().fullResyncEpoch).toBeNull();
  });

  it('mints nothing when the song walk bails on a transport error', async () => {
    syncStatusStore.setState({ syncStrategy: 'basic' });
    mockGetAlbum.mockImplementation((id: string) =>
      Promise.resolve((id === 'al3' ? { status: 'failed' } : mockAlbumOk(id)) as unknown),
    );

    await runNormalizedLibrarySync({ full: true });

    // The ALBUM half completed; the gate is both halves, so that is not enough.
    expect(syncStatusStore.getState().librarySyncComplete).toBe(true);
    expect(syncStatusStore.getState().songSyncComplete).toBe(false);
    expect(syncStatusStore.getState().fullResyncEpoch).toBeNull();
  });

  it('mints nothing when an interrupted full run is finished by a non-full resume', async () => {
    // Interrupt the full run mid-album-list: the API vanishes, every page fn resolves []
    // and the loop bails without marking anything complete.
    mockSearchAlbumsPage.mockImplementation((count: number, offset: number) => {
      if (offset >= 2) {
        mockApi = null;
        return Promise.resolve([]);
      }
      return Promise.resolve(mockAlbumsData.slice(offset, offset + count));
    });
    await runNormalizedLibrarySync({ full: true });
    expect(syncStatusStore.getState().librarySyncComplete).toBe(false);
    // `resetSongSync` persisted this, so the resume below still re-walks every song.
    expect(syncStatusStore.getState().fullWalkPending).toBe(true);
    expect(syncStatusStore.getState().fullResyncEpoch).toBeNull();

    mockApi = {};
    mockSearchAlbumsPage.mockImplementation((count: number, offset: number) =>
      Promise.resolve(mockAlbumsData.slice(offset, offset + count)),
    );
    await runNormalizedLibrarySync({ reason: 'resume-button' });

    // It re-enumerated everything and reached BOTH markers — and still mints nothing. A
    // resumed run starts from the persisted cursors, so nothing proves it saw the whole
    // library. `fullSyncCompletedAt` is stamped here, which is exactly why it cannot be
    // the gate.
    expect(syncStatusStore.getState().librarySyncComplete).toBe(true);
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
    expect(await countSongs(db())).toBe(10);
    expect(syncStatusStore.getState().fullSyncCompletedAt).toBeGreaterThan(0);
    expect(syncStatusStore.getState().fullResyncEpoch).toBeNull();
  });

  it('an incremental run neither mints nor refreshes an epoch', async () => {
    await runNormalizedLibrarySync({ full: true });
    const earned = syncStatusStore.getState().fullResyncEpoch;
    expect(earned).toBeGreaterThan(0);

    await runNormalizedLibrarySync({ reason: 'pull-to-refresh' });

    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
    expect(syncStatusStore.getState().fullResyncEpoch).toBe(earned);
  });
});

describe('playlist detail reconcile', () => {
  const pl = (id: string, changed: string, songCount: number) =>
    ({ id, name: id, changed, songCount }) as unknown as Record<string, unknown>;
  const marker = (id: string) =>
    db().getFirstSync<{ c: number | null; n: number | null }>(
      `SELECT detail_changed AS c, detail_song_count AS n FROM playlists WHERE id = '${id}'`,
    );

  it('fetches a playlist whose membership was never fetched', async () => {
    mockPlaylists = [pl('p1', '2024-01-01T00:00:00Z', 3)];
    await runNormalizedLibrarySync({ full: true });
    await flush();
    expect(mockFetchPlaylistDetail).toHaveBeenCalledWith('p1');
    // Marker stamped from the LIST envelope, so the next pass skips it.
    expect(marker('p1')?.n).toBe(3);
  });

  it('skips a playlist that has not changed since its last detail fetch', async () => {
    mockPlaylists = [pl('p1', '2024-01-01T00:00:00Z', 3)];
    await runNormalizedLibrarySync({ full: true });
    await flush();
    // mockReset, not mockClear: one test overrides the implementation to drop the API
  // mid-fetch, and mockClear leaves that in place for the next test.
  mockFetchPlaylistDetail.mockReset();
  mockFetchPlaylistDetail.mockImplementation((id: string) =>
    Promise.resolve({ id, entry: [] } as unknown),
  );

    await runNormalizedLibrarySync();
    await flush();
    expect(mockFetchPlaylistDetail).not.toHaveBeenCalled();
  });

  it('refetches when the server reports a changed track count', async () => {
    mockPlaylists = [pl('p1', '2024-01-01T00:00:00Z', 3)];
    await runNormalizedLibrarySync({ full: true });
    await flush();
    // mockReset, not mockClear: one test overrides the implementation to drop the API
  // mid-fetch, and mockClear leaves that in place for the next test.
  mockFetchPlaylistDetail.mockReset();
  mockFetchPlaylistDetail.mockImplementation((id: string) =>
    Promise.resolve({ id, entry: [] } as unknown),
  );

    mockPlaylists = [pl('p1', '2024-01-01T00:00:00Z', 4)];
    await runNormalizedLibrarySync();
    await flush();
    expect(mockFetchPlaylistDetail).toHaveBeenCalledWith('p1');
  });

  it('does not stamp the marker when the fetch found no server', async () => {
    // fetchPlaylistDetail returns LOCAL data on its offline branch, so a non-null
    // result is not proof the server answered — stamping it would suppress the
    // refetch permanently for exactly the playlists that needed it.
    mockPlaylists = [pl('p1', '2024-01-01T00:00:00Z', 3)];
    mockFetchPlaylistDetail.mockImplementation((id: string) => {
      mockApi = null; // API vanishes mid-fetch
      return Promise.resolve({ id, entry: [] } as unknown);
    });
    await runNormalizedLibrarySync({ full: true });
    await flush();
    expect(marker('p1')?.c).toBeNull();
  });

  it('clears the markers on a full resync so membership is re-fetched', async () => {
    mockPlaylists = [pl('p1', '2024-01-01T00:00:00Z', 3)];
    await runNormalizedLibrarySync({ full: true });
    await flush();
    expect(marker('p1')?.n).toBe(3);
    // mockReset, not mockClear: one test overrides the implementation to drop the API
  // mid-fetch, and mockClear leaves that in place for the next test.
  mockFetchPlaylistDetail.mockReset();
  mockFetchPlaylistDetail.mockImplementation((id: string) =>
    Promise.resolve({ id, entry: [] } as unknown),
  );

    // A full resync overwrites rows in place, so without clearing, the markers would
    // survive and the one manual repair the UI offers would skip every playlist.
    await runNormalizedLibrarySync({ full: true });
    await flush();
    expect(mockFetchPlaylistDetail).toHaveBeenCalledWith('p1');
  });
});

describe('runNormalizedLibrarySync — forced legacy transport', () => {
  // The probe mock always answers true (fast path available), so any run that takes
  // the walk here did so because the user override said to.
  it('takes the walk even though the probe reports the fast path', async () => {
    syncStatusStore.setState({ forceLegacySync: true, syncStrategy: null });

    await runNormalizedLibrarySync({ full: true });

    expect(syncStatusStore.getState().songSyncStrategy).toBe('basic');
    expect(mockSearchSongsPage).not.toHaveBeenCalled();
  });

  it('overrides a persisted fast-path strategy', async () => {
    // The resume value would otherwise route the run straight back onto search3.
    syncStatusStore.setState({ forceLegacySync: true, syncStrategy: 'search3' });

    await runNormalizedLibrarySync({ full: true });

    expect(syncStatusStore.getState().songSyncStrategy).toBe('basic');
    expect(mockSearchSongsPage).not.toHaveBeenCalled();
  });

  it('does not persist the forced transport as the probed strategy', async () => {
    // `syncStrategy` means "what the probe found". Writing 'basic' into it would
    // survive the user turning the override back off.
    syncStatusStore.setState({ forceLegacySync: true, syncStrategy: null });

    await runNormalizedLibrarySync({ full: true });

    expect(syncStatusStore.getState().syncStrategy).toBeNull();
  });

  it('returns to the probed fast path once the override is cleared', async () => {
    syncStatusStore.setState({ forceLegacySync: true, syncStrategy: null });
    await runNormalizedLibrarySync({ full: true });
    expect(syncStatusStore.getState().songSyncStrategy).toBe('basic');

    syncStatusStore.getState().setForceLegacySync(false);
    await runNormalizedLibrarySync({ full: true });

    expect(syncStatusStore.getState().songSyncStrategy).toBe('search3');
  });
});

describe('setForceLegacySync — clears the derived transports', () => {
  it('drops both strategies on each edge so the next sync re-derives', () => {
    syncStatusStore.setState({ syncStrategy: 'search3', songSyncStrategy: 'search3' });

    syncStatusStore.getState().setForceLegacySync(true);

    expect(syncStatusStore.getState().forceLegacySync).toBe(true);
    expect(syncStatusStore.getState().syncStrategy).toBeNull();
    expect(syncStatusStore.getState().songSyncStrategy).toBeNull();
  });
});

describe('album transport fallback — cursor tagging and routing', () => {
  it('discards a cursor left by the OTHER transport on entry', () => {
    // A search3 offset does not index getAlbumList2. Resuming one against the other
    // silently skips every album below it.
    syncStatusStore.setState({ librarySyncCursor: 90000, librarySyncCursorTransport: 'search3' });

    syncStatusStore.getState().startAlbumPhase('basic');

    expect(syncStatusStore.getState().librarySyncCursor).toBe(0);
    expect(syncStatusStore.getState().librarySyncCursorTransport).toBe('basic');
    expect(syncStatusStore.getState().albumSyncStrategy).toBe('basic');
  });

  it('keeps the cursor when the transport matches, so a resume resumes', () => {
    syncStatusStore.setState({ librarySyncCursor: 90000, librarySyncCursorTransport: 'search3' });

    syncStatusStore.getState().startAlbumPhase('search3');

    expect(syncStatusStore.getState().librarySyncCursor).toBe(90000);
  });

  it('does not carry a chosen transport past a completed album phase', () => {
    // Otherwise one legacy run pins the slow path forever with nothing to re-probe it.
    syncStatusStore.setState({ albumSyncStrategy: 'basic' });

    syncStatusStore.getState().markLibrarySyncComplete();

    expect(syncStatusStore.getState().albumSyncStrategy).toBeNull();
  });

  it('clears the album transport when the legacy override is toggled', () => {
    syncStatusStore.setState({ albumSyncStrategy: 'basic', librarySyncCursor: 5000 });

    syncStatusStore.getState().setForceLegacySync(true);

    expect(syncStatusStore.getState().albumSyncStrategy).toBeNull();
    // The cursor is deliberately left alone — its transport tag makes it self-invalidating
    // at the next phase entry, and clearing it here would race a running loop's page write.
    expect(syncStatusStore.getState().librarySyncCursor).toBe(5000);
  });

  it('routes a resumed run onto the per-album list the previous run fell back to', async () => {
    // Without this the resume restarts the fast path, hits whatever stopped it, and
    // re-walks the whole library again.
    syncStatusStore.setState({
      syncStrategy: 'search3',
      albumSyncStrategy: 'basic',
      librarySyncCursor: 0,
      librarySyncCursorTransport: 'basic',
    });

    mockSearchAlbumsPage.mockClear();

    await runNormalizedLibrarySync({});

    // The album phase never touches search3 — it stays on the list the fallback chose.
    // (The SONG phase keeps its own transport; an album fallback does not imply one.)
    expect(mockSearchAlbumsPage).not.toHaveBeenCalled();
  });
});

describe('repeated-page guards', () => {
  it('treats a repeated album page as the end of results, not a transport failure', async () => {
    // No server in reference/ repeats a page — this is a bare loop backstop, so it ENDS
    // rather than re-walking the library on the other transport. That restart is what
    // turned a 99%-complete fast path into a full second enumeration in the field.
    syncStatusStore.setState({ syncStrategy: 'search3', albumSyncStrategy: null });
    __setPageSizesForTest({ album: 2, song: 10, basic: 2 });
    const firstPage = mockAlbumsData.slice(0, 2);
    mockSearchAlbumsPage.mockImplementation(() => Promise.resolve(firstPage));

    mockGetAlbumsPageByName.mockClear();

    await runNormalizedLibrarySync({});

    expect(mockGetAlbumsPageByName).not.toHaveBeenCalled();
    expect(syncStatusStore.getState().librarySyncCursorTransport).toBe('search3');
  });


  it('does not fire the album guard on the FIRST page of a resumed run', async () => {
    // `prevFirstId === null` is what protects the first page — not an offset test.
    // A resumed run starts with a NON-ZERO offset, so an offset test would miss this.
    syncStatusStore.setState({
      syncStrategy: 'search3',
      albumSyncStrategy: null,
      librarySyncCursor: 2,
      librarySyncCursorTransport: 'search3',
    });
    let call = 0;
    mockSearchAlbumsPage.mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? mockAlbumsData.slice(2, 4) : []);
    });

    await runNormalizedLibrarySync({});

    expect(syncStatusStore.getState().albumSyncStrategy).not.toBe('basic');
  });

  it('falls back to the per-album walk when search3 repeats its first SONG', async () => {
    // Same server behaviour on the song endpoint is an unbounded loop: every page is
    // non-empty, the upserts are idempotent, and nothing ever terminates it.
    syncStatusStore.setState({ syncStrategy: 'search3', songSyncStrategy: null });
    __setPageSizesForTest({ album: 5, song: 2, basic: 5 });
    const songs = mockSongsData.slice(0, 2);
    mockSearchSongsPage.mockImplementation(() => Promise.resolve(songs));

    await runNormalizedLibrarySync({});

    expect(syncStatusStore.getState().songSyncStrategy).toBe('basic');
  });

  it('does not fire the song guard on the FIRST page of a resumed run', async () => {
    syncStatusStore.setState({ syncStrategy: 'search3', songSyncStrategy: null, songSyncCursor: 2 });
    let call = 0;
    mockSearchSongsPage.mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? mockSongsData.slice(2, 4) : []);
    });

    await runNormalizedLibrarySync({});

    expect(syncStatusStore.getState().songSyncStrategy).not.toBe('basic');
  });
});

describe('the paging contract: request N at an offset, a short reply is the end', () => {
  /** A conformant server: it returns at most `count` rows starting at `offset`, and past
   *  the end it returns none. This is the whole of the paging contract — `albumOffset`
   *  and `songOffset` are documented as "used for paging", and every implementation in
   *  reference/ is a plain LIMIT/OFFSET over it. No total count is exposed, so a reply
   *  shorter than the count asked for is the only end-of-results signal there is. */
  const conformant = (rows: number) => (count: number, offset: number) =>
    Promise.resolve(
      Array.from({ length: rows }, (_, i) => ({
        id: `al${i}`,
        name: `Album ${i}`,
        created: new Date('2020-01-01'),
        duration: 100,
        songCount: 0,
      })).slice(offset, offset + count) as unknown as AlbumID3[],
    );

  it('pages by offset, stepping by the count it asked for', async () => {
    __setPageSizesForTest({ album: 5, song: 10, basic: 5 });
    syncStatusStore.setState({ syncStrategy: 'search3' });
    mockSearchAlbumsPage.mockImplementation(conformant(12));
    mockSearchSongsPage.mockImplementation(() => Promise.resolve([]));

    await runNormalizedLibrarySync({});

    // 12 albums, 5 at a time: full, full, then a short page of 2 that ends it.
    expect(mockSearchAlbumsPage.mock.calls.map(([, offset]) => offset)).toEqual([0, 5, 10]);
    expect(await countAlbums(db())).toBe(12);
    expect(syncStatusStore.getState().librarySyncComplete).toBe(true);
  });

  it('stores the short final page before ending on it', async () => {
    // The short page is still a page of albums. Ending on it without the upsert loses
    // the tail of the library — up to one page short of complete, marked complete.
    __setPageSizesForTest({ album: 5, song: 10, basic: 5 });
    syncStatusStore.setState({ syncStrategy: 'search3' });
    mockSearchAlbumsPage.mockImplementation(conformant(7));
    mockSearchSongsPage.mockImplementation(() => Promise.resolve([]));

    await runNormalizedLibrarySync({});

    expect(await countAlbums(db())).toBe(7);
  });

  it('records the true album total, not the offset it advanced to', async () => {
    // The cursor IS the progress number the sync card and banner read. Left at the value
    // it stepped to, a 5-per-page walk over 12 albums would report 15.
    __setPageSizesForTest({ album: 5, song: 10, basic: 5 });
    syncStatusStore.setState({ syncStrategy: 'search3' });
    mockSearchAlbumsPage.mockImplementation(conformant(12));
    mockSearchSongsPage.mockImplementation(() => Promise.resolve([]));

    await runNormalizedLibrarySync({});

    expect(syncStatusStore.getState().librarySyncCursor).toBe(12);
  });

  it('walks a library that is an exact multiple of the page size', async () => {
    // The one case with no short page. The walk can only learn it is done from the empty
    // page past the end — so that page must be requested, and read as the end.
    __setPageSizesForTest({ album: 5, song: 10, basic: 5 });
    syncStatusStore.setState({ syncStrategy: 'search3' });

    await runNormalizedLibrarySync({});

    expect(await countAlbums(db())).toBe(5);
    expect(mockSearchAlbumsPage.mock.calls.map(([, offset]) => offset)).toContain(5);
    expect(syncStatusStore.getState().librarySyncComplete).toBe(true);
  });

  it('asks for full-size pages on the fast path and spec-capped pages on the slow one', async () => {
    // 500 is the documented `getAlbumList2` ceiling and servers clamp to it; search3 has
    // no such cap, and halving its page size doubles the request count on a big library.
    __setPageSizesForTest();
    syncStatusStore.setState({ syncStrategy: 'search3' });
    await runNormalizedLibrarySync({});
    expect(mockSearchAlbumsPage.mock.calls[0][0]).toBe(1000);

    syncStatusStore.getState().resetLibrarySync();
    syncStatusStore.setState({ syncStrategy: 'basic', albumSyncStrategy: null });
    mockGetAlbumsPageByName.mockClear();
    await runNormalizedLibrarySync({});
    expect(mockGetAlbumsPageByName.mock.calls[0][0]).toBe(500);
  });
});

describe('the done log separates this run from what the DB happens to hold', () => {
  it('reports the walk\'s own counts alongside the row totals', async () => {
    // Rows survive every resync, so on a server whose fast-path enumeration is short of
    // its real library the totals keep whatever an earlier run reached. Reporting only
    // the totals reads as "this run fetched everything" when it did not.
    __setPageSizesForTest({ album: 5, song: 10, basic: 5 });
    syncStatusStore.setState({ syncStrategy: 'search3' });
    // Stand in for a previous run that reached further than this one will.
    await upsertAlbums(db(), [
      { id: 'old1', name: 'Older 1', created: new Date('2019-01-01'), duration: 1, songCount: 0 },
      { id: 'old2', name: 'Older 2', created: new Date('2019-01-01'), duration: 1, songCount: 0 },
    ] as unknown as AlbumID3[], undefined, []);
    const logged: unknown[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      if (args[0] === '[normalized-sync] done') logged.push(args[1]);
    });

    await runNormalizedLibrarySync({});
    spy.mockRestore();

    expect(logged).toHaveLength(1);
    const done = logged[0] as {
      albums: number; albumsThisRun: number; songsThisRun: number;
      songMs: number; songsPerSec: number;
    };
    expect(done.albums).toBe(7); // 5 walked + the 2 already held
    expect(done.albumsThisRun).toBe(5); // what this run actually enumerated
    expect(done.songsThisRun).toBe(10);
    // The throughput figure follows this run too. Derived from the row total it would
    // rate songs the run never fetched.
    expect(done.songsPerSec).toBe(
      done.songMs > 0 ? Math.round(done.songsThisRun / (done.songMs / 1000)) : 0,
    );
  });

});

describe('one retry, then pause with a reason', () => {
  it('retries a failed album page once and carries on when the retry succeeds', async () => {
    // Transient failures are the common case — a dropped request must not cost the user
    // a paused sync and a manual resume.
    let calls = 0;
    mockSearchAlbumsPage.mockImplementation((count: number, offset: number) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('ECONNRESET'));
      return Promise.resolve(mockAlbumsData.slice(offset, offset + count));
    });

    await runNormalizedLibrarySync({});

    expect(await countAlbums(db())).toBe(5);
    expect(syncStatusStore.getState().librarySyncComplete).toBe(true);
    expect(syncStatusStore.getState().librarySyncPhase).not.toBe('paused-error');
  });

  it('retries a failed song page once and carries on when the retry succeeds', async () => {
    let calls = 0;
    mockSearchSongsPage.mockImplementation((count: number, offset: number) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('ETIMEDOUT'));
      return Promise.resolve(mockSongsData.slice(offset, offset + count));
    });

    await runNormalizedLibrarySync({});

    expect(await countSongs(db())).toBe(10);
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
  });

  it('pauses the SONG phase with its reason when the retry fails too', async () => {
    mockSearchSongsPage.mockImplementation(() => Promise.reject(new Error('503 Service Unavailable')));

    await runNormalizedLibrarySync({});

    const st = syncStatusStore.getState();
    expect(st.detailSyncPhase).toBe('paused-error');
    expect(st.lastSyncError).toContain('503');
    // The album phase ran to completion before it — a song failure must not discard that.
    expect(st.librarySyncComplete).toBe(true);
  });

  it('keeps the cursor where it paused, so resuming does not re-walk the library', async () => {
    __setPageSizesForTest({ album: 5, song: 10, basic: 5 });
    syncStatusStore.setState({ syncStrategy: 'search3' });
    mockSearchAlbumsPage.mockImplementation((count: number, offset: number) =>
      (offset === 0
        ? Promise.resolve(mockAlbumsData.slice(0, count))
        : Promise.reject(new Error('boom'))),
    );

    await runNormalizedLibrarySync({});

    expect(syncStatusStore.getState().librarySyncCursor).toBe(5);
    expect(syncStatusStore.getState().librarySyncCursorTransport).toBe('search3');
  });
});

describe('escaping a pinned slow path', () => {
  it('a full resync clears the album fallback so the fast path is re-probed', () => {
    // Without this a runtime fallback pins the per-album list across every restart,
    // and Restart is the only control the user has — so it must be the way out.
    syncStatusStore.setState({
      syncStrategy: 'search3',
      albumSyncStrategy: 'basic',
      librarySyncCursorTransport: 'basic',
      librarySyncCursor: 40000,
      librarySyncComplete: false,
    });

    syncStatusStore.getState().resetLibrarySync();

    expect(syncStatusStore.getState().albumSyncStrategy).toBeNull();
    expect(syncStatusStore.getState().librarySyncCursorTransport).toBeNull();
    expect(syncStatusStore.getState().librarySyncCursor).toBe(0);
  });

  it('keeps the last completed sync timestamp while a new sync runs', () => {
    syncStatusStore.setState({ fullSyncCompletedAt: 5555 });

    syncStatusStore.getState().resetLibrarySync();
    syncStatusStore.getState().resetSongSync();

    expect(syncStatusStore.getState().fullSyncCompletedAt).toBe(5555);
  });
});


/** A page fetch the test resolves or rejects by hand. */
const heldPage = () => {
  let release: (page: AlbumID3[]) => void = () => undefined;
  let fail: (e: Error) => void = () => undefined;
  const promise = new Promise<AlbumID3[]>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release: (page: AlbumID3[]) => release(page), fail: (e: Error) => fail(e) };
};

describe('a logout while the sync runs', () => {
  // Logout bumps the generation and does not wait for the run: a fetch can hang, since
  // OkHttp has no timeouts. Nothing the old run fetched may then be written.
  const logout = () => syncStatusStore.getState().bumpGeneration();

  it('writes nothing from an album page that returns after the bump', async () => {
    const held = heldPage();
    mockSearchAlbumsPage.mockImplementationOnce(() => held.promise);

    const run = runNormalizedLibrarySync({ reason: 'test' });
    await flush();
    logout();
    held.release(mockAlbumsData);
    await run;

    expect(await countAlbums(db())).toBe(0);
    expect(syncStatusStore.getState().librarySyncCursor).toBe(0);
  });

  it('does not persist an error pause for a fetch that failed after the bump', async () => {
    // A persisted `paused-error` makes the next session's startup skip the sync.
    mockSearchAlbumsPage.mockImplementation(() => {
      logout();
      return Promise.reject(new Error('boom'));
    });

    await runNormalizedLibrarySync({ reason: 'test' });

    expect(syncStatusStore.getState().librarySyncPhase).not.toBe('paused-error');
    expect(syncStatusStore.getState().lastSyncError).toBeFalsy();
  });

  it('does not write the album cursor when the bump lands during the upsert', async () => {
    const spy = jest.spyOn(albumsRepo, 'upsertAlbums').mockImplementationOnce(async (...args) => {
      const written = await upsertAlbums(...args);
      logout();
      return written;
    });

    await runNormalizedLibrarySync({ reason: 'test' });

    expect(syncStatusStore.getState().librarySyncCursor).toBe(0);
    spy.mockRestore();
  });

  it('does not write the song cursor when the bump lands during the upsert', async () => {
    const real = songsRepo.upsertSongs;
    const spy = jest.spyOn(songsRepo, 'upsertSongs').mockImplementationOnce(async (...args) => {
      const written = await real(...args);
      logout();
      return written;
    });

    await runNormalizedLibrarySync({ reason: 'test' });

    expect(syncStatusStore.getState().songSyncCursor).toBe(0);
    spy.mockRestore();
  });

  it('lets the next session sync while the old run is still stuck in a fetch', async () => {
    mockSearchAlbumsPage.mockImplementationOnce(() => new Promise<AlbumID3[]>(() => undefined));
    void runNormalizedLibrarySync({ reason: 'old session' });
    await flush();

    logout();
    releaseLibrarySyncQueue();
    await runNormalizedLibrarySync({ reason: 'new session' });

    expect(await countAlbums(db())).toBe(5);
  });

  it('a run queued before the logout does nothing once it starts', async () => {
    const held = heldPage();
    mockSearchAlbumsPage.mockImplementationOnce(() => held.promise);
    const first = runNormalizedLibrarySync({ reason: 'test' });
    await flush();
    // Queued behind the first: a full run never joins a non-full one.
    const queued = runNormalizedLibrarySync({ full: true, reason: 'test' });
    const resetLibrarySync = jest.fn();
    syncStatusStore.setState({ resetLibrarySync });

    logout();
    releaseLibrarySyncQueue();
    held.release(mockAlbumsData);
    await first;
    await queued;

    expect(mockSearchAlbumsPage).toHaveBeenCalledTimes(1);
    expect(resetLibrarySync).not.toHaveBeenCalled();
    expect(await countAlbums(db())).toBe(0);
    expect(syncStatusStore.getState().librarySyncCursor).toBe(0);
  });
});
