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
 * See `plans/music-downloads-v2.md` for the full architectural plan. Key
 * guarantees preserved from v1:
 *   - Tmp-file atomicity (download to .tmp, move on success)
 *   - Kill-mid-item resumption via pre-scan + `recoverStalledDownloadsAsync`
 *   - Retry-once-on-null inside `downloadItem`
 *   - AppState listener for background→foreground recovery
 *   - Starred-songs virtual playlist under itemId `__starred__`
 *   - Storage-limit aware queue pausing
 *   - Real-time download speed tracking via `downloadSpeedTracker`
 */

import { Directory, File, Paths } from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';

import i18n from '../i18n/i18n';
import {
  listDirectoryAsync,
  getDirectorySizeAsync,
  downloadFileAsyncWithProgress,
} from 'expo-async-fs';
import { checkStorageLimit } from './storageService';
import { beginDownload, clearDownload } from './downloadSpeedTracker';
import { albumDetailStore } from '../store/albumDetailStore';
import { favoritesStore } from '../store/favoritesStore';
import { storageLimitStore } from '../store/storageLimitStore';
import {
  musicCacheStore,
  type CachedItemMeta,
  type CachedSongMeta,
  type DownloadQueueItem,
} from '../store/musicCacheStore';
import { insertCachedItemSong } from '../store/persistence/musicCacheTables';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { resolveEffectiveFormat } from '../utils/effectiveFormat';
import { playlistDetailStore } from '../store/playlistDetailStore';
import {
  ensureCoverArtAuth,
  getDownloadStreamUrl,
  type Child,
} from './subsonicService';
import {
  cacheAllSizes,
  cacheEntityCoverArt,
} from './imageCacheService';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CACHE_DIR_NAME = 'music-cache';
const UNKNOWN_ALBUM_ID = '_unknown';

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

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let cacheDir: Directory | null = null;
let isProcessing = false;
let processingId = 0;
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
      appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'active' && !isProcessing) {
          recoverStalledDownloadsAsync();
        }
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[musicCacheService] initMusicCache failed:',
      e instanceof Error ? e.message : String(e),
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
  cacheDir = null;
}

/**
 * Deferred post-splash init: populate the in-memory maps from SQL state,
 * reconcile any drift between SQL and the filesystem, then recover any
 * stalled downloads.
 */
export async function deferredMusicCacheInit(): Promise<void> {
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
      e instanceof Error ? e.message : String(e),
    );
  }

  // Capture filesystem ground-truth byte/file totals. Store aggregates are
  // derived from cachedSongs on hydrate (dedup-correct), but a filesystem
  // recalculate belts-and-braces against any Task-14 migration drift.
  scheduleRecalculate();

  await recoverStalledDownloadsAsync();
}

/**
 * Rebuild `trackUriMap` and `trackToItems` from the hydrated SQL mirror in
 * the store. No filesystem scan required — `cachedSongs` already has
 * everything needed to derive each file's URI.
 */
async function populateTrackMapsAsync(): Promise<void> {
  trackUriMap.clear();
  trackToItems.clear();

  const { cachedSongs, cachedItems } = musicCacheStore.getState();

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

  trackMapsReady = true;
  flushTrackMapsReadyWaiters();

  // Run any starred-songs sync that was deferred because the favoritesStore
  // subscription fired before the maps were ready.
  syncStarredSongsDownload();
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
 * Resolves as soon as {@link populateTrackMapsAsync} has finished rebuilding
 * `trackUriMap`. Used by the player's resume path so `childToTrack` sees
 * local URIs for downloaded songs instead of server stream URLs — critical
 * on a cold launch in offline mode where the launch race would otherwise
 * push unreachable URLs into RNTP.
 *
 * Resolves synchronously when the maps are already populated. Does NOT
 * kick off the populate itself (that's owned by `deferredMusicCacheInit`).
 */
export function waitForTrackMapsReady(): Promise<void> {
  if (trackMapsReady) return Promise.resolve();
  return new Promise<void>((resolve) => {
    trackMapsReadyWaiters.push(resolve);
  });
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

  let orphanFilesDeleted = 0;
  let staleTmpDeleted = 0;
  let missingSongIds = 0;
  let orphanItemIds = 0;

  /* -------- Pass 1: FS -> SQL --------
   * Walk each top-level album directory (every cached song lives at
   * {music-cache}/{albumId}/{songId}.{ext} in v2). Top-level entries
   * whose name isn't a valid album_id from SQL are swept at the end —
   * anything here that isn't an albumId is stale v1 playlist/starred
   * directory leftovers from a partial migration. */
  let topLevelNames: string[];
  try {
    const result = await listDirectoryAsync(dir.uri);
    topLevelNames = Array.isArray(result) ? result : [];
  } catch {
    topLevelNames = [];
  }

  // Set of album_ids the SQL store knows about. Anything else at top level
  // is stale (v1 playlist/__starred__/partially-migrated stragglers).
  const validAlbumIds = new Set<string>();
  const { cachedSongs: allCachedSongs } = musicCacheStore.getState();
  for (const s of Object.values(allCachedSongs)) {
    validAlbumIds.add(s.albumId || UNKNOWN_ALBUM_ID);
  }

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
      if (!file.exists) continue;

      // Stale .tmp remnants from a crashed transfer. Deleted unconditionally
      // at startup — no in-flight downloads have been scheduled yet, so any
      // .tmp on disk is abandoned state.
      if (fileName.endsWith('.tmp')) {
        try { file.delete(); staleTmpDeleted++; } catch { /* best-effort */ }
        continue;
      }

      // Derive songId from filename (stem before the last dot).
      const dotIdx = fileName.lastIndexOf('.');
      const songId = dotIdx >= 0 ? fileName.slice(0, dotIdx) : fileName;

      // Orphan check: no SQL row, or the row exists under a different album.
      const sqlRow = musicCacheStore.getState().cachedSongs[songId];
      if (!sqlRow || sqlRow.albumId !== albumId) {
        try { file.delete(); orphanFilesDeleted++; } catch { /* best-effort */ }
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
          albumDir.delete();
        }
      } catch { /* best-effort */ }
    }
  }

  /* -------- Pass 2: SQL -> FS -------- */
  // Snapshot cachedSongs before mutation — iterating while removing edges
  // is unsafe.
  const songsSnapshot = Object.values(musicCacheStore.getState().cachedSongs);
  const missingSongs: typeof songsSnapshot = [];
  for (const song of songsSnapshot) {
    const file = resolveSongFile(song);
    if (!file.exists) missingSongs.push(song);
  }

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
        musicCacheStore.getState().removeCachedItemSong(itemId, idx + 1);
      }
    }

    // In-memory map cleanup — the store already purges orphaned song rows
    // from cachedSongs via refcount, but trackUriMap / trackToItems are
    // owned by the service.
    trackUriMap.delete(song.id);
    trackToItems.delete(song.id);
  }

  /* -------- Pass 3: orphan item rows -------- */
  const orphanItems: string[] = [];
  for (const item of Object.values(musicCacheStore.getState().cachedItems)) {
    if (item.songIds.length === 0) orphanItems.push(item.itemId);
  }
  for (const itemId of orphanItems) {
    musicCacheStore.getState().removeCachedItem(itemId);
    orphanItemIds++;
  }

  /* -------- Pass 4: sweep non-album top-level directories --------
   * Anything under {music-cache}/ whose name isn't a known album_id is
   * stale — leftover v1 playlist/__starred__ directories from a partial
   * Task-14 migration, or other junk. Delete it.
   *
   * CRITICAL SAFETY GATE: skip this pass entirely if we have no valid
   * album_ids. `cached_songs` is empty in two scenarios, neither of which
   * should trigger a sweep:
   *   (a) Fresh install — there's nothing on disk to sweep, so skipping
   *       is a cheap no-op.
   *   (b) Migration task #14 hasn't completed yet (an earlier task
   *       threw and runMigrations halted) — the v1 cache directories are
   *       still on disk in their original shape waiting to be migrated.
   *       Sweeping them here would be catastrophic data loss.
   * Without this gate, scenario (b) would wipe every cached file the
   * user has before task #14 ever gets a chance to run on the next
   * launch. */
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
 * Delete incomplete .tmp files for a given item from the album dirs its
 * songs live in. Used by both stalled-download recovery and manual retry to
 * clean up partial transfers without touching fully-downloaded files.
 */
async function cleanupTmpFilesForQueueItem(item: DownloadQueueItem): Promise<void> {
  let songs: Child[] = [];
  try {
    songs = JSON.parse(item.songsJson) as Child[];
  } catch {
    return;
  }

  // Deduplicate the album directories we need to sweep.
  const albumIds = new Set<string>();
  for (const s of songs) {
    albumIds.add(s.albumId || UNKNOWN_ALBUM_ID);
  }

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
  return trackUriMap.get(trackId) ?? null;
}

/** Check whether an album / playlist / favorites / song item is cached. */
export function isItemCached(itemId: string): boolean {
  return itemId in musicCacheStore.getState().cachedItems;
}

/** Check if a track is in any queued / downloading queue item. */
export function getTrackQueueStatus(trackId: string): 'queued' | 'downloading' | null {
  const queue = musicCacheStore.getState().downloadQueue;
  for (const item of queue) {
    if (item.status !== 'queued' && item.status !== 'downloading') continue;
    let songs: Child[];
    try {
      songs = JSON.parse(item.songsJson) as Child[];
    } catch {
      continue;
    }
    if (songs.some((t) => t.id === trackId)) {
      return item.status;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Enqueue downloads                                                  */
/* ------------------------------------------------------------------ */

function cacheTrackCoverArt(tracks: Child[]): void {
  cacheEntityCoverArt(tracks);
}

/** Enqueue an album download. */
export async function enqueueAlbumDownload(albumId: string): Promise<void> {
  const state = musicCacheStore.getState();
  if (albumId in state.cachedItems) return;
  if (state.downloadQueue.some((q) => q.itemId === albumId)) return;

  onAlbumReferencedHook?.(albumId);

  await ensureCoverArtAuth();
  const album = await albumDetailStore.getState().fetchAlbum(albumId);
  if (!album?.song?.length) return;

  if (album.coverArt) {
    cacheAllSizes(album.coverArt).catch(() => { /* non-critical */ });
  }
  cacheTrackCoverArt(album.song);

  musicCacheStore.getState().enqueue({
    itemId: albumId,
    type: 'album',
    name: album.name,
    artist: album.artist ?? album.displayArtist,
    coverArtId: album.coverArt,
    totalSongs: album.song.length,
    songsJson: JSON.stringify(album.song),
  });

  processQueue();
}

/** Enqueue a playlist download. */
export async function enqueuePlaylistDownload(playlistId: string): Promise<void> {
  const state = musicCacheStore.getState();
  if (playlistId in state.cachedItems) return;
  if (state.downloadQueue.some((q) => q.itemId === playlistId)) return;

  await ensureCoverArtAuth();
  const playlist = await playlistDetailStore.getState().fetchPlaylist(playlistId);
  if (!playlist?.entry?.length) return;

  if (playlist.coverArt) {
    cacheAllSizes(playlist.coverArt).catch(() => { /* non-critical */ });
  }
  cacheTrackCoverArt(playlist.entry);

  musicCacheStore.getState().enqueue({
    itemId: playlistId,
    type: 'playlist',
    name: playlist.name,
    coverArtId: playlist.coverArt,
    totalSongs: playlist.entry.length,
    songsJson: JSON.stringify(playlist.entry),
  });

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
  const state = musicCacheStore.getState();
  if (itemId in state.cachedItems) return;
  if (state.downloadQueue.some((q) => q.itemId === itemId)) return;

  // If the underlying song is already fully cached, don't transfer bytes —
  // just create the `song:` item + edge so it shows up in the browser.
  if (song.id in state.cachedSongs) {
    const existing = state.cachedSongs[song.id];
    musicCacheStore.getState().upsertCachedItem(
      {
        itemId,
        type: 'song',
        name: song.title ?? existing.title,
        artist: song.artist ?? existing.artist,
        coverArtId: song.coverArt ?? existing.coverArt,
        expectedSongCount: 1,
        parentAlbumId: song.albumId ?? existing.albumId,
        lastSyncAt: Date.now(),
        downloadedAt: Date.now(),
      },
      [song.id],
    );
    insertCachedItemSong(itemId, 1, song.id);
    registerTrackToItem(song.id, itemId);
    return;
  }

  await ensureCoverArtAuth();
  cacheTrackCoverArt([song]);

  musicCacheStore.getState().enqueue({
    itemId,
    type: 'song',
    name: song.title ?? 'Unknown',
    artist: song.artist,
    coverArtId: song.coverArt,
    totalSongs: 1,
    songsJson: JSON.stringify([song]),
  });

  processQueue();
}

/* ------------------------------------------------------------------ */
/*  Queue processing                                                   */
/* ------------------------------------------------------------------ */

async function processQueue(): Promise<void> {
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
 * Ensure a partial-album `cached_items` row + edge exist for songs
 * downloaded from a non-album item. No-op when the triggering item IS the
 * album itself.
 */
function ensurePartialAlbumEdge(
  triggerItemId: string,
  triggerItemType: DownloadQueueItem['type'],
  song: Child,
): void {
  if (!song.albumId) return;
  if (triggerItemType === 'album' && triggerItemId === song.albumId) return;

  const state = musicCacheStore.getState();
  const existing = state.cachedItems[song.albumId];

  if (existing) {
    // Append this song as a new edge if not already present.
    if (existing.songIds.includes(song.id)) return;
    const nextPosition = existing.songIds.length + 1;
    insertCachedItemSong(song.albumId, nextPosition, song.id);
    registerTrackToItem(song.id, song.albumId);
    musicCacheStore.setState((prev) => {
      const prevItem = prev.cachedItems[song.albumId!];
      if (!prevItem) return prev;
      if (prevItem.songIds.includes(song.id)) return prev;
      return {
        cachedItems: {
          ...prev.cachedItems,
          [song.albumId!]: {
            ...prevItem,
            songIds: [...prevItem.songIds, song.id],
          },
        },
      };
    });
    return;
  }

  // Otherwise create a fresh partial-album row.
  const cachedAlbum = albumDetailStore.getState().albums[song.albumId];
  const expectedSongCount = cachedAlbum?.album?.song?.length ?? 1;
  const now = Date.now();

  musicCacheStore.getState().upsertCachedItem(
    {
      itemId: song.albumId,
      type: 'album',
      name: song.album ?? cachedAlbum?.album?.name ?? 'Unknown',
      artist: song.artist ?? cachedAlbum?.album?.artist,
      coverArtId: song.coverArt ?? cachedAlbum?.album?.coverArt,
      expectedSongCount,
      parentAlbumId: undefined,
      lastSyncAt: now,
      downloadedAt: now,
    },
    [song.id],
  );
  insertCachedItemSong(song.albumId, 1, song.id);
  registerTrackToItem(song.id, song.albumId);
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

  let songs: Child[];
  try {
    songs = JSON.parse(queueItem.songsJson) as Child[];
  } catch {
    musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
      status: 'error',
      error: 'Failed to parse songs',
    });
    return;
  }

  // Edges created during this run — tracked so cancel() can reverse them.
  const runEdges: Array<{ itemId: string; position: number; songId: string }> = [];
  // Songs fully landed during this run — for cancel() refcount adjustments.
  const runDownloadedSongs = new Set<string>();
  // Ordered list of (position, songId) pairs to commit at markItemComplete.
  const itemEdges: Array<{ position: number; songId: string }> = [];
  // Accumulated song metadata to upsert at markItemComplete.
  const itemSongsForCommit = new Map<string, CachedSongMeta>();

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
    if (existing) {
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

      if (checkStorageLimit()) {
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
          itemEdges.push({ position, songId: song.id });
          runDownloadedSongs.add(song.id);
          trackUriMap.set(song.id, resolveSongFile(result).uri);

          // Also ensure the partial-album edge (for non-album items).
          ensurePartialAlbumEdge(queueItem.itemId, queueItem.type, song);

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
    );

    for (const e of edgesForCommit) {
      registerTrackToItem(e.songId, queueItem.itemId);
      runEdges.push({ itemId: queueItem.itemId, position: e.position, songId: e.songId });
    }
    // runEdges is used only for cancellation; on successful finalise we
    // don't need to reverse anything. Leaving the array here for clarity.
    void runEdges;
    void runDownloadedSongs;
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
  if (existing) return existing;

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
    tmpDest.move(dest);

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
    };

    // Upsert to the pool immediately so subsequent dedup checks within this
    // same item (e.g. playlist with the song twice) short-circuit cleanly.
    musicCacheStore.getState().upsertCachedSong(meta);

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

  // Delete the old file from disk.
  const oldFile = resolveSongFile(existingSong);
  if (oldFile.exists) {
    try { oldFile.delete(); } catch { /* best-effort */ }
  }
  trackUriMap.delete(trackId);

  await ensureCoverArtAuth();
  const url = getDownloadStreamUrl(trackId);
  if (!url) return false;

  const { downloadFormat, downloadMaxBitRate } = playbackSettingsStore.getState();
  const ext = downloadFormat !== 'raw' ? downloadFormat : existingSong.suffix;
  const fileName = `${trackId}.${ext}`;
  const albumDir = ensureAlbumDir(existingSong.albumId);

  try {
    const dest = new File(albumDir, fileName);
    await File.downloadFileAsync(url, dest);
    const bytes = dest.exists ? dest.size ?? 0 : 0;

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
export function deleteCachedItem(itemId: string): void {
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
  const orphanedIds = musicCacheStore.getState().removeCachedItem(itemId);
  const orphanSet = new Set(orphanedIds);

  // Clean up trackToItems for every song that was referenced by this item.
  for (const sid of cached.songIds) {
    trackToItems.get(sid)?.delete(itemId);
    if (orphanSet.has(sid)) {
      trackToItems.delete(sid);
      trackUriMap.delete(sid);
    }
  }

  // Delete files for orphaned songs. Use the snapshotted metadata to
  // resolve paths since the store has already removed them.
  for (const song of affectedSongs) {
    if (!orphanSet.has(song.id)) continue;
    const file = resolveSongFile(song);
    if (file.exists) {
      try { file.delete(); } catch { /* best-effort */ }
    }
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
    const albumDir = new Directory(albumsRoot, albumId);
    if (albumDir.exists) {
      try { albumDir.delete(); } catch { /* best-effort */ }
    }
  }

  resumeIfSpaceAvailable();
}

/**
 * Remove a single song from a cached playlist/favorites/song item. Deletes
 * the underlying file iff the song's refcount hits zero.
 */
export function removeCachedPlaylistTrack(itemId: string, trackIndex: number): void {
  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (!cached) return;
  // Preserve v1 guard: only operate on playlist-ish items.
  if (cached.type !== 'playlist' && cached.type !== 'favorites') return;
  if (trackIndex < 0 || trackIndex >= cached.songIds.length) return;

  const songId = cached.songIds[trackIndex];
  const song = musicCacheStore.getState().cachedSongs[songId];

  const { orphanedSongId } = musicCacheStore.getState().removeCachedItemSong(
    itemId,
    trackIndex + 1, // SQL positions are 1-indexed
  );

  trackToItems.get(songId)?.delete(itemId);

  if (orphanedSongId && song) {
    trackToItems.delete(orphanedSongId);
    trackUriMap.delete(orphanedSongId);
    const file = resolveSongFile(song);
    if (file.exists) {
      try { file.delete(); } catch { /* best-effort */ }
    }
  }
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
 */
export function syncCachedPlaylistTracks(
  playlistId: string,
  newTrackIds: string[],
): void {
  const cached = musicCacheStore.getState().cachedItems[playlistId];
  if (!cached) return;
  if (cached.type !== 'playlist' && cached.type !== 'favorites') return;

  const keepSet = new Set(newTrackIds);

  // Remove songs not in the new list. removeCachedItemSong shifts
  // positions inside the store & SQL, so we must iterate positions
  // from highest to lowest.
  const originalSongIds = [...cached.songIds];
  for (let idx = originalSongIds.length - 1; idx >= 0; idx--) {
    const sid = originalSongIds[idx];
    if (keepSet.has(sid)) continue;
    const song = musicCacheStore.getState().cachedSongs[sid];
    const { orphanedSongId } = musicCacheStore.getState().removeCachedItemSong(
      playlistId,
      idx + 1,
    );
    trackToItems.get(sid)?.delete(playlistId);
    if (orphanedSongId && song) {
      trackToItems.delete(orphanedSongId);
      trackUriMap.delete(orphanedSongId);
      const file = resolveSongFile(song);
      if (file.exists) {
        try { file.delete(); } catch { /* best-effort */ }
      }
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
 * Full sync for a cached item: removes tracks no longer present and
 * re-enqueues through the download queue when new tracks are detected.
 *
 * v2 behaviour: addition path no longer manually spliced out of
 * `cachedItems` — the new tracks go through the normal download pipeline,
 * which knows how to add edges to an existing item (via the same itemId,
 * songs are transferred, then `markItemComplete` upserts the item row and
 * fresh edges). This is equivalent to v1 semantics for users but cleaner
 * at the model level.
 */
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

  musicCacheStore.getState().enqueue({
    itemId,
    type: updated.type,
    name: updated.name,
    artist: updated.artist,
    coverArtId: updated.coverArtId,
    totalSongs: newSongs.length,
    songsJson: JSON.stringify(newSongs),
  });

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
export function cancelDownload(queueId: string): void {
  const item = musicCacheStore.getState().downloadQueue.find(
    (q) => q.queueId === queueId,
  );
  if (!item) return;

  musicCacheStore.getState().removeFromQueue(queueId);

  // Delete any .tmp remnants for songs in this queue item (best-effort).
  let songs: Child[] = [];
  try {
    songs = JSON.parse(item.songsJson) as Child[];
  } catch {
    songs = [];
  }
  const albumsVisited = new Set<string>();
  for (const s of songs) {
    const albumId = s.albumId || UNKNOWN_ALBUM_ID;
    if (albumsVisited.has(albumId)) continue;
    albumsVisited.add(albumId);
    const albumDir = new Directory(ensureCacheDir(), albumId);
    if (!albumDir.exists) continue;
    // Sweep tmp files for songs in this cancelled set.
    for (const song of songs) {
      if ((song.albumId || UNKNOWN_ALBUM_ID) !== albumId) continue;
      // Try a few extensions — we don't know which was in flight.
      const candidates = [
        song.suffix,
        playbackSettingsStore.getState().downloadFormat,
      ].filter((e): e is string => typeof e === 'string' && e.length > 0);
      for (const ext of candidates) {
        const tmp = new File(albumDir, `${song.id}.${ext}.tmp`);
        if (tmp.exists) {
          try { tmp.delete(); } catch { /* best-effort */ }
        }
      }
    }
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
export function clearDownloadQueue(): void {
  const queue = [...musicCacheStore.getState().downloadQueue];
  for (const item of queue) {
    cancelDownload(item.queueId);
  }
  resumeIfSpaceAvailable();
}

/**
 * Delete all cached music and recreate the cache directory. Returns the
 * number of bytes freed.
 */
export async function clearMusicCache(): Promise<number> {
  const dir = ensureCacheDir();
  const freedBytes = await getDirectorySizeAsync(dir.uri);

  try { dir.delete(); } catch { /* best-effort */ }

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

  const { songs } = favoritesStore.getState();
  if (songs.length === 0) return;

  await ensureCoverArtAuth();
  cacheTrackCoverArt(songs);

  musicCacheStore.getState().enqueue({
    itemId: STARRED_SONGS_ITEM_ID,
    type: 'favorites',
    name: 'Favorite Songs',
    coverArtId: STARRED_COVER_ART_ID,
    totalSongs: songs.length,
    songsJson: JSON.stringify(songs),
  });

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
function syncStarredSongsDownload(): void {
  const { songs } = favoritesStore.getState();
  const state = musicCacheStore.getState();

  if (songs.length === 0) {
    if (STARRED_SONGS_ITEM_ID in state.cachedItems) {
      deleteCachedItem(STARRED_SONGS_ITEM_ID);
    }
    return;
  }

  if (STARRED_SONGS_ITEM_ID in state.cachedItems) {
    syncCachedItemTracks(STARRED_SONGS_ITEM_ID, songs);
  }
}

// Auto-sync starred songs whenever the favorites song list changes.
// Guard: skip if track maps haven't been populated yet.
favoritesStore.subscribe((state, prev) => {
  if (state.songs === prev.songs) return;
  if (!trackMapsReady) return;
  syncStarredSongsDownload();
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
