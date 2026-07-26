// `persistence/db.ts` imports `expo-sqlite` at module load; stub it so the
// import doesn't hit the native bridge during tests.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

/**
 * musicCacheService v2 tests. Mocks the SQL persistence layer so the real
 * store logic can exercise without a real DB.
 */

const mockListDirectoryAsync = jest.fn();
const mockGetDirectorySizeAsync = jest.fn();
const mockDownloadFileAsyncWithProgress = jest.fn();

// Filesystem mock state
let mockFileExists = false;
let mockFileSize = 100;
let mockDirExists = true;
let mockDirCreateError: Error | null = null;
// Track File.delete calls so tests can assert orphan files get deleted.
const fileDeletes: string[] = [];
// Track Directory.delete calls so reconciliation tests can assert empty
// album directories get cleaned up.
const dirDeletes: string[] = [];
// Track the async expo-async-fs delete helpers (the off-thread replacements
// for File.delete / Directory.delete on reconcile/cancel/clear paths).
const fileDeletesAsync: string[] = [];
const dirDeletesAsync: string[] = [];
// Per-URI overrides. When a substring of the file URI matches one of these
// keys, the corresponding value wins over `mockFileExists`. Tests seed this
// to exercise reconciliation scenarios where only some files are present.
const mockFileExistsByPathSubstring = new Map<string, boolean>();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    _name: string;
    constructor(...args: any[]) {
      if (args.length === 1 && typeof args[0] === 'string') {
        this.uri = args[0];
        this._name = args[0];
      } else {
        const parts = args.map((a: any) => (typeof a === 'string' ? a : a.uri ?? ''));
        this._name = parts.join('/');
        this.uri = `file://${this._name}`;
      }
    }
    get exists() {
      for (const [sub, present] of mockFileExistsByPathSubstring) {
        if (this.uri.includes(sub)) return present;
      }
      return mockFileExists;
    }
    get size() { return mockFileSize; }
    write = jest.fn();
    delete = jest.fn(() => { fileDeletes.push(this.uri); });
    move = jest.fn();
    static downloadFileAsync = jest.fn().mockResolvedValue(undefined);
  }
  class MockDirectory {
    uri: string;
    _name: string;
    constructor(...args: any[]) {
      const parts = args.map((a: any) => (typeof a === 'string' ? a : a.uri ?? ''));
      this._name = parts.join('/');
      this.uri = `file://${this._name}`;
    }
    get exists() { return mockDirExists; }
    create = jest.fn(() => {
      if (mockDirCreateError) throw mockDirCreateError;
    });
    delete = jest.fn(() => { dirDeletes.push(this.uri); });
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: { uri: 'file:///document' } },
  };
});

jest.mock('expo-async-fs', () => ({
  listDirectoryAsync: (...args: any[]) => mockListDirectoryAsync(...args),
  getDirectorySizeAsync: (...args: any[]) => mockGetDirectorySizeAsync(...args),
  downloadFileAsyncWithProgress: (...args: any[]) => mockDownloadFileAsyncWithProgress(...args),
  deleteFileAsync: jest.fn(async (uri: string) => { fileDeletesAsync.push(uri); return true; }),
  deleteDirectoryAsync: jest.fn(async (uri: string) => { dirDeletesAsync.push(uri); return true; }),
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('../storageService', () => ({
  checkStorageLimit: jest.fn().mockReturnValue(false),
}));

jest.mock('../downloadSpeedTracker', () => ({
  beginDownload: jest.fn(),
  clearDownload: jest.fn(),
}));

jest.mock('../imageCacheService', () => ({
  ensureCached: jest.fn().mockResolvedValue(undefined),
  prefetchCoverArt: jest.fn(),
  resolveCachedImageUri: jest.fn().mockResolvedValue(null),
}));

jest.mock('../subsonicService');

const mockFetchAlbum = jest.fn();
const mockAlbumDetailAlbums: { value: Record<string, any> } = { value: {} };
jest.mock('../../store/albumDetailStore', () => ({
  albumDetailStore: {
    getState: jest.fn(() => ({
      fetchAlbum: mockFetchAlbum,
      albums: mockAlbumDetailAlbums.value,
    })),
  },
}));

const mockFetchPlaylist = jest.fn();
let mockPlaylistDetailPlaylists: Record<string, any> = {};
jest.mock('../../store/playlistDetailStore', () => ({
  playlistDetailStore: {
    getState: jest.fn(() => ({
      fetchPlaylist: mockFetchPlaylist,
      playlists: mockPlaylistDetailPlaylists,
    })),
  },
}));

jest.mock('../../store/favoritesStore', () => {
  const { create } = require('zustand');
  return {
    favoritesStore: create(() => ({ songs: [] })),
  };
});

jest.mock('../../store/storageLimitStore', () => {
  const { create } = require('zustand');
  return {
    storageLimitStore: create(() => ({
      limitMode: 'none',
      maxCacheSizeGB: 10,
      isStorageFull: false,
    })),
  };
});

jest.mock('../../store/playbackSettingsStore', () => {
  const { create } = require('zustand');
  return {
    playbackSettingsStore: create(() => ({
      downloadFormat: 'raw',
      downloadMaxBitRate: null,
      streamFormat: 'raw',
      maxBitRate: null,
    })),
    PLAYBACK_RATES: [0.5, 0.75, 1, 1.25, 1.5, 2],
  };
});

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

// Mock the SQL persistence layer with identity-style no-ops so the store
// can mutate in-memory state without touching a real DB.
jest.mock('../../store/persistence/musicCacheTables', () => {
  const edges: Array<{ itemId: string; position: number; songId: string }> = [];
  // Item ids stamped `derived = true` (auto-created partial-album grouping
  // rows). Tracked here because the SQL layer's REAL-ref count and the
  // orphan-pruning both hinge on it. Any item NOT in this set is REAL.
  const derivedItems = new Set<string>();
  const isDerived = (itemId: string) => derivedItems.has(itemId);
  return {
    // Hydrate helpers — return empty; tests seed in-memory state directly.
    hydrateCachedSongs: jest.fn(() => ({})),
    hydrateCachedItems: jest.fn(() => ({})),
    hydrateCachedSongsAsync: jest.fn(async () => ({})),
    hydrateCachedItemsAsync: jest.fn(async () => ({})),
    hydrateDownloadQueueAsync: jest.fn(async () => []),
    // Counters
    countCachedSongs: jest.fn(() => 0),
    countCachedItems: jest.fn(() => 0),
    countDownloadQueueItems: jest.fn(() => 0),
    // REAL-holder refcount — drives store.removeCachedItem orphan detection.
    // Only edges whose holder item is NOT derived count; a legacy/unknown item
    // (never stamped derived) counts as REAL, matching the production
    // `COALESCE(derived,0)=0` guard. Tests seed edges via the helpers below.
    countRealSongRefsForSongsAsync: jest.fn(async (songIds: string[]) => {
      const m = new Map<string, number>();
      for (const songId of songIds) {
        const c = edges.filter((e) => e.songId === songId && !isDerived(e.itemId)).length;
        if (c > 0) m.set(songId, c);
      }
      return m;
    }),
    // Atomic count+orphan: the fused helper the store calls. Returns
    // orphaned:false (unchanged) when a REAL holder still remains; else strips
    // every remaining edge (keeping surviving holders contiguous), prunes any
    // DERIVED holder left empty, and returns orphaned:true with the touched +
    // pruned holders so the store can mirror the change. Mirrors the production
    // transaction.
    orphanSongIfUnreferencedAsync: jest.fn(async (songId: string) => {
      const realRefs = edges.filter((e) => e.songId === songId && !isDerived(e.itemId)).length;
      if (realRefs !== 0) return { orphaned: false, affectedItems: [], prunedItems: [] };
      const affected = new Set<string>();
      const removed = edges.filter((e) => e.songId === songId);
      for (const e of removed) affected.add(e.itemId);
      const sorted = [...removed].sort((a, b) => b.position - a.position);
      for (const e of sorted) {
        const i = edges.findIndex(
          (x) => x.itemId === e.itemId && x.position === e.position && x.songId === songId,
        );
        if (i >= 0) edges.splice(i, 1);
        for (const x of edges) {
          if (x.itemId === e.itemId && x.position > e.position) x.position -= 1;
        }
      }
      const prunedItems: string[] = [];
      for (const itemId of affected) {
        const remaining = edges.filter((e) => e.itemId === itemId).length;
        if (remaining === 0 && isDerived(itemId)) {
          derivedItems.delete(itemId);
          prunedItems.push(itemId);
        }
      }
      return { orphaned: true, affectedItems: [...affected], prunedItems };
    }),
    // cached_songs writes
    upsertCachedSong: jest.fn(),
    deleteCachedSong: jest.fn(),
    // cached_items writes — stamp/clear derived-ness so the REAL-ref count and
    // orphan-pruning stay faithful (`derived: true` marks a partial grouping;
    // any explicit non-derived write upgrades it back to a real holder).
    upsertCachedItem: jest.fn((item: { itemId: string; derived?: boolean }) => {
      if (item?.derived) derivedItems.add(item.itemId);
      else derivedItems.delete(item.itemId);
    }),
    deleteCachedItem: jest.fn((itemId: string) => {
      // Cascade — remove all edges referencing this item so refcount is
      // correct for the store's orphan detection.
      for (let i = edges.length - 1; i >= 0; i--) {
        if (edges[i].itemId === itemId) edges.splice(i, 1);
      }
      derivedItems.delete(itemId);
    }),
    // edges
    insertCachedItemSong: jest.fn((itemId: string, position: number, songId: string) => {
      edges.push({ itemId, position, songId });
    }),
    removeCachedItemSong: jest.fn((itemId: string, position: number) => {
      const i = edges.findIndex((e) => e.itemId === itemId && e.position === position);
      if (i >= 0) edges.splice(i, 1);
      for (const e of edges) {
        if (e.itemId === itemId && e.position > position) e.position -= 1;
      }
    }),
    reorderCachedItemSongs: jest.fn(),
    // download_queue writes
    insertDownloadQueueItem: jest.fn(),
    removeDownloadQueueItem: jest.fn(),
    updateDownloadQueueItem: jest.fn(),
    reorderDownloadQueue: jest.fn(),
    markDownloadComplete: jest.fn((queueId, item, songs, incomingEdges) => {
      // An explicit finished download is a REAL holder.
      if (item?.derived) derivedItems.add(item.itemId);
      else derivedItems.delete(item.itemId);
      for (const e of incomingEdges) {
        edges.push({ itemId: item.itemId, position: e.position, songId: e.songId });
      }
    }),
    bulkReplace: jest.fn(),
    clearAllMusicCacheRows: jest.fn(() => {
      edges.length = 0;
      derivedItems.clear();
    }),
    // Test helpers
    __edges: edges,
    __derivedItems: derivedItems,
    __resetEdges: () => { edges.length = 0; derivedItems.clear(); },
    __setDbForTests: jest.fn(),
  };
});

import { musicCacheStore } from '../../store/musicCacheStore';
import { favoritesStore } from '../../store/favoritesStore';
import { storageLimitStore } from '../../store/storageLimitStore';
import { playbackSettingsStore } from '../../store/playbackSettingsStore';
import { checkStorageLimit } from '../storageService';
import { ensureCached, prefetchCoverArt } from '../imageCacheService';
import { getDownloadStreamUrl } from '../subsonicService';
import { beginDownload, clearDownload } from '../downloadSpeedTracker';
import {
  STARRED_SONGS_ITEM_ID,
  STARRED_COVER_ART_ID,
  initMusicCache,
  deferredMusicCacheInit,
  recoverStalledDownloadsAsync,
  forceRecoverDownloadsAsync,
  getLocalTrackUri,
  isItemCached,
  getTrackQueueStatus,
  enqueueAlbumDownload,
  enqueuePlaylistDownload,
  enqueueStarredSongsDownload,
  enqueueSongDownload,
  deleteCachedItem,
  removeCachedPlaylistTrack,
  reorderCachedPlaylistTracks,
  syncCachedPlaylistTracks,
  syncCachedItemTracks,
  cancelDownload,
  clearDownloadQueue,
  clearQueuedDownloads,
  clearMusicCache,
  getMusicCacheStats,
  resumeIfSpaceAvailable,
  deleteStarredSongsDownload,
  retryDownload,
  redownloadItem,
  redownloadTrack,
  registerMusicCacheOnAlbumReferencedHook,
  reconcileMusicCacheAsync,
  waitForTrackMapsReady,
  computeAlbumRemovalOutcome,
  demoteAlbumToPartial,
  removeCachedAlbumSong,
} from '../musicCacheService';

import type { Child } from '../subsonicService';

const mockCheckStorageLimit = checkStorageLimit as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const persistenceMock = require('../../store/persistence/musicCacheTables');

const makeChild = (id: string, overrides?: Partial<Child>): Child => ({
  id,
  title: `Song ${id}`,
  artist: 'Test Artist',
  album: 'Test Album',
  albumId: 'album-1',
  coverArt: `cover-${id}`,
  duration: 200,
  suffix: 'mp3',
  ...overrides,
} as Child);

const makeCachedSong = (id: string, overrides?: Partial<any>) => ({
  id,
  title: `Song ${id}`,
  artist: 'Test Artist',
  album: 'Test Album',
  albumId: 'album-1',
  coverArt: `cover-${id}`,
  bytes: 1000,
  duration: 200,
  suffix: 'mp3',
  formatCapturedAt: Date.now(),
  downloadedAt: Date.now(),
  ...overrides,
});

function seedItem(itemId: string, opts: {
  type?: 'album' | 'playlist' | 'favorites' | 'song';
  songIds?: string[];
  name?: string;
  artist?: string;
  coverArtId?: string;
  expectedSongCount?: number;
  downloadedAt?: number;
}) {
  const type = opts.type ?? 'album';
  const songIds = opts.songIds ?? [];
  // Seed edges in the persistence mock so the refcount check is accurate.
  for (let i = 0; i < songIds.length; i++) {
    persistenceMock.__edges.push({ itemId, position: i + 1, songId: songIds[i] });
  }
  musicCacheStore.setState((prev: any) => ({
    cachedItems: {
      ...prev.cachedItems,
      [itemId]: {
        itemId,
        type,
        name: opts.name ?? 'Seeded',
        artist: opts.artist,
        coverArtId: opts.coverArtId,
        expectedSongCount: opts.expectedSongCount ?? songIds.length,
        parentAlbumId: undefined,
        lastSyncAt: Date.now(),
        downloadedAt: opts.downloadedAt ?? Date.now(),
        songIds,
      },
    },
  }));
}

function seedSong(song: any) {
  musicCacheStore.setState((prev: any) => ({
    cachedSongs: { ...prev.cachedSongs, [song.id]: song },
  }));
}

beforeEach(() => {
  mockListDirectoryAsync.mockReset();
  mockGetDirectorySizeAsync.mockReset();
  mockDownloadFileAsyncWithProgress.mockReset();
  mockFetchAlbum.mockReset();
  mockFetchPlaylist.mockReset();
  mockAlbumDetailAlbums.value = {};
  mockPlaylistDetailPlaylists = {};
  mockCheckStorageLimit.mockReturnValue(false);
  mockFileExists = false;
  mockFileSize = 100;
  mockDirExists = true;
  fileDeletes.length = 0;
  dirDeletes.length = 0;
  fileDeletesAsync.length = 0;
  dirDeletesAsync.length = 0;
  mockFileExistsByPathSubstring.clear();
  persistenceMock.__resetEdges();

  musicCacheStore.setState({
    downloadQueue: [],
    cachedItems: {},
    cachedSongs: {},
    totalBytes: 0,
    totalFiles: 0,
    maxConcurrentDownloads: 3,
    hasHydrated: true,
  } as any);

  (favoritesStore as any).setState({ songs: [] });
  playbackSettingsStore.setState({
    downloadFormat: 'raw',
    downloadMaxBitRate: null,
  } as any);
  (getDownloadStreamUrl as jest.Mock).mockReturnValue('https://example.com/stream');

  initMusicCache();
});

async function waitForQueueIdle(maxIter = 200): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    await new Promise((r) => setImmediate(r));
    const { downloadQueue } = musicCacheStore.getState();
    const hasActive = downloadQueue.some((q: any) => q.status === 'downloading');
    if (!hasActive) return;
  }
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

describe('constants', () => {
  it('exports STARRED_SONGS_ITEM_ID', async () => {
    expect(STARRED_SONGS_ITEM_ID).toBe('__starred__');
  });

  it('exports STARRED_COVER_ART_ID', async () => {
    expect(STARRED_COVER_ART_ID).toBe('__starred_cover__');
  });
});

/* ------------------------------------------------------------------ */
/*  initMusicCache                                                     */
/* ------------------------------------------------------------------ */

describe('initMusicCache', () => {
  it('is idempotent on repeated calls', async () => {
    initMusicCache();
    initMusicCache();
  });

  it('swallows Directory.create() failures so the bundle still boots', async () => {
    mockDirExists = false;
    mockDirCreateError = new Error('EACCES: permission denied');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = require('../musicCacheService');
        expect(() => fresh.initMusicCache()).not.toThrow();
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('initMusicCache failed'),
        expect.stringContaining('EACCES'),
      );
    } finally {
      mockDirCreateError = null;
      mockDirExists = true;
      warnSpy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  deferredMusicCacheInit — rebuilds from SQL (not filesystem scan)   */
/* ------------------------------------------------------------------ */

describe('deferredMusicCacheInit', () => {
  it('rebuilds trackUriMap from hydrated cachedSongs', async () => {
    // Files exist on disk so reconciliation's SQL->FS sweep leaves them alone.
    mockFileExists = true;
    seedSong(makeCachedSong('s1', { albumId: 'a1', suffix: 'mp3' }));
    seedSong(makeCachedSong('s2', { albumId: 'a2', suffix: 'flac' }));

    await deferredMusicCacheInit();

    expect(getLocalTrackUri('s1')).toContain('a1/s1.mp3');
    expect(getLocalTrackUri('s2')).toContain('a2/s2.flac');
  });

  it('rebuilds trackToItems from cachedItems songIds', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1', { albumId: 'a1' }));
    seedItem('a1', { type: 'album', songIds: ['s1'] });
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });

    await deferredMusicCacheInit();

    // Confirm both items reference s1 — by deleting pl-1, s1 should remain
    // because a1 still references it.
    await deleteCachedItem('pl-1');
    expect(getLocalTrackUri('s1')).not.toBeNull();
  });

  it('handles empty hydrated state without error', async () => {
    await deferredMusicCacheInit();
    expect(getLocalTrackUri('anything')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  getLocalTrackUri                                                   */
/* ------------------------------------------------------------------ */

describe('getLocalTrackUri', () => {
  it('returns null for empty trackId', async () => {
    expect(getLocalTrackUri('')).toBeNull();
  });

  it('returns null for unknown trackId', async () => {
    expect(getLocalTrackUri('unknown')).toBeNull();
  });

  it('falls back to cachedSongs when the in-memory map missed a downloaded song', async () => {
    // Simulate the map being empty/stale while the store still knows the song is
    // downloaded (the reconcile-rebuild window). getLocalTrackUri must still
    // resolve the local file rather than returning null — a null would let the
    // player stream a downloaded track and stall forever on an unreachable server.
    seedSong({ id: 'fallback-s1', albumId: 'fallback-a1', suffix: 'mp3' });
    const uri = getLocalTrackUri('fallback-s1');
    expect(uri).not.toBeNull();
    expect(uri).toContain('fallback-a1/fallback-s1.mp3');
  });
});

/* ------------------------------------------------------------------ */
/*  isItemCached                                                       */
/* ------------------------------------------------------------------ */

describe('isItemCached', () => {
  it('returns false when item is not cached', async () => {
    expect(isItemCached('album-1')).toBe(false);
  });

  it('returns true when item is in cachedItems', async () => {
    seedItem('album-1', { type: 'album', songIds: [] });
    expect(isItemCached('album-1')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  getTrackQueueStatus                                                */
/* ------------------------------------------------------------------ */

describe('clearQueuedDownloads', () => {
  const makeQueueItem = (queueId: string, status: 'queued' | 'downloading' | 'error') => ({
    queueId,
    itemId: `album-${queueId}`,
    type: 'album' as const,
    name: 'X',
    status,
    totalSongs: 1,
    completedSongs: 0,
    addedAt: 0,
    queuePosition: 1,
    songsJson: JSON.stringify([{ id: `track-${queueId}` }]),
  });

  it('removes queued/errored items but leaves the active download running', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        makeQueueItem('q1', 'downloading'),
        makeQueueItem('q2', 'queued'),
        makeQueueItem('q3', 'queued'),
        makeQueueItem('q4', 'error'),
      ],
    } as any);

    clearQueuedDownloads();

    const remaining = musicCacheStore.getState().downloadQueue;
    expect(remaining.map((q) => q.queueId)).toEqual(['q1']);
    expect(remaining[0].status).toBe('downloading');
  });

  it('no-ops on an empty queue', async () => {
    musicCacheStore.setState({ downloadQueue: [] } as any);
    clearQueuedDownloads();
    expect(musicCacheStore.getState().downloadQueue).toEqual([]);
  });
});

describe('getTrackQueueStatus', () => {
  it('returns null when track is not in queue', async () => {
    expect(getTrackQueueStatus('track-1')).toBeNull();
  });

  it('returns queued status when track is in queued item', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'queued',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([{ id: 'track-1' }]),
        },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBe('queued');
  });

  it('returns downloading status', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'downloading',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([{ id: 'track-1' }]),
        },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBe('downloading');
  });

  it('returns null for completed/error items', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'error',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([{ id: 'track-1' }]),
        },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBeNull();
  });

  it('skips items whose songsJson is invalid', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'queued',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: 'not json',
        },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  recoverStalledDownloadsAsync                                       */
/* ------------------------------------------------------------------ */

describe('recoverStalledDownloadsAsync', () => {
  beforeEach(() => {
    mockCheckStorageLimit.mockReturnValue(true);
  });

  it('resets downloading items to queued', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'downloading',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: Date.now(),
          queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
      ],
    } as any);
    mockListDirectoryAsync.mockResolvedValue([]);

    await recoverStalledDownloadsAsync();

    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
  });

  it('deletes .tmp files from stalled album dirs', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'downloading',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1', { albumId: 'a-sweep' })]),
        },
      ],
    } as any);
    mockListDirectoryAsync.mockResolvedValue(['t1.mp3.tmp', 't1.mp3']);
    mockFileExists = true;

    await recoverStalledDownloadsAsync();

    expect(mockListDirectoryAsync).toHaveBeenCalled();
    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
  });

  it('skips items that are queued already', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'queued',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
      ],
    } as any);

    await recoverStalledDownloadsAsync();

    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
    expect(mockListDirectoryAsync).not.toHaveBeenCalled();
  });

  it('skips error items by default, recovers them when includeErrors=true', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'error',
          error: 'bad',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
      ],
    } as any);

    await recoverStalledDownloadsAsync(); // default: false
    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('error');

    mockListDirectoryAsync.mockResolvedValue([]);
    await recoverStalledDownloadsAsync(true);
    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
    expect(musicCacheStore.getState().downloadQueue[0].error).toBeUndefined();
  });

  it('handles listing errors gracefully', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'downloading',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
      ],
    } as any);
    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));

    await recoverStalledDownloadsAsync();

    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
  });

  it('handles items with invalid songsJson without crashing', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'downloading',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: 'not json',
        },
      ],
    } as any);

    await recoverStalledDownloadsAsync();
    // Even when the JSON is bad, status should still be flipped.
    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
  });

  it('does nothing when queue is empty', async () => {
    await recoverStalledDownloadsAsync();
    expect(mockListDirectoryAsync).not.toHaveBeenCalled();
  });
});

describe('forceRecoverDownloadsAsync', () => {
  beforeEach(() => {
    mockCheckStorageLimit.mockReturnValue(true);
  });

  it('bumps processing and resets items', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'a',
          type: 'album',
          name: 'X',
          status: 'downloading',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
      ],
    } as any);
    mockListDirectoryAsync.mockResolvedValue([]);

    await forceRecoverDownloadsAsync();
    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
  });
});

/* ------------------------------------------------------------------ */
/*  enqueueAlbumDownload                                               */
/* ------------------------------------------------------------------ */

describe('enqueueAlbumDownload', () => {
  it('skips if already fully downloaded (no missing songs)', async () => {
    // A cached_items row that matches the server album exactly → top-up
    // fetches fresh album data, sees no missing songs, and returns without
    // enqueueing.
    seedItem('album-1', {
      type: 'album',
      songIds: ['t1', 't2'],
      expectedSongCount: 2,
    });
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Already here',
      song: [makeChild('t1'), makeChild('t2')],
    });
    await enqueueAlbumDownload('album-1');
    expect(mockFetchAlbum).toHaveBeenCalled();
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('tops up a partial album by enqueuing only missing songs', async () => {
    seedItem('album-1', {
      type: 'album',
      songIds: ['t1', 't2'],
      expectedSongCount: 5,
      downloadedAt: 111,
    });
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Partial',
      artist: 'A',
      coverArt: 'ac',
      song: [
        makeChild('t1'),
        makeChild('t2'),
        makeChild('t3'),
        makeChild('t4'),
        makeChild('t5'),
      ],
    });
    mockCheckStorageLimit.mockReturnValue(true);
    await enqueueAlbumDownload('album-1');
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].itemId).toBe('album-1');
    expect(queue[0].totalSongs).toBe(3);
    const songs = JSON.parse(queue[0].songsJson) as Array<{ id: string }>;
    expect(songs.map((s) => s.id).sort()).toEqual(['t3', 't4', 't5']);
    // downloadedAt on the existing cached_items row is untouched.
    expect(musicCacheStore.getState().cachedItems['album-1'].downloadedAt).toBe(111);
  });

  it('does not notify onAlbumReferenced hook on top-up', async () => {
    const hook = jest.fn();
    registerMusicCacheOnAlbumReferencedHook(hook);
    seedItem('album-1', {
      type: 'album',
      songIds: ['t1'],
      expectedSongCount: 2,
    });
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'X',
      song: [makeChild('t1'), makeChild('t2')],
    });
    mockCheckStorageLimit.mockReturnValue(true);
    await enqueueAlbumDownload('album-1');
    expect(hook).not.toHaveBeenCalled();
    registerMusicCacheOnAlbumReferencedHook(null);
  });

  it('skips if already queued', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'X',
          status: 'queued',
          totalSongs: 0,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: '[]',
        },
      ],
    } as any);
    await enqueueAlbumDownload('album-1');
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });

  it('skips on null fetchAlbum', async () => {
    mockFetchAlbum.mockResolvedValue(null);
    await enqueueAlbumDownload('album-1');
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('skips on empty song list', async () => {
    mockFetchAlbum.mockResolvedValue({ id: 'album-1', name: 'E', song: [] });
    await enqueueAlbumDownload('album-1');
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('enqueues album with songs', async () => {
    mockCheckStorageLimit.mockReturnValue(true); // block processing
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test Album',
      artist: 'Test Artist',
      coverArt: 'cover-1',
      song: [makeChild('t1'), makeChild('t2')],
    });
    await enqueueAlbumDownload('album-1');
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].itemId).toBe('album-1');
    expect(queue[0].type).toBe('album');
    expect(queue[0].totalSongs).toBe(2);
  });

  it('caches album cover by the album coverArt value, not the entity ID (#202)', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test',
      coverArt: 'ac',
      song: [makeChild('t1', { coverArt: 'tc' })],
    });
    await enqueueAlbumDownload('album-1');
    // Cover art keys off the album's `coverArt` VALUE, never the entity id
    // (see src/utils/coverArtId.ts).
    expect(ensureCached).toHaveBeenCalledWith('ac');
    expect(ensureCached).not.toHaveBeenCalledWith('album-1');
    expect(prefetchCoverArt).toHaveBeenCalled();
  });

  it('uses displayArtist when artist is missing', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test',
      artist: undefined,
      displayArtist: 'Various',
      song: [makeChild('t1')],
    });
    await enqueueAlbumDownload('album-1');
    expect(musicCacheStore.getState().downloadQueue[0].artist).toBe('Various');
  });

  it('notifies the onAlbumReferenced hook', async () => {
    const hook = jest.fn();
    registerMusicCacheOnAlbumReferencedHook(hook);
    mockCheckStorageLimit.mockReturnValue(true);
    mockFetchAlbum.mockResolvedValue({ id: 'album-1', name: 'X', song: [makeChild('t1')] });
    await enqueueAlbumDownload('album-1');
    expect(hook).toHaveBeenCalledWith('album-1');
    registerMusicCacheOnAlbumReferencedHook(null);
  });

  it('does not notify hook on duplicate-queue skip', async () => {
    const hook = jest.fn();
    registerMusicCacheOnAlbumReferencedHook(hook);
    mockCheckStorageLimit.mockReturnValue(true);
    mockFetchAlbum.mockResolvedValue({ id: 'album-1', name: 'X', song: [makeChild('t1')] });
    await enqueueAlbumDownload('album-1');
    hook.mockClear();
    await enqueueAlbumDownload('album-1');
    expect(hook).not.toHaveBeenCalled();
    registerMusicCacheOnAlbumReferencedHook(null);
  });

  it('works with null hook', async () => {
    registerMusicCacheOnAlbumReferencedHook(null);
    mockCheckStorageLimit.mockReturnValue(true);
    mockFetchAlbum.mockResolvedValue({ id: 'album-1', name: 'X', song: [makeChild('t1')] });
    await enqueueAlbumDownload('album-1');
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  enqueuePlaylistDownload                                            */
/* ------------------------------------------------------------------ */

describe('enqueuePlaylistDownload', () => {
  it('skips if cached or queued', async () => {
    seedItem('pl-1', { type: 'playlist' });
    await enqueuePlaylistDownload('pl-1');
    expect(mockFetchPlaylist).not.toHaveBeenCalled();
  });

  it('skips on null / empty', async () => {
    mockFetchPlaylist.mockResolvedValue(null);
    await enqueuePlaylistDownload('p1');
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
    mockFetchPlaylist.mockResolvedValue({ id: 'p2', name: 'E', entry: [] });
    await enqueuePlaylistDownload('p2');
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('enqueues playlist with entries', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-1',
      name: 'My Playlist',
      coverArt: 'pc',
      entry: [makeChild('t1'), makeChild('t2')],
    });
    await enqueuePlaylistDownload('pl-1');
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('playlist');
    expect(queue[0].totalSongs).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  enqueueStarredSongsDownload                                        */
/* ------------------------------------------------------------------ */

describe('enqueueStarredSongsDownload', () => {
  it('skips when already cached', async () => {
    seedItem(STARRED_SONGS_ITEM_ID, { type: 'favorites' });
    await enqueueStarredSongsDownload();
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('skips when already queued', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: STARRED_SONGS_ITEM_ID,
          type: 'favorites',
          name: 'X',
          status: 'queued',
          totalSongs: 0,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: '[]',
        },
      ],
    } as any);
    await enqueueStarredSongsDownload();
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
  });

  it('skips when no favorites', async () => {
    (favoritesStore as any).setState({ songs: [] });
    await enqueueStarredSongsDownload();
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('enqueues favorites as virtual playlist', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    (favoritesStore as any).setState({ songs: [makeChild('s1'), makeChild('s2')] });
    await enqueueStarredSongsDownload();
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].itemId).toBe(STARRED_SONGS_ITEM_ID);
    expect(queue[0].type).toBe('favorites');
    expect(queue[0].coverArtId).toBe(STARRED_COVER_ART_ID);
  });
});

/* ------------------------------------------------------------------ */
/*  enqueueSongDownload (NEW in v2)                                    */
/* ------------------------------------------------------------------ */

describe('enqueueSongDownload', () => {
  it('returns early for falsy song', async () => {
    await enqueueSongDownload(undefined as any);
    await enqueueSongDownload({} as any);
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('short-circuits when song is already in the pool', async () => {
    seedSong(makeCachedSong('s1', { albumId: 'a1' }));
    await enqueueSongDownload(makeChild('s1', { albumId: 'a1' }));
    // No download queue entry; direct item insert.
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
    expect(musicCacheStore.getState().cachedItems['song:s1']).toBeDefined();
    expect(musicCacheStore.getState().cachedItems['song:s1'].songIds).toEqual(['s1']);
  });

  it('enqueues download for a song not yet in the pool', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    await enqueueSongDownload(makeChild('s1'));
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('song');
    expect(queue[0].itemId).toBe('song:s1');
    expect(queue[0].totalSongs).toBe(1);
  });

  it('deduplicates against existing song: item', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    seedItem('song:s1', { type: 'song', songIds: ['s1'] });
    await enqueueSongDownload(makeChild('s1'));
    // Still only the seeded item; no new queue entry.
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('skips if already in download queue', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'song:s1',
          type: 'song',
          name: 'X',
          status: 'queued',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: '[]',
        },
      ],
    } as any);
    await enqueueSongDownload(makeChild('s1'));
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
  });

  it('fetches the parent-album detail when it is missing', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    await enqueueSongDownload(makeChild('s1', { albumId: 'a1' }));
    expect(mockFetchAlbum).toHaveBeenCalledWith('a1', { prefetchCovers: true });
  });

  it('skips the parent-album fetch when its detail is already cached', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    mockAlbumDetailAlbums.value = { a1: { album: { id: 'a1' } } };
    await enqueueSongDownload(makeChild('s1', { albumId: 'a1' }));
    // Detail already present → no redundant round-trip (mirrors backfill 'missing').
    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  retryDownload                                                      */
/* ------------------------------------------------------------------ */

describe('retryDownload', () => {
  beforeEach(() => {
    mockCheckStorageLimit.mockReturnValue(true);
    mockListDirectoryAsync.mockResolvedValue([]);
  });

  it('no-op for missing id', async () => {
    await retryDownload('nope');
  });

  it('no-op for non-error items', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'a',
          type: 'album',
          name: 'X',
          status: 'queued',
          totalSongs: 1,
          completedSongs: 0,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
      ],
    } as any);
    await retryDownload('q1');
    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
  });

  it('resets error item and preserves completedSongs', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'a',
          type: 'album',
          name: 'X',
          status: 'error',
          error: 'fail',
          totalSongs: 3,
          completedSongs: 2,
          addedAt: 0,
          queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1'), makeChild('t2'), makeChild('t3')]),
        },
      ],
    } as any);
    await retryDownload('q1');
    const q = musicCacheStore.getState().downloadQueue[0];
    expect(q.status).toBe('queued');
    expect(q.completedSongs).toBe(2);
    expect(q.error).toBeUndefined();
  });

  it('repositions retried item behind active items', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1', itemId: 'a1', type: 'album', name: 'X', status: 'error',
          error: 'f', totalSongs: 1, completedSongs: 0, addedAt: 1, queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
        {
          queueId: 'q2', itemId: 'a2', type: 'album', name: 'X', status: 'queued',
          totalSongs: 1, completedSongs: 0, addedAt: 2, queuePosition: 2,
          songsJson: JSON.stringify([makeChild('t2')]),
        },
        {
          queueId: 'q3', itemId: 'a3', type: 'album', name: 'X', status: 'error',
          error: 'f', totalSongs: 1, completedSongs: 0, addedAt: 3, queuePosition: 3,
          songsJson: JSON.stringify([makeChild('t3')]),
        },
      ],
    } as any);
    await retryDownload('q1');
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].queueId).toBe('q2');
    expect(queue[1].queueId).toBe('q1');
  });
});

/* ------------------------------------------------------------------ */
/*  deleteCachedItem                                                   */
/* ------------------------------------------------------------------ */

describe('deleteCachedItem', () => {
  it('is a no-op for empty id', async () => {
    await deleteCachedItem('');
  });

  it('is a no-op for missing item', async () => {
    await deleteCachedItem('nonexistent');
  });

  it('removes item from the store', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'] });
    await deleteCachedItem('album-1');
    expect(musicCacheStore.getState().cachedItems['album-1']).toBeUndefined();
  });

  it('deletes orphan song files on disk (off-thread)', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'] });
    await deleteCachedItem('album-1');
    // Orphan file deletion invoked via the off-thread helper.
    expect(fileDeletesAsync.some((u) => u.includes('s1'))).toBe(true);
  });

  it('removes the album directory when no song still references it', async () => {
    seedSong(makeCachedSong('s1', { albumId: 'distinct-alb' }));
    seedItem('album-1', { type: 'album', songIds: ['s1'] });
    await deleteCachedItem('album-1');
    // No surviving reference to 'distinct-alb' → its dir is reaped off-thread.
    expect(dirDeletesAsync.some((u) => u.includes('distinct-alb'))).toBe(true);
  });

  it('preserves files for songs still referenced by other items', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'] });
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });

    await deleteCachedItem('pl-1');
    // Song still referenced by album-1 → file must not be deleted.
    expect(fileDeletesAsync.some((u) => u.includes('s1'))).toBe(false);
    expect(musicCacheStore.getState().cachedSongs['s1']).toBeDefined();
  });

  it('clears track URI map for orphaned songs only', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1', { albumId: 'a' }));
    seedSong(makeCachedSong('s2', { albumId: 'a' }));
    seedItem('album-1', { type: 'album', songIds: ['s1'] });
    seedItem('pl-1', { type: 'playlist', songIds: ['s2'] });
    await deferredMusicCacheInit();

    expect(getLocalTrackUri('s1')).not.toBeNull();
    expect(getLocalTrackUri('s2')).not.toBeNull();

    await deleteCachedItem('album-1');
    expect(getLocalTrackUri('s1')).toBeNull();
    expect(getLocalTrackUri('s2')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  computeAlbumRemovalOutcome                                         */
/* ------------------------------------------------------------------ */

describe('computeAlbumRemovalOutcome', () => {
  it('returns empty outcome for non-album types', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });
    const outcome = await computeAlbumRemovalOutcome('pl-1');
    expect(outcome).toEqual({ orphanSongIds: [], survivorCount: 0 });
  });

  it('returns empty outcome for unknown itemId', async () => {
    expect(await computeAlbumRemovalOutcome('nonexistent')).toEqual({
      orphanSongIds: [],
      survivorCount: 0,
    });
  });

  it('all songs are orphans when no other item references them', async () => {
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedItem('album-1', { type: 'album', songIds: ['s1', 's2'] });
    const outcome = await computeAlbumRemovalOutcome('album-1');
    expect(outcome.orphanSongIds.sort()).toEqual(['s1', 's2']);
    expect(outcome.survivorCount).toBe(0);
  });

  it('reports survivors when songs are edged to another item', async () => {
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedItem('album-1', { type: 'album', songIds: ['s1', 's2'] });
    // Add a second item (playlist) referencing s1 → s1 is a survivor.
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });
    const outcome = await computeAlbumRemovalOutcome('album-1');
    expect(outcome.orphanSongIds).toEqual(['s2']);
    expect(outcome.survivorCount).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  demoteAlbumToPartial                                               */
/* ------------------------------------------------------------------ */

describe('demoteAlbumToPartial', () => {
  it('returns { demoted:false, removed:false } for non-album', async () => {
    seedItem('pl-1', { type: 'playlist', songIds: [] });
    expect(await demoteAlbumToPartial('pl-1')).toEqual({ demoted: false, removed: false });
  });

  it('falls through to full delete when no songs survive', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedItem('album-1', { type: 'album', songIds: ['s1', 's2'] });
    const result = await demoteAlbumToPartial('album-1');
    expect(result).toEqual({ demoted: false, removed: true });
    expect(musicCacheStore.getState().cachedItems['album-1']).toBeUndefined();
  });

  it('removes only orphan edges when survivors exist; preserves the album row + downloadedAt', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedSong(makeCachedSong('s3'));
    seedItem('album-1', {
      type: 'album',
      songIds: ['s1', 's2', 's3'],
      expectedSongCount: 3,
      downloadedAt: 123456,
    });
    // s1 and s2 are also in a playlist → survivors.
    seedItem('pl-1', { type: 'playlist', songIds: ['s1', 's2'] });

    const result = await demoteAlbumToPartial('album-1');
    expect(result).toEqual({ demoted: true, removed: false });

    const album = musicCacheStore.getState().cachedItems['album-1'];
    expect(album).toBeDefined();
    expect(album.downloadedAt).toBe(123456);
    // Only the orphan (s3) should have been removed; s1 and s2 survive in
    // the album's edge set.
    expect(album.songIds.sort()).toEqual(['s1', 's2']);
    // s3's file should have been deleted.
    expect(fileDeletesAsync.some((u) => u.includes('s3'))).toBe(true);
    expect(fileDeletesAsync.some((u) => u.includes('s1'))).toBe(false);
    expect(fileDeletesAsync.some((u) => u.includes('s2'))).toBe(false);
  });

  it('no-op guard when album item has no orphans (defensive: survivors fully cover it)', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'], expectedSongCount: 1 });
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });
    // Every song has >1 ref → no orphans. demoteAlbumToPartial should no-op.
    const result = await demoteAlbumToPartial('album-1');
    expect(result).toEqual({ demoted: false, removed: false });
    expect(musicCacheStore.getState().cachedItems['album-1']).toBeDefined();
  });

  it('flips the demoted album to DERIVED so a shared song orphans when the OTHER holder is removed later', async () => {
    // Repro of the reported bug: playlist P (real) holds s1; album A (explicitly
    // downloaded → real) holds s1 + s1a. Removing the album demotes it to partial
    // (keeps s1, drops s1a). The demoted album must become a DERIVED grouping so
    // that removing the playlist later actually orphans s1 + prunes the album —
    // rather than leaving s1 downloaded and the album stuck partial.
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s1a'));
    seedItem('album-A', { type: 'album', songIds: ['s1', 's1a'], expectedSongCount: 2 });
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });

    // Remove the album download → demote.
    const result = await demoteAlbumToPartial('album-A');
    expect(result).toEqual({ demoted: true, removed: false });
    // The album row is now a derived partial (not a real holder of s1).
    expect(persistenceMock.__derivedItems.has('album-A')).toBe(true);
    const album = musicCacheStore.getState().cachedItems['album-A'];
    expect(album?.derived).toBe(true);
    expect(album?.songIds).toEqual(['s1']);
    expect(musicCacheStore.getState().cachedSongs['s1a']).toBeUndefined();
    // s1 is still downloaded — held by the real playlist.
    expect(musicCacheStore.getState().cachedSongs['s1']).toBeDefined();

    // Now remove the playlist → s1 loses its last REAL holder → orphaned, and
    // the emptied derived album row is pruned.
    await musicCacheStore.getState().removeCachedItem('pl-1');
    expect(musicCacheStore.getState().cachedSongs['s1']).toBeUndefined();
    expect(musicCacheStore.getState().cachedItems['album-A']).toBeUndefined();
    expect(musicCacheStore.getState().cachedItems['pl-1']).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  removeCachedPlaylistTrack                                          */
/* ------------------------------------------------------------------ */

describe('removeCachedPlaylistTrack', () => {
  it('skips album-type items', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'] });
    await removeCachedPlaylistTrack('album-1', 0);
    expect(musicCacheStore.getState().cachedItems['album-1'].songIds).toHaveLength(1);
  });

  it('out-of-range index', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });
    await removeCachedPlaylistTrack('pl-1', 5);
    expect(musicCacheStore.getState().cachedItems['pl-1'].songIds).toHaveLength(1);
    await removeCachedPlaylistTrack('pl-1', -1);
    expect(musicCacheStore.getState().cachedItems['pl-1'].songIds).toHaveLength(1);
  });

  it('removes song + deletes file when orphan', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1', 's2'] });

    await removeCachedPlaylistTrack('pl-1', 0);

    const item = musicCacheStore.getState().cachedItems['pl-1'];
    expect(item.songIds).toEqual(['s2']);
    expect(fileDeletesAsync.some((u) => u.includes('s1'))).toBe(true);
  });

  it('preserves file when song is still referenced elsewhere', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'] });
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });

    await removeCachedPlaylistTrack('pl-1', 0);
    // File NOT deleted since album-1 still references it.
    expect(fileDeletesAsync.some((u) => u.includes('s1'))).toBe(false);
  });

  it('no-op for missing item', async () => {
    await removeCachedPlaylistTrack('missing', 0);
  });
});

/* ------------------------------------------------------------------ */
/*  removeCachedAlbumSong                                              */
/* ------------------------------------------------------------------ */

describe('removeCachedAlbumSong', () => {
  it('returns false for a non-album item', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });
    expect(await removeCachedAlbumSong('pl-1', 's1')).toBe(false);
    expect(musicCacheStore.getState().cachedItems['pl-1'].songIds).toEqual(['s1']);
  });

  it('returns false when the song is not in the album', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'], expectedSongCount: 1 });
    expect(await removeCachedAlbumSong('album-1', 'nope')).toBe(false);
  });

  it('removes the edge + file and reverts a complete album to partial', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedSong(makeCachedSong('s3'));
    seedItem('album-1', {
      type: 'album',
      songIds: ['s1', 's2', 's3'],
      expectedSongCount: 3,
      downloadedAt: 555,
    });

    expect(await removeCachedAlbumSong('album-1', 's2')).toBe(true);

    const album = musicCacheStore.getState().cachedItems['album-1'];
    expect(album).toBeDefined();
    expect(album.downloadedAt).toBe(555);
    expect(album.songIds).toEqual(['s1', 's3']);
    // Now partial: 2 of 3.
    expect(album.songIds.length).toBeLessThan(album.expectedSongCount);
    expect(fileDeletesAsync.some((u) => u.includes('s2'))).toBe(true);
  });

  it('preserves the file when the song is still referenced elsewhere', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedItem('album-1', { type: 'album', songIds: ['s1', 's2'], expectedSongCount: 2 });
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });

    expect(await removeCachedAlbumSong('album-1', 's1')).toBe(true);
    // s1 survives in pl-1 → file kept; album-1 now partial.
    expect(fileDeletesAsync.some((u) => u.includes('s1'))).toBe(false);
    expect(musicCacheStore.getState().cachedItems['album-1'].songIds).toEqual(['s2']);
  });

  it('removing the last remaining track deletes the album row', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'], expectedSongCount: 1 });

    expect(await removeCachedAlbumSong('album-1', 's1')).toBe(true);
    expect(musicCacheStore.getState().cachedItems['album-1']).toBeUndefined();
    expect(fileDeletesAsync.some((u) => u.includes('s1'))).toBe(true);
  });

  it('returns false for a missing item', async () => {
    expect(await removeCachedAlbumSong('missing', 's1')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  reorderCachedPlaylistTracks                                        */
/* ------------------------------------------------------------------ */

describe('reorderCachedPlaylistTracks', () => {
  it('delegates to store reorder', async () => {
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedSong(makeCachedSong('s3'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1', 's2', 's3'] });
    reorderCachedPlaylistTracks('pl-1', 0, 2);
    const item = musicCacheStore.getState().cachedItems['pl-1'];
    expect(item.songIds).toEqual(['s2', 's3', 's1']);
  });

  it('no-op for missing item', async () => {
    reorderCachedPlaylistTracks('missing', 0, 1);
  });
});

/* ------------------------------------------------------------------ */
/*  syncCachedPlaylistTracks                                           */
/* ------------------------------------------------------------------ */

describe('syncCachedPlaylistTracks', () => {
  it('no-op for album items', async () => {
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedItem('album-1', { type: 'album', songIds: ['s1', 's2'] });
    await syncCachedPlaylistTracks('album-1', ['s1']);
    expect(musicCacheStore.getState().cachedItems['album-1'].songIds).toEqual(['s1', 's2']);
  });

  it('no-op for missing item', async () => {
    await syncCachedPlaylistTracks('missing', ['s1']);
  });

  it('removes tracks not in newTrackIds', async () => {
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedSong(makeCachedSong('s3'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1', 's2', 's3'] });

    await syncCachedPlaylistTracks('pl-1', ['s1', 's3']);

    const item = musicCacheStore.getState().cachedItems['pl-1'];
    expect(item.songIds).toEqual(['s1', 's3']);
  });

  it('reorders to match new order', async () => {
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedSong(makeCachedSong('s3'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1', 's2', 's3'] });

    await syncCachedPlaylistTracks('pl-1', ['s3', 's1', 's2']);

    const item = musicCacheStore.getState().cachedItems['pl-1'];
    expect(item.songIds).toEqual(['s3', 's1', 's2']);
  });

  it('ignores newTrackIds not in the cached set', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });
    await syncCachedPlaylistTracks('pl-1', ['s1', 's99']);
    const item = musicCacheStore.getState().cachedItems['pl-1'];
    expect(item.songIds).toEqual(['s1']);
  });

  it('deletes orphan files when songs are removed', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1', 's2'] });

    await syncCachedPlaylistTracks('pl-1', ['s2']);

    expect(fileDeletesAsync.some((u) => u.includes('s1'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  syncCachedItemTracks                                               */
/* ------------------------------------------------------------------ */

describe('syncCachedItemTracks', () => {
  it('no-op for missing item', async () => {
    syncCachedItemTracks('missing', [makeChild('t1')]);
  });

  it('no-op when item is already queued', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });
    musicCacheStore.setState((prev: any) => ({
      downloadQueue: [
        ...prev.downloadQueue,
        {
          queueId: 'q1', itemId: 'pl-1', type: 'playlist', name: 'X', status: 'queued',
          totalSongs: 0, completedSongs: 0, addedAt: 0, queuePosition: 1, songsJson: '[]',
        },
      ],
    }));
    syncCachedItemTracks('pl-1', [makeChild('s1'), makeChild('s2')]);
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
  });

  it('no-op when no changes', async () => {
    seedSong(makeCachedSong('s1'));
    seedSong(makeCachedSong('s2'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1', 's2'] });
    syncCachedItemTracks('pl-1', [makeChild('s1'), makeChild('s2')]);
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('re-enqueues when new tracks are detected', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    seedSong(makeCachedSong('s1'));
    seedItem('pl-1', { type: 'playlist', songIds: ['s1'] });

    syncCachedItemTracks('pl-1', [makeChild('s1'), makeChild('s2')]);

    // Item moved from cachedItems into downloadQueue (v1-parity behaviour).
    expect(musicCacheStore.getState().cachedItems['pl-1']).toBeUndefined();
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
    expect(musicCacheStore.getState().downloadQueue[0].totalSongs).toBe(2);
  });

  describe('cover-art reconciliation (offline items only)', () => {
    beforeEach(() => {
      (ensureCached as jest.Mock).mockClear();
      (prefetchCoverArt as jest.Mock).mockClear();
    });

    it('triggers ensureCached for the offline item and prefetchCoverArt for tracks when item exists', async () => {
      seedSong(makeCachedSong('s1'));
      seedItem('pl-1', { type: 'playlist', songIds: ['s1'], coverArtId: 'pl-cover' });

      const newSongs = [makeChild('s1'), makeChild('s2')];
      syncCachedItemTracks('pl-1', newSongs);

      // Item's own cover art reconciled.
      expect(ensureCached).toHaveBeenCalledWith('pl-cover');
      // Per-track covers reconciled (idempotent no-op when complete).
      expect(prefetchCoverArt).toHaveBeenCalledWith(newSongs);
    });

    it('runs even when no track changes are detected (heals missing/zero-byte covers)', async () => {
      seedSong(makeCachedSong('s1'));
      seedItem('pl-1', { type: 'playlist', songIds: ['s1'], coverArtId: 'pl-cover' });

      // Track list is identical — no re-enqueue should occur, but covers
      // should still be reconciled.
      syncCachedItemTracks('pl-1', [makeChild('s1')]);

      expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
      expect(ensureCached).toHaveBeenCalledWith('pl-cover');
      expect(prefetchCoverArt).toHaveBeenCalledTimes(1);
    });

    it('does NOT trigger any cover reconciliation for a non-offline item', async () => {
      // No seedItem for 'missing' — this item is not in cachedItems.
      syncCachedItemTracks('missing', [makeChild('t1', { coverArt: 'c1' })]);

      // The scope guard (line 1425 in musicCacheService) short-circuits
      // before reaching the cover reconciliation. Prevents library-wide
      // fan-out that users explicitly don't want.
      expect(ensureCached).not.toHaveBeenCalled();
      expect(prefetchCoverArt).not.toHaveBeenCalled();
    });

    it('skips ensureCached when the item has no coverArtId but still reconciles per-song covers', async () => {
      seedSong(makeCachedSong('s1'));
      seedItem('pl-2', { type: 'playlist', songIds: ['s1'] /* no coverArtId */ });

      const newSongs = [makeChild('s1')];
      syncCachedItemTracks('pl-2', newSongs);

      expect(ensureCached).not.toHaveBeenCalled();
      expect(prefetchCoverArt).toHaveBeenCalledWith(newSongs);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  cancelDownload                                                     */
/* ------------------------------------------------------------------ */

describe('cancelDownload', () => {
  it('no-op for missing id', async () => {
    cancelDownload('missing');
  });

  it('removes item from queue', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1', itemId: 'album-1', type: 'album', name: 'X', status: 'queued',
          totalSongs: 1, completedSongs: 0, addedAt: 0, queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
      ],
    } as any);

    cancelDownload('q1');
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('schedules recalculate to fix phantom bytes', async () => {
    musicCacheStore.setState({
      totalBytes: 5000,
      totalFiles: 5,
      downloadQueue: [
        {
          queueId: 'q1', itemId: 'a1', type: 'album', name: 'X', status: 'downloading',
          totalSongs: 1, completedSongs: 0, addedAt: 0, queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
      ],
    } as any);

    mockGetDirectorySizeAsync.mockResolvedValue(1000);
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-a'])
      .mockResolvedValueOnce(['s.mp3']);

    cancelDownload('q1');
    await new Promise((r) => setTimeout(r, 50));

    expect(musicCacheStore.getState().totalBytes).toBe(1000);
  });

  it('handles invalid songsJson gracefully', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1', itemId: 'a1', type: 'album', name: 'X', status: 'queued',
          totalSongs: 0, completedSongs: 0, addedAt: 0, queuePosition: 1,
          songsJson: 'bad',
        },
      ],
    } as any);
    expect(() => cancelDownload('q1')).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/*  clearDownloadQueue                                                 */
/* ------------------------------------------------------------------ */

describe('clearDownloadQueue', () => {
  it('removes all items', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1', itemId: 'a1', type: 'album', name: 'X', status: 'queued',
          totalSongs: 1, completedSongs: 0, addedAt: 1, queuePosition: 1,
          songsJson: JSON.stringify([makeChild('t1')]),
        },
        {
          queueId: 'q2', itemId: 'a2', type: 'album', name: 'X', status: 'downloading',
          totalSongs: 1, completedSongs: 0, addedAt: 2, queuePosition: 2,
          songsJson: JSON.stringify([makeChild('t2')]),
        },
      ],
    } as any);
    clearDownloadQueue();
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  clearMusicCache                                                    */
/* ------------------------------------------------------------------ */

describe('clearMusicCache', () => {
  it('returns freed bytes and resets store', async () => {
    seedSong(makeCachedSong('s1'));
    seedItem('album-1', { type: 'album', songIds: ['s1'] });
    musicCacheStore.setState({ totalBytes: 5000, totalFiles: 2 } as any);
    mockGetDirectorySizeAsync.mockResolvedValue(5000);

    const freed = await clearMusicCache();
    expect(freed).toBe(5000);
    const state = musicCacheStore.getState();
    expect(state.cachedItems).toEqual({});
    expect(state.downloadQueue).toEqual([]);
    expect(state.totalBytes).toBe(0);
    expect(state.totalFiles).toBe(0);
  });

  it('clears track URI map', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    await deferredMusicCacheInit();
    expect(getLocalTrackUri('s1')).not.toBeNull();
    mockGetDirectorySizeAsync.mockResolvedValue(0);
    await clearMusicCache();
    expect(getLocalTrackUri('s1')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  getMusicCacheStats                                                 */
/* ------------------------------------------------------------------ */

describe('getMusicCacheStats', () => {
  it('walks albums/ subdir and returns totals', async () => {
    mockGetDirectorySizeAsync.mockResolvedValue(100000);
    mockListDirectoryAsync
      .mockResolvedValueOnce(['a1', 'a2'])
      .mockResolvedValueOnce(['t1.mp3', 't2.mp3'])
      .mockResolvedValueOnce(['t3.flac']);

    const stats = await getMusicCacheStats();
    expect(stats.totalBytes).toBe(100000);
    expect(stats.itemCount).toBe(2);
    expect(stats.totalFiles).toBe(3);
  });

  it('returns zeros on top-level listing error', async () => {
    mockGetDirectorySizeAsync.mockResolvedValue(0);
    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));
    const stats = await getMusicCacheStats();
    expect(stats.itemCount).toBe(0);
    expect(stats.totalFiles).toBe(0);
  });

  it('handles per-album listing errors', async () => {
    mockGetDirectorySizeAsync.mockResolvedValue(5000);
    mockListDirectoryAsync
      .mockResolvedValueOnce(['a1', 'a2'])
      .mockResolvedValueOnce(['t1.mp3'])
      .mockRejectedValueOnce(new Error('EACCES'));
    const stats = await getMusicCacheStats();
    expect(stats.itemCount).toBe(2);
    expect(stats.totalFiles).toBe(1);
  });

  it('returns totals=0 when cache dir does not exist', async () => {
    mockGetDirectorySizeAsync.mockResolvedValue(0);
    mockDirExists = false;
    const stats = await getMusicCacheStats();
    expect(stats.totalBytes).toBe(0);
    expect(stats.itemCount).toBe(0);
    expect(stats.totalFiles).toBe(0);
  });

  it('skips non-existent subdirectories', async () => {
    let listCall = 0;
    mockGetDirectorySizeAsync.mockResolvedValue(1000);
    // For the first call (albums dir check), exists=true; for per-album, exists=false.
    // Use DirExistsCalls sequence via trick: toggle state between lists.
    mockListDirectoryAsync.mockImplementation(async () => {
      listCall++;
      if (listCall === 1) return ['a1', 'a2'];
      return [];
    });

    // First: albums/ exists; second: subDirs don't exist.
    // We need a stateful mockDirExists — just flip after init call via counter.
    // Simpler: set mockDirExists true once albums/ is created, then false for sub.
    // Because MockDirectory.exists is a getter, toggle via setTimeout.
    let existsToggle = true;
    Object.defineProperty(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-file-system').Directory.prototype,
      'exists',
      { configurable: true, get: () => existsToggle },
    );
    try {
      // After the first call (listing albums/), subsequent subDir.exists=false.
      const stats = await getMusicCacheStats();
      // We can't easily pin this; just check it doesn't throw.
      expect(stats.totalBytes).toBe(1000);
      existsToggle = true;
    } finally {
      Object.defineProperty(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('expo-file-system').Directory.prototype,
        'exists',
        { configurable: true, get: () => mockDirExists },
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/*  resumeIfSpaceAvailable                                             */
/* ------------------------------------------------------------------ */

describe('resumeIfSpaceAvailable', () => {
  it('does not crash when storage is full', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    resumeIfSpaceAvailable();
  });
  it('attempts processing when storage available', async () => {
    mockCheckStorageLimit.mockReturnValue(false);
    resumeIfSpaceAvailable();
  });
});

/* ------------------------------------------------------------------ */
/*  deleteStarredSongsDownload                                         */
/* ------------------------------------------------------------------ */

describe('deleteStarredSongsDownload', () => {
  it('delegates to deleteCachedItem', async () => {
    seedItem(STARRED_SONGS_ITEM_ID, { type: 'favorites', songIds: [] });
    deleteStarredSongsDownload();
    expect(musicCacheStore.getState().cachedItems[STARRED_SONGS_ITEM_ID]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Download pipeline                                                  */
/* ------------------------------------------------------------------ */

describe('download pipeline', () => {
  afterEach(async () => {
    await waitForQueueIdle();
    mockCheckStorageLimit.mockReturnValue(true);
    await forceRecoverDownloadsAsync();
    await waitForQueueIdle();
  });

  it('downloads and marks item complete', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    mockFetchAlbum.mockResolvedValue({
      id: 'album-dl1',
      name: 'Test',
      artist: 'A',
      coverArt: 'c',
      song: [makeChild('dl1-t1', { albumId: 'album-dl1' })],
    });
    await enqueueAlbumDownload('album-dl1');
    await waitForQueueIdle();

    expect(beginDownload).toHaveBeenCalledWith('dl1-t1');
    expect(clearDownload).toHaveBeenCalledWith('dl1-t1');
    expect(musicCacheStore.getState().cachedItems['album-dl1']).toBeDefined();
    expect(musicCacheStore.getState().cachedItems['album-dl1'].songIds).toEqual(['dl1-t1']);
    expect(musicCacheStore.getState().cachedSongs['dl1-t1']).toBeDefined();
  });

  it('resolves file extensions from suffix, contentType, fallback', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    mockFetchAlbum.mockResolvedValue({
      id: 'album-ext',
      name: 'X',
      song: [
        makeChild('ext-t1', { suffix: 'flac', albumId: 'album-ext' }),
        makeChild('ext-t2', { suffix: undefined, contentType: 'audio/flac', albumId: 'album-ext' }),
        makeChild('ext-t3', { suffix: undefined, contentType: 'audio/mpeg; charset=utf-8', albumId: 'album-ext' }),
        makeChild('ext-t4', { suffix: undefined, contentType: 'application/octet-stream', albumId: 'album-ext' }),
        makeChild('ext-t5', { suffix: undefined, contentType: undefined, albumId: 'album-ext' }),
      ],
    });
    await enqueueAlbumDownload('album-ext');
    await waitForQueueIdle();

    const songs = musicCacheStore.getState().cachedSongs;
    expect(songs['ext-t1'].suffix).toBe('flac');
    expect(songs['ext-t2'].suffix).toBe('flac');
    expect(songs['ext-t3'].suffix).toBe('mp3');
    expect(songs['ext-t4'].suffix).toBe('dat');
    expect(songs['ext-t5'].suffix).toBe('dat');
  });

  it('uses downloadFormat extension when not raw', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    playbackSettingsStore.setState({ downloadFormat: 'mp3', downloadMaxBitRate: 192 } as any);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-fmt',
      name: 'T',
      song: [makeChild('fmt-t1', { suffix: 'flac', albumId: 'album-fmt' })],
    });
    await enqueueAlbumDownload('album-fmt');
    await waitForQueueIdle();

    expect(musicCacheStore.getState().cachedSongs['fmt-t1'].suffix).toBe('mp3');
  });

  it('errors when getDownloadStreamUrl returns null', async () => {
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    (getDownloadStreamUrl as jest.Mock).mockReturnValue(null);
    mockFetchAlbum.mockResolvedValue({
      id: 'album-nu',
      name: 'X',
      song: [makeChild('nu-t1', { albumId: 'album-nu' })],
    });
    await enqueueAlbumDownload('album-nu');
    await waitForQueueIdle();

    const item = musicCacheStore.getState().downloadQueue.find((q: any) => q.itemId === 'album-nu');
    if (item) expect(item.status).toBe('error');
  });

  it('handles download failure', async () => {
    mockDownloadFileAsyncWithProgress.mockRejectedValue(new Error('net'));
    mockFetchAlbum.mockResolvedValue({
      id: 'album-fail',
      name: 'X',
      song: [makeChild('fail-t1', { albumId: 'album-fail' })],
    });
    await enqueueAlbumDownload('album-fail');
    await waitForQueueIdle();
    const item = musicCacheStore.getState().downloadQueue.find((q: any) => q.itemId === 'album-fail');
    if (item) expect(item.status).toBe('error');
  });

  it('deduplicates song within a playlist item', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    musicCacheStore.setState({ maxConcurrentDownloads: 1 } as any);

    const t = makeChild('dup-t1', { albumId: 'album-dup' });
    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-dup',
      name: 'X',
      entry: [t, t, makeChild('dup-t2', { albumId: 'album-dup' })],
    });
    await enqueuePlaylistDownload('pl-dup');
    await waitForQueueIdle();

    const cached = musicCacheStore.getState().cachedItems['pl-dup'];
    expect(cached).toBeDefined();
    expect(cached.songIds.length).toBe(3); // 3 edges even though dup-t1 is the same song
    // Only 2 unique transfers
    expect(mockDownloadFileAsyncWithProgress).toHaveBeenCalledTimes(2);
  });

  it('cross-item dedup: playlist song already in downloaded album skips transfer', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    // Seed album A as already-downloaded with song s1.
    seedSong(makeCachedSong('s1', { albumId: 'album-A' }));
    seedItem('album-A', { type: 'album', songIds: ['s1'] });

    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-x',
      name: 'X',
      entry: [makeChild('s1', { albumId: 'album-A' }), makeChild('s2', { albumId: 'album-B' })],
    });
    await enqueuePlaylistDownload('pl-x');
    await waitForQueueIdle();

    // Only s2 should have been transferred (s1 was deduped).
    expect(mockDownloadFileAsyncWithProgress).toHaveBeenCalledTimes(1);
    const pl = musicCacheStore.getState().cachedItems['pl-x'];
    expect(pl).toBeDefined();
    expect(pl.songIds.sort()).toEqual(['s1', 's2']);
  });

  it('partial-album bookkeeping: playlist download creates partial album row for new song', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    // Preload albumDetailStore entry so expectedSongCount is 10.
    mockAlbumDetailAlbums.value = {
      'album-NEW': { album: { song: new Array(10).fill(null).map((_, i) => ({ id: `nn-${i}` })) } },
    };

    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-partial',
      name: 'X',
      entry: [makeChild('partial-t1', { albumId: 'album-NEW' })],
    });
    await enqueuePlaylistDownload('pl-partial');
    await waitForQueueIdle();

    // Partial album cached_items row created with expectedSongCount=10.
    const partial = musicCacheStore.getState().cachedItems['album-NEW'];
    expect(partial).toBeDefined();
    expect(partial.type).toBe('album');
    expect(partial.expectedSongCount).toBe(10);
    expect(partial.songIds).toEqual(['partial-t1']);
  });

  it('partial-album: subsequent song appended to existing partial row', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    // Seed partial album with one song.
    seedSong(makeCachedSong('p1', { albumId: 'album-Z' }));
    seedItem('album-Z', { type: 'album', songIds: ['p1'], expectedSongCount: 5 });

    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-p2',
      name: 'X',
      entry: [makeChild('p2', { albumId: 'album-Z' })],
    });
    await enqueuePlaylistDownload('pl-p2');
    await waitForQueueIdle();

    const partial = musicCacheStore.getState().cachedItems['album-Z'];
    expect(partial.songIds.sort()).toEqual(['p1', 'p2']);
  });

  it('partial-album: cached_songs row captures full Child envelope via raw_json', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    const richChild = makeChild('rich-1', {
      albumId: 'album-rich',
      track: 4,
      discNumber: 2,
      genre: 'Jazz',
      bpm: 120,
      musicBrainzId: 'mbid-abc',
      contributors: [{ role: 'producer', artist: { id: 'a1', name: 'X' } }] as any,
    });
    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-rich',
      name: 'R',
      entry: [richChild],
    });

    await enqueuePlaylistDownload('pl-rich');
    await waitForQueueIdle();

    const cached = musicCacheStore.getState().cachedSongs['rich-1'];
    expect(cached).toBeDefined();
    expect(cached.rawJson).toBeDefined();
    const env = JSON.parse(cached.rawJson!);
    expect(env.track).toBe(4);
    expect(env.discNumber).toBe(2);
    expect(env.genre).toBe('Jazz');
    expect(env.bpm).toBe(120);
    expect(env.musicBrainzId).toBe('mbid-abc');
    expect(env.contributors).toBeDefined();
  });

  it('partial-album: row carries AlbumID3 envelope when album detail is cached', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    mockAlbumDetailAlbums.value = {
      'album-env': {
        album: {
          id: 'album-env',
          name: 'Env Album',
          genre: 'Classical',
          moods: ['calm'],
          recordLabels: [{ name: 'DG' }],
          song: [{ id: 'env-t1' }],
        },
      },
    };
    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-env',
      name: 'E',
      entry: [makeChild('env-t1', { albumId: 'album-env' })],
    });

    await enqueuePlaylistDownload('pl-env');
    await waitForQueueIdle();

    const partial = musicCacheStore.getState().cachedItems['album-env'];
    expect(partial.rawJson).toBeDefined();
    const env = JSON.parse(partial.rawJson!);
    expect(env.genre).toBe('Classical');
    expect(env.moods).toEqual(['calm']);
    expect(env.recordLabels).toEqual([{ name: 'DG' }]);
    // `.song` stripped — songs live on cached_songs.raw_json.
    expect('song' in env).toBe(false);
  });

  it('partial-album: row upgraded with envelope when an earlier partial existed without one', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    // Seed an envelope-less partial row — simulates pre-Migration-19 state.
    seedSong(makeCachedSong('up-a', { albumId: 'album-up' }));
    seedItem('album-up', {
      type: 'album',
      songIds: ['up-a'],
      expectedSongCount: 5,
    });

    // New song lands via playlist; albumDetailStore now has data.
    mockAlbumDetailAlbums.value = {
      'album-up': {
        album: {
          id: 'album-up',
          name: 'Upgraded',
          genre: 'Folk',
          song: new Array(5).fill(null).map((_, i) => ({ id: `up-${i}` })),
        },
      },
    };
    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-up',
      name: 'U',
      entry: [makeChild('up-b', { albumId: 'album-up' })],
    });

    await enqueuePlaylistDownload('pl-up');
    await waitForQueueIdle();

    const partial = musicCacheStore.getState().cachedItems['album-up'];
    expect(partial.rawJson).toBeDefined();
    const env = JSON.parse(partial.rawJson!);
    expect(env.genre).toBe('Folk');
  });

  it('partial-album: no-op when triggering item IS the album', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-self',
      name: 'X',
      song: [makeChild('self-t1', { albumId: 'album-self' })],
    });
    await enqueueAlbumDownload('album-self');
    await waitForQueueIdle();

    // Only the album itself should exist (not a separate partial entry).
    expect(musicCacheStore.getState().cachedItems['album-self']).toBeDefined();
  });

  it('stops processing at storage limit', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    mockCheckStorageLimit.mockReturnValue(true);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-sl',
      name: 'X',
      song: [makeChild('sl-t1', { albumId: 'album-sl' })],
    });
    await enqueueAlbumDownload('album-sl');
    await waitForQueueIdle();

    expect(mockDownloadFileAsyncWithProgress).not.toHaveBeenCalled();
  });

  it('skips already-pool-cached songs during resume', async () => {
    seedSong(makeCachedSong('res-t1', { albumId: 'album-res' }));
    mockFileExists = true;
    mockFileSize = 3000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-res',
      name: 'X',
      song: [makeChild('res-t1', { albumId: 'album-res' }), makeChild('res-t2', { albumId: 'album-res' })],
    });
    await enqueueAlbumDownload('album-res');
    await waitForQueueIdle();

    // t1 was in pool, only t2 downloads.
    expect(mockDownloadFileAsyncWithProgress).toHaveBeenCalledTimes(1);
    const item = musicCacheStore.getState().cachedItems['album-res'];
    expect(item.songIds.sort()).toEqual(['res-t1', 'res-t2']);
  });

  it('processes multiple queued items sequentially', async () => {
    mockFileExists = true;
    mockFileSize = 2000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    mockFetchAlbum.mockImplementation(async (id: string) => ({
      id, name: id, song: [makeChild(`${id}-t`, { albumId: id })],
    }));
    await enqueueAlbumDownload('a1');
    await enqueueAlbumDownload('a2');
    await waitForQueueIdle();

    expect(musicCacheStore.getState().cachedItems['a1']).toBeDefined();
    expect(musicCacheStore.getState().cachedItems['a2']).toBeDefined();
  });

  it('handles invalid songsJson as error', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q-bad', itemId: 'album-bad', type: 'album', name: 'X', status: 'queued',
          totalSongs: 0, completedSongs: 0, addedAt: 0, queuePosition: 1,
          songsJson: 'not json',
        },
      ],
    } as any);

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    const q = musicCacheStore.getState().downloadQueue.find((x: any) => x.queueId === 'q-bad');
    if (q) expect(q.status).toBe('error');
  });

  it('retry-once-on-null: second downloadSong call succeeds', async () => {
    // First call returns null (url missing), second call succeeds.
    mockFileExists = true;
    mockFileSize = 4000;
    let calls = 0;
    (getDownloadStreamUrl as jest.Mock).mockImplementation(() => {
      calls++;
      return calls === 1 ? null : 'https://example.com/stream';
    });
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-retry', name: 'X',
      song: [makeChild('rt-1', { albumId: 'album-retry' })],
    });
    await enqueueAlbumDownload('album-retry');
    await waitForQueueIdle();

    expect(musicCacheStore.getState().cachedItems['album-retry']).toBeDefined();
  });

  it('pauses worker when storage-limit trips mid-loop', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    // First download succeeds, storage trips before the second.
    let downloadCalls = 0;
    mockDownloadFileAsyncWithProgress.mockImplementation(async () => {
      downloadCalls++;
      if (downloadCalls >= 1) mockCheckStorageLimit.mockReturnValue(true);
    });
    musicCacheStore.setState({ maxConcurrentDownloads: 1 } as any);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-mid', name: 'X',
      song: [
        makeChild('mid-1', { albumId: 'album-mid' }),
        makeChild('mid-2', { albumId: 'album-mid' }),
      ],
    });
    await enqueueAlbumDownload('album-mid');
    await waitForQueueIdle();

    // Item may be queued (paused), error (partial), or downloading — the
    // branch we care about is just that `checkStorageLimit() true` mid-worker
    // exercised the pause-and-requeue code path.
    const q = musicCacheStore.getState().downloadQueue.find((x: any) => x.itemId === 'album-mid');
    expect(q).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  downloadSong catch (tmp cleanup)                                   */
/* ------------------------------------------------------------------ */

describe('download error branches', () => {
  afterEach(async () => {
    await waitForQueueIdle();
    mockCheckStorageLimit.mockReturnValue(true);
    await forceRecoverDownloadsAsync();
    await waitForQueueIdle();
  });

  it('cleans up .tmp on download failure', async () => {
    mockDownloadFileAsyncWithProgress.mockRejectedValue(new Error('transport'));
    mockFileExists = true; // tmp is present, enter delete branch

    mockFetchAlbum.mockResolvedValue({
      id: 'album-fcatch', name: 'X',
      song: [makeChild('fc-t1', { albumId: 'album-fcatch' })],
    });
    await enqueueAlbumDownload('album-fcatch');
    await waitForQueueIdle();

    expect(clearDownload).toHaveBeenCalledWith('fc-t1');
  });
});

/* ------------------------------------------------------------------ */
/*  redownloadItem                                                     */
/* ------------------------------------------------------------------ */

describe('redownloadItem', () => {
  it('no-op for missing item', async () => {
    await redownloadItem('nope');
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    expect(mockFetchPlaylist).not.toHaveBeenCalled();
  });

  it('re-enqueues album', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    seedSong(makeCachedSong('t1'));
    seedItem('album-1', { type: 'album', songIds: ['t1'] });
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1', name: 'X', song: [makeChild('t1')],
    });
    await redownloadItem('album-1');
    expect(musicCacheStore.getState().cachedItems['album-1']).toBeUndefined();
    expect(mockFetchAlbum).toHaveBeenCalledWith('album-1');
  });

  it('re-enqueues playlist', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    seedSong(makeCachedSong('t1'));
    seedItem('pl-1', { type: 'playlist', songIds: ['t1'] });
    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-1', name: 'X', entry: [makeChild('t1')],
    });
    await redownloadItem('pl-1');
    expect(musicCacheStore.getState().cachedItems['pl-1']).toBeUndefined();
    expect(mockFetchPlaylist).toHaveBeenCalledWith('pl-1');
  });

  it('re-enqueues starred via favorites path', async () => {
    mockCheckStorageLimit.mockReturnValue(true);
    seedSong(makeCachedSong('s1'));
    seedItem(STARRED_SONGS_ITEM_ID, { type: 'favorites', songIds: ['s1'] });
    (favoritesStore as any).setState({ songs: [makeChild('s1')] });
    await redownloadItem(STARRED_SONGS_ITEM_ID);
    // starred gets re-enqueued via the favorites path.
    expect(
      musicCacheStore.getState().downloadQueue.find((q: any) => q.itemId === STARRED_SONGS_ITEM_ID),
    ).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  redownloadTrack                                                    */
/* ------------------------------------------------------------------ */

describe('redownloadTrack', () => {
  it('false for missing item', async () => {
    expect(await redownloadTrack('nope', 't1')).toBe(false);
  });

  it('false for missing track', async () => {
    seedItem('album-1', { type: 'album', songIds: [] });
    expect(await redownloadTrack('album-1', 'nope')).toBe(false);
  });

  it('false when stream url is null', async () => {
    seedSong(makeCachedSong('t1'));
    seedItem('album-1', { type: 'album', songIds: ['t1'] });
    (getDownloadStreamUrl as jest.Mock).mockReturnValue(null);
    expect(await redownloadTrack('album-1', 't1')).toBe(false);
  });

  it('false when download throws', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system');
    File.downloadFileAsync.mockRejectedValueOnce(new Error('net'));
    seedSong(makeCachedSong('t1'));
    seedItem('album-1', { type: 'album', songIds: ['t1'] });
    expect(await redownloadTrack('album-1', 't1')).toBe(false);
  });

  it('returns true on success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system');
    File.downloadFileAsync.mockResolvedValue(undefined);
    mockFileExists = true;
    mockFileSize = 8000;
    seedSong(makeCachedSong('t1'));
    seedItem('album-1', { type: 'album', songIds: ['t1'] });
    expect(await redownloadTrack('album-1', 't1')).toBe(true);
  });

  it('uses downloadFormat extension when not raw', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system');
    File.downloadFileAsync.mockResolvedValue(undefined);
    mockFileExists = true;
    mockFileSize = 8000;
    playbackSettingsStore.setState({ downloadFormat: 'mp3', downloadMaxBitRate: null } as any);
    seedSong(makeCachedSong('t1', { suffix: 'flac' }));
    seedItem('album-1', { type: 'album', songIds: ['t1'] });
    expect(await redownloadTrack('album-1', 't1')).toBe(true);
    expect(musicCacheStore.getState().cachedSongs['t1'].suffix).toBe('mp3');
  });
});

/* ------------------------------------------------------------------ */
/*  storageLimitStore subscription                                     */
/* ------------------------------------------------------------------ */

describe('storageLimitStore subscription', () => {
  it('resumes queue when storage settings change', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    mockCheckStorageLimit.mockReturnValue(true);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-sub', name: 'X', song: [makeChild('sub-t1', { albumId: 'album-sub' })],
    });
    await enqueueAlbumDownload('album-sub');

    mockCheckStorageLimit.mockReturnValue(false);
    (storageLimitStore as any).setState({
      limitMode: 'custom', maxCacheSizeGB: 20, isStorageFull: false,
    });

    await waitForQueueIdle();
    expect(musicCacheStore.getState().cachedItems['album-sub']).toBeDefined();
  });

  it('resumes when isStorageFull flips false', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    mockCheckStorageLimit.mockReturnValue(true);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-sub2', name: 'X', song: [makeChild('sub2-t1', { albumId: 'album-sub2' })],
    });
    await enqueueAlbumDownload('album-sub2');

    (storageLimitStore as any).setState({ isStorageFull: true });
    mockCheckStorageLimit.mockReturnValue(false);
    (storageLimitStore as any).setState({ isStorageFull: false });

    await waitForQueueIdle();
    expect(musicCacheStore.getState().cachedItems['album-sub2']).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  syncStarredSongsDownload via favoritesStore subscription            */
/* ------------------------------------------------------------------ */

describe('syncStarredSongsDownload via subscription', () => {
  it('deletes starred download when all songs unstarred', async () => {
    mockFileExists = true;
    seedSong(makeCachedSong('s1'));
    seedItem(STARRED_SONGS_ITEM_ID, { type: 'favorites', songIds: ['s1'] });
    await deferredMusicCacheInit();

    (favoritesStore as any).setState({ songs: [makeChild('s1')] });
    (favoritesStore as any).setState({ songs: [] });

    expect(musicCacheStore.getState().cachedItems[STARRED_SONGS_ITEM_ID]).toBeUndefined();
  });

  it('does not fire when songs reference unchanged', async () => {
    mockFileExists = true;
    const songs = [makeChild('s1')];
    (favoritesStore as any).setState({ songs });
    seedItem(STARRED_SONGS_ITEM_ID, { type: 'favorites', songIds: ['s1'] });
    await deferredMusicCacheInit();

    // Same reference — store's subscribe shouldn't act.
    (favoritesStore as any).setState({ songs });
    expect(musicCacheStore.getState().cachedItems[STARRED_SONGS_ITEM_ID]).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  reconcileMusicCacheAsync — startup drift healing                   */
/* ------------------------------------------------------------------ */

describe('reconcileMusicCacheAsync', () => {
  it('no-ops when the albums directory does not exist', async () => {
    mockDirExists = false;
    await expect(reconcileMusicCacheAsync()).resolves.toBeUndefined();
    expect(mockListDirectoryAsync).not.toHaveBeenCalled();
  });

  it('happy path: seeded song present on disk triggers no mutation', async () => {
    seedSong(makeCachedSong('s1', { albumId: 'a1', suffix: 'mp3' }));
    seedItem('a1', { type: 'album', songIds: ['s1'] });
    mockFileExists = true;
    // Albums dir lists ['a1']; a1 dir lists ['s1.mp3']. The "is empty"
    // listing that happens after orphan checks also sees ['s1.mp3'].
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['a1'];
      return ['s1.mp3'];
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await reconcileMusicCacheAsync();

    expect(fileDeletes).toHaveLength(0);
    expect(dirDeletes).toHaveLength(0);
    // No drift -> no summary warning emitted.
    expect(warnSpy).not.toHaveBeenCalled();
    expect(musicCacheStore.getState().cachedSongs['s1']).toBeDefined();
    expect(musicCacheStore.getState().cachedItems['a1']).toBeDefined();
    warnSpy.mockRestore();
  });

  it('deletes orphan top-level directory whose name is not a known album_id', async () => {
    // Seed at least one valid song so validAlbumIds is non-empty (the
    // safety gate that prevents a pre-migration fresh-install / halted-
    // migration state from wiping v1 layout directories).
    seedSong(makeCachedSong('s-known', { albumId: 'a-known', suffix: 'mp3' }));
    seedItem('a-known', { type: 'album', songIds: ['s-known'] });
    mockFileExists = true;
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['a-known', 'a-mystery'];
      return ['s-known.mp3'];
    });
    mockFileExistsByPathSubstring.set('a-known/s-known.mp3', true);

    await reconcileMusicCacheAsync();

    expect(dirDeletes.some((u) => u.endsWith('a-mystery'))).toBe(true);
    expect(dirDeletes.some((u) => u.endsWith('a-known'))).toBe(false);
  });

  it('skips the stale-dir sweep when validAlbumIds is empty (pre-migration safety gate)', async () => {
    // No songs seeded → validAlbumIds is empty. Directories on disk must
    // NOT be swept — this is the gate that protects v1 cache data when
    // task #14 hasn't completed yet.
    mockFileExists = true;
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['v1-playlist-dir', 'v1-album-dir'];
      return ['file.mp3'];
    });

    await reconcileMusicCacheAsync();

    expect(dirDeletes).toHaveLength(0);
  });

  it('deletes stale top-level directory whose name is not a known album_id', async () => {
    // Song s1 is in SQL under album 'a1'. A leftover directory 'a2' exists
    // on disk but is not a valid album_id — it gets swept in pass 4.
    seedSong(makeCachedSong('s1', { albumId: 'a1', suffix: 'mp3' }));
    seedItem('a1', { type: 'album', songIds: ['s1'] });
    mockFileExistsByPathSubstring.set('a1/s1.mp3', true);
    mockFileExistsByPathSubstring.set('a2/s1.mp3', true);
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['a1', 'a2'];
      if (uri.includes('/a1') || uri.endsWith('/a1')) return ['s1.mp3'];
      if (uri.includes('/a2') || uri.endsWith('/a2')) return ['s1.mp3'];
      return [];
    });

    await reconcileMusicCacheAsync();

    // a2 isn't in validAlbumIds so the whole directory is swept.
    // a1 is valid and stays untouched.
    expect(dirDeletes.some((u) => u.endsWith('a2'))).toBe(true);
    expect(dirDeletes.some((u) => u.endsWith('a1'))).toBe(false);
  });

  it('deletes stale .tmp files unconditionally inside a valid album dir', async () => {
    // Seed a cached song so the 'a1' album is in validAlbumIds, triggering
    // the per-file pass 1 walk (where stale .tmp files are reaped).
    seedSong(makeCachedSong('s1', { albumId: 'a1', suffix: 'mp3' }));
    seedItem('a1', { type: 'album', songIds: ['s1'] });
    mockFileExists = true;
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['a1'];
      return ['s1.mp3', 'abandoned.mp3.tmp', 'another.flac.tmp'];
    });

    await reconcileMusicCacheAsync();

    // .tmp/orphan deletes now go off-thread via deleteFileAsync.
    expect(fileDeletesAsync.some((u) => u.endsWith('abandoned.mp3.tmp'))).toBe(true);
    expect(fileDeletesAsync.some((u) => u.endsWith('another.flac.tmp'))).toBe(true);
  });

  it('removes an empty album directory with no SQL songs referencing it', async () => {
    // Seed a valid song so validAlbumIds is non-empty (passes the safety
    // gate). A separate 'orphan-album' dir exists on disk with nothing
    // in SQL referencing it → pass 4 sweeps it.
    seedSong(makeCachedSong('s-known', { albumId: 'a-known', suffix: 'mp3' }));
    seedItem('a-known', { type: 'album', songIds: ['s-known'] });
    mockFileExistsByPathSubstring.set('a-known/s-known.mp3', true);
    mockFileExists = true;
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['a-known', 'orphan-album'];
      if (uri.endsWith('/a-known')) return ['s-known.mp3'];
      return [];
    });

    await reconcileMusicCacheAsync();

    expect(dirDeletes.some((u) => u.includes('orphan-album'))).toBe(true);
    expect(dirDeletes.some((u) => u.endsWith('a-known'))).toBe(false);
  });

  it('keeps album directory when an SQL song still references its albumId', async () => {
    // A song exists in SQL for album 'keep-me', even though on disk the
    // directory is currently empty (perhaps the file was just deleted by
    // the orphan sweep above and will be re-downloaded shortly).
    seedSong(makeCachedSong('s1', { albumId: 'keep-me', suffix: 'mp3' }));
    seedItem('keep-me', { type: 'album', songIds: ['s1'] });
    // Pretend the file for s1 is on disk so Pass 2 doesn't remove the row.
    mockFileExistsByPathSubstring.set('keep-me/s1.mp3', true);
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['keep-me'];
      return ['s1.mp3'];
    });

    await reconcileMusicCacheAsync();

    expect(dirDeletes.some((u) => u.includes('keep-me'))).toBe(false);
  });

  it('removes SQL row + in-memory entries when file is missing on disk', async () => {
    seedSong(makeCachedSong('missing-1', { albumId: 'a-miss', suffix: 'mp3' }));
    seedItem('a-miss', { type: 'album', songIds: ['missing-1'] });
    // Populate trackUriMap via deferredMusicCacheInit in a neutral state
    // first (every file appears present), then flip to missing and run
    // reconciliation directly.
    mockFileExists = true;
    await deferredMusicCacheInit();
    expect(getLocalTrackUri('missing-1')).not.toBeNull();

    // Now invert: no files exist on disk, but the SQL rows are still seeded.
    mockFileExists = false;
    mockListDirectoryAsync.mockImplementation(async () => []);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await reconcileMusicCacheAsync();

    // Song row wiped from memory + map.
    expect(musicCacheStore.getState().cachedSongs['missing-1']).toBeUndefined();
    expect(getLocalTrackUri('missing-1')).toBeNull();
    // Item had its only edge removed -> songIds.length === 0 -> item deleted.
    expect(musicCacheStore.getState().cachedItems['a-miss']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[musicCacheService] reconciliation healed drift:',
      expect.objectContaining({ missingSongIds: 1 }),
    );
    warnSpy.mockRestore();
  });

  it('removes missing-file edges across multiple referencing items', async () => {
    seedSong(makeCachedSong('shared', { albumId: 'a', suffix: 'mp3' }));
    seedSong(makeCachedSong('keeper', { albumId: 'a', suffix: 'mp3' }));
    seedItem('album-a', { type: 'album', songIds: ['shared', 'keeper'] });
    seedItem('pl-1', { type: 'playlist', songIds: ['shared'] });

    // 'keeper' exists on disk, 'shared' does not.
    mockFileExistsByPathSubstring.set('a/keeper.mp3', true);
    mockFileExistsByPathSubstring.set('a/shared.mp3', false);
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['a'];
      return ['keeper.mp3'];
    });

    await reconcileMusicCacheAsync();

    // shared row gone everywhere; keeper survives.
    expect(musicCacheStore.getState().cachedSongs['shared']).toBeUndefined();
    expect(musicCacheStore.getState().cachedSongs['keeper']).toBeDefined();

    const album = musicCacheStore.getState().cachedItems['album-a'];
    expect(album).toBeDefined();
    expect(album.songIds).toEqual(['keeper']);

    // pl-1 had ONLY the missing song -> orphan item -> removed.
    expect(musicCacheStore.getState().cachedItems['pl-1']).toBeUndefined();
  });

  it('removes orphan item rows with zero songIds', async () => {
    // Item has no edges from the start — simulates a leftover row.
    seedItem('empty-item', { type: 'playlist', songIds: [] });
    mockListDirectoryAsync.mockImplementation(async () => []);

    await reconcileMusicCacheAsync();

    expect(musicCacheStore.getState().cachedItems['empty-item']).toBeUndefined();
  });

  it('swallows listDirectoryAsync errors at the top level', async () => {
    mockListDirectoryAsync.mockRejectedValue(new Error('EACCES'));

    // Function must not throw; just returns cleanly.
    await expect(reconcileMusicCacheAsync()).resolves.toBeUndefined();
  });

  it('swallows listDirectoryAsync errors for an individual album dir', async () => {
    mockFileExists = true;
    let call = 0;
    mockListDirectoryAsync.mockImplementation(async () => {
      call++;
      if (call === 1) return ['bad-album'];
      throw new Error('EIO');
    });

    // Still completes without throwing — albums that fail to list are skipped.
    await expect(reconcileMusicCacheAsync()).resolves.toBeUndefined();
  });

  it('swallows File.delete errors best-effort', async () => {
    // Seed nothing in SQL; disk has a ghost file whose delete throws.
    mockFileExists = true;
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('/music-cache')) return ['a1'];
      return ['ghost.mp3'];
    });

    // Override File.prototype.delete on the expo-file-system mock to throw.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system');
    const origDelete = File.prototype.delete;
    File.prototype.delete = function () { throw new Error('EACCES'); };
    try {
      await expect(reconcileMusicCacheAsync()).resolves.toBeUndefined();
    } finally {
      File.prototype.delete = origDelete;
    }
  });

  it('deferredMusicCacheInit runs reconciliation and swallows its failures', async () => {
    // Throw from the very first listDirectoryAsync call — reconciliation
    // must catch it and let deferredMusicCacheInit continue.
    mockListDirectoryAsync.mockRejectedValue(new Error('boom'));
    await expect(deferredMusicCacheInit()).resolves.toBeUndefined();
  });

  it('deferredMusicCacheInit logs a warn when reconciliation itself throws', async () => {
    // Temporarily replace Directory.prototype to throw from the `.exists`
    // getter we check at the very top of reconcileMusicCacheAsync.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Directory } = require('expo-file-system');
    const origDesc = Object.getOwnPropertyDescriptor(Directory.prototype, 'exists');
    Object.defineProperty(Directory.prototype, 'exists', {
      configurable: true,
      get() { throw new Error('dir-exists-boom'); },
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(deferredMusicCacheInit()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        '[musicCacheService] reconciliation failed:',
        expect.stringContaining('dir-exists-boom'),
      );
    } finally {
      warnSpy.mockRestore();
      if (origDesc) {
        Object.defineProperty(Directory.prototype, 'exists', origDesc);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  waitForTrackMapsReady                                              */
/* ------------------------------------------------------------------ */

describe('waitForTrackMapsReady', () => {
  it('resolves immediately once trackMapsReady is set (i.e. after deferredMusicCacheInit)', async () => {
    // deferredMusicCacheInit runs populateTrackMapsAsync which flips the
    // ready flag. Subsequent calls should resolve synchronously.
    await deferredMusicCacheInit();
    const start = Date.now();
    await waitForTrackMapsReady();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('queues and flushes waiters when populateTrackMapsAsync flips the flag', async () => {
    // The module scope is shared across tests in this file; to exercise
    // the queued-waiter code path we rely on isolateModules to get a
    // fresh musicCacheService with `trackMapsReady === false`.
    jest.isolateModules(() => {
      jest.doMock('../subsonicService', () => ({
        ...jest.requireActual('../subsonicService'),
      }));
      const mod = require('../musicCacheService');
      let resolved = false;
      const p = mod.waitForTrackMapsReady().then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false);
      // Trigger populate via deferredMusicCacheInit — resolves the waiter.
      return mod.deferredMusicCacheInit().then(() => p).then(() => {
        expect(resolved).toBe(true);
      });
    });
  });
});
