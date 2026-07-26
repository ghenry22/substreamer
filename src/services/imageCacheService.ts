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
import { errMessage } from '../utils/errorMessage';
import { onAppForeground } from '../utils/onAppForeground';
import { fetch } from 'expo/fetch';

import { deleteDirectoryAsync, deleteFileAsync, existsAsync, listDirectoryAsync, listDirectoryWithSizesAsync } from 'expo-async-fs';
import { resizeImageToFileAsync } from 'expo-image-resize';
import { withTimeout } from '../utils/withTimeout';
import {
  getLastReconcileMs,
  imageCacheStore,
  markReconcileRan,
} from '../store/imageCacheStore';
import { authStore } from '../store/authStore';
import { connectivityStore } from '../store/connectivityStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { fireAndForget } from '../utils/fireAndForget';
import { runWhenIdle } from '../utils/runWhenIdle';
import {
  bulkInsertCachedImages,
  type CachedImageEntry as DbCachedImageEntry,
  clearAllCachedImages,
  deleteCachedImageVariant,
  deleteCachedImagesForCoverArt,
  findIncompleteCovers,
  getAllCachedCoverArtIds,
  getCachedImagesForCoverArtAsync,
  hasCachedImage as dbHasCachedImage,
  hydrateImageCacheAggregatesAsync,
  listCachedImagesForBrowser,
  upsertCachedImage,
  type CacheBrowserFilter,
} from '../store/persistence/imageCacheTable';
import {
  clearImageQueueByCycle,
  countImageQueueRowsByCycle,
  countImageQueueRowsByStatus,
  enqueueImagesBulk,
  type ImageDownloadQueueRow,
  type ImageDownloadQueueScope,
  markImageDownloading,
  markImageError,
  pickNextQueuedImageRow,
  removeImageFromQueue,
  resetErrorRowsForCycle,
  resetStalledImageRows,
} from '../store/persistence/imageDownloadQueueTable';
// Synchronous adapter: the image-queue meta blob is read/written through a
// synchronous hand-rolled API (see readImageQueueMeta / writeImageQueueMeta).
import { kvStorageSync as kvStorage } from '../store/persistence';
import { awaitFirstPing } from './connectivityService';
import { logImageCache } from './imageCacheLogger';
import {
  ensureCoverArtAuth,
  getCoverArtUrl,
  type AlbumID3,
  type ArtistID3,
  type Child,
  type Playlist,
} from './subsonicService';
import { resolveEntityCoverArt, resolveSongCoverArt } from '../hooks/useSongCoverArt';

// Sentinel cover-art IDs rendered from bundled assets via
// `CachedImage.tsx`, never downloaded. Inlined here (not imported)
// because the canonical `STARRED_COVER_ART_ID` lives in
// `musicCacheService.ts` which already imports from this module
// (cycle), and `VARIOUS_ARTISTS_COVER_ART_ID` from `subsonicService`
// is auto-nulled by jest.mock in the test file. Drift risk is low:
// these strings are baked into multiple layers (backup format, UI
// code, tests).
const SENTINEL_COVER_ART_IDS: ReadonlySet<string> = new Set([
  '__starred_cover__',
  '__various_artists_cover__',
]);

function isSentinelCoverArtId(coverArtId: string): boolean {
  return SENTINEL_COVER_ART_IDS.has(coverArtId);
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** All image size tiers used across the app. */
export const IMAGE_SIZES = [50, 150, 300, 600] as const;

/** Largest variant — also the server-side source we download. Exported
 *  so CachedImage can use it as a fallback when a smaller variant URL
 *  fails server-side. */
const SOURCE_SIZE = 600;

/**
 * Cover-art ids whose remote URL has been reported broken by a CachedImage
 * instance since the last cache-update for that id. While an id is in this
 * set, every CachedImage instance suppresses the REMOTE rendering path for
 * that id and stays on PLACEHOLDER until a fresh file lands on disk (which
 * clears the entry automatically) or a coarse reset fires (clearImageCache,
 * offline → online transition).
 */
const failedRemoteIds = new Set<string>();

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

/**
 * Detect a NON-image response body. Some Subsonic servers answer `getCoverArt`
 * for a missing/invalid cover with an HTTP-200 **error envelope** — XML
 * (`<subsonic-response>` / `<?xml`) or JSON (`{...}`) — instead of image bytes.
 * Writing that text as an image file makes ImageIO/expo-image fail to decode on
 * every render (`createImageAtIndex … -62`).
 *
 * We detect the ERROR shape (starts with `<` or `{`) rather than allow-listing
 * image magic bytes — so ANY real image type is accepted (jpg/png/webp/gif/…,
 * whatever the server sends), and only the text error envelopes are rejected.
 * Real image bytes never begin with `<` or `{`.
 */
function isNonImageErrorBody(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length && i < 16; i++) {
    const c = bytes[i];
    // Skip leading whitespace + a UTF-8 BOM before the first meaningful byte.
    if (
      c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d ||
      c === 0xef || c === 0xbb || c === 0xbf
    ) {
      continue;
    }
    return c === 0x3c /* '<' → XML */ || c === 0x7b /* '{' → JSON */;
  }
  return false;
}

/** JPEG quality for locally generated resize variants. */
const RESIZE_COMPRESS = 0.9;

/** Sanity timeout for a cover-art SOURCE download (see the transport phase).
 *  Generous — covers can be large on a slow link — but bounded so an awaited
 *  cover fetch can't stall a music download indefinitely. */
const SOURCE_FETCH_TIMEOUT_MS = 30_000;

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
 * Build the deterministic `file://` URI for a variant by string concat,
 * matching the on-disk layout every write path uses: `{cacheDir}/{sanitised
 * coverArtId}/{size}.{ext}`. String concat (not `new File()`) avoids a native
 * bridge crossing per row — material when indexing tens of thousands of rows.
 */
function buildVariantUri(coverArtId: string, size: number, ext: string): string {
  // Build the URI via the SAME File/Directory objects the write path uses, so a
  // sanitised id (e.g. a disc-cover colon → `%3A`) is encoded identically. A
  // hand-built string under-encodes the `%` and resolves to a different on-disk
  // path than the file was written to — the file is never found.
  return new File(
    new Directory(ensureCacheDir(), coverArtPathKey(coverArtId)),
    `${size}.${ext}`,
  ).uri;
}

/**
 * Resolve the local `file://` URI for a cached cover variant — the async,
 * DB-authoritative replacement for the old synchronous in-memory index. Reads
 * the cover's rows off the JS thread (`getCachedImagesForCoverArtAsync`) and
 * builds the deterministic path. No in-memory index, no synchronous FS/SQLite:
 * the DB is the single source of truth and render resolves into state.
 *
 * `sourceFallback` returns the 600px source URI when the requested smaller
 * variant isn't cached yet (the server served the original but the resize
 * pipeline hasn't finished) — better than a placeholder.
 */
export async function resolveCachedImageUri(
  coverArtId: string,
  size: number,
  opts: { sourceFallback?: boolean } = {},
): Promise<string | null> {
  if (!coverArtId) return null;
  const rows = await getCachedImagesForCoverArtAsync(coverArtId);
  const exact = rows.find((r) => r.size === size);
  if (exact) return buildVariantUri(coverArtId, size, exact.ext);
  if (opts.sourceFallback && size !== SOURCE_SIZE) {
    const source = rows.find((r) => r.size === SOURCE_SIZE);
    if (source) return buildVariantUri(coverArtId, SOURCE_SIZE, source.ext);
  }
  return null;
}

/**
 * Which variant sizes a cover has on disk, per the DB — the source of truth for
 * download/skip decisions (`needed`, all-cached, still-missing). Async, off the
 * JS thread. Replaces the old `getCachedImageUri`-against-`uriCache` checks that
 * could skip a size when the in-memory index was transiently stale at boot.
 */
async function cachedSizesForCover(coverArtId: string): Promise<Set<number>> {
  const rows = await getCachedImagesForCoverArtAsync(coverArtId);
  return new Set(rows.map((r) => r.size));
}

/* ------------------------------------------------------------------ */
/*  Cache-update subscriptions                                          */
/* ------------------------------------------------------------------ */

/**
 * Per-coverArtId listener registry. When a cover art download or resize
 * lands a new file on disk, every subscriber for that coverArtId is
 * notified so it can re-derive its cached URI.
 *
 * Motivation: CachedImage instances on the home screen sometimes "give
 * up" on a flaky cover after two server errors and sit on the
 * placeholder. Later, the same coverArtId may successfully download via
 * a different code path — e.g. the user navigates to the album-detail
 * hero which retriggers cacheAllSizes from a fresh CachedImage mount,
 * and that attempt succeeds (server-side transient cleared). Without
 * the subscription, the placeholder card has no way to learn about the
 * new file landing on disk. With it, the card auto-refreshes as soon
 * as any subsequent download completes for its coverArtId.
 */
const cacheUpdateListeners = new Map<string, Set<() => void>>();

/**
 * Subscribe to cache-update events for a specific coverArtId. The
 * listener fires exactly once per (download-success OR resize-success)
 * event after subscribing — fire-and-forget; the listener is
 * responsible for calling `resolveCachedImageUri` to read the new state.
 *
 * Returns an unsubscribe function. Safe to call from useEffect.
 */
export function subscribeImageCacheUpdate(
  coverArtId: string,
  listener: () => void,
): () => void {
  if (!coverArtId) return () => {};
  let listeners = cacheUpdateListeners.get(coverArtId);
  if (!listeners) {
    listeners = new Set();
    cacheUpdateListeners.set(coverArtId, listeners);
  }
  listeners.add(listener);
  return () => {
    const set = cacheUpdateListeners.get(coverArtId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) cacheUpdateListeners.delete(coverArtId);
  };
}

/**
 * Notify all subscribers for a coverArtId. Called from the source-
 * download success path and from generateResizedVariant's success path.
 * Listener exceptions are swallowed so one bad subscriber can't poison
 * the rest.
 */
function notifyImageCacheUpdate(coverArtId: string): void {
  // A fresh on-disk variant (or a manual clear of the remote-failed
  // flag) is unambiguous recovery — drop any prior remote-failed
  // marker so subscribed CachedImage instances re-evaluate their URI
  // choice on the next render.
  failedRemoteIds.delete(coverArtId);
  const listeners = cacheUpdateListeners.get(coverArtId);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try { listener(); } catch { /* swallow */ }
  }
}

/**
 * Drop ALL remote-failed markers and notify every affected CachedImage so it
 * re-derives its URI on the next render. Used by the coarse recovery paths
 * (offline→online toggle, app foreground, server-reachable-again) so a cover
 * that hit a transient remote error self-heals WITHOUT an app restart — even
 * when `offlineMode` never flipped (a brief server blip while online).
 */
function clearFailedRemoteIds(reason: string): void {
  if (failedRemoteIds.size === 0) return;
  const ids = Array.from(failedRemoteIds);
  failedRemoteIds.clear();
  logImageCache(`clearFailedRemoteIds reason=${reason} count=${ids.length}`);
  for (const id of ids) {
    const listeners = cacheUpdateListeners.get(id);
    if (!listeners) continue;
    for (const listener of listeners) {
      try { listener(); } catch { /* swallow */ }
    }
  }
}

/**
 * Re-notify EVERY mounted CachedImage so it re-derives its URI and re-fetches
 * against the NEW active server. Called from the active-server switch
 * (primary↔secondary): a manual switch flips neither offlineMode nor
 * isServerReachable, so the subscription-driven recovery paths above never fire.
 *
 * Unlike `clearFailedRemoteIds`, this notifies ALL subscribers, not just the
 * remote-failed ones — covers stuck on the placeholder after a switch are
 * typically NOT in the failed set (no local file post-migration-wipe, and the
 * switch's `clearApiCache` briefly nulled the auth token so no remote URL was
 * built), so a failed-only sweep would miss them (the "scroll to load" symptom).
 */
export function retryRemoteImagesForServerSwitch(): void {
  failedRemoteIds.clear();
  let notified = 0;
  for (const listeners of cacheUpdateListeners.values()) {
    for (const listener of listeners) {
      try {
        listener();
        notified += 1;
      } catch {
        /* swallow — one bad subscriber can't poison the rest */
      }
    }
  }
  logImageCache(`retryRemoteImagesForServerSwitch notified=${notified}`);
}

/**
 * Characters that are either reserved on some filesystems (Windows:
 * `\/:*?"<>|`; legacy macOS: `:`) or otherwise troublesome in URIs.
 * Encoded as `%HH` (uppercase hex) before the coverArtId is used as an
 * on-disk directory name. `%` is included in the unsafe set so the
 * encoding is its own inverse — every distinct coverArtId maps to a
 * distinct on-disk path. The original coverArtId is still used
 * everywhere else (server URLs, SQL rows, URI cache keys) so server
 * and DB keys stay verbatim.
 *
 * Today's notable target is the OpenSubsonic/Navidrome disc-cover
 * format `dc-xxxx:N`, which gets sanitised to `dc-xxxx%3AN` on disk
 * while remaining `dc-xxxx:N` in SQL rows and getCoverArt URLs.
 */
const FS_UNSAFE_CHARS = /[%:\\/?<>*|"\x00]/g;

function coverArtPathKey(coverArtId: string): string {
  return coverArtId.replace(FS_UNSAFE_CHARS, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
  );
}

/**
 * Gate for "is it safe to forcibly delete a cache row right now?"
 * True only when we have positive signal that the server is responding
 * normally — so a failure we just observed can be confidently attributed
 * to the row itself rather than to the network path. Used at every
 * decision point that would otherwise purge a row based on an observed
 * failure.
 *
 * False when:
 *   - User is in offline mode (we agreed not to talk to the server).
 *   - Internet is reported unreachable by NetInfo.
 *   - Server is reported unreachable by the connectivity ping.
 *
 * If we observed an HTTP response from the server (any status), the
 * server proved itself responsive in that exact moment — but we still
 * route through this gate to err on the side of preserving rows when
 * the connectivity store disagrees.
 */
function isPurgeAllowedNow(): boolean {
  const conn = connectivityStore.getState();
  const offline = offlineModeStore.getState().offlineMode;
  return !offline && conn.hasConnection && conn.isServerReachable;
}

// Memoized set of cover-art ids belonging to DOWNLOADED items (albums,
// playlists, individually-downloaded songs) AND their per-track covers.
// Rebuilt only when `cachedItems`/`cachedSongs`/the cover-art mode change. Used
// to protect downloaded covers from the automated purge paths — a downloaded
// item's cached cover (including a downloaded playlist's/album's individual
// track thumbnails in per-track mode) must never be evicted by a transient
// server error; offline is a filtered view of this data.
let _dlCoverItemsSrc: unknown = null;
let _dlCoverSongsSrc: unknown = null;
let _dlCoverMode: string | null = null;
let _dlCoverIds = new Set<string>();
function downloadedCoverArtIds(): Set<string> {
  // Lazy require to avoid an import cycle (musicCacheStore → services → here).
  const { musicCacheStore } = require('../store/musicCacheStore');
  const { layoutPreferencesStore } = require('../store/layoutPreferencesStore');
  const state = musicCacheStore.getState();
  const cachedItems = state.cachedItems;
  const cachedSongs = state.cachedSongs;
  const mode = layoutPreferencesStore.getState().songCoverArtMode;
  if (cachedItems !== _dlCoverItemsSrc || cachedSongs !== _dlCoverSongsSrc || mode !== _dlCoverMode) {
    const next = new Set<string>();
    // Item-level covers (album/playlist/song/favorites holders).
    for (const item of Object.values(cachedItems) as Array<{ coverArtId?: string }>) {
      if (item.coverArtId) next.add(item.coverArtId);
    }
    // Per-track covers of every downloaded song, resolved mode-aware (album mode:
    // parent album's cover so tracks share one file; per-track: the song's own
    // cover) — mirrors the recache path so a downloaded playlist's/album's track
    // thumbnails are protected too, not just the item-level cover.
    for (const s of Object.values(cachedSongs) as Array<{
      coverArt?: string | null;
      albumId?: string | null;
    }>) {
      const id = resolveSongCoverArt(s);
      if (id) next.add(id);
    }
    _dlCoverIds = next;
    _dlCoverItemsSrc = cachedItems;
    _dlCoverSongsSrc = cachedSongs;
    _dlCoverMode = mode;
  }
  return _dlCoverIds;
}

/** True when a coverArtId belongs to a downloaded item (never auto-purge it). */
function isDownloadedCover(coverArtId: string): boolean {
  return downloadedCoverArtIds().has(coverArtId);
}

/**
 * Delete every on-disk variant and DB row for a coverArtId, and evict
 * its URI-cache entries. Used by the sentinel sweep, the 404 short-
 * circuit, the source-download connectivity-gated purge, and the
 * variant-resize threshold purge.
 *
 * NO-OP for downloaded items: a downloaded item's cover is required for offline
 * rendering and must never be evicted by an automated path (transient 404/5xx,
 * resize hiccup). Only the manual "clear image cache" / logout wipe it.
 */
async function purgeCoverArtRows(coverArtId: string): Promise<{ files: number }> {
  if (isDownloadedCover(coverArtId)) {
    logImageCache(`purge skipped (downloaded item): ${coverArtId}`);
    variantFailureCount.delete(coverArtId);
    return { files: 0 };
  }
  const result = await deleteCachedImagesForCoverArt(coverArtId);
  try {
    const subDir = new Directory(ensureCacheDir(), coverArtPathKey(coverArtId));
    if (subDir.exists) {
      for (const size of IMAGE_SIZES) {
        for (const ext of EXTENSIONS) {
          const file = new File(subDir, `${size}${ext}`);
          if (file.exists) {
            try { file.delete(); } catch { /* best-effort */ }
          }
        }
      }
    }
  } catch {
    /* best-effort — DB is the source of truth */
  }
  variantFailureCount.delete(coverArtId);
  return { files: result.count };
}

/**
 * Remove any cached_images rows + on-disk files for the sentinel cover
 * IDs (`__starred_cover__`, `__various_artists_cover__`). Their images
 * are bundled with the app — CachedImage renders them from the asset
 * resolver, never from the disk cache — so any rows here are stale from
 * a prior app version and will otherwise show up as permanently
 * "Incomplete" because getCoverArtUrl returns null for them.
 *
 * Returns the number of sentinel coverArtIds that had rows (0–2). Safe
 * to call multiple times — idempotent after the first run.
 */
async function sweepSentinelRows(): Promise<number> {
  let cleared = 0;
  let totalFiles = 0;
  for (const id of SENTINEL_COVER_ART_IDS) {
    // eslint-disable-next-line no-await-in-loop
    const { files } = await purgeCoverArtRows(id);
    if (files > 0) cleared++;
    totalFiles += files;
  }
  if (totalFiles > 0) {
    imageCacheStore.getState().recalculateFromDb();
  }
  return cleared;
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
      appStateSubscription = onAppForeground(() => {
        // Wait for the post-resume ping result so the repair pass uses
        // confirmed connectivity state. AppState 'active' triggers a
        // ping in connectivityService; we await its outcome here.
        fireAndForget(
          (async () => {
            if (offlineModeStore.getState().offlineMode) return;
            await awaitFirstPing();
            if (offlineModeStore.getState().offlineMode) return;
            // Foreground recovery: a remote load that failed while the app
            // was backgrounded (or during a transient blip) stays in
            // failedRemoteIds until something clears it. The offline→online
            // toggle didn't fire if offlineMode never flipped, so clear here.
            clearFailedRemoteIds('appstate-active');
            await repairIncompleteImages('appstate-active');
          })(),
          'imageCache.appStateActive',
        );
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[imageCacheService] initImageCache failed:', errMessage(e));
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
 *   1. `reconcileImageCache` heals FS↔SQL drift before anything else
 *      reads cache state. Without it, orphan files or missing rows would
 *      confuse the incomplete-detection query.
 *   2. `repairIncompleteImages` sweeps stale `.tmp` files and
 *      re-queues any covers SQL now reports as incomplete.
 *
 * All filesystem work runs via expo-async-fs, keeping the JS thread free.
 */
/** Reconcile only runs once per this interval in the deferred-init path.
 *  Manual triggers from Settings always run regardless of this throttle. */
const RECONCILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when the last successful reconcile is missing or older than
 * RECONCILE_INTERVAL_MS. Only consulted by the deferred-init path —
 * user-initiated scans from Settings call `reconcileImageCache`
 * directly and bypass this check entirely.
 */
function shouldRunReconcile(): boolean {
  const last = getLastReconcileMs();
  if (last == null) return true;
  return Date.now() - last >= RECONCILE_INTERVAL_MS;
}

export function deferredImageCacheInit(): Promise<void> {
  // Defer to an idle window so the reconcile/repair FS passes never
  // compete with first-render or initial animations.
  return new Promise((resolve) => {
    runWhenIdle(async () => {
      try {
        // Always sweep sentinel rows, even offline — it's a pure SQL +
        // local-file cleanup and prevents the Settings "Incomplete"
        // count from permanently including rows the download pipeline
        // can never service.
        sweepSentinelRows();

        if (shouldRunReconcile()) {
          await reconcileImageCache('startup');
        }

        // Repair is non-blocking from here. The startup chain in
        // _layout.tsx awaits this function before running music cache
        // init and data sync init — gating those on connectivity would
        // be wrong. Spin off the repair so the home screen renders
        // immediately and repair runs silently once the connectivity
        // service has produced its first definitive ping result.
        if (!offlineModeStore.getState().offlineMode) {
          fireAndForget(
            (async () => {
              await awaitFirstPing();
              // Re-check offline mode in case the user toggled it during
              // the wait. Belt-and-braces: isPurgeAllowedNow() also
              // checks per-failure inside the repair pass.
              if (offlineModeStore.getState().offlineMode) return;
              await repairIncompleteImages('startup');
            })(),
            'imageCache.startupRepair',
          );
        }
      } finally {
        // Always resolve — this is a best-effort init, same contract as
        // the previous direct-await implementation.
        resolve();
      }
    });
  });
}

// Auto-resume repair when the user toggles back online. An in-flight
// offline session can accumulate incomplete covers (downloads that were
// mid-variant when the app went offline); the moment connectivity is
// back we want to clear them without making the user open Settings.
offlineModeStore.subscribe((state, prev) => {
  if (state.offlineMode === prev.offlineMode) return;
  if (state.offlineMode) return;
  // Coming back online: drop every remote-failed marker so CachedImage
  // instances get a fresh shot at the server URL while the repair pass
  // works in the background.
  clearFailedRemoteIds('offline-online');
  if (imageCacheStore.getState().incompleteCount <= 0) return;
  // _layout.tsx restarts connectivity monitoring on offline→online; wait
  // for the first post-resume ping so the repair pass acts on confirmed
  // server state rather than the optimistic default.
  fireAndForget(
    (async () => {
      await awaitFirstPing();
      if (offlineModeStore.getState().offlineMode) return;
      await repairIncompleteImages('offline-resume');
    })(),
    'imageCache.offlineResume',
  );
});

// In-foreground transient blips: the connectivity layer flips
// `isServerReachable` without `offlineMode` ever changing (a brief server
// outage while the app stays foregrounded and online). When the server comes
// back, drop remote-failed markers so covers recover without a restart or an
// offline toggle — the user's "should recover when the server is available
// again" requirement.
connectivityStore.subscribe((state, prev) => {
  if (state.isServerReachable === prev.isServerReachable) return;
  if (state.isServerReachable) {
    if (offlineModeStore.getState().offlineMode) return;
    clearFailedRemoteIds('server-reachable');
  } else {
    // Server just dropped while (typically) still "online". Diagnostic only:
    // correlate the drop with cover-state changes in the same log stream.
    // No marker clearing — remote loads genuinely can't succeed now, and
    // re-enabling them would just re-fail. Cached covers are unaffected; they
    // resolve from the in-memory URI index, not the network.
    logImageCache('connectivity server-unreachable (was reachable)');
  }
});

// Entering offline mode: re-derive every remote-failed cover. The remote
// render branch is disabled while offline, so cleared markers can't trigger
// retries — covers fall back to their local file (or placeholder) cleanly,
// and the state is clean for the eventual offline→online recovery pass.
offlineModeStore.subscribe((state, prev) => {
  if (state.offlineMode && !prev.offlineMode) clearFailedRemoteIds('entering-offline');
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
export async function reconcileImageCache(source: string = 'auto'): Promise<void> {
  const dir = ensureCacheDir();
  if (!dir.exists) {
    logImageCache(`reconcile abort source=${source} reason=cache-dir-missing`);
    return;
  }

  let topLevelNames: string[];
  try {
    topLevelNames = await listDirectoryAsync(dir.uri);
  } catch (e) {
    logImageCache(`reconcile abort source=${source} reason=list-failed err=${errMessage(e)}`);
    return;
  }
  logImageCache(`reconcile start source=${source} top-level-dirs=${topLevelNames.length}`);

  const preAggregate = (await hydrateImageCacheAggregatesAsync());
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

  // Disk snapshot built during Pass 1 (dirName -> fileName -> size) so Pass 2
  // needs no further filesystem calls. Only dirs we successfully listed appear.
  const diskFiles = new Map<string, Map<string, number>>();

  // --- Pass 1: FS -> SQL (discover missing rows) ---
  for (const dirName of topLevelNames) {
    if (!dirName) continue;
    const subDir = new Directory(dir, dirName);
    // Post-Migration-25, every on-disk dir was written under the
    // sanitised entity-ID scheme, so the dir name IS the SQL coverArtId.
    const coverArtId = dirName;
    // One off-thread call returns every entry's name + size + type — no
    // per-file sync `.exists`/`.size` stat on the JS thread. A non-directory
    // or missing path yields []; the `subDir.exists` sync check is no longer
    // needed.
    let entries;
    try {
      entries = await listDirectoryWithSizesAsync(subDir.uri);
    } catch {
      continue;
    }
    const fileMap = new Map<string, number>();
    diskFiles.set(dirName, fileMap);
    for (const entry of entries) {
      const name = entry.name;
      if (!name || entry.isDirectory || name.endsWith('.tmp')) continue;
      const match = /^(50|150|300|600)\.(jpg|png|webp)$/.exec(name);
      if (!match) continue;
      const size = Number(match[1]);
      const ext = match[2];
      fileMap.set(name, entry.size);
      // A zero-byte finalised file is the signature of a crashed write
      // (e.g. ENOSPC between rename and content write, or a kill after
      // the move but before the bytes landed). RNImage renders nothing
      // for it, so delete it (off-thread) here — Pass 2 then drops any
      // stale DB row (the zero size is recorded in fileMap above).
      if (entry.size === 0) {
        void deleteFileAsync(new File(subDir, name).uri);
        continue;
      }
      seenOnDisk.add(diskKey(coverArtId, size));
      // eslint-disable-next-line no-await-in-loop
      if (await dbHasCachedImage(coverArtId, size)) continue;
      newRows.push({
        coverArtId,
        size,
        ext,
        bytes: entry.size,
        cachedAt: Date.now(),
      });
    }
  }

  // Safety gate against filesystem-unavailable false-positive inserts.
  // A large `newRows` alongside a non-trivial existing table means the
  // table and the FS disagree wildly — treat as suspicious and skip.
  const isMassInsert = newRows.length > 100 && preAggregate.fileCount > 50;
  if (!isMassInsert && newRows.length > 0) {
    await bulkInsertCachedImages(newRows);
    logImageCache(`reconcile pass1 inserted=${newRows.length}`);
  } else if (isMassInsert) {
    // eslint-disable-next-line no-console
    console.warn(
      `[reconcileImageCache] safety gate: ${newRows.length} would-be inserts ` +
        `vs ${preAggregate.fileCount} rows already present — skipping FS→SQL sync this run`,
    );
    logImageCache(
      `reconcile pass1 safety-gate would-insert=${newRows.length} pre-rows=${preAggregate.fileCount}`,
    );
  } else {
    logImageCache('reconcile pass1 no-new-rows');
  }

  // --- Pass 2: SQL -> FS (drop rows whose files are gone or empty) ---
  // Walk the DB's view; delete any row whose file wasn't observed on disk
  // or whose file exists but is zero bytes (crashed write). Guarded by
  // the same mass-missing heuristic — a temporarily-missing cache
  // directory shouldn't wipe the table.
  if (!isMassInsert) {
    const post = await listCachedImagesForBrowser('all');
    let droppedCount = 0;
    const staleDownloadedCovers = new Set<string>();
    for (const entry of post) {
      // Disk paths are sanitised; SQL rows keep the original coverArtId.
      const onDiskDirName = coverArtPathKey(entry.coverArtId);
      const fileMap = diskFiles.get(onDiskDirName);
      // If Pass 1 couldn't list this dir, we have no reliable view of it —
      // leave its rows alone rather than dropping on incomplete info.
      if (fileMap === undefined) continue;
      // Downloaded item's cover with a missing file (OS eviction, external
      // wipe): do NOT drop the row — re-cache it instead so the offline copy
      // is restored. Never leave a downloaded cover unrecoverable.
      if (isDownloadedCover(entry.coverArtId)) {
        for (const file of entry.files) {
          if (seenOnDisk.has(diskKey(entry.coverArtId, file.size))) continue;
          const onDiskSize = fileMap.get(`${file.size}.${file.ext}`);
          if (onDiskSize !== undefined && onDiskSize > 0) continue;
          staleDownloadedCovers.add(entry.coverArtId);
          break;
        }
        continue;
      }
      for (const file of entry.files) {
        if (seenOnDisk.has(diskKey(entry.coverArtId, file.size))) continue;
        const onDiskSize = fileMap.get(`${file.size}.${file.ext}`);
        // Present and non-zero — keep. (Rarely reached, since such a file
        // would already be in seenOnDisk; guards the sanitised-id keying.)
        if (onDiskSize !== undefined && onDiskSize > 0) continue;
        // File gone, or zero-byte (Pass 1 already deleted it): drop the row.
        // eslint-disable-next-line no-await-in-loop
        await deleteCachedImageVariant(entry.coverArtId, file.size);
        droppedCount++;
      }
    }
    // Re-cache downloaded covers whose files went missing (online-gated inside
    // ensureCached; no-op offline — the row is kept so it recovers on reconnect).
    for (const coverArtId of staleDownloadedCovers) {
      void ensureCached(coverArtId);
    }
    logImageCache(
      `reconcile pass2 dropped=${droppedCount} downloaded-recache=${staleDownloadedCovers.size}`,
    );
    // Always recalc at the end so callers don't have to. If neither pass
    // changed anything, this is a cheap aggregate query that re-syncs
    // the store with the unchanged DB — safe to over-call.
    imageCacheStore.getState().recalculateFromDb();

    // Timestamp the successful pass so the deferred-init throttle can
    // skip this work on the next launch. Only written when the safety
    // gate did NOT trip — otherwise we'd lock in a 7-day skip on a
    // transient filesystem issue.
    markReconcileRan(Date.now());
  } else {
    // Mass-insert safety gate fired — still recalc so the store mirrors
    // the (unchanged) DB and the spinner shows real numbers.
    imageCacheStore.getState().recalculateFromDb();
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
/**
 * Outcome counts from a repair pass. The Settings UI surfaces this as
 * a toast; tests assert on the individual counts.
 */
export interface RepairOutcome {
  /** Incomplete coverArtIds found when the pass started (post-sentinel-sweep). */
  queued: number;
  /** Covers whose 4 variants are all present on disk after the pass. */
  repaired: number;
  /** Covers still missing one or more variants (transient errors, etc.). */
  failed: number;
  /** Covers whose rows were deleted — sentinel sweep + 404 + 3×-failure. */
  removed: number;
}

export async function repairIncompleteImages(
  source: string = 'auto',
  opts: { removeUnrepairable?: boolean } = {},
): Promise<RepairOutcome> {
  logImageCache(`repair start source=${source} removeUnrepairable=${opts.removeUnrepairable === true}`);
  // 1. Sentinel sweep first — these should never have rows. Their count
  //    does NOT enter `queued` (which only covers the user-actionable
  //    incomplete set) but it does add to `removed` so the toast can
  //    report "2 sentinels removed".
  const sentinelCoversCleared = await sweepSentinelRows();
  logImageCache(`repair sentinel-sweep cleared=${sentinelCoversCleared}`);

  // 2. .tmp sweep — clean up abandoned half-writes from previous sessions
  //    or crashes before re-queuing anything.
  const dir = ensureCacheDir();
  let subDirNames: string[];
  try {
    subDirNames = await listDirectoryAsync(dir.uri);
  } catch {
    subDirNames = [];
  }
  let tmpDeleted = 0;
  for (const coverArtId of subDirNames) {
    if (!coverArtId) continue;
    const subDir = new Directory(dir, coverArtId);
    // No sync `subDir.exists` — listDirectoryAsync on a non-dir/missing path
    // yields [] (caught below).
    let fileNames: string[] = [];
    try {
      fileNames = await listDirectoryAsync(subDir.uri);
    } catch {
      continue;
    }
    for (const name of fileNames) {
      if (!name.endsWith('.tmp')) continue;
      // Delete off-thread (best-effort).
      void deleteFileAsync(new File(subDir, name).uri).catch(() => { /* best-effort */ });
      tmpDeleted++;
    }
  }
  logImageCache(`repair tmp-sweep deleted=${tmpDeleted} top-level-dirs=${subDirNames.length}`);

  // 3. Re-queue and AWAIT completion for each incomplete cover. We use
  //    cacheAllSizes() rather than poking downloadQueue + processQueue()
  //    directly: cacheAllSizes returns a per-coverArtId promise that
  //    resolves in processNext's finally block via resolveWaiters(), so
  //    Promise.all below gives us a real "repair-done" signal that the
  //    Settings overlay can hook into.
  const snapshot = (await findIncompleteCovers()).filter(
    (id) => !isSentinelCoverArtId(id),  // sentinels already handled in step 1
  );
  const queued = snapshot.length;
  logImageCache(`repair incomplete-snapshot queued=${queued} ids=[${snapshot.slice(0, 20).join(',')}${queued > 20 ? `,…+${queued - 20}` : ''}]`);

  if (queued === 0) {
    logImageCache(`repair done queued=0 sentinels-removed=${sentinelCoversCleared}`);
    imageCacheStore.getState().recalculateFromDb();
    return {
      queued: 0,
      repaired: 0,
      failed: 0,
      removed: sentinelCoversCleared,
    };
  }

  await Promise.all(
    snapshot.map((id) =>
      cacheAllSizes(id).catch(() => { /* per-cover failure reported below */ }),
    ),
  );

  // 4. Classify each original coverArtId by its post-pass state in SQL.
  const afterIncomplete = new Set(await findIncompleteCovers());
  let repaired = 0;
  let failed = 0;
  let removedDuringRepair = 0;
  for (const id of snapshot) {
    if (afterIncomplete.has(id)) {
      // Still incomplete after the re-download pass. When the caller asked to
      // remove the unrepairable (the Settings scan) AND the server is actually
      // reachable, the cover genuinely can't be completed (e.g. the source
      // serves but a variant won't decode) — purge it so it stops cluttering
      // the incomplete list. The connectivity gate means a transient offline /
      // server blip never nukes a cover: those fall through to `failed` and
      // retry on the next scan/launch.
      if (opts.removeUnrepairable && isPurgeAllowedNow()) {
        // eslint-disable-next-line no-await-in-loop
        await purgeCoverArtRows(id);
        removedDuringRepair++;
        logImageCache(`repair classify id=${id} unrepairable-purged`);
      } else {
        failed++;
        logImageCache(`repair classify id=${id} still-incomplete`);
      }
    } else {
      // Either all 4 variants present → repaired, or all rows gone →
      // purged by the 404/3×-failure circuit breaker.
      // eslint-disable-next-line no-await-in-loop
      const has600 = await dbHasCachedImage(id, SOURCE_SIZE);
      if (has600) {
        repaired++;
        logImageCache(`repair classify id=${id} repaired`);
      } else {
        removedDuringRepair++;
        logImageCache(`repair classify id=${id} purged`);
      }
    }
  }

  logImageCache(
    `repair done queued=${queued} repaired=${repaired} failed=${failed} removed=${sentinelCoversCleared + removedDuringRepair}`,
  );
  // Final recalc so the store mirrors the post-repair DB. Internal
  // cacheAllSizes paths recalc on each cover, but a final aggregate
  // snapshot guarantees the spinner-completion UI shows real numbers
  // rather than the last in-flight value.
  imageCacheStore.getState().recalculateFromDb();
  return {
    queued,
    repaired,
    failed,
    removed: sentinelCoversCleared + removedDuringRepair,
  };
}

/**
 * One-shot cache maintenance for the Settings "Scan" action (and the
 * scan-on-open). Heals FS↔SQL drift, then repairs any incomplete covers and
 * removes the ones that still can't be completed (server-reachable only — see
 * `repairIncompleteImages`). Returns the repair outcome so the UI can report it.
 */
export async function scanImageCache(source: string = 'settings'): Promise<RepairOutcome> {
  await reconcileImageCache(source);
  return repairIncompleteImages(source, { removeUnrepairable: true });
}

/* ------------------------------------------------------------------ */
/*  Cache mutation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Delete a single cached variant: file on disk, DB row, and in-memory
 * Map entry. Used by CachedImage when an `onError` indicates the local
 * file is broken and a re-download is needed. Scoped to one size —
 * sibling variants for the same coverArt may still be healthy.
 */
export async function deleteCachedVariant(coverArtId: string, size: number): Promise<void> {
  if (!coverArtId) return;
  const subDir = new Directory(ensureCacheDir(), coverArtPathKey(coverArtId));
  if (subDir.exists) {
    for (const ext of EXTENSIONS) {
      const file = new File(subDir, `${size}${ext}`);
      if (file.exists) {
        try { file.delete(); } catch { /* best-effort */ }
      }
    }
  }
  await deleteCachedImageVariant(coverArtId, size);
  imageCacheStore.getState().recalculateFromDb();
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
async function cacheAllSizes(coverArtId: string): Promise<void> {
  if (!coverArtId) return;
  // Sentinels render from bundled assets via CachedImage — never queue
  // them for download. Belt-and-braces guard; CachedImage already maps
  // their coverArtId to `undefined` before calling here.
  if (isSentinelCoverArtId(coverArtId)) return;

  // DB is the source of truth for "is this cover complete?" — never the
  // in-memory cache (which raced the boot index-build and skipped variants).
  const cachedSizes = await cachedSizesForCover(coverArtId);
  const allCached = IMAGE_SIZES.every((s) => cachedSizes.has(s));
  if (allCached) {
    logImageCache(`cacheAllSizes id=${coverArtId} all-cached noop`);
    return;
  }

  return new Promise<void>((resolve) => {
    const list = pendingResolvers.get(coverArtId) ?? [];
    list.push(resolve);
    pendingResolvers.set(coverArtId, list);

    if (downloading.has(coverArtId) || downloadQueue.includes(coverArtId)) {
      logImageCache(`cacheAllSizes id=${coverArtId} dedup waiters=${list.length}`);
      return;
    }

    logImageCache(`cacheAllSizes id=${coverArtId} enqueued queue=${downloadQueue.length + 1}`);
    downloadQueue.push(coverArtId);
    processQueue();
  });
}

/* ------------------------------------------------------------------ */
/*  Public component-facing API                                        */
/* ------------------------------------------------------------------ */

/**
 * Idempotent "ensure this cover is being cached." The component-facing
 * trigger — no debounce, no microtask, just a thin wrapper over
 * `cacheAllSizes` whose returned promise is discarded.
 *
 * Sentinel and offline guards live here so callers don't have to repeat
 * them. The service-side dedup in `cacheAllSizes` (pendingResolvers +
 * downloading set + downloadQueue includes-check) collapses bursts of
 * concurrent calls for the same id to a single download.
 */
export function ensureCached(coverArtId: string): Promise<void> {
  if (!coverArtId) return Promise.resolve();
  if (isSentinelCoverArtId(coverArtId)) return Promise.resolve();
  if (offlineModeStore.getState().offlineMode) return Promise.resolve();
  return cacheAllSizes(coverArtId);
}

/**
 * The component reports that the cached file at the requested size
 * failed to decode. The service deletes the variant (file + DB row +
 * URI map) and re-enqueues a download. The component will re-render on
 * the next `notifyImageCacheUpdate` when a fresh file lands.
 */
export async function reportBadCache(coverArtId: string, size: number): Promise<void> {
  if (!coverArtId) return;
  logImageCache(`reportBadCache id=${coverArtId} size=${size}`);
  await deleteCachedVariant(coverArtId, size);
  if (!offlineModeStore.getState().offlineMode) {
    void cacheAllSizes(coverArtId);
  }
}

/**
 * The component reports that the remote URL for this cover failed to
 * load. The service flags the id in `failedRemoteIds` so every other
 * CachedImage instance for the same id stops attempting the remote URL,
 * then fires the cache-update channel so subscribed components re-derive
 * their render state. The flag clears on the next successful
 * notifyImageCacheUpdate for the id (a fresh file landed) or on a
 * coarser reset (clearImageCache, offline → online).
 */
export async function reportBadRemote(coverArtId: string): Promise<void> {
  if (!coverArtId) return;
  // A present full-size source always wins over a remote error: every size
  // request resolves to the local file (directly or via source-fallback), so
  // never pin the placeholder — just nudge a re-render onto the LOCAL branch.
  // Guarded on the 600px source specifically so this can't loop (a smaller-
  // only cache wouldn't satisfy a 600px request and would re-fail).
  if ((await cachedSizesForCover(coverArtId)).has(SOURCE_SIZE)) {
    notifyImageCacheUpdate(coverArtId);
    return;
  }
  if (failedRemoteIds.has(coverArtId)) return;
  logImageCache(`reportBadRemote id=${coverArtId}`);
  failedRemoteIds.add(coverArtId);
  // Notify subscribers directly — bypass `notifyImageCacheUpdate` so the
  // helper's "delete from failedRemoteIds" branch doesn't undo what we
  // just did.
  const listeners = cacheUpdateListeners.get(coverArtId);
  if (!listeners) return;
  for (const listener of listeners) {
    try { listener(); } catch { /* swallow */ }
  }
}

/**
 * Sync query — is this cover's remote URL currently in the failed set?
 * Component reads this on every render to decide whether to try the
 * server URL.
 */
export function isRemoteFailed(coverArtId: string): boolean {
  if (!coverArtId) return false;
  return failedRemoteIds.has(coverArtId);
}

/**
 * Build the server URL for a cover at a given size. Thin re-export of
 * `subsonicService.getCoverArtUrl` so consumers that render images can
 * import everything they need from one module (the cache service is the
 * single source of truth for "what URI should I show?"). Returns null
 * when no server URL can be constructed (no coverArtId / no auth).
 */
export function buildRemoteImageUrl(
  coverArtId: string,
  size: number,
): string | null {
  return getCoverArtUrl(coverArtId, size);
}

/**
 * Resolve the URI to DISPLAY for a cover — the single decision shared by
 * `CachedImage` and headless consumers (the CarPlay / Android-Auto browse
 * service). Prefers the on-disk cache (`file://`), then the server URL, gated on
 * offline + the remote-failed set — exactly how `CachedImage` picks its render
 * URI. Returns `{ isRemote }` so a component can drive its error reporting; a
 * service just reads `.uri`.
 *
 * `skipCache` bypasses the local cache (used by `CachedImage` after a cached
 * file has errored, to fall straight to the server URL). Returns `null` when
 * nothing is displayable (no id, or offline/failed with no cached file) — the
 * caller renders its placeholder / omits the artwork.
 */
export async function resolveDisplayImage(
  coverArtId: string | undefined,
  size: number,
  opts: { offline: boolean; skipCache?: boolean },
): Promise<{ uri: string; isRemote: boolean } | null> {
  if (!coverArtId) return null;
  if (!opts.skipCache) {
    const cached = await resolveCachedImageUri(coverArtId, size, { sourceFallback: true });
    if (cached) return { uri: cached, isRemote: false };
  }
  if (opts.offline || isRemoteFailed(coverArtId)) return null;
  const remote = buildRemoteImageUrl(coverArtId, size);
  return remote ? { uri: remote, isRemote: true } : null;
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
 * Per-id retry schedulers for the in-memory download path. A failed
 * download leaves a setTimeout in this map; on fire the timer re-calls
 * cacheAllSizes (idempotent), and clears the entry on success. Bounded
 * by RETRY_BACKOFFS_MS so a permanently-broken id stops attempting
 * after a few retries — long-lived recovery is via AppState 'active'
 * and offline→online repair passes which already exist.
 */
const pendingRetries = new Map<string, ReturnType<typeof setTimeout>>();
const retryAttempts = new Map<string, number>();
const RETRY_BACKOFFS_MS = [5_000, 15_000, 60_000] as const;
// Default off under jest so retry timers don't bleed across tests. The
// runtime flips this on at app boot (see initImageCache).
let retriesEnabled = typeof process === 'undefined'
  || (process.env.JEST_WORKER_ID === undefined && process.env.NODE_ENV !== 'test');

function scheduleRetry(coverArtId: string): void {
  if (isSentinelCoverArtId(coverArtId)) return;
  if (offlineModeStore.getState().offlineMode) return;
  // Skip timed retries under jest — the timers persist across tests and
  // mutate queue state mid-assertion.
  if (!retriesEnabled) return;
  const attempt = retryAttempts.get(coverArtId) ?? 0;
  if (attempt >= RETRY_BACKOFFS_MS.length) {
    logImageCache(`retry-give-up id=${coverArtId} attempts=${attempt}`);
    return;
  }
  // Already a retry pending — let it fire.
  if (pendingRetries.has(coverArtId)) return;
  const delay = RETRY_BACKOFFS_MS[attempt];
  retryAttempts.set(coverArtId, attempt + 1);
  logImageCache(`retry-scheduled id=${coverArtId} attempt=${attempt + 1} delay-ms=${delay}`);
  const timer = setTimeout(async () => {
    pendingRetries.delete(coverArtId);
    if (offlineModeStore.getState().offlineMode) return;
    // Quick exit if the cover landed via some other path in the meantime.
    const cachedSizes = await cachedSizesForCover(coverArtId);
    if (IMAGE_SIZES.every((s) => cachedSizes.has(s))) {
      retryAttempts.delete(coverArtId);
      return;
    }
    void cacheAllSizes(coverArtId);
  }, delay);
  pendingRetries.set(coverArtId, timer);
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
    let threw = false;
    try {
      await downloadAndCacheImage(coverArtId);
    } catch {
      threw = true;
      /* individual image failure -- continue with the rest */
    } finally {
      downloading.delete(coverArtId);
      // Re-derive the aggregate totals from SQL. Debounced: during a burst of
      // completing downloads this coalesces many async scans into a handful
      // (the cycle force-flushes at the end), so the JS thread never queues a
      // scan per cover. The read itself is async regardless.
      scheduleAggregateRecalc();
      resolveWaiters(coverArtId);
      // Schedule a timed retry when the source download threw OR the
      // cover is still incomplete after a non-throwing run (the resize
      // pipeline took partial-failure variantFailureCount steps that
      // didn't surface as exceptions). On success we clear the counter
      // so the next fresh download starts from attempt 0. DB-authoritative.
      const cachedSizes = await cachedSizesForCover(coverArtId);
      const stillMissing = !IMAGE_SIZES.every((s) => cachedSizes.has(s));
      if (threw || stillMissing) {
        scheduleRetry(coverArtId);
      } else {
        retryAttempts.delete(coverArtId);
      }
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
  // Defensive — sentinels should never reach the pipeline. Callers
  // already filter via isSentinelCoverArtId() / CachedImage's mapping,
  // but an external `repairIncompleteImages` could still hand us
  // a stale row that slipped through.
  if (isSentinelCoverArtId(coverArtId)) {
    logImageCache(`downloadAndCacheImage id=${coverArtId} sentinel-skip`);
    return;
  }

  const subDir = new Directory(ensureCacheDir(), coverArtPathKey(coverArtId));
  if (!subDir.exists) subDir.create();

  let source600Uri = await resolveCachedImageUri(coverArtId, SOURCE_SIZE);
  const sourceWasCached = source600Uri != null;
  if (!source600Uri) {
    source600Uri = await downloadSourceImage(coverArtId, subDir);
    if (!source600Uri) {
      logImageCache(`downloadAndCacheImage id=${coverArtId} source-download-null abort`);
      return;
    }
  } else {
    logImageCache(`downloadAndCacheImage id=${coverArtId} source-already-cached uri=${source600Uri}`);
  }

  // DB-authoritative: which variants are actually missing (not the in-memory
  // cache, which raced the boot index-build and skipped 300 here).
  const cachedSizes = await cachedSizesForCover(coverArtId);
  const needed = RESIZE_SIZES.filter((s) => !cachedSizes.has(s));
  if (needed.length === 0) {
    logImageCache(
      `downloadAndCacheImage id=${coverArtId} all-variants-present source-cached=${sourceWasCached}`,
    );
    return;
  }
  logImageCache(
    `downloadAndCacheImage id=${coverArtId} resize-needed=[${needed.join(',')}] source-cached=${sourceWasCached}`,
  );
  for (const size of needed) {
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
  if (!url) {
    // Null URL means offline, missing auth, or a sentinel slipped past
    // the upstream guards. Treated as transient — the row is preserved
    // for a later attempt once we're back online / authenticated. Log
    // WHICH of those conditions tripped so future "source-download-null"
    // patterns in user reports are actionable.
    const offline = offlineModeStore.getState().offlineMode;
    const auth = authStore.getState();
    const authState = !auth.isLoggedIn
      ? 'not-logged-in'
      : !auth.serverUrl
        ? 'no-server-url'
        : !auth.username
          ? 'no-username'
          : 'ok';
    logImageCache(
      `download id=${coverArtId} url=null offline=${offline} auth=${authState} sentinel=${isSentinelCoverArtId(coverArtId)}`,
    );
    return null;
  }

  // Transport phase: any throw here is a network/DNS/TLS failure with no
  // Response — server-reachability is unknown, so the row must be
  // preserved. Connectivity service surfaces the outage separately.
  //
  // Sanity timeout: the download-enqueue flows now AWAIT the cover before the
  // audio binaries, so a hung cover fetch (server accepts the socket but never
  // sends) must not block a music download or wedge a queue slot. Generous
  // (30s) so a slow-but-working cover on a poor connection still completes; the
  // AbortSignal cancels the in-flight request on timeout.
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    logImageCache(`download id=${coverArtId} start url=${url}`);
    const fetched = await withTimeout(
      (signal) => fetch(url, { signal }),
      SOURCE_FETCH_TIMEOUT_MS,
    );
    if (fetched === 'timeout') {
      // Reachability unknown (same as a transport error) — preserve the row.
      logImageCache(`download id=${coverArtId} fetch-timeout preserved`);
      return null;
    }
    response = fetched;
  } catch (e) {
    logImageCache(
      `download id=${coverArtId} transport-error preserved err=${errMessage(e)}`,
    );
    return null;
  }

  // Server responded. From here on, any failure is server-side or local-
  // pipeline — both purge under the connectivity gate.
  if (!response.ok) {
    if (response.status === 404) {
      // Definitive server signal that this cover doesn't exist (album
      // removed, re-indexed with a new ID, etc.). Always purge — 404 is
      // unambiguous regardless of broader connectivity state.
      // eslint-disable-next-line no-console
      console.warn(
        `[imageCacheService] 404 for coverArt=${coverArtId} — purging cache rows`,
      );
      logImageCache(`download id=${coverArtId} 404 purge`);
      await purgeCoverArtRows(coverArtId);
      return null;
    }
    if (isPurgeAllowedNow()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[imageCacheService] HTTP ${response.status} for coverArt=${coverArtId} — purging cache rows`,
      );
      logImageCache(
        `download id=${coverArtId} status=${response.status} purge connectivity=ok`,
      );
      await purgeCoverArtRows(coverArtId);
    } else {
      logImageCache(
        `download id=${coverArtId} status=${response.status} preserved connectivity=down`,
      );
    }
    return null;
  }

  // I/O phase: bytes arrived from the server; persist them locally. A
  // throw here means disk full / permission denied / write race. The
  // server is responsive, so under the connectivity gate we purge to
  // keep the row from churning forever on a poisoned local state.
  const contentType = response.headers.get('content-type') ?? '';
  const ext = MIME_TO_EXT[contentType.split(';')[0].trim()] ?? '.jpg';
  const fileName = `${SOURCE_SIZE}${ext}`;
  const tmpName = `${fileName}.tmp`;

  try {
    // Bound the BODY read too: `withTimeout` above only covered the header
    // fetch, so a server that sends headers then stalls the body would hang the
    // (now awaited) download flow indefinitely. Same budget; a stall preserves
    // the row (network-ambiguous, like the transport timeout) rather than purge.
    // NB: `arrayBuffer()` can't be aborted, so on timeout the read is left
    // orphaned (harmless — it settles or GCs); the race just unblocks the caller.
    const body = await withTimeout(() => response.arrayBuffer(), SOURCE_FETCH_TIMEOUT_MS);
    if (body === 'timeout') {
      logImageCache(`download id=${coverArtId} body-timeout preserved`);
      return null;
    }
    const bytes = new Uint8Array(body);

    // HTTP 200 but an XML/JSON error envelope instead of image bytes (some
    // servers return `<subsonic-response>` for a missing cover). Never cache
    // text as an image file — it fails to decode on every render. Flag the cover
    // as remote-bad so CachedImage shows the placeholder instead of re-fetching
    // the same URL, and purge any prior poisoned row (guarded for downloaded items).
    if (isNonImageErrorBody(bytes)) {
      logImageCache(
        `download id=${coverArtId} non-image body bytes=${bytes.length} ct=${contentType}`,
      );
      await reportBadRemote(coverArtId);
      if (isPurgeAllowedNow()) await purgeCoverArtRows(coverArtId);
      return null;
    }

    const tmpFile = new File(subDir, tmpName);
    tmpFile.write(bytes);

    const dest = new File(subDir, fileName);
    if (await existsAsync(dest.uri)) {
      try { await deleteFileAsync(dest.uri); } catch { /* best-effort */ }
    }
    await tmpFile.move(dest);

    // DB row is written strictly after the successful rename. Any failure
    // before this point leaves the disk clean of the finalised file and
    // the DB row absent — the two stay consistent.
    await upsertCachedImage({
      coverArtId,
      size: SOURCE_SIZE,
      ext: ext.slice(1), // strip leading '.'
      bytes: bytes.length,
      cachedAt: Date.now(),
    });

    logImageCache(`download id=${coverArtId} ok bytes=${bytes.length} ext=${ext.slice(1)}`);
    notifyImageCacheUpdate(coverArtId);
    return dest.uri;
  } catch (e) {
    const tmp = new File(subDir, tmpName);
    if (tmp.exists) {
      try { tmp.delete(); } catch { /* best-effort */ }
    }
    if (isPurgeAllowedNow()) {
      logImageCache(
        `download id=${coverArtId} io-error purge connectivity=ok err=${errMessage(e)}`,
      );
      await purgeCoverArtRows(coverArtId);
    } else {
      logImageCache(
        `download id=${coverArtId} io-error preserved connectivity=down err=${errMessage(e)}`,
      );
    }
    return null;
  }
}

/**
 * Per-session resize-failure counter. Variant generation runs against
 * bytes already on disk — the connectivity gate doesn't apply because
 * no network is involved. A small in-session retry budget absorbs
 * transient memory pressure during decode (older Android, low-RAM
 * devices). On the threshold strike, the row is purged: source bytes
 * are most likely corrupt or in an unsupported format, and re-running
 * the same decode would just re-fail. Counter resets on success or
 * after a purge so a fresh download can be evaluated cleanly.
 */
const variantFailureCount = new Map<string, number>();
const MAX_VARIANT_FAILURES = 3;

/**
 * Generate a single resized variant from the 600px source using the
 * local `expo-image-resize` native module. Writes to a .tmp file first,
 * then renames. The module uses `BitmapFactory.decodeFile` (Android) /
 * `UIImage(contentsOfFile:)` (iOS) — no Glide, no coroutine callback
 * surface, so the `expo-image-manipulator` double-resume crash that
 * surfaces on Android 16 is structurally impossible here.
 */
async function generateResizedVariant(
  sourceUri: string,
  coverArtId: string,
  size: number,
  subDir: Directory,
): Promise<void> {
  const fileName = `${size}.jpg`;
  const tmpName = `${fileName}.tmp`;
  const tmpFile = new File(subDir, tmpName);
  const dest = new File(subDir, fileName);

  try {
    await resizeImageToFileAsync(sourceUri, tmpFile.uri, size, RESIZE_COMPRESS);

    // Capture the size off tmpFile BEFORE the move. Reading dest.size
    // after move worked OK with the sync moveSync, but capturing here
    // is robust to either move/moveSync ordering and survives a
    // refactor that swaps the sync variant for the async one (the bug
    // that produced 0-byte upserts pre-fix).
    const fileBytes = tmpFile.size;

    if (await existsAsync(dest.uri)) {
      try { await deleteFileAsync(dest.uri); } catch { /* best-effort */ }
    }
    await tmpFile.move(dest);

    // DB row after rename — mirrors the source-download pattern. A crash
    // between two variants leaves the DB missing the unfinished ones so
    // `findIncompleteCovers()` surfaces them for re-generation.
    await upsertCachedImage({
      coverArtId,
      size,
      ext: 'jpg', // every derived variant is JPEG
      bytes: fileBytes,
      cachedAt: Date.now(),
    });

    // Success — reset any accumulated failures for this cover.
    variantFailureCount.delete(coverArtId);
    logImageCache(`resize id=${coverArtId} size=${size} ok bytes=${fileBytes}`);
    notifyImageCacheUpdate(coverArtId);
  } catch (e) {
    const next = (variantFailureCount.get(coverArtId) ?? 0) + 1;
    variantFailureCount.set(coverArtId, next);
    // Phase 1 diagnostics — capture source-side context on every resize
    // failure so we can pin down the actual offending format from user
    // logs without another instrumentation round-trip. Gated by the
    // image-cache logging flag (see imageCacheLogger). The native
    // modules emit their own decode-path information via the thrown
    // error message when their low-level fallbacks kick in.
    let sourceBytes = -1;
    let sourceExt = 'unknown';
    try {
      const sourceFile = new File(sourceUri.replace(/^file:\/\//, ''));
      if (sourceFile.exists) {
        sourceBytes = sourceFile.size ?? -1;
      }
      // Extension is what the cache wrote based on Content-Type at
      // download time — telling us "claimed format" without needing
      // to do a sync byte read on a file we can't read synchronously
      // in the new expo-file-system API.
      const match = sourceUri.match(/\.([a-z0-9]{2,5})$/i);
      if (match) sourceExt = match[1].toLowerCase();
    } catch {
      /* best-effort — diagnostic only */
    }
    logImageCache(
      `resize id=${coverArtId} size=${size} fail count=${next}/${MAX_VARIANT_FAILURES} `
      + `srcBytes=${sourceBytes} srcExt=${sourceExt} err=${errMessage(e)}`,
    );
    if (tmpFile.exists) {
      try { tmpFile.delete(); } catch { /* best-effort */ }
    }
    if (next >= MAX_VARIANT_FAILURES) {
      // eslint-disable-next-line no-console
      console.warn(
        `[imageCacheService] ${next} consecutive resize failures for coverArt=${coverArtId} — purging cache rows`,
      );
      logImageCache(`resize id=${coverArtId} threshold-purge`);
      await purgeCoverArtRows(coverArtId);
      // No further server-side recovery is attempted. The Subsonic spec
      // for `getCoverArt` accepts only `id` and `size`; the previously-
      // used `format=jpg` query was a no-op (the server returned the
      // same un-decodable bytes). User-visible recovery is handled
      // upstream in CachedImage's source-size fallback, which renders
      // the (decodable) 600 source in the smaller slot when smaller
      // variants are unavailable.
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
  const agg = (await hydrateImageCacheAggregatesAsync());
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
export async function listCachedImages(
  filter: CacheBrowserFilter = 'all',
): Promise<CachedImageEntry[]> {
  // URIs are deterministic from (dir.uri, coverArtId, size, ext), so build
  // them by string concat. Constructing `new File()` / `new Directory()` for
  // every row crosses the native bridge and at 21k+ rows becomes the dominant
  // cost of opening the browser.
  const dirUri = ensureCacheDir().uri;
  const dbEntries: DbCachedImageEntry[] = await listCachedImagesForBrowser(filter);
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

  const subDir = new Directory(ensureCacheDir(), coverArtPathKey(coverArtId));
  const dirExists = subDir.exists;
  logImageCache(`deleteCachedImage id=${coverArtId} dirExists=${dirExists}`);
  if (!dirExists) {
    // Clean up any orphan DB rows for this cover (e.g. directory was
    // already removed externally), then stop.
    const rows = await deleteCachedImagesForCoverArt(coverArtId);
    logImageCache(`deleteCachedImage id=${coverArtId} dir-missing rows-removed=${rows.count}`);
    imageCacheStore.getState().recalculateFromDb();
    return;
  }

  // Delete the on-disk directory first, then the DB rows. Rebuild the
  // store aggregates from SQL at the end.
  let dirDeleted = true;
  try {
    subDir.delete();
  } catch (e) {
    dirDeleted = false;
    logImageCache(
      `deleteCachedImage id=${coverArtId} dir-delete-failed err=${errMessage(e)}`,
    );
  }

  const rows = await deleteCachedImagesForCoverArt(coverArtId);
  logImageCache(
    `deleteCachedImage id=${coverArtId} dir-deleted=${dirDeleted} rows-removed=${rows.count}`,
  );
  imageCacheStore.getState().recalculateFromDb();
}

/**
 * Re-download all size variants for a single coverArtId.
 * Deletes existing files first, then downloads directly — bypasses the
 * global queue so the user-initiated refresh isn't blocked by other
 * in-flight downloads.
 */
export async function refreshCoverArt(
  coverArtId: string,
  source: string = 'auto',
): Promise<void> {
  logImageCache(`refreshCoverArt start source=${source} id=${coverArtId}`);
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
    scheduleAggregateRecalc();
    resolveWaiters(coverArtId);
    const present = Array.from(await cachedSizesForCover(coverArtId)).sort((a, b) => a - b);
    logImageCache(
      `refreshCoverArt end id=${coverArtId} sizes-present=[${present.join(',')}]`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Cache clearing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Clear every piece of image-cache state: in-memory queues, on-disk dir,
 * SQL rows, store aggregates. Order matters — drop in-memory pending
 * work BEFORE deleting the on-disk dir so a worker that wakes mid-delete
 * can't write a tmp file into a subdir we just removed.
 *
 * Pass `{ reinit: true }` when the cache will continue to be used (user-
 * triggered "Clear Cache"); `{ reinit: false }` when the session is over
 * (logout) and the next `initImageCache` will come from the auth flow.
 */
async function teardownImageCacheState({ reinit }: { reinit: boolean }): Promise<void> {
  downloadQueue.length = 0;
  downloading.clear();
  failedRemoteIds.clear();
  for (const timer of pendingRetries.values()) clearTimeout(timer);
  pendingRetries.clear();
  retryAttempts.clear();
  resolveAllWaiters();
  // Wipe the on-disk tree via the DETERMINISTIC path, NOT the in-memory
  // `cacheDir` handle. Logout (resetAllStores) calls `teardownImageCache()`
  // — which nulls `cacheDir` — BEFORE this runs, so gating the file wipe on
  // `cacheDir` would skip it while `clearAllCachedImages()` below still drops
  // every SQL row, orphaning thousands of files with no rows (a files-without-
  // rows drift the reconcile safety gate then refuses to heal). The cache path
  // is always `{document}/image-cache`, so delete it regardless of the handle.
  cacheDir = null;
  try {
    // Recursive on-disk wipe off the JS thread — the image cache is thousands
    // of small variant files; a sync Directory.delete() would freeze the UI
    // (this runs on logout + clear-cache). Awaited so the `reinit` recreate
    // below only runs after the delete completes (no recreate-vs-delete race).
    const dirUri = new Directory(Paths.document, 'image-cache').uri;
    await deleteDirectoryAsync(dirUri);
  } catch { /* best-effort */ }
  // Await the SQL truncate so a caller that repopulates right after (e.g. the
  // re-key migrations' re-warm cycle) starts from a committed-empty table.
  await clearAllCachedImages();
  imageCacheStore.getState().reset();
  if (reinit) initImageCache();
}

/**
 * Delete all cached images and (by default) recreate the cache directory.
 * Returns the number of bytes freed — derived from the DB aggregate (cheap
 * single SELECT) rather than a recursive directory walk.
 *
 * Pass `{ reinit: false }` from the logout flow — the session is over and
 * the next `initImageCache` will come from the auth flow on re-login;
 * re-arming the AppState listener here would fire repair passes against
 * an unauthenticated server.
 */
export async function clearImageCache(
  opts: { reinit?: boolean } = {},
): Promise<number> {
  const reinit = opts.reinit ?? true;
  const freedBytes = (await hydrateImageCacheAggregatesAsync()).totalBytes;
  await teardownImageCacheState({ reinit });
  logImageCache(`clearImageCache reinit=${reinit} freed-bytes=${freedBytes}`);
  return freedBytes;
}

/**
 * Proactively cache cover art for a list of entities (songs, albums,
 * artists, playlists). Keys off the entity's `coverArt` value via
 * `resolveEntityCoverArt` (mode-aware for songs) so the warmed file matches
 * what the render side reads. Deduplicates by resolved value and skips entries
 * already in cache. (#202)
 */
export function prefetchCoverArt(
  entities: Array<AlbumID3 | ArtistID3 | Playlist | Child>,
): void {
  const seen = new Set<string>();
  for (const entity of entities) {
    const id = resolveEntityCoverArt(entity);
    if (id && !seen.has(id)) {
      seen.add(id);
      // cacheAllSizes does its own DB-authoritative all-cached check and
      // no-ops when complete, so no pre-check needed.
      cacheAllSizes(id).catch(() => { /* non-critical */ });
    }
  }
}

/**
 * Snapshot every cached item row's `(type, coverArtId)` for the
 * persistent image-download queue's `refresh-downloads` scope. Broken
 * out so it can be mocked in unit tests without dragging in the entire
 * `musicCacheTables` import surface.
 *
 * Keys off each entity's stored `coverArt` value — the cached item's
 * `coverArtId` field for albums/playlists, and the mode-aware song cover value
 * for songs (see src/utils/coverArtId.ts) — NOT the entity ID. Same scheme that
 * every consumer (CachedImage, childToTrack, etc.) uses, so the recached files
 * match what callers will look up. (#202)
 */
function hydrateCachedItemsForRecache(): {
  items: Array<{ type: string; coverArtId: string | null }>;
  /**
   * Per-song cover-art values from `cached_songs`, resolved mode-aware
   * (album mode: parent album's coverArt so tracks share one file; per-track:
   * the song's own coverArt).
   */
  songCoverArtIds: string[];
} {
  // Lazy-required: keeps the recache worker testable without forcing
  // every test that touches imageCacheService to mock musicCacheTables.
  const { hydrateCachedItems, hydrateCachedSongs } = require('../store/persistence/musicCacheTables') as {
    hydrateCachedItems: () => Record<string, { itemId: string; type: string; coverArtId?: string }>;
    hydrateCachedSongs: () => Record<string, { id: string; albumId?: string | null; coverArt?: string | null }>;
  };
  const items = Object.values(hydrateCachedItems()).map((r) => ({
    type: r.type,
    coverArtId: r.coverArtId ?? null,
  }));
  const songCoverArtIds: string[] = [];
  const seen = new Set<string>();
  for (const s of Object.values(hydrateCachedSongs())) {
    const id = resolveSongCoverArt(s);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    songCoverArtIds.push(id);
  }
  return { items, songCoverArtIds };
}

/* ------------------------------------------------------------------ */
/*  Persistent image-download queue worker                              */
/*  See plans/2026-05-23-image-cache-queue-rework.md.                   */
/* ------------------------------------------------------------------ */

/**
 * Scalar cycle metadata persisted via kvStorage. The queue rows live in
 * SQL; only the cycle's denominator (`total`), identity (`cycleId`), and
 * pause flag survive separately so the UI can show "X / Y" and so the
 * worker can short-circuit when the user has paused. Phase 3 wraps these
 * accessors in `imageDownloadQueueStore` for store-friendly consumption.
 */
const IMAGE_QUEUE_META_KEY = 'substreamer-image-queue-meta';

export type ImageQueuePhase = 'active' | 'error' | 'dismissed';

interface ImageQueueMeta {
  cycleId: string | null;
  cycleScope: ImageDownloadQueueScope | null;
  cycleTotal: number;
  isPaused: boolean;
  /**
   * 'active' while the cycle is draining; 'error' once it finishes with one or
   * more failed rows (drives a dismissible error banner); 'dismissed' after the
   * user dismisses that banner. cycleId + the error rows are retained in 'error'
   * and 'dismissed' so the cycle-scoped retry and next-boot recovery still work.
   */
  phase: ImageQueuePhase;
}

function readImageQueueMeta(): ImageQueueMeta {
  try {
    // kvStorage.getItem is sync in our SQLite-backed impl, but the
    // Zustand StateStorage interface declares it as `string | null |
    // Promise<...>`. Cast to the sync variant we actually have.
    const raw = kvStorage.getItem(IMAGE_QUEUE_META_KEY) as string | null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ImageQueueMeta>;
      return {
        cycleId: typeof parsed.cycleId === 'string' ? parsed.cycleId : null,
        cycleScope:
          parsed.cycleScope === 'refresh-downloads' || parsed.cycleScope === 'refresh-all'
            ? parsed.cycleScope
            : null,
        cycleTotal: typeof parsed.cycleTotal === 'number' ? parsed.cycleTotal : 0,
        isPaused: parsed.isPaused === true,
        phase:
          parsed.phase === 'error' || parsed.phase === 'dismissed'
            ? parsed.phase
            : 'active',
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return { cycleId: null, cycleScope: null, cycleTotal: 0, isPaused: false, phase: 'active' };
}

function writeImageQueueMeta(next: ImageQueueMeta): void {
  try {
    kvStorage.setItem(IMAGE_QUEUE_META_KEY, JSON.stringify(next));
  } catch {
    /* swallow — meta loss only affects UI display, not correctness */
  }
}

export interface ImageQueueState {
  cycleId: string | null;
  cycleScope: ImageDownloadQueueScope | null;
  cycleTotal: number;
  processed: number;
  failed: number;
  isPaused: boolean;
  phase: ImageQueuePhase;
}

/**
 * One-shot snapshot of every consumer-relevant queue field. Replaces the
 * three-getter dance (isImageQueuePaused + getImageQueueCycle +
 * getImageQueueCycleProgress) so the store only takes one read per refresh
 * and there's a single place to add new fields. The "processed" derivation
 * is: anything not 'queued' OR 'downloading' counts as attempted; errored
 * rows are attempted-and-failed, not still-in-queue.
 */
export async function getImageQueueState(): Promise<ImageQueueState> {
  const meta = readImageQueueMeta();
  if (meta.cycleId === null || meta.cycleTotal === 0) {
    return {
      cycleId: meta.cycleId,
      cycleScope: meta.cycleScope,
      cycleTotal: meta.cycleTotal,
      processed: 0,
      failed: 0,
      isPaused: meta.isPaused,
      phase: meta.phase,
    };
  }
  const remainingInQueue = await countImageQueueRowsByCycle(meta.cycleId);
  const errored = await countImageQueueRowsByStatus('error');
  const queuedOrDownloading = remainingInQueue - errored;
  const processed = Math.max(0, meta.cycleTotal - Math.max(0, queuedOrDownloading));
  return {
    cycleId: meta.cycleId,
    cycleScope: meta.cycleScope,
    cycleTotal: meta.cycleTotal,
    processed,
    failed: errored,
    isPaused: meta.isPaused,
    phase: meta.phase,
  };
}

/* ----- Queue-change pub/sub for store consumers ----- */

/**
 * Listener pattern that lets `imageDownloadQueueStore` react to queue
 * mutations without depending on the store directly (which would create
 * a circular import — the store imports getter helpers from this file).
 *
 * Mutating queue ops call `notifyImageQueueChange()`. Subscribers do
 * their own derived-state refresh; we don't pass payloads.
 */
type ImageQueueChangeListener = () => void;
const imageQueueListeners = new Set<ImageQueueChangeListener>();

export function subscribeImageQueueChanges(
  fn: ImageQueueChangeListener,
): () => void {
  imageQueueListeners.add(fn);
  return () => { imageQueueListeners.delete(fn); };
}

function notifyImageQueueChange(): void {
  for (const fn of imageQueueListeners) {
    try { fn(); } catch { /* listener errors must not break the worker */ }
  }
}

/* ----- Worker ----- */

/**
 * The currently-running worker promise, or null if no worker is active.
 * Held so re-entrant callers (and test code) can `await processImageQueue()`
 * and reliably wait for the drain to finish — matches the test-ergonomic
 * shape we want without breaking the fire-and-forget call sites.
 */
let imageWorkerPromise: Promise<void> | null = null;

/**
 * Debounced aggregate recalc — replaces the per-image `recalculateFromDb()`
 * call that historically caused the Settings UI flicker. A 750ms window
 * with force-flush at cycle end means a 200-image cycle goes from 200
 * SQL aggregate queries to a handful.
 */
let recalcTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAggregateRecalc(): void {
  if (recalcTimer !== null) clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => {
    recalcTimer = null;
    imageCacheStore.getState().recalculateFromDb();
  }, 750);
}
function flushAggregateRecalc(): void {
  if (recalcTimer !== null) {
    clearTimeout(recalcTimer);
    recalcTimer = null;
  }
  imageCacheStore.getState().recalculateFromDb();
}

function connectivityAllowsImageWork(): boolean {
  if (offlineModeStore.getState().offlineMode) return false;
  const conn = connectivityStore.getState();
  if (!conn.isServerReachable || !conn.hasConnection) return false;
  return true;
}

/**
 * Test seam — the queue worker calls this rather than `downloadAndCacheImage`
 * directly so tests can swap it for a deterministic stub. Production code
 * uses the default (real `downloadAndCacheImage`).
 */
let imageDownloader: (coverArtId: string) => Promise<void> = (id) => downloadAndCacheImage(id);

/** Test-only: replace the downloader. Pass undefined to restore default. */
export function __setImageDownloaderForTest(
  fn: ((coverArtId: string) => Promise<void>) | undefined,
): void {
  imageDownloader = fn ?? ((id) => downloadAndCacheImage(id));
}

/**
 * Test-only: clear in-memory state that survives across tests (retry
 * timers, retry attempt counters, remote-failure flags). Avoids the
 * "previous test's failed download fires a setTimeout that mutates the
 * next test" cross-contamination problem.
 */
export function __resetRetryStateForTest(): void {
  for (const timer of pendingRetries.values()) clearTimeout(timer);
  pendingRetries.clear();
  retryAttempts.clear();
  failedRemoteIds.clear();
}

async function tryDownloadCover(coverArtId: string): Promise<boolean> {
  try {
    await imageDownloader(coverArtId);
    return true;
  } catch {
    return false;
  }
}

async function processOneImage(row: ImageDownloadQueueRow): Promise<void> {
  await markImageDownloading(row.coverArtId);
  // Both scopes are 'refresh-*' so they delete-then-redownload (the
  // existing refresh semantic). No skip-if-cached pre-check here —
  // refresh-all WANTS to replace; refresh-downloads WANTS to pick up
  // the post-Migration-22 canonical IDs.
  try {
    await deleteCachedImage(row.coverArtId);
  } catch {
    /* per-cover delete failure isn't fatal; download will overwrite */
  }

  // Retry-once-inline, matching musicCacheService.ts:1104-1105
  let ok = await tryDownloadCover(row.coverArtId);
  if (!ok) ok = await tryDownloadCover(row.coverArtId);

  if (ok) {
    await removeImageFromQueue(row.coverArtId);
    scheduleAggregateRecalc();
    await maybeCompleteCycle();
  } else {
    await markImageError(row.coverArtId, 'Failed after retry');
    logImageCache(`image-queue: persisted error for id=${row.coverArtId}`);
    // Completion check on failure too — otherwise an all-failed cycle would
    // never re-evaluate and transition to its (dismissible) error phase.
    await maybeCompleteCycle();
  }
  notifyImageQueueChange();
}

async function maybeCompleteCycle(): Promise<void> {
  const meta = readImageQueueMeta();
  if (meta.cycleId === null) return;
  const remaining = await countImageQueueRowsByCycle(meta.cycleId);
  if (remaining === 0) {
    // Every row succeeded → clean complete; banner clears.
    writeImageQueueMeta({ cycleId: null, cycleScope: null, cycleTotal: 0, isPaused: false, phase: 'active' });
    flushAggregateRecalc();
    logImageCache('image-queue: cycle complete');
    return;
  }
  // Rows remain but none are still queued/downloading → they're terminal
  // errors. Transition to the dismissible error phase instead of pinning the
  // progress banner at N/N forever. cycleId + the error rows are kept so the
  // cycle-scoped retry and next-boot recovery still work.
  const errored = await countImageQueueRowsByStatus('error');
  const stillActive = remaining - errored;
  if (stillActive <= 0 && meta.phase === 'active') {
    writeImageQueueMeta({ ...meta, phase: 'error' });
    flushAggregateRecalc();
    logImageCache(`image-queue: cycle finished with ${errored} error(s)`);
  }
}

async function imageWorkerLoop(): Promise<void> {
  while (true) {
    if (readImageQueueMeta().isPaused) return;
    if (!connectivityAllowsImageWork()) return;
    const next = await pickNextQueuedImageRow();
    if (!next) return;
    await processOneImage(next);
  }
}

/**
 * Drain the persistent image-download queue. Spawns up to
 * `maxConcurrentImageDownloads` parallel workers (same pattern as
 * `musicCacheService.downloadItem`). Idempotent: a second call while
 * the worker is running is a no-op.
 */
export async function processImageQueue(): Promise<void> {
  if (imageWorkerPromise !== null) {
    // Already running — return the same promise so the caller awaits the
    // existing drain instead of starting a duplicate worker.
    await imageWorkerPromise;
    return;
  }
  if (readImageQueueMeta().isPaused) return;
  if (!connectivityAllowsImageWork()) return;

  const promise = (async () => {
    try {
      const concurrency = Math.max(1, imageCacheStore.getState().maxConcurrentImageDownloads);
      const workers = Array.from({ length: concurrency }, () => imageWorkerLoop());
      await Promise.all(workers);
    } finally {
      flushAggregateRecalc();
    }
  })();
  imageWorkerPromise = promise;
  try {
    await promise;
  } finally {
    imageWorkerPromise = null;
  }
}

/**
 * Reset stalled rows back to 'queued' so they can be re-processed.
 * Mirrors `recoverStalledDownloadsAsync` (music): 'downloading' rows
 * (the previous session died mid-fetch) and 'error' rows both get a
 * fresh shot per session.
 */
export async function recoverStalledImageDownloads(): Promise<void> {
  const reset = await resetStalledImageRows();
  if (reset > 0) {
    // Rows are queued again → re-activate the cycle so the progress banner
    // (not a stale error banner) reflects the fresh attempt.
    const meta = readImageQueueMeta();
    if (meta.cycleId !== null && meta.phase !== 'active') {
      writeImageQueueMeta({ ...meta, phase: 'active' });
    }
    logImageCache(`image-queue: recovered ${reset} stalled row(s) to queued`);
    notifyImageQueueChange();
  }
}

/**
 * Pause the queue. The worker exits at the next iteration; in-flight
 * rows finish but the loop won't start new ones. `isPaused` is persisted,
 * so kill-while-paused → restart → still paused. Only an explicit
 * `resumeImageQueue()` clears the flag.
 */
export function pauseImageQueue(): void {
  const meta = readImageQueueMeta();
  if (meta.isPaused) return;
  writeImageQueueMeta({ ...meta, isPaused: true });
  logImageCache('image-queue: paused');
  notifyImageQueueChange();
}

export function resumeImageQueue(): void {
  const meta = readImageQueueMeta();
  if (!meta.isPaused) return;
  writeImageQueueMeta({ ...meta, isPaused: false });
  logImageCache('image-queue: resumed');
  notifyImageQueueChange();
  void processImageQueue();
}

/**
 * Drop the current cycle's queue rows and clear the cycle metadata.
 * Any row currently in 'downloading' finishes its in-flight fetch (we
 * don't kill mid-fetch — matches music's `cancelDownload`). The worker
 * exits naturally when there's nothing left.
 */
export async function cancelImageRefreshCycle(): Promise<void> {
  const meta = readImageQueueMeta();
  if (meta.cycleId === null) {
    logImageCache('image-queue: cancel with no active cycle (no-op)');
    return;
  }
  const removed = await clearImageQueueByCycle(meta.cycleId);
  writeImageQueueMeta({ cycleId: null, cycleScope: null, cycleTotal: 0, isPaused: false, phase: 'active' });
  flushAggregateRecalc();
  logImageCache(`image-queue: cancelled cycle ${meta.cycleId}, removed ${removed} row(s)`);
  notifyImageQueueChange();
}

/**
 * Move all 'error' rows in the active cycle back to 'queued' so the
 * worker re-tries them. Mirrors music's `retryDownload`.
 */
export async function retryFailedImages(): Promise<void> {
  const meta = readImageQueueMeta();
  if (meta.cycleId === null) {
    logImageCache('image-queue: retryFailed with no active cycle (no-op)');
    return;
  }
  const reset = await resetErrorRowsForCycle(meta.cycleId);
  logImageCache(`image-queue: retryFailed reset ${reset} row(s)`);
  if (reset > 0) {
    // Back to draining → progress banner, not the error banner.
    if (meta.phase !== 'active') writeImageQueueMeta({ ...meta, phase: 'active' });
    notifyImageQueueChange();
    void processImageQueue();
  }
}

/**
 * Dismiss the error banner shown after a refresh cycle finished with failures.
 * Hides the banner (phase → 'dismissed') but keeps the cycle + its error rows
 * so the cycle-scoped retry still works and next-boot recovery can re-attempt
 * them. No-op unless the cycle is actually in its error phase.
 */
export function dismissImageCacheErrorBanner(): void {
  const meta = readImageQueueMeta();
  if (meta.cycleId !== null && meta.phase === 'error') {
    writeImageQueueMeta({ ...meta, phase: 'dismissed' });
    notifyImageQueueChange();
  }
}

/* ----- Cycle starters ----- */

function generateCycleId(): string {
  // Cheap unique-enough id. Avoid `crypto.randomUUID` because the RN
  // runtime may lack it.
  return `cyc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Snapshot every cover-art ID associated with downloaded music
 * (cached_items albums/playlists + per-song covers from cached_songs).
 * Returns the deduped list.
 */
function snapshotDownloadedCoverArtIds(): string[] {
  const { items, songCoverArtIds } = hydrateCachedItemsForRecache();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!it.coverArtId) continue;
    if (it.type !== 'album' && it.type !== 'playlist') continue;
    if (seen.has(it.coverArtId)) continue;
    seen.add(it.coverArtId);
    out.push(it.coverArtId);
  }
  for (const id of songCoverArtIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function snapshotAllCachedCoverArtIds(): Promise<string[]> {
  // Distinct cover_art_ids across cached_images (every cover that has at
  // least one variant on disk). Already returned distinct + sorted.
  return getAllCachedCoverArtIds();
}

/**
 * Begin a refresh cycle. Snapshots the relevant cover-art IDs, generates
 * a cycle_id, bulk-inserts the rows, persists cycle metadata, and kicks
 * the worker. Returns the new cycle_id.
 *
 * If a cycle is already active, the call is a no-op and returns its id.
 */
export async function enqueueImageRefreshCycle(
  scope: ImageDownloadQueueScope,
): Promise<string | null> {
  const meta = readImageQueueMeta();
  if (meta.cycleId !== null) {
    logImageCache(`image-queue: cycle already active id=${meta.cycleId}, skipping new ${scope}`);
    return meta.cycleId;
  }
  const ids = scope === 'refresh-downloads'
    ? snapshotDownloadedCoverArtIds()
    : await snapshotAllCachedCoverArtIds();
  if (ids.length === 0) {
    logImageCache(`image-queue: ${scope} produced 0 ids, nothing to do`);
    return null;
  }
  const cycleId = generateCycleId();
  const inserted = await enqueueImagesBulk(ids, scope, cycleId);
  writeImageQueueMeta({
    cycleId,
    cycleScope: scope,
    cycleTotal: inserted,
    isPaused: false,
    phase: 'active',
  });
  logImageCache(`image-queue: started cycle ${cycleId} scope=${scope} ids=${inserted}`);
  notifyImageQueueChange();
  void processImageQueue();
  return cycleId;
}
