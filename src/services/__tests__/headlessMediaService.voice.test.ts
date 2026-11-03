jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);
// Keep ensureHeadlessDataReady() a no-op so the resolver runs deterministically
// without touching real store hydration.
const mockRehydrateAllStores = jest.fn(async () => ({}));
jest.mock('../../store/persistence/rehydrate', () => ({
  rehydrateAllStores: () => mockRehydrateAllStores(),
  awaitKvHydration: async () => {},
}));

// Playback hands off to the app's playTrack; the handler tests assert that hand-off.
const mockPlayTrack = jest.fn(async (..._args: unknown[]) => {});
jest.mock('../playerService', () => ({
  playTrack: (...a: unknown[]) => mockPlayTrack(...a),
  initPlayer: async () => {},
}));
jest.mock('../playerHelpers', () => ({
  buildPlayableQueue: async (q: Array<{ id: string }>) => ({
    rnTracks: q.map((c) => ({ id: c.id })),
    filteredQueue: q,
  }),
}));

// resolveVoice delegates all offline/online routing to `searchLibrary`; the
// data-state matrix itself is covered in searchService.test. Here we only assert
// the resolver feeds it the clean structured term and applies the artist filter.
const mockSearchLibrary = jest.fn();
const mockFindAlbum = jest.fn();
const mockFindArtistSongs = jest.fn();
const mockPerformOnlineSearch = jest.fn();
const mockGetOfflineSongsByGenre = jest.fn();
jest.mock('../searchService', () => ({
  searchLibrary: (...a: unknown[]) => mockSearchLibrary(...a),
  performOnlineSearch: (...a: unknown[]) => mockPerformOnlineSearch(...a),
  getOfflineSongsByGenre: (...a: unknown[]) => mockGetOfflineSongsByGenre(...a),
  findAlbum: (...a: unknown[]) => mockFindAlbum(...a),
  findArtistSongs: (...a: unknown[]) => mockFindArtistSongs(...a),
}));

const mockLogVoiceSearch = jest.fn();
jest.mock('../voiceSearchLogger', () => ({
  logVoiceSearch: (...a: unknown[]) => mockLogVoiceSearch(...a),
}));

// Album/playlist drilldown goes through the shared normalized detailFetchService.
jest.mock('../detailFetchService', () => ({
  fetchAlbumDetail: jest.fn(),
  fetchPlaylistDetail: jest.fn(),
}));

import {
  __test,
  dispatchVoiceSearchRequest,
  installHeadlessMediaService,
} from '../headlessMediaService';
import { offlineModeStore } from '../../store/offlineModeStore';
import { authStore } from '../../store/authStore';
import { clearKvStorage } from '../../store/persistence/kvStorage';
import { markLogoutPending } from '../../store/logoutPending';
import { musicCacheStore } from '../../store/musicCacheStore';
import { fetchAlbumDetail, fetchPlaylistDetail } from '../detailFetchService';

const korn = { id: 'sk', title: 'Freak on a Leash', artist: 'Korn', albumId: 'al-1' };
const other = { id: 'so', title: 'Freak on a Leash', artist: 'Other Band', albumId: 'al-2' };

function req(over: Record<string, unknown>): any {
  return {
    query: '',
    type: undefined,
    artist: undefined,
    album: undefined,
    song: undefined,
    playlist: undefined,
    genre: undefined,
    origin: 'android-assistant',
    ...over,
  };
}

beforeEach(() => {
  mockSearchLibrary.mockReset();
  mockFindAlbum.mockReset();
  mockFindArtistSongs.mockReset();
  mockPerformOnlineSearch.mockReset();
  mockGetOfflineSongsByGenre.mockReset().mockReturnValue([]);
  mockPlayTrack.mockClear();
  mockLogVoiceSearch.mockReset();
  mockRehydrateAllStores.mockClear();
  authStore.setState({ isLoggedIn: true });
  offlineModeStore.setState({ offlineMode: true } as any);
  // These run offline, and album/playlist track lists are filtered to downloaded
  // songs there — seed the fixtures as downloaded so the filter is a no-op and the
  // tests stay about intent resolution. Offline filtering itself is covered in
  // headlessMediaService.test.ts.
  musicCacheStore.setState({
    cachedSongs: Object.fromEntries(['sk', 'so', 't1', 't2'].map((id) => [id, {}])),
  } as any);
});

describe('resolveVoice — structured-field handling', () => {
  it('searches the structured song term (NOT the concatenated query) and filters by artist', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [korn, other], albums: [], artists: [] });
    const songs = await __test.resolveVoice(
      req({ query: 'Freak on a Leash Korn', song: 'Freak on a Leash', artist: 'Korn', type: 'song' }),
    );
    // Used the clean song term, NOT the old concatenated blob ("Freak on a Leash Korn").
    expect(mockSearchLibrary).toHaveBeenCalledWith('Freak on a Leash');
    // Same-titled tracks by different artists → the artist filter keeps only Korn.
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });

  it('falls back to the query when no structured song, and does not filter without an artist', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [korn, other], albums: [], artists: [] });
    const songs = await __test.resolveVoice(req({ query: 'freak', origin: 'ios-siri' }));
    expect(mockSearchLibrary).toHaveBeenCalledWith('freak');
    expect(songs.map((s: any) => s.id)).toEqual(['sk', 'so']);
  });

  it('delegates offline/online routing to searchLibrary (no branch in the resolver)', async () => {
    offlineModeStore.setState({ offlineMode: false } as any);
    mockSearchLibrary.mockResolvedValue({ songs: [korn], albums: [], artists: [] });
    const songs = await __test.resolveVoice(
      req({ query: 'X', song: 'Freak on a Leash', artist: 'Korn', type: 'song' }),
    );
    expect(mockSearchLibrary).toHaveBeenCalledWith('Freak on a Leash');
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });

  it('locks the artist in FUZZILY via scoreCandidate ("by corn" → Korn, not Other Band)', async () => {
    // A case-insensitive substring filter would not match "corn" to "Korn".
    // scoreCandidate scores it phonetically, so Korn still wins.
    mockSearchLibrary.mockResolvedValue({ songs: [korn, other], albums: [], artists: [] });
    const songs = await __test.resolveVoice(
      req({ song: 'Freak on a Leash', artist: 'corn', type: 'song' }),
    );
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });

  it('logs the classified intent + the request + the outcome', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [korn], albums: [], artists: [] });
    await __test.resolveVoice(
      req({ query: 'Freak on a Leash Korn', song: 'Freak on a Leash', artist: 'Korn', type: 'song' }),
    );
    const logged = mockLogVoiceSearch.mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes('song="Freak on a Leash"') && l.includes('artist="Korn"'))).toBe(true);
    expect(logged.some((l) => l.includes('intent=song'))).toBe(true);
    expect(logged.some((l) => l.includes('1 hit(s)') && l.includes('Freak on a Leash'))).toBe(true);
  });
});

describe('classifyVoiceIntent', () => {
  const c = (over: Record<string, unknown>) => __test.classifyVoiceIntent(req(over));

  it('uses the assistant type when present', () => {
    expect(c({ type: 'album', query: 'x' })).toBe('album');
    expect(c({ type: 'artist', query: 'x' })).toBe('artist');
    expect(c({ type: 'song', query: 'x' })).toBe('song');
    expect(c({ type: 'playlist', query: 'x' })).toBe('playlist');
    expect(c({ type: 'genre', query: 'x' })).toBe('genre');
  });

  it('infers from populated slots when type is absent', () => {
    expect(c({ album: 'Ten' })).toBe('album');
    expect(c({ song: 'Freak on a Leash' })).toBe('song');
    expect(c({ artist: 'Korn' })).toBe('artist');
    expect(c({ playlist: 'Roadtrip' })).toBe('playlist');
    expect(c({ genre: 'Metal' })).toBe('genre');
  });

  it('is free-text when only a bare query is present', () => {
    expect(c({ query: 'something mumbled' })).toBe('free-text');
  });
});

describe('resolveVoice — album + artist intents', () => {
  it('album intent → finds the album (artist-preferred) and plays it in track order', async () => {
    mockFindAlbum.mockResolvedValue({ id: 'al-1', name: 'Ten', artist: 'Pearl Jam' });
    const t1 = { id: 't1', title: 'Once', discNumber: 1, track: 1 };
    const t2 = { id: 't2', title: 'Alive', discNumber: 1, track: 2 };
    // albumSongs() → fetchAlbumDetail(); return out-of-order to prove the sort.
    (fetchAlbumDetail as jest.Mock).mockResolvedValueOnce({ song: [t2, t1] } as any);
    const songs = await __test.resolveVoice(req({ album: 'Ten', artist: 'Pearl Jam', type: 'album' }));
    expect(mockFindAlbum).toHaveBeenCalledWith('Ten', 'Pearl Jam');
    expect(songs.map((s: any) => s.id)).toEqual(['t1', 't2']); // disc/track order
  });

  it('album intent with no match falls through to a song search', async () => {
    mockFindAlbum.mockResolvedValue(null);
    mockSearchLibrary.mockResolvedValue({ songs: [korn], albums: [], artists: [] });
    const songs = await __test.resolveVoice(req({ album: 'Nope', type: 'album' }));
    expect(mockSearchLibrary).toHaveBeenCalled();
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });

  it('artist intent → plays the tracks from findArtistSongs', async () => {
    mockFindArtistSongs.mockResolvedValue([korn]);
    const songs = await __test.resolveVoice(req({ artist: 'Korn', type: 'artist' }));
    expect(mockFindArtistSongs).toHaveBeenCalledWith('Korn');
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });
});

describe('resolveVoice — genre intent', () => {
  it('offline → the downloaded songs of that genre', async () => {
    mockGetOfflineSongsByGenre.mockReturnValue([korn]);
    const songs = await __test.resolveVoice(req({ genre: ' Metal ', type: 'genre' }));
    expect(mockGetOfflineSongsByGenre).toHaveBeenCalledWith('Metal');
    expect(mockPerformOnlineSearch).not.toHaveBeenCalled();
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });

  it('online → server search results narrowed to that genre, case-insensitively', async () => {
    offlineModeStore.setState({ offlineMode: false } as any);
    mockPerformOnlineSearch.mockResolvedValue({
      songs: [
        { ...korn, genre: 'metal' },
        { ...other, genre: 'Pop' },
        { id: 'ng', title: 'No genre' },
      ],
      albums: [],
      artists: [],
    });
    const songs = await __test.resolveVoice(req({ genre: 'Metal', type: 'genre' }));
    expect(mockPerformOnlineSearch).toHaveBeenCalledWith('Metal');
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });

  it('no songs in the genre falls through to a search on the query', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [korn], albums: [], artists: [] });
    const songs = await __test.resolveVoice(req({ query: 'Metal', type: 'genre' }));
    expect(mockGetOfflineSongsByGenre).toHaveBeenCalledWith('Metal');
    expect(mockSearchLibrary).toHaveBeenCalledWith('Metal');
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });
});

describe('resolveVoice — album track order', () => {
  it('plays disc 1 before disc 2, and orders unnumbered tracks by id', async () => {
    musicCacheStore.setState({
      cachedSongs: Object.fromEntries(['d2', 'd1', 'u2', 'u1'].map((id) => [id, {}])),
    } as any);
    mockFindAlbum.mockResolvedValue({ id: 'al-1', name: 'Box Set' });
    (fetchAlbumDetail as jest.Mock).mockResolvedValueOnce({
      song: [
        { id: 'u2', title: 'U2' },
        { id: 'd2', title: 'Disc 2', discNumber: 2, track: 1 },
        { id: 'u1', title: 'U1' },
        { id: 'd1', title: 'Disc 1', discNumber: 1, track: 2 },
      ],
    });
    const songs = await __test.resolveVoice(req({ album: 'Box Set', type: 'album' }));
    // Unnumbered tracks read as disc 1 / track 0, so they lead, tie-broken by id.
    expect(songs.map((s: any) => s.id)).toEqual(['u1', 'u2', 'd1', 'd2']);
  });
});

describe('dispatchVoiceSearchRequest (Android App Actions)', () => {
  it('plays the resolved songs from the first one', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [korn, other], albums: [], artists: [] });
    await dispatchVoiceSearchRequest(req({ query: 'freak' }));
    expect(mockPlayTrack).toHaveBeenCalledWith(korn, [korn, other], null);
  });

  it('plays nothing when the request resolves to no songs', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [], albums: [], artists: [] });
    await dispatchVoiceSearchRequest(req({ query: 'nothing matches' }));
    expect(mockPlayTrack).not.toHaveBeenCalled();
  });
});

describe('the registered playback handler', () => {
  const rnqp = require('react-native-queue-player');
  const tp = rnqp.getTrackPlayer();
  const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

  let handler: any;
  beforeEach(async () => {
    __test.reset();
    rnqp.registerPlaybackService.mockClear();
    installHeadlessMediaService();
    handler = rnqp.registerPlaybackService.mock.calls.at(-1)[0]();
    await flushAsync(); // settle the install-time pushes
    tp.setBrowseSnapshot.mockClear();
  });
  afterEach(() => {
    __test.reset();
    jest.restoreAllMocks();
  });

  it('search: a blank query lists nothing and does not search', async () => {
    expect(await handler.onSearchRequest('   ')).toEqual([]);
    expect(mockSearchLibrary).not.toHaveBeenCalled();
  });

  it('search: lists playable songs first, then album drill rows', async () => {
    mockSearchLibrary.mockResolvedValue({
      songs: [korn, other],
      albums: [{ id: 'al-9', name: 'Issues', artist: 'Korn' }],
      artists: [],
    });
    const rows = await handler.onSearchRequest('freak');
    expect(rows.map((r: any) => r.id)).toEqual(['search:0', 'search:1', 'album:al-9']);
    expect(rows.map((r: any) => r.playable)).toEqual([true, true, false]);
    expect(rows[2]).toMatchObject({ title: 'Issues', subtitle: 'Korn', hasChildren: true });
  });

  it('tapping a search result plays the search results from that row', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [korn, other], albums: [], artists: [] });
    await handler.onSearchRequest('freak');

    const tracks = await handler.onPlayFromIdRequest('search:1');

    expect(mockPlayTrack).toHaveBeenCalledWith(other, [korn, other], null);
    expect(tracks).toEqual([{ id: 'sk' }, { id: 'so' }]);
  });

  it('a stale or malformed search id plays nothing', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [korn], albums: [], artists: [] });
    await handler.onSearchRequest('freak');

    expect(await handler.onPlayFromIdRequest('search:5')).toEqual([]);
    expect(await handler.onPlayFromIdRequest('search:x')).toEqual([]);
    expect(await handler.onPlayFromIdRequest('search:-1')).toEqual([]);
    expect(mockPlayTrack).not.toHaveBeenCalled();
  });

  it('tapping a playlist track plays the playlist from it, tagged with its source playlist', async () => {
    const entries = [
      { id: 'sk', title: 'A' },
      { id: 'so', title: 'B' },
    ];
    (fetchPlaylistDetail as jest.Mock).mockResolvedValueOnce({ entry: entries });

    const tracks = await handler.onPlayFromIdRequest('track:playlist:p1:1');

    expect(mockPlayTrack).toHaveBeenCalledWith(entries[1], entries, 'p1');
    expect(tracks).toEqual([{ id: 'sk' }, { id: 'so' }]);
  });

  it('a voice request plays the resolved songs from the first one', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [korn], albums: [], artists: [] });
    const tracks = await handler.onPlayFromSearchRequest(req({ query: 'freak' }));
    expect(mockPlayTrack).toHaveBeenCalledWith(korn, [korn], null);
    expect(tracks).toEqual([{ id: 'sk' }]);
  });

  it('a voice request that resolves to nothing plays nothing', async () => {
    mockSearchLibrary.mockResolvedValue({ songs: [], albums: [], artists: [] });
    expect(await handler.onPlayFromSearchRequest(req({ query: 'zzz' }))).toEqual([]);
    expect(mockPlayTrack).not.toHaveBeenCalled();
  });

  it('a car connecting pushes the browse snapshot', async () => {
    handler.onCarConnect();
    await flushAsync();
    expect(tp.setBrowseSnapshot).toHaveBeenCalledTimes(1);
  });

  it('a reborn service re-registers the handler and re-pushes; the first bind does not', async () => {
    rnqp.registerPlaybackService.mockClear();
    handler.onServiceReady('first-bind');
    expect(rnqp.registerPlaybackService).not.toHaveBeenCalled();

    handler.onServiceReady('service-reborn');
    await flushAsync();
    expect(rnqp.registerPlaybackService).toHaveBeenCalledTimes(1);
    expect(tp.setBrowseSnapshot).toHaveBeenCalled();
  });

  it('a failed headless hydration is logged and the request is still served', async () => {
    __test.reset();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('hydrate failed');
    mockRehydrateAllStores.mockRejectedValueOnce(err);
    mockSearchLibrary.mockResolvedValue({ songs: [korn], albums: [], artists: [] });

    const songs = await __test.resolveVoice(req({ query: 'freak' }));

    expect(warn).toHaveBeenCalledWith('[headlessMediaService] ensureHeadlessDataReady failed:', err);
    expect(songs.map((s: any) => s.id)).toEqual(['sk']);
  });
});

describe('headless with no session ready', () => {
  const rnqp = require('react-native-queue-player');
  let handler: any;

  beforeEach(() => {
    // Installed not ready, so the install's own hydration does not run either.
    authStore.setState({ isLoggedIn: false });
    __test.reset();
    rnqp.registerPlaybackService.mockClear();
    installHeadlessMediaService();
    handler = rnqp.registerPlaybackService.mock.calls.at(-1)[0]();
    mockSearchLibrary.mockResolvedValue({ songs: [korn], albums: [], artists: [] });
  });
  afterEach(() => {
    __test.reset();
    clearKvStorage();
  });

  const cases: Array<[string, () => void]> = [
    ['logged out', () => undefined],
    ['a logout pending', () => { authStore.setState({ isLoggedIn: true }); markLogoutPending(); }],
  ];

  it.each(cases)('%s: every entry point answers empty and nothing hydrates or plays', async (_, arrange) => {
    arrange();

    expect(await handler.onBrowseRequest('root')).toEqual([]);
    expect(await handler.onSearchRequest('freak')).toEqual([]);
    expect(await handler.onPlayFromIdRequest('search:0')).toEqual([]);
    expect(await handler.onPlayFromSearchRequest(req({ query: 'freak' }))).toEqual([]);
    await dispatchVoiceSearchRequest(req({ query: 'freak' }));

    expect(mockSearchLibrary).not.toHaveBeenCalled();
    expect(mockPlayTrack).not.toHaveBeenCalled();
    expect(mockRehydrateAllStores).not.toHaveBeenCalled();
  });

  it('hydrates on the first request once the session is ready', async () => {
    await handler.onSearchRequest('freak');
    expect(mockRehydrateAllStores).not.toHaveBeenCalled();

    authStore.setState({ isLoggedIn: true });
    await handler.onSearchRequest('freak');
    expect(mockRehydrateAllStores).toHaveBeenCalledTimes(1);
  });
});
