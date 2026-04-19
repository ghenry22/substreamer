import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

export type MbidOverrideType = 'artist' | 'album';

export interface MbidOverride {
  type: MbidOverrideType;
  entityId: string;
  entityName: string;
  mbid: string;
}

interface MbidOverrideState {
  /** Map of entity key ("artist:id" or "album:id") -> MBID override entry */
  overrides: Record<string, MbidOverride>;
  setOverride: (type: MbidOverrideType, entityId: string, entityName: string, mbid: string) => void;
  removeOverride: (type: MbidOverrideType, entityId: string) => void;
  clearOverrides: () => void;
}

function overrideKey(type: MbidOverrideType, entityId: string): string {
  return `${type}:${entityId}`;
}

/** Look up an override by type and entity ID. */
export function getOverride(
  overrides: Record<string, MbidOverride>,
  type: MbidOverrideType,
  entityId: string,
): MbidOverride | undefined {
  return overrides[overrideKey(type, entityId)];
}

const PERSIST_KEY = 'substreamer-mbid-overrides';

export const mbidOverrideStore = create<MbidOverrideState>()(
  persist(
    (set) => ({
      overrides: {},

      setOverride: (type: MbidOverrideType, entityId: string, entityName: string, mbid: string) =>
        set((state) => {
          const key = overrideKey(type, entityId);
          return {
            overrides: {
              ...state.overrides,
              [key]: { type, entityId, entityName, mbid },
            },
          };
        }),

      removeOverride: (type: MbidOverrideType, entityId: string) =>
        set((state) => {
          const key = overrideKey(type, entityId);
          const { [key]: _, ...rest } = state.overrides;
          return { overrides: rest };
        }),

      clearOverrides: () => set({ overrides: {} }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        overrides: state.overrides,
      }),
    }
  )
);
