import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

export type StorageLimitMode = 'none' | 'fixed';

export interface StorageLimitState {
  limitMode: StorageLimitMode;
  maxCacheSizeGB: number;
  isStorageFull: boolean;

  setLimitMode: (mode: StorageLimitMode) => void;
  setMaxCacheSizeGB: (gb: number) => void;
  setStorageFull: (full: boolean) => void;
}

const PERSIST_KEY = 'substreamer-storage-limit';

export const storageLimitStore = create<StorageLimitState>()(
  persist(
    (set) => ({
      limitMode: 'none',
      maxCacheSizeGB: 0,
      isStorageFull: false,

      setLimitMode: (mode) => set({ limitMode: mode }),
      setMaxCacheSizeGB: (gb) => set({ maxCacheSizeGB: gb }),
      setStorageFull: (full) => set({ isStorageFull: full }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        limitMode: state.limitMode,
        maxCacheSizeGB: state.maxCacheSizeGB,
      }),
    },
  ),
);
