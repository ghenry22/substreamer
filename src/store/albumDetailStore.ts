import { create } from 'zustand';

import { cacheAllSizes, cacheEntityCoverArt } from '../services/imageCacheService';
import {
  ensureCoverArtAuth,
  getAlbum,
  type AlbumWithSongsID3,
} from '../services/subsonicService';
import { withTimeout } from '../utils/withTimeout';
import {
  clearDetailTables,
  deleteAlbumDetail,
  hydrateAlbumDetails,
  upsertAlbumDetail,
} from './persistence/detailTables';
import { ratingStore } from './ratingStore';
import { songIndexStore } from './songIndexStore';

/** Hard budget for a single album-detail fetch. */
const FETCH_TIMEOUT_MS = 15_000;

export interface AlbumDetailEntry {
  album: AlbumWithSongsID3;
  /** Timestamp (Date.now()) when this entry was fetched from the server. */
  retrievedAt: number;
}

export interface AlbumDetailState {
  /** Album details indexed by album ID (hydrated from SQLite on startup). */
  albums: Record<string, AlbumDetailEntry>;
  /** True after the on-start hydration from SQLite has populated `albums`. */
  hasHydrated: boolean;
  /** Fetch album from API, store it, and return it. Returns null on failure. */
  fetchAlbum: (id: string) => Promise<AlbumWithSongsID3 | null>;
  /** True if an entry for `id` already exists in memory. Cheap check used by
   *  the Phase-4 walk to skip already-cached albums. */
  hasEntry: (id: string) => boolean;
  /** Remove a single entry both in-memory and from the SQLite table. */
  removeEntry: (id: string) => void;
  /** Reap a batch of entries — used by Phase-5 library reconciliation. */
  removeEntries: (ids: readonly string[]) => void;
  /** Clear all cached album details (logout, force-resync). */
  clearAlbums: () => void;
  /** Called once at app start to load persisted rows into memory. */
  hydrateFromDb: () => void;
}

export const albumDetailStore = create<AlbumDetailState>()((set, get) => ({
  albums: {},
  hasHydrated: false,

  fetchAlbum: async (id: string) => {
    const result = await withTimeout(async () => {
      await ensureCoverArtAuth();
      const data = await getAlbum(id);
      if (data) {
        const ratingEntries: Array<{ id: string; serverRating: number }> = [
          { id: data.id, serverRating: data.userRating ?? 0 },
          ...(data.song ?? []).map((s) => ({ id: s.id, serverRating: s.userRating ?? 0 })),
        ];
        ratingStore.getState().reconcileRatings(ratingEntries);
        const retrievedAt = Date.now();
        // Update in-memory state first — subscribers see the new entry right
        // away. Persistence is explicit and runs after notify; per-row writes
        // are O(1) so this is effectively non-blocking.
        set({
          albums: {
            ...get().albums,
            [id]: { album: data, retrievedAt },
          },
        });
        upsertAlbumDetail(id, data, retrievedAt);
        // Route song-index writes through songIndexStore so its mutation
        // counter (and totalCount) stay consistent with the SQL table.
        songIndexStore.getState().upsertSongsForAlbum(id, data.song ?? []);

        // Proactively cache cover art for new IDs so they survive offline.
        if (data.coverArt) cacheAllSizes(data.coverArt).catch(() => { /* non-critical */ });
        if (data.song?.length) cacheEntityCoverArt(data.song);
      }
      return data;
    }, FETCH_TIMEOUT_MS);

    return result === 'timeout' ? null : result;
  },

  hasEntry: (id: string) => Object.prototype.hasOwnProperty.call(get().albums, id),

  removeEntry: (id: string) => {
    const { [id]: _removed, ...rest } = get().albums;
    set({ albums: rest });
    deleteAlbumDetail(id);
    songIndexStore.getState().deleteSongsForAlbums([id]);
  },

  removeEntries: (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const current = get().albums;
    const next: Record<string, AlbumDetailEntry> = {};
    const toDelete: string[] = [];
    for (const [aid, entry] of Object.entries(current)) {
      if (ids.includes(aid)) {
        toDelete.push(aid);
      } else {
        next[aid] = entry;
      }
    }
    if (toDelete.length === 0) return;
    set({ albums: next });
    for (const aid of toDelete) deleteAlbumDetail(aid);
    songIndexStore.getState().deleteSongsForAlbums(toDelete);
  },

  clearAlbums: () => {
    set({ albums: {} });
    // clearDetailTables wipes both album_details and song_index atomically.
    // Refresh the index store's counter so UI subscribers see the change.
    clearDetailTables();
    songIndexStore.getState().refreshCount();
  },

  hydrateFromDb: () => {
    // Idempotent re-read. Can be called multiple times (e.g. once at the
    // auth-rehydrated useEffect, once after migrations complete on splash)
    // without losing data — every write path is write-through so the SQL
    // table is the canonical source of truth.
    const restored = hydrateAlbumDetails();
    set({ albums: restored, hasHydrated: true });
  },
}));
