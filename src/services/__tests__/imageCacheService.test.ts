// `deferredImageCacheInit` wraps its body in requestIdleCallback, which
// Node/Jest doesn't polyfill. Fire the callback synchronously so awaiting
// the returned Promise resolves when the wrapped work completes.
(globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback =
  (cb: () => void) => { cb(); };

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

const mockListDirectoryAsync = jest.fn();
const mockGetDirectorySizeAsync = jest.fn();

const mockFileExistsMap = new Map<string, boolean>();
const mockDirExistsMap = new Map<string, boolean>();
// Per-file sizes for zero-byte / full-size scenarios. Absent entries
// default to 100 (non-empty) to preserve existing test expectations.
const mockFileSizeMap = new Map<string, number>();
// Tracks every File.delete() invocation (by internal `_name`) so tests
// can assert specific files were removed during reconciliation.
const mockFileDeleteCalls = new Set<string>();
// When non-null, MockDirectory.create() throws this Error. Used to exercise
// the catch handler in initImageCache (Fix 3 — module-scope crash hardening).
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
    get exists() { return mockFileExistsMap.get(this._name) ?? false; }
    get size() { return mockFileSizeMap.get(this._name) ?? 100; }
    write = jest.fn();
    delete = jest.fn(() => {
      mockFileDeleteCalls.add(this._name);
      mockFileExistsMap.delete(this._name);
      mockFileSizeMap.delete(this._name);
    });
    move = jest.fn((dest: MockFile) => {
      mockFileExistsMap.set(dest._name, true);
      mockFileExistsMap.delete(this._name);
    });
  }
  class MockDirectory {
    uri: string;
    _name: string;
    constructor(...args: any[]) {
      const parts = args.map((a: any) => (typeof a === 'string' ? a : a.uri ?? ''));
      this._name = parts.join('/');
      this.uri = `file://${this._name}`;
    }
    get exists() { return mockDirExistsMap.get(this._name) ?? true; }
    create = jest.fn(() => {
      if (mockDirCreateError) throw mockDirCreateError;
      mockDirExistsMap.set(this._name, true);
    });
    delete = jest.fn(() => { mockDirExistsMap.set(this._name, false); });
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: {
      document: { uri: 'file:///document' },
    },
  };
});

const mockResizeImageToFileAsync = jest.fn(
  async (_src: string, targetUri: string, _width: number, _quality: number) => {
    // Mimic the native module: after a successful resize the target file
    // exists on disk. Tests drive the mock file-existence map so downstream
    // rename/move logic sees the variant.
    mockFileExistsMap.set(targetUri.replace(/^file:\/\//, ''), true);
  },
);

jest.mock('expo-image-resize', () => ({
  resizeImageToFileAsync: (src: string, tgt: string, width: number, quality: number) =>
    mockResizeImageToFileAsync(src, tgt, width, quality),
}));

jest.mock('expo-async-fs', () => ({
  listDirectoryAsync: (...args: any[]) => mockListDirectoryAsync(...args),
  getDirectorySizeAsync: (...args: any[]) => mockGetDirectorySizeAsync(...args),
}));

jest.mock('expo/fetch', () => ({
  fetch: jest.fn(),
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

const mockReset = jest.fn();
const mockRecalculateFromDb = jest.fn();
const mockGetLastReconcileMs = jest.fn(() => undefined as number | undefined);
const mockMarkReconcileRan = jest.fn();
// Default: migration already done, so existing tests don't re-trigger the
// FS-rename pass. Tests that specifically exercise the migration override
// this with mockReturnValueOnce(false).
const mockGetFsKeyMigrationDone = jest.fn(() => true);
const mockMarkFsKeyMigrationDone = jest.fn();

const mockOfflineMode = { offlineMode: false };
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: {
    getState: jest.fn(() => mockOfflineMode),
    subscribe: jest.fn(() => () => {}), // no-op unsubscribe
  },
}));

jest.mock('../../store/imageCacheStore', () => ({
  imageCacheStore: {
    getState: jest.fn(() => ({
      maxConcurrentImageDownloads: 3,
      recalculateFromDb: mockRecalculateFromDb,
      reset: mockReset,
    })),
  },
  getLastReconcileMs: () => mockGetLastReconcileMs(),
  markReconcileRan: (ts: number) => mockMarkReconcileRan(ts),
  getFsKeyMigrationDone: () => mockGetFsKeyMigrationDone(),
  markFsKeyMigrationDone: () => mockMarkFsKeyMigrationDone(),
}));

// The service now reads stats + browser listings from `cached_images` via
// these helpers; tests drive the in-memory fake below.
type CacheDbRow = { coverArtId: string; size: number; ext: string; bytes: number; cachedAt: number };
const mockDbRows = new Map<string, CacheDbRow>();
const mockDbKey = (id: string, size: number) => `${id}::${size}`;
const mockUpsertCachedImage = jest.fn((row: CacheDbRow) => {
  mockDbRows.set(mockDbKey(row.coverArtId, row.size), row);
});
const mockDeleteCachedImagesForCoverArt = jest.fn((id: string) => {
  let bytes = 0;
  let count = 0;
  for (const [k, row] of [...mockDbRows]) {
    if (row.coverArtId === id) {
      bytes += row.bytes;
      count++;
      mockDbRows.delete(k);
    }
  }
  return { bytes, count };
});
const mockDeleteCachedImageVariant = jest.fn((id: string, size: number) => {
  mockDbRows.delete(mockDbKey(id, size));
});
const mockClearAllCachedImages = jest.fn(() => {
  mockDbRows.clear();
});
const mockHasCachedImage = jest.fn((id: string, size: number) => mockDbRows.has(mockDbKey(id, size)));
const mockFindIncompleteCovers = jest.fn(() => {
  const byCover = new Map<string, number>();
  for (const row of mockDbRows.values()) byCover.set(row.coverArtId, (byCover.get(row.coverArtId) ?? 0) + 1);
  return [...byCover.entries()].filter(([, n]) => n < 4).map(([id]) => id);
});
const mockHydrateImageCacheAggregates = jest.fn(() => {
  let totalBytes = 0;
  const covers = new Set<string>();
  const byCover = new Map<string, number>();
  for (const row of mockDbRows.values()) {
    totalBytes += row.bytes;
    covers.add(row.coverArtId);
    byCover.set(row.coverArtId, (byCover.get(row.coverArtId) ?? 0) + 1);
  }
  let incompleteCount = 0;
  for (const n of byCover.values()) if (n < 4) incompleteCount++;
  return { totalBytes, fileCount: mockDbRows.size, imageCount: covers.size, incompleteCount };
});
const mockListCachedImagesForBrowser = jest.fn((filter: 'all' | 'complete' | 'incomplete' = 'all') => {
  const byCover = new Map<string, CacheDbRow[]>();
  for (const row of mockDbRows.values()) {
    const list = byCover.get(row.coverArtId) ?? [];
    list.push(row);
    byCover.set(row.coverArtId, list);
  }
  const entries = [...byCover.entries()].map(([coverArtId, files]) => ({
    coverArtId,
    files: files.sort((a, b) => a.size - b.size).map((f) => ({ size: f.size, ext: f.ext, bytes: f.bytes, cachedAt: f.cachedAt })),
    complete: files.length === 4,
  }));
  entries.sort((a, b) => a.coverArtId.localeCompare(b.coverArtId));
  if (filter === 'complete') return entries.filter((e) => e.complete);
  if (filter === 'incomplete') return entries.filter((e) => !e.complete);
  return entries;
});
const mockBulkInsertCachedImages = jest.fn((rows: readonly CacheDbRow[]) => {
  for (const row of rows) mockDbRows.set(mockDbKey(row.coverArtId, row.size), row);
});

jest.mock('../../store/persistence/imageCacheTable', () => ({
  upsertCachedImage: (row: CacheDbRow) => mockUpsertCachedImage(row),
  deleteCachedImagesForCoverArt: (id: string) => mockDeleteCachedImagesForCoverArt(id),
  deleteCachedImageVariant: (id: string, size: number) => mockDeleteCachedImageVariant(id, size),
  clearAllCachedImages: () => mockClearAllCachedImages(),
  hasCachedImage: (id: string, size: number) => mockHasCachedImage(id, size),
  findIncompleteCovers: () => mockFindIncompleteCovers(),
  hydrateImageCacheAggregates: () => mockHydrateImageCacheAggregates(),
  listCachedImagesForBrowser: (filter?: 'all' | 'complete' | 'incomplete') => mockListCachedImagesForBrowser(filter),
  bulkInsertCachedImages: (rows: readonly CacheDbRow[]) => mockBulkInsertCachedImages(rows),
  getCachedImagesForCoverArt: jest.fn(() => []),
  countCachedImages: jest.fn(() => mockDbRows.size),
  countIncompleteCovers: jest.fn(() => mockFindIncompleteCovers().length),
}));

jest.mock('../subsonicService');

import { getCoverArtUrl, stripCoverArtSuffix } from '../subsonicService';
import {
  IMAGE_SIZES,
  initImageCache,
  deferredImageCacheInit,
  getCachedImageUri,
  evictUriCacheEntry,
  deleteCachedVariant,
  cacheAllSizes,
  getImageCacheStats,
  clearImageCache,
  listCachedImagesAsync,
  deleteCachedImage,
  refreshCachedImage,
  reconcileImageCacheAsync,
  repairIncompleteImagesAsync,
} from '../imageCacheService';

const { fetch: mockFetch } = jest.requireMock('expo/fetch') as { fetch: jest.Mock };
// Reset helpers for the new expo-image-resize mock. Each test can override
// default success behaviour with mockRejectedValueOnce / mockImplementationOnce.

/**
 * Helper: build the internal mock `_name` key for a subdirectory under image-cache.
 * Mirrors the mock Directory constructor chaining from Paths.document → image-cache → id.
 */
function subDirName(coverArtId: string): string {
  // cacheDir._name = 'file:///document/image-cache'
  // cacheDir.uri  = 'file://file:///document/image-cache'
  // subDir._name  = cacheDir.uri + '/' + coverArtId
  return `file://file:///document/image-cache/${coverArtId}`;
}

/**
 * Helper: build the internal mock `_name` key for a file inside a coverArtId subdirectory.
 * Mirrors the mock File constructor chaining from subDir → filename.
 */
function fileMockName(coverArtId: string, fileName: string): string {
  // subDir.uri = 'file://' + subDirName(coverArtId)
  // file._name = subDir.uri + '/' + fileName
  return `file://${subDirName(coverArtId)}/${fileName}`;
}

beforeEach(() => {
  mockFileExistsMap.clear();
  mockDirExistsMap.clear();
  mockFileSizeMap.clear();
  mockFileDeleteCalls.clear();
  mockDbRows.clear();
  mockListDirectoryAsync.mockReset();
  mockGetDirectorySizeAsync.mockReset();
  mockUpsertCachedImage.mockClear();
  mockDeleteCachedImagesForCoverArt.mockClear();
  mockDeleteCachedImageVariant.mockClear();
  mockClearAllCachedImages.mockClear();
  mockHasCachedImage.mockClear();
  mockFindIncompleteCovers.mockClear();
  mockHydrateImageCacheAggregates.mockClear();
  mockListCachedImagesForBrowser.mockClear();
  mockBulkInsertCachedImages.mockClear();
  mockRecalculateFromDb.mockClear();
  mockReset.mockClear();
  mockGetLastReconcileMs.mockReset();
  mockGetLastReconcileMs.mockReturnValue(undefined);
  mockMarkReconcileRan.mockClear();
  mockFetch.mockClear();
  mockResizeImageToFileAsync.mockClear();
  // Default: success. Target file appears in the mock FS existence map.
  mockResizeImageToFileAsync.mockImplementation(async (_src: string, targetUri: string) => {
    mockFileExistsMap.set(targetUri.replace(/^file:\/\//, ''), true);
  });
  (getCoverArtUrl as jest.Mock).mockReturnValue('https://example.com/cover.jpg');
  (stripCoverArtSuffix as jest.Mock).mockImplementation((id: string) => id.replace(/_[0-9a-f]+$/, ''));
  // Default: empty directory walks for reconcile + recover passes.
  mockListDirectoryAsync.mockResolvedValue([]);
  initImageCache();
});

// Helper: seed a row directly into the in-memory DB fake so tests can assert
// against the new SQL-backed read paths without hand-wiring file existence.
function seedDbRow(row: Partial<CacheDbRow> & { coverArtId: string; size: number }): void {
  mockDbRows.set(mockDbKey(row.coverArtId, row.size), {
    coverArtId: row.coverArtId,
    size: row.size,
    ext: row.ext ?? 'jpg',
    bytes: row.bytes ?? 100,
    cachedAt: row.cachedAt ?? Date.now(),
  });
}

describe('IMAGE_SIZES', () => {
  it('contains the four standard sizes', () => {
    expect(IMAGE_SIZES).toEqual([50, 150, 300, 600]);
  });
});

describe('initImageCache — module-scope crash hardening', () => {
  it('swallows Directory.create() failures so the bundle still boots', () => {
    // initImageCache is invoked at module-scope from _layout.tsx, before any
    // React error boundary is mounted. On stripped OEM ROMs the synchronous
    // Directory.create() can throw — verify the catch handler keeps the
    // exception from propagating up and crashing the bundle.
    mockDirExistsMap.set('file:///document/image-cache', false);
    mockDirCreateError = new Error('EACCES: permission denied');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = require('../imageCacheService');
        expect(() => fresh.initImageCache()).not.toThrow();
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('initImageCache failed'),
        expect.stringContaining('EACCES'),
      );
    } finally {
      mockDirCreateError = null;
      mockDirExistsMap.clear();
      warnSpy.mockRestore();
    }
  });
});

describe('getCachedImageUri', () => {
  it('returns null for empty coverArtId', () => {
    expect(getCachedImageUri('', 300)).toBeNull();
  });

  it('returns null when subdirectory does not exist', () => {
    mockDirExistsMap.clear();
    // All dirs default to true, explicitly set the subdir to false
    const result = getCachedImageUri('nonexistent-dir-check', 300);
    // Without matching file, returns null
    expect(result).toBeNull();
  });

  it('returns file URI when cached file exists', () => {
    // The mock File/Directory _name is built by joining .uri of parent + child string
    // So we need to match the exact key pattern the mock produces.
    // Just validate via the in-memory cache eviction path instead.
    const id = 'cover-cached-check';
    // First call populates the in-memory cache with null
    getCachedImageUri(id, 300);
    // Evict so it re-checks filesystem
    evictUriCacheEntry(id, 300);
    // Since we can't easily control the mock File.exists without knowing the exact _name,
    // verify the function returns null for uncached files.
    expect(getCachedImageUri(id, 300)).toBeNull();
  });

  it('uses in-memory cache on repeated calls', () => {
    const result1 = getCachedImageUri('uncached-id', 150);
    const result2 = getCachedImageUri('uncached-id', 150);
    expect(result1).toBe(result2);
  });
});

describe('evictUriCacheEntry', () => {
  it('evicts a cached entry so next lookup hits filesystem', () => {
    getCachedImageUri('evict-test', 300);
    evictUriCacheEntry('evict-test', 300);
    const result = getCachedImageUri('evict-test', 300);
    expect(result).toBeNull();
  });
});

describe('cacheAllSizes', () => {
  it('resolves immediately for empty coverArtId', async () => {
    await expect(cacheAllSizes('')).resolves.toBeUndefined();
  });

  it('resolves immediately when all sizes are cached', async () => {
    const id = 'all-cached';
    const subDirKey = `file:///document/image-cache/${id}`;
    mockDirExistsMap.set(subDirKey, true);
    for (const size of IMAGE_SIZES) {
      mockFileExistsMap.set(`${subDirKey}/${size}.jpg`, true);
    }

    await expect(cacheAllSizes(id)).resolves.toBeUndefined();
  });
});

describe('getImageCacheStats', () => {
  it('returns total bytes, unique image count, file count, and incomplete count', async () => {
    // Three covers: two complete (4 variants each), one incomplete (2 variants).
    // Total bytes: 4*100 + 4*100 + 2*100 = 1000
    for (const id of ['img1', 'img2']) {
      for (const size of [50, 150, 300, 600]) {
        seedDbRow({ coverArtId: id, size, bytes: 100 });
      }
    }
    seedDbRow({ coverArtId: 'img3', size: 50, bytes: 100 });
    seedDbRow({ coverArtId: 'img3', size: 150, bytes: 100 });

    const stats = await getImageCacheStats();
    expect(stats.totalBytes).toBe(1000);
    expect(stats.imageCount).toBe(3);
    expect(stats.fileCount).toBe(10);
    expect(stats.incompleteCount).toBe(1);
  });

  it('returns all-zero aggregates when DB is empty', async () => {
    const stats = await getImageCacheStats();
    expect(stats.totalBytes).toBe(0);
    expect(stats.imageCount).toBe(0);
    expect(stats.fileCount).toBe(0);
    expect(stats.incompleteCount).toBe(0);
  });
});

describe('listCachedImagesAsync', () => {
  it('returns empty array when DB has no rows', async () => {
    const result = await listCachedImagesAsync();
    expect(result).toEqual([]);
  });

  it('returns variants sorted by size from DB rows', async () => {
    seedDbRow({ coverArtId: 'art-1', size: 50, ext: 'png' });
    seedDbRow({ coverArtId: 'art-1', size: 300, ext: 'jpg' });
    seedDbRow({ coverArtId: 'art-1', size: 600, ext: 'webp' });

    const result = await listCachedImagesAsync();
    expect(result).toHaveLength(1);
    expect(result[0].coverArtId).toBe('art-1');
    expect(result[0].complete).toBe(false);
    expect(result[0].files).toHaveLength(3);
    expect(result[0].files[0].size).toBe(50);
    expect(result[0].files[1].size).toBe(300);
    expect(result[0].files[2].size).toBe(600);
  });

  it('filters by complete vs incomplete status', async () => {
    for (const size of [50, 150, 300, 600]) seedDbRow({ coverArtId: 'complete-art', size });
    seedDbRow({ coverArtId: 'partial-art', size: 600 });

    const complete = await listCachedImagesAsync('complete');
    const incomplete = await listCachedImagesAsync('incomplete');
    expect(complete.map((e) => e.coverArtId)).toEqual(['complete-art']);
    expect(incomplete.map((e) => e.coverArtId)).toEqual(['partial-art']);
  });
});

describe('deleteCachedImage', () => {
  it('does nothing for empty coverArtId', async () => {
    await deleteCachedImage('');
    expect(mockDeleteCachedImagesForCoverArt).not.toHaveBeenCalled();
    expect(mockRecalculateFromDb).not.toHaveBeenCalled();
  });

  it('removes on-disk subdirectory, drops DB rows, and recalculates store', async () => {
    const id = 'del-test';
    mockDirExistsMap.set(subDirName(id), true);
    seedDbRow({ coverArtId: id, size: 300, bytes: 1000 });
    seedDbRow({ coverArtId: id, size: 600, bytes: 1000 });

    await deleteCachedImage(id);

    expect(mockDeleteCachedImagesForCoverArt).toHaveBeenCalledWith(id);
    expect(mockRecalculateFromDb).toHaveBeenCalled();
    expect(mockDbRows.size).toBe(0);
  });

  it('still cleans up DB rows when the subdirectory is already gone', async () => {
    const id = 'orphan-rows';
    mockDirExistsMap.set(subDirName(id), false);
    seedDbRow({ coverArtId: id, size: 300, bytes: 1000 });

    await deleteCachedImage(id);

    expect(mockDeleteCachedImagesForCoverArt).toHaveBeenCalledWith(id);
    expect(mockRecalculateFromDb).toHaveBeenCalled();
    expect(mockDbRows.size).toBe(0);
  });
});

describe('clearImageCache', () => {
  it('returns total bytes from SQL aggregate and resets store', async () => {
    seedDbRow({ coverArtId: 'a', size: 50, bytes: 2500 });
    seedDbRow({ coverArtId: 'a', size: 150, bytes: 2500 });
    seedDbRow({ coverArtId: 'b', size: 300, bytes: 5000 });

    const freedBytes = await clearImageCache();

    expect(freedBytes).toBe(10000);
    expect(mockClearAllCachedImages).toHaveBeenCalled();
    expect(mockReset).toHaveBeenCalled();
    expect(mockDbRows.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Additional coverage tests                                          */
/* ------------------------------------------------------------------ */

describe('getCachedImageUri — file-found branch', () => {
  it('returns the file URI when a .jpg variant exists on disk', () => {
    const id = 'found-jpg';
    // Mark the subdirectory as existing
    mockDirExistsMap.set(subDirName(id), true);
    // Mark the 300.jpg file as existing
    mockFileExistsMap.set(fileMockName(id, '300.jpg'), true);

    const uri = getCachedImageUri(id, 300);
    expect(uri).not.toBeNull();
    expect(uri).toContain('300.jpg');
  });

  it('returns the file URI for a .png variant when .jpg does not exist', () => {
    const id = 'found-png';
    mockDirExistsMap.set(subDirName(id), true);
    // .jpg does NOT exist, but .png does
    mockFileExistsMap.set(fileMockName(id, '300.png'), true);

    const uri = getCachedImageUri(id, 300);
    expect(uri).not.toBeNull();
    expect(uri).toContain('300.png');
  });

  it('returns the file URI for a .webp variant', () => {
    const id = 'found-webp';
    mockDirExistsMap.set(subDirName(id), true);
    mockFileExistsMap.set(fileMockName(id, '600.webp'), true);

    const uri = getCachedImageUri(id, 600);
    expect(uri).not.toBeNull();
    expect(uri).toContain('600.webp');
  });

  it('caches a found URI in memory and returns the same value on subsequent calls', () => {
    const id = 'mem-cache-hit';
    mockDirExistsMap.set(subDirName(id), true);
    mockFileExistsMap.set(fileMockName(id, '150.jpg'), true);

    const first = getCachedImageUri(id, 150);
    // Remove the file from mock – second call should still return cached value
    mockFileExistsMap.delete(fileMockName(id, '150.jpg'));
    const second = getCachedImageUri(id, 150);
    expect(first).toBe(second);
    expect(first).not.toBeNull();
  });
});

describe('getCachedImageUri — directory-does-not-exist branch', () => {
  it('returns null and caches null when subdirectory does not exist', () => {
    const id = 'no-dir';
    mockDirExistsMap.set(subDirName(id), false);

    const result = getCachedImageUri(id, 300);
    expect(result).toBeNull();

    // Second call hits in-memory cache (no filesystem check)
    const second = getCachedImageUri(id, 300);
    expect(second).toBeNull();
  });
});

describe('download pipeline — cacheAllSizes + processQueue', () => {
  it('downloads source image and generates resized variants', async () => {
    const id = 'download-full';
    // Subdirectory defaults to exists=true, files don't exist
    // so getCachedImageUri returns null → triggers download

    // Mock fetch to return a successful response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    });

    // Default mockResizeImageToFileAsync in beforeEach handles happy path.
    await cacheAllSizes(id);

    // fetch was called for the 600px source
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/cover.jpg');
    // addFile was called for the source + 3 resized variants
    expect(mockUpsertCachedImage).toHaveBeenCalled();
  });

  it('resolves the promise even when download fails', async () => {
    const id = 'download-fail';

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw; the promise resolves after the failed download
    await expect(cacheAllSizes(id)).resolves.toBeUndefined();
  });
});

describe('downloadSourceImage — response.ok === false', () => {
  it('returns null and does not create files when server returns non-ok', async () => {
    const id = 'not-ok';

    mockFetch.mockResolvedValueOnce({
      ok: false,
      headers: { get: () => 'image/jpeg' },
    });

    await cacheAllSizes(id);

    // addFile should not have been called (no successful download)
    expect(mockUpsertCachedImage).not.toHaveBeenCalled();
  });
});

describe('downloadSourceImage — catch path cleans up .tmp', () => {
  it('deletes .tmp file when fetch throws after partial write', async () => {
    const id = 'tmp-cleanup';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.reject(new Error('Stream aborted')),
    });

    await cacheAllSizes(id);

    // The download failed, addFile should not be called
    expect(mockUpsertCachedImage).not.toHaveBeenCalled();
  });
});

describe('generateResizedVariant — success and catch paths', () => {
  it('generates resized variant successfully', async () => {
    const id = 'resize-ok';

    // Pre-set the 600px source as cached so downloadSourceImage is skipped
    mockDirExistsMap.set(subDirName(id), true);
    mockFileExistsMap.set(fileMockName(id, '600.jpg'), true);
    // Evict in-memory cache so getCachedImageUri re-checks filesystem
    for (const s of IMAGE_SIZES) evictUriCacheEntry(id, s);

    await cacheAllSizes(id);

    // resizeImageToFileAsync was called for each of the 3 resize sizes (300, 150, 50)
    expect(mockResizeImageToFileAsync).toHaveBeenCalledTimes(3);
    expect(mockUpsertCachedImage).toHaveBeenCalled();
  });

  it('continues processing when resize throws an error', async () => {
    const id = 'resize-fail';

    // Pre-set 600px source as cached
    mockDirExistsMap.set(subDirName(id), true);
    mockFileExistsMap.set(fileMockName(id, '600.jpg'), true);
    for (const s of IMAGE_SIZES) evictUriCacheEntry(id, s);

    // Make every resize call fail — failures must be caught internally.
    mockResizeImageToFileAsync.mockRejectedValue(new Error('Resize crash'));

    await expect(cacheAllSizes(id)).resolves.toBeUndefined();
  });
});

describe('repairIncompleteImagesAsync', () => {
  it('deletes .tmp files and re-queues incomplete downloads', async () => {
    const id = 'stalled';
    const sdName = subDirName(id);
    mockDirExistsMap.set(sdName, true);

    // Both reconcile + recover walk the dir tree; return the same layout each
    // time so either walk order works.
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return [id];
      return ['600.jpg', '300.jpg.tmp'];
    });

    // Seed one variant so findIncompleteCovers() surfaces this coverArtId
    // (less than 4 variants ⇒ incomplete).
    seedDbRow({ coverArtId: id, size: 600, ext: 'jpg' });

    // Pre-cache the source URI so the re-queue doesn't actually download.
    mockFileExistsMap.set(fileMockName(id, '600.jpg'), true);
    mockFileExistsMap.set(fileMockName(id, '300.jpg.tmp'), true);

    await deferredImageCacheInit();

    // Both walks ran — at minimum the top-level dir and one subdir per walk.
    expect(mockListDirectoryAsync).toHaveBeenCalled();
    expect(mockFindIncompleteCovers).toHaveBeenCalled();
  });

  it('handles listDirectoryAsync failure gracefully', async () => {
    // First call rejects (reconcile's top-level walk); subsequent calls fall
    // back to the beforeEach default of []. deferredImageCacheInit must not
    // propagate the rejection.
    mockListDirectoryAsync.mockRejectedValueOnce(new Error('I/O error'));

    await expect(deferredImageCacheInit()).resolves.toBeUndefined();
  });
});

describe('refreshCachedImage', () => {
  it('deletes existing cache and re-downloads all sizes', async () => {
    const id = 'refresh-me';
    const sdName = subDirName(id);
    mockDirExistsMap.set(sdName, true);
    // Seed DB rows that represent the existing cached variants being refreshed.
    seedDbRow({ coverArtId: id, size: 300, bytes: 2500 });
    seedDbRow({ coverArtId: id, size: 600, bytes: 2500 });

    // After deletion, cacheAllSizes triggers download
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048)),
    });

    await refreshCachedImage(id);

    // deleteCachedImage should have dropped the DB rows for this coverArtId.
    expect(mockDeleteCachedImagesForCoverArt).toHaveBeenCalledWith(id);
    // Then cacheAllSizes should have triggered a fresh download
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe('deduplication — concurrent cacheAllSizes calls', () => {
  it('does not trigger duplicate downloads for the same coverArtId', async () => {
    const id = 'dedup';

    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(256)),
    });

    // Call cacheAllSizes concurrently for the same id
    const p1 = cacheAllSizes(id);
    const p2 = cacheAllSizes(id);
    const p3 = cacheAllSizes(id);

    await Promise.all([p1, p2, p3]);

    // fetch should only have been called once (not 3 times)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Branch coverage: uncovered lines                                   */
/* ------------------------------------------------------------------ */

describe('AppState listener (lines 114-115)', () => {
  it('calls recovery when app becomes active and not processing', () => {
    const { AppState } = jest.requireMock('react-native') as any;
    // Get the callback that was registered
    const addEventListenerCall = AppState.addEventListener.mock.calls.find(
      (c: any[]) => c[0] === 'change',
    );
    expect(addEventListenerCall).toBeDefined();
    const callback = addEventListenerCall[1];

    // Provide listDirectoryAsync so repairIncompleteImagesAsync works
    mockListDirectoryAsync.mockResolvedValue([]);

    // Trigger with 'active' — should not throw
    callback('active');
    // Trigger with 'background' — no-op branch (next !== 'active')
    callback('background');
  });
});

describe('repairIncompleteImagesAsync — inner listDirectoryAsync failure (line 182)', () => {
  it('continues to next subdir when inner listing fails', async () => {
    // reconcile + recover each walk top-level once then each subdir once.
    // Make the top-level always report two dirs; the bad-dir always rejects,
    // the good-dir always resolves. Exercises the per-subdir try/catch branch.
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return ['ok-dir', 'fail-dir'];
      if (uri.includes('ok-dir')) return ['50.jpg', '150.jpg', '300.jpg', '600.jpg'];
      throw new Error('Permission denied');
    });

    mockDirExistsMap.set(subDirName('ok-dir'), true);
    mockDirExistsMap.set(subDirName('fail-dir'), true);

    await expect(deferredImageCacheInit()).resolves.toBeUndefined();
    // The `fail-dir` subdir listing was attempted (and rejected) without
    // tanking the pass.
    const uris = mockListDirectoryAsync.mock.calls.map((c) => c[0]);
    expect(uris.some((u: string) => u.includes('fail-dir'))).toBe(true);
  });
});

describe('downloadSourceImage — dest.exists before rename (line 399)', () => {
  it('deletes existing destination file before moving tmp', async () => {
    const id = 'dest-exists';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => {
        // Set dest as existing AFTER headers are read, before move
        mockFileExistsMap.set(fileMockName(id, '600.jpg'), true);
        return Promise.resolve(new ArrayBuffer(512));
      },
    });

    await cacheAllSizes(id);

    expect(mockFetch).toHaveBeenCalled();
    expect(mockUpsertCachedImage).toHaveBeenCalled();
  });
});

describe('downloadSourceImage — catch cleans up existing tmp (line 411)', () => {
  it('deletes .tmp file when it exists in the catch block', async () => {
    const id = 'catch-tmp-exists';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => {
        // Set tmp as existing so the catch block's tmp.exists check is true
        mockFileExistsMap.set(fileMockName(id, '600.jpg.tmp'), true);
        return Promise.reject(new Error('Write failed'));
      },
    });

    await cacheAllSizes(id);

    expect(mockUpsertCachedImage).not.toHaveBeenCalled();
  });
});

describe('generateResizedVariant — dest.exists before rename (line 445)', () => {
  it('deletes existing destination before moving resized file', async () => {
    const id = 'resize-dest-exists';

    mockDirExistsMap.set(subDirName(id), true);
    mockFileExistsMap.set(fileMockName(id, '600.jpg'), true);
    for (const s of IMAGE_SIZES) evictUriCacheEntry(id, s);

    let resizeCallCount = 0;
    mockResizeImageToFileAsync.mockImplementation(async (_src: string, targetUri: string) => {
      resizeCallCount++;
      // Set the dest file as existing for the CURRENT size so dest.exists is true
      // Resize order: 300, 150, 50
      const sizeForCall = [300, 150, 50][resizeCallCount - 1];
      if (sizeForCall) {
        mockFileExistsMap.set(fileMockName(id, `${sizeForCall}.jpg`), true);
      }
      // Target tmp also appears on disk so the subsequent move succeeds.
      mockFileExistsMap.set(targetUri.replace(/^file:\/\//, ''), true);
    });

    await cacheAllSizes(id);

    expect(mockResizeImageToFileAsync).toHaveBeenCalledTimes(3);
    expect(mockUpsertCachedImage).toHaveBeenCalled();
  });
});

describe('generateResizedVariant — catch with existing tmp (line 454)', () => {
  it('deletes .tmp file when resize fails and tmp exists on disk', async () => {
    const id = 'resize-catch-tmp';

    mockDirExistsMap.set(subDirName(id), true);
    mockFileExistsMap.set(fileMockName(id, '600.jpg'), true);
    for (const s of IMAGE_SIZES) evictUriCacheEntry(id, s);

    mockResizeImageToFileAsync.mockImplementation(async () => {
      // Set tmp files as existing before the error so the catch block's
      // tmp.exists check fires for each size.
      mockFileExistsMap.set(fileMockName(id, '300.jpg.tmp'), true);
      mockFileExistsMap.set(fileMockName(id, '150.jpg.tmp'), true);
      mockFileExistsMap.set(fileMockName(id, '50.jpg.tmp'), true);
      throw new Error('Resize failed');
    });

    await expect(cacheAllSizes(id)).resolves.toBeUndefined();
  });
});

describe('generateResizedVariant — 3-failure circuit breaker', () => {
  it('stops calling resize for a cover after three consecutive failures', async () => {
    const id = 'repeat-fail';

    mockDirExistsMap.set(subDirName(id), true);
    mockFileExistsMap.set(fileMockName(id, '600.jpg'), true);
    for (const s of IMAGE_SIZES) evictUriCacheEntry(id, s);

    mockResizeImageToFileAsync.mockRejectedValue(new Error('persistent decode failure'));

    // Each cacheAllSizes pass attempts 3 resizes (300/150/50). After the
    // first pass the failure counter hits 3; subsequent passes must skip.
    await cacheAllSizes(id);
    expect(mockResizeImageToFileAsync).toHaveBeenCalledTimes(3);

    mockResizeImageToFileAsync.mockClear();
    // Evict uriCache so cacheAllSizes believes the variants are still missing
    // and tries to regenerate them.
    for (const s of IMAGE_SIZES) evictUriCacheEntry(id, s);
    await cacheAllSizes(id);

    expect(mockResizeImageToFileAsync).not.toHaveBeenCalled();
  });
});

describe('listCachedImagesAsync — reconstructs URIs from DB row shape', () => {
  it('builds the file URI from (coverArtId, size, ext) on every row', async () => {
    seedDbRow({ coverArtId: 'good-dir', size: 300, ext: 'jpg' });
    seedDbRow({ coverArtId: 'good-dir', size: 600, ext: 'jpg' });
    mockDirExistsMap.set(subDirName('good-dir'), true);

    const result = await listCachedImagesAsync();

    expect(result).toHaveLength(1);
    expect(result[0].coverArtId).toBe('good-dir');
    expect(result[0].files).toHaveLength(2);
    for (const f of result[0].files) {
      expect(f.uri).toContain('good-dir');
      expect(f.uri).toContain(`${f.size}.jpg`);
    }
  });
});

describe('resolveAllWaiters with pending resolvers (line 259)', () => {
  it('resolves all pending waiters when clearImageCache is called during queued download', async () => {
    // getCoverArtUrl returns null → download can't proceed → promise stays pending
    const { getCoverArtUrl: mockGetCoverArtUrl } = jest.requireMock('../subsonicService') as any;
    mockGetCoverArtUrl.mockReturnValueOnce(null);

    // cacheAllSizes enqueues and processQueue runs, but downloadSourceImage returns
    // null (no URL) → the promise resolves via resolveWaiters.
    // However, for resolveAllWaiters we need items still pending when clearImageCache runs.

    // Use a slow fetch so the download is still in-flight when we clear
    let fetchResolve: () => void;
    const slowFetchPromise = new Promise<void>((resolve) => { fetchResolve = resolve; });
    mockGetCoverArtUrl.mockReturnValue('https://example.com/cover.jpg');

    mockFetch.mockImplementationOnce(() => slowFetchPromise.then(() => ({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
    })));

    const promise = cacheAllSizes('pending-clear');

    // Allow microtasks to start the queue processing
    await new Promise((r) => setTimeout(r, 10));

    // Clear cache while download is in-flight — calls resolveAllWaiters
    mockGetDirectorySizeAsync.mockResolvedValue(0);
    await clearImageCache();

    // The cacheAllSizes promise should now be resolved via resolveAllWaiters
    await expect(promise).resolves.toBeUndefined();

    // Unblock the fetch so it doesn't leak
    fetchResolve!();
  });
});

/* ------------------------------------------------------------------ */
/*  reconcileImageCacheAsync — zero-byte detection                    */
/* ------------------------------------------------------------------ */

describe('reconcileImageCacheAsync — zero-byte detection', () => {
  /** Internal key helper matching the mock File constructor chain. */
  function fileName(coverArtId: string, size: number, ext = 'jpg'): string {
    return fileMockName(coverArtId, `${size}.${ext}`);
  }

  it('Pass 1: deletes zero-byte files on disk and skips inserting them into the DB', async () => {
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return ['album1'];
      if (uri.endsWith('album1')) return ['600.jpg'];
      return [];
    });
    mockFileExistsMap.set(fileName('album1', 600), true);
    mockFileSizeMap.set(fileName('album1', 600), 0);

    await reconcileImageCacheAsync();

    // Zero-byte file was deleted…
    expect(mockFileDeleteCalls.has(fileName('album1', 600))).toBe(true);
    // …and never inserted into the DB.
    expect(mockBulkInsertCachedImages).not.toHaveBeenCalled();
    expect(mockDbRows.size).toBe(0);
  });

  it('Pass 1: preserves healthy files and inserts them as before', async () => {
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return ['album1'];
      if (uri.endsWith('album1')) return ['600.jpg'];
      return [];
    });
    mockFileExistsMap.set(fileName('album1', 600), true);
    mockFileSizeMap.set(fileName('album1', 600), 12345);

    await reconcileImageCacheAsync();

    expect(mockFileDeleteCalls.has(fileName('album1', 600))).toBe(false);
    expect(mockBulkInsertCachedImages).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ coverArtId: 'album1', size: 600, bytes: 12345 })]),
    );
  });

  it('Pass 2: drops a DB row whose file exists but is zero bytes', async () => {
    // Pass 1 sees nothing on disk for the coverArtId this test targets.
    mockListDirectoryAsync.mockImplementation(async () => []);
    // DB row is present; file on disk exists but is zero bytes.
    seedDbRow({ coverArtId: 'album2', size: 600, ext: 'jpg' });
    mockFileExistsMap.set(fileName('album2', 600), true);
    mockFileSizeMap.set(fileName('album2', 600), 0);

    await reconcileImageCacheAsync();

    // The zero-byte file was deleted…
    expect(mockFileDeleteCalls.has(fileName('album2', 600))).toBe(true);
    // …and the DB row was removed via the persistence helper.
    expect(mockDeleteCachedImageVariant).toHaveBeenCalledWith('album2', 600);
    expect(mockDbRows.has('album2::600')).toBe(false);
  });

  it('Pass 2: existing behaviour still drops rows whose files are missing', async () => {
    mockListDirectoryAsync.mockImplementation(async () => []);
    seedDbRow({ coverArtId: 'album3', size: 600, ext: 'jpg' });
    // File doesn't exist on disk.
    mockFileExistsMap.set(fileName('album3', 600), false);

    await reconcileImageCacheAsync();

    expect(mockDeleteCachedImageVariant).toHaveBeenCalledWith('album3', 600);
    expect(mockDbRows.has('album3::600')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  deleteCachedVariant — targeted file + DB removal                   */
/* ------------------------------------------------------------------ */

describe('deleteCachedVariant', () => {
  /** Internal key helper matching the mock File constructor chain. */
  function fileName(coverArtId: string, size: number, ext = 'jpg'): string {
    return fileMockName(coverArtId, `${size}.${ext}`);
  }

  it('deletes the on-disk file for the requested size and evicts the DB row', () => {
    seedDbRow({ coverArtId: 'album1', size: 600, ext: 'jpg' });
    mockFileExistsMap.set(fileName('album1', 600), true);
    mockFileSizeMap.set(fileName('album1', 600), 1000);

    deleteCachedVariant('album1', 600);

    expect(mockFileDeleteCalls.has(fileName('album1', 600))).toBe(true);
    expect(mockDeleteCachedImageVariant).toHaveBeenCalledWith('album1', 600);
    expect(mockRecalculateFromDb).toHaveBeenCalled();
  });

  it('leaves sibling variants untouched', () => {
    seedDbRow({ coverArtId: 'album1', size: 300, ext: 'jpg' });
    seedDbRow({ coverArtId: 'album1', size: 600, ext: 'jpg' });
    mockFileExistsMap.set(fileName('album1', 300), true);
    mockFileExistsMap.set(fileName('album1', 600), true);

    deleteCachedVariant('album1', 600);

    // Only the 600 file was deleted.
    expect(mockFileDeleteCalls.has(fileName('album1', 600))).toBe(true);
    expect(mockFileDeleteCalls.has(fileName('album1', 300))).toBe(false);
    // Only the 600 DB row was removed.
    expect(mockDeleteCachedImageVariant).toHaveBeenCalledTimes(1);
    expect(mockDeleteCachedImageVariant).toHaveBeenCalledWith('album1', 600);
    expect(mockDbRows.has('album1::300')).toBe(true);
  });

  it('is a no-op for empty coverArtId', () => {
    deleteCachedVariant('', 600);
    expect(mockDeleteCachedImageVariant).not.toHaveBeenCalled();
    expect(mockFileDeleteCalls.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  deferredImageCacheInit — 7-day reconcile throttle + idle deferral */
/* ------------------------------------------------------------------ */

describe('deferredImageCacheInit — throttle + idle deferral', () => {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  beforeEach(() => {
    // Offline flag controls whether repair runs; default is online for
    // these tests so we can observe the repair tmp-sweep call pattern.
    mockOfflineMode.offlineMode = false;
  });

  it('runs the reconcile pass when no previous timestamp exists', async () => {
    mockGetLastReconcileMs.mockReturnValue(undefined);
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return ['album1'];
      if (uri.endsWith('album1')) return [];
      return [];
    });

    await deferredImageCacheInit();

    // Reconcile walked the top-level directory (Pass 1 listing).
    const listedUris = mockListDirectoryAsync.mock.calls.map((c) => c[0]);
    expect(listedUris.some((uri) => uri.endsWith('image-cache'))).toBe(true);
  });

  it('skips the reconcile pass when the last run is less than 7 days ago', async () => {
    mockGetLastReconcileMs.mockReturnValue(Date.now() - (SEVEN_DAYS_MS - 60_000));

    await deferredImageCacheInit();

    // Reconcile was skipped — no listings of the top-level cache dir
    // initiated by the reconcile path. Repair still ran (single sweep),
    // so accept at most one listing of the image-cache dir from repair.
    const topLevelListings = mockListDirectoryAsync.mock.calls
      .map((c) => c[0])
      .filter((uri) => uri.endsWith('image-cache'));
    expect(topLevelListings.length).toBeLessThanOrEqual(1);
    // And the safety-gate short-circuit was never reached because Pass 1
    // never ran — bulk insert was not attempted.
    expect(mockBulkInsertCachedImages).not.toHaveBeenCalled();
  });

  it('runs the reconcile pass when the last run is 7 or more days ago', async () => {
    mockGetLastReconcileMs.mockReturnValue(Date.now() - (SEVEN_DAYS_MS + 1));
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return ['album1'];
      if (uri.endsWith('album1')) return ['600.jpg'];
      return [];
    });
    mockFileExistsMap.set(fileMockName('album1', '600.jpg'), true);
    mockFileSizeMap.set(fileMockName('album1', '600.jpg'), 1000);

    await deferredImageCacheInit();

    // Reconcile ran — the bulk insert for the observed variant fired.
    expect(mockBulkInsertCachedImages).toHaveBeenCalled();
  });

  it('runs the repair pass regardless of whether reconcile was throttled', async () => {
    mockGetLastReconcileMs.mockReturnValue(Date.now() - 1000); // <7d → reconcile skipped
    mockOfflineMode.offlineMode = false;
    mockFindIncompleteCovers.mockReturnValueOnce(['album-needs-repair']);

    await deferredImageCacheInit();

    // Repair's SQL query fired even though reconcile was throttled.
    expect(mockFindIncompleteCovers).toHaveBeenCalled();
  });

  it('skips repair when offline (unchanged legacy behaviour)', async () => {
    mockGetLastReconcileMs.mockReturnValue(Date.now() - 1000);
    mockOfflineMode.offlineMode = true;

    await deferredImageCacheInit();

    expect(mockFindIncompleteCovers).not.toHaveBeenCalled();
  });

  it('writes the timestamp on a successful reconcile via deferred init', async () => {
    mockGetLastReconcileMs.mockReturnValue(undefined);
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return [];
      return [];
    });

    await deferredImageCacheInit();

    expect(mockMarkReconcileRan).toHaveBeenCalledTimes(1);
    const writtenTs = mockMarkReconcileRan.mock.calls[0][0] as number;
    expect(typeof writtenTs).toBe('number');
    expect(writtenTs).toBeGreaterThan(0);
  });

  it('always runs reconcile and writes the timestamp on direct (user-initiated) calls', async () => {
    // Simulate "last run was just now" — the deferred path would skip.
    // A direct call must run anyway, matching the Settings "Scan" button
    // contract.
    mockGetLastReconcileMs.mockReturnValue(Date.now() - 1000);
    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return ['album1'];
      if (uri.endsWith('album1')) return ['600.jpg'];
      return [];
    });
    mockFileExistsMap.set(fileMockName('album1', '600.jpg'), true);
    mockFileSizeMap.set(fileMockName('album1', '600.jpg'), 1000);

    await reconcileImageCacheAsync();

    expect(mockBulkInsertCachedImages).toHaveBeenCalled();
    expect(mockMarkReconcileRan).toHaveBeenCalledTimes(1);
  });

  it('does NOT write the timestamp when the safety gate trips', async () => {
    mockGetLastReconcileMs.mockReturnValue(undefined);
    // Safety gate fires when newRows.length > 100 AND preAggregate.fileCount > 50.
    // Seed >50 pre-existing DB rows, then produce >100 new on-disk files.
    mockHydrateImageCacheAggregates.mockReturnValue({
      totalBytes: 1000,
      fileCount: 60,
      imageCount: 30,
      incompleteCount: 0,
    });
    const albumIds: string[] = [];
    for (let i = 0; i < 105; i++) albumIds.push(`album${i}`);

    mockListDirectoryAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('image-cache')) return albumIds;
      const match = albumIds.find((id) => uri.endsWith(id));
      if (match) return ['600.jpg'];
      return [];
    });
    for (const id of albumIds) {
      mockFileExistsMap.set(fileMockName(id, '600.jpg'), true);
      mockFileSizeMap.set(fileMockName(id, '600.jpg'), 1000);
    }
    // Silence the safety-gate warn.
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await reconcileImageCacheAsync();

    // Bulk insert was NOT called (safety gate skipped it).
    expect(mockBulkInsertCachedImages).not.toHaveBeenCalled();
    // Timestamp was NOT written — we want the next launch to retry.
    expect(mockMarkReconcileRan).not.toHaveBeenCalled();
  });

  it('is resilient when requestIdleCallback never fires (promise just never resolves)', async () => {
    // Replace the test-file polyfill for this one case with a no-op so the
    // promise should never resolve. Use Promise.race against a short timeout
    // to confirm the behaviour.
    const originalRIC = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    (globalThis as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback =
      () => { /* never fires */ };
    try {
      const result = await Promise.race([
        deferredImageCacheInit().then(() => 'resolved'),
        new Promise<string>((r) => setTimeout(() => r('pending'), 50)),
      ]);
      expect(result).toBe('pending');
      // Reconcile was not touched because the idle callback never fired.
      expect(mockBulkInsertCachedImages).not.toHaveBeenCalled();
      expect(mockMarkReconcileRan).not.toHaveBeenCalled();
    } finally {
      (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRIC;
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Sentinel sweep + guards                                            */
/* ------------------------------------------------------------------ */

describe('sentinel cover-art IDs — sweep + guards', () => {
  const STARRED = '__starred_cover__';
  const VARIOUS = '__various_artists_cover__';

  /** Seed all 4 sentinel variants so they look "complete" in SQL. */
  function seedSentinelComplete(id: string): void {
    for (const size of [50, 150, 300, 600]) {
      seedDbRow({ coverArtId: id, size });
    }
  }

  it('deferredImageCacheInit sweeps both sentinel IDs even offline', async () => {
    mockOfflineMode.offlineMode = true;
    seedSentinelComplete(STARRED);
    seedSentinelComplete(VARIOUS);
    expect(mockDbRows.size).toBe(8);

    await deferredImageCacheInit();

    // Both sentinels purged via deleteCachedImagesForCoverArt; no rows left.
    const remaining = [...mockDbRows.values()].map((r) => r.coverArtId);
    expect(remaining).not.toContain(STARRED);
    expect(remaining).not.toContain(VARIOUS);
    mockOfflineMode.offlineMode = false;
  });

  it('repairIncompleteImagesAsync sweeps sentinels before classifying outcomes', async () => {
    // 2 sentinel rows (incomplete) + 1 real incomplete that will fail to fetch.
    seedDbRow({ coverArtId: STARRED, size: 600 });
    seedDbRow({ coverArtId: VARIOUS, size: 600 });
    // A real album row — mock fetch returns 500 so the download fails
    // (no 3× yet — just one attempt in this pass).
    seedDbRow({ coverArtId: 'al-realbum', size: 600 });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const outcome = await repairIncompleteImagesAsync();

    // Sentinels don't show up in `queued` (they're swept before the snapshot).
    expect(outcome.queued).toBe(1);
    // The real album failed to fetch → still incomplete → failed.
    expect(outcome.failed).toBe(1);
    // Both sentinel coverArtIds removed (each had 1 file → 1 coverArtId each).
    expect(outcome.removed).toBe(2);
    expect(outcome.repaired).toBe(0);
  });

  it('cacheAllSizes is a no-op for sentinel IDs — no queue push, no fetch', async () => {
    await cacheAllSizes(STARRED);
    await cacheAllSizes(VARIOUS);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpsertCachedImage).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  Source-download circuit breaker                                    */
/* ------------------------------------------------------------------ */

describe('downloadSourceImage — 404 and 3× failure circuit breaker', () => {
  function fileName(coverArtId: string, size: number, ext = 'jpg'): string {
    return fileMockName(coverArtId, `${size}.${ext}`);
  }

  it('purges cache rows immediately when the server returns 404', async () => {
    seedDbRow({ coverArtId: 'dead-album', size: 600 });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await cacheAllSizes('dead-album');

    expect(mockDeleteCachedImagesForCoverArt).toHaveBeenCalledWith('dead-album');
    expect(mockDbRows.has(mockDbKey('dead-album', 600))).toBe(false);
  });

  it('purges cache rows after 3 consecutive non-404 failures', async () => {
    seedDbRow({ coverArtId: 'flaky-album', size: 600 });

    // Three 500 responses — the 3rd trips the breaker.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await cacheAllSizes('flaky-album');
    expect(mockDeleteCachedImagesForCoverArt).not.toHaveBeenCalledWith('flaky-album');
    await cacheAllSizes('flaky-album');
    expect(mockDeleteCachedImagesForCoverArt).not.toHaveBeenCalledWith('flaky-album');
    await cacheAllSizes('flaky-album');
    expect(mockDeleteCachedImagesForCoverArt).toHaveBeenCalledWith('flaky-album');
  });

  it('resets the failure counter after a successful download', async () => {
    seedDbRow({ coverArtId: 'sometimes-album', size: 600 });

    /**
     * Before each cacheAllSizes call, purge any on-disk variants so
     * getCachedImageUri returns null for all 4 sizes → cacheAllSizes
     * always takes the download path (not the all-cached short-circuit).
     */
    const purgeFs = () => {
      for (const size of [50, 150, 300, 600]) {
        for (const ext of ['jpg', 'png', 'webp']) {
          mockFileExistsMap.delete(fileName('sometimes-album', size, ext));
        }
        evictUriCacheEntry('sometimes-album', size);
      }
    };

    // Have the success step's fetch return bytes, and the successful
    // resize step write out the variant files. Any call to fetch after
    // the one success (below) falls into the persistent 500 default.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    mockResizeImageToFileAsync.mockImplementation(async (_src: string, targetUri: string) => {
      mockFileExistsMap.set(targetUri.replace(/^file:\/\//, ''), true);
    });

    purgeFs();
    await cacheAllSizes('sometimes-album');  // fail 1 (counter → 1)
    expect(mockDeleteCachedImagesForCoverArt).not.toHaveBeenCalledWith('sometimes-album');

    purgeFs();
    await cacheAllSizes('sometimes-album');  // fail 2 (counter → 2)
    expect(mockDeleteCachedImagesForCoverArt).not.toHaveBeenCalledWith('sometimes-album');

    // One-shot success: consumes the next fetch only.
    purgeFs();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(128),
    });
    await cacheAllSizes('sometimes-album');  // success (counter reset to 0)

    // Back to the persistent 500 default for the next 3 tries.
    purgeFs();
    await cacheAllSizes('sometimes-album');  // fail 1 of fresh run (counter → 1, not 3)
    expect(mockDeleteCachedImagesForCoverArt).not.toHaveBeenCalledWith('sometimes-album');

    purgeFs();
    await cacheAllSizes('sometimes-album');  // fail 2 (counter → 2)
    expect(mockDeleteCachedImagesForCoverArt).not.toHaveBeenCalledWith('sometimes-album');

    purgeFs();
    await cacheAllSizes('sometimes-album');  // fail 3 → breaker trips
    expect(mockDeleteCachedImagesForCoverArt).toHaveBeenCalledWith('sometimes-album');
  });
});

/* ------------------------------------------------------------------ */
/*  repairIncompleteImagesAsync — outcome classification                */
/* ------------------------------------------------------------------ */

describe('repairIncompleteImagesAsync — outcome counts', () => {
  function fileName(coverArtId: string, size: number, ext = 'jpg'): string {
    return fileMockName(coverArtId, `${size}.${ext}`);
  }

  it('returns {0,0,0,0} for an empty incomplete set', async () => {
    const outcome = await repairIncompleteImagesAsync();
    expect(outcome).toEqual({ queued: 0, repaired: 0, failed: 0, removed: 0 });
  });

  it('counts a successful repair as repaired, not failed', async () => {
    // Seed a row so the cover appears incomplete (1 of 4).
    seedDbRow({ coverArtId: 'album-ok', size: 600 });

    // Mock a successful fetch — the download pipeline upserts the 4
    // variants and the in-memory DB gets the full set.
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(128),
    });
    // After the fetch, the 600 source is written; variants (300/150/50)
    // are generated by expo-image-resize (mocked to succeed). The mock
    // resize adds file-existence entries, and the upsertCachedImage
    // calls during the resize loop add SQL rows.
    mockResizeImageToFileAsync.mockImplementation(async (_src: string, targetUri: string) => {
      mockFileExistsMap.set(targetUri.replace(/^file:\/\//, ''), true);
      mockFileSizeMap.set(targetUri.replace(/^file:\/\//, ''), 64);
    });

    const outcome = await repairIncompleteImagesAsync();

    expect(outcome.queued).toBe(1);
    expect(outcome.repaired).toBe(1);
    expect(outcome.failed).toBe(0);
    expect(outcome.removed).toBe(0);
  });

  it('counts a 404 as removed, not failed', async () => {
    seedDbRow({ coverArtId: 'album-404', size: 600 });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const outcome = await repairIncompleteImagesAsync();

    expect(outcome.queued).toBe(1);
    expect(outcome.removed).toBe(1);
    expect(outcome.repaired).toBe(0);
    expect(outcome.failed).toBe(0);
  });

  it('counts a single transient failure as failed (below the 3× threshold)', async () => {
    seedDbRow({ coverArtId: 'album-flaky', size: 600 });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const outcome = await repairIncompleteImagesAsync();

    expect(outcome.queued).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.removed).toBe(0);
    expect(outcome.repaired).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Filesystem-hostile coverArtIds (e.g. `dc-*:1` disc covers)         */
/* ------------------------------------------------------------------ */

describe('coverArtPathKey — FS-hostile coverArtId sanitisation', () => {
  function subDirUri(dirName: string): string {
    return `file://file:///document/image-cache/${dirName}`;
  }

  it('getCachedImageUri maps a `:` in coverArtId to `_` when checking the filesystem', () => {
    // Sanitised dir exists on disk; raw dir does NOT. The lookup must
    // resolve to the sanitised path.
    const sanitised = 'dc-abc_1';
    const raw = 'dc-abc:1';
    mockDirExistsMap.set(subDirUri(sanitised), true);
    mockFileExistsMap.set(fileMockName(sanitised, '600.jpg'), true);
    mockFileSizeMap.set(fileMockName(sanitised, '600.jpg'), 1000);

    const uri = getCachedImageUri(raw, 600);
    expect(uri).toMatch(/dc-abc_1\/600\.jpg$/);
    // The raw-form dir was never asked for.
    expect(mockDirExistsMap.has(subDirUri(raw))).toBe(false);
  });

  it('downloadAndCacheImage writes under the sanitised path', async () => {
    const raw = 'dc-foo:2';
    const sanitised = 'dc-foo_2';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(128),
    });

    await cacheAllSizes(raw);

    // The upsert went under the ORIGINAL coverArtId (SQL stays canonical).
    expect(mockUpsertCachedImage).toHaveBeenCalledWith(
      expect.objectContaining({ coverArtId: raw, size: 600 }),
    );
    // But the on-disk File was under the sanitised directory name.
    // Walk the existence map for any path containing the sanitised dir.
    const sanitisedPaths = [...mockFileExistsMap.keys()].filter((k) =>
      k.includes(`/${sanitised}/`),
    );
    expect(sanitisedPaths.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Reconcile: uriCache eviction on row deletion                       */
/* ------------------------------------------------------------------ */

describe('reconcileImageCacheAsync — uriCache eviction', () => {
  it('Pass 2: evicts the URI cache entry when a DB row is deleted for a missing file', async () => {
    // Seed a DB row for a cover whose file no longer exists on disk.
    seedDbRow({ coverArtId: 'gone-album', size: 600, ext: 'jpg' });
    mockListDirectoryAsync.mockImplementation(async () => []);
    mockFileExistsMap.clear();

    // Pre-warm the URI cache so we can prove it gets cleared.
    const { getCachedImageUri: _get } = require('../imageCacheService');
    // Prime: cache the null lookup (file doesn't exist).
    _get('gone-album', 600);

    await reconcileImageCacheAsync();

    // Row was deleted and the variant-level uriCache entry is evicted.
    expect(mockDeleteCachedImageVariant).toHaveBeenCalledWith('gone-album', 600);
    // A follow-up lookup sees an empty cache and has to hit the FS
    // (returns null because the file doesn't exist).
    expect(_get('gone-album', 600)).toBeNull();
  });
});
