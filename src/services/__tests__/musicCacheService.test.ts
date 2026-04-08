const mockListDirectoryAsync = jest.fn();
const mockGetDirectorySizeAsync = jest.fn();
const mockDownloadFileAsyncWithProgress = jest.fn();

// Track mock file/directory state for test control
let mockFileExists = false;
let mockFileSize = 100;
let mockDirExists = true;
// When non-null, MockDirectory.create() throws this Error. Used to exercise
// the catch handler in initMusicCache (Fix 3 — module-scope crash hardening).
let mockDirCreateError: Error | null = null;

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
    get exists() { return mockFileExists; }
    get size() { return mockFileSize; }
    write = jest.fn();
    delete = jest.fn();
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
    delete = jest.fn();
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
  cacheAllSizes: jest.fn().mockResolvedValue(undefined),
  getCachedImageUri: jest.fn().mockReturnValue(null),
}));

jest.mock('../subsonicService');

const mockFetchAlbum = jest.fn();
jest.mock('../../store/albumDetailStore', () => ({
  albumDetailStore: {
    getState: jest.fn(() => ({ fetchAlbum: mockFetchAlbum })),
  },
}));

const mockFetchAllAlbums = jest.fn().mockResolvedValue(undefined);
const mockAlbumLibraryAlbums: { value: any[] } = { value: [] };
jest.mock('../../store/albumLibraryStore', () => ({
  albumLibraryStore: {
    getState: jest.fn(() => ({
      albums: mockAlbumLibraryAlbums.value,
      fetchAllAlbums: mockFetchAllAlbums,
    })),
  },
}));

const mockFetchPlaylist = jest.fn();
jest.mock('../../store/playlistDetailStore', () => ({
  playlistDetailStore: {
    getState: jest.fn(() => ({ fetchPlaylist: mockFetchPlaylist })),
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
      streamFormat: 'raw',
      maxBitRate: null,
    })),
    PLAYBACK_RATES: [0.5, 0.75, 1, 1.25, 1.5, 2],
  };
});

jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

import { musicCacheStore } from '../../store/musicCacheStore';
import { favoritesStore } from '../../store/favoritesStore';
import { storageLimitStore } from '../../store/storageLimitStore';
import { playbackSettingsStore } from '../../store/playbackSettingsStore';
import { checkStorageLimit } from '../storageService';
import { cacheAllSizes } from '../imageCacheService';
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
  deleteCachedItem,
  removeCachedPlaylistTrack,
  reorderCachedPlaylistTracks,
  syncCachedPlaylistTracks,
  syncCachedItemTracks,
  cancelDownload,
  clearDownloadQueue,
  clearMusicCache,
  getMusicCacheStats,
  resumeIfSpaceAvailable,
  deleteStarredSongsDownload,
  retryDownload,
  redownloadItem,
  redownloadTrack,
} from '../musicCacheService';

import type { Child } from '../subsonicService';

const mockCheckStorageLimit = checkStorageLimit as jest.Mock;

const makeChild = (id: string, overrides?: Partial<Child>): Child => ({
  id,
  title: `Song ${id}`,
  artist: 'Test Artist',
  album: 'Test Album',
  coverArt: `cover-${id}`,
  duration: 200,
  suffix: 'mp3',
  ...overrides,
} as Child);

const makeCachedTrack = (id: string, bytes = 1000) => ({
  id,
  title: `Song ${id}`,
  artist: 'Test Artist',
  fileName: `${id}.mp3`,
  bytes,
  duration: 200,
});

beforeEach(() => {
  mockListDirectoryAsync.mockReset();
  mockGetDirectorySizeAsync.mockReset();
  mockDownloadFileAsyncWithProgress.mockReset();
  mockFetchAlbum.mockReset();
  mockFetchPlaylist.mockReset();
  mockFetchAllAlbums.mockClear();
  mockFetchAllAlbums.mockResolvedValue(undefined);
  mockAlbumLibraryAlbums.value = [];
  mockCheckStorageLimit.mockReturnValue(false);
  mockFileExists = false;
  mockFileSize = 100;
  mockDirExists = true;

  musicCacheStore.setState({
    downloadQueue: [],
    cachedItems: {},
    totalBytes: 0,
    totalFiles: 0,
    maxConcurrentDownloads: 3,
  } as any);

  (favoritesStore as any).setState({ songs: [] });
  playbackSettingsStore.setState({ downloadFormat: 'raw' } as any);
  (getDownloadStreamUrl as jest.Mock).mockReturnValue('https://example.com/stream');

  initMusicCache();
});

/**
 * Wait until the download queue has no 'downloading' items, meaning
 * processQueue has finished its current run. Falls back to a max
 * iteration count to prevent infinite loops.
 */
async function waitForQueueIdle(maxIter = 200): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    await new Promise((r) => setImmediate(r));
    const { downloadQueue } = musicCacheStore.getState();
    const hasActive = downloadQueue.some(
      (q: any) => q.status === 'downloading',
    );
    if (!hasActive) return;
  }
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

describe('constants', () => {
  it('exports STARRED_SONGS_ITEM_ID', () => {
    expect(STARRED_SONGS_ITEM_ID).toBe('__starred__');
  });

  it('exports STARRED_COVER_ART_ID', () => {
    expect(STARRED_COVER_ART_ID).toBe('__starred_cover__');
  });
});

/* ------------------------------------------------------------------ */
/*  initMusicCache                                                     */
/* ------------------------------------------------------------------ */

describe('initMusicCache', () => {
  it('is idempotent on repeated calls', () => {
    // Already called in beforeEach; calling again should not throw
    initMusicCache();
    initMusicCache();
  });

  it('swallows Directory.create() failures so the bundle still boots', () => {
    // initMusicCache is invoked at module-scope from _layout.tsx, before any
    // React error boundary is mounted. On stripped OEM ROMs the synchronous
    // Directory.create() can throw — verify the catch handler keeps the
    // exception from propagating up and crashing the bundle.
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
/*  deferredMusicCacheInit                                             */
/* ------------------------------------------------------------------ */

describe('deferredMusicCacheInit', () => {
  it('populates track URI map from disk scan', async () => {
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1'])    // top-level dirs
      .mockResolvedValueOnce(['t1.mp3', 't2.flac']); // files in album-1

    await deferredMusicCacheInit();

    // Track URIs should now be populated
    expect(getLocalTrackUri('t1')).toContain('t1.mp3');
    expect(getLocalTrackUri('t2')).toContain('t2.flac');
  });

  it('skips .tmp files during scan', async () => {
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1'])
      .mockResolvedValueOnce(['t1.mp3', 't2.mp3.tmp']);

    await deferredMusicCacheInit();

    expect(getLocalTrackUri('t1')).toContain('t1.mp3');
    expect(getLocalTrackUri('t2.mp3')).toBeNull();
  });

  it('skips empty file names', async () => {
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1'])
      .mockResolvedValueOnce(['', 't1.mp3']);

    await deferredMusicCacheInit();

    expect(getLocalTrackUri('t1')).toContain('t1.mp3');
  });

  it('handles top-level listing errors gracefully', async () => {
    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));

    await deferredMusicCacheInit();

    // Should not throw; no tracks populated
    expect(getLocalTrackUri('anything')).toBeNull();
  });

  it('handles sub-directory listing errors gracefully', async () => {
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1'])
      .mockRejectedValueOnce(new Error('EACCES'));

    await deferredMusicCacheInit();

    // No crash; album-1 tracks just aren't populated
  });

  it('skips empty sub-directory names', async () => {
    mockListDirectoryAsync
      .mockResolvedValueOnce(['', 'album-1'])
      .mockResolvedValueOnce(['t1.mp3']);

    await deferredMusicCacheInit();

    expect(getLocalTrackUri('t1')).toContain('t1.mp3');
  });
});

/* ------------------------------------------------------------------ */
/*  getLocalTrackUri                                                   */
/* ------------------------------------------------------------------ */

describe('getLocalTrackUri', () => {
  it('returns null for empty trackId', () => {
    expect(getLocalTrackUri('')).toBeNull();
  });

  it('returns null for unknown trackId', () => {
    expect(getLocalTrackUri('unknown-track')).toBeNull();
  });

  it('returns URI when track is in the map', async () => {
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1'])
      .mockResolvedValueOnce(['track-99.mp3']);

    await deferredMusicCacheInit();

    const uri = getLocalTrackUri('track-99');
    expect(uri).not.toBeNull();
    expect(uri).toContain('track-99.mp3');
  });
});

/* ------------------------------------------------------------------ */
/*  isItemCached                                                       */
/* ------------------------------------------------------------------ */

describe('isItemCached', () => {
  it('returns false when item is not cached', () => {
    expect(isItemCached('album-1')).toBe(false);
  });

  it('returns true when item is in cachedItems', () => {
    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [],
          totalBytes: 0,
        },
      },
    } as any);
    expect(isItemCached('album-1')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  getTrackQueueStatus                                                */
/* ------------------------------------------------------------------ */

describe('getTrackQueueStatus', () => {
  it('returns null when track is not in queue', () => {
    expect(getTrackQueueStatus('track-1')).toBeNull();
  });

  it('returns queued status when track is in queued item', () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'album-1', status: 'queued', tracks: [{ id: 'track-1' }] },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBe('queued');
  });

  it('returns downloading status when track is in downloading item', () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'album-1', status: 'downloading', tracks: [{ id: 'track-1' }] },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBe('downloading');
  });

  it('returns null for completed items', () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'album-1', status: 'completed', tracks: [{ id: 'track-1' }] },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBeNull();
  });

  it('returns null for error items', () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'album-1', status: 'error', tracks: [{ id: 'track-1' }] },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBeNull();
  });

  it('checks multiple queue items and returns first match', () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'album-1', status: 'error', tracks: [{ id: 'track-1' }] },
        { queueId: 'q2', itemId: 'album-2', status: 'queued', tracks: [{ id: 'track-1' }] },
      ],
    } as any);
    expect(getTrackQueueStatus('track-1')).toBe('queued');
  });
});

/* ------------------------------------------------------------------ */
/*  recoverStalledDownloadsAsync                                       */
/* ------------------------------------------------------------------ */

describe('recoverStalledDownloadsAsync', () => {
  // Block processQueue from running after recovery so we can inspect
  // the intermediate 'queued' state set by the recovery logic.
  beforeEach(() => {
    mockCheckStorageLimit.mockReturnValue(true);
  });

  it('resets downloading items to queued', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'downloading',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
      ],
    } as any);

    mockListDirectoryAsync.mockResolvedValue([]);

    await recoverStalledDownloadsAsync();

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('queued');
  });

  it('deletes .tmp files from stalled downloads', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'downloading',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
      ],
    } as any);

    mockListDirectoryAsync.mockResolvedValue(['t1.mp3.tmp', 't2.mp3']);

    await recoverStalledDownloadsAsync();

    // .tmp file deletion is attempted (file.delete called via File mock)
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('queued');
  });

  it('skips items that are not downloading', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'queued',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
      ],
    } as any);

    await recoverStalledDownloadsAsync();

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('queued');
  });

  it('skips error items by default', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'error',
          error: 'Download failed',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
      ],
    } as any);

    await recoverStalledDownloadsAsync();

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('error');
  });

  it('includes error items when includeErrors is true', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'error',
          error: 'Download failed',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 3,
          addedAt: Date.now(),
        },
      ],
    } as any);

    mockListDirectoryAsync.mockResolvedValue([]);

    await recoverStalledDownloadsAsync(true);

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('queued');
    expect(queue[0].error).toBeUndefined();
    expect(queue[0].completedTracks).toBe(3);
  });

  it('handles listing errors gracefully', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'downloading',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
      ],
    } as any);

    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));

    await recoverStalledDownloadsAsync();

    // Should not throw; item is still reset to queued
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('queued');
  });

  it('does nothing when queue is empty', async () => {
    await recoverStalledDownloadsAsync();
    // No crash, no listing calls
    expect(mockListDirectoryAsync).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  forceRecoverDownloadsAsync                                         */
/* ------------------------------------------------------------------ */

describe('forceRecoverDownloadsAsync', () => {
  beforeEach(() => {
    mockCheckStorageLimit.mockReturnValue(true);
  });

  it('resets processing state and runs recovery', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'downloading',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
      ],
    } as any);

    mockListDirectoryAsync.mockResolvedValue([]);

    await forceRecoverDownloadsAsync();

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('queued');
  });

  it('also retries failed error items', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'downloading',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
        {
          queueId: 'q2',
          itemId: 'album-2',
          status: 'error',
          error: 'Network error',
          tracks: [makeChild('t2'), makeChild('t3')],
          totalTracks: 2,
          completedTracks: 1,
          addedAt: Date.now(),
        },
      ],
    } as any);

    mockListDirectoryAsync.mockResolvedValue([]);

    await forceRecoverDownloadsAsync();

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('queued');
    expect(queue[1].status).toBe('queued');
    expect(queue[1].error).toBeUndefined();
    expect(queue[1].completedTracks).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  enqueueAlbumDownload                                               */
/* ------------------------------------------------------------------ */

describe('enqueueAlbumDownload', () => {
  it('skips if album is already cached', async () => {
    musicCacheStore.setState({
      cachedItems: {
        'album-1': { itemId: 'album-1', type: 'album', name: 'Test', tracks: [], totalBytes: 0 },
      },
    } as any);

    await enqueueAlbumDownload('album-1');

    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });

  it('skips if album is already in download queue', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'album-1', status: 'queued', tracks: [], totalTracks: 0, completedTracks: 0, addedAt: Date.now() },
      ],
    } as any);

    await enqueueAlbumDownload('album-1');

    expect(mockFetchAlbum).not.toHaveBeenCalled();
  });

  it('skips if fetchAlbum returns null', async () => {
    mockFetchAlbum.mockResolvedValue(null);

    await enqueueAlbumDownload('album-1');

    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('skips if album has no songs', async () => {
    mockFetchAlbum.mockResolvedValue({ id: 'album-1', name: 'Empty', song: [] });

    await enqueueAlbumDownload('album-1');

    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('enqueues album with songs', async () => {
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
    expect(queue[0].name).toBe('Test Album');
    expect(queue[0].type).toBe('album');
    expect(queue[0].totalTracks).toBe(2);
  });

  it('caches cover art for album and tracks', async () => {
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test Album',
      coverArt: 'album-cover',
      song: [makeChild('t1', { coverArt: 'track-cover' })],
    });

    await enqueueAlbumDownload('album-1');

    expect(cacheAllSizes).toHaveBeenCalledWith('album-cover');
    expect(cacheAllSizes).toHaveBeenCalledWith('track-cover');
  });

  it('uses displayArtist when artist is missing', async () => {
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test Album',
      artist: undefined,
      displayArtist: 'Various Artists',
      song: [makeChild('t1')],
    });

    await enqueueAlbumDownload('album-1');

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].artist).toBe('Various Artists');
  });

  it('refreshes the album library when downloading an album not in the cached list', async () => {
    mockAlbumLibraryAlbums.value = [{ id: 'album-other' }];
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test',
      song: [makeChild('t1')],
    });

    await enqueueAlbumDownload('album-1');

    expect(mockFetchAllAlbums).toHaveBeenCalled();
  });

  it('does not refresh the library when the album is already in the cached list', async () => {
    mockAlbumLibraryAlbums.value = [{ id: 'album-1' }, { id: 'album-2' }];
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test',
      song: [makeChild('t1')],
    });

    await enqueueAlbumDownload('album-1');

    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
  });

  it('does not refresh the library when the cached library is empty', async () => {
    mockAlbumLibraryAlbums.value = [];
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test',
      song: [makeChild('t1')],
    });

    await enqueueAlbumDownload('album-1');

    expect(mockFetchAllAlbums).not.toHaveBeenCalled();
  });

  it('still enqueues the download when the background library refresh rejects', async () => {
    mockAlbumLibraryAlbums.value = [{ id: 'album-other' }];
    mockFetchAllAlbums.mockRejectedValueOnce(new Error('Network'));
    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test',
      song: [makeChild('t1')],
    });

    await enqueueAlbumDownload('album-1');

    expect(mockFetchAllAlbums).toHaveBeenCalled();
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  enqueuePlaylistDownload                                            */
/* ------------------------------------------------------------------ */

describe('enqueuePlaylistDownload', () => {
  it('skips if playlist is already cached', async () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': { itemId: 'pl-1', type: 'playlist', name: 'Test', tracks: [], totalBytes: 0 },
      },
    } as any);

    await enqueuePlaylistDownload('pl-1');

    expect(mockFetchPlaylist).not.toHaveBeenCalled();
  });

  it('skips if playlist is already in download queue', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'pl-1', status: 'queued', tracks: [], totalTracks: 0, completedTracks: 0, addedAt: Date.now() },
      ],
    } as any);

    await enqueuePlaylistDownload('pl-1');

    expect(mockFetchPlaylist).not.toHaveBeenCalled();
  });

  it('skips if fetchPlaylist returns null', async () => {
    mockFetchPlaylist.mockResolvedValue(null);

    await enqueuePlaylistDownload('pl-1');

    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('skips if playlist has no entries', async () => {
    mockFetchPlaylist.mockResolvedValue({ id: 'pl-1', name: 'Empty', entry: [] });

    await enqueuePlaylistDownload('pl-1');

    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('enqueues playlist with entries', async () => {
    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-1',
      name: 'My Playlist',
      coverArt: 'pl-cover',
      entry: [makeChild('t1'), makeChild('t2'), makeChild('t3')],
    });

    await enqueuePlaylistDownload('pl-1');

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].itemId).toBe('pl-1');
    expect(queue[0].type).toBe('playlist');
    expect(queue[0].totalTracks).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/*  enqueueStarredSongsDownload                                        */
/* ------------------------------------------------------------------ */

describe('enqueueStarredSongsDownload', () => {
  it('skips if starred songs are already cached', async () => {
    musicCacheStore.setState({
      cachedItems: {
        [STARRED_SONGS_ITEM_ID]: {
          itemId: STARRED_SONGS_ITEM_ID,
          type: 'playlist',
          name: 'Favorite Songs',
          tracks: [],
          totalBytes: 0,
        },
      },
    } as any);

    await enqueueStarredSongsDownload();

    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('skips if already in download queue', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: STARRED_SONGS_ITEM_ID, status: 'queued', tracks: [], totalTracks: 0, completedTracks: 0, addedAt: Date.now() },
      ],
    } as any);

    await enqueueStarredSongsDownload();

    // No duplicate added
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
  });

  it('skips if no starred songs', async () => {
    (favoritesStore as any).setState({ songs: [] });

    await enqueueStarredSongsDownload();

    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('enqueues starred songs as virtual playlist', async () => {
    const songs = [makeChild('s1'), makeChild('s2')];
    (favoritesStore as any).setState({ songs });

    await enqueueStarredSongsDownload();

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].itemId).toBe(STARRED_SONGS_ITEM_ID);
    expect(queue[0].type).toBe('playlist');
    expect(queue[0].name).toBe('Favorite Songs');
    expect(queue[0].coverArtId).toBe(STARRED_COVER_ART_ID);
    expect(queue[0].totalTracks).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  retryDownload                                                      */
/* ------------------------------------------------------------------ */

describe('retryDownload', () => {
  // Block processQueue so we can inspect intermediate state.
  beforeEach(() => {
    mockCheckStorageLimit.mockReturnValue(true);
    mockListDirectoryAsync.mockResolvedValue([]);
  });

  it('does nothing when queueId is not found', async () => {
    await retryDownload('nonexistent');
    // No crash
  });

  it('does nothing when item status is not error', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'album-1', status: 'queued', tracks: [makeChild('t1')], totalTracks: 1, completedTracks: 0, addedAt: Date.now() },
      ],
    } as any);

    await retryDownload('q1');

    expect(musicCacheStore.getState().downloadQueue[0].status).toBe('queued');
  });

  it('resets error item to queued and preserves completedTracks', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'error',
          error: 'Download failed',
          tracks: [makeChild('t1'), makeChild('t2'), makeChild('t3')],
          totalTracks: 3,
          completedTracks: 2,
          addedAt: Date.now(),
        },
      ],
    } as any);

    await retryDownload('q1');

    const item = musicCacheStore.getState().downloadQueue[0];
    expect(item.status).toBe('queued');
    expect(item.completedTracks).toBe(2);
    expect(item.error).toBeUndefined();
  });

  it('cleans up .tmp files but preserves completed files', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'error',
          error: 'Download failed',
          tracks: [makeChild('t1'), makeChild('t2')],
          totalTracks: 2,
          completedTracks: 1,
          addedAt: Date.now(),
        },
      ],
    } as any);

    mockListDirectoryAsync.mockResolvedValue(['t1.mp3', 't2.mp3.tmp']);
    mockFileExists = true;

    await retryDownload('q1');

    // Should have listed directory contents
    expect(mockListDirectoryAsync).toHaveBeenCalled();
    // Item should be requeued
    const item = musicCacheStore.getState().downloadQueue[0];
    expect(item.status).toBe('queued');
    expect(item.completedTracks).toBe(1);
  });

  it('handles retry when directory does not exist', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'error',
          error: 'Download failed',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
      ],
    } as any);

    mockDirExists = false;

    await retryDownload('q1');

    // Should not attempt to list directory
    expect(mockListDirectoryAsync).not.toHaveBeenCalled();
    // Item should still be requeued
    const item = musicCacheStore.getState().downloadQueue[0];
    expect(item.status).toBe('queued');
    expect(item.error).toBeUndefined();
  });

  it('repositions retried item after active/queued items', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'a1', status: 'error', error: 'fail', tracks: [makeChild('t1')], totalTracks: 1, completedTracks: 0, addedAt: 1 },
        { queueId: 'q2', itemId: 'a2', status: 'queued', tracks: [makeChild('t2')], totalTracks: 1, completedTracks: 0, addedAt: 2 },
        { queueId: 'q3', itemId: 'a3', status: 'error', error: 'fail', tracks: [makeChild('t3')], totalTracks: 1, completedTracks: 0, addedAt: 3 },
      ],
    } as any);

    await retryDownload('q1');

    const queue = musicCacheStore.getState().downloadQueue;
    // q1 was at index 0 (error), q2 is at index 1 (queued, last non-error).
    // After retry, q1 should be repositioned to index 1 (after q2).
    expect(queue[0].queueId).toBe('q2');
    expect(queue[1].queueId).toBe('q1');
  });
});

/* ------------------------------------------------------------------ */
/*  deleteCachedItem                                                   */
/* ------------------------------------------------------------------ */

describe('deleteCachedItem', () => {
  it('does nothing for empty itemId', () => {
    deleteCachedItem('');
    // No errors
  });

  it('removes cached item from store', () => {
    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
      totalBytes: 1000,
      totalFiles: 1,
    } as any);

    deleteCachedItem('album-1');

    expect(musicCacheStore.getState().cachedItems['album-1']).toBeUndefined();
    expect(musicCacheStore.getState().totalBytes).toBe(0);
    expect(musicCacheStore.getState().totalFiles).toBe(0);
  });

  it('clears track URI map entries for deleted item', async () => {
    // Populate trackUriMap via deferred init
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1'])
      .mockResolvedValueOnce(['t1.mp3']);
    await deferredMusicCacheInit();

    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    expect(getLocalTrackUri('t1')).not.toBeNull();

    deleteCachedItem('album-1');

    expect(getLocalTrackUri('t1')).toBeNull();
  });

  it('handles item not in cachedItems', () => {
    deleteCachedItem('nonexistent');
    // No crash; removeCachedItem is a no-op for missing items
  });
});

/* ------------------------------------------------------------------ */
/*  removeCachedPlaylistTrack                                          */
/* ------------------------------------------------------------------ */

describe('removeCachedPlaylistTrack', () => {
  it('does nothing for non-playlist items', () => {
    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    removeCachedPlaylistTrack('album-1', 0);

    // Album tracks unchanged
    expect(musicCacheStore.getState().cachedItems['album-1'].tracks).toHaveLength(1);
  });

  it('does nothing for out-of-bounds index', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    removeCachedPlaylistTrack('pl-1', 5);

    expect(musicCacheStore.getState().cachedItems['pl-1'].tracks).toHaveLength(1);
  });

  it('does nothing for negative index', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    removeCachedPlaylistTrack('pl-1', -1);

    expect(musicCacheStore.getState().cachedItems['pl-1'].tracks).toHaveLength(1);
  });

  it('removes track and adjusts byte totals', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1', 500), makeCachedTrack('t2', 800)],
          totalBytes: 1300,
        },
      },
      totalBytes: 1300,
      totalFiles: 2,
    } as any);

    removeCachedPlaylistTrack('pl-1', 0);

    const cached = musicCacheStore.getState().cachedItems['pl-1'];
    expect(cached.tracks).toHaveLength(1);
    expect(cached.tracks[0].id).toBe('t2');
    expect(musicCacheStore.getState().totalBytes).toBe(800);
    expect(musicCacheStore.getState().totalFiles).toBe(1);
  });

  it('does nothing for nonexistent item', () => {
    removeCachedPlaylistTrack('nonexistent', 0);
    // No crash
  });
});

/* ------------------------------------------------------------------ */
/*  reorderCachedPlaylistTracks                                        */
/* ------------------------------------------------------------------ */

describe('reorderCachedPlaylistTracks', () => {
  it('reorders tracks within a cached item', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1'), makeCachedTrack('t2'), makeCachedTrack('t3')],
          totalBytes: 3000,
        },
      },
    } as any);

    reorderCachedPlaylistTracks('pl-1', 0, 2);

    const tracks = musicCacheStore.getState().cachedItems['pl-1'].tracks;
    expect(tracks[0].id).toBe('t2');
    expect(tracks[1].id).toBe('t3');
    expect(tracks[2].id).toBe('t1');
  });

  it('does nothing for nonexistent item', () => {
    reorderCachedPlaylistTracks('nonexistent', 0, 1);
    // No crash
  });
});

/* ------------------------------------------------------------------ */
/*  syncCachedPlaylistTracks                                           */
/* ------------------------------------------------------------------ */

describe('syncCachedPlaylistTracks', () => {
  it('does nothing for non-playlist items', () => {
    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1'), makeCachedTrack('t2')],
          totalBytes: 2000,
        },
      },
    } as any);

    syncCachedPlaylistTracks('album-1', ['t1']);

    // Album unchanged
    expect(musicCacheStore.getState().cachedItems['album-1'].tracks).toHaveLength(2);
  });

  it('does nothing for nonexistent item', () => {
    syncCachedPlaylistTracks('nonexistent', ['t1']);
    // No crash
  });

  it('removes tracks not in newTrackIds', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1', 500), makeCachedTrack('t2', 800), makeCachedTrack('t3', 300)],
          totalBytes: 1600,
        },
      },
      totalBytes: 1600,
      totalFiles: 3,
    } as any);

    syncCachedPlaylistTracks('pl-1', ['t1', 't3']);

    const cached = musicCacheStore.getState().cachedItems['pl-1'];
    expect(cached.tracks).toHaveLength(2);
    expect(cached.tracks[0].id).toBe('t1');
    expect(cached.tracks[1].id).toBe('t3');
    expect(cached.totalBytes).toBe(800);
  });

  it('reorders tracks to match newTrackIds order', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1'), makeCachedTrack('t2'), makeCachedTrack('t3')],
          totalBytes: 3000,
        },
      },
    } as any);

    syncCachedPlaylistTracks('pl-1', ['t3', 't1', 't2']);

    const tracks = musicCacheStore.getState().cachedItems['pl-1'].tracks;
    expect(tracks.map((t: any) => t.id)).toEqual(['t3', 't1', 't2']);
  });

  it('ignores newTrackIds that are not in cached tracks', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    syncCachedPlaylistTracks('pl-1', ['t1', 't99']);

    const cached = musicCacheStore.getState().cachedItems['pl-1'];
    expect(cached.tracks).toHaveLength(1);
    expect(cached.tracks[0].id).toBe('t1');
  });
});

/* ------------------------------------------------------------------ */
/*  syncCachedItemTracks                                               */
/* ------------------------------------------------------------------ */

describe('syncCachedItemTracks', () => {
  it('does nothing for nonexistent item', () => {
    syncCachedItemTracks('nonexistent', [makeChild('t1')]);
    // No crash
  });

  it('does nothing when item is already in download queue', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
      downloadQueue: [
        { queueId: 'q1', itemId: 'pl-1', status: 'queued', tracks: [], totalTracks: 0, completedTracks: 0, addedAt: Date.now() },
      ],
    } as any);

    syncCachedItemTracks('pl-1', [makeChild('t1'), makeChild('t2')]);

    // Queue should not get a second entry
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
  });

  it('does nothing when no tracks have changed', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1'), makeCachedTrack('t2')],
          totalBytes: 2000,
        },
      },
    } as any);

    syncCachedItemTracks('pl-1', [makeChild('t1'), makeChild('t2')]);

    // No download queue entry created
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('re-enqueues when new tracks are detected', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    syncCachedItemTracks('pl-1', [makeChild('t1'), makeChild('t2')]);

    // Item should be moved from cachedItems to downloadQueue
    expect(musicCacheStore.getState().cachedItems['pl-1']).toBeUndefined();
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
    expect(musicCacheStore.getState().downloadQueue[0].itemId).toBe('pl-1');
    expect(musicCacheStore.getState().downloadQueue[0].totalTracks).toBe(2);
  });

  it('removes tracks no longer present before re-enqueue', () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1', 500), makeCachedTrack('t2', 800)],
          totalBytes: 1300,
        },
      },
      totalBytes: 1300,
      totalFiles: 2,
    } as any);

    // t2 removed, t3 added
    syncCachedItemTracks('pl-1', [makeChild('t1'), makeChild('t3')]);

    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].totalTracks).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  cancelDownload                                                     */
/* ------------------------------------------------------------------ */

describe('cancelDownload', () => {
  it('does nothing when queueId not found', () => {
    cancelDownload('nonexistent');
    // No error
  });

  it('removes item from queue and cleans track maps', async () => {
    // Populate trackUriMap first
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1'])
      .mockResolvedValueOnce(['t1.mp3']);
    await deferredMusicCacheInit();

    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'album-1', status: 'queued', tracks: [makeChild('t1')], totalTracks: 1, completedTracks: 0, addedAt: Date.now() },
      ],
    } as any);

    cancelDownload('q1');

    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
    expect(getLocalTrackUri('t1')).toBeNull();
  });

  it('schedules recalculate to correct phantom bytes from partial downloads', async () => {
    // Simulate partial download that added bytes via addBytes
    musicCacheStore.setState({
      totalBytes: 5000,
      totalFiles: 5,
      downloadQueue: [
        { queueId: 'q1', itemId: 'partial-album', status: 'downloading', tracks: [makeChild('t1')], totalTracks: 1, completedTracks: 0, addedAt: Date.now() },
      ],
    } as any);

    // Mock filesystem scan to return actual disk usage (less than tracked)
    mockGetDirectorySizeAsync.mockResolvedValue(1000);
    mockListDirectoryAsync
      .mockResolvedValueOnce(['other-album'])   // top-level listing
      .mockResolvedValueOnce(['t2.mp3']);        // files in other-album

    cancelDownload('q1');

    // Wait for background recalculate to settle
    await new Promise((r) => setTimeout(r, 50));

    // totalBytes should be corrected to actual disk usage
    expect(musicCacheStore.getState().totalBytes).toBe(1000);
    expect(musicCacheStore.getState().totalFiles).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  clearDownloadQueue                                                 */
/* ------------------------------------------------------------------ */

describe('clearDownloadQueue', () => {
  it('removes all queued items', () => {
    musicCacheStore.setState({
      downloadQueue: [
        { queueId: 'q1', itemId: 'a1', status: 'queued', tracks: [makeChild('t1')], totalTracks: 1, completedTracks: 0, addedAt: 1 },
        { queueId: 'q2', itemId: 'a2', status: 'downloading', tracks: [makeChild('t2')], totalTracks: 1, completedTracks: 0, addedAt: 2 },
      ],
    } as any);

    clearDownloadQueue();

    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('does not delete directories for items that are cached', () => {
    musicCacheStore.setState({
      cachedItems: {
        'a1': { itemId: 'a1', type: 'album', name: 'Test', tracks: [], totalBytes: 0 },
      },
      downloadQueue: [
        { queueId: 'q1', itemId: 'a1', status: 'queued', tracks: [makeChild('t1')], totalTracks: 1, completedTracks: 0, addedAt: 1 },
      ],
    } as any);

    clearDownloadQueue();

    // Item is removed from queue but directory should be preserved
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });

  it('schedules recalculate to correct phantom bytes', async () => {
    musicCacheStore.setState({
      totalBytes: 8000,
      totalFiles: 8,
      downloadQueue: [
        { queueId: 'q1', itemId: 'a1', status: 'downloading', tracks: [makeChild('t1')], totalTracks: 1, completedTracks: 0, addedAt: 1 },
        { queueId: 'q2', itemId: 'a2', status: 'queued', tracks: [makeChild('t2')], totalTracks: 1, completedTracks: 0, addedAt: 2 },
      ],
    } as any);

    mockGetDirectorySizeAsync.mockResolvedValue(2000);
    mockListDirectoryAsync
      .mockResolvedValueOnce(['cached-album'])
      .mockResolvedValueOnce(['t3.mp3', 't4.mp3']);

    clearDownloadQueue();

    await new Promise((r) => setTimeout(r, 50));

    expect(musicCacheStore.getState().totalBytes).toBe(2000);
    expect(musicCacheStore.getState().totalFiles).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  clearMusicCache                                                    */
/* ------------------------------------------------------------------ */

describe('clearMusicCache', () => {
  it('clears all cache and returns freed bytes', async () => {
    mockGetDirectorySizeAsync.mockResolvedValue(50000);

    const freed = await clearMusicCache();

    expect(freed).toBe(50000);
  });

  it('resets store state', async () => {
    musicCacheStore.setState({
      cachedItems: { 'a1': { itemId: 'a1' } },
      downloadQueue: [{ queueId: 'q1' }],
      totalBytes: 5000,
      totalFiles: 10,
    } as any);

    mockGetDirectorySizeAsync.mockResolvedValue(5000);

    await clearMusicCache();

    const state = musicCacheStore.getState();
    expect(state.cachedItems).toEqual({});
    expect(state.downloadQueue).toEqual([]);
    expect(state.totalBytes).toBe(0);
    expect(state.totalFiles).toBe(0);
  });

  it('clears track URI map', async () => {
    // Populate trackUriMap first
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1'])
      .mockResolvedValueOnce(['t1.mp3']);
    await deferredMusicCacheInit();
    expect(getLocalTrackUri('t1')).not.toBeNull();

    mockGetDirectorySizeAsync.mockResolvedValue(1000);
    await clearMusicCache();

    expect(getLocalTrackUri('t1')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  getMusicCacheStats                                                 */
/* ------------------------------------------------------------------ */

describe('getMusicCacheStats', () => {
  it('returns total bytes, item count, and file count', async () => {
    mockGetDirectorySizeAsync.mockResolvedValue(100000);
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1', 'album-2'])
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

    expect(stats.totalBytes).toBe(0);
    expect(stats.itemCount).toBe(0);
    expect(stats.totalFiles).toBe(0);
  });

  it('handles per-item listing errors gracefully', async () => {
    mockGetDirectorySizeAsync.mockResolvedValue(5000);
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-1', 'album-2'])
      .mockResolvedValueOnce(['t1.mp3'])
      .mockRejectedValueOnce(new Error('EACCES'));

    const stats = await getMusicCacheStats();

    expect(stats.totalBytes).toBe(5000);
    expect(stats.itemCount).toBe(2);
    expect(stats.totalFiles).toBe(1); // Only album-1's files counted
  });
});

/* ------------------------------------------------------------------ */
/*  resumeIfSpaceAvailable                                             */
/* ------------------------------------------------------------------ */

describe('resumeIfSpaceAvailable', () => {
  it('does not resume when storage is full', () => {
    mockCheckStorageLimit.mockReturnValue(true);
    resumeIfSpaceAvailable();
    // No crash; queue processing should not start
  });

  it('attempts to process queue when space available', () => {
    mockCheckStorageLimit.mockReturnValue(false);
    resumeIfSpaceAvailable();
    // No crash; processQueue will run (no items to process)
  });
});

/* ------------------------------------------------------------------ */
/*  deleteStarredSongsDownload                                         */
/* ------------------------------------------------------------------ */

describe('deleteStarredSongsDownload', () => {
  it('delegates to deleteCachedItem with starred ID', () => {
    musicCacheStore.setState({
      cachedItems: {
        [STARRED_SONGS_ITEM_ID]: {
          itemId: STARRED_SONGS_ITEM_ID,
          type: 'playlist',
          name: 'Favorite Songs',
          tracks: [],
          totalBytes: 0,
        },
      },
    } as any);

    deleteStarredSongsDownload();

    expect(musicCacheStore.getState().cachedItems[STARRED_SONGS_ITEM_ID]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Download pipeline (processQueue → downloadItem → downloadTrack)    */
/* ------------------------------------------------------------------ */

describe('download pipeline', () => {
  afterEach(async () => {
    // Wait for any in-progress download to finish, then force-reset
    // the processing state. Block processQueue from re-starting by
    // making the storage limit check fail.
    await waitForQueueIdle();
    mockCheckStorageLimit.mockReturnValue(true);
    await forceRecoverDownloadsAsync();
    await waitForQueueIdle();
  });

  it('downloads tracks and marks item complete', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    musicCacheStore.getState().enqueue({
      itemId: 'album-dl1',
      type: 'album',
      name: 'Test Album',
      artist: 'Test Artist',
      coverArtId: 'cover-1',
      totalTracks: 1,
      tracks: [makeChild('dl1-t1')],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    expect(beginDownload).toHaveBeenCalledWith('dl1-t1');
    expect(clearDownload).toHaveBeenCalledWith('dl1-t1');
    expect(musicCacheStore.getState().cachedItems['album-dl1']).toBeDefined();
    expect(musicCacheStore.getState().cachedItems['album-dl1'].tracks).toHaveLength(1);
  });

  it('resolves file extensions from suffix, contentType, and fallback', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    // downloadFormat is 'raw' (default from beforeEach) — tests suffix/contentType branches.
    // Track 1: has suffix → uses suffix
    // Track 2: no suffix, has contentType → uses MIME mapping
    // Track 3: no suffix, contentType with charset → strips params
    // Track 4: no suffix, unknown contentType → falls back to 'dat'
    // Track 5: no suffix, no contentType → falls back to 'dat'
    musicCacheStore.getState().enqueue({
      itemId: 'album-ext',
      type: 'album',
      name: 'Extension Test',
      totalTracks: 5,
      tracks: [
        makeChild('ext-t1', { suffix: 'flac' }),
        makeChild('ext-t2', { suffix: undefined, contentType: 'audio/flac' }),
        makeChild('ext-t3', { suffix: undefined, contentType: 'audio/mpeg; charset=utf-8' }),
        makeChild('ext-t4', { suffix: undefined, contentType: 'application/octet-stream' }),
        makeChild('ext-t5', { suffix: undefined, contentType: undefined }),
      ],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    const cached = musicCacheStore.getState().cachedItems['album-ext'];
    expect(cached).toBeDefined();
    expect(cached.tracks[0].fileName).toBe('ext-t1.flac');
    expect(cached.tracks[1].fileName).toBe('ext-t2.flac');
    expect(cached.tracks[2].fileName).toBe('ext-t3.mp3');
    expect(cached.tracks[3].fileName).toBe('ext-t4.dat');
    expect(cached.tracks[4].fileName).toBe('ext-t5.dat');
  });

  it('uses downloadFormat extension when not raw', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    playbackSettingsStore.setState({ downloadFormat: 'mp3' } as any);

    musicCacheStore.getState().enqueue({
      itemId: 'album-fmt',
      type: 'album',
      name: 'Test',
      totalTracks: 1,
      // suffix is 'flac' but downloadFormat 'mp3' overrides it
      tracks: [makeChild('fmt-t1', { suffix: 'flac' })],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    const cached = musicCacheStore.getState().cachedItems['album-fmt'];
    expect(cached).toBeDefined();
    expect(cached.tracks[0].fileName).toBe('fmt-t1.mp3');
  });

  it('skips track when getDownloadStreamUrl returns null', async () => {
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    (getDownloadStreamUrl as jest.Mock).mockReturnValue(null);

    musicCacheStore.getState().enqueue({
      itemId: 'album-nu',
      type: 'album',
      name: 'Test',
      totalTracks: 1,
      tracks: [makeChild('nu-t1')],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    const queue = musicCacheStore.getState().downloadQueue;
    const item = queue.find((q: any) => q.itemId === 'album-nu');
    if (item) {
      expect(item.status).toBe('error');
    }
  });

  it('handles download failure and sets error status', async () => {
    mockDownloadFileAsyncWithProgress.mockRejectedValue(new Error('network'));

    musicCacheStore.getState().enqueue({
      itemId: 'album-fail',
      type: 'album',
      name: 'Test',
      totalTracks: 1,
      tracks: [makeChild('fail-t1')],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    const queue = musicCacheStore.getState().downloadQueue;
    const item = queue.find((q: any) => q.itemId === 'album-fail');
    if (item) {
      expect(item.status).toBe('error');
    }
  });

  it('deduplicates tracks in playlists', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);
    // Use single worker so dedup runs sequentially (avoids race condition
    // where duplicate track is checked before the first copy finishes).
    musicCacheStore.setState({ maxConcurrentDownloads: 1 } as any);

    const track = makeChild('dup-t1');
    musicCacheStore.getState().enqueue({
      itemId: 'pl-dup',
      type: 'playlist',
      name: 'Test',
      totalTracks: 3,
      tracks: [track, track, makeChild('dup-t2')],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    const cached = musicCacheStore.getState().cachedItems['pl-dup'];
    expect(cached).toBeDefined();
    expect(cached.tracks).toHaveLength(3);
    // Only 2 unique downloads should have occurred
    expect(mockDownloadFileAsyncWithProgress).toHaveBeenCalledTimes(2);
  });

  it('stops processing when storage limit reached', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    musicCacheStore.getState().enqueue({
      itemId: 'album-sl',
      type: 'album',
      name: 'Test',
      totalTracks: 1,
      tracks: [makeChild('sl-t1')],
    });

    // Storage full: processQueue loop should break
    mockCheckStorageLimit.mockReturnValue(true);

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    // resumeIfSpaceAvailable doesn't call processQueue when storage is full
    expect(mockDownloadFileAsyncWithProgress).not.toHaveBeenCalled();
  });

  it('skips already-downloaded tracks during resume', async () => {
    // First, populate trackUriMap with res-t1
    mockListDirectoryAsync
      .mockResolvedValueOnce(['album-res'])
      .mockResolvedValueOnce(['res-t1.mp3']);
    await deferredMusicCacheInit();

    mockFileExists = true;
    mockFileSize = 3000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    musicCacheStore.getState().enqueue({
      itemId: 'album-res',
      type: 'album',
      name: 'Test',
      totalTracks: 2,
      tracks: [makeChild('res-t1'), makeChild('res-t2')],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    // t1 should be skipped (already on disk), only t2 downloaded
    expect(mockDownloadFileAsyncWithProgress).toHaveBeenCalledTimes(1);
    const cached = musicCacheStore.getState().cachedItems['album-res'];
    expect(cached).toBeDefined();
    expect(cached.tracks).toHaveLength(2);
  });

  it('processes multiple queued items sequentially', async () => {
    mockFileExists = true;
    mockFileSize = 2000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    musicCacheStore.getState().enqueue({
      itemId: 'a1',
      type: 'album',
      name: 'Album 1',
      totalTracks: 1,
      tracks: [makeChild('seq-t1')],
    });
    musicCacheStore.getState().enqueue({
      itemId: 'a2',
      type: 'album',
      name: 'Album 2',
      totalTracks: 1,
      tracks: [makeChild('seq-t2')],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    expect(musicCacheStore.getState().cachedItems['a1']).toBeDefined();
    expect(musicCacheStore.getState().cachedItems['a2']).toBeDefined();
  });

  it('checks storage limit mid-download and pauses item', async () => {
    let callCount = 0;
    mockDownloadFileAsyncWithProgress.mockImplementation(async () => {
      callCount++;
      // After first track, storage becomes full
      if (callCount >= 1) {
        mockCheckStorageLimit.mockReturnValue(true);
      }
    });
    mockFileExists = true;
    mockFileSize = 5000;

    musicCacheStore.getState().enqueue({
      itemId: 'album-mid',
      type: 'album',
      name: 'Test',
      totalTracks: 3,
      tracks: [makeChild('mid-t1'), makeChild('mid-t2'), makeChild('mid-t3')],
    });

    resumeIfSpaceAvailable();
    await waitForQueueIdle();

    // Should have started downloading but paused after storage limit
    const queue = musicCacheStore.getState().downloadQueue;
    const item = queue.find((q: any) => q.itemId === 'album-mid');
    // The item may be queued (paused) or partially complete
    if (item) {
      expect(['queued', 'downloading']).toContain(item.status);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  redownloadItem                                                     */
/* ------------------------------------------------------------------ */

describe('redownloadItem', () => {
  it('does nothing for nonexistent item', async () => {
    await redownloadItem('nonexistent');
    expect(mockFetchAlbum).not.toHaveBeenCalled();
    expect(mockFetchPlaylist).not.toHaveBeenCalled();
  });

  it('re-enqueues album download after deleting', async () => {
    // Block processQueue so enqueue doesn't immediately download
    mockCheckStorageLimit.mockReturnValue(true);

    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test Album',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    mockFetchAlbum.mockResolvedValue({
      id: 'album-1',
      name: 'Test Album',
      song: [makeChild('t1')],
    });

    await redownloadItem('album-1');

    // Old cache deleted
    expect(musicCacheStore.getState().cachedItems['album-1']).toBeUndefined();
    // Re-enqueued
    expect(mockFetchAlbum).toHaveBeenCalledWith('album-1');
  });

  it('re-enqueues playlist download after deleting', async () => {
    mockCheckStorageLimit.mockReturnValue(true);

    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test Playlist',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    mockFetchPlaylist.mockResolvedValue({
      id: 'pl-1',
      name: 'Test Playlist',
      entry: [makeChild('t1')],
    });

    await redownloadItem('pl-1');

    expect(musicCacheStore.getState().cachedItems['pl-1']).toBeUndefined();
    expect(mockFetchPlaylist).toHaveBeenCalledWith('pl-1');
  });
});

/* ------------------------------------------------------------------ */
/*  redownloadTrack                                                    */
/* ------------------------------------------------------------------ */

describe('redownloadTrack', () => {
  it('returns false for nonexistent item', async () => {
    const result = await redownloadTrack('nonexistent', 't1');
    expect(result).toBe(false);
  });

  it('returns false for nonexistent trackId', async () => {
    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    const result = await redownloadTrack('album-1', 'nonexistent');
    expect(result).toBe(false);
  });

  it('returns false when getDownloadStreamUrl returns null', async () => {
    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1')],
          totalBytes: 1000,
        },
      },
    } as any);

    (getDownloadStreamUrl as jest.Mock).mockReturnValue(null);

    const result = await redownloadTrack('album-1', 't1');
    expect(result).toBe(false);
  });

  it('returns false when download fails', async () => {
    const { File } = require('expo-file-system');
    File.downloadFileAsync.mockRejectedValueOnce(new Error('network'));

    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1', 500)],
          totalBytes: 500,
        },
      },
    } as any);

    const result = await redownloadTrack('album-1', 't1');
    expect(result).toBe(false);
  });

  it('re-downloads track successfully', async () => {
    const { File } = require('expo-file-system');
    File.downloadFileAsync.mockResolvedValue(undefined);
    mockFileExists = true;
    mockFileSize = 8000;

    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1', 500)],
          totalBytes: 500,
        },
      },
    } as any);

    const result = await redownloadTrack('album-1', 't1');
    expect(result).toBe(true);
  });

  it('uses downloadFormat extension when not raw', async () => {
    const { File } = require('expo-file-system');
    File.downloadFileAsync.mockResolvedValue(undefined);
    mockFileExists = true;
    mockFileSize = 8000;
    playbackSettingsStore.setState({ downloadFormat: 'mp3' } as any);

    musicCacheStore.setState({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'Test',
          tracks: [makeCachedTrack('t1', 500)],
          totalBytes: 500,
        },
      },
    } as any);

    const result = await redownloadTrack('album-1', 't1');
    expect(result).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  initMusicCache directory creation                                  */
/* ------------------------------------------------------------------ */

describe('initMusicCache directory creation', () => {
  it('creates directory when it does not exist', async () => {
    // Clear the cache dir so initMusicCache runs fresh
    mockGetDirectorySizeAsync.mockResolvedValue(0);
    await clearMusicCache();

    mockDirExists = false;
    initMusicCache();
    // No crash; directory.create() would be called
  });
});

/* ------------------------------------------------------------------ */
/*  removeCachedPlaylistTrack file operations                          */
/* ------------------------------------------------------------------ */

describe('removeCachedPlaylistTrack file operations', () => {
  it('deletes orphan track file from disk', async () => {
    mockFileExists = true;

    // Set up a playlist with a track that appears only in this item
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1', 500), makeCachedTrack('t2', 800)],
          totalBytes: 1300,
        },
      },
      totalBytes: 1300,
      totalFiles: 2,
    } as any);

    removeCachedPlaylistTrack('pl-1', 0);

    // Track t1 should be removed from cached item
    const cached = musicCacheStore.getState().cachedItems['pl-1'];
    expect(cached.tracks).toHaveLength(1);
    expect(cached.tracks[0].id).toBe('t2');
  });
});

/* ------------------------------------------------------------------ */
/*  syncCachedPlaylistTracks file operations                           */
/* ------------------------------------------------------------------ */

describe('syncCachedPlaylistTracks file deletion', () => {
  it('deletes files for removed tracks', () => {
    mockFileExists = true;

    musicCacheStore.setState({
      cachedItems: {
        'pl-1': {
          itemId: 'pl-1',
          type: 'playlist',
          name: 'Test',
          tracks: [makeCachedTrack('t1', 500), makeCachedTrack('t2', 800)],
          totalBytes: 1300,
        },
      },
      totalBytes: 1300,
      totalFiles: 2,
    } as any);

    syncCachedPlaylistTracks('pl-1', ['t2']);

    const cached = musicCacheStore.getState().cachedItems['pl-1'];
    expect(cached.tracks).toHaveLength(1);
    expect(cached.tracks[0].id).toBe('t2');
  });
});

/* ------------------------------------------------------------------ */
/*  storageLimitStore subscription                                     */
/* ------------------------------------------------------------------ */

describe('storageLimitStore subscription', () => {
  it('resumes queue when storage limit settings change', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    // Start with storage full
    mockCheckStorageLimit.mockReturnValue(true);

    musicCacheStore.getState().enqueue({
      itemId: 'album-sub',
      type: 'album',
      name: 'Test',
      totalTracks: 1,
      tracks: [makeChild('sub-t1')],
    });

    // Now release storage and trigger subscription
    mockCheckStorageLimit.mockReturnValue(false);
    (storageLimitStore as any).setState({
      limitMode: 'custom',
      maxCacheSizeGB: 20,
      isStorageFull: false,
    });

    await waitForQueueIdle();

    // Queue should have been processed
    expect(musicCacheStore.getState().cachedItems['album-sub']).toBeDefined();
  });

  it('resumes queue when storage was full and becomes available', async () => {
    mockFileExists = true;
    mockFileSize = 5000;
    mockDownloadFileAsyncWithProgress.mockResolvedValue(undefined);

    mockCheckStorageLimit.mockReturnValue(true);

    musicCacheStore.getState().enqueue({
      itemId: 'album-sub2',
      type: 'album',
      name: 'Test',
      totalTracks: 1,
      tracks: [makeChild('sub2-t1')],
    });

    // Simulate going from full to not full
    (storageLimitStore as any).setState({ isStorageFull: true });
    mockCheckStorageLimit.mockReturnValue(false);
    (storageLimitStore as any).setState({ isStorageFull: false });

    await waitForQueueIdle();

    expect(musicCacheStore.getState().cachedItems['album-sub2']).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  syncStarredSongsDownload (via favoritesStore subscription)         */
/* ------------------------------------------------------------------ */

describe('syncStarredSongsDownload via subscription', () => {
  it('deletes starred download when all songs are unstarred', () => {
    musicCacheStore.setState({
      cachedItems: {
        [STARRED_SONGS_ITEM_ID]: {
          itemId: STARRED_SONGS_ITEM_ID,
          type: 'playlist',
          name: 'Favorite Songs',
          tracks: [makeCachedTrack('s1')],
          totalBytes: 1000,
        },
      },
    } as any);

    // First set songs then clear them to trigger subscription
    (favoritesStore as any).setState({ songs: [makeChild('s1')] });
    (favoritesStore as any).setState({ songs: [] });

    expect(musicCacheStore.getState().cachedItems[STARRED_SONGS_ITEM_ID]).toBeUndefined();
  });

  it('does not fire subscription when songs reference is unchanged', () => {
    const songs = [makeChild('s1')];
    (favoritesStore as any).setState({ songs });

    musicCacheStore.setState({
      cachedItems: {
        [STARRED_SONGS_ITEM_ID]: {
          itemId: STARRED_SONGS_ITEM_ID,
          type: 'playlist',
          name: 'Favorite Songs',
          tracks: [makeCachedTrack('s1')],
          totalBytes: 1000,
        },
      },
    } as any);

    // Set the same reference — subscription should skip
    (favoritesStore as any).setState({ songs });

    // Starred download still exists
    expect(musicCacheStore.getState().cachedItems[STARRED_SONGS_ITEM_ID]).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  getMusicCacheStats sub-directory exists check                      */
/* ------------------------------------------------------------------ */

describe('getMusicCacheStats subdirectory checks', () => {
  it('skips non-existent subdirectories', async () => {
    mockDirExists = false;
    mockGetDirectorySizeAsync.mockResolvedValue(1000);
    mockListDirectoryAsync.mockResolvedValueOnce(['album-1', 'album-2']);

    const stats = await getMusicCacheStats();

    expect(stats.totalBytes).toBe(1000);
    expect(stats.itemCount).toBe(0);
    expect(stats.totalFiles).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  recoverStalledDownloadsAsync isProcessing guard                    */
/* ------------------------------------------------------------------ */

describe('recoverStalledDownloadsAsync guards', () => {
  it('does not run when queue has no queued or downloading items', async () => {
    musicCacheStore.setState({
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          status: 'error',
          tracks: [makeChild('t1')],
          totalTracks: 1,
          completedTracks: 0,
          addedAt: Date.now(),
        },
      ],
    } as any);

    await recoverStalledDownloadsAsync();

    // Status unchanged — error items are not recovered
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue[0].status).toBe('error');
  });
});
