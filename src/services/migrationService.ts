/**
 * Data migration service.
 *
 * Defines versioned migration tasks that run sequentially on app launch.
 * Each task has a numeric `id` (1-based, strictly increasing). The
 * migration runner compares these IDs against the store's
 * `completedVersion` to determine which tasks still need to run.
 *
 * See the bottom of this file for a template showing how to add new tasks.
 */

import { Directory, Paths } from 'expo-file-system';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MigrationTask {
  /** Sequential ID starting at 1. Must be unique and increasing. */
  id: number;
  /** Short name shown to the user during migration. */
  name: string;
  /** The work to perform. Throw on unrecoverable failure. */
  run: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Task definitions                                                   */
/* ------------------------------------------------------------------ */

const MIGRATION_TASKS: MigrationTask[] = [
  {
    id: 1,
    name: 'Legacy data migration',
    run: async () => {
      const legacyDirs = ['imageCache', 'musicCache', 'podcastCache'];
      for (const name of legacyDirs) {
        const dir = new Directory(Paths.document, name);
        if (dir.exists) {
          try {
            dir.delete();
          } catch {
            // Directory may have already been removed; ignore.
          }
        }
      }
    },
  },

  // -------------------------------------------------------------------
  // TEMPLATE – How to add a new migration task:
  //
  //   1. Add a new entry below with the next sequential `id`.
  //   2. Give it a human-readable `name` (shown briefly on the splash).
  //   3. Implement the async `run` function with the migration logic.
  //   4. The runner will pick it up automatically on next launch for
  //      any user whose completedVersion is below the new id.
  //
  // Example:
  //
  // {
  //   id: 2,
  //   name: 'Reset playback settings',
  //   run: async () => {
  //     // your migration logic here
  //   },
  // },
  // -------------------------------------------------------------------
];

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Returns tasks that have not yet been completed.
 */
export function getPendingTasks(completedVersion: number): MigrationTask[] {
  return MIGRATION_TASKS.filter((t) => t.id > completedVersion);
}

/**
 * Run all pending migration tasks sequentially.
 *
 * @param completedVersion – The highest task ID already completed.
 * @param onProgress       – Optional callback fired before each task runs.
 * @returns The new completedVersion (highest task ID that ran).
 */
export async function runMigrations(
  completedVersion: number,
  onProgress?: (task: MigrationTask) => void,
): Promise<number> {
  const pending = getPendingTasks(completedVersion);

  for (const task of pending) {
    onProgress?.(task);
    await task.run();
    completedVersion = task.id;
  }

  return completedVersion;
}
