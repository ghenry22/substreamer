import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import i18n from '../i18n/i18n';

import { kvStorage } from './persistence';

import {
  ensureCoverArtAuth,
  getAllAlbumsAlphabetical,
  searchAllAlbums,
  type AlbumID3,
} from '../services/subsonicService';
import { layoutPreferencesStore } from './layoutPreferencesStore';
import { ratingStore } from './ratingStore';

/**
 * Hook invoked after `fetchAllAlbums` has successfully replaced the library.
 * Registered by `dataSyncService` at module load so we avoid a circular
 * import (dataSyncService → albumLibraryStore → dataSyncService).
 * Receives the OLD and NEW id lists so consumers can reap orphans from
 * downstream caches (albumDetailStore, songIndexStore) and pre-fetch new IDs.
 */
let reconcileHook: ((oldIds: readonly string[], newIds: readonly string[]) => void) | null = null;
export function registerAlbumLibraryReconcileHook(
  hook: ((oldIds: readonly string[], newIds: readonly string[]) => void) | null,
): void {
  reconcileHook = hook;
}

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
  /**
   * Merge a batch of albums into the in-memory list by id, replacing existing
   * entries and appending new ones. Triggers a re-sort. Used by the incremental
   * change-detection path to add newly discovered albums without a full
   * refetch.
   */
  upsertAlbums: (albums: AlbumID3[]) => void;
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

        // Capture old IDs BEFORE the fetch starts so the reconcile hook can
        // diff the full-refetch result against what we had.
        const oldIds = get().albums.map((a) => a.id);

        set({ loading: true, error: null });
        try {
          await ensureCoverArtAuth();

          // Strategy 1: try search3 with empty query (works on many servers)
          let albums = await searchAllAlbums();

          // Strategy 2: if search3 returned nothing, paginate via getAlbumList2
          if (albums.length === 0) {
            albums = await getAllAlbumsAlphabetical();
          }

          // Guard against a transient empty response wiping a populated cache.
          // Both strategies swallow network errors and return []. If we had a
          // non-empty library before and the new response is empty, treat as
          // an error so we DON'T replace the cache (and don't cascade a
          // mass-wipe through the reconcile hook to albumDetailStore /
          // songIndexStore).
          if (albums.length === 0 && oldIds.length > 0) {
            set({
              loading: false,
              error: i18n.t('failedToLoadAlbums'),
            });
            return;
          }

          // Sort albums according to the user's preferred sort order
          const sortOrder = layoutPreferencesStore.getState().albumSortOrder;
          const sortKey = sortOrder === 'title' ? 'name' : 'artist';
          albums.sort((a, b) =>
            (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '', undefined, {
              sensitivity: 'base',
            })
          );

          ratingStore.getState().reconcileRatings(
            albums.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 }))
          );
          set({
            albums,
            loading: false,
            lastFetchedAt: Date.now(),
          });

          // Notify the reconcile hook (dataSyncService) so it can reap orphans
          // from albumDetailStore / songIndexStore and pre-fetch new IDs. Runs
          // asynchronously from the caller's perspective.
          if (reconcileHook) {
            try {
              reconcileHook(oldIds, albums.map((a) => a.id));
            } catch {
              /* non-critical — reconcile is best-effort */
            }
          }
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : i18n.t('failedToLoadAlbums'),
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

      upsertAlbums: (albums: AlbumID3[]) => {
        if (albums.length === 0) return;
        const current = get().albums;
        const merged: Record<string, AlbumID3> = {};
        for (const a of current) merged[a.id] = a;
        for (const a of albums) merged[a.id] = a;
        const sortOrder = layoutPreferencesStore.getState().albumSortOrder;
        const sortKey = sortOrder === 'title' ? 'name' : 'artist';
        const next = Object.values(merged).sort((a, b) =>
          (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '', undefined, {
            sensitivity: 'base',
          })
        );
        ratingStore.getState().reconcileRatings(
          albums.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 })),
        );
        set({ albums: next });
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
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        albums: state.albums,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);

// Re-sort albums when the user changes the sort preference.
layoutPreferencesStore.subscribe((state, prevState) => {
  if (state.albumSortOrder !== prevState.albumSortOrder) {
    albumLibraryStore.getState().resortAlbums();
  }
});

// NOTE: the `albumListsStore → albumLibraryStore` subscribe used to live
// here. It was retired in Phase 5 of the data-sync refactor. The equivalent
// behavior (refresh library when recentlyAdded surfaces an unknown id) is
// now owned by `dataSyncService.ts` via `onAlbumReferenced`, which also
// handles download-triggered references from `musicCacheService`.
