/**
 * Offline music cache service.
 *
 * Downloads album and playlist tracks to {Paths.document}/music-cache/
 * for offline playback. Each album or playlist gets its own subdirectory
 * containing one file per track:
 *
 *   music-cache/{itemId}/{trackId}.{ext}
 *
 * Uses File.downloadFileAsync from expo-file-system for downloads.
 * Progress is tracked at the track-count level (not per-byte).
 * Queue processing follows the sequential pattern from scrobbleService
 * (one item at a time, configurable concurrent track downloads within
 * each item).
 */

import { Directory, File, Paths } from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';

import { listDirectoryAsync, getDirectorySizeAsync } from 'expo-async-fs';
import { checkStorageLimit } from './storageService';
import { albumDetailStore } from '../store/albumDetailStore';
import { favoritesStore } from '../store/favoritesStore';
import { storageLimitStore } from '../store/storageLimitStore';
import {
  musicCacheStore,
  type CachedMusicItem,
  type CachedTrack,
} from '../store/musicCacheStore';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import {
  ensureCoverArtAuth,
  getDownloadStreamUrl,
  type Child,
} from './subsonicService';
import { cacheAllSizes, getCachedImageUri } from './imageCacheService';

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
let appStateSubscription: { remove: () => void } | null = null;

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
  const dir = new Directory(Paths.document, CACHE_DIR_NAME);
  if (!dir.exists) {
    dir.create();
  }
  cacheDir = dir;

  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        recoverStalledDownloadsAsync();
      }
    });
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
  await recoverStalledDownloadsAsync();
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
 */
export async function recoverStalledDownloadsAsync(): Promise<void> {
  const { downloadQueue } = musicCacheStore.getState();
  for (const item of downloadQueue) {
    if (item.status !== 'downloading') continue;

    const itemDir = new Directory(ensureCacheDir(), item.itemId);
    if (itemDir.exists) {
      try {
        const entries = await listDirectoryAsync(itemDir.uri);
        for (const name of entries) {
          if (name.endsWith('.tmp')) {
            try { new File(itemDir, name).delete(); } catch { /* best-effort */ }
          }
        }
      } catch { /* best-effort */ }
    }

    musicCacheStore.getState().updateQueueItem(item.queueId, {
      status: 'queued',
      error: undefined,
    });
  }

  if (downloadQueue.some((q) => q.status === 'downloading' || q.status === 'queued')) {
    processQueue();
  }
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
  const seen = new Set<string>();
  for (const track of tracks) {
    if (track.coverArt && !seen.has(track.coverArt)) {
      seen.add(track.coverArt);
      if (!getCachedImageUri(track.coverArt, 300)) {
        cacheAllSizes(track.coverArt).catch(() => { /* non-critical */ });
      }
    }
  }
}

/**
 * Fetch album metadata, cache its cover art, and add it to the
 * download queue. Triggers queue processing immediately.
 */
export async function enqueueAlbumDownload(albumId: string): Promise<void> {
  const state = musicCacheStore.getState();
  if (albumId in state.cachedItems) return;
  if (state.downloadQueue.some((q) => q.itemId === albumId)) return;

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

  try {
    while (true) {
      if (checkStorageLimit()) break;

      const { downloadQueue } = musicCacheStore.getState();
      const next = downloadQueue.find((q) => q.status === 'queued');
      if (!next) break;

      musicCacheStore.getState().updateQueueItem(next.queueId, { status: 'downloading' });
      await downloadItem(next);
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Download all tracks for a single queue item using a concurrency pool.
 */
async function downloadItem(queueItem: DownloadQueueItemSnapshot): Promise<void> {
  const { maxConcurrentDownloads } = musicCacheStore.getState();
  const itemDir = new Directory(ensureCacheDir(), queueItem.itemId);
  if (!itemDir.exists) itemDir.create();

  const completedTracks: CachedTrack[] = [];
  const downloadedIds = new Set<string>();
  let totalBytes = 0;
  let trackIndex = 0;

  const downloadNext = async (): Promise<void> => {
    while (trackIndex < queueItem.tracks.length) {
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

      // Skip tracks that already exist on disk (e.g. resumed after app kill).
      const existingUri = trackUriMap.get(track.id);
      if (existingUri) {
        const existingFileName = existingUri.split('/').pop() ?? track.id;
        const existingFile = new File(itemDir, existingFileName);
        if (existingFile.exists) {
          const bytes = existingFile.size ?? 0;
          completedTracks.push({
            id: track.id,
            title: track.title ?? 'Unknown',
            artist: track.artist ?? 'Unknown Artist',
            fileName: existingFileName,
            bytes,
            duration: track.duration ?? 0,
          });
          totalBytes += bytes;
          if (!trackToItems.has(track.id)) trackToItems.set(track.id, new Set());
          trackToItems.get(track.id)!.add(queueItem.itemId);
          musicCacheStore.getState().updateQueueItem(queueItem.queueId, {
            completedTracks: completedTracks.length,
          });
          continue;
        }
      }

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
  type: 'album' | 'playlist';
  name: string;
  artist?: string;
  coverArtId?: string;
  tracks: Child[];
}>;

/**
 * Download a single track using the modern expo-file-system API.
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

  const ext = getTrackFileExtension(track);
  const fileName = `${track.id}.${ext}`;
  const tmpName = `${fileName}.tmp`;

  try {
    const tmpDest = new File(itemDir, tmpName);
    await File.downloadFileAsync(url, tmpDest);

    const dest = new File(itemDir, fileName);
    if (dest.exists) {
      try { dest.delete(); } catch { /* best-effort */ }
    }
    tmpDest.move(dest);

    const bytes = dest.exists ? dest.size ?? 0 : 0;

    return {
      id: track.id,
      title: track.title ?? 'Unknown',
      artist: track.artist ?? 'Unknown Artist',
      fileName,
      bytes,
      duration: track.duration ?? 0,
    };
  } catch {
    // Clean up partial tmp file on failure.
    const tmpFile = new File(itemDir, tmpName);
    if (tmpFile.exists) {
      try { tmpFile.delete(); } catch { /* best-effort */ }
    }
    return null;
  }
}

/**
 * Retry a failed download queue item. Resets its status to 'queued'
 * and re-triggers queue processing.
 */
export function retryDownload(queueId: string): void {
  const item = musicCacheStore.getState().downloadQueue.find(
    (q) => q.queueId === queueId,
  );
  if (!item || item.status !== 'error') return;

  const itemDir = new Directory(ensureCacheDir(), item.itemId);
  if (itemDir.exists) {
    try { itemDir.delete(); } catch { /* best-effort */ }
  }
  for (const track of item.tracks) {
    trackUriMap.delete(track.id);
    trackToItems.get(track.id)?.delete(item.itemId);
  }

  musicCacheStore.getState().updateQueueItem(queueId, {
    status: 'queued',
    completedTracks: 0,
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
  } else {
    await enqueuePlaylistDownload(itemId);
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

  const { downloadFormat } = playbackSettingsStore.getState();
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
favoritesStore.subscribe((state, prev) => {
  if (state.songs === prev.songs) return;
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
