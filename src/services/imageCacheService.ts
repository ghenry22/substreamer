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
import { AppState, type AppStateStatus } from 'react-native';
import { fetch } from 'expo/fetch';

import { listDirectoryAsync } from 'expo-async-fs';
import { resizeImageToFileAsync } from 'expo-image-resize';
import {
  getFsKeyMigrationDone,
  getLastReconcileMs,
  imageCacheStore,
  markFsKeyMigrationDone,
  markReconcileRan,
} from '../store/imageCacheStore';
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
import {
  ensureCoverArtAuth,
  getCoverArtUrl,
  stripCoverArtSuffix,
} from './subsonicService';

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

/**
 * Characters that are either reserved on some filesystems (Windows:
 * `\/:*?"<>|`; legacy macOS: `:`) or otherwise troublesome in URIs.
 * Replaced with `_` before the coverArtId is used as an on-disk
 * directory name. The original coverArtId is still used everywhere
 * else (server URLs, SQL rows, URI cache keys) so the server side and
 * DB-side keys stay stable.
 *
 * Today's target is the OpenSubsonic/Navidrome disc-cover format
 * `dc-xxxx:N`, which APFS/ext4 accept but which we want to keep away
 * from the filesystem boundary on principle.
 */
const FS_UNSAFE_CHARS = /[:\\/?<>*|"\x00]/g;

function coverArtPathKey(coverArtId: string): string {
  return coverArtId.replace(FS_UNSAFE_CHARS, '_');
}

/** Evict every size's URI-cache entry for a coverArtId. Call at every
 *  cleanup site that removes files from disk so a subsequent
 *  getCachedImageUri doesn't return a stale URI pointing at nothing. */
function evictUriCacheForCover(coverArtId: string): void {
  for (const size of IMAGE_SIZES) uriCache.delete(uriCacheKey(coverArtId, size));
}

/**
 * Per-session consecutive failure counts for source-image (600px)
 * downloads. After MAX_SOURCE_FAILURES in a row we purge the rows + files
 * for that coverArtId so the "incomplete" count actually reaches zero
 * rather than re-queuing forever. Reset on success; cleared on app
 * restart so transient issues self-heal on the next launch.
 */
const sourceFailureCount = new Map<string, number>();
const MAX_SOURCE_FAILURES = 3;

/**
 * Delete every on-disk variant and DB row for a coverArtId, and evict
 * its URI-cache entries. Used by the sentinel sweep and the source-
 * download circuit breaker (404 or N× failure).
 */
function purgeCoverArtRows(coverArtId: string): { files: number } {
  const result = deleteCachedImagesForCoverArt(coverArtId);
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
  for (const s of IMAGE_SIZES) uriCache.delete(uriCacheKey(coverArtId, s));
  sourceFailureCount.delete(coverArtId);
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
/**
 * One-shot migration: rename any `{image-cache}/*` subdirectory whose
 * name contains a filesystem-hostile char (`:` etc.) to the sanitised
 * form produced by {@link coverArtPathKey}. If a sanitised sibling dir
 * already exists, move the raw-form's variant files into it (skipping
 * collisions) before deleting the now-empty original.
 *
 * Gated by the `fsKeyMigrationV1Done` flag in the image-cache settings
 * blob so it runs at most once per install. No-op on a fresh install
 * (no raw-form dirs exist).
 */
async function migrateFsHostileCacheDirs(): Promise<void> {
  if (getFsKeyMigrationDone()) return;
  let dir: Directory;
  try {
    dir = ensureCacheDir();
  } catch {
    return;
  }
  if (!dir.exists) {
    markFsKeyMigrationDone();
    return;
  }

  let topLevel: string[];
  try {
    topLevel = await listDirectoryAsync(dir.uri);
  } catch {
    // Can't enumerate — leave the flag unset so a later session can retry.
    return;
  }

  for (const name of topLevel) {
    if (!name) continue;
    const sanitised = coverArtPathKey(name);
    if (sanitised === name) continue; // nothing to do

    const src = new Directory(dir, name);
    if (!src.exists) continue;

    const dst = new Directory(dir, sanitised);
    if (!dst.exists) {
      // Simple rename — delete/create isn't exposed; copy each file
      // across then remove the source dir.
      try { dst.create(); } catch { continue; }
    }

    let fileNames: string[] = [];
    try {
      fileNames = await listDirectoryAsync(src.uri);
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      const srcFile = new File(src, fileName);
      if (!srcFile.exists) continue;
      const dstFile = new File(dst, fileName);
      if (dstFile.exists) {
        // Collision — the sanitised dir already had this variant. Keep
        // the existing file (it's newer or at least already indexed by
        // SQL) and drop the raw-form's copy.
        try { srcFile.delete(); } catch { /* best-effort */ }
        continue;
      }
      try { srcFile.move(dstFile); } catch { /* best-effort */ }
    }

    // Attempt to remove the now-empty src dir.
    try { src.delete(); } catch { /* best-effort */ }
  }

  markFsKeyMigrationDone();
}

function sweepSentinelRows(): number {
  let cleared = 0;
  let totalFiles = 0;
  for (const id of SENTINEL_COVER_ART_IDS) {
    const { files } = purgeCoverArtRows(id);
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
      appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'active') {
          fireAndForget(repairIncompleteImagesAsync(), 'imageCache.appStateActive');
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
/** Reconcile only runs once per this interval in the deferred-init path.
 *  Manual triggers from Settings always run regardless of this throttle. */
const RECONCILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when the last successful reconcile is missing or older than
 * RECONCILE_INTERVAL_MS. Only consulted by the deferred-init path —
 * user-initiated scans from Settings call `reconcileImageCacheAsync`
 * directly and bypass this check entirely.
 */
function shouldRunReconcile(): boolean {
  const last = getLastReconcileMs();
  if (last == null) return true;
  return Date.now() - last >= RECONCILE_INTERVAL_MS;
}

export function deferredImageCacheInit(): Promise<void> {
  // Defer to an idle window so the reconcile/repair FS passes never
  // compete with first-render or initial animations. requestIdleCallback
  // is polyfilled by RN (used elsewhere in dataSyncService, useTransitionComplete).
  return new Promise((resolve) => {
    requestIdleCallback(async () => {
      try {
        // One-shot migration: rename any cache subdirs containing FS-
        // hostile chars (e.g. Navidrome disc IDs like `dc-xxxx:1`) to
        // the sanitised form before reconcile walks the tree.
        await migrateFsHostileCacheDirs();

        // Always sweep sentinel rows, even offline — it's a pure SQL +
        // local-file cleanup and prevents the Settings "Incomplete"
        // count from permanently including rows the download pipeline
        // can never service.
        sweepSentinelRows();

        if (shouldRunReconcile()) {
          await reconcileImageCacheAsync();
        }
        // Skip repair when offline — queuing downloads against a network
        // we can't reach would just churn until each retry exhausts. The
        // offline→online subscriber below picks it up when we reconnect.
        if (!offlineModeStore.getState().offlineMode) {
          await repairIncompleteImagesAsync();
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

  // Reverse-map from the on-disk (sanitised) directory name back to the
  // SQL-canonical coverArtId so Pass 1 doesn't fork a duplicate row when
  // a pre-existing SQL entry (e.g. `dc-abc:1`) lives under the migrated
  // dir `dc-abc_1`. Built once from the current SQL view.
  const sqlIdByDirName = new Map<string, string>();
  for (const entry of listCachedImagesForBrowser('all')) {
    const dirName = coverArtPathKey(entry.coverArtId);
    // If two SQL ids collide on the same sanitised dir (should be rare),
    // prefer one that contains FS-unsafe chars — it's the "original" form.
    const existing = sqlIdByDirName.get(dirName);
    if (!existing || existing === dirName) {
      sqlIdByDirName.set(dirName, entry.coverArtId);
    }
  }

  // --- Pass 1: FS -> SQL (discover missing rows) ---
  for (const dirName of topLevelNames) {
    if (!dirName) continue;
    const subDir = new Directory(dir, dirName);
    if (!subDir.exists) continue;
    // Resolve the dir name back to its SQL-canonical coverArtId so we
    // upsert into the existing row family rather than a parallel one.
    const coverArtId = sqlIdByDirName.get(dirName) ?? dirName;
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
      const file = new File(subDir, name);
      if (!file.exists) continue;
      // A zero-byte finalised file is the signature of a crashed write
      // (e.g. ENOSPC between rename and content write, or a kill after
      // the move but before the bytes landed). RNImage renders nothing
      // for it, so delete it here — Pass 2 then drops any stale DB row.
      if ((file.size ?? 0) === 0) {
        try { file.delete(); } catch { /* best-effort */ }
        uriCache.delete(uriCacheKey(coverArtId, size));
        continue;
      }
      seenOnDisk.add(diskKey(coverArtId, size));
      if (dbHasCachedImage(coverArtId, size)) continue;
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

  // --- Pass 2: SQL -> FS (drop rows whose files are gone or empty) ---
  // Walk the DB's view; delete any row whose file wasn't observed on disk
  // or whose file exists but is zero bytes (crashed write). Guarded by
  // the same mass-missing heuristic — a temporarily-missing cache
  // directory shouldn't wipe the table.
  if (!isMassInsert) {
    const post = listCachedImagesForBrowser('all');
    let droppedCount = 0;
    for (const entry of post) {
      for (const file of entry.files) {
        if (seenOnDisk.has(diskKey(entry.coverArtId, file.size))) continue;
        // Disk paths are sanitised; SQL rows keep the original coverArtId.
        const subDir = new Directory(dir, coverArtPathKey(entry.coverArtId));
        const onDisk = new File(subDir, `${file.size}.${file.ext}`);
        if (onDisk.exists) {
          // Belt-and-braces: if Pass 1 missed a zero-byte file (e.g.
          // listDirectoryAsync failed for that subdir), catch it here.
          if ((onDisk.size ?? 0) === 0) {
            try { onDisk.delete(); } catch { /* best-effort */ }
            deleteCachedImageVariant(entry.coverArtId, file.size);
            uriCache.delete(uriCacheKey(entry.coverArtId, file.size));
            droppedCount++;
          }
          continue;
        }
        deleteCachedImageVariant(entry.coverArtId, file.size);
        uriCache.delete(uriCacheKey(entry.coverArtId, file.size));
        droppedCount++;
      }
    }
    if (droppedCount > 0 || newRows.length > 0) {
      imageCacheStore.getState().recalculateFromDb();
    }

    // Timestamp the successful pass so the deferred-init throttle can
    // skip this work on the next launch. Only written when the safety
    // gate did NOT trip — otherwise we'd lock in a 7-day skip on a
    // transient filesystem issue.
    markReconcileRan(Date.now());
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

export async function repairIncompleteImagesAsync(): Promise<RepairOutcome> {
  // 1. Sentinel sweep first — these should never have rows. Their count
  //    does NOT enter `queued` (which only covers the user-actionable
  //    incomplete set) but it does add to `removed` so the toast can
  //    report "2 sentinels removed".
  const sentinelCoversCleared = sweepSentinelRows();

  // 2. .tmp sweep — clean up abandoned half-writes from previous sessions
  //    or crashes before re-queuing anything.
  const dir = ensureCacheDir();
  let subDirNames: string[];
  try {
    subDirNames = await listDirectoryAsync(dir.uri);
  } catch {
    subDirNames = [];
  }
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

  // 3. Re-queue and AWAIT completion for each incomplete cover. We use
  //    cacheAllSizes() rather than poking downloadQueue + processQueue()
  //    directly: cacheAllSizes returns a per-coverArtId promise that
  //    resolves in processNext's finally block via resolveWaiters(), so
  //    Promise.all below gives us a real "repair-done" signal that the
  //    Settings overlay can hook into.
  const snapshot = findIncompleteCovers().filter(
    (id) => !isSentinelCoverArtId(id),  // sentinels already handled in step 1
  );
  const queued = snapshot.length;

  if (queued === 0) {
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
  const afterIncomplete = new Set(findIncompleteCovers());
  let repaired = 0;
  let failed = 0;
  let removedDuringRepair = 0;
  for (const id of snapshot) {
    if (afterIncomplete.has(id)) {
      // Still incomplete — transient failure (offline mid-repair, single
      // 5xx below the 3× threshold, etc.). Will retry on next launch.
      failed++;
    } else {
      // Either all 4 variants present → repaired, or all rows gone →
      // purged by the 404/3×-failure circuit breaker.
      const has600 = dbHasCachedImage(id, SOURCE_SIZE);
      if (has600) repaired++;
      else removedDuringRepair++;
    }
  }

  return {
    queued,
    repaired,
    failed,
    removed: sentinelCoversCleared + removedDuringRepair,
  };
}

/* ------------------------------------------------------------------ */
/*  Cache lookup (synchronous)                                         */
/* ------------------------------------------------------------------ */

/**
 * Check if a cached image exists for the given coverArtId and size.
 * Returns the local `file://` URI or `null`.
 *
 * Caching policy: only POSITIVE lookups are memoised in `uriCache`. A
 * miss (file not on disk) re-checks the filesystem on every call.
 * Caching nulls was the root cause of "covers vanish after a download"
 * — once a row was poisoned with null (via a transient FS hiccup, an
 * eviction by a sibling code path, or a never-completed download), the
 * map returned null forever even after the file had been written. The
 * cost of re-checking on miss is one sync `file.exists` per render —
 * cheap on-device, no network — and the logic stays simple: the map's
 * presence implies "we know there's a file here", absence implies
 * "ask the filesystem".
 */
export function getCachedImageUri(
  coverArtId: string,
  size: number,
): string | null {
  if (!coverArtId) return null;
  coverArtId = stripCoverArtSuffix(coverArtId);

  const key = uriCacheKey(coverArtId, size);
  const cached = uriCache.get(key);
  if (cached) return cached;

  const subDir = new Directory(ensureCacheDir(), coverArtPathKey(coverArtId));
  if (!subDir.exists) return null;
  for (const ext of EXTENSIONS) {
    const file = new File(subDir, `${size}${ext}`);
    if (file.exists) {
      uriCache.set(key, file.uri);
      return file.uri;
    }
  }
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

/**
 * Delete a single cached variant: file on disk, DB row, and in-memory
 * Map entry. Used by CachedImage when an `onError` indicates the local
 * file is broken and a re-download is needed. Scoped to one size —
 * sibling variants for the same coverArt may still be healthy.
 */
export function deleteCachedVariant(coverArtId: string, size: number): void {
  if (!coverArtId) return;
  coverArtId = stripCoverArtSuffix(coverArtId);
  uriCache.delete(uriCacheKey(coverArtId, size));
  const subDir = new Directory(ensureCacheDir(), coverArtPathKey(coverArtId));
  if (subDir.exists) {
    for (const ext of EXTENSIONS) {
      const file = new File(subDir, `${size}${ext}`);
      if (file.exists) {
        try { file.delete(); } catch { /* best-effort */ }
      }
    }
  }
  deleteCachedImageVariant(coverArtId, size);
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
export function cacheAllSizes(coverArtId: string): Promise<void> {
  if (!coverArtId) return Promise.resolve();
  // Sentinels render from bundled assets via CachedImage — never queue
  // them for download. Belt-and-braces guard; CachedImage already maps
  // their coverArtId to `undefined` before calling here.
  if (isSentinelCoverArtId(coverArtId)) return Promise.resolve();
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
  // Defensive — sentinels should never reach the pipeline. Callers
  // already filter via isSentinelCoverArtId() / CachedImage's mapping,
  // but an external `repairIncompleteImagesAsync` could still hand us
  // a stale row that slipped through.
  if (isSentinelCoverArtId(coverArtId)) return;

  const subDir = new Directory(ensureCacheDir(), coverArtPathKey(coverArtId));
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
  if (!url) {
    // Null URL means offline, missing auth, or a sentinel slipped past
    // the upstream guards. Don't count this against the failure budget:
    // offline/auth issues are transient by nature and should recover
    // when the user comes back online.
    return null;
  }

  let tmpName: string | null = null;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        // Definitive server signal that this cover doesn't exist
        // (album removed, re-indexed with a new ID, etc.). Re-requesting
        // the same URL every launch is pure churn — purge immediately
        // so the "incomplete" count actually reaches zero. The cover
        // will re-populate naturally if the user navigates to the
        // album again and CachedImage calls cacheAllSizes.
        // eslint-disable-next-line no-console
        console.warn(
          `[imageCacheService] 404 for coverArt=${coverArtId} — purging cache rows`,
        );
        purgeCoverArtRows(coverArtId);
        return null;
      }
      // Other non-OK statuses (5xx, 403, etc.) count toward the failure
      // budget. Transient issues (one 503, single timeout) don't cost
      // anything; persistent ones eventually purge.
      bumpSourceFailure(coverArtId);
      return null;
    }

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

    // Success — wipe any accumulated failure count.
    sourceFailureCount.delete(coverArtId);

    return dest.uri;
  } catch {
    if (tmpName) {
      const tmp = new File(subDir, tmpName);
      if (tmp.exists) {
        try { tmp.delete(); } catch { /* best-effort */ }
      }
    }
    // Network error, JSON parse, etc. — transient; count it.
    bumpSourceFailure(coverArtId);
    return null;
  }
}

/**
 * Increment the per-coverArt in-session failure counter and purge the
 * rows if we've hit {@link MAX_SOURCE_FAILURES}. Keeps the "incomplete"
 * count from stagnating on covers the server repeatedly refuses to
 * serve (403, 5xx, sustained timeouts).
 */
function bumpSourceFailure(coverArtId: string): void {
  const next = (sourceFailureCount.get(coverArtId) ?? 0) + 1;
  sourceFailureCount.set(coverArtId, next);
  if (next >= MAX_SOURCE_FAILURES) {
    // eslint-disable-next-line no-console
    console.warn(
      `[imageCacheService] ${next} consecutive failures for coverArt=${coverArtId} — purging cache rows`,
    );
    purgeCoverArtRows(coverArtId);
  }
}

/**
 * Coverages where variant generation has failed repeatedly during this
 * app session. We stop retrying so a persistent per-cover decode bug
 * (e.g. corrupt 600 source) can't produce an unbounded loop on re-entry.
 * Resets on app restart — transient issues self-heal.
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
  if ((variantFailureCount.get(coverArtId) ?? 0) >= MAX_VARIANT_FAILURES) return;

  const fileName = `${size}.jpg`;
  const tmpName = `${fileName}.tmp`;
  const tmpFile = new File(subDir, tmpName);
  const dest = new File(subDir, fileName);

  try {
    await resizeImageToFileAsync(sourceUri, tmpFile.uri, size, RESIZE_COMPRESS);

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

    // Success — reset any accumulated failures for this cover.
    variantFailureCount.delete(coverArtId);
  } catch {
    variantFailureCount.set(
      coverArtId,
      (variantFailureCount.get(coverArtId) ?? 0) + 1,
    );
    if (tmpFile.exists) {
      try { tmpFile.delete(); } catch { /* best-effort */ }
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

  evictUriCacheForCover(coverArtId);

  const subDir = new Directory(ensureCacheDir(), coverArtPathKey(coverArtId));
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
