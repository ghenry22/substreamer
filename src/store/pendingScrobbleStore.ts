import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

import { type Child } from '../services/subsonicService';

export interface PendingScrobble {
  /** Unique identifier for this pending scrobble entry. */
  id: string;
  /** Full Subsonic songID3 object. */
  song: Child;
  /** Unix timestamp (ms) when playback completed. */
  time: number;
}

export interface PendingScrobbleState {
  pendingScrobbles: PendingScrobble[];

  addScrobble: (song: Child, time: number) => void;
  removeScrobble: (id: string) => void;
}

const PERSIST_KEY = 'substreamer-scrobbles';

export const pendingScrobbleStore = create<PendingScrobbleState>()(
  persist(
    (set) => ({
      pendingScrobbles: [],

      addScrobble: (song, time) =>
        set((state) => {
          if (!song?.id || !song.title) return state;
          return {
            pendingScrobbles: [
              ...state.pendingScrobbles,
              { id: `${time}-${Math.random().toString(36).slice(2, 8)}`, song, time },
            ],
          };
        }),

      removeScrobble: (id) =>
        set((state) => ({
          pendingScrobbles: state.pendingScrobbles.filter((s) => s.id !== id),
        })),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        pendingScrobbles: state.pendingScrobbles,
      }),
    }
  )
);
