import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

import {
  ensureCoverArtAuth,
  getAllArtists,
  type ArtistID3,
  type ArtistID3WithRating,
} from '../services/subsonicService';
import { ratingStore } from './ratingStore';

export interface ArtistLibraryState {
  /** All artists in the user's library */
  artists: ArtistID3[];
  /** Whether a fetch is currently in progress */
  loading: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Timestamp of the last successful fetch */
  lastFetchedAt: number | null;

  /** Fetch all artists from the server via getArtists. */
  fetchAllArtists: () => Promise<void>;
  /** Clear all artist data */
  clearArtists: () => void;
}

const PERSIST_KEY = 'substreamer-artist-library';

export const artistLibraryStore = create<ArtistLibraryState>()(
  persist(
    (set, get) => ({
      artists: [],
      loading: false,
      error: null,
      lastFetchedAt: null,

      fetchAllArtists: async () => {
        // Prevent duplicate fetches
        if (get().loading) return;

        set({ loading: true, error: null });
        try {
          await ensureCoverArtAuth();
          const artists = await getAllArtists();

          ratingStore.getState().reconcileRatings(
            artists.map((a) => ({ id: a.id, serverRating: (a as ArtistID3WithRating).userRating ?? 0 }))
          );
          set({
            artists,
            loading: false,
            lastFetchedAt: Date.now(),
          });
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load artists',
          });
        }
      },

      clearArtists: () =>
        set({
          artists: [],
          loading: false,
          error: null,
          lastFetchedAt: null,
        }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        artists: state.artists,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);
