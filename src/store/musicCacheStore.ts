/**
 * Persistent Zustand store for offline music cache state.
 *
 * Tracks completed downloads (albums/playlists cached on disk),
 * the ordered download queue, aggregate disk usage / file counts,
 * and the user's max-concurrent-downloads preference.
 *
 * Disk layout (managed by musicCacheService):
 *   {Paths.document}/music-cache/{itemId}/{trackId}
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

import { type EffectiveFormat } from '../types/audio';
import { type Child } from '../services/subsonicService';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CachedTrack {
  id: string;
  title: string;
  artist: string;
  coverArt?: string;
  fileName: string;
  bytes: number;
  duration: number;
}

export interface CachedMusicItem {
  itemId: string;
  type: 'album' | 'playlist' | 'song';
  name: string;
  artist?: string;
  coverArtId?: string;
  tracks: CachedTrack[];
  totalBytes: number;
  downloadedAt: number;
}

export type DownloadItemStatus =
  | 'queued'
  | 'downloading'
  | 'complete'
  | 'error';

export interface DownloadQueueItem {
  queueId: string;
  itemId: string;
  type: 'album' | 'playlist' | 'song';
  name: string;
  artist?: string;
  coverArtId?: string;
  status: DownloadItemStatus;
  totalTracks: number;
  completedTracks: number;
  error?: string;
  addedAt: number;
  /** Full Child objects for each track -- needed to build stream URLs. */
  tracks: Child[];
}

export type MaxConcurrentDownloads = 1 | 3 | 5;

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

export interface MusicCacheState {
  cachedItems: Record<string, CachedMusicItem>;
  downloadQueue: DownloadQueueItem[];
  totalBytes: number;
  totalFiles: number;
  maxConcurrentDownloads: MaxConcurrentDownloads;
  /** Effective post-transcode format for each downloaded track, keyed by song ID. */
  downloadedFormats: Record<string, EffectiveFormat>;

  enqueue: (item: Omit<DownloadQueueItem, 'queueId' | 'status' | 'completedTracks' | 'addedAt'>) => void;
  removeFromQueue: (queueId: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  updateQueueItem: (queueId: string, update: Partial<Pick<DownloadQueueItem, 'status' | 'completedTracks' | 'error'>>) => void;
  markItemComplete: (queueId: string, cached: CachedMusicItem) => void;
  removeCachedItem: (itemId: string) => void;
  /** Replace a single track entry inside a cached item and adjust byte totals. */
  updateCachedTrack: (itemId: string, trackIndex: number, track: CachedTrack, oldBytes: number) => void;
  /** Reorder a track within a cached item's track list. */
  reorderCachedTracks: (itemId: string, fromIndex: number, toIndex: number) => void;
  /** Remove a track from a cached item by index and adjust totals. */
  removeCachedTrack: (itemId: string, trackIndex: number) => void;
  setMaxConcurrentDownloads: (max: MaxConcurrentDownloads) => void;
  /** Record the effective format for a downloaded track. */
  setDownloadedFormat: (songId: string, fmt: EffectiveFormat) => void;
  /** Remove the effective format entry when a downloaded track is deleted. */
  clearDownloadedFormat: (songId: string) => void;
  /** Increment totalBytes by a delta (called per-track during download). */
  addBytes: (bytes: number) => void;
  /** Increment totalFiles by a count (called per-track during download). */
  addFiles: (count: number) => void;
  reset: () => void;
  recalculate: (stats: { totalBytes: number; itemCount: number; totalFiles: number }) => void;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

const PERSIST_KEY = 'substreamer-music-cache';

export const musicCacheStore = create<MusicCacheState>()(
  persist(
    (set) => ({
      cachedItems: {},
      downloadQueue: [],
      totalBytes: 0,
      totalFiles: 0,
      maxConcurrentDownloads: 3,
      downloadedFormats: {},

      enqueue: (item) =>
        set((state) => {
          if (
            state.downloadQueue.some((q) => q.itemId === item.itemId) ||
            item.itemId in state.cachedItems
          ) {
            return state;
          }
          const queueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          return {
            downloadQueue: [
              ...state.downloadQueue,
              { ...item, queueId, status: 'queued', completedTracks: 0, addedAt: Date.now() },
            ],
          };
        }),

      removeFromQueue: (queueId) =>
        set((state) => ({
          downloadQueue: state.downloadQueue.filter((q) => q.queueId !== queueId),
        })),

      reorderQueue: (fromIndex, toIndex) =>
        set((state) => {
          const queue = [...state.downloadQueue];
          if (
            fromIndex < 0 || fromIndex >= queue.length ||
            toIndex < 0 || toIndex >= queue.length ||
            fromIndex === toIndex
          ) {
            return state;
          }
          const [item] = queue.splice(fromIndex, 1);
          queue.splice(toIndex, 0, item);
          return { downloadQueue: queue };
        }),

      updateQueueItem: (queueId, update) =>
        set((state) => ({
          downloadQueue: state.downloadQueue.map((q) =>
            q.queueId === queueId ? { ...q, ...update } : q,
          ),
        })),

      // Bytes and file counts are already incremented per-track during
      // download, so markItemComplete only moves the item to cachedItems.
      markItemComplete: (queueId, cached) =>
        set((state) => ({
          downloadQueue: state.downloadQueue.filter((q) => q.queueId !== queueId),
          cachedItems: { ...state.cachedItems, [cached.itemId]: cached },
        })),

      removeCachedItem: (itemId) =>
        set((state) => {
          const item = state.cachedItems[itemId];
          if (!item) return state;
          const { [itemId]: _, ...rest } = state.cachedItems;
          return {
            cachedItems: rest,
            totalBytes: Math.max(0, state.totalBytes - item.totalBytes),
            totalFiles: Math.max(0, state.totalFiles - item.tracks.length),
          };
        }),

      updateCachedTrack: (itemId, trackIndex, track, oldBytes) =>
        set((state) => {
          const item = state.cachedItems[itemId];
          if (!item || trackIndex < 0 || trackIndex >= item.tracks.length) return state;
          const tracks = [...item.tracks];
          tracks[trackIndex] = track;
          const bytesDelta = track.bytes - oldBytes;
          return {
            cachedItems: {
              ...state.cachedItems,
              [itemId]: { ...item, tracks, totalBytes: item.totalBytes + bytesDelta },
            },
            totalBytes: state.totalBytes + bytesDelta,
          };
        }),

      reorderCachedTracks: (itemId, fromIndex, toIndex) =>
        set((state) => {
          const item = state.cachedItems[itemId];
          if (!item) return state;
          const tracks = [...item.tracks];
          if (
            fromIndex < 0 || fromIndex >= tracks.length ||
            toIndex < 0 || toIndex >= tracks.length ||
            fromIndex === toIndex
          ) return state;
          const [moved] = tracks.splice(fromIndex, 1);
          tracks.splice(toIndex, 0, moved);
          return {
            cachedItems: { ...state.cachedItems, [itemId]: { ...item, tracks } },
          };
        }),

      removeCachedTrack: (itemId, trackIndex) =>
        set((state) => {
          const item = state.cachedItems[itemId];
          if (!item || trackIndex < 0 || trackIndex >= item.tracks.length) return state;
          const removed = item.tracks[trackIndex];
          const tracks = item.tracks.filter((_, i) => i !== trackIndex);
          return {
            cachedItems: {
              ...state.cachedItems,
              [itemId]: {
                ...item,
                tracks,
                totalBytes: item.totalBytes - removed.bytes,
              },
            },
            totalBytes: Math.max(0, state.totalBytes - removed.bytes),
            totalFiles: Math.max(0, state.totalFiles - 1),
          };
        }),

      setMaxConcurrentDownloads: (max) => set({ maxConcurrentDownloads: max }),

      setDownloadedFormat: (songId, fmt) =>
        set((state) => ({
          downloadedFormats: { ...state.downloadedFormats, [songId]: fmt },
        })),

      clearDownloadedFormat: (songId) =>
        set((state) => {
          if (!(songId in state.downloadedFormats)) return state;
          const { [songId]: _, ...rest } = state.downloadedFormats;
          return { downloadedFormats: rest };
        }),

      addBytes: (bytes) =>
        set((state) => ({ totalBytes: state.totalBytes + bytes })),

      addFiles: (count) =>
        set((state) => ({ totalFiles: state.totalFiles + count })),

      reset: () =>
        set({ cachedItems: {}, downloadQueue: [], totalBytes: 0, totalFiles: 0, downloadedFormats: {} }),

      recalculate: (stats) =>
        set({ totalBytes: stats.totalBytes, totalFiles: stats.totalFiles }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        cachedItems: state.cachedItems,
        downloadQueue: state.downloadQueue,
        totalBytes: state.totalBytes,
        totalFiles: state.totalFiles,
        maxConcurrentDownloads: state.maxConcurrentDownloads,
        downloadedFormats: state.downloadedFormats,
      }),
    }
  )
);
