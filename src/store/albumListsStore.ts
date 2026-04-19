import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

import {
  ensureCoverArtAuth,
  getFrequentlyPlayedAlbums,
  getRandomAlbums,
  getRecentlyAddedAlbums,
  getRecentlyPlayedAlbums,
  type AlbumID3,
} from '../services/subsonicService';
import { layoutPreferencesStore } from './layoutPreferencesStore';
import { ratingStore } from './ratingStore';

function reconcileAlbumRatings(albums: AlbumID3[]) {
  const entries = albums.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 }));
  ratingStore.getState().reconcileRatings(entries);
}

export type AlbumListType =
  | 'recentlyAdded'
  | 'recentlyPlayed'
  | 'frequentlyPlayed'
  | 'randomSelection';

export interface AlbumListsState {
  recentlyAdded: AlbumID3[];
  recentlyPlayed: AlbumID3[];
  frequentlyPlayed: AlbumID3[];
  randomSelection: AlbumID3[];
  setRecentlyAdded: (albums: AlbumID3[]) => void;
  setRecentlyPlayed: (albums: AlbumID3[]) => void;
  setFrequentlyPlayed: (albums: AlbumID3[]) => void;
  setRandomSelection: (albums: AlbumID3[]) => void;
  refreshRecentlyAdded: () => Promise<void>;
  refreshRecentlyPlayed: () => Promise<void>;
  refreshFrequentlyPlayed: () => Promise<void>;
  refreshRandomSelection: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const PERSIST_KEY = 'substreamer-album-lists';

export const albumListsStore = create<AlbumListsState>()(
  persist(
    (set, get) => ({
      recentlyAdded: [],
      recentlyPlayed: [],
      frequentlyPlayed: [],
      randomSelection: [],

      setRecentlyAdded: (albums) => set({ recentlyAdded: albums }),
      setRecentlyPlayed: (albums) => set({ recentlyPlayed: albums }),
      setFrequentlyPlayed: (albums) => set({ frequentlyPlayed: albums }),
      setRandomSelection: (albums) => set({ randomSelection: albums }),

      refreshRecentlyAdded: async () => {
        try {
          await ensureCoverArtAuth();
          const albums = await getRecentlyAddedAlbums(layoutPreferencesStore.getState().listLength);
          reconcileAlbumRatings(albums);
          set({ recentlyAdded: albums });
        } catch {
          set({ recentlyAdded: [] });
        }
      },

      refreshRecentlyPlayed: async () => {
        try {
          await ensureCoverArtAuth();
          const albums = await getRecentlyPlayedAlbums(layoutPreferencesStore.getState().listLength);
          reconcileAlbumRatings(albums);
          set({ recentlyPlayed: albums });
        } catch {
          set({ recentlyPlayed: [] });
        }
      },

      refreshFrequentlyPlayed: async () => {
        try {
          await ensureCoverArtAuth();
          const albums = await getFrequentlyPlayedAlbums(layoutPreferencesStore.getState().listLength);
          reconcileAlbumRatings(albums);
          set({ frequentlyPlayed: albums });
        } catch {
          set({ frequentlyPlayed: [] });
        }
      },

      refreshRandomSelection: async () => {
        try {
          await ensureCoverArtAuth();
          const albums = await getRandomAlbums(layoutPreferencesStore.getState().listLength);
          reconcileAlbumRatings(albums);
          set({ randomSelection: albums });
        } catch {
          set({ randomSelection: [] });
        }
      },

      refreshAll: async () => {
        try {
          await ensureCoverArtAuth();
          const size = layoutPreferencesStore.getState().listLength;
          const [recentlyAdded, recentlyPlayed, frequentlyPlayed, randomSelection] =
            await Promise.all([
              getRecentlyAddedAlbums(size),
              getRecentlyPlayedAlbums(size),
              getFrequentlyPlayedAlbums(size),
              getRandomAlbums(size),
            ]);
          reconcileAlbumRatings([...recentlyAdded, ...recentlyPlayed, ...frequentlyPlayed, ...randomSelection]);
          set({
            recentlyAdded,
            recentlyPlayed,
            frequentlyPlayed,
            randomSelection,
          });
        } catch {
          // Leave existing state on full refresh failure
        }
      },
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        recentlyAdded: state.recentlyAdded,
        recentlyPlayed: state.recentlyPlayed,
        frequentlyPlayed: state.frequentlyPlayed,
        randomSelection: state.randomSelection,
      }),
    }
  )
);

