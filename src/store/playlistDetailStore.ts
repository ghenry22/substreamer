import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

import { cacheAllSizes, cacheEntityCoverArt } from '../services/imageCacheService';
import {
  ensureCoverArtAuth,
  getPlaylist,
  type PlaylistWithSongs,
} from '../services/subsonicService';
import { ratingStore } from './ratingStore';

export interface PlaylistDetailEntry {
  playlist: PlaylistWithSongs;
  /** Timestamp (Date.now()) when this entry was fetched from the server. */
  retrievedAt: number;
}

export interface PlaylistDetailState {
  /** Playlist details indexed by playlist ID. */
  playlists: Record<string, PlaylistDetailEntry>;
  /** Fetch playlist from API, store it, and return it. Returns null on failure. */
  fetchPlaylist: (id: string) => Promise<PlaylistWithSongs | null>;
  /** Reorder a track within the cached playlist entry. */
  reorderTracks: (id: string, fromIndex: number, toIndex: number) => void;
  /** Remove a track from the cached playlist entry by index. */
  removeTrack: (id: string, trackIndex: number) => void;
  /** Remove a playlist entry from the cache entirely. */
  removePlaylist: (id: string) => void;
  /** Clear all cached playlist details. */
  clearPlaylists: () => void;
}

const PERSIST_KEY = 'substreamer-playlist-details';

export const playlistDetailStore = create<PlaylistDetailState>()(
  persist(
    (set, get) => ({
      playlists: {},

      fetchPlaylist: async (id: string) => {
        await ensureCoverArtAuth();
        const data = await getPlaylist(id);
        if (data) {
          const ratingEntries = (data.entry ?? []).map((s) => ({
            id: s.id,
            serverRating: s.userRating ?? 0,
          }));
          ratingStore.getState().reconcileRatings(ratingEntries);
          set({
            playlists: {
              ...get().playlists,
              [id]: { playlist: data, retrievedAt: Date.now() },
            },
          });

          // Proactively cache cover art for new IDs so they survive offline
          if (data.coverArt) cacheAllSizes(data.coverArt).catch(() => { /* non-critical */ });
          if (data.entry?.length) cacheEntityCoverArt(data.entry);
        }
        return data;
      },

      reorderTracks: (id, fromIndex, toIndex) => {
        const entry = get().playlists[id];
        if (!entry) return;
        const entries = [...(entry.playlist.entry ?? [])];
        if (
          fromIndex < 0 || fromIndex >= entries.length ||
          toIndex < 0 || toIndex >= entries.length ||
          fromIndex === toIndex
        ) return;
        const [moved] = entries.splice(fromIndex, 1);
        entries.splice(toIndex, 0, moved);
        set({
          playlists: {
            ...get().playlists,
            [id]: {
              ...entry,
              playlist: { ...entry.playlist, entry: entries, songCount: entries.length },
            },
          },
        });
      },

      removeTrack: (id, trackIndex) => {
        const entry = get().playlists[id];
        if (!entry) return;
        const entries = [...(entry.playlist.entry ?? [])];
        if (trackIndex < 0 || trackIndex >= entries.length) return;
        const removed = entries[trackIndex];
        entries.splice(trackIndex, 1);
        const newDuration = (entry.playlist.duration ?? 0) - (removed.duration ?? 0);
        set({
          playlists: {
            ...get().playlists,
            [id]: {
              ...entry,
              playlist: {
                ...entry.playlist,
                entry: entries,
                songCount: entries.length,
                duration: Math.max(0, newDuration),
              },
            },
          },
        });
      },

      removePlaylist: (id) => {
        const { [id]: _, ...rest } = get().playlists;
        set({ playlists: rest });
      },

      clearPlaylists: () => set({ playlists: {} }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        playlists: state.playlists,
      }),
    }
  )
);
