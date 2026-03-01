import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

export interface MbidOverride {
  artistId: string;
  artistName: string;
  mbid: string;
}

interface MbidOverrideState {
  /** Map of Subsonic artist ID -> MBID override entry */
  overrides: Record<string, MbidOverride>;
  setOverride: (artistId: string, artistName: string, mbid: string) => void;
  removeOverride: (artistId: string) => void;
  clearOverrides: () => void;
}

const PERSIST_KEY = 'substreamer-mbid-overrides';

export const mbidOverrideStore = create<MbidOverrideState>()(
  persist(
    (set) => ({
      overrides: {},

      setOverride: (artistId: string, artistName: string, mbid: string) =>
        set((state) => ({
          overrides: {
            ...state.overrides,
            [artistId]: { artistId, artistName, mbid },
          },
        })),

      removeOverride: (artistId: string) =>
        set((state) => {
          const { [artistId]: _, ...rest } = state.overrides;
          return { overrides: rest };
        }),

      clearOverrides: () => set({ overrides: {} }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        overrides: state.overrides,
      }),
    }
  )
);
