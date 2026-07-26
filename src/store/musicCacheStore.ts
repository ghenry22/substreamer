/**
 * Persistent Zustand store for offline music cache state (v2).
 *
 * Rewritten in the music-downloads v2 re-architecture — see
 * `plans/music-downloads-v2.md`. The store no longer uses the blob-based
 * `persist(createJSONStorage(...))` middleware. Instead:
 *   - `cachedSongs`, `cachedItems`, and `downloadQueue` are persisted per-row
 *     via `./persistence/musicCacheTables`.
 *   - `maxConcurrentDownloads` is persisted as a tiny JSON blob under
 *     `substreamer-music-cache-settings` in `kvStorage`.
 *   - `totalBytes` / `totalFiles` are derived aggregates, recomputed from the
 *     filesystem on startup via `recalculate(...)` (the service layer owns
 *     the walk).
 *
 * Every action writes through to the persistence layer BEFORE mutating the
 * in-memory state, so an observer reacting to the store change can trust that
 * disk is already in sync. This mirrors the pattern established in
 * `completedScrobbleStore`.
 */

import { create } from 'zustand';

import { type Child } from 'subsonic-api';

import {
  clearAllMusicCacheRows,
  orphanSongIfUnreferencedAsync,
  deleteCachedItem as deleteCachedItemRow,
  deleteCachedSong as deleteCachedSongRow,
  hydrateCachedItemsAsync,
  hydrateCachedSongsAsync,
  hydrateDownloadQueueAsync,
  insertDownloadQueueItem,
  markDownloadComplete,
  removeCachedItemSong as removeCachedItemSongRow,
  removeDownloadQueueItem,
  reorderCachedItemSongs as reorderCachedItemSongsRow,
  reorderDownloadQueue,
  updateDownloadQueueItem,
  upsertCachedItem as upsertCachedItemRow,
  upsertCachedSong as upsertCachedSongRow,
  type CachedItemRow,
  type CachedSongRow,
  type DownloadQueueRow,
} from './persistence/musicCacheTables';
// Synchronous adapter: the settings blob (maxConcurrentDownloads) is read via
// a synchronous helper; the bulk cache data hydrates via per-row tables.
import { kvStorageSync as kvStorage } from './persistence';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Cached-song metadata. Re-exported from the persistence layer so consumers
 *  import a single canonical shape from the store. */
export type CachedSongMeta = CachedSongRow;

/** Cached-item metadata with ordered song IDs (derived from edges). */
export type CachedItemMeta = CachedItemRow;

/** Persisted download-queue item. */
export type DownloadQueueItem = DownloadQueueRow;

export type MaxConcurrentDownloads = 1 | 3 | 5;

/** Shape of the settings blob stored at `SETTINGS_KEY`. */
interface MusicCacheSettings {
  maxConcurrentDownloads: MaxConcurrentDownloads;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = 'substreamer-music-cache-settings';
const DEFAULT_MAX_CONCURRENT: MaxConcurrentDownloads = 3;

/* ------------------------------------------------------------------ */
/*  Settings blob helpers                                              */
/* ------------------------------------------------------------------ */

function readSettingsBlob(): MusicCacheSettings {
  // kvStorage.getItem is synchronous in our backing implementation, but
  // its Zustand StateStorage type signature permits async returns. Narrow
  // to string | null for the sync path we actually use.
  const raw = kvStorage.getItem(SETTINGS_KEY) as string | null;
  if (raw === null) {
    return { maxConcurrentDownloads: DEFAULT_MAX_CONCURRENT };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MusicCacheSettings>;
    const max = parsed?.maxConcurrentDownloads;
    if (max === 1 || max === 3 || max === 5) {
      return { maxConcurrentDownloads: max };
    }
    return { maxConcurrentDownloads: DEFAULT_MAX_CONCURRENT };
  } catch {
    return { maxConcurrentDownloads: DEFAULT_MAX_CONCURRENT };
  }
}

function writeSettingsBlob(settings: MusicCacheSettings): void {
  try {
    kvStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* dropped — next launch falls back to defaults */
  }
}

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

export interface MusicCacheState {
  // Data (hydrated from musicCacheTables on startup)
  cachedSongs: Record<string, CachedSongMeta>;
  cachedItems: Record<string, CachedItemMeta>;
  downloadQueue: DownloadQueueItem[];

  // Settings (persisted as a tiny JSON blob)
  maxConcurrentDownloads: MaxConcurrentDownloads;

  // Derived aggregates (rebuilt from filesystem via recalculate())
  totalBytes: number;
  totalFiles: number;

  // Lifecycle
  hasHydrated: boolean;

  /* Queue actions */
  enqueue: (
    draft: Omit<
      DownloadQueueItem,
      'queueId' | 'status' | 'completedSongs' | 'addedAt' | 'queuePosition'
    >,
  ) => void;
  /**
   * Variant of `enqueue` that skips the "already in cachedItems" short-circuit.
   * Used by `enqueueAlbumDownload` for top-up flows where the album already
   * has a partial `cached_items` row and we want to download the missing
   * songs. Still dedupes against an existing queue entry for the same itemId.
   */
  enqueueTopUp: (
    draft: Omit<
      DownloadQueueItem,
      'queueId' | 'status' | 'completedSongs' | 'addedAt' | 'queuePosition'
    >,
  ) => void;
  removeFromQueue: (queueId: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  updateQueueItem: (
    queueId: string,
    update: Partial<Pick<DownloadQueueItem, 'status' | 'completedSongs' | 'error'>>,
  ) => void;
  /**
   * Finalise a download: remove the queue row, upsert the item + songs, and
   * insert the edges -- atomic in SQL, then mirrored in memory.
   */
  markItemComplete: (
    queueId: string,
    item: Omit<CachedItemMeta, 'songIds'>,
    songs: CachedSongMeta[],
    edges: Array<{ songId: string; position: number }>,
  ) => void;

  /* Cached item / song actions */
  upsertCachedItem: (
    item: Omit<CachedItemMeta, 'songIds'>,
    songIds?: string[],
  ) => void;
  /**
   * Delete a cached item. Returns the list of songIds whose refcount dropped
   * to zero as a result (so the service layer can delete the files). The
   * store itself has already removed the orphan songs from `cachedSongs`.
   */
  removeCachedItem: (itemId: string) => Promise<string[]>;
  /**
   * Remove a single song at `position` from an item. Returns the song id if
   * that song became orphan (so service can delete its file); `null` if the
   * song is still referenced by another item.
   */
  removeCachedItemSong: (
    itemId: string,
    position: number,
  ) => Promise<{ orphanedSongId: string | null }>;
  reorderCachedItemSongs: (
    itemId: string,
    fromPosition: number,
    toPosition: number,
  ) => void;
  upsertCachedSong: (song: CachedSongMeta) => void;
  deleteCachedSong: (songId: string) => void;

  /* Settings + aggregates */
  setMaxConcurrentDownloads: (n: MaxConcurrentDownloads) => void;
  addBytes: (bytes: number) => void;
  addFiles: (count: number) => void;
  recalculate: (stats: { totalBytes: number; totalFiles: number }) => void;

  /* Lifecycle */
  reset: () => void;
  /** Load cached songs/items/queue on a background thread with chunked
   * mapping. Called once at app start via `rehydrateAllStores`. */
  hydrateFromDbAsync: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

function generateQueueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const musicCacheStore = create<MusicCacheState>()((set, get) => ({
  cachedSongs: {},
  cachedItems: {},
  downloadQueue: [],

  maxConcurrentDownloads: DEFAULT_MAX_CONCURRENT,

  totalBytes: 0,
  totalFiles: 0,

  hasHydrated: false,

  enqueue: (draft) => {
    const state = get();
    // Dedupe: skip if same itemId is already queued or already cached.
    if (
      state.downloadQueue.some((q) => q.itemId === draft.itemId) ||
      draft.itemId in state.cachedItems
    ) {
      return;
    }
    const maxPosition = state.downloadQueue.reduce(
      (max, q) => (q.queuePosition > max ? q.queuePosition : max),
      0,
    );
    const full: DownloadQueueItem = {
      ...draft,
      queueId: generateQueueId(),
      status: 'queued',
      completedSongs: 0,
      addedAt: Date.now(),
      queuePosition: maxPosition + 1,
    };
    insertDownloadQueueItem(full);
    set({ downloadQueue: [...state.downloadQueue, full] });
  },

  enqueueTopUp: (draft) => {
    const state = get();
    // Only dedupe against an existing queue entry. Partial `cachedItems` rows
    // are expected for top-ups and must not block the enqueue.
    if (state.downloadQueue.some((q) => q.itemId === draft.itemId)) return;
    const maxPosition = state.downloadQueue.reduce(
      (max, q) => (q.queuePosition > max ? q.queuePosition : max),
      0,
    );
    const full: DownloadQueueItem = {
      ...draft,
      queueId: generateQueueId(),
      status: 'queued',
      completedSongs: 0,
      addedAt: Date.now(),
      queuePosition: maxPosition + 1,
    };
    insertDownloadQueueItem(full);
    set({ downloadQueue: [...state.downloadQueue, full] });
  },

  removeFromQueue: (queueId) => {
    removeDownloadQueueItem(queueId);
    set((state) => ({
      downloadQueue: state.downloadQueue.filter((q) => q.queueId !== queueId),
    }));
  },

  reorderQueue: (fromIndex, toIndex) => {
    const state = get();
    const queue = state.downloadQueue;
    if (
      fromIndex < 0 ||
      fromIndex >= queue.length ||
      toIndex < 0 ||
      toIndex >= queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    // Persistence layer uses 1-indexed positions. The store's array API is
    // 0-indexed to match RN reorderable-list conventions.
    reorderDownloadQueue(fromIndex + 1, toIndex + 1);
    const next = [...queue];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    set({ downloadQueue: next });
  },

  updateQueueItem: (queueId, update) => {
    updateDownloadQueueItem(queueId, update);
    set((state) => ({
      downloadQueue: state.downloadQueue.map((q) =>
        q.queueId === queueId ? { ...q, ...update } : q,
      ),
    }));
  },

  markItemComplete: (queueId, item, songs, edges) => {
    const existing = get().cachedItems[item.itemId];
    // For top-ups (existing row):
    //   - preserve `downloadedAt` (user "downloaded" this earlier).
    //   - preserve `expectedSongCount`. The worker derives it from
    //     `songs.length`, which for a top-up is only the *delta* (missing
    //     songs). The existing row's `expectedSongCount` was already set by
    //     `enqueueAlbumDownload` from the fresh server fetch, so it's the
    //     authoritative album total. Clobbering it would misclassify a
    //     later remove-with-survivors as "complete" when it's actually
    //     partial.
    const itemToPersist: Omit<CachedItemMeta, 'songIds'> = existing
      ? {
          ...item,
          downloadedAt: existing.downloadedAt,
          expectedSongCount: existing.expectedSongCount,
        }
      : item;

    markDownloadComplete(queueId, itemToPersist, songs, edges);

    // New songIds from this run, in caller-supplied position order.
    const newSongIdsInOrder = [...edges]
      .sort((a, b) => a.position - b.position)
      .map((e) => e.songId);

    // Merge: keep existing order, append new songs that aren't already edged.
    let songIds: string[];
    if (existing) {
      const existingSet = new Set(existing.songIds);
      const additions = newSongIdsInOrder.filter((id) => !existingSet.has(id));
      songIds = [...existing.songIds, ...additions];
    } else {
      songIds = newSongIdsInOrder;
    }

    set((state) => {
      const nextSongs = { ...state.cachedSongs };
      for (const s of songs) {
        nextSongs[s.id] = s;
      }
      return {
        downloadQueue: state.downloadQueue.filter((q) => q.queueId !== queueId),
        cachedItems: {
          ...state.cachedItems,
          [item.itemId]: { ...itemToPersist, songIds },
        },
        cachedSongs: nextSongs,
      };
    });
  },

  upsertCachedItem: (item, songIds) => {
    // Optimistic-persist: fire the async row write; in-memory set() below is the
    // source of truth for the UI and self-heals on next hydrate.
    void upsertCachedItemRow(item);
    set((state) => {
      const existing = state.cachedItems[item.itemId];
      const nextSongIds =
        songIds !== undefined ? songIds : existing?.songIds ?? [];
      return {
        cachedItems: {
          ...state.cachedItems,
          [item.itemId]: { ...item, songIds: nextSongIds },
        },
      };
    });
  },

  removeCachedItem: async (itemId) => {
    const state = get();
    const item = state.cachedItems[itemId];
    const affectedSongIds = item?.songIds ?? [];
    // Optimistic: drop the item from memory immediately so the UI updates
    // without waiting on disk IO.
    set((prev) => {
      const nextItems = { ...prev.cachedItems };
      delete nextItems[itemId];
      return { cachedItems: nextItems };
    });
    // Persist: delete the item row (cascades its own edges), then — atomically
    // per song — orphan any song that lost its last REAL holder. The count +
    // orphan run in ONE transaction inside `orphanSongIfUnreferencedAsync`, so
    // no concurrent insert can add a holder between the count and the delete.
    await deleteCachedItemRow(itemId);
    const orphaned: string[] = [];
    const touchedHolders = new Set<string>();
    const prunedHolders = new Set<string>();
    for (const songId of affectedSongIds) {
      // eslint-disable-next-line no-await-in-loop
      const { orphaned: didOrphan, affectedItems, prunedItems } =
        await orphanSongIfUnreferencedAsync(songId);
      if (didOrphan) {
        orphaned.push(songId);
        affectedItems.forEach((i) => touchedHolders.add(i));
        prunedItems.forEach((i) => prunedHolders.add(i));
      }
    }
    // Reconcile in-memory with what actually got orphaned/pruned on disk.
    set((prev) => {
      const orphanSet = new Set(orphaned);
      const nextItems = { ...prev.cachedItems };
      for (const pid of prunedHolders) delete nextItems[pid];
      // Surviving derived holders that lost an orphaned song: drop it from songIds.
      for (const hid of touchedHolders) {
        if (prunedHolders.has(hid)) continue;
        const h = nextItems[hid];
        if (h) nextItems[hid] = { ...h, songIds: h.songIds.filter((s) => !orphanSet.has(s)) };
      }
      const nextSongs = { ...prev.cachedSongs };
      // Decrement the disk-usage aggregates by the orphaned songs' bytes/count
      // (symmetric with addBytes/addFiles on download; boot recomputes from
      // truth). Without this the card's file count + disk usage stay stale after
      // a delete even though the item count and lists update.
      let freedBytes = 0;
      for (const songId of orphaned) {
        freedBytes += prev.cachedSongs[songId]?.bytes ?? 0;
        delete nextSongs[songId];
      }
      return {
        cachedItems: nextItems,
        cachedSongs: nextSongs,
        totalBytes: Math.max(0, prev.totalBytes - freedBytes),
        totalFiles: Math.max(0, prev.totalFiles - orphaned.length),
      };
    });
    return orphaned;
  },

  removeCachedItemSong: async (itemId, position) => {
    const state = get();
    const item = state.cachedItems[itemId];
    if (!item) return { orphanedSongId: null };
    // position is 1-indexed in SQL; songIds array is 0-indexed.
    const index = position - 1;
    if (index < 0 || index >= item.songIds.length) {
      return { orphanedSongId: null };
    }
    const songId = item.songIds[index];
    // Optimistic: drop the edge from the item's in-memory songIds immediately.
    set((prev) => {
      const prevItem = prev.cachedItems[itemId];
      if (!prevItem) return {};
      const nextItems = { ...prev.cachedItems };
      nextItems[itemId] = {
        ...prevItem,
        songIds: prevItem.songIds.filter((_, i) => i !== index),
      };
      return { cachedItems: nextItems };
    });
    // Persist: remove the edge row (so a real-ref count of 0 means no OTHER real
    // holder remains), then atomically orphan the song iff unreferenced.
    await removeCachedItemSongRow(itemId, position);
    const { orphaned, affectedItems, prunedItems } =
      await orphanSongIfUnreferencedAsync(songId);
    if (!orphaned) return { orphanedSongId: null };
    const orphanedSongId = songId;
    set((prev) => {
      const nextItems = { ...prev.cachedItems };
      const prunedSet = new Set(prunedItems);
      for (const pid of prunedItems) delete nextItems[pid];
      // Surviving derived holders of the orphaned song lost it too.
      for (const hid of affectedItems) {
        if (prunedSet.has(hid) || hid === itemId) continue;
        const h = nextItems[hid];
        if (h) nextItems[hid] = { ...h, songIds: h.songIds.filter((s) => s !== orphanedSongId) };
      }
      // Decrement disk-usage aggregates for the single orphaned song (see
      // removeCachedItem).
      const freedBytes = prev.cachedSongs[orphanedSongId]?.bytes ?? 0;
      const { [orphanedSongId]: _gone, ...restSongs } = prev.cachedSongs;
      return {
        cachedItems: nextItems,
        cachedSongs: restSongs,
        totalBytes: Math.max(0, prev.totalBytes - freedBytes),
        totalFiles: Math.max(0, prev.totalFiles - 1),
      };
    });
    return { orphanedSongId };
  },

  reorderCachedItemSongs: (itemId, fromPosition, toPosition) => {
    const state = get();
    const item = state.cachedItems[itemId];
    if (!item) return;
    const fromIdx = fromPosition - 1;
    const toIdx = toPosition - 1;
    if (
      fromIdx < 0 ||
      fromIdx >= item.songIds.length ||
      toIdx < 0 ||
      toIdx >= item.songIds.length ||
      fromIdx === toIdx
    ) {
      return;
    }
    void reorderCachedItemSongsRow(itemId, fromPosition, toPosition);
    const nextSongIds = [...item.songIds];
    const [moved] = nextSongIds.splice(fromIdx, 1);
    nextSongIds.splice(toIdx, 0, moved);
    set((prev) => ({
      cachedItems: {
        ...prev.cachedItems,
        [itemId]: { ...prev.cachedItems[itemId], songIds: nextSongIds },
      },
    }));
  },

  upsertCachedSong: (song) => {
    void upsertCachedSongRow(song);
    set((state) => ({
      cachedSongs: { ...state.cachedSongs, [song.id]: song },
    }));
  },

  deleteCachedSong: (songId) => {
    void deleteCachedSongRow(songId);
    set((state) => {
      if (!(songId in state.cachedSongs)) return state;
      const { [songId]: _removed, ...rest } = state.cachedSongs;
      return { cachedSongs: rest };
    });
  },

  setMaxConcurrentDownloads: (n) => {
    writeSettingsBlob({ maxConcurrentDownloads: n });
    set({ maxConcurrentDownloads: n });
  },

  addBytes: (bytes) =>
    set((state) => ({ totalBytes: state.totalBytes + bytes })),

  addFiles: (count) =>
    set((state) => ({ totalFiles: state.totalFiles + count })),

  recalculate: ({ totalBytes, totalFiles }) =>
    set({ totalBytes, totalFiles }),

  reset: () => {
    void clearAllMusicCacheRows();
    try {
      kvStorage.removeItem(SETTINGS_KEY);
    } catch {
      /* dropped */
    }
    set({
      cachedSongs: {},
      cachedItems: {},
      downloadQueue: [],
      totalBytes: 0,
      totalFiles: 0,
      maxConcurrentDownloads: DEFAULT_MAX_CONCURRENT,
      hasHydrated: false,
    });
  },

  hydrateFromDbAsync: async () => {
    // Idempotent re-read; the per-row tables are the source of truth. SQLite
    // reads run on a background thread; `readSettingsBlob` stays sync (small
    // kvStorage blob).
    const cachedSongs = await hydrateCachedSongsAsync();
    const cachedItems = await hydrateCachedItemsAsync();
    const downloadQueue = await hydrateDownloadQueueAsync();
    const settings = readSettingsBlob();

    let totalBytes = 0;
    for (const songId of Object.keys(cachedSongs)) {
      totalBytes += cachedSongs[songId].bytes;
    }
    const totalFiles = Object.keys(cachedSongs).length;

    set({
      cachedSongs,
      cachedItems,
      downloadQueue,
      maxConcurrentDownloads: settings.maxConcurrentDownloads,
      totalBytes,
      totalFiles,
      hasHydrated: true,
    });
  },
}));

/* ------------------------------------------------------------------ */
/*  Convenience wrappers                                               */
/* ------------------------------------------------------------------ */

/**
 * Truncate the four music-cache tables. Exposed so `resetAllStores` can wipe
 * disk state without importing the persistence module directly.
 */
export async function clearMusicCacheTables(): Promise<void> {
  await clearAllMusicCacheRows();
}

/* ------------------------------------------------------------------ */
/*  Envelope accessors                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lazy-parse memoisation for song envelopes, keyed by the ROW object. A row is
 * replaced with a fresh object on every upsert and dropped on reset/clear, so
 * its WeakMap entry (the parsed `Child`) becomes unreachable and GCs naturally —
 * no manual invalidation. The previous design keyed a WeakMap off a per-`rawJson`
 * wrapper held in a plain Map that was never pruned, which pinned every parsed
 * envelope for the whole session (an unbounded leak that defeated the WeakMap).
 */
const songEnvelopeCache = new WeakMap<object, Child>();

/**
 * Return the full Subsonic `Child` envelope for a cached song, or `null`
 * when the row has no envelope yet (pre-Migration-18 rows that haven't
 * been backfilled, or a malformed `raw_json` value).
 */
export function getSongEnvelope(songId: string): Child | null {
  const row = musicCacheStore.getState().cachedSongs[songId];
  if (!row?.rawJson) return null;
  const cached = songEnvelopeCache.get(row);
  if (cached) return cached;
  try {
    const parsed = JSON.parse(row.rawJson) as Child;
    songEnvelopeCache.set(row, parsed);
    return parsed;
  } catch {
    return null;
  }
}
