import { create } from 'zustand';

/**
 * Tracks which migration version has been completed.
 *
 * Currently **non-persisted** so migrations run on every app launch,
 * making it easy to test during development. To persist, wrap the
 * store creator with `persist` and `createJSONStorage(() => sqliteStorage)`
 * (see themeStore.ts for the pattern).
 */

export interface MigrationState {
  /** Highest migration task ID that has completed. 0 = none. */
  completedVersion: number;
  setCompletedVersion: (version: number) => void;
}

export const migrationStore = create<MigrationState>()((set) => ({
  completedVersion: 0,
  setCompletedVersion: (completedVersion) => set({ completedVersion }),
}));
