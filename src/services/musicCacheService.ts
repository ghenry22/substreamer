/**
 * Offline music cache service.
 *
 * Downloads album and playlist tracks to {Paths.document}/music-cache/
 * for offline playback. Each album or playlist gets its own subdirectory
 * containing one file per track:
 *
 *   music-cache/{itemId}/{trackId}.{ext}
 *
 * Uses downloadFileAsyncWithProgress from expo-async-fs for native
 * downloads with byte-level progress events.
 * Queue processing follows the sequential pattern from scrobbleService
 * (one item at a time, configurable concurrent track downloads within
 * each item).
 */

import { Directory, File, Paths } from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';

import i18n from '../i18n/i18n';
import { listDirectoryAsync, getDirectorySizeAsync, downloadFileAsyncWithProgress } from 'expo-async-fs';
import { checkStorageLimit } from './storageService';
import { beginDownload, clearDownload } from './downloadSpeedTracker';
import { albumDetailStore } from '../store/albumDetailStore';
import { albumLibraryStore } from '../store/albumLibraryStore';
import { favoritesStore } from '../store/favoritesStore';
import { storageLimitStore } from '../store/storageLimitStore';
import {
  musicCacheStore,
  type CachedMusicItem,
  type CachedTrack,
} from '../store/musicCacheStore';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { resolveEffectiveFormat } from '../utils/effectiveFormat';
import { playlistDetailStore } from '../store/playlistDetailStore';
import {
  ensureCoverArtAuth,
  getDownloadStreamUrl,
  type Child,
} from './subsonicService';
import { cacheAllSizes, cacheEntityCoverArt, getCachedImageUri } from './imageCacheService';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CACHE_DIR_NAME = 'music-cache';

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
 * Determine the file extension for a downloaded track based on the
 * current download format setting and the track's original metadata.
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
 * Set to true after populateTrackMapsAsync() finishes scanning the
 * music-cache directory.  Module-scope subscriptions (e.g. the
 * favoritesStore listener) must NOT run syncStarredSongsDownload()
 * before this flag is set — trackUriMap and trackToItems would be
 * empty, causing incorrect reference-counting and potential file
 * deletion or premature re-enqueue of the starred-songs download.
 */
let trackMapsReady = false;

/**
 * In-memory map from trackId -> local file URI for O(1) lookups.
 * Populated on init by scanning the music-cache directory and updated
 * as downloads complete.
 */
const trackUriMap = new Map<string, string>();

/**
 * Reverse map: trackId -> set of itemIds that contain this track.
 * Used by getTrackQueueStatus() for song-level queue status checks.
 */
const trackToItems = new Map<string, Set<string>>();

/* ------------------------------------------------------------------ */
/*  Initialisation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Create the music-cache directory under Paths.document and register
 * the AppState listener for resume-from-background recovery.
 * Safe to call multiple times (no-ops if already initialised).
 *
 * Expensive scanning (populateTrackMaps, stalled-download recovery)
 * is NOT performed here — call {@link deferredMusicCacheInit} after
 * the first React frame to avoid blocking the native splash screen.
 */
export function initMusicCache(): void {
  if (cacheDir) return;
  // Wrap in try/catch because this is invoked at module-scope from
  // _layout.tsx, before any React error boundary is mounted. On stripped
  // OEM ROMs the synchronous Directory.create() can throw with restricted
  // storage permissions, and an unhandled throw here would crash the JS
  // bundle before the user can even reach the login screen. If init fails
  // here, cacheDir stays null and downstream callers will hit a controlled
  // null deref inside React, where an error boundary CAN catch it.
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
    console.warn('[musicCacheService] initMusicCache failed:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Run the expensive filesystem scanning that was split out of
 * {@link initMusicCache} to avoid blocking app startup.
 * Should be called once after the first React frame renders.
 *
 * All scanning runs on native background threads via expo-async-fs,
 * so the JS thread remains free for UI updates throughout.
 */
export async function deferredMusicCacheInit(): Promise<void> {
  await populateTrackMapsAsync();

  // Force all musicCacheStore subscribers (e.g. useDownloadStatus) to
  // re-evaluate now that trackUriMap is populated.  Song download status
  // depends on the in-memory map, which isn't part of Zustand state, so
  // without this touch the hooks would stay stale until the next real
  // state change (recalculate, which runs after another async fs scan).
  musicCacheStore.setState({});

  await recoverStalledDownloadsAsync();
}

/**
 * Delete incomplete .tmp files from an item's cache directory while
 * preserving fully-downloaded tracks. Used by both stalled-download
 * recovery and manual retry to clean up partial transfers.
 */
async function cleanupTmpFiles(itemId: string): Promise<void> {
  const itemDir = new Directory(ensureCacheDir(), itemId);
  if (!itemDir.exists) return;
  try {
    const entries = await listDirectoryAsync(itemDir.uri);
    for (const name of entries) {
      if (name.endsWith('.tmp')) {
        try { new File(itemDir, name).delete(); } catch { /* best-effort */ }
      }
    }
  } catch { /* best-effort */ }
}

/**
 * On startup, any items stuck in 'downloading' status are from a
 * previous session that was interrupted.
 *
 * 1. Delete incomplete (.tmp) files – these were mid-transfer when
 *    the app died and cannot be trusted.
 * 2. Preserve fully-downloaded tracks – files with their final
 *    extension remain on disk and are registered in trackUriMap
 *    by populateTrackMaps().
 * 3. Reset the item to 'queued' so processQueue() picks it up.
 *
 * When downloadItem() runs the resumed item, it checks each track
 * against trackUriMap: completed tracks are skipped, and tracks
 * whose .tmp files were cleaned up are re-downloaded.
 *
 * Directory listing runs on a native background thread via
 * expo-async-fs, keeping the JS thread free for UI rendering.
 *
 * When `includeErrors` is true, items in 'error' status are also
 * cleaned up and requeued. This is used by the manual recover button
 * so a single tap retries everything that isn't done.
 */
export async function recoverStalledDownloadsAsync(
  includeErrors = false,
): Promise<void> {
  if (isProcessing) return;

  const { downloadQueue } = musicCacheStore.getState();
  let hasRecoverableItems = false;

  for (const item of downloadQueue) {
    if (item.status === 'downloading' || (includeErrors && item.status === 'error')) {
      await cleanupTmpFiles(item.itemId);

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
 * Force-recover the download queue regardless of current processing
 * state. Bumps the generation counter so active workers exit at their
 * next check, then recovers stalled and failed items.
 *
 * Used by the manual "Recover" button on the download queue screen.
 */
export async function forceRecoverDownloadsAsync(): Promise<void> {
  processingId++;
  isProcessing = false;
  await recoverStalledDownloadsAsync(true);
}

function ensureCacheDir(): Directory {
  if (!cacheDir) initMusicCache();
  return cacheDir!;
}

/**
 * Scan the music-cache directory to populate trackUriMap and
 * trackToItems from files already on disk.
 *
 * Directory listing runs on native background threads via
 * expo-async-fs, keeping the JS thread free for UI rendering.
 */
async function populateTrackMapsAsync(): Promise<void> {
  trackUriMap.clear();
  trackToItems.clear();
  const dir = ensureCacheDir();

  let subDirNames: string[];
  try {
    subDirNames = await listDirectoryAsync(dir.uri);
  } catch {
    return;
  }

  for (const itemId of subDirNames) {
    if (!itemId) continue;

    const subDir = new Directory(dir, itemId);
    if (!subDir.exists) continue;

    try {
      const fileNames = await listDirectoryAsync(subDir.uri);
      for (const fileName of fileNames) {
        if (!fileName || fileName.endsWith('.tmp')) continue;
        const trackId = fileName.replace(/\.[^.]+$/, '') || fileName;
        const fileUri = new File(subDir, fileName).uri;
        trackUriMap.set(trackId, fileUri);

        if (!trackToItems.has(trackId)) trackToItems.set(trackId, new Set());
        trackToItems.get(trackId)!.add(itemId);
      }
    } catch {
      /* best-effort */
    }
  }

  trackMapsReady = true;

  // Run any starred-songs sync that was deferred because the
  // favoritesStore subscription fired before maps were populated.
  syncStarredSongsDownload();
}

/* ------------------------------------------------------------------ */
/*  Cache lookup (synchronous)                                         */
/* ------------------------------------------------------------------ */

/**
 * Returns the local file:// URI for a cached track, or null if the
 * track is not downloaded. O(1) via the in-memory map.
 */
export function getLocalTrackUri(trackId: string): string | null {
  if (!trackId) return null;
  return trackUriMap.get(trackId) ?? null;
}

/** Check if an album or playlist is fully downloaded. */
export function isItemCached(itemId: string): boolean {
  return itemId in musicCacheStore.getState().cachedItems;
}

/**
 * Check if a track belongs to any item currently in the download queue.
 * Returns the queue item status or null.
 */
export function getTrackQueueStatus(trackId: string): 'queued' | 'downloading' | null {
  const queue = musicCacheStore.getState().downloadQueue;
  for (const item of queue) {
    if (item.status !== 'queued' && item.status !== 'downloading') continue;
    if (item.tracks.some((t) => t.id === trackId)) {
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

/**
 * Fetch album metadata, cache its cover art, and add it to the
 * download queue. Triggers queue processing immediately.
 */
export async function enqueueAlbumDownload(albumId: string): Promise<void> {
  const state = musicCacheStore.getState();
  if (albumId in state.cachedItems) return;
  if (state.downloadQueue.some((q) => q.itemId === albumId)) return;

  // If the album isn't in the cached library, refresh it in the background.
  // Without this, an album downloaded via search/artist detail can be
  // invisible in offline mode (the album list view filters this store).
  // The library store has its own loading guard so concurrent triggers
  // collapse to one fetch. Skipped on a cold library — _layout.tsx
  // handles the first-fetch path via its `length === 0` guard.
  const cachedLibrary = albumLibraryStore.getState().albums;
  if (cachedLibrary.length > 0 && !cachedLibrary.some((a) => a.id === albumId)) {
    albumLibraryStore.getState().fetchAllAlbums().catch(() => { /* non-critical */ });
  }

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
    totalTracks: album.song.length,
    tracks: album.song,
  });

  processQueue();
}

/**
 * Fetch playlist metadata, cache its cover art, and add it to the
 * download queue. Triggers queue processing immediately.
 */
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
    totalTracks: playlist.entry.length,
    tracks: playlist.entry,
  });

  processQueue();
}

/**
 * Cache a single song for offline playback. Uses the song's own ID as the
 * itemId so that `useDownloadStatus('song', id)` resolves correctly once the
 * file is on disk.
 */
export async function enqueueSongDownload(song: Child): Promise<void> {
  const state = musicCacheStore.getState();
  if (song.id in state.cachedItems) return;
  if (state.downloadQueue.some((q) => q.itemId === song.id)) return;

  await ensureCoverArtAuth();
  if (song.coverArt) {
    cacheAllSizes(song.coverArt).catch(() => { /* non-critical */ });
  }
  cacheTrackCoverArt([song]);

  musicCacheStore.getState().enqueue({
    itemId: song.id,
    type: 'song',
    name: song.title ?? 'Unknown',
    artist: song.artist,
    coverArtId: song.coverArt,
    totalTracks: 1,
    tracks: [song],
  });

  processQueue();
}

/* ------------------------------------------------------------------ */
/*  Queue processing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Process the download queue. Items are processed sequentially (one
 * album/playlist at a time). Within each item, up to
 * maxConcurrentDownloads tracks are downloaded in parallel.
 */
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

/**
 * Download all tracks for a single queue item using a concurrency pool.
 */
async function downloadItem(queueItem: DownloadQueueItemSnapshot, myId: number): Promise<void> {
  const { maxConcurrentDownloads } = musicCacheStore.getState();
  const itemDir = new Directory(ensureCacheDir(), queueItem.itemId);
  if (!itemDir.exists) itemDir.create();

  const completedTracks: CachedTrack[] = [];
  const downloadedIds = new Set<string>();
  const preScannedIds = new Set<string>();
  let totalBytes = 0;
  let trackIndex = 0;

  // Pre-count tracks that already exist on disk so the progress counter
  // never drops below the real completed count (avoids UI flicker on resume).
  for (const track of queueItem.tracks) {
    if (downloadedIds.has(track.id)) {
      const existing = completedTracks.find((t) => t.id === track.id);
      if (existing) completedTracks.push(existing);
      continue;
    }
    const existingUri = trackUriMap.get(track.id);
    if (existingUri) {
      const existingFileName = existingUri.split('/').pop() ?? track.id;
      const existingFile = new File(itemDir, existingFileName);
      if (existingFile.exists) {
        const bytes = existingFile.size ?? 0;
        completedTracks.push({
          id: track.id,
          title: track.title ?? 'Unknown',
          artist: track.artist ?? i18n.t('unknownArtist'),
          fileName: existingFileName,
          bytes,
          duration: track.duration ?? 0,
        });
        totalBytes += bytes;
        downloadedIds.add(track.id);
        preScannedIds.add(track.id);
        if (!trackToItems.has(track.id)) trackToItems.set(track.id, new Set());
        trackToItems.get(track.id)!.add(queueItem.itemId);
      }
    }
  }

  if (completedTracks.length > 0) {
    musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
      completedTracks: completedTracks.length,
    });
  }

  const downloadNext = async (): Promise<void> => {
    while (trackIndex < queueItem.tracks.length) {
      if (myId !== processingId) return;

      const current = musicCacheStore.getState().downloadQueue.find(
        (q) => q.queueId === queueItem.queueId,
      );
      if (!current || current.status !== 'downloading') return;

      if (checkStorageLimit()) {
        musicCacheStore.getState().updateQueueItem(queueItem.queueId, { status: 'queued' });
        return;
      }

      const idx = trackIndex++;
      const track = queueItem.tracks[idx];

      // Pre-scanned tracks (and their playlist duplicates) are already
      // counted — skip without updating the store.
      if (preScannedIds.has(track.id)) continue;

      // Playlists can contain the same track more than once.
      // Only download it once; reuse the result for duplicates.
      if (downloadedIds.has(track.id)) {
        const existing = completedTracks.find((t) => t.id === track.id);
        if (existing) completedTracks.push(existing);
        musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
          completedTracks: completedTracks.length,
        });
        continue;
      }
      downloadedIds.add(track.id);

      try {
        let result = await downloadTrack(track, itemDir);
        if (!result) result = await downloadTrack(track, itemDir);
        if (result) {
          completedTracks.push(result);
          totalBytes += result.bytes;
          trackUriMap.set(track.id, new File(itemDir, result.fileName).uri);
          if (!trackToItems.has(track.id)) trackToItems.set(track.id, new Set());
          trackToItems.get(track.id)!.add(queueItem.itemId);

          musicCacheStore.getState().addBytes(result.bytes);
          musicCacheStore.getState().addFiles(1);
        }
      } catch {
        /* individual track failure -- continue with the rest */
      }

      musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
        completedTracks: completedTracks.length,
      });
    }
  };

  const workers = Array.from(
    { length: Math.min(maxConcurrentDownloads, queueItem.tracks.length) },
    () => downloadNext(),
  );
  await Promise.all(workers);

  const finalState = musicCacheStore.getState().downloadQueue.find(
    (q) => q.queueId === queueItem.queueId,
  );
  if (!finalState) return;

  if (completedTracks.length === queueItem.tracks.length) {
    const cached: CachedMusicItem = {
      itemId: queueItem.itemId,
      type: queueItem.type,
      name: queueItem.name,
      artist: queueItem.artist,
      coverArtId: queueItem.coverArtId,
      tracks: completedTracks,
      totalBytes,
      downloadedAt: Date.now(),
    };
    musicCacheStore.getState().markItemComplete(queueItem.queueId, cached);
  } else {
    musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
      status: 'error',
      error: `Downloaded ${completedTracks.length} of ${queueItem.tracks.length} tracks`,
      completedTracks: completedTracks.length,
    });
  }
}

type DownloadQueueItemSnapshot = Readonly<{
  queueId: string;
  itemId: string;
  type: 'album' | 'playlist' | 'song';
  name: string;
  artist?: string;
  coverArtId?: string;
  tracks: Child[];
}>;

/**
 * Download a single track using the native download with progress events.
 *
 * Downloads to a `.tmp` file first and renames on success, so that
 * incomplete downloads from a killed app can be identified and
 * cleaned up on restart.
 */
async function downloadTrack(
  track: Child,
  itemDir: Directory,
): Promise<CachedTrack | null> {
  await ensureCoverArtAuth();

  const url = getDownloadStreamUrl(track.id);
  if (!url) return null;

  // Capture download settings BEFORE the transfer starts.
  const { downloadFormat, downloadMaxBitRate } = playbackSettingsStore.getState();

  const ext = getTrackFileExtension(track);
  const fileName = `${track.id}.${ext}`;
  const tmpName = `${fileName}.tmp`;

  try {
    beginDownload(track.id);
    const tmpDest = new File(itemDir, tmpName);
    await downloadFileAsyncWithProgress(url, tmpDest.uri, track.id);

    const dest = new File(itemDir, fileName);
    if (dest.exists) {
      try { dest.delete(); } catch { /* best-effort */ }
    }
    tmpDest.move(dest);

    const bytes = dest.exists ? dest.size ?? 0 : 0;

    clearDownload(track.id);

    // Record the effective format for this download.
    const effectiveFmt = resolveEffectiveFormat({
      sourceSuffix: track.suffix,
      sourceBitRate: track.bitRate,
      sourceBitDepth: track.bitDepth,
      sourceSamplingRate: track.samplingRate,
      formatSetting: downloadFormat,
      bitRateSetting: downloadMaxBitRate,
    });
    musicCacheStore.getState().setDownloadedFormat(track.id, effectiveFmt);

    return {
      id: track.id,
      title: track.title ?? 'Unknown',
      artist: track.artist ?? i18n.t('unknownArtist'),
      coverArt: track.coverArt,
      fileName,
      bytes,
      duration: track.duration ?? 0,
    };
  } catch {
    clearDownload(track.id);
    const tmpFile = new File(itemDir, tmpName);
    if (tmpFile.exists) {
      try { tmpFile.delete(); } catch { /* best-effort */ }
    }
    return null;
  }
}

/**
 * Retry a failed download queue item. Cleans up incomplete .tmp files
 * while preserving already-downloaded tracks, then resets the item to
 * 'queued' so processQueue() picks it up. downloadItem() will skip
 * tracks that already exist in trackUriMap.
 */
export async function retryDownload(queueId: string): Promise<void> {
  const item = musicCacheStore.getState().downloadQueue.find(
    (q) => q.queueId === queueId,
  );
  if (!item || item.status !== 'error') return;

  await cleanupTmpFiles(item.itemId);

  musicCacheStore.getState().updateQueueItem(queueId, {
    status: 'queued',
    error: undefined,
  });

  // Move the retried item to just after the last queued/downloading item
  // so it doesn't jump ahead of items already waiting.
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

/**
 * Re-download an entire cached item. Deletes its files and
 * re-enqueues it for a fresh download with current settings.
 */
export async function redownloadItem(itemId: string): Promise<void> {
  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (!cached) return;

  deleteCachedItem(itemId);

  if (cached.type === 'album') {
    await enqueueAlbumDownload(itemId);
  } else if (cached.type === 'playlist') {
    await enqueuePlaylistDownload(itemId);
  } else {
    // 'song' – reconstruct a minimal Child from cached metadata and re-enqueue
    if (cached.tracks.length > 0) {
      const t = cached.tracks[0];
      await enqueueSongDownload({
        id: t.id,
        title: t.title,
        artist: t.artist,
        coverArt: t.coverArt,
        isDir: false,
      } as Child);
    }
  }
}

/**
 * Re-download a single track within a cached item.
 * Deletes the old file, downloads a fresh copy with current quality
 * settings, and updates the store entry.
 */
export async function redownloadTrack(
  itemId: string,
  trackId: string,
): Promise<boolean> {
  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (!cached) return false;

  const trackIndex = cached.tracks.findIndex((t) => t.id === trackId);
  if (trackIndex === -1) return false;

  const oldTrack = cached.tracks[trackIndex];
  const itemDir = new Directory(ensureCacheDir(), itemId);
  if (!itemDir.exists) itemDir.create();

  const oldFile = new File(itemDir, oldTrack.fileName);
  if (oldFile.exists) {
    try { oldFile.delete(); } catch { /* best-effort */ }
  }
  trackUriMap.delete(trackId);

  await ensureCoverArtAuth();
  const url = getDownloadStreamUrl(trackId);
  if (!url) return false;

  const { downloadFormat, downloadMaxBitRate } = playbackSettingsStore.getState();
  const ext = downloadFormat !== 'raw'
    ? downloadFormat
    : oldTrack.fileName.replace(/^.*\./, '') || 'dat';
  const fileName = `${trackId}.${ext}`;

  try {
    const dest = new File(itemDir, fileName);
    await File.downloadFileAsync(url, dest);
    const bytes = dest.exists ? dest.size ?? 0 : 0;

    const updatedTrack: CachedTrack = {
      ...oldTrack,
      fileName,
      bytes,
    };

    trackUriMap.set(trackId, dest.uri);
    musicCacheStore.getState().updateCachedTrack(
      itemId, trackIndex, updatedTrack, oldTrack.bytes,
    );

    // Stamp the effective format for this re-download.
    // Source Child data isn't available here — use what we can derive.
    const effectiveFmt = resolveEffectiveFormat({
      sourceSuffix: oldTrack.fileName.replace(/^.*\./, '') || undefined,
      sourceBitRate: null,
      formatSetting: downloadFormat,
      bitRateSetting: downloadMaxBitRate,
    });
    musicCacheStore.getState().setDownloadedFormat(trackId, effectiveFmt);

    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Cache management                                                   */
/* ------------------------------------------------------------------ */

/** Delete all cached files for a single album or playlist. */
export function deleteCachedItem(itemId: string): void {
  if (!itemId) return;

  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (cached) {
    for (const track of cached.tracks) {
      trackUriMap.delete(track.id);
      trackToItems.get(track.id)?.delete(itemId);
      musicCacheStore.getState().clearDownloadedFormat(track.id);
    }
  }

  const subDir = new Directory(ensureCacheDir(), itemId);
  if (subDir.exists) {
    try { subDir.delete(); } catch { /* best-effort */ }
  }

  musicCacheStore.getState().removeCachedItem(itemId);
  resumeIfSpaceAvailable();
}

/**
 * Remove a single track from a cached playlist and delete the file
 * from disk if no other cached item references the same trackId.
 */
export function removeCachedPlaylistTrack(itemId: string, trackIndex: number): void {
  const cached = musicCacheStore.getState().cachedItems[itemId];
  if (!cached || cached.type !== 'playlist') return;
  if (trackIndex < 0 || trackIndex >= cached.tracks.length) return;

  const track = cached.tracks[trackIndex];

  trackToItems.get(track.id)?.delete(itemId);
  const remainingRefs = trackToItems.get(track.id);
  const isOrphan = !remainingRefs || remainingRefs.size === 0;

  if (isOrphan) {
    trackUriMap.delete(track.id);
    musicCacheStore.getState().clearDownloadedFormat(track.id);
    const itemDir = new Directory(ensureCacheDir(), itemId);
    if (itemDir.exists) {
      const file = new File(itemDir, track.fileName);
      if (file.exists) {
        try { file.delete(); } catch { /* best-effort */ }
      }
    }
  }

  musicCacheStore.getState().removeCachedTrack(itemId, trackIndex);
}

/**
 * Reorder a track within a cached playlist. No file changes needed.
 */
export function reorderCachedPlaylistTracks(
  itemId: string,
  fromIndex: number,
  toIndex: number,
): void {
  musicCacheStore.getState().reorderCachedTracks(itemId, fromIndex, toIndex);
}

/**
 * Sync a cached playlist's track list to match a new ordered set of
 * track IDs (after server-side reorder/removal). Removes orphan files
 * for tracks that are no longer in any cached item.
 */
export function syncCachedPlaylistTracks(
  playlistId: string,
  newTrackIds: string[],
): void {
  const cached = musicCacheStore.getState().cachedItems[playlistId];
  if (!cached || cached.type !== 'playlist') return;

  const keepSet = new Set(newTrackIds);

  for (const track of cached.tracks) {
    if (keepSet.has(track.id)) continue;
    trackToItems.get(track.id)?.delete(playlistId);
    const remaining = trackToItems.get(track.id);
    if (!remaining || remaining.size === 0) {
      trackUriMap.delete(track.id);
      const itemDir = new Directory(ensureCacheDir(), playlistId);
      if (itemDir.exists) {
        const file = new File(itemDir, track.fileName);
        if (file.exists) {
          try { file.delete(); } catch { /* best-effort */ }
        }
      }
    }
  }

  const trackMap = new Map(cached.tracks.map((t) => [t.id, t]));
  const newTracks = newTrackIds
    .map((tid) => trackMap.get(tid))
    .filter((t): t is CachedTrack => t != null);

  const newTotalBytes = newTracks.reduce((sum, t) => sum + t.bytes, 0);
  const removedBytes = cached.totalBytes - newTotalBytes;
  const removedFiles = cached.tracks.length - newTracks.length;

  const state = musicCacheStore.getState();
  musicCacheStore.setState({
    cachedItems: {
      ...state.cachedItems,
      [playlistId]: { ...cached, tracks: newTracks, totalBytes: newTotalBytes },
    },
    totalBytes: Math.max(0, state.totalBytes - removedBytes),
    totalFiles: Math.max(0, state.totalFiles - removedFiles),
  });
}

/**
 * Full sync for a cached item: removes tracks no longer present and
 * re-enqueues through the download queue when new tracks are detected.
 * Going through the queue lets the DownloadBanner show progress and
 * reuses the standard downloadItem() pipeline (which skips tracks
 * already on disk via trackUriMap).
 *
 * Byte accounting: removals are handled by syncCachedPlaylistTracks
 * (decrements totalBytes). For additions we splice the item out of
 * cachedItems *without* adjusting totalBytes (the bytes are still on
 * disk) and enqueue it -- downloadItem() only calls addBytes() for
 * genuinely new tracks, keeping the running total correct.
 */
export function syncCachedItemTracks(
  itemId: string,
  newTracks: Child[],
): void {
  const state = musicCacheStore.getState();
  const cached = state.cachedItems[itemId];
  if (!cached) return;
  if (state.downloadQueue.some((q) => q.itemId === itemId)) return;

  const newTrackIds = newTracks.map((t) => t.id);
  const cachedTrackIds = new Set(cached.tracks.map((t) => t.id));

  syncCachedPlaylistTracks(itemId, newTrackIds);

  const hasNewTracks = newTracks.some((t) => !cachedTrackIds.has(t.id));
  if (!hasNewTracks) return;

  // Re-read state after removals
  const updated = musicCacheStore.getState();
  const updatedCached = updated.cachedItems[itemId];
  if (!updatedCached) return;

  // Move from cachedItems to queue without adjusting byte/file totals
  const { [itemId]: _, ...restCachedItems } = updated.cachedItems;
  musicCacheStore.setState({ cachedItems: restCachedItems });

  musicCacheStore.getState().enqueue({
    itemId,
    type: updatedCached.type,
    name: updatedCached.name,
    artist: updatedCached.artist,
    coverArtId: updatedCached.coverArtId,
    totalTracks: newTracks.length,
    tracks: newTracks,
  });

  processQueue();
}

/**
 * Cancel a queued or in-progress download and remove its partial files.
 *
 * After deleting files, schedules a background recalculate from the
 * filesystem to correct totalBytes/totalFiles — removeFromQueue does
 * not subtract the bytes that addBytes() accumulated during the
 * partial download, so without recalculation those "phantom" bytes
 * would inflate the displayed cache size.
 */
export function cancelDownload(queueId: string): void {
  const item = musicCacheStore.getState().downloadQueue.find(
    (q) => q.queueId === queueId,
  );
  if (!item) return;

  musicCacheStore.getState().removeFromQueue(queueId);

  const subDir = new Directory(ensureCacheDir(), item.itemId);
  if (subDir.exists) {
    try { subDir.delete(); } catch { /* best-effort */ }
  }

  for (const track of item.tracks) {
    trackUriMap.delete(track.id);
    trackToItems.get(track.id)?.delete(item.itemId);
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
    musicCacheStore.getState().removeFromQueue(item.queueId);

    if (!(item.itemId in musicCacheStore.getState().cachedItems)) {
      const subDir = new Directory(ensureCacheDir(), item.itemId);
      if (subDir.exists) {
        try { subDir.delete(); } catch { /* best-effort */ }
      }
    }

    for (const track of item.tracks) {
      trackUriMap.delete(track.id);
      trackToItems.get(track.id)?.delete(item.itemId);
    }
  }
  scheduleRecalculate();
  resumeIfSpaceAvailable();
}

/**
 * Delete all cached music and recreate the cache directory.
 * Returns the number of bytes freed. Directory size runs on a native
 * background thread via expo-async-fs.
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
 * Calculate cache statistics. Directory size and listing run on
 * native background threads via expo-async-fs, keeping the JS
 * thread free for UI rendering.
 */
export async function getMusicCacheStats(): Promise<MusicCacheStats> {
  const dir = ensureCacheDir();
  const totalBytes = await getDirectorySizeAsync(dir.uri);

  let itemCount = 0;
  let totalFiles = 0;
  try {
    const entryNames = await listDirectoryAsync(dir.uri);
    for (const name of entryNames) {
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
 * addBytes() calls during partial downloads whose files were then
 * deleted.
 */
function scheduleRecalculate(): void {
  getMusicCacheStats()
    .then((stats) => musicCacheStore.getState().recalculate(stats))
    .catch(() => { /* non-critical: next app start will reconcile */ });
}

/* ------------------------------------------------------------------ */
/*  Storage limit resume                                               */
/* ------------------------------------------------------------------ */

/**
 * Re-evaluate the storage limit and resume the download queue if
 * space has become available (e.g. after a cache clear or settings
 * change).
 */
export function resumeIfSpaceAvailable(): void {
  if (!checkStorageLimit()) {
    processQueue();
  }
}

/* ------------------------------------------------------------------ */
/*  Starred songs (virtual playlist)                                   */
/* ------------------------------------------------------------------ */

/**
 * Download all currently starred songs as a virtual playlist.
 * Follows the enqueuePlaylistDownload pattern but sources tracks
 * from favoritesStore instead of fetching a Subsonic playlist.
 */
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
    type: 'playlist',
    name: 'Favorite Songs',
    coverArtId: STARRED_COVER_ART_ID,
    totalTracks: songs.length,
    tracks: songs,
  });

  processQueue();
}

/** Remove the starred-songs download and delete its cached files. */
export function deleteStarredSongsDownload(): void {
  deleteCachedItem(STARRED_SONGS_ITEM_ID);
}

/**
 * Keep the starred-songs cache in sync with the current favorites.
 * Removes tracks that were unstarred and enqueues downloads for
 * newly starred tracks via the generic syncCachedItemTracks.
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

  syncCachedItemTracks(STARRED_SONGS_ITEM_ID, songs);
}

// Auto-sync starred songs whenever the favorites song list changes.
// Guard: skip if track maps haven't been populated yet — running the
// sync with empty trackUriMap/trackToItems causes incorrect reference
// counting (files deleted despite belonging to other cached items) and
// premature removal of __starred__ from cachedItems.  The deferred
// sync runs at the end of populateTrackMapsAsync() instead.
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
