import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  ensureCoverArtAuth,
  getAllAlbumsAlphabetical,
  searchAllAlbums,
  type AlbumID3,
} from '../services/subsonicService';
import { layoutPreferencesStore } from './layoutPreferencesStore';

export interface AlbumLibraryState {
  /** All albums in the user's library */
  albums: AlbumID3[];
  /** Whether a fetch is currently in progress */
  loading: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Timestamp of the last successful fetch */
  lastFetchedAt: number | null;

  /**
   * Fetch all albums from the server.
   * Strategy: try search3 with empty query first (fast, single request).
   * If the result set is empty, fall back to paginated getAlbumList2.
   */
  fetchAllAlbums: () => Promise<void>;
  /** Re-sort the in-memory album list using the current sort preference. */
  resortAlbums: () => void;
  /** Clear all album data */
  clearAlbums: () => void;
}

const PERSIST_KEY = 'substreamer-album-library';

export const albumLibraryStore = create<AlbumLibraryState>()(
  persist(
    (set, get) => ({
      albums: [],
      loading: false,
      error: null,
      lastFetchedAt: null,

      fetchAllAlbums: async () => {
        // Prevent duplicate fetches
        if (get().loading) return;

        set({ loading: true, error: null });
        try {
          await ensureCoverArtAuth();

          // Strategy 1: try search3 with empty query (works on many servers)
          let albums = await searchAllAlbums();

          // Strategy 2: if search3 returned nothing, paginate via getAlbumList2
          if (albums.length === 0) {
            albums = await getAllAlbumsAlphabetical();
          }

          // Sort albums according to the user's preferred sort order
          const sortOrder = layoutPreferencesStore.getState().albumSortOrder;
          const sortKey = sortOrder === 'title' ? 'name' : 'artist';
          albums.sort((a, b) =>
            (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '', undefined, {
              sensitivity: 'base',
            })
          );

          set({
            albums,
            loading: false,
            lastFetchedAt: Date.now(),
          });
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load albums',
          });
        }
      },

      resortAlbums: () => {
        const current = get().albums;
        if (current.length === 0) return;
        const sortOrder = layoutPreferencesStore.getState().albumSortOrder;
        const sortKey = sortOrder === 'title' ? 'name' : 'artist';
        const sorted = [...current].sort((a, b) =>
          (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '', undefined, {
            sensitivity: 'base',
          })
        );
        set({ albums: sorted });
      },

      clearAlbums: () =>
        set({
          albums: [],
          loading: false,
          error: null,
          lastFetchedAt: null,
        }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        albums: state.albums,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);
