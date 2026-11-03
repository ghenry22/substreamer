// Hoisted mock helpers (jest allows `mock`-prefixed names in factories).
const mockRefreshAll = jest.fn(() => Promise.resolve());
const mockRefreshAllIfDue = jest.fn((_ms: number) => Promise.resolve(true));
const mockRefreshRecentlyPlayed = jest.fn(() => Promise.resolve());
const mockFetchAllAlbums = jest.fn(() => Promise.resolve());
const mockRunNormalizedLibrarySync = jest.fn((_opts?: unknown) => Promise.resolve());
const mockUpsertAlbums = jest.fn();
const mockFetchAllArtists = jest.fn(() => Promise.resolve());
const mockFetchAllPlaylists = jest.fn(() => Promise.resolve());
const mockFetchStarred = jest.fn(() => Promise.resolve());
const mockFetchGenres = jest.fn(() => Promise.resolve());
const mockFetchScanStatus = jest.fn(() => Promise.resolve());
const mockSetServerInfo = jest.fn();

// Offline/online toggle driven by this module-scoped flag.
const offlineState = { offline: false };
const albumLibraryState = {
  albums: [] as Array<{ id: string }>,
  loading: false,
};
const artistLibraryState = { artists: [] as Array<{ id: string }> };
const playlistLibraryState = { playlists: [] as Array<{ id: string }> };

/**
 * Offline-mode subscribers are held inside the mock factory's closure (see
 * jest.mock below) and exposed via `__offlineSubs` on the mocked module —
 * that way dataSyncService's module-scope subscribers don't race a
 * top-level `const` through babel-jest's import hoisting.
 */
function getOfflineSubscribers(): Set<(state: { offlineMode: boolean }, prev: { offlineMode: boolean }) => void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../store/offlineModeStore').__offlineSubs;
}
function setOfflineMode(next: boolean): void {
  const prev = { offlineMode: offlineState.offline };
  offlineState.offline = next;
  const state = { offlineMode: next };
  for (const cb of getOfflineSubscribers()) cb(state, prev);
}

// NOTE: jest hoists `jest.mock` calls above the `const` declarations. To avoid
// a temporal-dead-zone issue where factories capture `undefined` mock values,
// we wrap each mock call in a thunk that looks up the real jest.fn at invoke
// time, after top-level module initialisation has finished.
jest.mock('../../store/albumListsStore', () => ({
  __esModule: true,
  albumListsStore: {
    getState: () => ({
      refreshAll: () =>mockRefreshAll(),
      refreshAllIfDue: (ms: number) =>mockRefreshAllIfDue(ms),
      refreshRecentlyPlayed: () =>mockRefreshRecentlyPlayed(),
    }),
    subscribe: () => () => {},
  },
}));

// Walk engine reads the detail cache and fetches missing albums through
// the store's action. We stub a mutable record + a jest.fn so tests can
// seed the cache and assert fetch invocations.
const mockDetailState: { albums: Record<string, unknown>; fetched: string[] } = {
  albums: {},
  fetched: [],
};
const mockFetchAlbum = jest.fn((id: string) => {
  mockDetailState.fetched.push(id);
  mockDetailState.albums[id] = { album: { id }, retrievedAt: Date.now() };
  return Promise.resolve({ id } as any);
});
const mockRemoveEntries = jest.fn((ids: readonly string[]) => {
  for (const id of ids) delete mockDetailState.albums[id];
});
// The sync's change-detection now reads normalized counts/ids from the repository
// instead of the (doomed) library-store arrays. Derive those from the SAME mock
// state the tests drive, so change-detection behaves as before. requireActual
// preserves the repository's other exports (used by the real normalizedSyncWriter).
jest.mock('../../db/repository/albums', () => ({
  ...jest.requireActual('../../db/repository/albums'),
  // onAlbumReferenced writes through the repository now, not albumLibraryStore.
  upsertAlbums: (_db: unknown, albums: unknown[]) => mockUpsertAlbums(albums),
  countAlbums: () => Promise.resolve(albumLibraryState.albums.length),
  listAlbumIds: () => Promise.resolve(albumLibraryState.albums.map((a: { id: string }) => a.id)),
  albumIdsPresent: (_db: unknown, ids: string[]) =>
    Promise.resolve(
      new Set(
        albumLibraryState.albums
          .map((a: { id: string }) => a.id)
          .filter((id: string) => ids.includes(id)),
      ),
    ),
}));
jest.mock('../../db/repository/artists', () => ({
  ...jest.requireActual('../../db/repository/artists'),
  countArtists: () => Promise.resolve(artistLibraryState.artists.length),
}));

const mockPlaylistDetail = {
  removePlaylist: jest.fn(),
  fetchPlaylist: jest.fn((_id: string) => Promise.resolve(null as unknown)),
};
jest.mock('../../store/favoritesStore', () => ({
  __esModule: true,
  favoritesStore: {
    getState: () => ({ fetchStarred: () =>mockFetchStarred() }),
  },
}));

jest.mock('../../store/genreStore', () => ({
  __esModule: true,
  genreStore: {
    getState: () => ({ fetchGenres: () =>mockFetchGenres() }),
  },
}));

jest.mock('../../store/offlineModeStore', () => {
  // Subscriber set lives inside the factory closure so it's defined by
  // the time dataSyncService's module-scope subscribe call fires (which
  // happens during the test file's `import` hoisting, before any outer
  // `const` declarations would be initialised). No type annotations
  // inline here — babel-jest's mock-factory parser rejects TS type refs
  // as out-of-scope variables.
  const subs = new Set();
  return {
    __esModule: true,
    offlineModeStore: {
      getState: () => ({ offlineMode: offlineState.offline }),
      subscribe: (cb: unknown) => {
        subs.add(cb);
        return () => { subs.delete(cb); };
      },
    },
    __offlineSubs: subs,
  };
});

jest.mock('../../store/serverInfoStore', () => ({
  __esModule: true,
  serverInfoStore: {
    getState: () => ({
      setServerInfo: (info: unknown) => (mockSetServerInfo as any)(info),
    }),
  },
}));

jest.mock('../scanService', () => ({
  __esModule: true,
  fetchScanStatus: () => mockFetchScanStatus(),
  registerScanCompletedHook: () => {},
}));

jest.mock('../scrobbleService', () => ({
  __esModule: true,
  registerScrobbleBatchCompletedHook: () => {},
}));

const mockSyncCachedItemTracks = jest.fn();
jest.mock('../musicCacheService', () => ({
  __esModule: true,
  registerMusicCacheOnAlbumReferencedHook: () => {},
  syncCachedItemTracks: (...args: unknown[]) => mockSyncCachedItemTracks(...args),
}));

const mockCachedItems: Record<string, unknown> = {};
const mockCachedSongs: Record<string, unknown> = {};
jest.mock('../../store/musicCacheStore', () => ({
  __esModule: true,
  musicCacheStore: {
    getState: () => ({ cachedItems: mockCachedItems, cachedSongs: mockCachedSongs }),
  },
}));

const mockConnectivity = { hasConnection: true, isServerReachable: true };
jest.mock('../../store/connectivityStore', () => ({
  __esModule: true,
  // `subscribe` is needed because detailFetchService → imageCacheService installs a
  // module-level connectivity subscription at load.
  connectivityStore: { getState: () => mockConnectivity, subscribe: () => () => {} },
}));

// Shortcut minDelay to a near-instant resolve in tests — its purpose is UI
// feedback, not logic; slowing tests by 2s each is noise.
jest.mock('../../utils/stringHelpers', () => {
  const actual = jest.requireActual('../../utils/stringHelpers');
  return { ...actual, minDelay: () => Promise.resolve() };
});

let mockVerdict = 'skip';
let mockLegacy = false;
let mockWritesBlocked: boolean | null = null;
let mockAnswered: boolean | null = null;
jest.mock('../navidromeReid/reidMarker', () => {
  const actual = jest.requireActual('../navidromeReid/reidMarker');
  return {
    ...actual,
    reidVerdict: () => mockVerdict,
    isLegacyThisSession: () => mockLegacy,
    shouldBlockLibraryWrites: () => mockWritesBlocked ?? actual.shouldBlockLibraryWrites(),
    hasServerAnswered: () => mockAnswered ?? actual.hasServerAnswered(),
  };
});
let mockServerUpHook: (() => unknown) | null = null;
jest.mock('../connectivityService', () => ({
  ...jest.requireActual('../connectivityService'),
  setServerUpHook: (hook: (() => unknown) | null) => { mockServerUpHook = hook; },
}));
const mockRunReid = jest.fn(() => Promise.resolve());
jest.mock('../navidromeReid/runNavidromeReid', () => ({
  runNavidromeReidIfNeeded: () => mockRunReid(),
}));

// subsonicService uses the shared __mocks__ automock. We opt into it here and
// reach for `fetchServerInfo` via the imported namespace.
jest.mock('../subsonicService');
jest.mock('../normalizedLibrarySync', () => ({
  runNormalizedLibrarySync: (opts?: unknown) => {
    mockRunNormalizedLibrarySync(opts);
    // A NON-full run does what `albumLibraryStore.fetchAllAlbums()` does (resume the
    // album list, then the songs), so route it there — the pager/scope
    // assertions below are about the fan-out, and stay meaningful. Returning that
    // mock's promise also preserves the tests that control timing through it.
    return (opts as { full?: boolean } | undefined)?.full === true
      ? Promise.resolve()
      : mockFetchAllAlbums();
  },
  // The artist/playlist list refresh moved off the library stores onto the sync
  // service. Point it at the same hoisted mocks the store factories use, so the
  // existing call assertions — which are about the fan-out, not the implementation —
  // keep holding. Deliberately NOT a lazy `require`: the deferred-startup timer can
  // fire after this suite's module registry is torn down, and a require then throws
  // into whichever suite is running next.
  refreshArtistLibrary: () => mockFetchAllArtists(),
  refreshPlaylistLibrary: () => mockFetchAllPlaylists(),
}));

// Poly-fill requestIdleCallback so the deferred-prefetch block runs in tests.
(globalThis as any).requestIdleCallback = (cb: () => void) => cb();

// Stub setTimeout's 1500ms delay in the startup flow by running it immediately
// for tests. We only need to verify the immediate-chain calls fire.
jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import {
  cancelAllSyncs,
  deferredDataSyncInit,
  detectChanges,
  onAlbumReferenced,
  onOnlineResume,
  onPullToRefresh,
  onScanCompleted,
  onScrobbleCompleted,
  onStartup,
  forceFullResync,
  recoverStalledSync,
  __internal,
} from '../dataSyncService';
import * as subsonicService from '../subsonicService';
import type { Playlist } from '../subsonicService';
import { authStore } from '../../store/authStore';
import { syncStatusStore } from '../../store/syncStatusStore';
import { getDb } from '../../store/persistence/db';

const mockFetchServerInfo = subsonicService.fetchServerInfo as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  offlineState.offline = false;
  getOfflineSubscribers().clear();
  albumLibraryState.albums = [];
  albumLibraryState.loading = false;
  artistLibraryState.artists = [];
  playlistLibraryState.playlists = [];
  mockDetailState.albums = {};
  mockDetailState.fetched = [];
  mockPlaylistDetail.removePlaylist.mockClear();
  mockPlaylistDetail.fetchPlaylist.mockClear();
  mockPlaylistDetail.fetchPlaylist.mockResolvedValue(null);
  mockSyncCachedItemTracks.mockClear();
  for (const k of Object.keys(mockCachedItems)) delete mockCachedItems[k];
  for (const k of Object.keys(mockCachedSongs)) delete mockCachedSongs[k];
  mockConnectivity.hasConnection = true;
  mockConnectivity.isServerReachable = true;
  mockFetchAlbum.mockClear();
  mockFetchServerInfo.mockResolvedValue(null);
  syncStatusStore.setState({
    detailSyncPhase: 'idle',
    detailSyncTotal: 0,
    bannerDismissedAt: null,
    lastChangeDetectionAt: null,
    lastKnownServerSongCount: null,
    lastKnownServerScanTime: null,
    lastKnownNewestAlbumId: null,
    lastKnownNewestAlbumCreated: null,
    generation: 0,
    inFlight: new Map(),
    librarySyncPhase: 'idle',
    librarySyncComplete: false,
    librarySyncCursor: 0,
    librarySyncLastFetchedAt: null,
    syncStrategy: null,
    songSyncStrategy: null,
    songSyncCursor: 0,
    songSyncComplete: false,
  });
});

describe('dataSyncService — changing the server ADDRESS is not a new library', () => {
  it('leaves the library and both cursors untouched across a serverUrl change', async () => {
    // A primary/secondary failover, or editing the address of the same server, used to
    // read as "different server" and drop the whole normalized model. Only logout clears.
    authStore.setState({
      serverUrl: 'https://remote.example.com',
      primaryServerUrl: 'https://remote.example.com',
      username: 'greg',
      isLoggedIn: true,
    } as any);
    albumLibraryState.albums = [{ id: 'a1' } as any];
    mockDetailState.albums = { a1: { album: { id: 'a1' } } } as any;
    syncStatusStore.setState({
      librarySyncComplete: true,
      librarySyncCursor: 500,
      songSyncCursor: 900,
    } as any);

    await onStartup();
    // The address moves to the LAN slot — same server, same library.
    authStore.setState({ serverUrl: 'http://192.168.1.50:4040', activeServer: 'secondary' } as any);
    await onStartup();

    expect(albumLibraryState.albums).toHaveLength(1);
    expect(Object.keys(mockDetailState.albums)).toHaveLength(1);
    const s = syncStatusStore.getState();
    expect(s.librarySyncComplete).toBe(true);
    expect(s.librarySyncCursor).toBe(500);
    expect(s.songSyncCursor).toBe(900);
  });
});

describe('dataSyncService — subset relationship', () => {
  const { isSubsetOf } = __internal;

  it('every scope is a subset of itself', () => {
    for (const s of ['home', 'albums', 'artists', 'playlists', 'favorites', 'genres', 'all'] as const) {
      expect(isSubsetOf(s, s)).toBe(true);
    }
  });

  it('leaf scopes are subsets of "all"', () => {
    expect(isSubsetOf('albums', 'all')).toBe(true);
    expect(isSubsetOf('artists', 'all')).toBe(true);
    expect(isSubsetOf('playlists', 'all')).toBe(true);
    expect(isSubsetOf('favorites', 'all')).toBe(true);
    expect(isSubsetOf('home', 'all')).toBe(true);
    expect(isSubsetOf('genres', 'all')).toBe(true);
  });

  it('"all" is not a subset of any leaf', () => {
    expect(isSubsetOf('all', 'albums')).toBe(false);
    expect(isSubsetOf('all', 'home')).toBe(false);
  });

  it('leaves are disjoint', () => {
    expect(isSubsetOf('albums', 'artists')).toBe(false);
    expect(isSubsetOf('home', 'albums')).toBe(false);
    expect(isSubsetOf('playlists', 'favorites')).toBe(false);
  });
});

describe('dataSyncService — pass-through invocations', () => {
  it('onPullToRefresh("home") calls albumListsStore.refreshAll', async () => {
    await onPullToRefresh('home');
    expect(mockRefreshAll).toHaveBeenCalledTimes(1);
  });

  it('onPullToRefresh("albums") resumes the pager when the initial list sync is incomplete', async () => {
    syncStatusStore.setState({ librarySyncComplete: false });
    await onPullToRefresh('albums');
    expect(mockFetchAllAlbums).toHaveBeenCalledTimes(1);
  });

  it('onPullToRefresh("albums") runs incremental change-detection (NOT a full re-fetch) once the library is complete', async () => {
    syncStatusStore.setState({ librarySyncComplete: true });
    const getRecentlyAdded = subsonicService.getRecentlyAddedAlbums as jest.Mock;
    getRecentlyAdded.mockResolvedValue([]);
    await onPullToRefresh('albums');
    // No full re-download; the cheap newest-album probe runs instead.
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
    expect(getRecentlyAdded).toHaveBeenCalled();
  });

  it('onPullToRefresh("artists") calls artistLibraryStore.fetchAllArtists', async () => {
    await onPullToRefresh('artists');
    expect(mockFetchAllArtists).toHaveBeenCalledTimes(1);
  });

  it('onPullToRefresh("playlists") calls playlistLibraryStore.fetchAllPlaylists', async () => {
    await onPullToRefresh('playlists');
    expect(mockFetchAllPlaylists).toHaveBeenCalledTimes(1);
  });

  it('onPullToRefresh("favorites") calls favoritesStore.fetchStarred', async () => {
    await onPullToRefresh('favorites');
    expect(mockFetchStarred).toHaveBeenCalledTimes(1);
  });

  it('onPullToRefresh("genres") calls genreStore.fetchGenres', async () => {
    await onPullToRefresh('genres');
    expect(mockFetchGenres).toHaveBeenCalledTimes(1);
  });

  it('onPullToRefresh("all") fans out to every scope', async () => {
    await onPullToRefresh('all');
    expect(mockRefreshAll).toHaveBeenCalled();
    expect(mockFetchAllAlbums).toHaveBeenCalled();
    expect(mockFetchAllArtists).toHaveBeenCalled();
    expect(mockFetchAllPlaylists).toHaveBeenCalled();
    expect(mockFetchStarred).toHaveBeenCalled();
    expect(mockFetchGenres).toHaveBeenCalled();
  });

  it('onPullToRefresh bails when offline', async () => {
    offlineState.offline = true;
    await onPullToRefresh('albums');
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
  });

  it('onScrobbleCompleted refreshes only the recently-played section', async () => {
    await onScrobbleCompleted();
    expect(mockRefreshRecentlyPlayed).toHaveBeenCalledTimes(1);
    expect(mockRefreshAll).not.toHaveBeenCalled();
  });

  it('onStartup fires immediate chain when online', async () => {
    await onStartup();
    await new Promise((r) => setImmediate(r));
    expect(mockFetchServerInfo).toHaveBeenCalledTimes(1);
    expect(mockFetchScanStatus).toHaveBeenCalledTimes(1);
    expect(mockRefreshAllIfDue).toHaveBeenCalledWith(0);
    expect(mockFetchStarred).toHaveBeenCalledTimes(1);
  });

  it('onStartup applies serverInfo when fetchServerInfo returns non-null', async () => {
    const info = { version: '1.16.1' };
    mockFetchServerInfo.mockResolvedValueOnce(info);
    authStore.setState({ isLoggedIn: true, serverUrl: 'https://a', username: 'u' });
    await onStartup();
    await new Promise((r) => setImmediate(r));
    expect(mockSetServerInfo).toHaveBeenCalledWith(info);
  });

  describe('a server-info answer that lands late', () => {
    // Not awaited and no network timeout: it can arrive after logout, and must not refill
    // the store with the old server's details.
    const startWithHeldInfo = async () => {
      let answer: (v: unknown) => void = () => undefined;
      mockFetchServerInfo.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
      authStore.setState({ isLoggedIn: true, serverUrl: 'https://a', username: 'u' });
      await onStartup();
      return (info: unknown) => answer(info);
    };

    it('is dropped after logout', async () => {
      const answer = await startWithHeldInfo();
      authStore.setState({ isLoggedIn: false, serverUrl: null, username: null });
      answer({ version: '1.16.1' });
      await new Promise((r) => setImmediate(r));
      expect(mockSetServerInfo).not.toHaveBeenCalled();
    });

    it('is dropped after logout and a login as another account', async () => {
      const answer = await startWithHeldInfo();
      authStore.setState({ isLoggedIn: true, serverUrl: 'https://b', username: 'other' });
      answer({ version: '1.16.1' });
      await new Promise((r) => setImmediate(r));
      expect(mockSetServerInfo).not.toHaveBeenCalled();
    });
  });

  it('onStartup is a no-op when offline', async () => {
    offlineState.offline = true;
    await onStartup();
    expect(mockFetchServerInfo).not.toHaveBeenCalled();
    expect(mockRefreshAll).not.toHaveBeenCalled();
  });

  it('onOnlineResume runs the same chain as onStartup', async () => {
    await onOnlineResume();
    await new Promise((r) => setImmediate(r));
    expect(mockFetchServerInfo).toHaveBeenCalledTimes(1);
    expect(mockRefreshAllIfDue).toHaveBeenCalledWith(0);
  });

  // NOTE: These functions were Phase-1 stubs. As of Phase 4/5/6 each has a
  // real implementation covered by its own describe block below
  // (runFullAlbumDetailSync, recoverStalledSync, onAlbumReferenced,
  // reconcileAlbumLibrary, detectChanges, forceFullResync).

  it('cancelAllSyncs bumps the generation counter', () => {
    const before = syncStatusStore.getState().generation;
    cancelAllSyncs('user-cancel');
    expect(syncStatusStore.getState().generation).toBe(before + 1);
    cancelAllSyncs('force-resync');
    expect(syncStatusStore.getState().generation).toBe(before + 2);
  });
});

describe('dataSyncService — scope composition matrix', () => {
  it('same scope collapses (returns pending promise)', async () => {
    let resolveFirst: () => void;
    mockFetchAllAlbums.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveFirst = r; }),
    );
    const first = onPullToRefresh('albums');
    // Second call before first completes should collapse.
    const second = onPullToRefresh('albums');
    expect(mockFetchAllAlbums).toHaveBeenCalledTimes(1);
    resolveFirst!();
    await first;
    await second;
    expect(mockFetchAllAlbums).toHaveBeenCalledTimes(1);
  });

  it('subset collapses when superset is in flight', async () => {
    let resolveAll: () => void;
    mockFetchAllAlbums.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveAll = r; }),
    );
    const all = onPullToRefresh('all');
    await new Promise((r) => setImmediate(r));

    const beforeCount = mockFetchAllArtists.mock.calls.length;
    // DO NOT await — awaiting the collapsed promise would deadlock on the
    // still-pending superset. We only verify no new subscope work launched.
    const collapsed = onPullToRefresh('artists');
    await new Promise((r) => setImmediate(r));
    expect(mockFetchAllArtists.mock.calls.length).toBe(beforeCount);

    resolveAll!();
    await all;
    await collapsed;
  });

  it('non-overlapping scopes run in parallel', async () => {
    let resolveAlbums: () => void;
    let resolveArtists: () => void;
    mockFetchAllAlbums.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveAlbums = r; }),
    );
    mockFetchAllArtists.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveArtists = r; }),
    );
    const a = onPullToRefresh('albums');
    const b = onPullToRefresh('artists');
    expect(mockFetchAllAlbums).toHaveBeenCalledTimes(1);
    expect(mockFetchAllArtists).toHaveBeenCalledTimes(1);
    resolveAlbums!();
    resolveArtists!();
    await Promise.all([a, b]);
  });

  it('superset awaits existing subset then fires', async () => {
    let resolveAlbums: () => void;
    mockFetchAllAlbums.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveAlbums = r; }),
    );
    const albums = onPullToRefresh('albums');
    await new Promise((r) => setImmediate(r));
    expect(mockFetchAllAlbums).toHaveBeenCalledTimes(1);

    const all = onPullToRefresh('all');
    await new Promise((r) => setImmediate(r));
    expect(mockFetchAllArtists).not.toHaveBeenCalled();

    resolveAlbums!();
    await albums;
    await all;

    expect(mockFetchAllArtists).toHaveBeenCalled();
    expect(mockFetchAllPlaylists).toHaveBeenCalled();
    expect(mockFetchStarred).toHaveBeenCalled();
    expect(mockFetchGenres).toHaveBeenCalled();
  });

  it('in-flight entry is cleared after work completes', async () => {
    await onPullToRefresh('albums');
    expect(syncStatusStore.getState().getInFlight('albums')).toBeUndefined();
  });

  it('in-flight entry is cleared even when worker throws', async () => {
    mockFetchAllAlbums.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    await expect(onPullToRefresh('albums')).rejects.toThrow('boom');
    expect(syncStatusStore.getState().getInFlight('albums')).toBeUndefined();
  });
});

describe('dataSyncService — deferred startup prefetches', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('deferred block kicks off library prefetches when the list sync is incomplete', async () => {
    albumLibraryState.albums = [];
    syncStatusStore.setState({ librarySyncComplete: false });
    artistLibraryState.artists = [];
    playlistLibraryState.playlists = [];
    await onStartup();
    // Advance the requestIdleCallback-scheduled 1500ms timer AND flush the
    // async gate's `await countLibraryAlbumsAsync()` microtask.
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockFetchAllAlbums).toHaveBeenCalled();
    expect(mockFetchAllArtists).toHaveBeenCalled();
    expect(mockFetchAllPlaylists).toHaveBeenCalled();
    expect(mockFetchGenres).toHaveBeenCalled();
  });

  it('skips album/artist fetch when synced, but ALWAYS refreshes playlists (online)', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    // Both phases complete: the album list and the song phase are ONE call now
    // (runNormalizedLibrarySync), so leaving songSyncComplete false would fire it for
    // the songs and there would be no album-only assertion to make.
    syncStatusStore.setState({ librarySyncComplete: true, songSyncComplete: true });
    artistLibraryState.artists = [{ id: 'ar1' }];
    playlistLibraryState.playlists = [{ id: 'p1' }];
    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
    expect(mockFetchAllArtists).not.toHaveBeenCalled();
    // Playlists now refresh on every online startup (delta/updated detection),
    // not just when the list is empty.
    expect(mockFetchAllPlaylists).toHaveBeenCalled();
    expect(mockFetchGenres).toHaveBeenCalled();
  });

  it('does not restart a sync that stopped on request errors', async () => {
    // This is the boot path, distinct from recoverStalledSync's foreground one. An error
    // pause always leaves the sync incomplete, so EVERY condition in the gate is true and
    // the next launch would restart it — which is what made the pause look like it never
    // happened. Resume and Restart on the sync card are the way out.
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({
      librarySyncPhase: 'paused-error',
      librarySyncComplete: false,
      songSyncComplete: false,
    });

    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);

    expect(mockRunNormalizedLibrarySync).not.toHaveBeenCalled();
    // Still paused after the launch, not quietly reset.
    expect(syncStatusStore.getState().librarySyncPhase).toBe('paused-error');
  });

  it('does not start a new sync after the user pauses the startup sync', async () => {
    // Pause bumps the generation and the startup run bails, which resolves the startup
    // library promise. Launching the song sync after that would undo the Pause.
    albumLibraryState.albums = [];
    syncStatusStore.setState({ librarySyncComplete: false, songSyncComplete: false });
    let finishFetch: () => void = () => undefined;
    mockFetchAllAlbums.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFetch = resolve; }),
    );

    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockRunNormalizedLibrarySync).toHaveBeenCalledTimes(1);

    cancelAllSyncs('user-cancel');
    finishFetch();
    await jest.advanceTimersByTimeAsync(2000);

    expect(mockRunNormalizedLibrarySync).toHaveBeenCalledTimes(1);
  });

  it('holds the fan-out and shows the prompt for an undetermined server version', async () => {
    mockVerdict = 'ask';
    try {
      await onStartup();
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockRunReid).toHaveBeenCalled();
      expect(mockFetchStarred).not.toHaveBeenCalled();
      expect(mockRunNormalizedLibrarySync).not.toHaveBeenCalled();
    } finally {
      mockVerdict = 'skip';
    }
  });

  it('runs the fan-out once legacy mode was chosen', async () => {
    mockVerdict = 'ask';
    mockLegacy = true;
    try {
      await onStartup();
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockRunReid).not.toHaveBeenCalled();
      expect(mockFetchStarred).toHaveBeenCalled();
    } finally {
      mockVerdict = 'skip';
      mockLegacy = false;
    }
  });

  it('does NOT refresh playlists on startup when offline', async () => {
    offlineState.offline = true;
    playlistLibraryState.playlists = [{ id: 'p1' }];
    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockFetchAllPlaylists).not.toHaveBeenCalled();
  });

  it('syncs online when the album list is complete but the song phase is not', async () => {
    // Per the upgrade framing: a complete list with an incomplete song walk still has
    // gaps, so the local migration alone is not enough.
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ librarySyncComplete: true, songSyncComplete: false });
    artistLibraryState.artists = [{ id: 'ar1' }];
    playlistLibraryState.playlists = [{ id: 'p1' }];
    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockFetchAllAlbums).toHaveBeenCalled();
  });

  it('syncs online when both phases are complete but an album has no songs', async () => {
    // The flags can both be true and the data still be short — a bailed walk, or a
    // migrated library whose album detail never arrived. Detect it and backfill.
    const db = getDb()!;
    db.runSync(
      "INSERT OR REPLACE INTO albums (id, name, sort_title) VALUES ('gap1', 'Gap', 'gap')",
    );
    albumLibraryState.albums = [{ id: 'gap1' }];
    syncStatusStore.setState({
      librarySyncComplete: true,
      songSyncComplete: true,
      songGapRepairAttempted: false,
    });
    artistLibraryState.artists = [{ id: 'ar1' }];
    playlistLibraryState.playlists = [{ id: 'p1' }];
    try {
      await onStartup();
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockFetchAllAlbums).toHaveBeenCalled();
    } finally {
      db.runSync("DELETE FROM albums WHERE id = 'gap1'");
    }
  });

  it('does NOT sync for an empty album the repair has already asked the server about', async () => {
    // Some albums are simply track-less on the server. The sync's per-album repair asks
    // and records the answer; without honouring that, this probe fires a full sync on
    // every launch and every online-resume, forever — for data that will never arrive.
    const db = getDb()!;
    db.runSync(
      "INSERT OR REPLACE INTO albums (id, name, sort_title) VALUES ('gap1', 'Gap', 'gap')",
    );
    albumLibraryState.albums = [{ id: 'gap1' }];
    syncStatusStore.setState({
      librarySyncComplete: true,
      songSyncComplete: true,
      songGapRepairAttempted: true,
    });
    artistLibraryState.artists = [{ id: 'ar1' }];
    playlistLibraryState.playlists = [{ id: 'p1' }];
    try {
      await onStartup();
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockFetchAllAlbums).not.toHaveBeenCalled();
    } finally {
      syncStatusStore.setState({ songGapRepairAttempted: false });
      db.runSync("DELETE FROM albums WHERE id = 'gap1'");
    }
  });

  it('does NOT refresh playlists on startup when the server is unreachable', async () => {
    mockConnectivity.isServerReachable = false;
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ librarySyncComplete: true });
    playlistLibraryState.playlists = [{ id: 'p1' }];
    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockFetchAllPlaylists).not.toHaveBeenCalled();
  });

});

describe('dataSyncService — performScope internal', () => {
  it('returns without calling any store method for non-pull scopes', async () => {
    await __internal.performScope('full-walk');
    await __internal.performScope('change-detect');
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
    expect(mockRefreshAll).not.toHaveBeenCalled();
  });
});

describe('dataSyncService — recoverStalledSync', () => {
  it('no-op when phase is idle', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    await recoverStalledSync();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });

  it('resumes when phase is syncing and online', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ detailSyncPhase: 'syncing', songSyncStrategy: 'basic' });
    await recoverStalledSync();
    // Recovery now delegates to the normalized sync, which resumes BOTH phases
    // from their persisted cursors rather than re-entering the old per-album walk.
    expect(mockFetchAllAlbums).toHaveBeenCalled();
  });

  it('resumes when phase is paused-offline and offline toggles off', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ detailSyncPhase: 'paused-offline', songSyncStrategy: 'basic' });
    await recoverStalledSync();
    // Recovery now delegates to the normalized sync, which resumes BOTH phases
    // from their persisted cursors rather than re-entering the old per-album walk.
    expect(mockFetchAllAlbums).toHaveBeenCalled();
  });

  it('stays paused-offline if still offline at recovery time', async () => {
    offlineState.offline = true;
    syncStatusStore.setState({ detailSyncPhase: 'syncing', songSyncStrategy: 'basic' });
    await recoverStalledSync();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    expect(syncStatusStore.getState().detailSyncPhase).toBe('paused-offline');
  });

  it.each([
    ['the SONG phase', { detailSyncPhase: 'paused-error' as const }],
    ['the ALBUM phase', { librarySyncPhase: 'paused-error' as const }],
  ])('leaves a sync paused by request errors alone when %s stopped', async (_label, patch) => {
    // The pause exists to tell the user WHY and hand them the controls. Resuming it on
    // foreground or boot hides that and runs straight back into the failing request.
    // An error-paused album phase also satisfies the `albumPhaseStalled` test below,
    // so both this and the phase list have to honour it.
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ ...patch, songSyncStrategy: 'basic', librarySyncComplete: false });

    await recoverStalledSync();

    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });

  it('resumes from error phase so users can retry after a failure', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ detailSyncPhase: 'error', songSyncStrategy: 'basic' });
    await recoverStalledSync();
    expect(mockFetchAllAlbums).toHaveBeenCalled();
  });
});

describe('dataSyncService — onAlbumReferenced', () => {
  it('is a no-op when offline', async () => {
    offlineState.offline = true;
    albumLibraryState.albums = [{ id: 'a1' }];
    await onAlbumReferenced('a2');
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
  });

  it('is a no-op when the library cache is cold (empty)', async () => {
    albumLibraryState.albums = [];
    await onAlbumReferenced('a1');
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
  });

  it('is a no-op when the album is already in the library', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }];
    await onAlbumReferenced('a1');
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
  });

  it('upserts only the referenced album when unknown and library is warm (no full refetch)', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    const mockGetAlbum = subsonicService.getAlbum as jest.Mock;
    mockGetAlbum.mockResolvedValue({ id: 'a99', name: 'New', song: [{ id: 't1' }] });
    await onAlbumReferenced('a99');
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
    expect(mockGetAlbum).toHaveBeenCalledWith('a99');
    // Merged into the library without the `song` array (lean AlbumID3[]).
    expect(mockUpsertAlbums).toHaveBeenCalledWith([{ id: 'a99', name: 'New' }]);
  });

  it('does not upsert when the single-album fetch returns nothing', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    (subsonicService.getAlbum as jest.Mock).mockResolvedValue(null);
    await onAlbumReferenced('a99');
    expect(mockUpsertAlbums).not.toHaveBeenCalled();
  });
});

describe('dataSyncService — detectChanges', () => {
  const mockGetRecentlyAdded = subsonicService.getRecentlyAddedAlbums as jest.Mock;

  beforeEach(() => {
    mockGetRecentlyAdded.mockReset();
    mockGetRecentlyAdded.mockResolvedValue([]);
    // Reset last-known markers for a clean baseline per test.
    syncStatusStore.getState().setLastKnownMarkers({
      lastChangeDetectionAt: null,
      lastKnownServerSongCount: null,
      lastKnownServerScanTime: null,
      lastKnownNewestAlbumId: null,
      lastKnownNewestAlbumCreated: null,
    });
  });

  it('returns empty when offline', async () => {
    offlineState.offline = true;
    const result = await detectChanges();
    expect(result.changedAlbumIds).toEqual([]);
    expect(mockGetRecentlyAdded).not.toHaveBeenCalled();
  });

  it('harvests new album IDs surfaced by the newest probe', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    mockGetRecentlyAdded.mockResolvedValueOnce([
      { id: 'a2', created: new Date('2026-04-15') },
      { id: 'a3', created: new Date('2026-04-14') },
      { id: 'a1', created: new Date('2020-01-01') },
    ]);
    const result = await detectChanges();
    // a2, a3 are new (not in library); a1 is already in library so excluded.
    expect(result.changedAlbumIds).toEqual(['a2', 'a3']);
  });

  it('updates lastKnown markers after every run', async () => {
    mockGetRecentlyAdded.mockResolvedValueOnce([
      { id: 'latest', created: new Date('2026-04-17') },
    ]);
    await detectChanges();
    expect(syncStatusStore.getState().lastKnownNewestAlbumId).toBe('latest');
    expect(syncStatusStore.getState().lastKnownNewestAlbumCreated).toBe(
      new Date('2026-04-17').getTime(),
    );
  });

  it('returns no IDs when the newest probe is unchanged', async () => {
    syncStatusStore.getState().setLastKnownMarkers({
      lastKnownNewestAlbumId: 'a1',
      lastKnownNewestAlbumCreated: new Date('2026-04-15').getTime(),
    });
    albumLibraryState.albums = [{ id: 'a1' }];
    mockGetRecentlyAdded.mockResolvedValueOnce([
      { id: 'a1', created: new Date('2026-04-15') },
    ]);
    const result = await detectChanges();
    expect(result.changedAlbumIds).toEqual([]);
  });

  it('id mismatch overrides unchanged timestamp (clock-skew guard)', async () => {
    syncStatusStore.getState().setLastKnownMarkers({
      lastKnownNewestAlbumId: 'OLD',
      lastKnownNewestAlbumCreated: new Date('2030-01-01').getTime(), // future
    });
    albumLibraryState.albums = [];
    mockGetRecentlyAdded.mockResolvedValueOnce([
      // Created is "older" than marker, but id is different — should still trigger
      { id: 'NEW', created: new Date('2026-04-15') },
    ]);
    const result = await detectChanges();
    expect(result.changedAlbumIds).toEqual(['NEW']);
  });

  it('overlapping calls collapse via in-flight map', async () => {
    let release: () => void;
    mockGetRecentlyAdded.mockImplementationOnce(
      () => new Promise<any[]>((r) => { release = () => r([]); }),
    );
    const first = detectChanges();
    const second = detectChanges();
    expect(mockGetRecentlyAdded).toHaveBeenCalledTimes(1);
    release!();
    await Promise.all([first, second]);
    expect(mockGetRecentlyAdded).toHaveBeenCalledTimes(1);
  });
});

describe('dataSyncService — forceFullResync', () => {
  it('bumps generation and runs the normalized library sync (full), not the legacy fetch', async () => {
    const beforeGen = syncStatusStore.getState().generation;

    await forceFullResync();

    expect(syncStatusStore.getState().generation).toBe(beforeGen + 1);
    // `reason` is diagnostic — it tags which call site asked, so an unexplained sync
    // (and the banner it drives) can be traced to its trigger from the log alone.
    expect(mockRunNormalizedLibrarySync).toHaveBeenCalledWith({
      full: true,
      reason: 'forceFullResync',
    });
    // The legacy blob-writing album fetch must NOT run — normalized is the sole writer.
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
  });

  it('bumps generation but skips the network sync when offline', async () => {
    offlineState.offline = true;
    const beforeGen = syncStatusStore.getState().generation;
    await forceFullResync();
    expect(syncStatusStore.getState().generation).toBe(beforeGen + 1);
    expect(mockRunNormalizedLibrarySync).not.toHaveBeenCalled();
  });
});

describe('dataSyncService — deferredDataSyncInit', () => {
  it('no-ops when offline', async () => {
    offlineState.offline = true;
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    albumLibraryState.albums = [{ id: 'a1' }];
    await deferredDataSyncInit();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });

  it('calls recoverStalledSync when online', async () => {
    syncStatusStore.setState({ detailSyncPhase: 'syncing', songSyncStrategy: 'basic' });
    albumLibraryState.albums = [{ id: 'a1' }];
    await deferredDataSyncInit();
    // Recovery delegates to the normalized sync (resumes both phases from cursors).
    expect(mockFetchAllAlbums).toHaveBeenCalled();
  });

  it('no-ops when no walk has been stalled', async () => {
    await deferredDataSyncInit();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });
});

describe('pausing a running sync', () => {
  it('takes the album phase out of "fetching" so the card can offer Resume', () => {
    // The album loop exits on its generation guard WITHOUT setting a phase. Left in
    // 'fetching' the card keeps spinning, `isSyncing` stays true, the Pause button
    // never becomes Resume, and the user cannot restart what they just paused.
    syncStatusStore.setState({ librarySyncPhase: 'fetching' });

    cancelAllSyncs('user-cancel');

    expect(syncStatusStore.getState().librarySyncPhase).toBe('idle');
  });

  it('leaves the phase alone for a force-resync, which sets its own', () => {
    syncStatusStore.setState({ librarySyncPhase: 'fetching' });

    cancelAllSyncs('force-resync');

    expect(syncStatusStore.getState().librarySyncPhase).toBe('fetching');
  });
});

describe('a ping after both launch checks timed out', () => {
  // Nothing else asks the server again until it first drops and comes back, so without
  // this a VPN still connecting at launch left every library write blocked all session.
  beforeEach(async () => {
    mockServerUpHook = null;
    authStore.setState({ isLoggedIn: true });
    offlineState.offline = false;
    await onStartup();
    mockRunReid.mockClear();
    mockWritesBlocked = true;
    mockAnswered = false;
  });
  afterEach(() => {
    mockWritesBlocked = null;
    mockAnswered = null;
  });

  it('runs the resume flow, which checks the server again', async () => {
    mockServerUpHook!();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRunReid).toHaveBeenCalled();
  });

  it('does nothing once the server has answered', async () => {
    mockAnswered = true;
    mockServerUpHook!();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRunReid).not.toHaveBeenCalled();
  });

  it('does nothing when writes are not blocked (every other install)', async () => {
    mockWritesBlocked = false;
    mockServerUpHook!();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRunReid).not.toHaveBeenCalled();
  });

  it('does nothing when logged out or in offline mode', async () => {
    authStore.setState({ isLoggedIn: false });
    mockServerUpHook!();
    authStore.setState({ isLoggedIn: true });
    offlineState.offline = true;
    mockServerUpHook!();
    offlineState.offline = false;
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRunReid).not.toHaveBeenCalled();
  });

  it('is registered on a launch that started in offline mode', async () => {
    mockServerUpHook = null;
    await onOnlineResume();
    expect(mockServerUpHook).not.toBeNull();
  });
});
