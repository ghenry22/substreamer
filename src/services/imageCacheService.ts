/**
 * Persistent on-disk image cache service.
 *
 * Stores cover art images in {Paths.document}/image-cache/ so they
 * survive app updates and are not purged by the OS.
 *
 * Each cover art ID gets its own subdirectory containing up to 4 size
 * variants (50, 150, 300, 600):
 *
 *   image-cache/{coverArtId}/50.jpg
 *   image-cache/{coverArtId}/150.jpg
 *   image-cache/{coverArtId}/300.jpg
 *   image-cache/{coverArtId}/600.jpg
 *
 * Only the 600px source is downloaded from the server. Smaller
 * variants (300, 150, 50) are generated locally using
 * expo-image-manipulator.
 *
 * Downloads are queued and processed with configurable concurrency,
 * mirroring the pattern used by musicCacheService. Incomplete (.tmp)
 * files are cleaned up on startup and resume from background, and
 * their items are re-queued.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { AppState, type AppStateStatus } from 'react-native';
import { fetch } from 'expo/fetch';

import { listDirectoryAsync } from 'expo-async-fs';
import { imageCacheStore } from '../store/imageCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { fireAndForget } from '../utils/fireAndForget';
import {
  bulkInsertCachedImages,
  type CachedImageEntry as DbCachedImageEntry,
  clearAllCachedImages,
  deleteCachedImageVariant,
  deleteCachedImagesForCoverArt,
  findIncompleteCovers,
  hasCachedImage as dbHasCachedImage,
  hydrateImageCacheAggregates,
  listCachedImagesForBrowser,
  upsertCachedImage,
  type CacheBrowserFilter,
} from '../store/persistence/imageCacheTable';
import { ensureCoverArtAuth, getCoverArtUrl, stripCoverArtSuffix } from './subsonicService';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** All image size tiers used across the app. */
export const IMAGE_SIZES = [50, 150, 300, 600] as const;

/** The single size downloaded from the server; smaller sizes are derived locally. */
const SOURCE_SIZE = 600;

/** Sizes generated locally from the SOURCE_SIZE image. */
const RESIZE_SIZES = [300, 150, 50] as const;

/** Supported extensions ordered by likelihood. */
const EXTENSIONS = ['.jpg', '.png', '.webp'] as const;

/** Map Content-Type to file extension. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** JPEG quality for locally generated resize variants. */
const RESIZE_COMPRESS = 0.9;

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let cacheDir: Directory | null = null;
let isProcessing = false;
let appStateSubscription: { remove: () => void } | null = null;

/** CoverArtIds currently being downloaded/resized by a worker. */
const downloading = new Set<string>();

/** Ordered queue of coverArtIds waiting to be processed. */
const downloadQueue: string[] = [];

/**
 * Promise resolvers keyed by coverArtId. When a download finishes
 * (or is skipped), all registered resolvers for that ID are called
 * so callers of cacheAllSizes() are notified.
 */
const pendingResolvers = new Map<string, (() => void)[]>();

/**
 * In-memory URI cache: avoids repeated synchronous filesystem lookups
 * for the same coverArtId + size combination. Keyed by "coverArtId:size".
 */
const uriCache = new Map<string, string | null>();

function uriCacheKey(coverArtId: string, size: number): string {
  return `${coverArtId}:${size}`;
}

/* ------------------------------------------------------------------ */
/*  Initialisation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Create the image-cache directory under Paths.document and register
 * the AppState listener for resume-from-background cleanup.
 * Safe to call multiple times (no-ops if already initialised).
 *
 * Expensive scanning (stalled-download recovery, deduplication) is
 * NOT performed here — call {@link deferredImageCacheInit} after the
 * first React frame to avoid blocking the native splash screen.
 */
export function initImageCache(): void {
  if (cacheDir) return;
  // Wrap in try/catch because this is invoked at module-scope from
  // _layout.tsx, before any React error boundary is mounted. On stripped
  // OEM ROMs the synchronous Directory.create() can throw with restricted
  // storage permissions, and an unhandled throw here would crash the JS
  // bundle before the user can even reach the login screen. If init fails
  // here, cacheDir stays null and downstream callers will hit a controlled
  // null deref inside React, where an error boundary CAN catch it.
  try {
    const dir = new Directory(Paths.document, 'image-cache');
    if (!dir.exists) {
      dir.create();
    }
    cacheDir = dir;

    if (!appStateSubscription) {
      appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'active' && !isProcessing) {
          repairIncompleteImagesAsync();
        }
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[imageCacheService] initImageCache failed:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Unregister the AppState listener and clear cached module state.
 * Called from `resetAllStores()` on logout so a background→foreground
 * transition while logged out doesn't fire recovery against a reset store.
 * The next login re-arms the listener via `initImageCache()`.
 */
export function teardownImageCache(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  cacheDir = null;
}

/**
 * Run the expensive post-launch work that was split out of
 * {@link initImageCache} to avoid blocking app startup. Should be called
 * once after the first React frame renders.
 *
 * Order matters:
 *   1. `reconcileImageCacheAsync` heals FS↔SQL drift before anything else
 *      reads cache state. Without it, orphan files or missing rows would
 *      confuse the incomplete-detection query.
 *   2. `repairIncompleteImagesAsync` sweeps stale `.tmp` files and
 *      re-queues any covers SQL now reports as incomplete.
 *
 * All filesystem work runs via expo-async-fs, keeping the JS thread free.
 */
export async function deferredImageCacheInit(): Promise<void> {
  await reconcileImageCacheAsync();
  // Skip repair when offline — queuing downloads against a network we
  // can't reach would just churn until each retry exhausts. The
  // offline→online subscriber below picks it up when we reconnect.
  if (!offlineModeStore.getState().offlineMode) {
    await repairIncompleteImagesAsync();
  }
}

// Auto-resume repair when the user toggles back online. An in-flight
// offline session can accumulate incomplete covers (downloads that were
// mid-variant when the app went offline); the moment connectivity is
// back we want to clear them without making the user open Settings.
offlineModeStore.subscribe((state, prev) => {
  if (state.offlineMode === prev.offlineMode) return;
  if (state.offlineMode) return;
  if (imageCacheStore.getState().incompleteCount <= 0) return;
  fireAndForget(repairIncompleteImagesAsync(), 'imageCache.offlineResume');
});

/**
 * Heal drift between the `cached_images` table and the on-disk layout.
 *
 *   - **FS → SQL.** Walk `{image-cache}/{coverArtId}/*` once; for every
 *     real variant file missing a DB row, insert one. Uses file size for
 *     bytes and `Date.now()` for cachedAt (mtime isn't always available
 *     via expo-file-system).
 *   - **SQL → FS.** For every DB row whose file doesn't exist on disk,
 *     delete the row. Handles external removal (iTunes wipe, low-storage
 *     cleanup, manual `rm`).
 *   - Safety gate: if the walk's apparent "missing from SQL" count
 *     dwarfs what we already know about (>100 entries AND the table was
 *     non-empty), log and skip — almost certainly a transient filesystem
 *     issue (cache dir mid-init, security-scoped URL failure), and
 *     wiping a correct DB to match a broken FS view would be worse.
 */
export async function reconcileImageCacheAsync(): Promise<void> {
  const dir = ensureCacheDir();
  if (!dir.exists) return;

  let topLevelNames: string[];
  try {
    topLevelNames = await listDirectoryAsync(dir.uri);
  } catch {
    return;
  }

  const preAggregate = hydrateImageCacheAggregates();
  const newRows: Array<{
    coverArtId: string;
    size: number;
    ext: string;
    bytes: number;
    cachedAt: number;
  }> = [];
  // Track the (coverArtId, size) pairs we observe on disk so Pass 2 can
  // ignore rows that match real files. Seed from the new rows too so
  // Pass 2 doesn't delete rows we just queued for insert.
  const seenOnDisk = new Set<string>();
  const diskKey = (coverArtId: string, size: number) => `${coverArtId}::${size}`;

  // --- Pass 1: FS -> SQL (discover missing rows) ---
  for (const coverArtId of topLevelNames) {
    if (!coverArtId) continue;
    const subDir = new Directory(dir, coverArtId);
    if (!subDir.exists) continue;
    let fileNames: string[] = [];
    try {
      fileNames = await listDirectoryAsync(subDir.uri);
    } catch {
      continue;
    }
    for (const name of fileNames) {
      if (!name || name.endsWith('.tmp')) continue;
      const match = /^(50|150|300|600)\.(jpg|png|webp)$/.exec(name);
      if (!match) continue;
      const size = Number(match[1]);
      const ext = match[2];
      seenOnDisk.add(diskKey(coverArtId, size));
      if (dbHasCachedImage(coverArtId, size)) continue;
      const file = new File(subDir, name);
      if (!file.exists) continue;
      newRows.push({
        coverArtId,
        size,
        ext,
        bytes: file.size ?? 0,
        cachedAt: Date.now(),
      });
    }
  }

  // Safety gate against filesystem-unavailable false-positive inserts.
  // A large `newRows` alongside a non-trivial existing table means the
  // table and the FS disagree wildly — treat as suspicious and skip.
  const isMassInsert = newRows.length > 100 && preAggregate.fileCount > 50;
  if (!isMassInsert && newRows.length > 0) {
    bulkInsertCachedImages(newRows);
  } else if (isMassInsert) {
    // eslint-disable-next-line no-console
    console.warn(
      `[reconcileImageCacheAsync] safety gate: ${newRows.length} would-be inserts ` +
        `vs ${preAggregate.fileCount} rows already present — skipping FS→SQL sync this run`,
    );
  }

  // --- Pass 2: SQL -> FS (drop rows whose files are gone) ---
  // Walk the DB's view; delete any row whose file wasn't observed on disk.
  // Guarded by the same mass-missing heuristic — a temporarily-missing
  // cache directory shouldn't wipe the table.
  if (!isMassInsert) {
    const post = listCachedImagesForBrowser('all');
    let droppedCount = 0;
    for (const entry of post) {
      for (const file of entry.files) {
        if (seenOnDisk.has(diskKey(entry.coverArtId, file.size))) continue;
        const subDir = new Directory(dir, entry.coverArtId);
        const onDisk = new File(subDir, `${file.size}.${file.ext}`);
        if (onDisk.exists) continue;
        deleteCachedImageVariant(entry.coverArtId, file.size);
        droppedCount++;
      }
    }
    if (droppedCount > 0 || newRows.length > 0) {
      imageCacheStore.getState().recalculateFromDb();
    }
  }
}

/** Return the initialised cache directory (auto-inits if needed). */
function ensureCacheDir(): Directory {
  if (!cacheDir) initImageCache();
  return cacheDir!;
}

/* ------------------------------------------------------------------ */
/*  Startup / resume recovery                                          */
/* ------------------------------------------------------------------ */

/**
 * Clean up any abandoned `.tmp` files left from a crashed download or
 * variant generation, then re-queue every cover-art ID that's missing
 * one or more size variants on disk.
 *
 * The "incomplete" check used to walk every subdirectory; it now runs
 * as one SQL query (`findIncompleteCovers`). The `.tmp` sweep still
 * walks — `.tmp` files aren't in the DB by design, and a full tree
 * walk catches any that accumulated before the DB row was written.
 *
 * Exposed to the UI as the "Repair" action (settings-storage card +
 * image-cache browser row badge); also fires automatically at launch
 * post-splash and on resume-from-background via AppState.
 */
export async function repairIncompleteImagesAsync(): Promise<void> {
  if (isProcessing) return;

  const dir = ensureCacheDir();
  let subDirNames: string[];
  try {
    subDirNames = await listDirectoryAsync(dir.uri);
  } catch {
    subDirNames = [];
  }

  // --- Pass 1: sweep abandoned .tmp files ---
  for (const coverArtId of subDirNames) {
    if (!coverArtId) continue;
    const subDir = new Directory(dir, coverArtId);
    if (!subDir.exists) continue;
    let fileNames: string[] = [];
    try {
      fileNames = await listDirectoryAsync(subDir.uri);
    } catch {
      continue;
    }
    for (const name of fileNames) {
      if (!name.endsWith('.tmp')) continue;
      try { new File(subDir, name).delete(); } catch { /* best-effort */ }
    }
  }

  // --- Pass 2: re-queue incomplete covers via SQL ---
  const incomplete = findIncompleteCovers();
  for (const coverArtId of incomplete) {
    if (downloading.has(coverArtId) || downloadQueue.includes(coverArtId)) continue;
    for (const s of IMAGE_SIZES) {
      uriCache.delete(uriCacheKey(coverArtId, s));
    }
    downloadQueue.push(coverArtId);
  }

  if (downloadQueue.length > 0) {
    processQueue();
  }
}

/* ------------------------------------------------------------------ */
/*  Cache lookup (synchronous)                                         */
/* ------------------------------------------------------------------ */

/**
 * Check if a cached image exists for the given coverArtId and size.
 * Returns the local `file://` URI or `null`.
 */
export function getCachedImageUri(
  coverArtId: string,
  size: number,
): string | null {
  if (!coverArtId) return null;
  coverArtId = stripCoverArtSuffix(coverArtId);

  const key = uriCacheKey(coverArtId, size);
  if (uriCache.has(key)) return uriCache.get(key)!;

  const subDir = new Directory(ensureCacheDir(), coverArtId);
  if (!subDir.exists) {
    uriCache.set(key, null);
    return null;
  }
  for (const ext of EXTENSIONS) {
    const file = new File(subDir, `${size}${ext}`);
    if (file.exists) {
      uriCache.set(key, file.uri);
      return file.uri;
    }
  }
  uriCache.set(key, null);
  return null;
}

/**
 * Evict a single in-memory cache entry so the next lookup hits the
 * filesystem. Used by CachedImage's onError recovery path.
 */
export function evictUriCacheEntry(coverArtId: string, size: number): void {
  coverArtId = stripCoverArtSuffix(coverArtId);
  uriCache.delete(uriCacheKey(coverArtId, size));
}

/* ------------------------------------------------------------------ */
/*  Queue management                                                   */
/* ------------------------------------------------------------------ */

/** Resolve and remove all pending promise callbacks for a coverArtId. */
function resolveWaiters(coverArtId: string): void {
  const resolvers = pendingResolvers.get(coverArtId);
  if (resolvers) {
    for (const resolve of resolvers) resolve();
    pendingResolvers.delete(coverArtId);
  }
}

/** Resolve all pending waiters (used when the cache is cleared). */
function resolveAllWaiters(): void {
  for (const [, resolvers] of pendingResolvers) {
    for (const resolve of resolvers) resolve();
  }
  pendingResolvers.clear();
}

/**
 * Enqueue a coverArtId for download + local resize. Returns a Promise
 * that resolves once the image has been fully cached (all 4 sizes) or
 * skipped. No-ops if all sizes are already on disk.
 */
export function cacheAllSizes(coverArtId: string): Promise<void> {
  if (!coverArtId) return Promise.resolve();
  coverArtId = stripCoverArtSuffix(coverArtId);

  const allCached = IMAGE_SIZES.every(
    (s) => getCachedImageUri(coverArtId, s) != null,
  );
  if (allCached) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const list = pendingResolvers.get(coverArtId) ?? [];
    list.push(resolve);
    pendingResolvers.set(coverArtId, list);

    if (downloading.has(coverArtId) || downloadQueue.includes(coverArtId)) {
      return;
    }

    downloadQueue.push(coverArtId);
    processQueue();
  });
}

/* ------------------------------------------------------------------ */
/*  Queue processing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Process the download queue. Spawns up to maxConcurrentImageDownloads
 * workers using the same pool pattern as musicCacheService.
 */
async function processQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    while (downloadQueue.length > 0) {
      const { maxConcurrentImageDownloads } = imageCacheStore.getState();
      const workerCount = Math.min(
        maxConcurrentImageDownloads,
        downloadQueue.length,
      );
      const workers = Array.from(
        { length: workerCount },
        () => processNext(),
      );
      await Promise.all(workers);
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Worker loop: dequeue one coverArtId at a time and download + resize.
 */
async function processNext(): Promise<void> {
  while (downloadQueue.length > 0) {
    const coverArtId = downloadQueue.shift()!;
    if (downloading.has(coverArtId)) {
      continue;
    }
    downloading.add(coverArtId);
    try {
      await downloadAndCacheImage(coverArtId);
    } catch {
      /* individual image failure -- continue with the rest */
    } finally {
      downloading.delete(coverArtId);
      for (const s of IMAGE_SIZES) {
        uriCache.delete(uriCacheKey(coverArtId, s));
        getCachedImageUri(coverArtId, s);
      }
      // Re-derive the aggregate totals from SQL once per completed
      // coverArtId. Cheap (indexed scans) and keeps the store correct even
      // when partial-variant failures leave some rows unwritten.
      imageCacheStore.getState().recalculateFromDb();
      resolveWaiters(coverArtId);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Download + resize pipeline                                         */
/* ------------------------------------------------------------------ */

/**
 * Download the 600px source from the server (if not already cached)
 * and generate the 300, 150, and 50px variants locally.
 */
async function downloadAndCacheImage(coverArtId: string): Promise<void> {
  const subDir = new Directory(ensureCacheDir(), coverArtId);
  if (!subDir.exists) subDir.create();

  let source600Uri = getCachedImageUri(coverArtId, SOURCE_SIZE);
  if (!source600Uri) {
    source600Uri = await downloadSourceImage(coverArtId, subDir);
    if (!source600Uri) return;
  }

  for (const size of RESIZE_SIZES) {
    if (getCachedImageUri(coverArtId, size)) continue;
    await generateResizedVariant(source600Uri, coverArtId, size, subDir);
  }
}

/**
 * Download the source (600px) image from the Subsonic server.
 * Writes to a .tmp file first, then renames on success.
 * Returns the local file:// URI on success, or null on failure.
 */
async function downloadSourceImage(
  coverArtId: string,
  subDir: Directory,
): Promise<string | null> {
  await ensureCoverArtAuth();
  const url = getCoverArtUrl(coverArtId, SOURCE_SIZE);
  if (!url) return null;

  let tmpName: string | null = null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    const ext = MIME_TO_EXT[contentType.split(';')[0].trim()] ?? '.jpg';
    const fileName = `${SOURCE_SIZE}${ext}`;
    tmpName = `${fileName}.tmp`;

    const tmpFile = new File(subDir, tmpName);
    const bytes = new Uint8Array(await response.arrayBuffer());
    tmpFile.write(bytes);

    const dest = new File(subDir, fileName);
    if (dest.exists) {
      try { dest.delete(); } catch { /* best-effort */ }
    }
    tmpFile.move(dest);

    // DB row is written strictly after the successful rename. Any failure
    // before this point leaves the disk clean of the finalised file and
    // the DB row absent — the two stay consistent.
    upsertCachedImage({
      coverArtId,
      size: SOURCE_SIZE,
      ext: ext.slice(1), // strip leading '.'
      bytes: bytes.length,
      cachedAt: Date.now(),
    });
    uriCache.set(uriCacheKey(coverArtId, SOURCE_SIZE), dest.uri);

    return dest.uri;
  } catch {
    if (tmpName) {
      const tmp = new File(subDir, tmpName);
      if (tmp.exists) {
        try { tmp.delete(); } catch { /* best-effort */ }
      }
    }
    return null;
  }
}

/**
 * Generate a single resized variant from the 600px source using
 * expo-image-manipulator. Writes to a .tmp file first, then renames.
 */
async function generateResizedVariant(
  sourceUri: string,
  coverArtId: string,
  size: number,
  subDir: Directory,
): Promise<void> {
  const fileName = `${size}.jpg`;
  const tmpName = `${fileName}.tmp`;
  try {
    const context = ImageManipulator.manipulate(sourceUri);
    context.resize({ width: size });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: RESIZE_COMPRESS,
    });

    const savedFile = new File(saved.uri);
    savedFile.move(new File(subDir, tmpName));
    const tmpFile = new File(subDir, tmpName);

    const dest = new File(subDir, fileName);
    if (dest.exists) {
      try { dest.delete(); } catch { /* best-effort */ }
    }
    tmpFile.move(dest);

    // DB row after rename — mirrors the source-download pattern. A crash
    // between two variants leaves the DB missing the unfinished ones so
    // `findIncompleteCovers()` surfaces them for re-generation.
    upsertCachedImage({
      coverArtId,
      size,
      ext: 'jpg', // every derived variant is JPEG
      bytes: dest.size ?? 0,
      cachedAt: Date.now(),
    });
    uriCache.set(uriCacheKey(coverArtId, size), dest.uri);
  } catch {
    const tmp = new File(subDir, tmpName);
    if (tmp.exists) {
      try { tmp.delete(); } catch { /* best-effort */ }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Cache stats                                                        */
/* ------------------------------------------------------------------ */

export interface ImageCacheStats {
  /** Total bytes used by the image cache. */
  totalBytes: number;
  /** Number of unique cover art images cached. */
  imageCount: number;
  /** Total variant files on disk (every size × every cover). */
  fileCount: number;
  /** Number of covers with fewer than 4 variants on disk. */
  incompleteCount: number;
}

/**
 * Pull cache statistics directly from SQL aggregates. Previously walked
 * the whole `{image-cache}/` tree on every launch; now it's a single
 * indexed scan. Returns `Promise` only to preserve the existing async
 * contract for callers.
 */
export async function getImageCacheStats(): Promise<ImageCacheStats> {
  const agg = hydrateImageCacheAggregates();
  return {
    totalBytes: agg.totalBytes,
    imageCount: agg.imageCount,
    fileCount: agg.fileCount,
    incompleteCount: agg.incompleteCount,
  };
}

/* ------------------------------------------------------------------ */
/*  Cache browsing                                                     */
/* ------------------------------------------------------------------ */

/** A single cached file variant. */
interface CachedFileEntry {
  size: number;
  fileName: string;
  uri: string;
}

/** A cached image with all its size variants. */
export interface CachedImageEntry {
  coverArtId: string;
  files: CachedFileEntry[];
  /** True when all four size variants (50/150/300/600) are cached. */
  complete: boolean;
}

/**
 * List all cached images grouped by coverArtId — backed by a single
 * indexed SQL scan of `cached_images` (not a recursive disk walk).
 * Optional filter narrows to complete-only or incomplete-only entries
 * for the browser screen.
 *
 * File URIs are reconstructed from `(coverArtId, size, ext)` using the
 * same layout every code path writes to: `{image-cache}/{id}/{size}.{ext}`.
 */
export async function listCachedImagesAsync(
  filter: CacheBrowserFilter = 'all',
): Promise<CachedImageEntry[]> {
  // URIs are deterministic from (dir.uri, coverArtId, size, ext), so build
  // them by string concat. Constructing `new File()` / `new Directory()` for
  // every row crosses the native bridge and at 21k+ rows becomes the dominant
  // cost of opening the browser.
  const dirUri = ensureCacheDir().uri;
  const dbEntries: DbCachedImageEntry[] = listCachedImagesForBrowser(filter);
  return dbEntries.map((entry) => ({
    coverArtId: entry.coverArtId,
    complete: entry.complete,
    files: entry.files.map((f) => {
      const fileName = `${f.size}.${f.ext}`;
      return {
        size: f.size,
        fileName,
        uri: `${dirUri}/${entry.coverArtId}/${fileName}`,
      };
    }),
  }));
}

/**
 * Delete all cached variants for a single coverArtId.
 * Updates the imageCacheStore stats accordingly.
 */
export async function deleteCachedImage(coverArtId: string): Promise<void> {
  if (!coverArtId) return;
  coverArtId = stripCoverArtSuffix(coverArtId);

  for (const s of IMAGE_SIZES) {
    uriCache.delete(uriCacheKey(coverArtId, s));
  }

  const subDir = new Directory(ensureCacheDir(), coverArtId);
  if (!subDir.exists) {
    // Clean up any orphan DB rows for this cover (e.g. directory was
    // already removed externally), then stop.
    deleteCachedImagesForCoverArt(coverArtId);
    imageCacheStore.getState().recalculateFromDb();
    return;
  }

  // Delete the on-disk directory first, then the DB rows. Rebuild the
  // store aggregates from SQL at the end.
  try {
    subDir.delete();
  } catch {
    /* may fail if already removed */
  }

  deleteCachedImagesForCoverArt(coverArtId);
  imageCacheStore.getState().recalculateFromDb();
}

/**
 * Re-download all size variants for a single coverArtId.
 * Deletes existing files first, then downloads directly — bypasses the
 * global queue so the user-initiated refresh isn't blocked by other
 * in-flight downloads.
 */
export async function refreshCachedImage(coverArtId: string): Promise<void> {
  coverArtId = stripCoverArtSuffix(coverArtId);
  await deleteCachedImage(coverArtId);

  // Remove from queue/downloading so no worker races with us
  downloading.delete(coverArtId);
  const idx = downloadQueue.indexOf(coverArtId);
  if (idx !== -1) downloadQueue.splice(idx, 1);

  // Download directly instead of going through the queue
  downloading.add(coverArtId);
  try {
    await downloadAndCacheImage(coverArtId);
  } finally {
    downloading.delete(coverArtId);
    for (const s of IMAGE_SIZES) {
      uriCache.delete(uriCacheKey(coverArtId, s));
      getCachedImageUri(coverArtId, s);
    }
    imageCacheStore.getState().recalculateFromDb();
    resolveWaiters(coverArtId);
  }
}

/* ------------------------------------------------------------------ */
/*  Cache clearing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Delete all cached images and recreate the cache directory.
 * Returns the number of bytes freed — derived from the DB aggregate
 * (cheap single SELECT) rather than the former recursive directory walk.
 */
export async function clearImageCache(): Promise<number> {
  const agg = hydrateImageCacheAggregates();
  const freedBytes = agg.totalBytes;
  const dir = ensureCacheDir();
  try {
    dir.delete();
  } catch {
    /* may fail if already empty */
  }
  cacheDir = null;
  uriCache.clear();
  downloadQueue.length = 0;
  downloading.clear();
  resolveAllWaiters();
  initImageCache();
  clearAllCachedImages();
  imageCacheStore.getState().reset();
  return freedBytes;
}

/**
 * Proactively cache cover art for a list of entities (songs, albums, etc.).
 * Deduplicates by coverArt ID and skips entries already in cache.
 */
export function cacheEntityCoverArt(entities: Array<{ coverArt?: string }>): void {
  const seen = new Set<string>();
  for (const entity of entities) {
    if (entity.coverArt && !seen.has(entity.coverArt)) {
      seen.add(entity.coverArt);
      if (!getCachedImageUri(entity.coverArt, 300)) {
        cacheAllSizes(entity.coverArt).catch(() => { /* non-critical */ });
      }
    }
  }
}
