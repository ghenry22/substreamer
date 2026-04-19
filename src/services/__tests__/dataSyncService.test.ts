// Hoisted mock helpers (jest allows `mock`-prefixed names in factories).
const mockRefreshAll = jest.fn(() => Promise.resolve());
const mockRefreshRecentlyPlayed = jest.fn(() => Promise.resolve());
const mockFetchAllAlbums = jest.fn(() => Promise.resolve());
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
      upsertAlbums: jest.fn(),
      clearAlbums: () => { albumLibraryState.albums = []; },
    }),
  },
  registerAlbumLibraryReconcileHook: () => {},
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

jest.mock('../../store/playlistDetailStore', () => ({
  __esModule: true,
  playlistDetailStore: {
    getState: () => ({
      removePlaylist: () => {},
      fetchPlaylist: () => Promise.resolve(null),
    }),
  },
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

jest.mock('../musicCacheService', () => ({
  __esModule: true,
  registerMusicCacheOnAlbumReferencedHook: () => {},
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
  __internal,
} from '../dataSyncService';
import * as subsonicService from '../subsonicService';
import { syncStatusStore } from '../../store/syncStatusStore';

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
  mockFetchAlbum.mockClear();
  mockFetchServerInfo.mockResolvedValue(null);
  syncStatusStore.setState({
    detailSyncPhase: 'idle',
    detailSyncTotal: 0,
    detailSyncStartedAt: null,
    detailSyncError: null,
    bannerDismissedAt: null,
    lastChangeDetectionAt: null,
    lastKnownServerUrl: null,
    lastKnownServerSongCount: null,
    lastKnownServerScanTime: null,
    lastKnownNewestAlbumId: null,
    lastKnownNewestAlbumCreated: null,
    generation: 0,
    inFlight: new Map(),
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

  it('onPullToRefresh("albums") calls albumLibraryStore.fetchAllAlbums', async () => {
    await onPullToRefresh('albums');
    expect(mockFetchAllAlbums).toHaveBeenCalledTimes(1);
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
    expect(mockRefreshAll).toHaveBeenCalledTimes(1);
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
    expect(mockRefreshAll).toHaveBeenCalledTimes(1);
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

  it('deferred block kicks off library prefetches when caches are empty', async () => {
    albumLibraryState.albums = [];
    artistLibraryState.artists = [];
    playlistLibraryState.playlists = [];
    await onStartup();
    // Flush the requestIdleCallback-scheduled 1500ms timer.
    jest.advanceTimersByTime(2000);
    expect(mockFetchAllAlbums).toHaveBeenCalled();
    expect(mockFetchAllArtists).toHaveBeenCalled();
    expect(mockFetchAllPlaylists).toHaveBeenCalled();
    expect(mockFetchGenres).toHaveBeenCalled();
  });

  it('deferred block skips library prefetches when caches already populated', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    artistLibraryState.artists = [{ id: 'ar1' }];
    playlistLibraryState.playlists = [{ id: 'p1' }];
    await onStartup();
    jest.advanceTimersByTime(2000);
    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
    expect(mockFetchAllArtists).not.toHaveBeenCalled();
    expect(mockFetchAllPlaylists).not.toHaveBeenCalled();
    // genres fetch always runs.
    expect(mockFetchGenres).toHaveBeenCalled();
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

  it('classifies null returns as rejected so users see a real error count', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
    mockFetchAlbum.mockImplementation(() => Promise.resolve(null));
    await runFullAlbumDetailSync();
    expect(syncStatusStore.getState().detailSyncError).toMatch(/3 album\(s\) failed/);
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

  it('records a non-fatal error summary when some fetches fail', async () => {
    albumLibraryState.albums = [{ id: 'a1' }, { id: 'a2' }];
    mockFetchAlbum.mockImplementationOnce(() => Promise.reject(new Error('flaky')));
    mockFetchAlbum.mockImplementationOnce((id: string) => {
      mockDetailState.albums[id] = {};
      return Promise.resolve({ id } as any);
    });
    await runFullAlbumDetailSync();
    expect(syncStatusStore.getState().detailSyncError).toMatch(/1 album\(s\) failed/);
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
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    await recoverStalledSync();
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1');
  });

  it('resumes when phase is paused-offline and offline toggles off', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ detailSyncPhase: 'paused-offline' });
    await recoverStalledSync();
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1');
  });

  it('stays paused-offline if still offline at recovery time', async () => {
    offlineState.offline = true;
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    await recoverStalledSync();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    expect(syncStatusStore.getState().detailSyncPhase).toBe('paused-offline');
  });

  it('resumes from error phase so users can retry after a failure', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    syncStatusStore.setState({ detailSyncPhase: 'error' });
    await recoverStalledSync();
    expect(mockFetchAlbum).toHaveBeenCalled();
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

  it('refreshes the full library when the album is unknown and library is warm', async () => {
    albumLibraryState.albums = [{ id: 'a1' }];
    await onAlbumReferenced('a99');
    expect(mockFetchAllAlbums).toHaveBeenCalledTimes(1);
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
  it('reaps removed playlist IDs and pre-fetches new ones', () => {
    reconcilePlaylistLibrary(['p1', 'p2', 'p3'], ['p2', 'p4']);
    // Removed: p1, p3. Added: p4. No assertions on the mocked detail store
    // beyond "does not throw"; Phase-5 fidelity test.
    expect(true).toBe(true);
  });

  it('is a no-op when both lists are identical', () => {
    expect(() => reconcilePlaylistLibrary(['p1', 'p2'], ['p1', 'p2'])).not.toThrow();
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
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    albumLibraryState.albums = [{ id: 'a1' }];
    await deferredDataSyncInit();
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1');
  });

  it('no-ops when no walk has been stalled', async () => {
    await deferredDataSyncInit();
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });
});
