import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import i18n from '../i18n/i18n';

import { kvStorage } from './persistence';

import {
  ensureCoverArtAuth,
  getAllPlaylists,
  type Playlist,
} from '../services/subsonicService';

/**
 * Hook invoked after `fetchAllPlaylists` has successfully replaced the list.
 * Registered by `dataSyncService` at module load; same pattern as the album
 * library reconcile hook. Receives the OLD and NEW id lists so consumers can
 * reap orphans from `playlistDetailStore` and pre-fetch new playlists.
 */
let reconcileHook: ((oldIds: readonly string[], newIds: readonly string[]) => void) | null = null;
export function registerPlaylistLibraryReconcileHook(
  hook: ((oldIds: readonly string[], newIds: readonly string[]) => void) | null,
): void {
  reconcileHook = hook;
}

export interface PlaylistLibraryState {
  /** All playlists in the user's library */
  playlists: Playlist[];
  /** Whether a fetch is currently in progress */
  loading: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Timestamp of the last successful fetch */
  lastFetchedAt: number | null;

  /** Fetch all playlists from the server via getPlaylists. */
  fetchAllPlaylists: () => Promise<void>;
  /** Remove a single playlist from the library by ID. */
  removePlaylist: (id: string) => void;
  /** Clear all playlist data */
  clearPlaylists: () => void;
}

const PERSIST_KEY = 'substreamer-playlist-library';

export const playlistLibraryStore = create<PlaylistLibraryState>()(
  persist(
    (set, get) => ({
      playlists: [],
      loading: false,
      error: null,
      lastFetchedAt: null,

      fetchAllPlaylists: async () => {
        // Prevent duplicate fetches
        if (get().loading) return;

        const oldIds = get().playlists.map((p) => p.id);
        set({ loading: true, error: null });
        try {
          await ensureCoverArtAuth();
          const playlists = await getAllPlaylists();

          set({
            playlists,
            loading: false,
            lastFetchedAt: Date.now(),
          });

          if (reconcileHook) {
            try {
              reconcileHook(oldIds, playlists.map((p) => p.id));
            } catch {
              /* non-critical — reconcile is best-effort */
            }
          }
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : i18n.t('failedToLoadPlaylists'),
          });
        }
      },

      removePlaylist: (id) =>
        set((state) => ({
          playlists: state.playlists.filter((p) => p.id !== id),
        })),

      clearPlaylists: () =>
        set({
          playlists: [],
          loading: false,
          error: null,
          lastFetchedAt: null,
        }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        playlists: state.playlists,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);
