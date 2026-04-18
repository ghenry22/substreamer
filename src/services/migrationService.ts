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

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { migrateV3BackupMetas } from './backupService';
import {
  completedScrobbleStore,
  type CompletedScrobble,
} from '../store/completedScrobbleStore';
import { mbidOverrideStore, type MbidOverride } from '../store/mbidOverrideStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { localeStore } from '../store/localeStore';
import {
  upsertAlbumDetail,
  upsertSongsForAlbum,
} from '../store/persistence/detailTables';
import { replaceAllScrobbles } from '../store/persistence/scrobbleTable';
import { sqliteStorage } from '../store/sqliteStorage';
import { type EffectiveFormat } from '../types/audio';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MigrationTask {
  /** Sequential ID starting at 1. Must be unique and increasing. */
  id: number;
  /** Short name shown to the user during migration. */
  name: string;
  /** The work to perform. Use `log` to record findings. Throw on unrecoverable failure. */
  run: (log: (message: string) => void) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Shared body for Migration 7 (forward run) and Migration 9 (repair).
 * Reads auth credentials directly from the persisted SQLite blob rather
 * than from authStore.getState(), avoiding a race with Zustand rehydration.
 * The underlying migrateV3BackupMetas is idempotent — it only rewrites
 * files that are still at v3, so running this twice is safe.
 */
async function stampV3BackupsFromStoredAuth(
  log: (message: string) => void,
): Promise<void> {
  const raw = await sqliteStorage.getItem('substreamer-auth');
  if (!raw) {
    log('No persisted auth — skipping backup identity stamping.');
    return;
  }
  let serverUrl: string | undefined;
  let username: string | undefined;
  try {
    const parsed = JSON.parse(raw);
    serverUrl = parsed?.state?.serverUrl;
    username = parsed?.state?.username;
  } catch {
    log('Failed to parse persisted auth — skipping.');
    return;
  }
  if (!serverUrl || !username) {
    log('No active session in persisted auth — skipping.');
    return;
  }
  const count = await migrateV3BackupMetas(serverUrl, username);
  if (count > 0) {
    log(`Upgraded ${count} backup(s) from v3 to v4 with identity ${username}@${serverUrl}.`);
  } else {
    log('No v3 backup files found — skipping.');
  }
}

/* ------------------------------------------------------------------ */
/*  Task definitions                                                   */
/* ------------------------------------------------------------------ */

const MIGRATION_TASKS: MigrationTask[] = [
  {
    id: 1,
    name: 'Legacy data migration',
    run: async (log) => {
      // Cordova cache folder names used across app versions.
      // 'music' and 'images' are from the earliest Substreamer releases;
      // 'musicCache', 'imageCache', 'podcastCache' from later versions.
      const legacyDirs = [
        'imageCache',
        'musicCache',
        'podcastCache',
        'images',
        'music',
      ];

      // cordova.file.dataDirectory maps to different native paths per platform:
      //   Android: getFilesDir()         → same as Expo Paths.document
      //   iOS:     Library/NoCloud/       → NOT Documents/
      // We also check the Cordova "internal" persistent root on Android
      // (getFilesDir() + "/files/") in case the W3C persistent API was used.
      const bases: Directory[] = [Paths.document];

      if (Platform.OS === 'android') {
        // Cordova "internal" persistent root: getFilesDir() + "/files/"
        bases.push(new Directory(Paths.document, 'files'));
      } else if (Platform.OS === 'ios') {
        // cordova.file.dataDirectory on iOS: Library/NoCloud/
        bases.push(
          new Directory(Paths.document.parentDirectory, 'Library', 'NoCloud'),
        );
      }

      for (const base of bases) {
        for (const name of legacyDirs) {
          const dir = new Directory(base, name);
          if (dir.exists) {
            try {
              dir.delete();
              log(`Removed: ${base.uri}${name}/`);
            } catch {
              log(`Failed to remove: ${base.uri}${name}/`);
            }
          } else {
            log(`Not found: ${base.uri}${name}/`);
          }
        }
      }
    },
  },

  {
    id: 2,
    name: 'Remove legacy Ionic database',
    run: async (log) => {
      let dbDir: Directory | undefined;

      if (Platform.OS === 'ios') {
        dbDir = new Directory(
          Paths.document.parentDirectory,
          'Library',
          'LocalDatabase',
        );
      } else if (Platform.OS === 'android') {
        dbDir = new Directory(Paths.document.parentDirectory, 'databases');
      }

      if (!dbDir?.exists) {
        log(`Database directory not found: ${dbDir?.uri ?? 'unknown'}`);
        return;
      }

      log(`Checking directory: ${dbDir.uri}`);

      const suffixes = ['', '-journal', '-wal', '-shm'];
      const basenames = ['__substreamer3', '__substreamer3.db'];

      for (const base of basenames) {
        for (const suffix of suffixes) {
          const fileName = base + suffix;
          const file = new File(dbDir, fileName);
          if (file.exists) {
            try {
              file.delete();
              log(`Removed: ${fileName}`);
            } catch {
              log(`Failed to remove: ${fileName}`);
            }
          } else {
            log(`Not found: ${fileName}`);
          }
        }
      }
    },
  },

  {
    id: 3,
    name: 'Build analytics aggregates',
    run: async (log) => {
      const state = completedScrobbleStore.getState();
      if (state.completedScrobbles.length === 0) {
        log('No scrobbles — skipping aggregate rebuild.');
        return;
      }
      state.rebuildAggregates();
      log(`Rebuilt aggregates for ${state.completedScrobbles.length} scrobbles.`);
    },
  },

  {
    id: 4,
    name: 'Fix corrupted shares data',
    run: async (log) => {
      const raw = await sqliteStorage.getItem('substreamer-shares');
      if (!raw) {
        log('No persisted shares data — skipping.');
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        const state = parsed?.state;
        if (state && !Array.isArray(state.shares)) {
          state.shares = [];
          sqliteStorage.setItem('substreamer-shares', JSON.stringify(parsed));
          log(`Fixed corrupted shares field (was ${typeof state.shares}).`);
        } else {
          log('Shares data is valid — no fix needed.');
        }
      } catch {
        /* Corrupted JSON — remove it entirely so the store starts fresh */
        sqliteStorage.removeItem('substreamer-shares');
        log('Removed unparseable shares data.');
      }
    },
  },

  {
    id: 5,
    name: 'Migrate MBID overrides to new shape',
    run: async (log) => {
      // Read raw from SQLite rather than from mbidOverrideStore.getState()
      // to avoid a race with Zustand rehydration: the store can still hold
      // its default empty state at the moment this migration runs, which
      // would cause the migration to silently skip and mark itself complete.
      const raw = await sqliteStorage.getItem('substreamer-mbid-overrides');
      if (!raw) {
        log('No persisted MBID overrides — skipping.');
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        log('Failed to parse MBID overrides — skipping.');
        return;
      }
      const overrides = parsed?.state?.overrides;
      if (!overrides || typeof overrides !== 'object') {
        log('No overrides object in persisted data — skipping.');
        return;
      }
      const keys = Object.keys(overrides);
      if (keys.length === 0) {
        log('MBID overrides empty — skipping.');
        return;
      }

      // Check if already migrated (new keys use "artist:" or "album:" prefix)
      const alreadyMigrated = keys.some((k) => k.startsWith('artist:') || k.startsWith('album:'));
      if (alreadyMigrated) {
        log('MBID overrides already in new format — skipping.');
        return;
      }

      // Old format: keyed by artistId with { artistId, artistName, mbid }
      // New format: keyed by "artist:{artistId}" with { type, entityId, entityName, mbid }
      const migrated: Record<string, MbidOverride> = {};
      for (const key of keys) {
        const entry = overrides[key];
        const entityId = entry?.artistId ?? entry?.entityId ?? key;
        const entityName = entry?.artistName ?? entry?.entityName ?? '';
        const mbid = entry?.mbid;
        if (!mbid) continue;
        migrated[`artist:${entityId}`] = {
          type: 'artist',
          entityId,
          entityName,
          mbid,
        };
      }

      parsed.state.overrides = migrated;
      await sqliteStorage.setItem('substreamer-mbid-overrides', JSON.stringify(parsed));
      mbidOverrideStore.setState({ overrides: migrated });
      log(`Migrated ${keys.length} MBID override(s) to new format.`);
    },
  },

  {
    id: 6,
    name: 'Set platform default for estimate content length',
    run: async (log) => {
      const desired = Platform.OS === 'android';
      const raw = await sqliteStorage.getItem('substreamer-playback-settings');
      if (!raw) {
        playbackSettingsStore.setState({ estimateContentLength: desired });
        log('No persisted playback settings — set default on in-memory store.');
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        const state = parsed?.state;
        if (!state) {
          log('No state in persisted data — skipping.');
          return;
        }
        state.estimateContentLength = desired;
        await sqliteStorage.setItem('substreamer-playback-settings', JSON.stringify(parsed));
        // Also update the in-memory store so the current session reflects
        // the new value without waiting for an app restart.
        playbackSettingsStore.setState({ estimateContentLength: desired });
        log(`Set estimateContentLength to ${desired} (${Platform.OS}).`);
      } catch {
        log('Failed to parse playback settings — new default will apply.');
      }
    },
  },

  {
    id: 7,
    name: 'Stamp backup files with user identity',
    run: async (log) => {
      await stampV3BackupsFromStoredAuth(log);
    },
  },

  {
    id: 8,
    name: 'Repair MBID override shape',
    run: async (log) => {
      // Forward-only idempotent repair: walks the persisted MBID
      // overrides and normalizes any entries left in an inconsistent
      // shape by the original buggy Migration 5 (which read from
      // mbidOverrideStore.getState() before rehydration completed).
      // Runs unconditionally for every user — a no-op on fresh installs
      // and correctly-migrated users.
      const raw = await sqliteStorage.getItem('substreamer-mbid-overrides');
      if (!raw) {
        log('No persisted MBID overrides — nothing to repair.');
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        log('Failed to parse MBID overrides — skipping repair.');
        return;
      }
      const overrides = parsed?.state?.overrides;
      if (!overrides || typeof overrides !== 'object') {
        log('No overrides object — nothing to repair.');
        return;
      }

      const repaired: Record<string, MbidOverride> = {};
      let repairCount = 0;
      let skippedCount = 0;
      const totalCount = Object.keys(overrides).length;

      for (const [key, value] of Object.entries(overrides) as [string, any][]) {
        if (!value || typeof value !== 'object' || !value.mbid) {
          skippedCount++;
          continue;
        }

        // Already in new shape: key has prefix AND entry has all required fields
        const hasPrefix = key.startsWith('artist:') || key.startsWith('album:');
        const hasNewFields =
          (value.type === 'artist' || value.type === 'album') &&
          typeof value.entityId === 'string';

        if (hasPrefix && hasNewFields) {
          repaired[key] = {
            type: value.type,
            entityId: value.entityId,
            entityName: typeof value.entityName === 'string' ? value.entityName : '',
            mbid: value.mbid,
          };
          continue;
        }

        // Synthesize a normalized entry. Default to 'artist' since the
        // old shape only had artist overrides — there was no album variant.
        const type: MbidOverride['type'] =
          value.type === 'album' || key.startsWith('album:') ? 'album' : 'artist';
        const entityId: string =
          value.entityId ?? value.artistId ?? (hasPrefix ? key.split(':')[1] : key);
        const entityName: string = value.entityName ?? value.artistName ?? '';
        const newKey = `${type}:${entityId}`;
        repaired[newKey] = { type, entityId, entityName, mbid: value.mbid };
        repairCount++;
      }

      if (repairCount === 0 && skippedCount === 0) {
        log(`All ${totalCount} override(s) already in correct shape.`);
        return;
      }

      parsed.state.overrides = repaired;
      await sqliteStorage.setItem('substreamer-mbid-overrides', JSON.stringify(parsed));
      mbidOverrideStore.setState({ overrides: repaired });
      log(
        `Repaired ${repairCount} entries, skipped ${skippedCount} malformed, ` +
        `${Object.keys(repaired).length} total after repair.`,
      );
    },
  },

  {
    id: 9,
    name: 'Repair v3 backup identity stamping',
    run: async (log) => {
      // Forward-only repair for users whose original Migration 7 silently
      // skipped stamping because authStore had not rehydrated yet, leaving
      // their v3 backups invisible in the UI. Delegates to the same helper
      // Migration 7 now uses. migrateV3BackupMetas is a no-op on already-v4
      // files, so this is safe for users who ran Migration 7 correctly and
      // for fresh installs.
      await stampV3BackupsFromStoredAuth(log);
    },
  },

  {
    id: 10,
    name: 'Backfill downloaded track formats',
    run: async (log) => {
      // Read the raw persisted music cache from SQLite to avoid a race
      // with Zustand rehydration (same pattern as other migrations).
      const raw = await sqliteStorage.getItem('substreamer-music-cache');
      if (!raw) {
        log('No persisted music cache — skipping.');
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        log('Failed to parse music cache — skipping.');
        return;
      }

      const cachedItems: Record<string, any> = parsed?.state?.cachedItems ?? {};
      const existingFormats: Record<string, EffectiveFormat> =
        parsed?.state?.downloadedFormats ?? {};
      const formats: Record<string, EffectiveFormat> = { ...existingFormats };
      let count = 0;

      for (const item of Object.values(cachedItems)) {
        const tracks: any[] = item?.tracks ?? [];
        for (const track of tracks) {
          if (!track?.id || !track?.fileName) continue;
          // Skip if already stamped (e.g. by a recent download).
          if (formats[track.id]) continue;

          const ext = track.fileName.split('.').pop()?.toLowerCase() ?? 'unknown';
          formats[track.id] = {
            suffix: ext,
            capturedAt: 0, // sentinel: backfilled, not captured at download time
          };
          count++;
        }
      }

      if (count === 0) {
        log('No unstamped tracks found — nothing to backfill.');
        return;
      }

      // Merge into the persisted blob and update the live store.
      parsed.state.downloadedFormats = formats;
      await sqliteStorage.setItem('substreamer-music-cache', JSON.stringify(parsed));
      musicCacheStore.setState({ downloadedFormats: formats });
      log(`Backfilled format for ${count} cached track(s).`);
    },
  },

  {
    id: 11,
    name: 'Migrate legacy zh locale to zh-Hans',
    run: async (log) => {
      // Users who explicitly picked Chinese before the Simplified/Traditional
      // split had locale === 'zh'. That code is no longer in the supported
      // list, so left unchanged it would fall back to English on next launch.
      // Remap to 'zh-Hans' to preserve their previous (Simplified) experience.
      const raw = await sqliteStorage.getItem('substreamer-locale');
      if (!raw) {
        log('No persisted locale — skipping.');
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        log('Failed to parse locale — skipping.');
        return;
      }
      const state = parsed?.state;
      if (!state) {
        log('No state in persisted locale — skipping.');
        return;
      }
      if (state.locale !== 'zh') {
        log(`Stored locale is ${state.locale ?? 'null'} — no remap needed.`);
        return;
      }
      state.locale = 'zh-Hans';
      await sqliteStorage.setItem('substreamer-locale', JSON.stringify(parsed));
      localeStore.setState({ locale: 'zh-Hans' });
      log('Remapped legacy "zh" locale preference to "zh-Hans".');
    },
  },

  {
    id: 12,
    name: 'Move album details to per-row SQLite tables',
    run: async (log) => {
      // albumDetailStore moved off the generic `persist(createJSONStorage)`
      // blob model to per-row tables (`album_details`, `song_index`) owned
      // by `src/store/persistence/detailTables.ts`. This task reads the old
      // blob once, upserts each album into the new tables, and deletes the
      // old blob key. Idempotent: if the blob is missing or already been
      // migrated, it's a no-op.
      const raw = await sqliteStorage.getItem('substreamer-album-details');
      if (!raw) {
        log('No persisted album-details blob — nothing to migrate.');
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Corrupt blob — drop it so the new tables start clean.
        await sqliteStorage.removeItem('substreamer-album-details');
        log('Failed to parse album-details blob — removed.');
        return;
      }
      const albums: Record<string, { album: any; retrievedAt?: number }> =
        parsed?.state?.albums ?? {};
      const ids = Object.keys(albums);
      if (ids.length === 0) {
        await sqliteStorage.removeItem('substreamer-album-details');
        log('Album-details blob was empty — removed.');
        return;
      }
      let albumCount = 0;
      let songCount = 0;
      for (const id of ids) {
        const entry = albums[id];
        const album = entry?.album;
        if (!album || typeof album !== 'object' || !album.id) continue;
        const retrievedAt = typeof entry.retrievedAt === 'number' ? entry.retrievedAt : Date.now();
        upsertAlbumDetail(id, album, retrievedAt);
        const songs = Array.isArray(album.song) ? album.song : [];
        upsertSongsForAlbum(id, songs);
        albumCount++;
        songCount += songs.length;
      }
      await sqliteStorage.removeItem('substreamer-album-details');
      log(`Migrated ${albumCount} album detail(s) and ${songCount} song(s) to per-row tables.`);
    },
  },

  {
    id: 13,
    name: 'Move completed scrobbles to per-row SQLite table',
    run: async (log) => {
      // completedScrobbleStore moved off the generic `persist(createJSONStorage)`
      // blob model onto the per-row `scrobble_events` table owned by
      // `src/store/persistence/scrobbleTable.ts`. This task reads the old blob
      // once, bulk-inserts valid scrobbles into the new table via a
      // transaction, then deletes the blob key. Idempotent: if the blob is
      // missing or already been migrated, it's a no-op.
      const raw = await sqliteStorage.getItem('substreamer-completed-scrobbles');
      if (!raw) {
        log('No persisted scrobble blob — nothing to migrate.');
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Corrupt blob — drop it so the new table starts clean.
        await sqliteStorage.removeItem('substreamer-completed-scrobbles');
        log('Failed to parse scrobble blob — removed.');
        return;
      }
      const raws: any[] = Array.isArray(parsed?.state?.completedScrobbles)
        ? parsed.state.completedScrobbles
        : [];
      if (raws.length === 0) {
        await sqliteStorage.removeItem('substreamer-completed-scrobbles');
        log('Scrobble blob was empty — removed.');
        return;
      }
      const valid: CompletedScrobble[] = [];
      const seen = new Set<string>();
      for (const s of raws) {
        if (!s || !s.id || !s.song?.id || !s.song?.title) continue;
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        valid.push(s as CompletedScrobble);
      }
      // Transactional bulk insert — blob removal only runs if the transaction
      // commits, so a mid-migration crash preserves the original blob for the
      // next launch to retry.
      replaceAllScrobbles(valid);
      await sqliteStorage.removeItem('substreamer-completed-scrobbles');
      const dropped = raws.length - valid.length;
      log(
        `Migrated ${valid.length} scrobble(s) to per-row table` +
          (dropped > 0 ? ` (dropped ${dropped} invalid/duplicate).` : '.'),
      );
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
  //   id: 8,
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
  const lines: string[] = [];

  lines.push(`Migration run: ${new Date().toISOString()}`);
  lines.push(`Platform: ${Platform.OS}`);
  lines.push('');

  for (const task of pending) {
    onProgress?.(task);
    lines.push(`--- Task ${task.id}: ${task.name} ---`);
    try {
      await task.run((msg) => lines.push(msg));
      completedVersion = task.id;
      lines.push('');
    } catch (e) {
      lines.push(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
      lines.push('');
      // Stop processing further tasks — a failed migration may leave
      // later ones in an ambiguous state. Persist progress up to the
      // last successful task so they aren't re-run on next launch.
      break;
    }
  }

  try {
    const logFile = new File(Paths.document, 'migration-log.txt');
    logFile.write(lines.join('\n'));
  } catch {
    /* Non-critical: failing to write the migration log must not
       fail the migration run itself. */
  }

  return completedVersion;
}
