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

import { listDirectoryAsync, getDirectorySizeAsync } from 'expo-async-fs';
import { imageCacheStore } from '../store/imageCacheStore';
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
          recoverStalledImageDownloadsAsync();
        }
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[imageCacheService] initImageCache failed:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Run the expensive filesystem scanning that was split out of
 * {@link initImageCache} to avoid blocking app startup.
 * Should be called once after the first React frame renders.
 *
 * All scanning runs on native background threads via expo-async-fs,
 * so the JS thread remains free for UI updates throughout.
 */
export async function deferredImageCacheInit(): Promise<void> {
  await recoverStalledImageDownloadsAsync();
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
 * Scan all subdirectories under image-cache/ for incomplete (.tmp)
 * files, delete them, and re-queue any coverArtId that is missing
 * size variants.
 *
 * Directory listing runs on a native background thread via
 * expo-async-fs, keeping the JS thread free for UI rendering.
 */
async function recoverStalledImageDownloadsAsync(): Promise<void> {
  if (isProcessing) return;

  const dir = ensureCacheDir();
  let subDirNames: string[];
  try {
    subDirNames = await listDirectoryAsync(dir.uri);
  } catch {
    return;
  }

  for (const coverArtId of subDirNames) {
    if (!coverArtId) continue;

    const subDir = new Directory(dir, coverArtId);
    if (!subDir.exists) continue;

    let hasTmp = false;
    let completeCount = 0;

    try {
      const fileNames = await listDirectoryAsync(subDir.uri);
      for (const name of fileNames) {
        if (name.endsWith('.tmp')) {
          hasTmp = true;
          try { new File(subDir, name).delete(); } catch { /* best-effort */ }
        } else {
          completeCount++;
        }
      }
    } catch {
      continue;
    }

    if (hasTmp || completeCount < IMAGE_SIZES.length) {
      if (!downloading.has(coverArtId) && !downloadQueue.includes(coverArtId)) {
        for (const s of IMAGE_SIZES) {
          uriCache.delete(uriCacheKey(coverArtId, s));
        }
        downloadQueue.push(coverArtId);
      }
    }
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

    imageCacheStore.getState().addFile(bytes.length);
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

    imageCacheStore.getState().addFile(dest.size ?? 0);
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
  /** Number of unique cover art images cached (each has 4 size variants). */
  imageCount: number;
}

/**
 * Calculate cache statistics. Directory size and listing run on a
 * native background thread via expo-async-fs, keeping the JS thread
 * free for UI rendering.
 */
export async function getImageCacheStats(): Promise<ImageCacheStats> {
  const dir = ensureCacheDir();
  const totalBytes = await getDirectorySizeAsync(dir.uri);

  let imageCount = 0;
  try {
    const entryNames = await listDirectoryAsync(dir.uri);
    imageCount = entryNames.length;
  } catch {
    imageCount = 0;
  }

  return { totalBytes, imageCount };
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
}

/** Regex to parse size-variant filenames: {size}.{ext} */
const SIZE_FILE_RE = /^(50|150|300|600)\.(jpg|png|webp)$/;

/**
 * List all cached images grouped by coverArtId.
 * Each entry includes the individual file variants found on disk.
 *
 * All directory listings run on native background threads via
 * expo-async-fs, so the JS thread stays free for smooth spinner
 * animations and touch handling throughout the scan.
 */
export async function listCachedImagesAsync(): Promise<CachedImageEntry[]> {
  const dir = ensureCacheDir();
  let subDirNames: string[];
  try {
    subDirNames = await listDirectoryAsync(dir.uri);
  } catch {
    return [];
  }

  const entries: CachedImageEntry[] = [];

  for (const coverArtId of subDirNames) {
    if (!coverArtId) continue;

    const subDir = new Directory(dir, coverArtId);
    if (!subDir.exists) continue;

    const files: CachedFileEntry[] = [];
    try {
      const fileNames = await listDirectoryAsync(subDir.uri);
      for (const name of fileNames) {
        const match = SIZE_FILE_RE.exec(name);
        if (!match) continue;
        const fileUri = new File(subDir, name).uri;
        files.push({ size: Number(match[1]), fileName: name, uri: fileUri });
      }
    } catch {
      continue;
    }

    if (files.length > 0) {
      files.sort((a, b) => a.size - b.size);
      entries.push({ coverArtId, files });
    }
  }

  entries.sort((a, b) => a.coverArtId.localeCompare(b.coverArtId));
  return entries;
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
  if (!subDir.exists) return;

  let deletedCount = 0;
  let deletedBytes = 0;
  try {
    const fileNames = await listDirectoryAsync(subDir.uri);
    deletedCount = fileNames.length;
    deletedBytes = await getDirectorySizeAsync(subDir.uri);
  } catch {
    /* best-effort -- proceed with deletion regardless */
  }

  try {
    subDir.delete();
  } catch {
    /* may fail if already removed */
  }

  if (deletedCount > 0) {
    imageCacheStore.getState().removeFiles(deletedCount, deletedBytes);
  }
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
    resolveWaiters(coverArtId);
  }
}

/* ------------------------------------------------------------------ */
/*  Cache clearing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Delete all cached images and recreate the cache directory.
 * Returns the number of bytes freed. Directory size runs on a native
 * background thread via expo-async-fs.
 */
export async function clearImageCache(): Promise<number> {
  const dir = ensureCacheDir();
  const freedBytes = await getDirectorySizeAsync(dir.uri);
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
