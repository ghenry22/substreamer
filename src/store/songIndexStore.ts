import { create } from 'zustand';

import {
  countSongIndex,
  deleteSongsForAlbums as dbDeleteSongsForAlbums,
  upsertSongsForAlbum as dbUpsertSongsForAlbum,
} from './persistence/detailTables';
import type { Child } from '../services/subsonicService';

/**
 * Thin store over the `song_index` SQLite table.
 *
 * The persisted rows in SQLite are the source of truth. This store holds only
 * coordination state:
 *  - `totalCount` — running total of songs in the table (for settings UI)
 *  - `mutationCounter` — monotonic tick incremented on every write. UI code
 *    (the eventual Songs browser in Phase 7) subscribes to this and re-queries
 *    the database via paginated SELECTs when it changes.
 *
 * No in-memory copy of the songs themselves — the table is too large to keep
 * fully in JS, and we want the UI driven by SQL pagination.
 */
export interface SongIndexState {
  totalCount: number;
  mutationCounter: number;
  hasHydrated: boolean;

  /** Write one album's songs into the index, replacing any prior entries for that album. */
  upsertSongsForAlbum: (albumId: string, songs: Child[]) => void;
  /** Reap songs for a batch of albums (Phase-5 orphan reaping). */
  deleteSongsForAlbums: (albumIds: readonly string[]) => void;
  /** Reset and re-read the count from the database. */
  hydrateFromDb: () => void;
  /** Force-sync the in-store count with the live DB count (diagnostics). */
  refreshCount: () => void;
}

export const songIndexStore = create<SongIndexState>()((set, get) => ({
  totalCount: 0,
  mutationCounter: 0,
  hasHydrated: false,

  upsertSongsForAlbum: (albumId, songs) => {
    dbUpsertSongsForAlbum(albumId, songs);
    set({
      totalCount: countSongIndex(),
      mutationCounter: get().mutationCounter + 1,
    });
  },

  deleteSongsForAlbums: (albumIds) => {
    if (albumIds.length === 0) return;
    dbDeleteSongsForAlbums(albumIds);
    set({
      totalCount: countSongIndex(),
      mutationCounter: get().mutationCounter + 1,
    });
  },

  hydrateFromDb: () => {
    // Idempotent re-read — see `albumDetailStore.hydrateFromDb` for rationale.
    set({ totalCount: countSongIndex(), hasHydrated: true });
  },

  refreshCount: () => {
    set({ totalCount: countSongIndex() });
  },
}));
