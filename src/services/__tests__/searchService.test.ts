jest.mock('../subsonicService');
jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));
jest.mock('../imageCacheService', () => ({
  ensureCached: jest.fn().mockResolvedValue(undefined),
  prefetchCoverArt: jest.fn(),
}));
// The full-library candidate layer is the repository search module. Mock it so the
// routing / ranking / result-mapping logic under test is isolated from the candidate
// SQL (which has its own real-DB tests in repository.test.ts). The OFFLINE path reads
// the REAL repository/albums + repository/playlists against the seeded better-sqlite3
// DB (those modules are NOT mocked).
jest.mock('../../db/repository/search');

import { ensureCoverArtAuth, search3 } from '../subsonicService';
import { musicCacheStore } from '../../store/musicCacheStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import { syncStatusStore } from '../../store/syncStatusStore';
import { connectivityStore } from '../../store/connectivityStore';
import { getDb } from '../../store/persistence/db';
import { ensureNormalizedSchema } from '../../db/createNormalizedTables';
import { upsertAlbums } from '../../db/repository/albums';
import { upsertPlaylists } from '../../db/repository/playlists';
import { hasLocalCorpus, searchAlbums, searchArtists, searchSongs } from '../../db/repository/search';
import {
  performOnlineSearch,
  performOfflineSearch,
  getOfflineSongsByGenre,
  getOfflineGenresPresent,
  getOfflineSongsAll,
  searchLibrary,
  findAlbum,
  findArtistSongs,
} from '../searchService';

const mockSearch3 = search3 as jest.MockedFunction<typeof search3>;
const mockEnsureCoverArtAuth = ensureCoverArtAuth as jest.MockedFunction<typeof ensureCoverArtAuth>;
const mockSearchSongs = searchSongs as jest.MockedFunction<typeof searchSongs>;
const mockSearchAlbums = searchAlbums as jest.MockedFunction<typeof searchAlbums>;
const mockSearchArtists = searchArtists as jest.MockedFunction<typeof searchArtists>;
const mockHasLocalCorpus = hasLocalCorpus as jest.MockedFunction<typeof hasLocalCorpus>;

const db = () => getDb()!;

/** Valid AlbumID3 for seeding the normalized `albums` table (offline path). */
const albumFixture = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, created: new Date('2020-01-01'), duration: 100, songCount: 10, ...extra }) as never;
/** Valid Playlist for seeding the normalized `playlists` table (offline path). */
const playlistFixture = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name,
    created: new Date('2020-01-01'),
    changed: new Date('2020-01-01'),
    duration: 1000,
    songCount: 5,
    ...extra,
  }) as never;

function resetStores() {
  musicCacheStore.setState({ cachedItems: {}, cachedSongs: {} } as any);
}

/**
 * Seed `musicCacheStore` from a compact {itemId: {name, tracks: [...]}}
 * description. A track's fields land verbatim on the row as PROMOTED COLUMNS —
 * the post-conversion shape every hydrated row has — which is what
 * `getSongEnvelope()` reads at runtime.
 */
function seedCache(
  oldItems: Record<string, { name: string; tracks: any[] }>,
) {
  const cachedItems: Record<string, any> = {};
  const cachedSongs: Record<string, any> = {};
  for (const [itemId, item] of Object.entries(oldItems)) {
    const songIds: string[] = [];
    for (const t of item.tracks) {
      if (!t?.id) continue;
      if (!songIds.includes(t.id)) songIds.push(t.id);
      if (!cachedSongs[t.id]) {
        cachedSongs[t.id] = {
          ...t,
          albumId: t.albumId ?? itemId,
          srcAlbumId: t.albumId ?? itemId,
          duration: t.duration ?? 0,
        };
      }
    }
    cachedItems[itemId] = {
      itemId,
      name: item.name,
      songIds,
    };
  }
  musicCacheStore.setState({ cachedItems, cachedSongs } as any);
}

/**
 * A downloaded track with the promoted columns populated the way a real cached row
 * has them: the `src*` twins describe the SERVER's track, the same-named columns the
 * downloaded file. `album` is the song's own, which the parent item name overrides.
 */
const fullTrack = () => ({
  id: 't1', title: 'Shoegaze Anthem', artist: 'A', album: 'Real Album',
  albumId: 'server-album', coverArt: 'songcover', duration: 200,
  suffix: 'mp3', bitRate: 320,
  srcSuffix: 'flac', srcBitRate: 1000, srcBitDepth: 24, srcSamplingRate: 96000,
  size: 41_000_000, genres: ['Shoegaze'], genre: 'Shoegaze', track: 3, year: 1991,
  rgTrackGain: -6.5, rgAlbumPeak: 0.99,
});

/** The fields the song-details modal renders. */
function expectFullMetadata(song: any) {
  expect(song.suffix).toBe('flac');
  expect(song.bitRate).toBe(1000);
  expect(song.bitDepth).toBe(24);
  expect(song.samplingRate).toBe(96000);
  expect(song.size).toBe(41_000_000);
  expect(song.genres).toEqual(['Shoegaze']);
  expect(song.replayGain).toEqual({
    trackGain: -6.5, albumGain: undefined, trackPeak: undefined,
    albumPeak: 0.99, baseGain: undefined, fallbackGain: undefined,
  });
  expect(song.track).toBe(3);
  expect(song.year).toBe(1991);
  expect(song.albumId).toBe('server-album');
}

beforeAll(() => ensureNormalizedSchema(db()));

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  for (const t of ['albums', 'playlists', 'songs', 'artists']) db().runSync(`DELETE FROM ${t}`);
  // Auto-mocked candidate fns default to undefined; give them empty resolutions so
  // the ranking maps run. Individual tests override.
  mockSearchSongs.mockResolvedValue([]);
  mockSearchAlbums.mockResolvedValue([]);
  mockSearchArtists.mockResolvedValue([]);
  mockHasLocalCorpus.mockResolvedValue(true);
});

describe('performOnlineSearch', () => {
  it('calls ensureCoverArtAuth then search3', async () => {
    const results = {
      albums: [{ id: 'a1', name: 'Album' }],
      artists: [{ id: 'ar1', name: 'Artist' }],
      songs: [{ id: 's1', title: 'Song' }],
    };
    mockSearch3.mockResolvedValue(results as any);

    const result = await performOnlineSearch('test');

    expect(mockEnsureCoverArtAuth).toHaveBeenCalled();
    expect(mockSearch3).toHaveBeenCalledWith('test');
    expect(result).toEqual(results);
  });

  it('propagates errors from search3', async () => {
    mockSearch3.mockRejectedValue(new Error('Network error'));
    await expect(performOnlineSearch('test')).rejects.toThrow('Network error');
  });
});

describe('performOfflineSearch', () => {
  it('searches cached albums by name', async () => {
    seedCache({ a1: { name: 'Test Album', tracks: [] } });
    await upsertAlbums(db(), [albumFixture('a1', 'Test Album', { artist: 'Artist' })]);

    const result = await performOfflineSearch('test');

    expect(result.albums).toHaveLength(1);
    expect(result.albums[0].id).toBe('a1');
  });

  it('searches cached albums by artist name', async () => {
    seedCache({ a1: { name: 'Album', tracks: [] } });
    await upsertAlbums(db(), [albumFixture('a1', 'Album', { artist: 'Radiohead' })]);

    expect((await performOfflineSearch('radiohead')).albums).toHaveLength(1);
  });

  it('ranks several matching downloaded albums best-first', async () => {
    seedCache({ a1: { name: 'Greatest Hits', tracks: [] }, a2: { name: 'Greatest', tracks: [] } });
    await upsertAlbums(db(), [
      albumFixture('a1', 'Greatest Hits', { artist: 'Artist' }),
      albumFixture('a2', 'Greatest', { artist: 'Artist' }),
    ]);

    // The exact title wins over the one carrying extra words.
    expect((await performOfflineSearch('greatest')).albums.map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('ranks several matching downloaded playlists best-first', async () => {
    seedCache({ p1: { name: 'Road Trip Mix', tracks: [] }, p2: { name: 'Road Trip', tracks: [] } });
    await upsertPlaylists(db(), [
      playlistFixture('p1', 'Road Trip Mix'),
      playlistFixture('p2', 'Road Trip'),
    ]);

    expect((await performOfflineSearch('road trip')).albums.map((a) => a.id)).toEqual(['p2', 'p1']);
  });

  it('excludes non-cached albums', async () => {
    // Album exists in the library but is NOT downloaded (no cached item) → excluded.
    await upsertAlbums(db(), [albumFixture('a1', 'Test Album', { artist: 'Artist' })]);

    expect((await performOfflineSearch('test')).albums).toHaveLength(0);
  });

  it('includes cached playlists as album-shaped results', async () => {
    seedCache({ p1: { name: 'My Playlist', tracks: [] } });
    await upsertPlaylists(db(), [
      playlistFixture('p1', 'My Playlist', { owner: 'user', coverArt: 'c1' }),
    ]);

    expect((await performOfflineSearch('my')).albums.some((a) => a.id === 'p1')).toBe(true);
  });

  it('preserves the playlist owner on the album-shaped result artist line', async () => {
    seedCache({ p1: { name: 'My Playlist', tracks: [] } });
    await upsertPlaylists(db(), [playlistFixture('p1', 'My Playlist', { owner: 'dave' })]);

    const hit = (await performOfflineSearch('my')).albums.find((a) => a.id === 'p1');
    expect(hit?.artist).toBe('dave');
  });

  it('searches cached songs by title', async () => {
    seedCache({
      a1: {
        name: 'Album',
        tracks: [
          { id: 't1', title: 'Matching Song', artist: 'Artist', duration: 200 },
          { id: 't2', title: 'Other', artist: 'Nobody', duration: 180 },
        ],
      },
    });

    const result = await performOfflineSearch('matching');

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].title).toBe('Matching Song');
  });

  it('fuzzy: phonetic typo in artist ("corn") still finds Korn', async () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Freak on a Leash', artist: 'Korn', duration: 200 }] },
    });
    expect((await performOfflineSearch('corn')).songs.map((s) => s.id)).toContain('t1');
  });

  it('fuzzy: out-of-order tokens ("leash freak") match "Freak on a Leash"', async () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Freak on a Leash', artist: 'Korn', duration: 200 }] },
    });
    expect((await performOfflineSearch('leash freak')).songs.map((s) => s.id)).toContain('t1');
  });

  it('empty / whitespace query returns nothing (no match-everything)', async () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }] },
    });
    expect((await performOfflineSearch('   ')).songs).toHaveLength(0);
  });

  it('searches cached songs by artist', async () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'Radiohead', duration: 200 }] },
    });

    expect((await performOfflineSearch('radiohead')).songs).toHaveLength(1);
  });

  it('deduplicates songs by id across multiple cached items', async () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Dup Song', artist: 'A', duration: 200 }] },
      p1: { name: 'Playlist', tracks: [{ id: 't1', title: 'Dup Song', artist: 'A', duration: 200 }] },
    });

    expect((await performOfflineSearch('dup')).songs).toHaveLength(1);
  });

  it('populates albumId on returned songs so cover-art lookup resolves via entity ID', async () => {
    seedCache({
      a1: {
        name: 'Album',
        tracks: [{ id: 't1', title: 'Track', artist: 'A', duration: 200, albumId: 'parent-album' }],
      },
    });

    expect((await performOfflineSearch('track')).songs[0].albumId).toBe('parent-album');
  });

  it('populates album name from parent item', async () => {
    seedCache({
      a1: { name: 'Parent Item Name', tracks: [{ id: 't1', title: 'Track', artist: 'A', duration: 200 }] },
    });

    expect((await performOfflineSearch('track')).songs[0].album).toBe('Parent Item Name');
  });

  /* Hits must be a full `Child`, not a narrow projection, or the details modal has
   * nothing to render. They come off the promoted columns via `getSongEnvelope`. */
  it('carries the full downloaded metadata onto a hit', async () => {
    seedCache({ a1: { name: 'Album', tracks: [fullTrack()] } });

    const song = (await performOfflineSearch('shoegaze anthem')).songs[0];

    expectFullMetadata(song);
  });

  it('keeps the parent item name as `album` for a playlist-downloaded song', async () => {
    seedCache({ pl1: { name: 'Road Trip', tracks: [fullTrack()] } });

    const song = (await performOfflineSearch('shoegaze anthem')).songs[0];

    expect(song.album).toBe('Road Trip');
    expect(song.album).not.toBe('Real Album');
  });

  it('skips a songId whose cached row is gone', async () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Ghost Song', artist: 'A', duration: 200 }] },
    });
    const state = musicCacheStore.getState();
    musicCacheStore.setState({
      ...state,
      cachedItems: { ...state.cachedItems, a1: { ...state.cachedItems.a1, songIds: ['t99'] } },
    } as any);

    expect((await performOfflineSearch('ghost')).songs).toEqual([]);
  });

  /* The row snapshot is taken before the scan's yields, so a song deleted while the
   * scan is parked resolves from the snapshot but no longer has an envelope. */
  it('drops a song whose row is deleted mid-scan', async () => {
    // 1024 tracks so the scan yields exactly as it reaches the only matching one.
    const tracks = Array.from({ length: 1024 }, (_, i) => ({
      id: `t${i}`, title: i === 1023 ? 'Zephyr Quartet' : `Filler ${i}`, artist: 'A', duration: 200,
    }));
    seedCache({ a1: { name: 'Album', tracks } });

    expect((await performOfflineSearch('zephyr')).songs.map((s) => s.id)).toEqual(['t1023']);

    seedCache({ a1: { name: 'Album', tracks } });
    const wipeRows = () => {
      musicCacheStore.setState({ ...musicCacheStore.getState(), cachedSongs: {} } as any);
      return false; // not an abort — let the scan run on with the rows gone
    };

    expect((await performOfflineSearch('zephyr', wipeRows)).songs).toEqual([]);
  });

  it('always returns empty artists array', async () => {
    expect((await performOfflineSearch('anything')).artists).toEqual([]);
  });

  it('returns empty results for no matches', async () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'Artist', duration: 200 }] },
    });
    await upsertAlbums(db(), [albumFixture('a1', 'Album', { artist: 'Artist' })]);

    const result = await performOfflineSearch('zzzznotfound');
    expect(result.albums).toHaveLength(0);
    expect(result.songs).toHaveLength(0);
  });

  it('handles album with undefined artist gracefully', async () => {
    seedCache({ a1: { name: 'Album', tracks: [] } });
    await upsertAlbums(db(), [albumFixture('a1', 'Album')]);

    expect((await performOfflineSearch('someartist')).albums).toHaveLength(0);
  });
});

describe('getOfflineSongsByGenre', () => {
  it('returns cached songs matching genre (via genre field)', () => {
    seedCache({
      a1: {
        name: 'Album',
        tracks: [
          { id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' },
          { id: 't2', title: 'Other', artist: 'B', duration: 180, genre: 'Jazz' },
        ],
      },
    });

    const result = getOfflineSongsByGenre('Rock');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  it('matches genre case-insensitively', () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'ROCK' }] },
    });

    expect(getOfflineSongsByGenre('rock')).toHaveLength(1);
  });

  it('matches via genres array with {name} objects (OpenSubsonic)', () => {
    seedCache({
      a1: {
        name: 'Album',
        tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genres: [{ name: 'Electronic' }, { name: 'Ambient' }] }],
      },
    });

    expect(getOfflineSongsByGenre('ambient')).toHaveLength(1);
  });

  it('matches via genres array with plain strings (defensive)', () => {
    seedCache({
      a1: {
        name: 'Album',
        tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genres: ['Electronic', 'Ambient'] }],
      },
    });

    expect(getOfflineSongsByGenre('ambient')).toHaveLength(1);
  });

  it('only includes songs present in cachedSongs', () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Cached', artist: 'A', duration: 200, genre: 'Rock' }] },
    });
    // Stamp a stray songId onto the cached item that has no matching cachedSongs row.
    const state = musicCacheStore.getState();
    musicCacheStore.setState({
      ...state,
      cachedItems: {
        ...state.cachedItems,
        a1: { ...state.cachedItems.a1, songIds: ['t1', 't99'] },
      },
    } as any);

    const result = getOfflineSongsByGenre('Rock');
    expect(result.map((s) => s.id)).toEqual(['t1']);
  });

  it('deduplicates songs across multiple cached items', () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' }] },
      p1: { name: 'Playlist', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' }] },
    });

    expect(getOfflineSongsByGenre('Rock')).toHaveLength(1);
  });

  it('returns empty array when no songs match genre', () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' }] },
    });

    expect(getOfflineSongsByGenre('Classical')).toHaveLength(0);
  });

  it('returns empty array when no cached items', () => {
    expect(getOfflineSongsByGenre('Rock')).toHaveLength(0);
  });

  it('does not match songs without genre or genres field', () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }] },
    });

    expect(getOfflineSongsByGenre('Rock')).toHaveLength(0);
  });

  /* The genre-filtered mixes get the same full `Child` as the unfiltered ones. */
  it('carries the full downloaded metadata', () => {
    seedCache({ a1: { name: 'Album', tracks: [fullTrack()] } });

    expectFullMetadata(getOfflineSongsByGenre('shoegaze')[0]);
  });
});

/** The ONE pass the Tuned-In builder replaced N per-genre walks with. */
describe('getOfflineGenresPresent', () => {
  it('collects every genre in the offline library, lowercased', () => {
    seedCache({
      a1: {
        name: 'Album',
        tracks: [
          { id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' },
          {
            id: 't2',
            title: 'Other',
            artist: 'B',
            duration: 180,
            genres: [{ name: 'Electronic' }, { name: 'Ambient' }],
          },
        ],
      },
    });

    expect([...getOfflineGenresPresent()].sort()).toEqual(['ambient', 'electronic', 'rock']);
  });

  it('visits a song held by two items once', () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' }] },
      p1: { name: 'Playlist', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' }] },
    });

    expect([...getOfflineGenresPresent()]).toEqual(['rock']);
  });

  it('skips an edge whose song row is gone, and a song with no genre columns', () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' }] },
    });
    const state = musicCacheStore.getState();
    musicCacheStore.setState({
      ...state,
      cachedItems: {
        ...state.cachedItems,
        // `t99` has no `cachedSongs` row; `t-bare` has one with no genre columns.
        a1: { ...state.cachedItems.a1, songIds: ['t1', 't99', 't-bare'] },
      },
      cachedSongs: {
        ...state.cachedSongs,
        't-bare': { id: 't-bare', title: 'Bare', albumId: 'a1', duration: 1 },
      },
    } as any);

    expect([...getOfflineGenresPresent()]).toEqual(['rock']);
  });

  it('is empty when nothing is downloaded', () => {
    expect(getOfflineGenresPresent().size).toBe(0);
  });

  it('is empty when the downloaded songs carry no genre', () => {
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }] },
    });

    expect(getOfflineGenresPresent().size).toBe(0);
  });
});

describe('getOfflineSongsAll', () => {
  it('returns every downloaded song, genre or not, deduplicated across items', () => {
    seedCache({
      a1: {
        name: 'Album',
        tracks: [
          { id: 't1', title: 'Song', artist: 'A', duration: 200, genre: 'Rock' },
          { id: 't2', title: 'Other', artist: 'B', duration: 180 },
        ],
      },
      p1: { name: 'Playlist', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }] },
    });

    expect(getOfflineSongsAll().map((s) => s.id).sort()).toEqual(['t1', 't2']);
  });

  it('is empty when nothing is downloaded', () => {
    expect(getOfflineSongsAll()).toEqual([]);
  });

  it('skips a songId whose cached row is gone', () => {
    seedCache({ a1: { name: 'Album', tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }] } });
    const state = musicCacheStore.getState();
    musicCacheStore.setState({
      ...state,
      cachedItems: { ...state.cachedItems, a1: { ...state.cachedItems.a1, songIds: ['t1', 't99'] } },
    } as any);

    expect(getOfflineSongsAll().map((s) => s.id)).toEqual(['t1']);
  });

  /* Same full-`Child` requirement, on the path the Tuned In offline mixes read. */
  it('carries the full downloaded metadata', () => {
    seedCache({ a1: { name: 'Album', tracks: [fullTrack()] } });

    expectFullMetadata(getOfflineSongsAll()[0]);
  });

  it('keeps the parent item name as `album` for a playlist-downloaded song', () => {
    seedCache({ pl1: { name: 'Road Trip', tracks: [fullTrack()] } });

    const song = getOfflineSongsAll()[0];
    expect(song.album).toBe('Road Trip');
    expect(song.album).not.toBe('Real Album');
  });
});

describe('searchLibrary — data-state routing', () => {
  // Lean SongListRow shape — searchFullLibraryScored ranks r.title/r.artist and maps
  // the row to a Child via songListRowToChild.
  const localSong = (id: string, title = 'Test Song') =>
    ({ id, album_id: 'a1', title, artist: 'A', duration: 200 }) as any;

  beforeEach(() => {
    // Sane online + fully-synced + reachable defaults; each test overrides.
    offlineModeStore.setState({ offlineMode: false });
    syncStatusStore.setState({
      librarySyncComplete: true,
      songSyncComplete: true,
      alwaysUseServerSearch: false,
    });
    connectivityStore.setState({ hasConnection: true, isServerReachable: true });
  });

  it('empty query short-circuits to empty with no queries', async () => {
    const res = await searchLibrary('   ');
    expect(res).toEqual({ albums: [], artists: [], songs: [] });
    expect(mockHasLocalCorpus).not.toHaveBeenCalled();
    expect(mockSearch3).not.toHaveBeenCalled();
  });

  it('offlineMode ON → downloaded-only scan, never the full-library path or server', async () => {
    offlineModeStore.setState({ offlineMode: true });
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Freak on a Leash', artist: 'Korn', duration: 200 }] },
    });
    const res = await searchLibrary('freak on a leash');
    expect(res.songs.map((s) => s.id)).toContain('t1');
    expect(mockSearch3).not.toHaveBeenCalled();
    expect(mockSearchSongs).not.toHaveBeenCalled();
  });

  it('online + fully synced + confident local hit → local authoritative, no server', async () => {
    mockSearchSongs.mockResolvedValue([localSong('s1')]);
    const res = await searchLibrary('test song');
    expect(res.songs.map((s) => s.id)).toEqual(['s1']);
    expect(mockSearch3).not.toHaveBeenCalled();
  });

  it('returns matching ARTISTS from the synced artist library (search3 parity)', async () => {
    // Local search must not hardcode `artists: []` — "pearl" has to return the
    // Pearl Jam artist row, not just albums + songs.
    mockSearchArtists.mockResolvedValue([
      { id: 'ar1', name: 'Pearl Jam', album_count: 57, cover_art: null, sort_name: null, sort_title: 'pearl jam', starred: null, user_rating: null, artist_image_url: null, music_brainz_id: null },
      { id: 'ar2', name: 'Metallica', album_count: 12, cover_art: null, sort_name: null, sort_title: 'metallica', starred: null, user_rating: null, artist_image_url: null, music_brainz_id: null },
    ]);
    const res = await searchLibrary('pearl');
    expect(res.artists.map((a) => a.id)).toEqual(['ar1']);
    expect(mockSearch3).not.toHaveBeenCalled();
  });

  it('returns matching ALBUMS from the synced library, best-first', async () => {
    mockSearchAlbums.mockResolvedValue([
      { id: 'al2', name: 'Ten Again', display_artist: 'Pearl Jam' },
      { id: 'al1', name: 'Ten', display_artist: 'Pearl Jam' },
      { id: 'al9', name: 'Nothing Alike', display_artist: 'Nobody' },
    ] as any);
    const res = await searchLibrary('ten');
    expect(res.albums.map((a) => a.id)).toEqual(['al1', 'al2']);
    expect(res.albums[0].artist).toBe('Pearl Jam'); // mapped through albumListRowToAlbumID3
  });

  it('ranks several confidently-matching artists best-first', async () => {
    const artistRow = (id: string, name: string) =>
      ({ id, name, album_count: 1, cover_art: null, sort_name: null, sort_title: name.toLowerCase(), starred: null, user_rating: null, artist_image_url: null, music_brainz_id: null });
    mockSearchArtists.mockResolvedValue([
      artistRow('ar2', 'Pearl Jams'),
      artistRow('ar1', 'Pearl Jam'),
    ] as any);
    const res = await searchLibrary('pearl jam');
    expect(res.artists.map((a) => a.id)).toEqual(['ar1', 'ar2']);
  });

  it('a failing server call leaves the local results intact', async () => {
    // The server half is wrapped so a 500 / dropped connection mid-search degrades to
    // "local only" rather than failing the whole search.
    syncStatusStore.setState({ librarySyncComplete: false, songSyncComplete: false });
    mockSearchSongs.mockResolvedValue([localSong('loc')]);
    mockSearch3.mockRejectedValue(new Error('Network error'));
    const res = await searchLibrary('test song');
    expect(mockSearch3).toHaveBeenCalled();
    expect(res.songs.map((s) => s.id)).toEqual(['loc']);
  });

  it('online + fully synced + weak/empty local hit → local only, NEVER the server (no blocking)', async () => {
    mockSearchSongs.mockResolvedValue([]); // nothing local
    const res = await searchLibrary('test song');
    // Fully synced ⇒ local is complete; an interactive search must not block on
    // the network for a weak hit.
    expect(mockSearch3).not.toHaveBeenCalled();
    expect(res).toEqual({ albums: [], artists: [], songs: [] });
  });

  it('online + partially synced + reachable → local-first MERGED with server', async () => {
    syncStatusStore.setState({ librarySyncComplete: false, songSyncComplete: false });
    mockSearchSongs.mockResolvedValue([localSong('loc')]);
    mockSearch3.mockResolvedValue({ albums: [], artists: [], songs: [{ id: 'srv', title: 'Server' }] } as any);
    const res = await searchLibrary('test song');
    expect(mockSearch3).toHaveBeenCalled();
    expect(res.songs.map((s) => s.id)).toEqual(['loc', 'srv']); // local ranked first
  });

  it('online + partially synced → surfaces local via onLocalResults BEFORE merging the server', async () => {
    syncStatusStore.setState({ librarySyncComplete: false, songSyncComplete: false });
    mockSearchSongs.mockResolvedValue([localSong('loc')]);
    mockSearch3.mockResolvedValue({ albums: [], artists: [], songs: [{ id: 'srv', title: 'Server' }] } as any);
    const surfaced: string[][] = [];
    const res = await searchLibrary('test song', {
      onLocalResults: (r) => surfaced.push(r.songs.map((s) => s.id)),
    });
    expect(surfaced).toEqual([['loc']]); // local delivered first, before the server call
    expect(res.songs.map((s) => s.id)).toEqual(['loc', 'srv']);
  });

  it('online + partially synced + unreachable → local only, no server', async () => {
    syncStatusStore.setState({ librarySyncComplete: false, songSyncComplete: false });
    connectivityStore.setState({ hasConnection: false, isServerReachable: false });
    mockSearchSongs.mockResolvedValue([localSong('loc')]);
    const res = await searchLibrary('test song');
    expect(mockSearch3).not.toHaveBeenCalled();
    expect(res.songs.map((s) => s.id)).toEqual(['loc']);
  });

  it('online + no local corpus + reachable → straight to the server', async () => {
    mockHasLocalCorpus.mockResolvedValue(false);
    mockSearch3.mockResolvedValue({ albums: [], artists: [], songs: [{ id: 'srv', title: 'S' }] } as any);
    const res = await searchLibrary('anything');
    expect(mockSearch3).toHaveBeenCalled();
    expect(res.songs.map((s) => s.id)).toEqual(['srv']);
    expect(mockSearchSongs).not.toHaveBeenCalled();
  });

  it('online + no local corpus + unreachable → empty (no hang)', async () => {
    mockHasLocalCorpus.mockResolvedValue(false);
    connectivityStore.setState({ hasConnection: false, isServerReachable: false });
    const res = await searchLibrary('anything');
    expect(mockSearch3).not.toHaveBeenCalled();
    expect(res).toEqual({ albums: [], artists: [], songs: [] });
  });

  it('online + fully synced + alwaysUseServerSearch ON + reachable → surfaces local first, then merges server results', async () => {
    syncStatusStore.setState({
      librarySyncComplete: true,
      songSyncComplete: true,
      alwaysUseServerSearch: true,
    });
    mockSearchSongs.mockResolvedValue([localSong('loc')]);
    mockSearch3.mockResolvedValue({ albums: [], artists: [], songs: [{ id: 'srv', title: 'Server' }] } as any);
    const surfaced: string[][] = [];
    const res = await searchLibrary('test song', {
      onLocalResults: (r) => surfaced.push(r.songs.map((s) => s.id)),
    });
    expect(surfaced).toEqual([['loc']]);
    expect(mockSearch3).toHaveBeenCalledWith('test song');
    expect(res.songs.map((s) => s.id)).toEqual(['loc', 'srv']);
  });

  it('online + fully synced + alwaysUseServerSearch ON + unreachable → returns local without hitting server', async () => {
    syncStatusStore.setState({
      librarySyncComplete: true,
      songSyncComplete: true,
      alwaysUseServerSearch: true,
    });
    connectivityStore.setState({ hasConnection: false, isServerReachable: false });
    mockSearchSongs.mockResolvedValue([localSong('loc')]);
    const res = await searchLibrary('test song');
    expect(mockSearch3).not.toHaveBeenCalled();
    expect(res.songs.map((s) => s.id)).toEqual(['loc']);
  });

  it('offlineMode ON + alwaysUseServerSearch ON → downloaded-only scan, never the server', async () => {
    offlineModeStore.setState({ offlineMode: true });
    syncStatusStore.setState({ alwaysUseServerSearch: true });
    seedCache({
      a1: { name: 'Album', tracks: [{ id: 't1', title: 'Freak on a Leash', artist: 'Korn', duration: 200 }] },
    });
    const res = await searchLibrary('freak on a leash');
    expect(res.songs.map((s) => s.id)).toContain('t1');
    expect(mockSearch3).not.toHaveBeenCalled();
    expect(mockSearchSongs).not.toHaveBeenCalled();
  });
});

describe('findAlbum (voice album intent)', () => {
  // Lean AlbumListRow shape — findAlbum scores r.name/r.display_artist and maps the
  // winner to an AlbumID3 via albumListRowToAlbumID3.
  it('prefers the album by the given artist among same-named albums', async () => {
    mockSearchAlbums.mockResolvedValue([
      { id: 'a-x', name: 'Ten', display_artist: 'Somebody Else' },
      { id: 'a-pj', name: 'Ten', display_artist: 'Pearl Jam' },
    ] as any);
    // "Ten by Pearl Jam" must pick Pearl Jam's Ten, not the other "Ten".
    expect((await findAlbum('Ten', 'Pearl Jam'))?.id).toBe('a-pj');
  });

  it('returns null when there are no candidates', async () => {
    mockSearchAlbums.mockResolvedValue([]);
    expect(await findAlbum('Nonexistent', 'Nobody')).toBeNull();
  });

  it('matches on name alone when no artist is given', async () => {
    mockSearchAlbums.mockResolvedValue([{ id: 'a1', name: 'Ten', display_artist: 'Pearl Jam' }] as any);
    expect((await findAlbum('Ten'))?.id).toBe('a1');
  });

  it('picks the best of several surviving candidates, not the first', async () => {
    mockSearchAlbums.mockResolvedValue([
      { id: 'a-live', name: 'Ten Live', display_artist: 'Pearl Jam' },
      { id: 'a-ten', name: 'Ten', display_artist: 'Pearl Jam' },
    ] as any);
    expect((await findAlbum('Ten', 'Pearl Jam'))?.id).toBe('a-ten');
  });
});

describe('findArtistSongs (voice artist intent)', () => {
  beforeEach(() => {
    offlineModeStore.setState({ offlineMode: false });
    syncStatusStore.setState({ librarySyncComplete: true, songSyncComplete: true });
    connectivityStore.setState({ hasConnection: true, isServerReachable: true });
  });

  it('keeps songs whose ARTIST confidently matches, drops title-only noise', async () => {
    mockSearchSongs.mockResolvedValue([
      { id: 's1', album_id: 'a1', title: 'Blind', artist: 'Korn' },
      { id: 's2', album_id: 'a2', title: 'Korn Tribute', artist: 'Cover Band' },
    ] as any);
    const songs = await findArtistSongs('Korn');
    expect(songs.map((s) => s.id)).toEqual(['s1']);
  });
});
