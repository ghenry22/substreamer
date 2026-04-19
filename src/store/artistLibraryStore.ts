import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import i18n from '../i18n/i18n';

import { kvStorage } from './persistence';

import {
  ensureCoverArtAuth,
  getAllArtists,
  type ArtistID3,
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
            artists.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 }))
          );
          set({
            artists,
            loading: false,
            lastFetchedAt: Date.now(),
          });
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : i18n.t('failedToLoadArtists'),
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
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        artists: state.artists,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);
