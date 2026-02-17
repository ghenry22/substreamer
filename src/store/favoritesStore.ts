import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

import {
  ensureCoverArtAuth,
  getStarred2,
  type AlbumID3,
  type ArtistID3,
  type Child,
} from '../services/subsonicService';

export interface FavoritesState {
  /** Starred songs */
  songs: Child[];
  /** Starred albums */
  albums: AlbumID3[];
  /** Starred artists */
  artists: ArtistID3[];
  /** Whether a fetch is currently in progress */
  loading: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Timestamp of the last successful fetch */
  lastFetchedAt: number | null;
  /**
   * Optimistic overrides keyed by item ID.
   * When present, `useIsStarred` reads from here instead of the arrays,
   * giving instant UI feedback before `fetchStarred` completes.
   * Cleared automatically when `fetchStarred` succeeds.
   */
  overrides: Record<string, boolean>;

  /** Fetch all starred items from the server via getStarred2. */
  fetchStarred: () => Promise<void>;
  /** Set an optimistic override for a single item. */
  setOverride: (id: string, starred: boolean) => void;
  /** Clear all favorites data */
  clearFavorites: () => void;
}

const PERSIST_KEY = 'substreamer-favorites';

export const favoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      songs: [],
      albums: [],
      artists: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
      overrides: {},

      fetchStarred: async () => {
        // Prevent duplicate fetches
        if (get().loading) return;

        set({ loading: true, error: null });
        try {
          await ensureCoverArtAuth();
          const { albums, artists, songs } = await getStarred2();

          set({
            songs,
            albums,
            artists,
            loading: false,
            lastFetchedAt: Date.now(),
            overrides: {},
          });
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load favorites',
          });
        }
      },

      setOverride: (id: string, starred: boolean) =>
        set((s) => ({ overrides: { ...s.overrides, [id]: starred } })),

      clearFavorites: () =>
        set({
          songs: [],
          albums: [],
          artists: [],
          loading: false,
          error: null,
          lastFetchedAt: null,
          overrides: {},
        }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        songs: state.songs,
        albums: state.albums,
        artists: state.artists,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);
