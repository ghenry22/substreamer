import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

export interface ScrobbleExclusion {
  id: string;
  name: string;
}

export type ScrobbleExclusionType = 'album' | 'artist' | 'playlist';

interface ScrobbleExclusionState {
  excludedAlbums: Record<string, ScrobbleExclusion>;
  excludedArtists: Record<string, ScrobbleExclusion>;
  excludedPlaylists: Record<string, ScrobbleExclusion>;
  addExclusion: (type: ScrobbleExclusionType, id: string, name: string) => void;
  removeExclusion: (type: ScrobbleExclusionType, id: string) => void;
}

const PERSIST_KEY = 'substreamer-scrobble-exclusions';

function fieldForType(type: ScrobbleExclusionType): keyof Pick<ScrobbleExclusionState, 'excludedAlbums' | 'excludedArtists' | 'excludedPlaylists'> {
  switch (type) {
    case 'album': return 'excludedAlbums';
    case 'artist': return 'excludedArtists';
    case 'playlist': return 'excludedPlaylists';
  }
}

export const scrobbleExclusionStore = create<ScrobbleExclusionState>()(
  persist(
    (set) => ({
      excludedAlbums: {},
      excludedArtists: {},
      excludedPlaylists: {},

      addExclusion: (type, id, name) => {
        const field = fieldForType(type);
        set((state) => ({
          [field]: { ...state[field], [id]: { id, name } },
        }));
      },

      removeExclusion: (type, id) => {
        const field = fieldForType(type);
        set((state) => {
          const { [id]: _, ...rest } = state[field];
          return { [field]: rest };
        });
      },
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        excludedAlbums: state.excludedAlbums,
        excludedArtists: state.excludedArtists,
        excludedPlaylists: state.excludedPlaylists,
      }),
    },
  ),
);
