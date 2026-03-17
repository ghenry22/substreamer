import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

import { getGenres, type Genre } from '../services/subsonicService';

export interface GenreState {
  genres: Genre[];
  lastFetchedAt: number | null;
  fetchGenres: () => Promise<void>;
}

const PERSIST_KEY = 'substreamer-genres';

export const genreStore = create<GenreState>()(
  persist(
    (set) => ({
      genres: [],
      lastFetchedAt: null,

      fetchGenres: async () => {
        const genres = await getGenres();
        if (genres) {
          set({ genres, lastFetchedAt: Date.now() });
        }
      },
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        genres: state.genres,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);
