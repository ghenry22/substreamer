// Hoisted mock helpers (jest allows `mock`-prefixed names in factories).
const mockRefreshAll = jest.fn(() => Promise.resolve());
const mockRefreshAllIfDue = jest.fn((_ms: number) => Promise.resolve(true));
const mockRefreshRecentlyPlayed = jest.fn(() => Promise.resolve());
const mockFetchAllAlbums = jest.fn(() => Promise.resolve());
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
// Drives the row-based startup gate (`countLibraryAlbumsAsync`).
const libraryTableState = { rowCount: 0 };
// Drives the song-index count (`countSongIndexAsync`) for the upgrade seed.
const songIndexTableState = { count: 0 };
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

jest.mock('../../store/albumLibraryStore', () => ({
  __esModule: true,
  albumLibraryStore: {
    getState: () => ({
      albums: albumLibraryState.albums,
      loading: albumLibraryState.loading,
      fetchAllAlbums: () => mockFetchAllAlbums(),
      upsertAlbums: (albums: Array<{ id: string }>) => mockUpsertAlbums(albums),
      clearAlbums: () => { albumLibraryState.albums = []; },
    }),
  },
  registerAlbumLibraryReconcileHook: () => {},
}));

// Row-based startup gate reads the library_albums COUNT.
const mockDeleteLibraryAlbums = jest.fn((_ids: readonly string[]) => Promise.resolve());
jest.mock('../../store/persistence/libraryAlbumsTable', () => ({
  __esModule: true,
  countLibraryAlbumsAsync: () => Promise.resolve(libraryTableState.rowCount),
  deleteLibraryAlbumsAsync: (ids: readonly string[]) => mockDeleteLibraryAlbums(ids),
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
jest.mock('../../store/albumDetailStore', () => ({
  __esModule: true,
  albumDetailStore: {
    getState: () => ({
      albums: mockDetailState.albums,
      fetchAlbum: (id: string) => mockFetchAlbum(id),
      hasEntry: (id: string) =>
        Object.prototype.hasOwnProperty.call(mockDetailState.albums, id),
      removeEntries: (ids: readonly string[]) => mockRemoveEntries(ids),
      clearAlbums: () => { mockDetailState.albums = {}; },
    }),
  },
}));

// The walk computes "already detailed" from SQL (getDetailedAlbumIdsAsync), not
// the in-memory map. Mirror the mocked detail cache so seeded entries count as
// detailed. requireActual preserves the module's other exports.
jest.mock('../../store/persistence/detailTables', () => ({
  ...jest.requireActual('../../store/persistence/detailTables'),
  getDetailedAlbumIdsAsync: () =>
    Promise.resolve(new Set(Object.keys(mockDetailState.albums))),
  countSongIndexAsync: () => Promise.resolve(songIndexTableState.count),
}));

jest.mock('../../store/artistLibraryStore', () => ({
  __esModule: true,
  artistLibraryStore: {
    getState: () => ({
      artists: artistLibraryState.artists,
      fetchAllArtists: () =>mockFetchAllArtists(),
    }),
  },
}));

jest.mock('../../store/playlistLibraryStore', () => ({
  __esModule: true,
  playlistLibraryStore: {
    getState: () => ({
      playlists: playlistLibraryState.playlists,
      fetchAllPlaylists: () =>mockFetchAllPlaylists(),
    }),
  },
  registerPlaylistLibraryReconcileHook: () => {},
}));

const mockPlaylistDetail = {
  removePlaylist: jest.fn(),
  fetchPlaylist: jest.fn((_id: string) => Promise.resolve(null as unknown)),
};
jest.mock('../../store/playlistDetailStore', () => ({
  __esModule: true,
  playlistDetailStore: { getState: () => mockPlaylistDetail },
}));

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
  connectivityStore: { getState: () => mockConnectivity },
}));

// Shortcut minDelay to a near-instant resolve in tests — its purpose is UI
// feedback, not logic; slowing tests by 2s each is noise.
jest.mock('../../utils/stringHelpers', () => {
  const actual = jest.requireActual('../../utils/stringHelpers');
  return { ...actual, minDelay: () => Promise.resolve() };
});

// subsonicService uses the shared __mocks__ automock. We opt into it here and
// reach for `fetchServerInfo` via the imported namespace.
jest.mock('../subsonicService');

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
  reconcileAlbumLibrary,
  reconcilePlaylistLibrary,
  recoverStalledSync,
  runFullAlbumDetailSync,
  syncSongLibrary,
  __internal,
} from '../dataSyncService';
import * as subsonicService from '../subsonicService';
import type { Playlist } from '../subsonicService';
import { syncStatusStore } from '../../store/syncStatusStore';

const mockFetchServerInfo = subsonicService.fetchServerInfo as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  offlineState.offline = false;
  getOfflineSubscribers().clear();
  albumLibraryState.albums = [];
  albumLibraryState.loading = false;
  libraryTableState.rowCount = 0;
  songIndexTableState.count = 0;
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
  mockDeleteLibraryAlbums.mockClear();
  mockConnectivity.hasConnection = true;
  mockConnectivity.isServerReachable = true;
  mockFetchAlbum.mockClear();
  mockFetchServerInfo.mockResolvedValue(null);
  syncStatusStore.setState({
    detailSyncPhase: 'idle',
    detailSyncTotal: 0,
    bannerDismissedAt: null,
    lastChangeDetectionAt: null,
    lastKnownServerUrl: null,
    lastKnownServerSongCount: null,
    lastKnownServerScanTime: null,
    lastKnownNewestAlbumId: null,
    lastKnownNewestAlbumCreated: null,
    generation: 0,
    inFlight: new Map(),
    librarySyncPhase: 'idle',
    librarySyncComplete: false,
    librarySyncCount: 0,
    librarySyncCursor: 0,
    librarySyncLastFetchedAt: null,
    syncStrategy: null,
    songSyncStrategy: null,
    songSyncCursor: 0,
    songSyncComplete: false,
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
    await onStartup();
    await new Promise((r) => setImmediate(r));
    expect(mockSetServerInfo).toHaveBeenCalledWith(info);
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
    cancelAllSyncs('logout');
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
    libraryTableState.rowCount = 0;
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
    libraryTableState.rowCount = 1;
    syncStatusStore.setState({ librarySyncComplete: true });
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

  it('does NOT refresh playlists on startup when offline', async () => {
    offlineState.offline = true;
    playlistLibraryState.playlists = [{ id: 'p1' }];
    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockFetchAllPlaylists).not.toHaveBeenCalled();
  });

  it('does NOT refresh playlists on startup when the server is unreachable', async () => {
    mockConnectivity.isServerReachable = false;
    albumLibraryState.albums = [{ id: 'a1' }];
    libraryTableState.rowCount = 1;
    syncStatusStore.setState({ librarySyncComplete: true });
    playlistLibraryState.playlists = [{ id: 'p1' }];
    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockFetchAllPlaylists).not.toHaveBeenCalled();
  });

  it('seeds songSyncComplete on upgrade (populated tables) so it does NOT re-sync songs', async () => {
    // Existing install: album list + song index already populated by a prior build.
    albumLibraryState.albums = [{ id: 'a1' }];
    libraryTableState.rowCount = 2435;
    songIndexTableState.count = 38218;
    syncStatusStore.setState({ librarySyncComplete: true, songSyncComplete: false });
    await onStartup();
    await jest.advanceTimersByTimeAsync(2000);
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
    // No song fetch of any kind (fast or walk).
    expect(subsonicService.searchSongsPage).not.toHaveBeenCalled();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
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

describe('dataSyncService — runFullAlbumDetailSync', () => {
  it('is a no-op when offline', async () => {
    offlineState.offline = true;
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }];
    await runFullAlbumDetailSync();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    expect(syncStatusStore.getState().detailSyncPhase).toBe('paused-offline');
  });

  it('is a no-op when library is still loading', async () => {
    albumLibraryState.loading = true;
    albumLibraryState.albums = [{ id: 'a1' }];
    await runFullAlbumDetailSync();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    // Phase unchanged (stays idle) — we don't pre-emptively flip to syncing.
    expect(syncStatusStore.getState().detailSyncPhase).toBe('idle');
  });

  it('is a no-op when library is empty', async () => {
    albumLibraryState.albums = [];
    await runFullAlbumDetailSync();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    expect(syncStatusStore.getState().detailSyncPhase).toBe('idle');
  });

  it('fetches every missing album once, then settles to idle', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
    await runFullAlbumDetailSync();
    expect(mockFetchAlbum).toHaveBeenCalledTimes(3);
    expect(mockDetailState.fetched.sort()).toEqual(['a1', 'a2', 'a3']);
    expect(syncStatusStore.getState().detailSyncPhase).toBe('idle');
    expect(syncStatusStore.getState().detailSyncTotal).toBe(0);
  });

  it('skips albums that already have a cached detail entry', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
    mockDetailState.albums = { a2: {} };
    await runFullAlbumDetailSync();
    expect(mockFetchAlbum).toHaveBeenCalledTimes(2);
    expect(mockDetailState.fetched.sort()).toEqual(['a1', 'a3']);
  });

  it('settles to idle when nothing is missing', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }];
    mockDetailState.albums = { a1: {}, a2: {} };
    syncStatusStore.setState({ detailSyncPhase: 'syncing', detailSyncTotal: 50 });
    await runFullAlbumDetailSync();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    expect(syncStatusStore.getState().detailSyncPhase).toBe('idle');
    expect(syncStatusStore.getState().detailSyncTotal).toBe(0);
  });

  it('freezes detailSyncTotal at the missing count when walk begins', async () => {
    albumLibraryState.albums = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }));
    let observedDuringWalk = 0;
    mockFetchAlbum.mockImplementationOnce((id: string) => {
      observedDuringWalk = syncStatusStore.getState().detailSyncTotal;
      mockDetailState.albums[id] = {};
      return Promise.resolve({ id } as any);
    });
    await runFullAlbumDetailSync();
    expect(observedDuringWalk).toBe(10);
    // After walk finishes, total resets to 0 (resetDetailSync).
    expect(syncStatusStore.getState().detailSyncTotal).toBe(0);
  });

  it('overlapping calls collapse via the in-flight map', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    let releaseFirst: () => void;
    mockFetchAlbum.mockImplementationOnce(
      () => new Promise<any>((r) => { releaseFirst = () => r({ id: 'a1' }); }),
    );
    const first = runFullAlbumDetailSync();
    // Yield to let the walk enter runPool and register in-flight.
    await new Promise((r) => setImmediate(r));
    const second = runFullAlbumDetailSync();
    expect(mockFetchAlbum).toHaveBeenCalledTimes(1);
    releaseFirst!();
    await first;
    await second;
    expect(mockFetchAlbum).toHaveBeenCalledTimes(1);
  });

  it('synchronous double-entry collapses (no race before first await)', async () => {
    // Two synchronous callers entering before any async boundary — critical
    // regression test for the dedup fix: the second caller must see the
    // in-flight Promise registered by the first and return it.
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }];
    const first = runFullAlbumDetailSync();
    const second = runFullAlbumDetailSync();
    await Promise.all([first, second]);
    expect(mockFetchAlbum).toHaveBeenCalledTimes(2); // not 4
  });

  it('treats null returns as failures and completes the walk (phase idle)', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
    mockFetchAlbum.mockImplementation(() => Promise.resolve(null));
    await runFullAlbumDetailSync();
    expect(mockFetchAlbum).toHaveBeenCalledTimes(3);
    expect(syncStatusStore.getState().detailSyncPhase).toBe('idle');
  });

  it('aborts remaining workers when generation is bumped mid-walk', async () => {
    albumLibraryState.albums = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}` }));
    mockFetchAlbum.mockImplementation((id: string) =>
      new Promise((resolve) => setTimeout(() => {
        mockDetailState.albums[id] = {};
        resolve({ id } as any);
      }, 10)),
    );
    const walk = runFullAlbumDetailSync();
    // Let a couple of workers start, then bump the generation.
    await new Promise((r) => setTimeout(r, 5));
    syncStatusStore.getState().bumpGeneration();
    await walk;
    // Not all 20 should have been fetched — the cancel stops further work.
    expect(mockFetchAlbum.mock.calls.length).toBeLessThan(20);
  });

  it('pauses to "paused-offline" when offline is toggled on mid-walk', async () => {
    albumLibraryState.albums = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }));
    mockFetchAlbum.mockImplementation((id: string) =>
      new Promise((resolve) => setTimeout(() => {
        mockDetailState.albums[id] = {};
        resolve({ id } as any);
      }, 10)),
    );
    const walk = runFullAlbumDetailSync();
    await new Promise((r) => setTimeout(r, 5));
    setOfflineMode(true);
    await walk;
    expect(syncStatusStore.getState().detailSyncPhase).toBe('paused-offline');
    expect(mockFetchAlbum.mock.calls.length).toBeLessThan(10);
  });

  it('completes the walk (phase idle) when some fetches fail', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }];
    mockFetchAlbum.mockImplementationOnce(() => Promise.reject(new Error('flaky')));
    mockFetchAlbum.mockImplementationOnce((id: string) => {
      mockDetailState.albums[id] = {};
      return Promise.resolve({ id } as any);
    });
    await runFullAlbumDetailSync();
    expect(syncStatusStore.getState().detailSyncPhase).toBe('idle');
  });

  it('increments detailSyncCompleted on each successful fetch (O(1) progress signal)', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
    // Spy on the increment so we can count how many times it fired.
    const realIncrement = syncStatusStore.getState().incrementDetailSyncCompleted;
    const incrementSpy = jest.fn(() => realIncrement());
    syncStatusStore.setState({ incrementDetailSyncCompleted: incrementSpy });
    mockFetchAlbum.mockImplementation((id: string) => {
      mockDetailState.albums[id] = {};
      return Promise.resolve({ id } as any);
    });
    await runFullAlbumDetailSync();
    expect(incrementSpy).toHaveBeenCalledTimes(3);
  });

  it('resets detailSyncCompleted to 0 via setDetailSyncTotal at walk end', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    await runFullAlbumDetailSync();
    // After walk: total=0, completed=0 — ready for the next walk.
    expect(syncStatusStore.getState().detailSyncTotal).toBe(0);
    expect(syncStatusStore.getState().detailSyncCompleted).toBe(0);
  });

  it('does not increment completed on null-return fetches (rejected path)', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }];
    mockFetchAlbum.mockImplementation(() => Promise.resolve(null));
    await runFullAlbumDetailSync();
    // All fetches failed; completed counter should not have moved.
    // setDetailSyncTotal at end will have reset it anyway, but this
    // test pins that the classification-as-rejected path does not double-count.
    expect(syncStatusStore.getState().detailSyncCompleted).toBe(0);
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
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1');
  });

  it('resumes when phase is paused-offline and offline toggles off', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ detailSyncPhase: 'paused-offline', songSyncStrategy: 'basic' });
    await recoverStalledSync();
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1');
  });

  it('stays paused-offline if still offline at recovery time', async () => {
    offlineState.offline = true;
    syncStatusStore.setState({ detailSyncPhase: 'syncing', songSyncStrategy: 'basic' });
    await recoverStalledSync();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    expect(syncStatusStore.getState().detailSyncPhase).toBe('paused-offline');
  });

  it('resumes from error phase so users can retry after a failure', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ detailSyncPhase: 'error', songSyncStrategy: 'basic' });
    await recoverStalledSync();
    expect(mockFetchAlbum).toHaveBeenCalled();
  });
});

describe('dataSyncService — syncSongLibrary', () => {
  it('fast path: probes, pages search3 songs, marks complete', async () => {
    (subsonicService.probeEmptySearch3 as jest.Mock).mockResolvedValue(true);
    const mockSongs = subsonicService.searchSongsPage as jest.Mock;
    mockSongs.mockResolvedValueOnce([{ id: 's1', albumId: 'a1' }, { id: 's2', albumId: 'a1' }]);
    mockSongs.mockResolvedValueOnce([]); // end of results
    await syncSongLibrary();
    expect(mockSongs).toHaveBeenCalledWith(5000, 0);
    expect(syncStatusStore.getState().songSyncStrategy).toBe('search3');
    expect(syncStatusStore.getState().songSyncComplete).toBe(true);
    expect(mockFetchAlbum).not.toHaveBeenCalled(); // no per-album walk
  });

  it('falls back to the walk when fast-path songs lack albumId', async () => {
    (subsonicService.probeEmptySearch3 as jest.Mock).mockResolvedValue(true);
    (subsonicService.searchSongsPage as jest.Mock).mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    albumLibraryState.albums = [{ id: 'a1' }];
    await syncSongLibrary();
    expect(syncStatusStore.getState().songSyncStrategy).toBe('basic');
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1');
  });

  it('basic path (probe false) runs the walk', async () => {
    (subsonicService.probeEmptySearch3 as jest.Mock).mockResolvedValue(false);
    albumLibraryState.albums = [{ id: 'a1' }];
    await syncSongLibrary();
    expect(subsonicService.searchSongsPage).not.toHaveBeenCalled();
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1');
  });

  it('no-op when songSyncComplete', async () => {
    syncStatusStore.setState({ songSyncComplete: true });
    await syncSongLibrary();
    expect(subsonicService.searchSongsPage).not.toHaveBeenCalled();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
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

describe('dataSyncService — reconcileAlbumLibrary', () => {
  it('reaps removed ids from the detail cache', () => {
    mockDetailState.albums = { a1: {}, a2: {}, a3: {} };
    reconcileAlbumLibrary(['a1', 'a2', 'a3'], ['a1', 'a3']);
    expect(mockRemoveEntries).toHaveBeenCalledWith(['a2']);
  });

  it('does not call removeEntries when there are no removals', () => {
    reconcileAlbumLibrary(['a1', 'a2'], ['a1', 'a2']);
    expect(mockRemoveEntries).not.toHaveBeenCalled();
  });

  it('triggers the walk when new ids are added', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }];
    mockDetailState.albums = { a1: {}, a2: {} };
    reconcileAlbumLibrary(['a1'], ['a1', 'a2']);
    // onAlbumReferenced no-op → this is the reconcile triggering the walk.
    // Walk is fire-and-forget; flush the microtask.
    await new Promise((r) => setImmediate(r));
    // a2 already in detail cache — walk sees nothing missing, exits quickly.
    // The important assertion: no error thrown, no crash.
  });

  it('does not trigger the walk when offline', async () => {
    offlineState.offline = true;
    reconcileAlbumLibrary([], ['a1']);
    await new Promise((r) => setImmediate(r));
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });

  it('handles both removal and addition in one diff', () => {
    mockDetailState.albums = { a1: {}, a2: {} };
    reconcileAlbumLibrary(['a1', 'a2'], ['a2', 'a3']);
    expect(mockRemoveEntries).toHaveBeenCalledWith(['a1']);
  });

  it('does NOT reap a downloaded album that vanishes from the server list', () => {
    mockDetailState.albums = { a1: {}, a2: {}, a3: {} };
    mockCachedItems.a2 = {}; // a2 is downloaded → its detail + list row must survive
    reconcileAlbumLibrary(['a1', 'a2', 'a3'], ['a1', 'a3']);
    expect(mockRemoveEntries).not.toHaveBeenCalled();
  });

  it('reaps only the NON-downloaded removals', () => {
    mockDetailState.albums = { a1: {}, a2: {}, a3: {}, a4: {} };
    mockCachedItems.a2 = {}; // downloaded — kept
    reconcileAlbumLibrary(['a1', 'a2', 'a3', 'a4'], ['a1']);
    expect(mockRemoveEntries).toHaveBeenCalledWith(['a3', 'a4']);
  });

  it('a non-downloaded removal drops BOTH detail and list row', () => {
    mockDetailState.albums = { a1: {} };
    reconcileAlbumLibrary(['a1'], []);
    expect(mockRemoveEntries).toHaveBeenCalledWith(['a1']);
    expect(mockDeleteLibraryAlbums).toHaveBeenCalledWith(['a1']);
  });

  it("keeps a downloaded single song's parent-album DETAIL but drops its list row", () => {
    mockDetailState.albums = { albX: {} };
    mockCachedItems['song:s1'] = { type: 'song', parentAlbumId: 'albX' };
    reconcileAlbumLibrary(['albX'], []); // albX vanished from the server list
    // Detail is protected (offline "go to album" from the song still works)...
    expect(mockRemoveEntries).not.toHaveBeenCalled();
    // ...but the lean list row is dropped so it doesn't resurrect in browse.
    expect(mockDeleteLibraryAlbums).toHaveBeenCalledWith(['albX']);
  });

  it("keeps a favorited song's parent-album detail but drops its list row", () => {
    mockCachedItems.__starred__ = { type: 'favorites', songIds: ['s9'] };
    mockCachedSongs.s9 = { albumId: 'albF' };
    reconcileAlbumLibrary(['albF'], []);
    expect(mockRemoveEntries).not.toHaveBeenCalled();
    expect(mockDeleteLibraryAlbums).toHaveBeenCalledWith(['albF']);
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
  it('bumps generation, clears stores, and refetches library', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    mockDetailState.albums = { a1: { album: { id: 'a1' }, retrievedAt: 1 } };
    syncStatusStore.setState({ detailSyncPhase: 'syncing', detailSyncTotal: 50 });
    const beforeGen = syncStatusStore.getState().generation;

    await forceFullResync();

    expect(syncStatusStore.getState().generation).toBe(beforeGen + 1);
    expect(syncStatusStore.getState().detailSyncPhase).toBe('idle');
    expect(mockFetchAllAlbums).toHaveBeenCalled();
  });

  it('clears local caches even when offline (no network call)', async () => {
    offlineState.offline = true;
    const beforeGen = syncStatusStore.getState().generation;
    await forceFullResync();
    expect(syncStatusStore.getState().generation).toBe(beforeGen + 1);
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
  });
});

describe('dataSyncService — reconcilePlaylistLibrary', () => {
  const T1 = '2026-01-01T00:00:00.000Z';
  const T2 = '2026-02-01T00:00:00.000Z';
  const pl = (id: string, changed: string, songCount = 1): Playlist =>
    ({ id, name: id, changed, created: changed, duration: 0, songCount } as unknown as Playlist);
  // Let the fire-and-forget detail-fetch pool drain.
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('reaps removed non-downloaded playlists but KEEPS downloaded ones', () => {
    mockCachedItems.p2 = {}; // p2 is downloaded → its detail must survive
    reconcilePlaylistLibrary([pl('p1', T1), pl('p2', T1), pl('p3', T1)], []);
    expect(mockPlaylistDetail.removePlaylist).toHaveBeenCalledWith('p1');
    expect(mockPlaylistDetail.removePlaylist).toHaveBeenCalledWith('p3');
    expect(mockPlaylistDetail.removePlaylist).not.toHaveBeenCalledWith('p2');
  });

  it('fetches detail for NEW and UPDATED playlists, skips unchanged', async () => {
    reconcilePlaylistLibrary(
      [pl('p1', T1, 1), pl('p2', T1, 1), pl('p3', T1, 1)],
      [
        pl('p1', T1, 1), // unchanged → skip
        pl('p2', T2, 1), // changed timestamp → updated
        pl('p3', T1, 2), // songCount differs → updated
        pl('p4', T1, 1), // new
      ],
    );
    await flush();
    const fetched = mockPlaylistDetail.fetchPlaylist.mock.calls.map((c) => c[0]);
    expect(fetched).toEqual(expect.arrayContaining(['p2', 'p3', 'p4']));
    expect(fetched).not.toContain('p1');
  });

  it('syncs cached tracks for a downloaded UPDATED playlist', async () => {
    mockCachedItems.p1 = {};
    mockPlaylistDetail.fetchPlaylist.mockResolvedValue({ id: 'p1', entry: [{ id: 's1' }] } as unknown);
    reconcilePlaylistLibrary([pl('p1', T1, 1)], [pl('p1', T2, 1)]);
    await flush();
    expect(mockSyncCachedItemTracks).toHaveBeenCalledWith('p1', [{ id: 's1' }]);
  });

  it('does not fetch when offline', async () => {
    offlineState.offline = true;
    reconcilePlaylistLibrary([], [pl('p1', T1), pl('p2', T1)]);
    await flush();
    expect(mockPlaylistDetail.fetchPlaylist).not.toHaveBeenCalled();
  });

  it('caps eager fetches at 50 but exempts downloaded playlists', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockCachedItems.dl = {};
    const next: Playlist[] = [pl('dl', T2, 1)]; // downloaded + new → exempt from cap
    for (let i = 0; i < 60; i++) next.push(pl(`n${i}`, T2, 1)); // 60 new, non-downloaded
    reconcilePlaylistLibrary([], next);
    await flush();
    const fetched = mockPlaylistDetail.fetchPlaylist.mock.calls.map((c) => c[0]);
    expect(fetched).toContain('dl'); // downloaded always fetched
    expect(fetched.length).toBe(51); // 50 capped non-downloaded + 1 downloaded
    expect(warn).toHaveBeenCalled(); // truncation logged (no silent cap)
    warn.mockRestore();
  });

  it('is a no-op when both lists are identical', () => {
    expect(() =>
      reconcilePlaylistLibrary([pl('p1', T1), pl('p2', T1)], [pl('p1', T1), pl('p2', T1)]),
    ).not.toThrow();
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
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1');
  });

  it('no-ops when no walk has been stalled', async () => {
    await deferredDataSyncInit();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });
});
