/**
 * Persistent on-disk image cache service.
 *
 * Stores cover art images in {Paths.document}/image-cache/ so they
 * survive app updates and are not purged by the OS.
 *
 * Each cover art ID is cached at 4 size tiers (50, 150, 300, 600)
 * matching every size the app requests.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import { imageCacheStore } from '../store/imageCacheStore';
import { ensureCoverArtAuth, getCoverArtUrl } from './subsonicService';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** All image size tiers used across the app. */
export const IMAGE_SIZES = [50, 150, 300, 600] as const;

/** Supported extensions ordered by likelihood. */
const EXTENSIONS = ['.jpg', '.png', '.webp'] as const;

/** Map Content-Type to file extension. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let cacheDir: Directory | null = null;

/** In-flight download guard: prevents duplicate parallel downloads. */
const downloading = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Initialisation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Create the image-cache directory under Paths.document.
 * Safe to call multiple times (no-ops if already exists).
 */
export function initImageCache(): void {
  if (cacheDir) return;
  const dir = new Directory(Paths.document, 'image-cache');
  if (!dir.exists) {
    dir.create();
  }
  cacheDir = dir;
}

/** Return the initialised cache directory (auto-inits if needed). */
function ensureCacheDir(): Directory {
  if (!cacheDir) initImageCache();
  return cacheDir!;
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
  const dir = ensureCacheDir();
  const base = `${coverArtId}_${size}`;
  for (const ext of EXTENSIONS) {
    const file = new File(dir, `${base}${ext}`);
    if (file.exists) return file.uri;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Download helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Download a single image variant and write it to the cache.
 * Returns silently on failure so one bad size doesn't block others.
 */
async function downloadOne(
  coverArtId: string,
  size: number,
): Promise<void> {
  await ensureCoverArtAuth();
  const url = getCoverArtUrl(coverArtId, size);
  if (!url) return;

  try {
    const response = await fetch(url);
    if (!response.ok) return;

    const contentType = response.headers.get('content-type') ?? '';
    const ext = MIME_TO_EXT[contentType.split(';')[0].trim()] ?? '.jpg';

    const dir = ensureCacheDir();
    const fileName = `${coverArtId}_${size}${ext}`;
    const file = new File(dir, fileName);

    const bytes = new Uint8Array(await response.arrayBuffer());
    file.write(bytes);
    imageCacheStore.getState().addFile(bytes.length);
  } catch {
    // Swallow – caching is best-effort.
  }
}

/**
 * Download all size variants for a coverArtId in parallel.
 * No-ops if a download for this ID is already in progress.
 */
export async function cacheAllSizes(coverArtId: string): Promise<void> {
  if (!coverArtId) return;
  if (downloading.has(coverArtId)) return;
  downloading.add(coverArtId);
  try {
    await Promise.all(IMAGE_SIZES.map((s) => downloadOne(coverArtId, s)));
  } finally {
    downloading.delete(coverArtId);
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
 * Calculate cache statistics.
 */
export function getImageCacheStats(): ImageCacheStats {
  const dir = ensureCacheDir();
  const totalBytes = dir.size ?? 0;

  // Count files, then derive unique image count (4 variants each).
  let fileCount = 0;
  try {
    const contents = dir.list();
    fileCount = contents.filter((item) => item instanceof File).length;
  } catch {
    fileCount = 0;
  }

  const imageCount = Math.floor(fileCount / IMAGE_SIZES.length);

  return { totalBytes, imageCount };
}

/* ------------------------------------------------------------------ */
/*  Cache clearing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Delete all cached images and recreate the cache directory.
 * Returns the number of bytes freed.
 */
export function clearImageCache(): number {
  const dir = ensureCacheDir();
  const freedBytes = dir.size ?? 0;
  try {
    dir.delete();
  } catch {
    // May fail if already empty; ignore.
  }
  // Recreate.
  cacheDir = null;
  initImageCache();
  imageCacheStore.getState().reset();
  return freedBytes;
}
