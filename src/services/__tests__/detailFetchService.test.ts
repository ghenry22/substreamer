/**
 * Detail fetch: the ONE shared path the app screens, the download path and the
 * CarPlay/Android-Auto headless service all use. These cover the local-first
 * fallback — an unreachable server is not the same thing as the user asking to be
 * offline, and before the fallback existed a headless drill-down into an album or
 * playlist we already held locally resolved to an empty track list.
 */
import {
  fetchAlbumDetail,
  fetchArtistBase,
  fetchArtistBio,
  fetchArtistTopSongs,
  fetchPlaylistDetail,
} from '../detailFetchService';
import { getArtist } from '../subsonicService';
import { getArtistBase } from '../../db/repository/details';

const mockGetAlbum = jest.fn();
const mockGetPlaylist = jest.fn();
const mockGetTopSongs = jest.fn();
const mockSearchMbid = jest.fn();
const mockGetMbBio = jest.fn();
let mockIsVA = false;
jest.mock('../subsonicService', () => ({
  ensureCoverArtAuth: () => Promise.resolve(),
  getAlbum: (id: string) => mockGetAlbum(id),
  getPlaylist: (id: string) => mockGetPlaylist(id),
  getArtist: jest.fn(async (id: string) => ({ id, name: 'Artist' })),
  getArtistInfo2: jest.fn(async () => null),
  getTopSongs: (...a: unknown[]) => mockGetTopSongs(...a),
  getVariousArtistsBio: () => 'VA bio',
  isVariousArtists: () => mockIsVA,
  VARIOUS_ARTISTS_COVER_ART_ID: 'va',
}));
jest.mock('../musicbrainzService', () => ({
  getArtistBiography: (...a: unknown[]) => mockGetMbBio(...a),
  searchArtistMBID: (...a: unknown[]) => mockSearchMbid(...a),
}));
jest.mock('../imageCacheService', () => ({
  ensureCached: () => Promise.resolve(),
  prefetchCoverArt: jest.fn(),
}));

let mockOfflineMode = false;
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: { getState: () => ({ offlineMode: mockOfflineMode }) },
}));

const mockLocalAlbum = jest.fn();
const mockLocalPlaylist = jest.fn();
const mockLocalBio = jest.fn();
const mockLocalTop = jest.fn();
jest.mock('../../db/repository/details', () => ({
  getAlbumDetail: (_db: unknown, id: string) => mockLocalAlbum(id),
  getPlaylistDetail: (_db: unknown, id: string) => mockLocalPlaylist(id),
  getArtistBase: jest.fn(async (_db: unknown, id: string) => ({
    artist: { id, name: 'Artist' },
    albums: [],
  })),
  getArtistBioRow: (_db: unknown, id: string) => mockLocalBio(id),
  getArtistInfoRow: jest.fn(async () => null),
  getArtistTopSongsRow: (_db: unknown, id: string) => mockLocalTop(id),
}));

jest.mock('../../store/persistence/db', () => ({
  getDb: () => ({}),
}));
// Stores persisting through kvStorage (ratings) need a working adapter, not the stub DB.
jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

// The success path upserts into the normalized model; these tests are about which
// SOURCE wins, so stub the writes rather than standing up a real DB.
jest.mock('../../db/repository/albums', () => ({ upsertAlbums: () => Promise.resolve(0) }));
const mockDeleteAlbumSongsNotIn = jest.fn(() => Promise.resolve());
jest.mock('../../db/repository/songs', () => ({
  upsertSongs: () => Promise.resolve(0),
  deleteAlbumSongsNotIn: (...a: unknown[]) => mockDeleteAlbumSongsNotIn(...(a as [])),
}));
jest.mock('../../db/repository/playlists', () => ({
  upsertPlaylists: () => Promise.resolve(0),
  setPlaylistSongs: jest.fn(),
}));
const mockSetTopSongs = jest.fn();
const mockUpsertBio = jest.fn();
jest.mock('../../db/repository/artists', () => ({
  setArtistTopSongs: (...a: unknown[]) => mockSetTopSongs(...a),
  upsertArtistBio: (...a: unknown[]) => mockUpsertBio(...a),
  upsertArtistInfo: jest.fn(),
  upsertArtists: jest.fn(),
}));

beforeEach(() => {
  mockOfflineMode = false;
  mockGetAlbum.mockReset();
  mockGetPlaylist.mockReset();
  mockLocalAlbum.mockReset();
  mockLocalPlaylist.mockReset();
  mockGetTopSongs.mockReset();
  mockSearchMbid.mockReset();
  mockGetMbBio.mockReset();
  mockSetTopSongs.mockReset();
  mockUpsertBio.mockReset();
  mockLocalBio.mockReset().mockResolvedValue(null);
  mockLocalTop.mockReset().mockResolvedValue(null);
  mockDeleteAlbumSongsNotIn.mockClear();
  mockIsVA = false;
});

describe('fetchAlbumDetail — local first', () => {
  it('answers from the local database WITHOUT any server round trip', async () => {
    mockLocalAlbum.mockResolvedValue({
      album: { id: 'al1', name: 'Cached' },
      songs: [{ id: 's1' }, { id: 's2' }],
    });

    const result = await fetchAlbumDetail('al1', { prefetchCovers: false });

    expect(result?.song).toHaveLength(2);
    expect(result?.name).toBe('Cached');
    // The point of the local database: no pointless round trip when we have the data,
    // whether or not the server happens to be reachable.
    expect(mockGetAlbum).not.toHaveBeenCalled();
  });

  it('treats a row with no songs as a MISS and fetches', async () => {
    // The `albums` row exists for every album in the library after a list sync, so
    // "row present" is not "tracks present".
    mockLocalAlbum.mockResolvedValue({ album: { id: 'al1', name: 'Row only' }, songs: [] });
    mockGetAlbum.mockResolvedValue({ id: 'al1', name: 'Fetched', song: [{ id: 's9' }] });

    const result = await fetchAlbumDetail('al1', { prefetchCovers: false });

    expect(mockGetAlbum).toHaveBeenCalled();
    expect(result?.name).toBe('Fetched');
  });

  it('fetches an external album by ID when nothing is cached', async () => {
    const id = 'external-album-123';
    const song = { id: 'external-song-789' };
    mockLocalAlbum.mockResolvedValue(null);
    mockGetAlbum.mockResolvedValue({ id, name: 'Fetched', song: [song] });

    expect(await fetchAlbumDetail(id, { prefetchCovers: false })).toMatchObject({ id, song: [song] });
    expect(mockGetAlbum).toHaveBeenCalledWith(id);
  });

  it('hands the prune the response\'s own songCount so a truncated list cannot delete', async () => {
    // The prune is only safe against a self-consistent response — a `getAlbum` that
    // lists 1 of 12 tracks must not take the other 11 with it. This fires on ordinary
    // browsing, so the count has to reach the repository, not just exist there.
    mockLocalAlbum.mockResolvedValue(null);
    mockGetAlbum.mockResolvedValue({ id: 'al1', name: 'Short', songCount: 12, song: [{ id: 's9' }] });

    await fetchAlbumDetail('al1', { prefetchCovers: false });

    expect(mockDeleteAlbumSongsNotIn).toHaveBeenCalledWith({}, 'al1', ['s9'], 12);
  });

  it('force bypasses the cache, but still falls back to it when the server cannot answer', async () => {
    mockGetAlbum.mockResolvedValue({ id: 'al1', name: 'Fresh', song: [{ id: 's9' }] });
    mockLocalAlbum.mockResolvedValue({
      album: { id: 'al1', name: 'Stale' },
      songs: [{ id: 's1' }],
    });

    expect((await fetchAlbumDetail('al1', { prefetchCovers: false, force: true }))?.name)
      .toBe('Fresh');

    mockGetAlbum.mockResolvedValue(null);
    expect((await fetchAlbumDetail('al1', { prefetchCovers: false, force: true }))?.name)
      .toBe('Stale');
  });

  it('returns null when nothing is cached and the server cannot answer', async () => {
    mockGetAlbum.mockResolvedValue(null);
    mockLocalAlbum.mockResolvedValue(null);

    expect(await fetchAlbumDetail('al1', { prefetchCovers: false })).toBeNull();
  });

  it('does not touch the network in offline mode', async () => {
    mockOfflineMode = true;
    mockLocalAlbum.mockResolvedValue({ album: { id: 'al1', name: 'Cached' }, songs: [{ id: 's1' }] });

    const result = await fetchAlbumDetail('al1', { prefetchCovers: false });

    expect(mockGetAlbum).not.toHaveBeenCalled();
    expect(result?.song).toHaveLength(1);
  });
});

describe('fetchArtistBase — local first', () => {
  it('fetches an external artist by ID when nothing is cached', async () => {
    const id = 'external-artist-456';
    const album = { id: 'external-album-123', name: 'External album', duration: 200, songCount: 1 };
    jest.mocked(getArtistBase).mockResolvedValueOnce(null);
    jest.mocked(getArtist).mockResolvedValueOnce({ id, name: 'External artist', albumCount: 1, album: [album] });

    expect(await fetchArtistBase(id)).toMatchObject({ artist: { id }, albums: [album] });
    expect(getArtist).toHaveBeenCalledWith(id);
  });
});

describe('fetchPlaylistDetail — local first', () => {
  it('answers from the local database WITHOUT any server round trip', async () => {
    mockLocalPlaylist.mockResolvedValue({
      playlist: { id: 'p1', name: 'Cached' },
      entry: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
    });

    const result = await fetchPlaylistDetail('p1', { prefetchCovers: false });

    expect(result?.entry).toHaveLength(3);
    expect(result?.name).toBe('Cached');
    expect(mockGetPlaylist).not.toHaveBeenCalled();
  });

  it('force bypasses the cache, but still falls back to it when the server cannot answer', async () => {
    mockGetPlaylist.mockResolvedValue({ id: 'p1', name: 'Fresh', entry: [{ id: 's9' }] });
    mockLocalPlaylist.mockResolvedValue({
      playlist: { id: 'p1', name: 'Stale' },
      entry: [{ id: 's1' }],
    });

    expect((await fetchPlaylistDetail('p1', { prefetchCovers: false, force: true }))?.name)
      .toBe('Fresh');

    mockGetPlaylist.mockResolvedValue(null);
    expect((await fetchPlaylistDetail('p1', { prefetchCovers: false, force: true }))?.name)
      .toBe('Stale');
  });

  it('returns null when nothing is cached and the server cannot answer', async () => {
    mockGetPlaylist.mockResolvedValue(null);
    mockLocalPlaylist.mockResolvedValue(null);

    expect(await fetchPlaylistDetail('p1', { prefetchCovers: false })).toBeNull();
  });
});

describe('fetchArtistTopSongs', () => {
  it('does NOT stamp a presence marker when the call failed', async () => {
    // getTopSongs returns null for a failed call and [] for a genuine "none". Stamping
    // the former would leave a permanently empty section with no TTL to recover from.
    mockGetTopSongs.mockResolvedValue(null);
    await fetchArtistTopSongs('ar1', { prefetchCovers: false });
    expect(mockSetTopSongs).not.toHaveBeenCalled();
  });

  it('stamps a marker for a genuine empty result', async () => {
    mockGetTopSongs.mockResolvedValue([]);
    await fetchArtistTopSongs('ar1', { prefetchCovers: false });
    expect(mockSetTopSongs).toHaveBeenCalled();
    expect(mockSetTopSongs.mock.calls[0][3]).toEqual({ listLength: expect.any(Number) });
  });

  it('treats a list-length change as a miss and refetches', async () => {
    mockLocalTop.mockResolvedValue({ songs: [], retrievedAt: 1, listLength: 999, songCount: 0 });
    mockGetTopSongs.mockResolvedValue([]);
    await fetchArtistTopSongs('ar1', { prefetchCovers: false });
    expect(mockGetTopSongs).toHaveBeenCalled();
  });

  it('treats a reaped junction (resolved < songCount) as a miss', async () => {
    mockLocalTop.mockResolvedValue({
      songs: [{ id: 's1' }],
      retrievedAt: 1,
      listLength: 20,
      songCount: 2,
    });
    mockGetTopSongs.mockResolvedValue([]);
    await fetchArtistTopSongs('ar1', { prefetchCovers: false });
    expect(mockGetTopSongs).toHaveBeenCalled();
  });
});

describe('fetchArtistBio', () => {
  it('serves a stored bio without touching MusicBrainz', async () => {
    mockLocalBio.mockResolvedValue({ biography: 'Cached', resolvedMbid: 'm1', checkedAt: 1 });
    const bio = await fetchArtistBio('ar1');
    expect(bio?.biography).toBe('Cached');
    expect(mockSearchMbid).not.toHaveBeenCalled();
  });

  it('honours the negative cache — a fresh NULL bio does not re-hammer MusicBrainz', async () => {
    mockLocalBio.mockResolvedValue({ biography: null, resolvedMbid: null, checkedAt: Date.now() });
    await fetchArtistBio('ar1');
    expect(mockSearchMbid).not.toHaveBeenCalled();
  });

  it('reresolve ignores BOTH the stored bio and the negative cache', async () => {
    // This is the MBID-override flow: the inputs changed, so the chain must rerun even
    // though we already hold a bio.
    mockLocalBio.mockResolvedValue({ biography: 'Stale', resolvedMbid: 'old', checkedAt: Date.now() });
    mockSearchMbid.mockResolvedValue('new-mbid');
    mockGetMbBio.mockResolvedValue('Fresh bio');
    await fetchArtistBio('ar1', { reresolve: true });
    expect(mockGetMbBio).toHaveBeenCalled();
    expect(mockUpsertBio).toHaveBeenCalled();
    expect(mockUpsertBio.mock.calls[0][2].biography).toBe('Fresh bio');
  });

  it('Various Artists persists a static bio and makes no remote call', async () => {
    mockIsVA = true;
    await fetchArtistBio('va');
    expect(mockSearchMbid).not.toHaveBeenCalled();
    expect(mockUpsertBio.mock.calls[0][2].biography).toBe('VA bio');
    // A row must exist, or the override screens read VA as never-attempted.
    expect(mockUpsertBio.mock.calls[0][2].checkedAt).toEqual(expect.any(Number));
  });
});
