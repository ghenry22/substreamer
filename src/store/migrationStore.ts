import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

export interface MigrationState {
  /** Highest migration task ID that has completed. 0 = none. */
  completedVersion: number;
  setCompletedVersion: (version: number) => void;
}

export const migrationStore = create<MigrationState>()(
  persist(
    (set) => ({
      completedVersion: 0,
      setCompletedVersion: (completedVersion) => set({ completedVersion }),
    }),
    {
      name: 'substreamer-migration',
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({ completedVersion: state.completedVersion }),
    },
  ),
);
