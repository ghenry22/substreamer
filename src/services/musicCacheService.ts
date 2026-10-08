/**
 * Offline music cache service — v2 (album-rooted, cross-item deduplicated).
 *
 * Downloads album, playlist, favorites, and single-song tracks to an album-
 * rooted on-disk layout:
 *
 *   {Paths.document}/music-cache/{albumId}/{songId}.{ext}
 *
 * Cross-item deduplication is enforced by the `cached_songs` SQL table: before
 * downloading, the service checks whether a song is already in the pool. If
 * so, it just inserts a new `cached_item_songs` edge — no bytes, no network.
 *
 * Key guarantees:
 *   - Tmp-file atomicity (download to .tmp, move on success)
 *   - Kill-mid-item resumption via pre-scan + `recoverStalledDownloadsAsync`
 *   - Retry-once-on-null inside `downloadItem`
 *   - AppState listener for background→foreground recovery
 *   - Starred-songs virtual playlist under itemId `__starred__`
 *   - Storage-limit aware queue pausing
 *   - Real-time download speed tracking via `downloadSpeedTracker`
 */

import { Directory, File, Paths } from 'expo-file-system';
import { errMessage } from '../utils/errorMessage';
import { onAppForeground } from '../utils/onAppForeground';

import i18n from '../i18n/i18n';
import {
  listDirectoryAsync,
  listDirectoryWithSizesAsync,
  getDirectorySizeAsync,
  downloadFileAsyncWithProgress,
  deleteDirectoryAsync,
  deleteFileAsync,
} from 'expo-async-fs';
import { checkStorageLimit } from './storageService';
import { beginDownload, clearDownload } from './downloadSpeedTracker';
import { fetchAlbumDetail, fetchPlaylistDetail } from './detailFetchService';
import { favoritesStore } from '../store/favoritesStore';
import { storageLimitStore } from '../store/storageLimitStore';
import {
  musicCacheStore,
  whenQueuePayloadWritten,
  type CachedItemMeta,
  type CachedSongMeta,
  type DownloadQueueItem,
} from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import {
  albumMetaFromAlbumID3,
  countCachedSongs,
  countRealSongRefsForSongsAsync,
  insertCachedItemSong,
  playlistMetaFromPlaylist,
  promotedSongFieldsFromChild,
  readDownloadQueueAlbumIdsAsync,
  readDownloadQueueSongRefsAsync,
  readDownloadQueueSongsAsync,
  readQueuedSongStatus,
  UNKNOWN_ALBUM_ID,
  type CachedSongBytesUpdate,
} from '../store/persistence/musicCacheTables';
import { logImageCache } from './imageCacheLogger';
import { logLibrarySync } from './librarySyncLogger';
import { shouldBlockContent } from './navidromeReid/reidMarker';
import { processingOverlayStore } from '../store/processingOverlayStore';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { resolveEffectiveFormat } from '../utils/effectiveFormat';
import { getDb } from '../store/persistence/db';
import { getAlbumDetail, getPlaylistDetail } from '../db/repository/details';
import { albumIdsWithSongs } from '../db/repository/songs';
import { countStarredSongs, listAllStarredSongs, starredItemOf } from '../db/repository/favorites';
import {
  ensureCoverArtAuth,
  getDownloadStreamUrl,
  type Child,
} from './subsonicService';
import {
  ensureCached,
  cacheSongCovers,
  resolveDisplayImage,
} from './imageCacheService';
import { coverArtForAlbum, coverArtForPlaylist } from '../utils/coverArtId';
import { runPool } from '../utils/promisePool';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const CACHE_DIR_NAME = 'music-cache';
export { UNKNOWN_ALBUM_ID };

/**
 * Hook invoked when an album is enqueued for download and the library cache
 * doesn't yet contain that album id. Registered by `dataSyncService` at
 * module load to delegate to `onAlbumReferenced` without this service
 * importing the orchestration graph directly.
 */
let onAlbumReferencedHook: ((albumId: string) => void) | null = null;
export function registerMusicCacheOnAlbumReferencedHook(
  hook: ((albumId: string) => void) | null,
): void {
  onAlbumReferencedHook = hook;
}

/** Well-known itemId for the starred-songs virtual playlist. */
export const STARRED_SONGS_ITEM_ID = '__starred__';

/** Sentinel coverArtId so CachedImage renders a branded placeholder. */
export const STARRED_COVER_ART_ID = '__starred_cover__';

const MIME_TO_AUDIO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/**
 * Determine the file extension for a downloaded track based on the current
 * download format setting and the track's original metadata.
 */
function getTrackFileExtension(track: Child): string {
  const { downloadFormat } = playbackSettingsStore.getState();
  if (downloadFormat !== 'raw') return downloadFormat;
  if (track.suffix) return track.suffix;
  if (track.contentType) {
    const mime = track.contentType.split(';')[0].trim();
    return MIME_TO_AUDIO_EXT[mime] ?? 'dat';
  }
  return 'dat';
}

/** Whether a cached file can be reused under the current download format. `raw` reuses anything. */
function cachedFileMatchesSetting(
  existing: { suffix?: string },
  track: Child,
): boolean {
  const { downloadFormat } = playbackSettingsStore.getState();
  if (downloadFormat === 'raw') return true;
  return existing.suffix === getTrackFileExtension(track);
}

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let cacheDir: Directory | null = null;
let isProcessing = false;
let processingId = 0;
let offlineSubscription: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;

/**
 * Set to true after `populateTrackMapsAsync()` finishes. Module-scope
 * subscriptions (e.g. the favoritesStore listener) MUST NOT run
 * `syncStarredSongsDownload()` before this flag is set — doing so with an
 * empty trackUriMap / trackToItems risks spurious file deletion and wrong
 * refcounting.
 */
let trackMapsReady = false;

/**
 * In-memory map from songId -> local file URI for O(1) lookups. Rebuilt from
 * `cachedSongs` on startup; updated incrementally as downloads complete.
 */
const trackUriMap = new Map<string, string>();

/**
 * Reverse map: songId -> set of itemIds that reference this song. Used for
 * fast synchronous orphan-detection during cancel/sync. Rebuilt from
 * `cachedItems[*].songIds` on startup.
 */
const trackToItems = new Map<string, Set<string>>();

/* ------------------------------------------------------------------ */
/*  Path helpers                                                       */
/* ------------------------------------------------------------------ */

function ensureCacheDir(): Directory {
  if (!cacheDir) initMusicCache();
  return cacheDir!;
}

function ensureAlbumDir(albumId: string): Directory {
  const dir = new Directory(ensureCacheDir(), albumId || UNKNOWN_ALBUM_ID);
  if (!dir.exists) {
    try { dir.create(); } catch { /* best-effort */ }
  }
  return dir;
}

/** Resolve the final-path File for a cached song (no mutation). */
function resolveSongFile(song: { id: string; albumId?: string; suffix: string }): File {
  const albumId = song.albumId || UNKNOWN_ALBUM_ID;
  const albumDir = new Directory(ensureCacheDir(), albumId);
  return new File(albumDir, `${song.id}.${song.suffix}`);
}

/* ------------------------------------------------------------------ */
/*  Initialisation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Create the music-cache directory and register the AppState listener.
 * Safe to call multiple times. Expensive scanning lives in
 * {@link deferredMusicCacheInit}.
 */
export function initMusicCache(): void {
  if (cacheDir) return;
  try {
    const dir = new Directory(Paths.document, CACHE_DIR_NAME);
    if (!dir.exists) {
      dir.create();
    }
    cacheDir = dir;

    if (!appStateSubscription) {
      appStateSubscription = onAppForeground(() => {
        if (!isProcessing) recoverStalledDownloadsAsync();
      });
    }
    if (!offlineSubscription) {
      // Same machinery as kill-mid-download recovery: bump the generation so live
      // workers exit at their next song boundary, hand the in-flight item back to
      // 'queued' and drop its .tmp remnants. Going offline the gate above keeps it
      // parked there; coming back online the identical call restarts it from exactly
      // where it stopped (and retries whatever errored while the network was gone).
      offlineSubscription = offlineModeStore.subscribe((state, prev) => {
        if (state.offlineMode === prev.offlineMode) return;
        // The trailing pump is what resumes: after a pause the items sit in 'queued',
        // so the recovery pass finds nothing to recover and would never restart on its
        // own. Going offline it is a no-op — the gate turns it straight back.
        void forceRecoverDownloadsAsync().then(() => processQueue());
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[musicCacheService] initMusicCache failed:',
      errMessage(e),
    );
  }
}

/**
 * Unregister the AppState listener and clear the cached directory handle.
 * Called from `resetAllStores()` on logout so a background→foreground
 * transition while logged out doesn't fire recovery against a reset store.
 * The next login re-arms the listener via `initMusicCache()`.
 */
export function teardownMusicCache(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  offlineSubscription?.();
  offlineSubscription = null;
  cacheDir = null;
}

/**
 * Deferred post-splash init: populate the in-memory maps from SQL state,
 * reconcile any drift between SQL and the filesystem, then recover any
 * stalled downloads.
 */
export async function deferredMusicCacheInit(): Promise<void> {
  // Ensure the per-row tables are hydrated into the store BEFORE building the
  // in-memory maps. This init runs from a `requestIdleCallback` on a different
  // boot effect than the store hydration (`rehydrateAllStores`), so the idle
  // callback can otherwise fire mid-hydration and build the maps from an empty
  // `cachedSongs` — leaving every downloaded track shown as unavailable until
  // the next launch. `hydrateFromDbAsync` is idempotent (re-reads the
  // source-of-truth tables); the `hasHydrated` guard skips it once boot
  // hydration has already run.
  if (!musicCacheStore.getState().hasHydrated) {
    await musicCacheStore.getState().hydrateFromDbAsync();
  }

  // Call populateTrackMapsAsync directly (not ensureTrackMapsReady's
  // coalescing wrapper) so a reconciliation pass always refreshes the
  // in-memory maps from the latest store state — covering the case where
  // the maps were already warmed by a prior call from the player's
  // hydration path.
  await populateTrackMapsAsync();

  // Force all musicCacheStore subscribers (e.g. useDownloadStatus) to
  // re-evaluate now that trackUriMap is populated. The hooks' results depend
  // on the in-memory map, which isn't part of Zustand state.
  musicCacheStore.setState({});

  // Reconciliation is a best-effort consistency check; never block boot if
  // it fails. Logs a summary when drift was healed.
  try {
    await reconcileMusicCacheAsync();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[musicCacheService] reconciliation failed:',
      errMessage(e),
    );
  }

  // Capture filesystem ground-truth byte/file totals. Store aggregates are derived
  // from cachedSongs on hydrate (dedup-correct); this corrects any drift from them.
  scheduleRecalculate();

  await recoverStalledDownloadsAsync();
}

/** In-flight populate promise for coalescing concurrent callers. */
let populatePromise: Promise<void> | null = null;

/**
 * Rebuild `trackUriMap` and `trackToItems` from the hydrated SQL mirror in
 * the store. No filesystem scan required — `cachedSongs` already has
 * everything needed to derive each file's URI.
 */
async function populateTrackMapsAsync(): Promise<void> {
  trackUriMap.clear();
  trackToItems.clear();

  const { cachedSongs, cachedItems, hasHydrated } = musicCacheStore.getState();

  for (const song of Object.values(cachedSongs)) {
    const file = resolveSongFile(song);
    trackUriMap.set(song.id, file.uri);
  }

  for (const item of Object.values(cachedItems)) {
    for (const songId of item.songIds) {
      let bucket = trackToItems.get(songId);
      if (!bucket) {
        bucket = new Set<string>();
        trackToItems.set(songId, bucket);
      }
      bucket.add(item.itemId);
    }
  }

  // Diagnostic (gated by the image-cache diagnostics flag). Compares rows in SQLite
  // vs the hydrated store vs the map just built; `dbSongs>0 mapSize=0` means the
  // maps were built from an unhydrated store.
  logImageCache(
    `musiccache trackmaps hydrated=${hasHydrated} `
    + `dbSongs=${countCachedSongs()} storeSongs=${Object.keys(cachedSongs).length} `
    + `mapSize=${trackUriMap.size}`,
  );

  // Only latch "ready" once the store is actually hydrated — see
  // `deferredMusicCacheInit`. Latching an empty `trackUriMap` shows every downloaded
  // track as unavailable until the next launch; leaving it un-latched lets a later
  // post-hydration call rebuild instead of short-circuiting in `ensureTrackMapsReady`.
  if (hasHydrated) {
    trackMapsReady = true;
    flushTrackMapsReadyWaiters();
  }

  // Run any starred-songs sync that was deferred because the favoritesStore
  // subscription fired before the maps were ready.
  void syncStarredSongsDownload();
}

/**
 * Idempotent, coalescing trigger for the populate pass. Safe to call from
 * multiple call sites — concurrent callers all await the same in-flight
 * promise. The player's cold-start hydration uses this to avoid blocking
 * on the image-cache-init chain that owns the "post-splash" populate call.
 */
function ensureTrackMapsReady(): Promise<void> {
  if (trackMapsReady) return Promise.resolve();
  if (populatePromise) return populatePromise;
  populatePromise = populateTrackMapsAsync().finally(() => {
    populatePromise = null;
  });
  return populatePromise;
}

/** Waiters queued before `trackMapsReady` flipped true. */
const trackMapsReadyWaiters: Array<() => void> = [];

function flushTrackMapsReadyWaiters(): void {
  while (trackMapsReadyWaiters.length > 0) {
    const resolve = trackMapsReadyWaiters.shift();
    resolve?.();
  }
}

/**
 * Resolves as soon as the in-memory track maps are ready. Proactive —
 * kicks off the populate itself if it hasn't started yet (coalesced with
 * any concurrent call via {@link ensureTrackMapsReady}).
 *
 * Used by the player's resume path so `childToTrack` sees local URIs for
 * downloaded songs instead of server stream URLs — critical on cold launch
 * in offline mode where the launch race would otherwise push unreachable
 * URLs into RNTP.
 */
export function waitForTrackMapsReady(): Promise<void> {
  return ensureTrackMapsReady();
}

/**
 * Force the in-memory track maps to be rebuilt from the store, ignoring the ready latch.
 *
 * `ensureTrackMapsReady` short-circuits once `trackMapsReady` is true, so a caller that
 * has changed every song id underneath the maps cannot get them refreshed through it —
 * and simply clearing the maps is worse, because the latch stays true and every
 * downloaded track then reads as unavailable for the rest of the session.
 *
 * Written for the Navidrome id re-key, which rewrites `cached_songs.song_id` wholesale.
 * Note the populate ends with a starred-songs sync, so callers must be behind the
 * delete guard.
 */
export async function rebuildTrackMaps(): Promise<void> {
  trackMapsReady = false;
  populatePromise = null;
  await ensureTrackMapsReady();
}

/**
 * Reconcile drift between the SQL mirror and the on-disk album cache.
 *
 * Runs three defensive sweeps at startup (best-effort — every step
 * swallows errors so a single bad file never blocks boot):
 *
 *   1. **FS -> SQL sweep.** Walk `albums/{albumId}/*` and delete any file
 *      that has no matching `cached_songs` row (or whose row points at a
 *      different album). Also deletes stale `.tmp` remnants left over from
 *      crashed transfers, and empty album directories with no SQL songs
 *      referencing them.
 *
 *   2. **SQL -> FS sweep.** For every `cached_songs` row, verify the
 *      underlying file still exists. If not, unwind every edge that
 *      references the missing song via the store's `removeCachedItemSong`
 *      path — this decrements positions correctly, deletes the orphaned
 *      song row, and updates the in-memory mirrors.
 *
 *   3. **Orphan item sweep.** Remove `cached_items` rows whose `songIds`
 *      list is empty after the earlier passes (items that no longer hold
 *      any songs are dead rows with nothing to render).
 *
 * Logs a one-line summary when any drift was healed.
 */
export async function reconcileMusicCacheAsync(): Promise<void> {
  const dir = ensureCacheDir();
  if (!dir.exists) return;

  // Top-level entries on disk. Every cached song lives at
  // {music-cache}/{albumId}/{songId}.{ext} in v2; top-level names that
  // aren't valid album_ids are stale v1 leftovers, swept in pass 4.
  let topLevelNames: string[];
  try {
    const result = await listDirectoryAsync(dir.uri);
    topLevelNames = Array.isArray(result) ? result : [];
  } catch {
    topLevelNames = [];
  }

  // Set of album_ids the SQL store knows about. Anything else at top level
  // is stale (v1 playlist/__starred__/partially-migrated stragglers).
  // Snapshotted before passes 2–3 mutate the store, so pass 4's safety gate
  // reflects the pre-reconcile state.
  const validAlbumIds = new Set<string>();
  for (const s of Object.values(musicCacheStore.getState().cachedSongs)) {
    validAlbumIds.add(s.albumId || UNKNOWN_ALBUM_ID);
  }

  const { orphanFilesDeleted, staleTmpDeleted } = await reconcileFilesToRows(
    dir,
    topLevelNames,
    validAlbumIds,
  );
  const missingSongIds = await reconcileRowsToFiles();
  const orphanItemIds = await removeOrphanItemRows();
  const staleDirsDeleted = sweepStaleTopLevelDirs(dir, topLevelNames, validAlbumIds);

  if (
    orphanFilesDeleted > 0 ||
    staleTmpDeleted > 0 ||
    missingSongIds > 0 ||
    orphanItemIds > 0 ||
    staleDirsDeleted > 0
  ) {
    // eslint-disable-next-line no-console
    console.warn('[musicCacheService] reconciliation healed drift:', {
      orphanFilesDeleted,
      staleTmpDeleted,
      missingSongIds,
      orphanItemIds,
      staleDirsDeleted,
    });
  }
}

/**
 * Pass 1 (FS → SQL): walk each known album directory and delete files with no
 * matching SQL row (orphans) plus any stale `.tmp` remnants, then remove an
 * album dir that no song references once it's empty on disk. Non-album
 * top-level entries are left to {@link sweepStaleTopLevelDirs}.
 */
async function reconcileFilesToRows(
  dir: Directory,
  topLevelNames: string[],
  validAlbumIds: Set<string>,
): Promise<{ orphanFilesDeleted: number; staleTmpDeleted: number }> {
  let orphanFilesDeleted = 0;
  let staleTmpDeleted = 0;

  for (const albumId of topLevelNames) {
    // Stale non-album top-level entry — delete it wholesale in the sweep.
    if (!validAlbumIds.has(albumId)) continue;
    const albumDir = new Directory(dir, albumId);
    if (!albumDir.exists) continue;

    let fileNames: string[];
    try {
      const result = await listDirectoryAsync(albumDir.uri);
      fileNames = Array.isArray(result) ? result : [];
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      const file = new File(albumDir, fileName);
      // No sync `.exists` check — the name came from the directory listing.

      // Stale .tmp remnants from a crashed transfer. Deleted unconditionally
      // at startup — no in-flight downloads have been scheduled yet, so any
      // .tmp on disk is abandoned state. Delete off-thread (best-effort).
      if (fileName.endsWith('.tmp')) {
        void deleteFileAsync(file.uri).catch(() => { /* best-effort */ });
        staleTmpDeleted++;
        continue;
      }

      // Derive songId from filename (stem before the last dot).
      const dotIdx = fileName.lastIndexOf('.');
      const songId = dotIdx >= 0 ? fileName.slice(0, dotIdx) : fileName;

      // Orphan check: no SQL row, or the row exists under a different album.
      const sqlRow = musicCacheStore.getState().cachedSongs[songId];
      if (!sqlRow || sqlRow.albumId !== albumId) {
        void deleteFileAsync(file.uri).catch(() => { /* best-effort */ });
        orphanFilesDeleted++;
      }
    }

    // If no SQL song references this album directory, remove it. Only delete
    // when the directory is also empty on disk so partial-album downloads
    // whose first song is mid-transfer aren't lost.
    const stillReferenced = Object.values(
      musicCacheStore.getState().cachedSongs,
    ).some((s) => (s.albumId || UNKNOWN_ALBUM_ID) === albumId);
    if (!stillReferenced) {
      try {
        const remaining = await listDirectoryAsync(albumDir.uri);
        if (Array.isArray(remaining) && remaining.length === 0) {
          void deleteFileAsync(albumDir.uri).catch(() => { /* best-effort */ });
        }
      } catch { /* best-effort */ }
    }
  }

  return { orphanFilesDeleted, staleTmpDeleted };
}

/**
 * Pass 2 (SQL → FS): for every cached song whose file is missing on disk,
 * unwind its edges from every item that references it and drop its in-memory
 * map entries. The store purges orphaned song rows by refcount.
 */
async function reconcileRowsToFiles(): Promise<number> {
  // Snapshot cachedSongs before mutation — iterating while removing edges
  // is unsafe.
  const songsSnapshot = Object.values(musicCacheStore.getState().cachedSongs);
  const missingSongs: typeof songsSnapshot = [];
  for (const song of songsSnapshot) {
    const file = resolveSongFile(song);
    if (!file.exists) missingSongs.push(song);
  }

  let missingSongIds = 0;
  for (const song of missingSongs) {
    missingSongIds++;

    // Find every item that currently references this missing song and unwind
    // the edges one at a time. We re-read cachedItems inside the loop so
    // position shifts from `removeCachedItemSong` stay consistent.
    const itemIdsReferencing: string[] = [];
    for (const item of Object.values(musicCacheStore.getState().cachedItems)) {
      if (item.songIds.includes(song.id)) itemIdsReferencing.push(item.itemId);
    }

    for (const itemId of itemIdsReferencing) {
      // Safety cap: an item can in principle reference the same songId at
      // multiple positions (e.g. a playlist containing the same song twice).
      // Loop until the song no longer appears in the item's songIds.
      // Bounded by songIds.length to avoid infinite loops on unexpected state.
      const item = musicCacheStore.getState().cachedItems[itemId];
      if (!item) continue;
      let safety = item.songIds.length + 1;
      while (safety-- > 0) {
        const current = musicCacheStore.getState().cachedItems[itemId];
        if (!current) break;
        const idx = current.songIds.indexOf(song.id);
        if (idx < 0) break;
        // eslint-disable-next-line no-await-in-loop
        await musicCacheStore.getState().removeCachedItemSong(itemId, idx + 1);
      }
    }

    // In-memory map cleanup — the store already purges orphaned song rows
    // from cachedSongs via refcount, but trackUriMap / trackToItems are
    // owned by the service.
    trackUriMap.delete(song.id);
    trackToItems.delete(song.id);
  }

  return missingSongIds;
}

/** Pass 3: remove item rows left with no songs after pass 2. */
async function removeOrphanItemRows(): Promise<number> {
  const orphanItems: string[] = [];
  for (const item of Object.values(musicCacheStore.getState().cachedItems)) {
    if (item.songIds.length === 0) orphanItems.push(item.itemId);
  }
  let orphanItemIds = 0;
  for (const itemId of orphanItems) {
    // eslint-disable-next-line no-await-in-loop
    await musicCacheStore.getState().removeCachedItem(itemId);
    orphanItemIds++;
  }
  return orphanItemIds;
}

/**
 * Pass 4: sweep non-album top-level directories — leftover v1 playlist /
 * __starred__ dirs from a partial v1→v2 migration, or other junk.
 *
 * CRITICAL SAFETY GATE: skip this pass entirely if we have no valid
 * album_ids. `cached_songs` is empty in two scenarios, neither of which
 * should trigger a sweep:
 *   (a) Fresh install — there's nothing on disk to sweep, so skipping
 *       is a cheap no-op.
 *   (b) The v1→v2 migration (migration 14) hasn't completed yet (an earlier
 *       task threw and runMigrations halted) — the v1 cache directories are
 *       still on disk in their original shape waiting to be migrated.
 *       Sweeping them here would be catastrophic data loss.
 * Without this gate, scenario (b) would wipe every cached file the user has
 * before that migration ever gets a chance to run on the next launch.
 */
function sweepStaleTopLevelDirs(
  dir: Directory,
  topLevelNames: string[],
  validAlbumIds: Set<string>,
): number {
  let staleDirsDeleted = 0;
  if (validAlbumIds.size > 0) {
    for (const name of topLevelNames) {
      if (validAlbumIds.has(name)) continue;
      try {
        const sub = new Directory(dir, name);
        if (sub.exists) {
          sub.delete();
          staleDirsDeleted++;
        }
      } catch { /* best-effort */ }
    }
  }
  return staleDirsDeleted;
}

/**
 * Delete incomplete .tmp files for a given item from the album dirs its
 * songs live in. Used by both stalled-download recovery and manual retry to
 * clean up partial transfers without touching fully-downloaded files.
 */
async function cleanupTmpFilesForQueueItem(item: DownloadQueueItem): Promise<void> {
  // Only the directories, straight out of SQL — a `.tmp` sweep never needed the songs.
  const albumIds = new Set(
    (await readDownloadQueueAlbumIdsAsync(item.queueId)).map((id) => id || UNKNOWN_ALBUM_ID),
  );

  for (const albumId of albumIds) {
    const albumDir = new Directory(ensureCacheDir(), albumId);
    if (!albumDir.exists) continue;
    try {
      const entries = await listDirectoryAsync(albumDir.uri);
      for (const name of entries) {
        if (name.endsWith('.tmp')) {
          try { new File(albumDir, name).delete(); } catch { /* best-effort */ }
        }
      }
    } catch { /* best-effort */ }
  }
}

/**
 * Recover any items stuck in 'downloading' status from a previous session.
 * Fully-downloaded songs are preserved (they're already in `cached_songs`
 * and `trackUriMap`); only `.tmp` remnants are deleted.
 */
export async function recoverStalledDownloadsAsync(
  includeErrors = false,
): Promise<void> {
  if (isProcessing) return;

  const { downloadQueue } = musicCacheStore.getState();
  let hasRecoverableItems = false;

  for (const item of downloadQueue) {
    if (item.status === 'downloading' || (includeErrors && item.status === 'error')) {
      await cleanupTmpFilesForQueueItem(item);

      musicCacheStore.getState().updateQueueItem(item.queueId, {
        status: 'queued',
        error: undefined,
      });
      hasRecoverableItems = true;
    }
  }

  if (hasRecoverableItems) {
    processQueue();
  }
}

/**
 * Force-recover the queue regardless of current processing state. Bumps the
 * generation counter so active workers exit at their next check.
 */
export async function forceRecoverDownloadsAsync(): Promise<void> {
  processingId++;
  isProcessing = false;
  await recoverStalledDownloadsAsync(true);
}

/* ------------------------------------------------------------------ */
/*  Cache lookup (synchronous)                                         */
/* ------------------------------------------------------------------ */

/**
 * Returns the local file:// URI for a cached song, or null if it's not
 * downloaded. O(1) via the in-memory map.
 */
export function getLocalTrackUri(trackId: string): string | null {
  if (!trackId) return null;
  const mapped = trackUriMap.get(trackId);
  if (mapped) return mapped;

  // The in-memory map can be transiently empty or stale — `populateTrackMapsAsync`
  // clears then rebuilds it (e.g. during a startup/resume reconcile), and a play
  // that lands in that window would otherwise miss a genuinely-downloaded song and
  // let the player fall back to a server stream URL, which stalls AVPlayer forever
  // on an unreachable server. `cachedSongs` is the authoritative, persisted record
  // of what's downloaded (and the very source the map is built from), so derive the
  // local file URI from it directly and backfill the map. Guarantees a downloaded
  // track always plays from disk, whether or not offline mode is on.
  const song = musicCacheStore.getState().cachedSongs[trackId];
  if (!song) return null;
  const uri = resolveSongFile(song).uri;
  trackUriMap.set(trackId, uri);
  return uri;
}

/** Check whether an album / playlist / favorites / song item is cached. */
export function isItemCached(itemId: string): boolean {
  return itemId in musicCacheStore.getState().cachedItems;
}

/**
 * Check if a track is in any queued / downloading queue item.
 *
 * One indexed point lookup. It reads SYNCHRONOUSLY because `useDownloadStatus` calls
 * it from inside a zustand selector, which cannot await — and the alternative, holding
 * every queued song id in memory, is the exact cost this table exists to remove
 * (`fullLibraryDownloadService` queues one row per album in the library).
 *
 * A queue row whose songs Migration 39 has not converted yet answers `null`: the badge
 * is missing until the chain runs, which it does on the splash before any song row
 * renders. A missing badge, never a wrong download.
 */
export function getTrackQueueStatus(trackId: string): 'queued' | 'downloading' | null {
  return readQueuedSongStatus(trackId);
}

/* ------------------------------------------------------------------ */
/*  Enqueue downloads                                                  */
/* ------------------------------------------------------------------ */

/** Enqueue an album download. */
/**
 * Cache an item's cover source before its audio binaries so a downloaded item
 * renders offline even if the audio transfer is interrupted. `awaitCover: false`
 * (the bulk "download full library" path) fetches it fire-and-forget instead —
 * the image queue downloads covers in parallel and they're purge-protected, so
 * we don't serialize the per-album queueing loop on a (possibly slow) cover.
 */
async function ensureCoverBeforeBinary(
  coverId: string | undefined,
  awaitCover: boolean,
): Promise<void> {
  if (!coverId) return;
  if (awaitCover) {
    try {
      await ensureCached(coverId);
    } catch {
      /* best-effort */
    }
  } else {
    ensureCached(coverId).catch(() => {
      /* best-effort */
    });
  }
}

export async function enqueueAlbumDownload(
  albumId: string,
  opts?: { awaitCover?: boolean },
): Promise<void> {
  const awaitCover = opts?.awaitCover !== false;
  const state = musicCacheStore.getState();
  const existing = state.cachedItems[albumId];
  if (state.downloadQueue.some((q) => q.itemId === albumId)) return;

  const isTopUp = existing !== undefined;
  if (!isTopUp) {
    onAlbumReferencedHook?.(albumId);
  }

  await ensureCoverArtAuth();
  const album = await fetchAlbumDetail(albumId, { force: true });
  if (!album?.song?.length) {
    if (isTopUp) {
      processingOverlayStore.getState().showError(i18n.t('failedToLoadAlbum'));
    }
    return;
  }

  // Re-check after the awaits: a concurrent enqueue (e.g. a double-tap) may
  // have queued this album while we were fetching — avoid a duplicate row.
  if (musicCacheStore.getState().downloadQueue.some((q) => q.itemId === albumId)) return;

  if (isTopUp) {
    // Top-up: download only the songs that aren't already edged to this
    // album. If the server-side album grew, the new `expectedSongCount`
    // captures that; if it shrank, we still download whatever the server
    // currently reports and the stale `expectedSongCount` self-corrects
    // on merge via `markItemComplete`.
    const haveIds = new Set(existing.songIds);
    const missingSongs = album.song.filter((s) => s.id && !haveIds.has(s.id));

    // We just fetched a fresh album — carry its metadata into the row, reduced
    // to the same `cached_albums` scalars the primary download path stores so
    // the two writers can't diverge (see the plan's §2.3 decision).
    const albumMeta = albumMetaFromAlbumID3(album);

    if (missingSongs.length === 0) {
      // No missing songs — refresh `expectedSongCount` so the defensive
      // partial classification self-corrects and return. `derived: false`
      // upgrades a partial row that reached full count via favorites/playlist
      // into a real, explicit album download (overrides the spread's stale flag).
      musicCacheStore.getState().upsertCachedItem({
        ...existing,
        expectedSongCount: album.song.length,
        albumMeta,
        derived: false,
      });
      return;
    }

    // Refresh `expectedSongCount` on the existing row with the fresh server
    // total BEFORE enqueueing. The top-up queue row's payload is only the
    // missing delta, so the worker's derived count would be
    // wrong — `markItemComplete` preserves this existing value on merge.
    // Written unconditionally: the fresh metadata and the derived→real upgrade
    // both belong on the row, and this runs once per explicit album top-up.
    musicCacheStore.getState().upsertCachedItem({
      ...existing,
      expectedSongCount: album.song.length,
      albumMeta,
      // Explicit album download — upgrade a possibly-derived partial to real.
      derived: false,
    });

    // Cover art keys off the album's `coverArt` value, never the entity ID
    // (see src/utils/coverArtId.ts) — so the warmed/stored key matches what
    // the grid renders and resolves on OpenSubsonic servers.
    const topUpCover = coverArtForAlbum(album);
    await ensureCoverBeforeBinary(topUpCover, awaitCover);
    void cacheSongCovers(missingSongs);

    musicCacheStore.getState().enqueueTopUp(
      {
        itemId: albumId,
        type: 'album',
        name: album.name,
        artist: album.artist ?? album.displayArtist,
        coverArtId: topUpCover,
        totalSongs: missingSongs.length,
      },
      missingSongs,
    );

    processQueue();
    return;
  }

  const albumCover = coverArtForAlbum(album);
  await ensureCoverBeforeBinary(albumCover, awaitCover);
  void cacheSongCovers(album.song ?? []);

  musicCacheStore.getState().enqueue(
    {
      itemId: albumId,
      type: 'album',
      name: album.name,
      artist: album.artist ?? album.displayArtist,
      coverArtId: albumCover,
      totalSongs: album.song.length,
    },
    album.song,
  );

  processQueue();
}

/** Enqueue a playlist download. */
export async function enqueuePlaylistDownload(
  playlistId: string,
  opts?: { awaitCover?: boolean },
): Promise<void> {
  const awaitCover = opts?.awaitCover !== false;
  const state = musicCacheStore.getState();
  if (playlistId in state.cachedItems) return;
  if (state.downloadQueue.some((q) => q.itemId === playlistId)) return;

  await ensureCoverArtAuth();
  const playlist = await fetchPlaylistDetail(playlistId, { force: true });
  if (!playlist?.entry?.length) return;

  // Re-check after the awaits (see enqueueAlbumDownload) — avoid a duplicate row.
  if (musicCacheStore.getState().downloadQueue.some((q) => q.itemId === playlistId)) return;

  // Cover art keys off the playlist's `coverArt` value (see coverArtId.ts).
  const playlistCover = coverArtForPlaylist(playlist);
  await ensureCoverBeforeBinary(playlistCover, awaitCover);
  void cacheSongCovers(playlist.entry ?? []);

  musicCacheStore.getState().enqueue(
    {
      itemId: playlistId,
      type: 'playlist',
      name: playlist.name,
      coverArtId: playlistCover,
      totalSongs: playlist.entry.length,
    },
    playlist.entry,
  );

  processQueue();
}

/**
 * Enqueue a single-song download. Introduced in v2.
 *
 * The itemId is `song:{songId}` — a deterministic synthetic id so the same
 * song can't be double-enqueued. The song's underlying file still lands
 * under its parent album directory, allowing later album downloads to
 * dedupe against it.
 */
export async function enqueueSongDownload(song: Child): Promise<void> {
  if (!song?.id) return;
  const itemId = `song:${song.id}`;
  if (itemId in musicCacheStore.getState().cachedItems) return;
  if (musicCacheStore.getState().downloadQueue.some((q) => q.itemId === itemId)) return;

  await ensureCoverArtAuth();

  // Metadata-before-binary: ensure the song's PARENT ALBUM detail + the song's
  // cover art are cached up front, so the album this song belongs to is fully
  // available offline even if the binary is interrupted. Only fetch when the
  // detail isn't already cached (mirrors the backfill's `missing` mode) — this
  // avoids a redundant round-trip when the album was already downloaded or the
  // song is being re-added. Best-effort. This is the download-side half of the
  // "downloads carry their own metadata" invariant.
  if (song.albumId) {
    const db = getDb();
    const parentHasDetail = db ? (await albumIdsWithSongs(db, [song.albumId])).has(song.albumId) : false;
    if (!parentHasDetail) {
      try {
        await fetchAlbumDetail(song.albumId, { prefetchCovers: true });
      } catch { /* best-effort — parent album detail is a bonus for the song */ }
    }
  }
  // Both covers (its own and its album's) before the binary.
  await cacheSongCovers([song]);
  const songCover = (
    await resolveDisplayImage(song, 600, { offline: offlineModeStore.getState().offlineMode })
  ).coverArtId;

  const state = musicCacheStore.getState();
  // If the underlying song is already fully cached, don't transfer bytes —
  // just create the `song:` item + edge so it shows up in the browser, and
  // refresh the promoted metadata with whatever the caller supplied. The real
  // `Child` goes along, so the `cached_song_*` mirrors are rebuilt too.
  if (song.id in state.cachedSongs && cachedFileMatchesSetting(state.cachedSongs[song.id], song)) {
    const existing = state.cachedSongs[song.id];
    musicCacheStore.getState().upsertCachedSong(
      { ...existing, ...promotedSongFieldsFromChild(song) },
      song,
    );
    musicCacheStore.getState().upsertCachedItem(
      {
        itemId,
        type: 'song',
        name: song.title ?? existing.title,
        artist: song.artist ?? existing.artist,
        coverArtId: songCover,
        expectedSongCount: 1,
        parentAlbumId: song.albumId ?? existing.albumId,
        lastSyncAt: Date.now(),
        downloadedAt: Date.now(),
        // Explicit individual-song download — a real holder.
        derived: false,
      },
      [song.id],
    );
    insertCachedItemSong(itemId, 1, song.id);
    registerTrackToItem(song.id, itemId);
    return;
  }

  // Re-check after the awaits (see enqueueAlbumDownload) — avoid a duplicate row.
  if (musicCacheStore.getState().downloadQueue.some((q) => q.itemId === itemId)) return;

  musicCacheStore.getState().enqueue(
    {
      itemId,
      type: 'song',
      name: song.title ?? 'Unknown',
      artist: song.artist,
      coverArtId: songCover,
      totalSongs: 1,
    },
    [song],
  );

  processQueue();
}

/* ------------------------------------------------------------------ */
/*  Queue processing                                                   */
/* ------------------------------------------------------------------ */

/** Downloads are network work: offline mode parks the queue rather than burning
 *  retries against a server the user has told us not to talk to. */
function isPausedForOffline(): boolean {
  return offlineModeStore.getState().offlineMode;
}

async function processQueue(): Promise<void> {
  if (isPausedForOffline()) return;
  if (isProcessing) return;
  isProcessing = true;
  const myId = ++processingId;

  try {
    while (true) {
      if (myId !== processingId) return;
      if (checkStorageLimit()) break;

      const { downloadQueue } = musicCacheStore.getState();
      const next = downloadQueue.find((q) => q.status === 'queued');
      if (!next) break;

      // An enqueue publishes the item to the mirror before its songs reach SQL, and
      // `downloadItem` reads the payload from there — so claim the item only once the
      // write it started has landed, or the read finds nothing to download.
      await whenQueuePayloadWritten(next.queueId);
      if (myId !== processingId) return;
      const claimed = musicCacheStore.getState().downloadQueue.find(
        (q) => q.queueId === next.queueId,
      );
      if (claimed?.status !== 'queued') continue;

      musicCacheStore.getState().updateQueueItem(next.queueId, { status: 'downloading' });
      await downloadItem(next, myId);
    }
  } finally {
    if (myId === processingId) {
      isProcessing = false;
    }
  }
}

function registerTrackToItem(songId: string, itemId: string): void {
  let bucket = trackToItems.get(songId);
  if (!bucket) {
    bucket = new Set<string>();
    trackToItems.set(songId, bucket);
  }
  bucket.add(itemId);
}

/**
 * Build the per-type component-row metadata for a `cached_items` row — the
 * Subsonic entity's scalars minus any per-song list. Songs live authoritatively
 * in `cached_songs` + `cached_item_songs`; carrying `AlbumWithSongsID3.song[]`
 * or `PlaylistWithSongs.entry[]` on the parent row would be a stale duplicate.
 *
 * Returns an EMPTY object when the normalized model has no row for the item
 * (first download of an unsynced album, or mid-`forceFullResync` when `albums`
 * has been dropped and is repopulating): callers spread the result, so a write
 * with no metadata leaves the existing component row untouched instead of
 * blanking it with NULLs.
 */
async function buildCachedItemMetadata(
  itemId: string,
  type: CachedItemMeta['type'],
): Promise<Pick<CachedItemMeta, 'albumMeta' | 'playlistMeta'>> {
  const db = getDb();
  if (!db) return {};
  if (type === 'album') {
    // `getAlbumDetail().album` is the AlbumID3 WITHOUT songs (they live in
    // cached_item_songs), exactly the `cached_albums` shape.
    const detail = await getAlbumDetail(db, itemId);
    return detail ? { albumMeta: albumMetaFromAlbumID3(detail.album) } : {};
  }
  if (type === 'playlist') {
    const detail = await getPlaylistDetail(db, itemId);
    return detail ? { playlistMeta: playlistMetaFromPlaylist(detail.playlist) } : {};
  }
  // `favorites` (__starred__) and `song` intents have no per-type metadata.
  return {};
}

/**
 * Ensure a partial-album `cached_items` row + edge exist for songs
 * downloaded from a non-album item. No-op when the triggering item IS the
 * album itself.
 *
 * The authoritative track count is the album's song rows in the normalized model,
 * fetched if absent (we are online — we are downloading). A failed fetch leaves the
 * count unknown rather than blocking: the edge is still stitched in, and the next
 * refresh corrects the count.
 */
async function ensurePartialAlbumEdge(
  triggerItemId: string,
  triggerItemType: DownloadQueueItem['type'],
  song: Child,
): Promise<void> {
  if (!song.albumId) return;
  if (triggerItemType === 'album' && triggerItemId === song.albumId) return;

  const albumId = song.albumId;
  const db = getDb();
  // Authoritative track count = songs the normalized model holds for this album.
  let detail = db ? await getAlbumDetail(db, albumId) : null;
  if (!detail || detail.songs.length === 0) {
    // `prefetchCovers: false` — this is a song-download hot path, so it must not
    // kick off hundreds of cover-art downloads. An album-detail screen visit
    // re-fetches with covers when needed.
    try {
      await fetchAlbumDetail(albumId, { prefetchCovers: false });
    } catch { /* fall through to the unknown-count branch */ }
    if (db) detail = await getAlbumDetail(db, albumId);
  }
  const authoritativeCount = detail && detail.songs.length > 0 ? detail.songs.length : undefined;
  // The album row now exists when the fetch succeeded, so its cover can be cached too.
  void cacheSongCovers([song]);
  const albumCover = detail?.album.coverArt;

  const state = musicCacheStore.getState();
  const existing = state.cachedItems[albumId];

  if (existing) {
    // Refresh expectedSongCount to the authoritative count when we have one. Also
    // fill the component row when the existing one carries no metadata — the
    // component row is the only form now, the conversion having promoted any
    // envelope into it before the store published this row.
    const metadata = existing.albumMeta ? {} : await buildCachedItemMetadata(albumId, 'album');
    const coverChanged = !!albumCover && albumCover !== existing.coverArtId;
    if (
      (authoritativeCount !== undefined && authoritativeCount !== existing.expectedSongCount) ||
      metadata.albumMeta !== undefined ||
      coverChanged
    ) {
      musicCacheStore.getState().upsertCachedItem({
        ...existing,
        expectedSongCount:
          authoritativeCount !== undefined ? authoritativeCount : existing.expectedSongCount,
        ...(coverChanged ? { coverArtId: albumCover } : {}),
        ...metadata,
      });
    }

    // Append this song as a new edge if not already present.
    if (existing.songIds.includes(song.id)) return;
    const nextPosition = existing.songIds.length + 1;
    insertCachedItemSong(albumId, nextPosition, song.id);
    registerTrackToItem(song.id, albumId);
    musicCacheStore.setState((prev) => {
      const prevItem = prev.cachedItems[albumId];
      if (!prevItem) return prev;
      if (prevItem.songIds.includes(song.id)) return prev;
      return {
        cachedItems: {
          ...prev.cachedItems,
          [albumId]: {
            ...prevItem,
            songIds: [...prevItem.songIds, song.id],
          },
        },
      };
    });
    return;
  }

  // Otherwise create a fresh partial-album row.
  const expectedSongCount = authoritativeCount ?? 1;
  const now = Date.now();

  musicCacheStore.getState().upsertCachedItem(
    {
      itemId: albumId,
      type: 'album',
      name: song.album ?? detail?.album.name ?? 'Unknown',
      artist: song.artist ?? detail?.album.artist,
      // An album item shows the album's own cover; the song's only when the album is unknown.
      coverArtId: albumCover ?? song.coverArt,
      expectedSongCount,
      parentAlbumId: undefined,
      lastSyncAt: now,
      downloadedAt: now,
      ...(await buildCachedItemMetadata(albumId, 'album')),
      // Auto-created partial-album grouping — NOT a real download holder. Songs
      // here orphan when their last real holder (playlist/favorites/song/full
      // album) is removed; this row is pruned once empty.
      derived: true,
    },
    [song.id],
  );
  insertCachedItemSong(albumId, 1, song.id);
  registerTrackToItem(song.id, albumId);
}

/**
 * Download all songs for a single queue item using a concurrency pool.
 *
 * v2 flow:
 *   - Pre-scan: skip songs that are already in `cached_songs` (deduplication
 *     across items — e.g. a playlist whose song is already in a cached
 *     album). For each such song, still record an edge to the current item.
 *   - Download: for each remaining song, transfer to
 *     `{music-cache}/{albumId}/{songId}.{ext}.tmp`, move to final,
 *     upsert the song row, and register an edge for this item.
 *   - Partial-album bookkeeping: for every newly downloaded song, ensure
 *     there's also an edge from the song's parent album (so the file is
 *     reachable as a partial album in the browser when the triggering item
 *     is a playlist / favorites / song).
 */
async function downloadItem(queueItem: DownloadQueueItem, myId: number): Promise<void> {
  const { maxConcurrentDownloads } = musicCacheStore.getState();

  const songs = await readDownloadQueueSongsAsync(queueItem.queueId);
  // An item with nothing to download is NOT a completed one. Without this the
  // all-covered test below reads `0 === 0` and finalises the item, silently
  // discarding a queued download — the failure the row-backed payload is gated
  // against, reachable here through any read that comes back empty.
  if (songs.length === 0) {
    musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
      status: 'error',
      error: 'Failed to read songs',
    });
    return;
  }

  // Ordered list of (position, songId) pairs to commit at markItemComplete.
  const itemEdges: Array<{ position: number; songId: string }> = [];
  // Accumulated song metadata to upsert at markItemComplete.
  const itemSongsForCommit = new Map<string, CachedSongMeta>();
  // The real server `Child` behind each row this run actually downloaded — the
  // only thing that rebuilds the `cached_song_*` mirrors. Pre-scanned songs
  // commit an in-memory row instead and are deliberately absent, so their
  // mirrors are left as the download that created them wrote them.
  const childBySongId = new Map<string, Child>();

  const seen = new Set<string>();
  let trackIndex = 0;
  let completedCount = 0;

  // Pre-scan: for every song, check the pool + what's been downloaded in
  // this run. Songs already in `cached_songs` are counted immediately.
  // (This pre-scan is authoritative — the worker loop skips these.)
  const preScannedSongs = new Set<string>();
  const state0 = musicCacheStore.getState();
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const position = i + 1;
    if (seen.has(song.id)) {
      // Duplicate entry in same item. Still allocate an edge position.
      itemEdges.push({ position, songId: song.id });
      preScannedSongs.add(`${i}`);
      completedCount++;
      continue;
    }
    seen.add(song.id);
    const existing = state0.cachedSongs[song.id];
    if (existing && cachedFileMatchesSetting(existing, song)) {
      preScannedSongs.add(`${i}`);
      itemEdges.push({ position, songId: song.id });
      itemSongsForCommit.set(song.id, existing);
      completedCount++;
    }
  }

  if (completedCount > 0) {
    musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
      completedSongs: completedCount,
    });
  }

  const downloadNext = async (): Promise<void> => {
    while (trackIndex < songs.length) {
      if (myId !== processingId) return;

      const current = musicCacheStore.getState().downloadQueue.find(
        (q) => q.queueId === queueItem.queueId,
      );
      if (!current || current.status !== 'downloading') return;

      if (checkStorageLimit() || isPausedForOffline()) {
        musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
          status: 'queued',
        });
        return;
      }

      const idx = trackIndex++;
      const song = songs[idx];
      const position = idx + 1;

      // Pre-scanned (existing or duplicate) — nothing to transfer.
      if (preScannedSongs.has(`${idx}`)) continue;

      try {
        let result = await downloadSong(song);
        if (!result) result = await downloadSong(song);
        if (result) {
          itemSongsForCommit.set(song.id, result);
          // Membership comes from the loop's source `song`, not from `result` —
          // `downloadSong` early-returns the in-memory row for an id that got
          // cached in the meantime, and this queue entry is still a real `Child`.
          childBySongId.set(song.id, song);
          itemEdges.push({ position, songId: song.id });
          trackUriMap.set(song.id, resolveSongFile(result).uri);

          // Also ensure the partial-album edge (for non-album items).
          await ensurePartialAlbumEdge(queueItem.itemId, queueItem.type, song);

          musicCacheStore.getState().addBytes(result.bytes);
          musicCacheStore.getState().addFiles(1);
          completedCount++;
        }
      } catch {
        /* individual song failure — continue with the rest */
      }

      musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
        completedSongs: completedCount,
      });
    }
  };

  const workers = Array.from(
    { length: Math.min(maxConcurrentDownloads, Math.max(songs.length, 1)) },
    () => downloadNext(),
  );
  await Promise.all(workers);

  const finalState = musicCacheStore.getState().downloadQueue.find(
    (q) => q.queueId === queueItem.queueId,
  );
  if (!finalState) {
    return; // queue item was cancelled or finalised elsewhere
  }

  const uniqueSongIds = new Set(itemEdges.map((e) => e.songId));

  if (uniqueSongIds.size === new Set(songs.map((s) => s.id)).size) {
    // All unique songs covered — finalise the item.
    const cachedItem: Omit<CachedItemMeta, 'songIds'> = {
      itemId: queueItem.itemId,
      type: queueItem.type,
      name: queueItem.name,
      artist: queueItem.artist,
      coverArtId: queueItem.coverArtId,
      expectedSongCount: songs.length,
      parentAlbumId: queueItem.type === 'song' ? songs[0]?.albumId : undefined,
      lastSyncAt: Date.now(),
      downloadedAt: Date.now(),
      ...(await buildCachedItemMetadata(queueItem.itemId, queueItem.type)),
    };
    const songsToCommit = Array.from(itemSongsForCommit.values());
    const edgesForCommit = itemEdges.map((e) => ({
      songId: e.songId,
      position: e.position,
    }));
    musicCacheStore.getState().markItemComplete(
      queueItem.queueId,
      cachedItem,
      songsToCommit,
      edgesForCommit,
      childBySongId,
    );

    for (const e of edgesForCommit) {
      registerTrackToItem(e.songId, queueItem.itemId);
    }
  } else {
    musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
      status: 'error',
      error: `Downloaded ${uniqueSongIds.size} of ${new Set(songs.map((s) => s.id)).size} songs`,
      completedSongs: completedCount,
    });
  }
}

/**
 * Download a single song to disk. v2 path: dedup check before transfer.
 *
 *   1. If already in `cached_songs`, return the existing metadata — caller
 *      will still record a new edge for its item.
 *   2. Otherwise, download to tmp, move to final, compose metadata.
 *
 * Retry-once (for the transient "null from getDownloadStreamUrl") happens
 * in the caller.
 */
async function downloadSong(track: Child): Promise<CachedSongMeta | null> {
  const existing = musicCacheStore.getState().cachedSongs[track.id];
  if (existing && cachedFileMatchesSetting(existing, track)) return existing;

  await ensureCoverArtAuth();

  const url = getDownloadStreamUrl(track.id);
  if (!url) return null;

  const { downloadFormat, downloadMaxBitRate } = playbackSettingsStore.getState();

  const ext = getTrackFileExtension(track);
  const albumId = track.albumId || UNKNOWN_ALBUM_ID;
  const albumDir = ensureAlbumDir(albumId);

  const fileName = `${track.id}.${ext}`;
  const tmpName = `${fileName}.tmp`;

  try {
    beginDownload(track.id);
    const tmpDest = new File(albumDir, tmpName);
    await downloadFileAsyncWithProgress(url, tmpDest.uri, track.id);

    const dest = new File(albumDir, fileName);
    if (dest.exists) {
      try { dest.delete(); } catch { /* best-effort */ }
    }
    await tmpDest.move(dest);

    // Remove the old-format file this download replaced.
    if (existing && existing.suffix !== ext) {
      const stale = resolveSongFile(existing);
      if (stale.exists && stale.uri !== dest.uri) {
        try { stale.delete(); } catch { /* best-effort */ }
      }
    }

    const bytes = dest.exists ? dest.size ?? 0 : 0;

    clearDownload(track.id);

    // Capture effective format so consumers (effectiveFormat.ts) can read
    // transcoded bitrate / post-transcode suffix from the song row.
    const effectiveFmt = resolveEffectiveFormat({
      sourceSuffix: track.suffix,
      sourceBitRate: track.bitRate,
      sourceBitDepth: track.bitDepth,
      sourceSamplingRate: track.samplingRate,
      formatSetting: downloadFormat,
      bitRateSetting: downloadMaxBitRate,
    });

    const now = Date.now();
    const meta: CachedSongMeta = {
      id: track.id,
      title: track.title ?? 'Unknown',
      artist: track.artist ?? i18n.t('unknownArtist'),
      album: track.album,
      albumId,
      coverArt: track.coverArt,
      bytes,
      duration: track.duration ?? 0,
      suffix: ext,
      bitRate: effectiveFmt.bitRate,
      bitDepth: effectiveFmt.bitDepth,
      samplingRate: effectiveFmt.samplingRate,
      formatCapturedAt: effectiveFmt.capturedAt,
      downloadedAt: now,
      // The server's `Child` promoted into typed columns alongside the file
      // facts above — discNumber, track, genre, MusicBrainz id, ReplayGain,
      // explicitStatus, and the `src_*` pairs for the five whose names here
      // describe the DOWNLOADED file rather than the source.
      ...promotedSongFieldsFromChild(track),
    };

    // Upsert to the pool immediately so subsequent dedup checks within this
    // same item (e.g. playlist with the song twice) short-circuit cleanly.
    // `track` comes along so the `cached_song_*` mirrors (genres, artists,
    // albumArtists, contributors, moods) are rebuilt from the real `Child`.
    musicCacheStore.getState().upsertCachedSong(meta, track);

    return meta;
  } catch {
    clearDownload(track.id);
    const tmpFile = new File(albumDir, tmpName);
    if (tmpFile.exists) {
      try { tmpFile.delete(); } catch { /* best-effort */ }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Retry / redownload                                                 */
/* ------------------------------------------------------------------ */

/** Retry a failed queue item. */
export async function retryDownload(queueId: string): Promise<void> {
  const item = musicCacheStore.getState().downloadQueue.find(
    (q) => q.queueId === queueId,
  );
  if (!item || item.status !== 'error') return;

  await cleanupTmpFilesForQueueItem(item);

  musicCacheStore.getState().updateQueueItem(queueId, {
    status: 'queued',
    error: undefined,
  });

  const queue = musicCacheStore.getState().downloadQueue;
  const fromIdx = queue.findIndex((q) => q.queueId === queueId);
  const lastNonErrorIdx = queue.reduce(
    (last, q, i) => (q.status !== 'error' ? i : last),
    -1,
  );
  if (fromIdx >= 0 && lastNonErrorIdx >= 0 && fromIdx !== lastNonErrorIdx) {
    musicCacheStore.getState().reorderQueue(fromIdx, lastNonErrorIdx);
  }

  processQueue();
}

/** Re-download an entire cached item with current settings. */
export async function redownloadItem(itemId: string): Promise<void> {
  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (!cached) return;

  deleteCachedItem(itemId);

  if (cached.type === 'album') {
    await enqueueAlbumDownload(itemId);
  } else if (cached.type === 'playlist' || cached.type === 'favorites') {
    if (itemId === STARRED_SONGS_ITEM_ID) {
      await enqueueStarredSongsDownload();
    } else {
      await enqueuePlaylistDownload(itemId);
    }
  }
  // Single-song items aren't re-downloaded via this entry point — the UI
  // should use enqueueSongDownload(song) directly.
}

/**
 * Re-download a single track within a cached item. Preserved from v1 for
 * backwards compatibility with the music-cache-browser swipe action.
 *
 * v2 semantics: deletes the file, re-downloads, updates the `cached_songs`
 * row (and therefore every item referencing the song). The item itself is
 * unchanged structurally.
 */
export async function redownloadTrack(
  itemId: string,
  trackId: string,
): Promise<boolean> {
  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (!cached) return false;

  const trackIndex = cached.songIds.indexOf(trackId);
  if (trackIndex === -1) return false;

  const existingSong = musicCacheStore.getState().cachedSongs[trackId];
  if (!existingSong) return false;

  // Resolve the existing file but DON'T delete it yet — download the new copy
  // to a .tmp first and swap atomically, so a failed/partial redownload leaves
  // the existing working file (and its trackUriMap entry) intact.
  const oldFile = resolveSongFile(existingSong);

  await ensureCoverArtAuth();
  const url = getDownloadStreamUrl(trackId);
  if (!url) return false;

  const { downloadFormat, downloadMaxBitRate } = playbackSettingsStore.getState();
  const ext = downloadFormat !== 'raw' ? downloadFormat : existingSong.suffix;
  const fileName = `${trackId}.${ext}`;
  const albumDir = ensureAlbumDir(existingSong.albumId);

  try {
    const dest = new File(albumDir, fileName);
    const tmp = new File(albumDir, `${fileName}.tmp`);
    if (tmp.exists) {
      try { tmp.delete(); } catch { /* best-effort */ }
    }
    await File.downloadFileAsync(url, tmp);
    const bytes = tmp.exists ? tmp.size ?? 0 : 0;
    if (bytes === 0) {
      // Empty/failed download — discard the tmp and keep the existing file.
      try { tmp.delete(); } catch { /* best-effort */ }
      return false;
    }

    // Download succeeded — swap in the new file. The old file's extension may
    // differ from the new one, so delete it explicitly, then move tmp → dest.
    if (oldFile.exists && oldFile.uri !== dest.uri) {
      try { oldFile.delete(); } catch { /* best-effort */ }
    }
    if (dest.exists) {
      try { dest.delete(); } catch { /* best-effort */ }
    }
    await tmp.move(dest);
    trackUriMap.delete(trackId);

    const effectiveFmt = resolveEffectiveFormat({
      sourceSuffix: existingSong.suffix,
      sourceBitRate: null,
      formatSetting: downloadFormat,
      bitRateSetting: downloadMaxBitRate,
    });

    const now = Date.now();
    const updated: CachedSongMeta = {
      ...existingSong,
      suffix: ext,
      bytes,
      bitRate: effectiveFmt.bitRate,
      bitDepth: effectiveFmt.bitDepth,
      samplingRate: effectiveFmt.samplingRate,
      formatCapturedAt: effectiveFmt.capturedAt,
      downloadedAt: now,
    };

    trackUriMap.set(trackId, dest.uri);
    // No `Child` — this rewrites the FILE facts from an in-memory row. The
    // promoted metadata columns survive via the upsert's COALESCE and the
    // `cached_song_*` mirrors are left alone; rebuilding them from a row that
    // only carries the `genres` projection would empty the other four.
    musicCacheStore.getState().upsertCachedSong(updated);

    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Cache management                                                   */
/* ------------------------------------------------------------------ */

/** Delete a cached item + any songs whose refcount drops to zero. */
export async function deleteCachedItem(itemId: string): Promise<void> {
  if (!itemId) return;

  const state = musicCacheStore.getState();
  const cached = state.cachedItems[itemId];
  if (!cached) {
    // Might be a queue-only item; no-op here, cancelDownload handles that.
    return;
  }

  // Snapshot metadata BEFORE the store removes the song rows.
  const affectedSongs: CachedSongMeta[] = [];
  for (const sid of cached.songIds) {
    const s = state.cachedSongs[sid];
    if (s) affectedSongs.push(s);
  }

  // Store action deletes edges (via FK cascade) + orphaned song rows.
  const orphanedIds = await musicCacheStore.getState().removeCachedItem(itemId);
  const orphanSet = new Set(orphanedIds);

  // Clean up trackToItems for every song that was referenced by this item.
  for (const sid of cached.songIds) {
    trackToItems.get(sid)?.delete(itemId);
    if (orphanSet.has(sid)) {
      trackToItems.delete(sid);
      trackUriMap.delete(sid);
    }
  }

  // Delete files for orphaned songs OFF-THREAD. Use the snapshotted metadata
  // to resolve paths since the store has already removed them. No sync
  // `.exists` gate — deleteFileAsync no-ops on a missing path (mirrors the
  // reconcile path's off-thread deletes). The store mutations above already
  // ran synchronously, so the download-status UI updates the instant the user
  // taps; only the unlinks are deferred.
  const deletions: Promise<unknown>[] = [];
  for (const song of affectedSongs) {
    if (!orphanSet.has(song.id)) continue;
    deletions.push(
      deleteFileAsync(resolveSongFile(song).uri).catch(() => { /* best-effort */ }),
    );
  }

  // Best-effort cleanup of empty album directories. Only attempt for album
  // dirs that contained at least one orphaned song.
  const affectedAlbumDirs = new Set<string>();
  for (const song of affectedSongs) {
    if (orphanSet.has(song.id)) {
      affectedAlbumDirs.add(song.albumId || UNKNOWN_ALBUM_ID);
    }
  }
  const albumsRoot = ensureCacheDir();
  for (const albumId of affectedAlbumDirs) {
    // Only remove if no remaining song references this album_id.
    const postState = musicCacheStore.getState();
    const anyReference = Object.values(postState.cachedSongs).some(
      (s) => (s.albumId || UNKNOWN_ALBUM_ID) === albumId,
    );
    if (anyReference) continue;
    // deleteDirectoryAsync is recursive + cross-platform, matching the old
    // sync `Directory.delete()`; it no-ops if the dir is already gone.
    deletions.push(
      deleteDirectoryAsync(new Directory(albumsRoot, albumId).uri).catch(() => {
        /* best-effort */
      }),
    );
  }

  // Re-check the storage limit only AFTER the unlinks have freed space, so a
  // download paused for low space resumes — same ordering the sync deletes had.
  void Promise.all(deletions).then(() => resumeIfSpaceAvailable());
}

/**
 * Inspect what would happen if the user removed this album: which songs
 * would be orphaned (deleted from disk) and how many would survive because
 * they're referenced by other items (playlists, favorites, single-song
 * downloads). Survivors > 0 means the caller should confirm with the user
 * before proceeding.
 */
export async function computeAlbumRemovalOutcome(
  itemId: string,
): Promise<{ orphanSongIds: string[]; survivorCount: number }> {
  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (!cached || cached.type !== 'album') {
    return { orphanSongIds: [], survivorCount: 0 };
  }
  const realRefs = await countRealSongRefsForSongsAsync(cached.songIds);
  const orphanSongIds: string[] = [];
  let survivorCount = 0;
  for (const sid of cached.songIds) {
    // Only REAL holders keep a song; the album being removed is `derived=0` and
    // counts, so `<= 1` means "held only by this album" → would orphan. A song
    // missing from the Map has zero real holders.
    if ((realRefs.get(sid) ?? 0) <= 1) {
      orphanSongIds.push(sid);
    } else {
      survivorCount++;
    }
  }
  return { orphanSongIds, survivorCount };
}

/**
 * Remove orphaned songs from an album while preserving the `cached_items`
 * row itself when any song survives (because it's referenced by another
 * item). The surviving songs keep their album edge, so the album naturally
 * shows as partially downloaded afterward — with its original `downloadedAt`
 * intact. If no songs survive, falls through to `deleteCachedItem`.
 */
export async function demoteAlbumToPartial(
  itemId: string,
): Promise<{ demoted: boolean; removed: boolean }> {
  const initial = musicCacheStore.getState().cachedItems[itemId];
  if (!initial || initial.type !== 'album') {
    return { demoted: false, removed: false };
  }

  const { orphanSongIds } = await computeAlbumRemovalOutcome(itemId);

  if (orphanSongIds.length === initial.songIds.length) {
    // No survivors — full delete is the right outcome.
    await deleteCachedItem(itemId);
    return { demoted: false, removed: true };
  }
  if (orphanSongIds.length === 0) {
    // Nothing to remove (shouldn't happen for a "remove album" flow — the
    // caller should have confirmed survivors > 0 first — but be defensive).
    return { demoted: false, removed: false };
  }

  // Snapshot song metadata for file deletion BEFORE the store removes rows.
  const orphanSnapshot: CachedSongMeta[] = [];
  for (const sid of orphanSongIds) {
    const s = musicCacheStore.getState().cachedSongs[sid];
    if (s) orphanSnapshot.push(s);
  }

  // Remove each orphan edge. Positions shift after each removal, so we
  // re-read the current index every iteration.
  for (const songId of orphanSongIds) {
    const current = musicCacheStore.getState().cachedItems[itemId];
    if (!current) break;
    const idx = current.songIds.indexOf(songId);
    if (idx < 0) continue;
    // eslint-disable-next-line no-await-in-loop
    await musicCacheStore.getState().removeCachedItemSong(itemId, idx + 1);
    // `removeCachedItemSong` has already deleted the cached_songs row and
    // decremented refcount-via-COUNT. Update the in-memory mirrors.
    trackToItems.delete(songId);
    trackUriMap.delete(songId);
  }

  // The album is now a PARTIAL grouping: every surviving song is — by the
  // survivor definition (more than one REAL holder) — also held by another REAL
  // holder (a playlist/favorites/song download). Flip the album to `derived` so
  // it no longer independently keeps those songs alive: when their last real
  // holder is removed they orphan and this row is pruned. Without this, removing
  // that playlist/favorites later would leave the album's shared song downloaded
  // and the album stuck in the partial state.
  const demotedRow = musicCacheStore.getState().cachedItems[itemId];
  if (demotedRow) {
    musicCacheStore.getState().upsertCachedItem({ ...demotedRow, derived: true });
  }

  // Delete orphan files OFF-THREAD (best-effort), then re-check the storage
  // limit once the unlinks have freed space — same ordering as the prior
  // sync deletes → resume.
  const deletions = orphanSnapshot.map((song) =>
    deleteFileAsync(resolveSongFile(song).uri).catch(() => { /* best-effort */ }),
  );
  void Promise.all(deletions).then(() => resumeIfSpaceAvailable());
  return { demoted: true, removed: false };
}

/**
 * Remove a single song from a cached playlist/favorites/song item. Deletes
 * the underlying file iff the song's refcount hits zero.
 */
export async function removeCachedPlaylistTrack(itemId: string, trackIndex: number): Promise<void> {
  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (!cached) return;
  // Preserve v1 guard: only operate on playlist-ish items.
  if (cached.type !== 'playlist' && cached.type !== 'favorites') return;
  if (trackIndex < 0 || trackIndex >= cached.songIds.length) return;

  const songId = cached.songIds[trackIndex];
  const song = musicCacheStore.getState().cachedSongs[songId];

  const { orphanedSongId } = await musicCacheStore.getState().removeCachedItemSong(
    itemId,
    trackIndex + 1, // SQL positions are 1-indexed
  );

  trackToItems.get(songId)?.delete(itemId);

  if (orphanedSongId && song) {
    trackToItems.delete(orphanedSongId);
    trackUriMap.delete(orphanedSongId);
    void deleteFileAsync(resolveSongFile(song).uri).catch(() => { /* best-effort */ });
  }
}

/**
 * Remove a single song from a downloaded album, reverting the album to a
 * partial download. Deletes the underlying file iff the song's refcount hits
 * zero (it isn't also referenced by a playlist / favorites / single-song
 * download). If the song was the album's last remaining track, the whole
 * `cached_items` row is removed instead. Returns true when something changed.
 */
export async function removeCachedAlbumSong(albumItemId: string, songId: string): Promise<boolean> {
  const cached = musicCacheStore.getState().cachedItems[albumItemId];
  if (!cached || cached.type !== 'album') return false;
  const idx = cached.songIds.indexOf(songId);
  if (idx < 0) return false;

  // Removing the album's last remaining track → drop the album entirely.
  if (cached.songIds.length === 1) {
    await deleteCachedItem(albumItemId);
    return true;
  }

  const song = musicCacheStore.getState().cachedSongs[songId];
  const { orphanedSongId } = await musicCacheStore.getState().removeCachedItemSong(
    albumItemId,
    idx + 1, // SQL positions are 1-indexed
  );
  trackToItems.get(songId)?.delete(albumItemId);
  if (orphanedSongId && song) {
    trackToItems.delete(orphanedSongId);
    trackUriMap.delete(orphanedSongId);
    void deleteFileAsync(resolveSongFile(song).uri).catch(() => { /* best-effort */ });
  }

  resumeIfSpaceAvailable();
  return true;
}

/** Reorder songs within a cached item. No file changes. */
export function reorderCachedPlaylistTracks(
  itemId: string,
  fromIndex: number,
  toIndex: number,
): void {
  musicCacheStore.getState().reorderCachedItemSongs(
    itemId,
    fromIndex + 1,
    toIndex + 1,
  );
}

/**
 * Sync a cached playlist's song set to a new ordered list of track ids.
 * Removes songs that are no longer present; reorders remaining songs to
 * match `newTrackIds` order. Orphan files are deleted.
 *
 * REFUSES to prune on an incoming list that is empty, or that shares nothing with
 * what is cached — see {@link pruneWouldBeDestructive}. Pass `allowFullClear` when
 * the emptiness is the user's own edit rather than a suspect server answer.
 */
export async function syncCachedPlaylistTracks(
  playlistId: string,
  newTrackIds: string[],
  opts?: { allowFullClear?: boolean },
): Promise<void> {
  const cached = musicCacheStore.getState().cachedItems[playlistId];
  if (!cached) return;
  if (cached.type !== 'playlist' && cached.type !== 'favorites') return;

  if (!opts?.allowFullClear && pruneWouldBeDestructive(playlistId, cached.songIds, newTrackIds)) {
    return;
  }

  const keepSet = new Set(newTrackIds);

  // Remove songs not in the new list. removeCachedItemSong shifts
  // positions inside the store & SQL, so we must iterate positions
  // from highest to lowest.
  const originalSongIds = [...cached.songIds];
  for (let idx = originalSongIds.length - 1; idx >= 0; idx--) {
    const sid = originalSongIds[idx];
    if (keepSet.has(sid)) continue;
    const song = musicCacheStore.getState().cachedSongs[sid];
    const { orphanedSongId } = await musicCacheStore.getState().removeCachedItemSong(
      playlistId,
      idx + 1,
    );
    trackToItems.get(sid)?.delete(playlistId);
    if (orphanedSongId && song) {
      trackToItems.delete(orphanedSongId);
      trackUriMap.delete(orphanedSongId);
      void deleteFileAsync(resolveSongFile(song).uri).catch(() => { /* best-effort */ });
    }
  }

  // After removals, reorder what remains to match the new order.
  const after = musicCacheStore.getState().cachedItems[playlistId];
  if (!after) return;

  // Build target: only ids that still exist in the item.
  const currentIds = [...after.songIds];
  const currentSet = new Set(currentIds);
  const targetIds = newTrackIds.filter((id) => currentSet.has(id));

  // Compute reorder operations — simple bubble via single-move reorder.
  for (let targetPos = 0; targetPos < targetIds.length; targetPos++) {
    const latest = musicCacheStore.getState().cachedItems[playlistId];
    if (!latest) break;
    const currentPos = latest.songIds.indexOf(targetIds[targetPos]);
    if (currentPos < 0 || currentPos === targetPos) continue;
    musicCacheStore.getState().reorderCachedItemSongs(
      playlistId,
      currentPos + 1,
      targetPos + 1,
    );
  }
}

/**
 * Full sync for a cached item: removes tracks no longer present and re-enqueues
 * through the download queue when new tracks are detected.
 *
 * Additions are NOT spliced into `cachedItems` here — they go through the normal
 * download pipeline, which adds edges to the existing item under the same itemId
 * and lets `markItemComplete` upsert the row and its fresh edges.
 */
/**
 * Would pruning `cached` down to `incoming` destroy downloads on a list we should not
 * trust? Two shapes say yes, and both are seen in practice:
 *
 * - **Empty incoming.** `normalizedLibrarySync` passes `updated.entry ?? []`, so a
 *   response without an `entry` array reads as "the playlist is empty" rather than
 *   "no opinion".
 * - **Zero overlap on a non-empty list.** The cached set and the server's set describe
 *   the same playlist, so disjoint ids mean the ids themselves moved under us — a
 *   server-side id migration, not a playlist someone emptied and refilled.
 *
 * Refusing costs a stale entry until the next sync. Accepting deletes the audio.
 * Mirrors `deleteAlbumSongsNotIn`'s self-consistency check (`db/repository/songs.ts`).
 */
function pruneWouldBeDestructive(
  itemId: string,
  cachedIds: readonly string[],
  incomingIds: readonly string[],
): boolean {
  if (cachedIds.length === 0) return false;
  if (incomingIds.length === 0) {
    logLibrarySync(`prune refused: empty incoming list for ${itemId} (${cachedIds.length} cached)`);
    return true;
  }
  const cachedSet = new Set(cachedIds);
  if (!incomingIds.some((id) => cachedSet.has(id))) {
    logLibrarySync(
      `prune refused: zero overlap for ${itemId} ` +
        `(${cachedIds.length} cached vs ${incomingIds.length} incoming)`,
    );
    return true;
  }
  return false;
}

export function syncCachedItemTracks(
  itemId: string,
  newSongs: Child[],
): void {
  const state = musicCacheStore.getState();
  const cached = state.cachedItems[itemId];
  if (!cached) return;
  if (state.downloadQueue.some((q) => q.itemId === itemId)) return;

  const newTrackIds = newSongs.map((t) => t.id);
  const cachedIdSet = new Set(cached.songIds);

  // Removes + reorders via the playlist sync.
  syncCachedPlaylistTracks(itemId, newTrackIds);

  // Cover-art reconciliation for this offline item only — never the full library.
  // `ensureCached` / `cacheSongCovers` are idempotent: an instant no-op when every
  // variant is on disk, refilling only what is missing (a variant dropped by the
  // reconcileImageCache zero-byte pass, or an OS cache eviction).
  if (cached.coverArtId) {
    ensureCached(cached.coverArtId).catch(() => { /* non-critical */ });
  }
  void cacheSongCovers(newSongs);

  const hasNewTracks = newSongs.some((t) => !cachedIdSet.has(t.id));
  if (!hasNewTracks) return;

  const updated = musicCacheStore.getState().cachedItems[itemId];
  if (!updated) return;

  // Remove the item's in-memory record so enqueue() sees a fresh slot.
  // This mirrors the v1 behaviour (move item from cachedItems to queue
  // without touching totalBytes/totalFiles).
  musicCacheStore.setState((prev) => {
    const { [itemId]: _gone, ...rest } = prev.cachedItems;
    return { cachedItems: rest };
  });

  musicCacheStore.getState().enqueue(
    {
      itemId,
      type: updated.type,
      name: updated.name,
      artist: updated.artist,
      coverArtId: updated.coverArtId,
      totalSongs: newSongs.length,
    },
    newSongs,
  );

  processQueue();
}

/**
 * Cancel a queued or in-progress download and remove its partial files.
 *
 * v2 semantics: if songs completed during this queue item's run exist only
 * because of this item (no other refs), we leave them in the song pool as
 * a partial album — the file is legitimately downloaded, just no user-
 * visible item now references it. The next startup reconciliation or
 * cache-clear will reap them. This is a deliberate softening vs. v1 (which
 * wiped the item dir entirely) — it avoids throwing away work the user's
 * bandwidth paid for, and the partial-album row keeps it reachable.
 */
export async function cancelDownload(queueId: string): Promise<void> {
  const item = musicCacheStore.getState().downloadQueue.find(
    (q) => q.queueId === queueId,
  );
  if (!item) return;

  // The enqueue publishes to the mirror before its rows reach SQL, so a cancel tapped
  // while that write is still parked would read an empty payload and DELETE nothing —
  // and the insert, landing afterwards, would put the cancelled item back for the next
  // hydrate. Resolves immediately when no write is in flight. Same wait, same reason as
  // the worker's claim in `processQueue`.
  await whenQueuePayloadWritten(queueId);

  // Read the ids BEFORE dropping the row: `download_queue_songs` FK-cascades off it,
  // so the delete takes the payload with it. Two columns, not a rebuilt `Child`.
  const songs = await readDownloadQueueSongRefsAsync(queueId);

  musicCacheStore.getState().removeFromQueue(queueId);

  // Group cancelled song ids by album, then sweep each album's .tmp remnants
  // off the JS thread: one directory listing per album + async deletes, rather
  // than a sync exists/delete per song×extension (which was O(songs²) on the
  // JS thread for a large cancelled set). Best-effort and fire-and-forget.
  const songIdsByAlbum = new Map<string, Set<string>>();
  for (const s of songs) {
    if (!s.id) continue;
    const albumId = s.albumId || UNKNOWN_ALBUM_ID;
    let set = songIdsByAlbum.get(albumId);
    if (!set) { set = new Set(); songIdsByAlbum.set(albumId, set); }
    set.add(s.id);
  }
  for (const [albumId, songIds] of songIdsByAlbum) {
    const albumDir = new Directory(ensureCacheDir(), albumId);
    void (async () => {
      let names: string[];
      try {
        const result = await listDirectoryAsync(albumDir.uri);
        names = Array.isArray(result) ? result : [];
      } catch {
        return;
      }
      for (const name of names) {
        if (!name.endsWith('.tmp')) continue;
        // Filename is `${songId}.${ext}.tmp` — delete if it belongs to a
        // cancelled song in this album.
        for (const songId of songIds) {
          if (name.startsWith(`${songId}.`)) {
            void deleteFileAsync(new File(albumDir, name).uri).catch(() => { /* best-effort */ });
            break;
          }
        }
      }
    })();
  }

  // Only clear trackToItems bookkeeping for this cancelled itemId — the
  // song pool stays intact (files either never landed, or are legitimate
  // completed downloads that other items / the partial album still reference).
  for (const s of songs) {
    trackToItems.get(s.id)?.delete(item.itemId);
  }

  scheduleRecalculate();
}

/**
 * Cancel all queued and in-progress downloads, removing partial files.
 * Completed (cached) items are not affected.
 */
export async function clearDownloadQueue(): Promise<void> {
  const queue = [...musicCacheStore.getState().downloadQueue];
  for (const item of queue) {
    // Serial: each cancel reads its payload before dropping the row, and the resume
    // below must not restart an item that is still being cancelled.
    // eslint-disable-next-line no-await-in-loop
    await cancelDownload(item.queueId);
  }
  resumeIfSpaceAvailable();
}

/**
 * Stop the queue without interrupting active transfers: remove every item that
 * hasn't started yet and let anything currently downloading run to completion.
 *
 * Used by the "stop full-library download" control. Aborting an in-flight album
 * mid-transfer is what left albums in a broken "downloaded" state (a row with
 * no/partial songs on disk); letting the active item finish means it commits a
 * clean complete row, and the untouched queued items never created rows at all.
 */
export async function clearQueuedDownloads(): Promise<void> {
  const queue = [...musicCacheStore.getState().downloadQueue];
  for (const item of queue) {
    if (item.status === 'downloading') continue;
    // eslint-disable-next-line no-await-in-loop
    await cancelDownload(item.queueId);
  }
}

/**
 * Delete all cached music and recreate the cache directory. Returns the
 * number of bytes freed.
 */
export async function clearMusicCache(): Promise<number> {
  const dir = ensureCacheDir();
  const freedBytes = await getDirectorySizeAsync(dir.uri);

  // Recursive wipe off the JS thread — the music cache can be many GB /
  // thousands of files; a sync Directory.delete() would freeze the UI (this
  // runs on logout + the clear-cache setting).
  try { await deleteDirectoryAsync(dir.uri); } catch { /* best-effort */ }

  cacheDir = null;
  trackUriMap.clear();
  trackToItems.clear();
  initMusicCache();
  musicCacheStore.getState().reset();

  return freedBytes;
}

/* ------------------------------------------------------------------ */
/*  Cache stats                                                        */
/* ------------------------------------------------------------------ */

export interface MusicCacheStats {
  totalBytes: number;
  itemCount: number;
  totalFiles: number;
}

/**
 * Calculate cache statistics. Walks each top-level album directory
 * ({music-cache}/{albumId}/) using native background threads via
 * expo-async-fs. itemCount here is the number of album directories on
 * disk, NOT the number of cached_items rows (those can include
 * partial/playlist/favorites/song items that all share album dirs).
 */
export async function getMusicCacheStats(): Promise<MusicCacheStats> {
  const dir = ensureCacheDir();
  if (!dir.exists) return { totalBytes: 0, itemCount: 0, totalFiles: 0 };
  const totalBytes = await getDirectorySizeAsync(dir.uri);

  let itemCount = 0;
  let totalFiles = 0;
  try {
    const albumDirNames = await listDirectoryAsync(dir.uri);
    for (const name of albumDirNames) {
      const subDir = new Directory(dir, name);
      if (!subDir.exists) continue;
      itemCount++;
      try {
        const files = await listDirectoryAsync(subDir.uri);
        totalFiles += files.length;
      } catch { /* best-effort */ }
    }
  } catch {
    itemCount = 0;
    totalFiles = 0;
  }

  return { totalBytes, itemCount, totalFiles };
}

/**
 * Re-read every downloaded song's file size from disk and correct `bytes`
 * wherever it differs. One off-thread listing per album directory; a missing
 * file or unreadable directory is skipped. Returns the number of rows corrected.
 */
export async function refreshCachedSongSizes(): Promise<number> {
  const dir = ensureCacheDir();
  const songsByDir = new Map<string, CachedSongMeta[]>();
  for (const song of Object.values(musicCacheStore.getState().cachedSongs)) {
    const albumId = song.albumId || UNKNOWN_ALBUM_ID;
    const list = songsByDir.get(albumId);
    if (list) list.push(song);
    else songsByDir.set(albumId, [song]);
  }

  const updates: CachedSongBytesUpdate[] = [];
  for (const [albumId, songs] of songsByDir) {
    let sizes: Map<string, number>;
    try {
      // Serial: keeps native load flat across thousands of album directories.
      // eslint-disable-next-line no-await-in-loop
      const entries = await listDirectoryWithSizesAsync(new Directory(dir, albumId).uri);
      sizes = new Map(entries.map((e) => [e.name, e.size]));
    } catch {
      continue;
    }
    for (const song of songs) {
      const size = sizes.get(`${song.id}.${song.suffix}`);
      if (size && size !== song.bytes) {
        updates.push({ songId: song.id, bytes: size, prevBytes: song.bytes, suffix: song.suffix });
      }
    }
  }

  if (updates.length > 0) await musicCacheStore.getState().setCachedSongBytes(updates);
  return updates.length;
}

/**
 * Fire-and-forget filesystem recalculate. Used after cancel/clear
 * operations to correct totalBytes/totalFiles that drifted due to
 * addBytes() calls during partial downloads whose files were then deleted.
 */
function scheduleRecalculate(): void {
  getMusicCacheStats()
    .then((stats) =>
      musicCacheStore.getState().recalculate({
        totalBytes: stats.totalBytes,
        totalFiles: stats.totalFiles,
      }),
    )
    .catch(() => { /* non-critical: next app start will reconcile */ });
}

/* ------------------------------------------------------------------ */
/*  Storage limit resume                                               */
/* ------------------------------------------------------------------ */

/** Re-evaluate storage limit and resume the queue if space is available. */
export function resumeIfSpaceAvailable(): void {
  if (!checkStorageLimit()) {
    processQueue();
  }
}

/* ------------------------------------------------------------------ */
/*  Starred songs (virtual playlist)                                   */
/* ------------------------------------------------------------------ */

/** Enqueue all currently starred songs as a virtual playlist. */
export async function enqueueStarredSongsDownload(): Promise<void> {
  const state = musicCacheStore.getState();
  if (STARRED_SONGS_ITEM_ID in state.cachedItems) return;
  if (state.downloadQueue.some((q) => q.itemId === STARRED_SONGS_ITEM_ID)) return;

  const db = getDb();
  const songs = db ? (await listAllStarredSongs(db)).map(starredItemOf) : [];
  if (songs.length === 0) return;

  await ensureCoverArtAuth();
  void cacheSongCovers(songs);

  // Ensure the parent-album detail of each favorited song is cached so the album
  // a favorite belongs to is available offline. Throttled + fire-and-forget (a
  // large favorites set can span many albums) so it caches alongside the audio
  // rather than blocking the whole download on N getAlbum calls.
  const parentAlbumIds = [
    ...new Set(songs.map((s) => s.albumId).filter((id): id is string => !!id)),
  ];
  if (parentAlbumIds.length > 0) {
    void runPool(
      parentAlbumIds,
      async (id) => {
        await fetchAlbumDetail(id, { prefetchCovers: true });
      },
      { concurrency: 3 },
    );
  }

  musicCacheStore.getState().enqueue(
    {
      itemId: STARRED_SONGS_ITEM_ID,
      type: 'favorites',
      name: 'Favorite Songs',
      coverArtId: STARRED_COVER_ART_ID,
      totalSongs: songs.length,
    },
    songs,
  );

  processQueue();
}

/** Remove the starred-songs download and delete its cached files. */
export function deleteStarredSongsDownload(): void {
  deleteCachedItem(STARRED_SONGS_ITEM_ID);
}

/**
 * Keep the starred-songs cache in sync with the current favorites.
 * Removes tracks that were unstarred and enqueues downloads for newly
 * starred tracks via the generic syncCachedItemTracks.
 */
async function syncStarredSongsDownload(): Promise<void> {
  // Membership check FIRST: both branches below are gated on the `__starred__` aggregate
  // existing, so for a user who never downloaded it the whole function is a no-op — and
  // reading the starred set first would put a full projection on every star toggle.
  if (!(STARRED_SONGS_ITEM_ID in musicCacheStore.getState().cachedItems)) return;

  const db = getDb();
  if (!db) return;
  if ((await countStarredSongs(db)) === 0) {
    // A zero count is USUALLY the user unstarring their last track, and deleting the
    // download is then correct. But `countStarredSongs` reads `songs` + `favorite_songs`,
    // and the Navidrome re-key DISCARDS both — it stopped re-keying them when the design
    // changed to let the library sync refill it. So the count does transit zero mid-pass,
    // and this path deletes the whole starred collection without ever reaching the prune
    // guard in `syncCachedPlaylistTracks`.
    //
    // So refuse while a re-key is outstanding — that is exactly the window in which the
    // count is meaningless, and it leaves the ordinary last-unstar case untouched. The
    // next sync repopulates the library and reports a real count.
    if (shouldBlockContent()) {
      const held = musicCacheStore.getState().cachedItems[STARRED_SONGS_ITEM_ID]?.songIds.length ?? 0;
      logLibrarySync(`starred delete refused mid-re-key: count 0 but ${held} songs downloaded`);
      return;
    }
    deleteCachedItem(STARRED_SONGS_ITEM_ID);
    return;
  }
  syncCachedItemTracks(STARRED_SONGS_ITEM_ID, (await listAllStarredSongs(db)).map(starredItemOf));
}

/* ------------------------------------------------------------------ */
/*  Implicit cross-store coupling: favoritesStore -> musicCacheService */
/* ------------------------------------------------------------------ */
/*
 * When the favorites song list changes (user stars/unstars a track, or
 * a library sync arrives with new starred data), automatically reconcile
 * the local `__starred__` virtual playlist if the user has it marked
 * offline. Nothing happens for users who haven't opted in — the work
 * is gated inside syncStarredSongsDownload() by a cachedItems membership
 * check before any download / deletion is triggered.
 *
 * One-way coupling: music-cache subscribes to favorites; favorites
 * never observes the music-cache. No cycle.
 *
 * Guards:
 *   - Identity compare on `state.songIds`: skip if the membership Set reference
 *     didn't change (re-renders, unrelated field changes). The store REPLACES that
 *     Set on every membership change and never mutates it in place — an in-place
 *     mutation would silently stop this firing.
 *   - `trackMapsReady`: skip during the startup window when
 *     trackUriMap / trackToItems are still being populated from SQL.
 *     Otherwise we'd run syncCachedItemTracks against empty maps and
 *     treat every song as "missing locally", causing a re-download
 *     storm of already-cached songs on boot.
 */
favoritesStore.subscribe((state, prev) => {
  if (state.songIds === prev.songIds) return;
  if (!trackMapsReady) return;
  void syncStarredSongsDownload();
});

storageLimitStore.subscribe((state, prev) => {
  const settingsChanged =
    state.limitMode !== prev.limitMode ||
    state.maxCacheSizeGB !== prev.maxCacheSizeGB;

  if (settingsChanged || (prev.isStorageFull && !state.isStorageFull)) {
    if (!checkStorageLimit()) {
      processQueue();
    }
  }
});
