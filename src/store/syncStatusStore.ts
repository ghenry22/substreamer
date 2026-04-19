import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

/** Scopes accepted by pull-to-refresh + a couple of internal orchestration scopes. */
export type SyncScope =
  | 'home'
  | 'albums'
  | 'artists'
  | 'playlists'
  | 'favorites'
  | 'genres'
  | 'all'
  | 'full-walk'
  | 'change-detect';

export type DetailSyncPhase =
  | 'idle'
  | 'syncing'
  | 'paused-offline'
  | 'paused-auth-error'
  | 'paused-metered'
  | 'error';

export interface LastKnownMarkers {
  lastChangeDetectionAt: number | null;
  lastKnownServerUrl: string | null;
  lastKnownServerSongCount: number | null;
  lastKnownServerScanTime: number | null;
  lastKnownNewestAlbumId: string | null;
  lastKnownNewestAlbumCreated: number | null;
}

export interface SyncStatusState extends LastKnownMarkers {
  // Persisted sync state
  detailSyncPhase: DetailSyncPhase;
  detailSyncTotal: number;
  /** Persisted running counter of successful detail fetches in the current
   *  walk. Frozen-reset to zero at walk start via `setDetailSyncTotal`. UI
   *  reads this directly so progress displays don't do an O(N) library scan. */
  detailSyncCompleted: number;
  detailSyncStartedAt: number | null;
  detailSyncError: string | null;
  /** Ephemeral — session-only. Set when the user dismisses the pill banner;
   *  cleared when the walk phase transitions back to 'idle' (or on app
   *  restart since this field is not persisted). */
  bannerDismissedAt: number | null;

  // Ephemeral
  generation: number;
  inFlight: Map<SyncScope, Promise<void>>;

  // Actions
  setDetailSyncPhase: (phase: DetailSyncPhase) => void;
  setDetailSyncTotal: (total: number, startedAt: number | null) => void;
  /** Increment `detailSyncCompleted` by 1 — called by the walk after each
   *  successful `fetchAlbum`. */
  incrementDetailSyncCompleted: () => void;
  setDetailSyncError: (message: string | null) => void;
  setLastKnownMarkers: (partial: Partial<LastKnownMarkers>) => void;
  setBannerDismissedAt: (at: number | null) => void;
  resetDetailSync: () => void;
  bumpGeneration: () => void;
  setInFlight: (scope: SyncScope, promise: Promise<void>) => void;
  clearInFlight: (scope: SyncScope) => void;
  getInFlight: (scope: SyncScope) => Promise<void> | undefined;
}

const PERSIST_KEY = 'substreamer-sync-status';

export const syncStatusStore = create<SyncStatusState>()(
  persist(
    (set, get) => ({
      detailSyncPhase: 'idle',
      detailSyncTotal: 0,
      detailSyncCompleted: 0,
      detailSyncStartedAt: null,
      detailSyncError: null,
      bannerDismissedAt: null,

      lastChangeDetectionAt: null,
      lastKnownServerUrl: null,
      lastKnownServerSongCount: null,
      lastKnownServerScanTime: null,
      lastKnownNewestAlbumId: null,
      lastKnownNewestAlbumCreated: null,

      generation: 0,
      inFlight: new Map(),

      setDetailSyncPhase: (phase) => {
        set({ detailSyncPhase: phase });
        if (phase === 'idle') {
          // Clear session-level banner dismissal when phase settles.
          set({ bannerDismissedAt: null });
        }
      },
      setDetailSyncTotal: (total, startedAt) =>
        set({ detailSyncTotal: total, detailSyncStartedAt: startedAt, detailSyncCompleted: 0 }),
      incrementDetailSyncCompleted: () =>
        set({ detailSyncCompleted: get().detailSyncCompleted + 1 }),
      setDetailSyncError: (message) => set({ detailSyncError: message }),
      setLastKnownMarkers: (partial) => set({ ...get(), ...partial }),
      setBannerDismissedAt: (at) => set({ bannerDismissedAt: at }),
      resetDetailSync: () =>
        set({
          detailSyncPhase: 'idle',
          detailSyncTotal: 0,
          detailSyncCompleted: 0,
          detailSyncStartedAt: null,
          detailSyncError: null,
          bannerDismissedAt: null,
        }),
      bumpGeneration: () => set({ generation: get().generation + 1 }),
      setInFlight: (scope, promise) => {
        // Replace (not mutate) the Map so Zustand selector subscribers using
        // Object.is equality detect the change. A shared mutable reference
        // would pass the equality check and silently skip notifications.
        const next = new Map(get().inFlight);
        next.set(scope, promise);
        set({ inFlight: next });
      },
      clearInFlight: (scope) => {
        const next = new Map(get().inFlight);
        next.delete(scope);
        set({ inFlight: next });
      },
      getInFlight: (scope) => get().inFlight.get(scope),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        detailSyncPhase: state.detailSyncPhase,
        detailSyncTotal: state.detailSyncTotal,
        detailSyncCompleted: state.detailSyncCompleted,
        detailSyncStartedAt: state.detailSyncStartedAt,
        detailSyncError: state.detailSyncError,
        // bannerDismissedAt is session-only by design — the banner comes
        // back on the next app launch if the walk is still active. Not
        // persisted.
        lastChangeDetectionAt: state.lastChangeDetectionAt,
        lastKnownServerUrl: state.lastKnownServerUrl,
        lastKnownServerSongCount: state.lastKnownServerSongCount,
        lastKnownServerScanTime: state.lastKnownServerScanTime,
        lastKnownNewestAlbumId: state.lastKnownNewestAlbumId,
        lastKnownNewestAlbumCreated: state.lastKnownNewestAlbumCreated,
      }),
    },
  ),
);
