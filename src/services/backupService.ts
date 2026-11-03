import { Directory, File, Paths } from 'expo-file-system';

import { listDirectoryAsync } from 'expo-async-fs';
import { compressToFile, decompressFromFile } from 'expo-gzip';

import { defaultCollator } from '../utils/intl';
import { authStore } from '../store/authStore';
import { backupStore } from '../store/backupStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { hydrateScrobblesAsync } from '../store/persistence/scrobbleTable';
import { deviceIdentityStore, getDeviceShortId } from '../store/deviceIdentityStore';
import { mbidOverrideStore } from '../store/mbidOverrideStore';
import { scrobbleExclusionStore } from '../store/scrobbleExclusionStore';
import { isReidComplete } from './navidromeReid/reidMarker';
import {
  convertRestoredBookmarks,
  convertRestoredExclusions,
  convertRestoredMbidOverrides,
  convertRestoredScrobbles,
} from './navidromeReid/reidRestore';
import { bookmarksStore } from '../store/bookmarksStore';

import { type CompletedScrobble } from '../store/completedScrobbleStore';
import { type MbidOverride } from '../store/mbidOverrideStore';
import { type ScrobbleExclusion } from '../store/scrobbleExclusionStore';
import { type PlayQueueBookmark } from '../store/bookmarksStore';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BackupDatasetMeta {
  itemCount: number;
  sizeBytes: number;
}

interface BackupMetaV3 {
  version: 3;
  createdAt: string;
  scrobbles: BackupDatasetMeta | null;
  mbidOverrides: BackupDatasetMeta | null;
  scrobbleExclusions: BackupDatasetMeta | null;
}

interface BackupMetaV4 {
  version: 4;
  createdAt: string;
  serverUrl: string;
  username: string;
  scrobbles: BackupDatasetMeta | null;
  mbidOverrides: BackupDatasetMeta | null;
  scrobbleExclusions: BackupDatasetMeta | null;
}

interface BackupMetaV5 {
  version: 5;
  createdAt: string;
  serverUrl: string;
  username: string;
  /** Stable per-install UUID of the creating device — canonical match key. */
  deviceId: string;
  /** OS-returned device name (`Device.deviceName`) at backup time. */
  deviceName: string | null;
  /** Human-readable display label at backup time (snapshot, not live). */
  deviceLabel: string;
  scrobbles: BackupDatasetMeta | null;
  mbidOverrides: BackupDatasetMeta | null;
  scrobbleExclusions: BackupDatasetMeta | null;
}

interface BackupMetaV6 {
  version: 6;
  createdAt: string;
  serverUrl: string;
  username: string;
  /** Stable per-install UUID of the creating device — canonical match key. */
  deviceId: string;
  /** OS-returned device name (`Device.deviceName`) at backup time. */
  deviceName: string | null;
  /** Human-readable display label at backup time (snapshot, not live). */
  deviceLabel: string;
  scrobbles: BackupDatasetMeta | null;
  mbidOverrides: BackupDatasetMeta | null;
  scrobbleExclusions: BackupDatasetMeta | null;
  bookmarks: BackupDatasetMeta | null;
}

type BackupMeta = BackupMetaV3 | BackupMetaV4 | BackupMetaV5 | BackupMetaV6;

export interface BackupEntry {
  createdAt: string;
  scrobbleCount: number;
  scrobbleSizeBytes: number;
  mbidOverrideCount: number;
  mbidOverrideSizeBytes: number;
  scrobbleExclusionCount: number;
  scrobbleExclusionSizeBytes: number;
  bookmarkCount: number;
  bookmarkSizeBytes: number;
  stem: string;
  serverUrl: string | null;
  username: string | null;
  /** v5+ — UUID of the creating device. Null for v3/v4 backups. */
  deviceId: string | null;
  /** v5+ — OS-returned device name at backup time. Null if not captured. */
  deviceName: string | null;
  /** v5+ — Human-readable label at backup time. Null for v3/v4 backups. */
  deviceLabel: string | null;
}

/** Restore application strategy — wholesale replace or merge into existing local data. */
export type RestoreMode = 'replace' | 'merge';

export interface RestoreCounts {
  /** Rows actually inserted (or replaced) into local stores. */
  scrobbleCount: number;
  /** Rows ignored as duplicates during merge (always 0 in replace mode). */
  scrobbleSkipped: number;
  mbidOverrideCount: number;
  mbidOverrideSkipped: number;
  scrobbleExclusionCount: number;
  scrobbleExclusionSkipped: number;
  bookmarkCount: number;
  bookmarkSkipped: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BACKUP_DIR_NAME = 'backups';
const MAX_BACKUPS = 5;
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Directory setup                                                    */
/* ------------------------------------------------------------------ */

const backupDir = new Directory(Paths.document, BACKUP_DIR_NAME);

function initBackupDir() {
  if (!backupDir.exists) {
    backupDir.create();
  }
}

try {
  initBackupDir();
} catch {
  /* Non-critical at module init. Exported functions re-attempt this
     inside their own try/catch scopes. Swallowing here prevents the
     module import from crashing startup if the FS is temporarily
     inaccessible (e.g. iOS backup restore, Android external storage). */
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
}

function metaFileName(stem: string): string {
  return `${stem}.meta.json`;
}

function scrobblesFileName(stem: string): string {
  return `${stem}.scrobbles.gz`;
}

function mbidFileName(stem: string): string {
  return `${stem}.mbid.gz`;
}

function exclusionsFileName(stem: string): string {
  return `${stem}.exclusions.gz`;
}

function bookmarksFileName(stem: string): string {
  return `${stem}.bookmarks.gz`;
}

/**
 * Compress + write one dataset to backupDir under `filename`. Writes to a
 * `.tmp` sibling first, deletes any existing dest, then moves into place —
 * so a crash between rename and content arrival can't leave a half-written
 * final file. On any error, the tmp is best-effort cleaned up and the
 * caller sees the original throw.
 */
async function writeBackupDataset(
  filename: string,
  data: unknown,
  itemCount: number,
): Promise<BackupDatasetMeta> {
  const tmpFile = new File(backupDir, filename + '.tmp');
  const destFile = new File(backupDir, filename);
  try {
    const { bytes } = await compressToFile(JSON.stringify(data), tmpFile.uri);
    if (destFile.exists) {
      try { destFile.delete(); } catch { /* best-effort */ }
    }
    await tmpFile.move(destFile);
    return { itemCount, sizeBytes: bytes };
  } catch (e) {
    if (tmpFile.exists) {
      try { tmpFile.delete(); } catch { /* best-effort */ }
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/*  Identity helpers                                                   */
/* ------------------------------------------------------------------ */

function normalizeServerUrl(url: string): string {
  let base = url.trim().toLowerCase();
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = `https://${base}`;
  }
  return base.replace(/\/+$/, '');
}

export function makeBackupIdentityKey(serverUrl: string, username: string): string {
  return `${normalizeServerUrl(serverUrl)}|${username.toLowerCase()}`;
}

function usernamesMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function serverUrlsMatch(a: string, b: string): boolean {
  return normalizeServerUrl(a) === normalizeServerUrl(b);
}

/* ------------------------------------------------------------------ */
/*  Create backup                                                      */
/* ------------------------------------------------------------------ */

export async function createBackup(): Promise<void> {
  initBackupDir();

  const { serverUrl, primaryServerUrl, username } = authStore.getState();
  // Identity = the SERVER, so key off the primary slot. `serverUrl` is only whichever
  // address is live, so a failover would otherwise stamp the same server as a new one.
  const identityUrl = primaryServerUrl ?? serverUrl;
  if (!identityUrl || !username) {
    throw new Error('Cannot create backup: no active session');
  }

  const { deviceId, deviceName, deviceLabel } = deviceIdentityStore.getState();

  const timestamp = makeTimestamp();
  // Suffix the stem with the device's short id so two devices that happen
  // to write a backup in the same second on a shared cloud folder don't
  // collide on filename. v3/v4 stems (`backup-{ts}`) keep working — the
  // listing parses by reading the meta JSON, not by parsing the filename.
  const stem = `backup-${timestamp}-${getDeviceShortId()}`;

  let scrobblesMeta: BackupDatasetMeta | null = null;
  let mbidMeta: BackupDatasetMeta | null = null;
  let exclusionsMeta: BackupDatasetMeta | null = null;
  let bookmarksMeta: BackupDatasetMeta | null = null;

  // Read the FULL history from SQL for the backup (transient — the store keeps
  // only a bounded recent slice in memory; analytics are SQL aggregates).
  const scrobbles = await hydrateScrobblesAsync();
  if (scrobbles.length > 0) {
    scrobblesMeta = await writeBackupDataset(scrobblesFileName(stem), scrobbles, scrobbles.length);
  }

  // The stores, not the repositories, for the same reason the bookmarks read below gives:
  // each holds the complete set whichever source it hydrates from, including before
  // migration 42 has moved its KV blob into rows.
  const overrides = mbidOverrideStore.getState().overrides;
  const overrideCount = Object.keys(overrides).length;
  if (overrideCount > 0) {
    mbidMeta = await writeBackupDataset(mbidFileName(stem), overrides, overrideCount);
  }

  const { excludedAlbums, excludedArtists, excludedPlaylists } = scrobbleExclusionStore.getState();
  const exclusionsData = { excludedAlbums, excludedArtists, excludedPlaylists };
  const exclusionCount =
    Object.keys(excludedAlbums).length +
    Object.keys(excludedArtists).length +
    Object.keys(excludedPlaylists).length;
  if (exclusionCount > 0) {
    exclusionsMeta = await writeBackupDataset(exclusionsFileName(stem), exclusionsData, exclusionCount);
  }

  // The store, not the repository: it holds the complete set whichever source it
  // hydrates from — including the case where migration 36 has not moved the KV blob
  // into rows yet. Exporting an empty file over a real set is not recoverable.
  const bookmarks = bookmarksStore.getState().bookmarks;
  const bookmarkCount = Object.keys(bookmarks).length;
  if (bookmarkCount > 0) {
    bookmarksMeta = await writeBackupDataset(bookmarksFileName(stem), bookmarks, bookmarkCount);
  }

  if (!scrobblesMeta && !mbidMeta && !exclusionsMeta && !bookmarksMeta) return;

  const meta: BackupMetaV6 = {
    version: 6,
    createdAt: new Date().toISOString(),
    serverUrl: identityUrl,
    username,
    deviceId,
    deviceName,
    deviceLabel,
    scrobbles: scrobblesMeta,
    mbidOverrides: mbidMeta,
    scrobbleExclusions: exclusionsMeta,
    bookmarks: bookmarksMeta,
  };

  const metaFile = new File(backupDir, metaFileName(stem));
  metaFile.write(JSON.stringify(meta));

  const identityKey = makeBackupIdentityKey(identityUrl, username);
  backupStore.getState().setLastBackupTime(identityKey, Date.now());
}

/* ------------------------------------------------------------------ */
/*  List backups                                                       */
/* ------------------------------------------------------------------ */

export async function listBackups(
  filter?: { serverUrl: string; username: string },
): Promise<{ current: BackupEntry[]; other: BackupEntry[] }> {
  initBackupDir();

  let fileNames: string[];
  try {
    fileNames = await listDirectoryAsync(backupDir.uri);
  } catch {
    return { current: [], other: [] };
  }

  const all: BackupEntry[] = [];

  for (const name of fileNames) {
    if (!name.endsWith('.meta.json')) continue;

    const metaFile = new File(backupDir, name);
    try {
      const raw = await metaFile.text();
      const meta: BackupMeta = JSON.parse(raw);

      if (meta.version !== 3 && meta.version !== 4 && meta.version !== 5 && meta.version !== 6) continue;

      const stem = name.replace(/\.meta\.json$/, '');

      const hasScrobbles = meta.scrobbles && new File(backupDir, scrobblesFileName(stem)).exists;
      const hasMbid = meta.mbidOverrides && new File(backupDir, mbidFileName(stem)).exists;
      const hasExclusions = meta.scrobbleExclusions && new File(backupDir, exclusionsFileName(stem)).exists;
      const hasBookmarks = (meta.version === 6) && meta.bookmarks && new File(backupDir, bookmarksFileName(stem)).exists;
      if (!hasScrobbles && !hasMbid && !hasExclusions && !hasBookmarks) continue;

      all.push({
        createdAt: meta.createdAt,
        scrobbleCount: meta.scrobbles?.itemCount ?? 0,
        scrobbleSizeBytes: meta.scrobbles?.sizeBytes ?? 0,
        mbidOverrideCount: meta.mbidOverrides?.itemCount ?? 0,
        mbidOverrideSizeBytes: meta.mbidOverrides?.sizeBytes ?? 0,
        scrobbleExclusionCount: meta.scrobbleExclusions?.itemCount ?? 0,
        scrobbleExclusionSizeBytes: meta.scrobbleExclusions?.sizeBytes ?? 0,
        bookmarkCount: meta.version === 6 ? (meta.bookmarks?.itemCount ?? 0) : 0,
        bookmarkSizeBytes: meta.version === 6 ? (meta.bookmarks?.sizeBytes ?? 0) : 0,
        stem,
        serverUrl: meta.version === 4 || meta.version === 5 || meta.version === 6 ? meta.serverUrl : null,
        username: meta.version === 4 || meta.version === 5 || meta.version === 6 ? meta.username : null,
        deviceId: (meta.version === 5 || meta.version === 6) ? meta.deviceId : null,
        deviceName: (meta.version === 5 || meta.version === 6) ? meta.deviceName : null,
        deviceLabel: (meta.version === 5 || meta.version === 6) ? meta.deviceLabel : null,
      });
    } catch {
      continue;
    }
  }

  all.sort((a, b) => defaultCollator.compare(b.createdAt, a.createdAt));

  if (!filter) {
    return { current: all, other: [] };
  }

  const current: BackupEntry[] = [];
  const other: BackupEntry[] = [];

  for (const entry of all) {
    if (!entry.username) {
      // v3 backups with no identity — skip (should have been migrated)
      continue;
    }
    if (!usernamesMatch(entry.username, filter.username)) {
      // Different user — hidden for privacy
      continue;
    }
    if (entry.serverUrl && serverUrlsMatch(entry.serverUrl, filter.serverUrl)) {
      current.push(entry);
    } else {
      other.push(entry);
    }
  }

  return { current, other };
}

/* ------------------------------------------------------------------ */
/*  Restore backup                                                     */
/* ------------------------------------------------------------------ */

export async function restoreBackup(
  entry: BackupEntry,
  mode: RestoreMode = 'replace',
): Promise<RestoreCounts> {
  let scrobbleCount = 0;
  let scrobbleSkipped = 0;
  let mbidOverrideCount = 0;
  let mbidOverrideSkipped = 0;
  let scrobbleExclusionCount = 0;
  let scrobbleExclusionSkipped = 0;
  let bookmarkCount = 0;
  let bookmarkSkipped = 0;

  // A backup taken before the server's 0.64 upgrade carries the retired ids. On an install
  // the re-key has already converted, convert them on the way in; otherwise the pass's own
  // run converts them along with everything else.
  const convertIds = isReidComplete();

  // Yield once so the caller's "restoring" spinner paints a frame before the
  // synchronous JSON.parse of the (potentially multi-MB) scrobble blob and the
  // O(n) buildAggregates/buildStats inside replaceAll/mergeAll block the JS
  // thread. setTimeout, not rAF — rAF can stall on Fabric.
  await new Promise((resolve) => setTimeout(resolve, 0));

  if (entry.scrobbleCount > 0) {
    const dataFile = new File(backupDir, scrobblesFileName(entry.stem));
    if (!dataFile.exists) {
      throw new Error('Scrobble backup data file not found');
    }
    const json = await decompressFromFile(dataFile.uri);
    const parsed: CompletedScrobble[] = JSON.parse(json);
    const scrobbles = convertIds ? convertRestoredScrobbles(parsed) : parsed;
    if (mode === 'merge') {
      // mergeAll uses INSERT OR IGNORE per-row inside one transaction,
      // returning the actual added/skipped counts; existing scrobbles are
      // preserved on id collision (random suffix makes collisions noise).
      const result = await completedScrobbleStore.getState().mergeAll(scrobbles);
      scrobbleCount = result.added;
      scrobbleSkipped = result.skipped;
    } else {
      // replaceAll writes the scrobble_events table in one transaction and then
      // refreshes stats/aggregates from SQL, keeping SQL + the store coherent for
      // any follow-up reads (home stats, my-listening, etc.).
      await completedScrobbleStore.getState().replaceAll(scrobbles);
      scrobbleCount = completedScrobbleStore.getState().stats.totalPlays;
    }
  }

  if (entry.mbidOverrideCount > 0) {
    const dataFile = new File(backupDir, mbidFileName(entry.stem));
    if (!dataFile.exists) {
      throw new Error('MBID override backup data file not found');
    }
    const json = await decompressFromFile(dataFile.uri);
    const raw: Record<string, any> = JSON.parse(json);
    // Normalize old-format overrides (keyed by artistId, no type field) to new format
    const needsMigration = Object.keys(raw).length > 0 &&
      !Object.keys(raw).some((k) => k.startsWith('artist:') || k.startsWith('album:'));
    let overrides: Record<string, MbidOverride>;
    if (needsMigration) {
      overrides = {};
      for (const [key, entry] of Object.entries(raw)) {
        const entityId = entry.artistId ?? entry.entityId ?? key;
        const entityName = entry.artistName ?? entry.entityName ?? '';
        overrides[`artist:${entityId}`] = { type: 'artist', entityId, entityName, mbid: entry.mbid };
      }
    } else {
      overrides = raw as Record<string, MbidOverride>;
    }
    if (convertIds) overrides = convertRestoredMbidOverrides(overrides);
    if (mode === 'merge') {
      // mergeOverrides keeps existing local entries on key conflict so the
      // user's most recent edit on this device is preserved.
      const result = mbidOverrideStore.getState().mergeOverrides(overrides);
      mbidOverrideCount = result.added;
      mbidOverrideSkipped = result.skipped;
    } else {
      // Through the store's action, never `setState`: replace mode has to clear the
      // existing rows and write the file's in their place, and the action owns both
      // halves (plus dropping malformed entries).
      mbidOverrideCount = mbidOverrideStore.getState().replaceOverrides(overrides);
    }
  }

  if (entry.scrobbleExclusionCount > 0) {
    const dataFile = new File(backupDir, exclusionsFileName(entry.stem));
    if (!dataFile.exists) {
      throw new Error('Scrobble exclusion backup data file not found');
    }
    const json = await decompressFromFile(dataFile.uri);
    const parsed: {
      excludedAlbums: Record<string, ScrobbleExclusion>;
      excludedArtists: Record<string, ScrobbleExclusion>;
      excludedPlaylists: Record<string, ScrobbleExclusion>;
    } = JSON.parse(json);
    const data = convertIds ? convertRestoredExclusions(parsed) : parsed;
    if (mode === 'merge') {
      const result = scrobbleExclusionStore.getState().mergeExclusions(data);
      scrobbleExclusionCount = result.added;
      scrobbleExclusionSkipped = result.skipped;
    } else {
      // Through the store's action, never `setState` — same reason as the overrides
      // above: the existing rows have to go before the file's are written.
      scrobbleExclusionCount = scrobbleExclusionStore.getState().replaceExclusions(data);
    }
  }

  if (entry.bookmarkCount > 0) {
    const dataFile = new File(backupDir, bookmarksFileName(entry.stem));
    if (!dataFile.exists) {
      throw new Error('Bookmark backup data file not found');
    }
    const json = await decompressFromFile(dataFile.uri);
    const parsed: Record<string, PlayQueueBookmark> = JSON.parse(json);
    const data = convertIds ? convertRestoredBookmarks(parsed) : parsed;
    if (mode === 'merge') {
      const result = bookmarksStore.getState().mergeBookmarks(data);
      bookmarkCount = result.added;
      bookmarkSkipped = result.skipped;
    } else {
      // Through the store's action, never `setState`: replace mode has to clear the
      // existing snapshot rows and write the file's in their place, and the action
      // owns both halves (plus dropping malformed entries).
      bookmarkCount = bookmarksStore.getState().replaceBookmarks(data);
    }
  }

  return {
    scrobbleCount, scrobbleSkipped,
    mbidOverrideCount, mbidOverrideSkipped,
    scrobbleExclusionCount, scrobbleExclusionSkipped,
    bookmarkCount, bookmarkSkipped,
  };
}

/* ------------------------------------------------------------------ */
/*  Prune old backups                                                  */
/* ------------------------------------------------------------------ */

export async function pruneBackups(keep = MAX_BACKUPS): Promise<void> {
  const { serverUrl, primaryServerUrl, username } = authStore.getState();
  const identityUrl = primaryServerUrl ?? serverUrl;
  if (!identityUrl || !username) return;

  // Get all backups for the current username (across all server URLs)
  const { current, other } = await listBackups({ serverUrl: identityUrl, username });
  const allForUser = [...current, ...other];
  // Sort newest-first so each bucket retains the freshest `keep` entries.
  allForUser.sort((a, b) => defaultCollator.compare(b.createdAt, a.createdAt));

  // Bucket per (serverUrl, username, deviceId). Backups without a deviceId
  // (v3/v4 from before the device-tagging upgrade) share a single "legacy"
  // bucket so the pre-upgrade history isn't deleted wholesale on the next
  // prune. With three devices on the same identity each retaining `keep`
  // entries plus the legacy bucket, on-disk total stays bounded.
  const buckets = new Map<string, BackupEntry[]>();
  for (const entry of allForUser) {
    const bucketKey = entry.deviceId
      ? `${entry.serverUrl ?? '?'}|${entry.username ?? '?'}|${entry.deviceId}`
      : 'legacy';
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = [];
      buckets.set(bucketKey, bucket);
    }
    bucket.push(entry);
  }

  const toDelete: BackupEntry[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length <= keep) continue;
    toDelete.push(...bucket.slice(keep));
  }

  for (const entry of toDelete) {
    const filesToRemove = [
      metaFileName(entry.stem),
      scrobblesFileName(entry.stem),
      mbidFileName(entry.stem),
      exclusionsFileName(entry.stem),
      bookmarksFileName(entry.stem),
    ];
    for (const name of filesToRemove) {
      try {
        const f = new File(backupDir, name);
        if (f.exists) f.delete();
      } catch { /* best-effort */ }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Startup cleanup                                                    */
/* ------------------------------------------------------------------ */

/**
 * Scan the backup directory for incomplete files left behind by an
 * interrupted backup (e.g. app killed mid-write, battery death).
 *
 * Removes:
 *  - .tmp files from interrupted compressions
 *  - orphaned .gz data files that have no matching .meta.json
 */
async function cleanUpOrphanedFiles(): Promise<void> {
  initBackupDir();

  let fileNames: string[];
  try {
    fileNames = await listDirectoryAsync(backupDir.uri);
  } catch {
    return;
  }

  const metaStems = new Set<string>();

  for (const name of fileNames) {
    if (name.endsWith('.tmp')) {
      try { new File(backupDir, name).delete(); } catch { /* best-effort */ }
    } else if (name.endsWith('.meta.json')) {
      metaStems.add(name.replace(/\.meta\.json$/, ''));
    }
  }

  for (const name of fileNames) {
    if (name.endsWith('.tmp')) continue;
    if (name.endsWith('.meta.json')) continue;

    const stem = name.replace(/\.(scrobbles|mbid|exclusions|bookmarks)\.gz$/, '');
    if (stem !== name && !metaStems.has(stem)) {
      try { new File(backupDir, name).delete(); } catch { /* best-effort */ }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Auto-backup                                                        */
/* ------------------------------------------------------------------ */

export async function runAutoBackupIfNeeded(): Promise<void> {
  try {
    await cleanUpOrphanedFiles();

    const { autoBackupEnabled } = backupStore.getState();
    if (!autoBackupEnabled) return;

    const { serverUrl, primaryServerUrl, username } = authStore.getState();
    const identityUrl = primaryServerUrl ?? serverUrl;
    if (!identityUrl || !username) return;

    const identityKey = makeBackupIdentityKey(identityUrl, username);
    const lastBackupTime = backupStore.getState().getLastBackupTime(identityKey);

    const now = Date.now();
    if (lastBackupTime && now - lastBackupTime < AUTO_BACKUP_INTERVAL_MS) return;

    await createBackup();
    await pruneBackups();
  } catch {
    /* Auto-backup is best-effort; don't crash the app on failure.
       This includes init-time FS failures from cleanUpOrphanedFiles/
       createBackup/pruneBackups and any transient file system errors. */
  }
}

/* ------------------------------------------------------------------ */
/*  V4 → V5 migration helper                                          */
/* ------------------------------------------------------------------ */

/**
 * Upgrade all v4 backup meta files to v5 by stamping them with the
 * **current** device's identity. There's no record of which device
 * originally created a v4 backup, so attributing them to the local
 * device is the best we can do — and is correct in the common case
 * (the user has just upgraded on their primary device).
 *
 * Idempotent: only files with `version === 4` are touched. Subsequent
 * launches no-op. v3 backups are not double-bumped here — the existing
 * `migrateV3BackupMetas` handles those.
 */
export async function migrateV4BackupMetas(
  deviceId: string,
  deviceName: string | null,
  deviceLabel: string,
): Promise<number> {
  initBackupDir();

  let fileNames: string[];
  try {
    fileNames = await listDirectoryAsync(backupDir.uri);
  } catch {
    return 0;
  }

  let migrated = 0;

  for (const name of fileNames) {
    if (!name.endsWith('.meta.json')) continue;

    const metaFile = new File(backupDir, name);
    try {
      const raw = await metaFile.text();
      const meta = JSON.parse(raw);

      if (meta.version !== 4) continue;

      const upgraded: BackupMetaV5 = {
        version: 5,
        createdAt: meta.createdAt,
        serverUrl: meta.serverUrl,
        username: meta.username,
        deviceId,
        deviceName,
        deviceLabel,
        scrobbles: meta.scrobbles,
        mbidOverrides: meta.mbidOverrides,
        scrobbleExclusions: meta.scrobbleExclusions,
      };

      metaFile.write(JSON.stringify(upgraded));
      migrated++;
    } catch {
      continue;
    }
  }

  return migrated;
}

/* ------------------------------------------------------------------ */
/*  V3 → V4 migration helper                                          */
/* ------------------------------------------------------------------ */

/**
 * Upgrade all v3 backup meta files to v4 by stamping them with the
 * provided server URL and username. Called from migrationService.
 */
export async function migrateV3BackupMetas(
  serverUrl: string,
  username: string,
): Promise<number> {
  initBackupDir();

  let fileNames: string[];
  try {
    fileNames = await listDirectoryAsync(backupDir.uri);
  } catch {
    return 0;
  }

  let migrated = 0;

  for (const name of fileNames) {
    if (!name.endsWith('.meta.json')) continue;

    const metaFile = new File(backupDir, name);
    try {
      const raw = await metaFile.text();
      const meta = JSON.parse(raw);

      if (meta.version !== 3) continue;

      const upgraded: BackupMetaV4 = {
        version: 4,
        createdAt: meta.createdAt,
        serverUrl,
        username,
        scrobbles: meta.scrobbles,
        mbidOverrides: meta.mbidOverrides,
        scrobbleExclusions: meta.scrobbleExclusions,
      };

      metaFile.write(JSON.stringify(upgraded));
      migrated++;
    } catch {
      continue;
    }
  }

  return migrated;
}
