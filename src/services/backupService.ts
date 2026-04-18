import { Directory, File, Paths } from 'expo-file-system';

import { listDirectoryAsync } from 'expo-async-fs';
import { compressToFile, decompressFromFile } from 'expo-gzip';

import { authStore } from '../store/authStore';
import { backupStore } from '../store/backupStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { mbidOverrideStore } from '../store/mbidOverrideStore';
import { scrobbleExclusionStore } from '../store/scrobbleExclusionStore';

import { type CompletedScrobble } from '../store/completedScrobbleStore';
import { type MbidOverride } from '../store/mbidOverrideStore';
import { type ScrobbleExclusion } from '../store/scrobbleExclusionStore';

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

type BackupMeta = BackupMetaV3 | BackupMetaV4;

export interface BackupEntry {
  createdAt: string;
  scrobbleCount: number;
  scrobbleSizeBytes: number;
  mbidOverrideCount: number;
  mbidOverrideSizeBytes: number;
  scrobbleExclusionCount: number;
  scrobbleExclusionSizeBytes: number;
  stem: string;
  serverUrl: string | null;
  username: string | null;
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

export function initBackupDir() {
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

  const { serverUrl, username } = authStore.getState();
  if (!serverUrl || !username) {
    throw new Error('Cannot create backup: no active session');
  }

  const timestamp = makeTimestamp();
  const stem = `backup-${timestamp}`;

  let scrobblesMeta: BackupDatasetMeta | null = null;
  let mbidMeta: BackupDatasetMeta | null = null;
  let exclusionsMeta: BackupDatasetMeta | null = null;

  const scrobbles = completedScrobbleStore.getState().completedScrobbles;
  if (scrobbles.length > 0) {
    const tmpFile = new File(backupDir, scrobblesFileName(stem) + '.tmp');
    const destFile = new File(backupDir, scrobblesFileName(stem));
    try {
      const { bytes } = await compressToFile(JSON.stringify(scrobbles), tmpFile.uri);
      if (destFile.exists) {
        try { destFile.delete(); } catch { /* best-effort */ }
      }
      tmpFile.move(destFile);
      scrobblesMeta = { itemCount: scrobbles.length, sizeBytes: bytes };
    } catch (e) {
      if (tmpFile.exists) {
        try { tmpFile.delete(); } catch { /* best-effort */ }
      }
      throw e;
    }
  }

  const overrides = mbidOverrideStore.getState().overrides;
  const overrideCount = Object.keys(overrides).length;
  if (overrideCount > 0) {
    const tmpFile = new File(backupDir, mbidFileName(stem) + '.tmp');
    const destFile = new File(backupDir, mbidFileName(stem));
    try {
      const { bytes } = await compressToFile(JSON.stringify(overrides), tmpFile.uri);
      if (destFile.exists) {
        try { destFile.delete(); } catch { /* best-effort */ }
      }
      tmpFile.move(destFile);
      mbidMeta = { itemCount: overrideCount, sizeBytes: bytes };
    } catch (e) {
      if (tmpFile.exists) {
        try { tmpFile.delete(); } catch { /* best-effort */ }
      }
      throw e;
    }
  }

  const { excludedAlbums, excludedArtists, excludedPlaylists } = scrobbleExclusionStore.getState();
  const exclusionsData = { excludedAlbums, excludedArtists, excludedPlaylists };
  const exclusionCount =
    Object.keys(excludedAlbums).length +
    Object.keys(excludedArtists).length +
    Object.keys(excludedPlaylists).length;
  if (exclusionCount > 0) {
    const tmpFile = new File(backupDir, exclusionsFileName(stem) + '.tmp');
    const destFile = new File(backupDir, exclusionsFileName(stem));
    try {
      const { bytes } = await compressToFile(JSON.stringify(exclusionsData), tmpFile.uri);
      if (destFile.exists) {
        try { destFile.delete(); } catch { /* best-effort */ }
      }
      tmpFile.move(destFile);
      exclusionsMeta = { itemCount: exclusionCount, sizeBytes: bytes };
    } catch (e) {
      if (tmpFile.exists) {
        try { tmpFile.delete(); } catch { /* best-effort */ }
      }
      throw e;
    }
  }

  if (!scrobblesMeta && !mbidMeta && !exclusionsMeta) return;

  const meta: BackupMetaV4 = {
    version: 4,
    createdAt: new Date().toISOString(),
    serverUrl,
    username,
    scrobbles: scrobblesMeta,
    mbidOverrides: mbidMeta,
    scrobbleExclusions: exclusionsMeta,
  };

  const metaFile = new File(backupDir, metaFileName(stem));
  metaFile.write(JSON.stringify(meta));

  const identityKey = makeBackupIdentityKey(serverUrl, username);
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

      if (meta.version !== 3 && meta.version !== 4) continue;

      const stem = name.replace(/\.meta\.json$/, '');

      const hasScrobbles = meta.scrobbles && new File(backupDir, scrobblesFileName(stem)).exists;
      const hasMbid = meta.mbidOverrides && new File(backupDir, mbidFileName(stem)).exists;
      const hasExclusions = meta.scrobbleExclusions && new File(backupDir, exclusionsFileName(stem)).exists;
      if (!hasScrobbles && !hasMbid && !hasExclusions) continue;

      all.push({
        createdAt: meta.createdAt,
        scrobbleCount: meta.scrobbles?.itemCount ?? 0,
        scrobbleSizeBytes: meta.scrobbles?.sizeBytes ?? 0,
        mbidOverrideCount: meta.mbidOverrides?.itemCount ?? 0,
        mbidOverrideSizeBytes: meta.mbidOverrides?.sizeBytes ?? 0,
        scrobbleExclusionCount: meta.scrobbleExclusions?.itemCount ?? 0,
        scrobbleExclusionSizeBytes: meta.scrobbleExclusions?.sizeBytes ?? 0,
        stem,
        serverUrl: meta.version === 4 ? meta.serverUrl : null,
        username: meta.version === 4 ? meta.username : null,
      });
    } catch {
      continue;
    }
  }

  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
): Promise<{ scrobbleCount: number; mbidOverrideCount: number; scrobbleExclusionCount: number }> {
  let scrobbleCount = 0;
  let mbidOverrideCount = 0;
  let scrobbleExclusionCount = 0;

  if (entry.scrobbleCount > 0) {
    const dataFile = new File(backupDir, scrobblesFileName(entry.stem));
    if (!dataFile.exists) {
      throw new Error('Scrobble backup data file not found');
    }
    const json = await decompressFromFile(dataFile.uri);
    const scrobbles: CompletedScrobble[] = JSON.parse(json);
    // replaceAll writes the scrobble_events table in one transaction and then
    // rebuilds stats/aggregates from the validated set, keeping SQL + memory
    // coherent for any follow-up reads (home stats, my-listening, etc.).
    completedScrobbleStore.getState().replaceAll(scrobbles);
    scrobbleCount = completedScrobbleStore.getState().completedScrobbles.length;
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
    mbidOverrideStore.setState({ overrides });
    mbidOverrideCount = Object.keys(overrides).length;
  }

  if (entry.scrobbleExclusionCount > 0) {
    const dataFile = new File(backupDir, exclusionsFileName(entry.stem));
    if (!dataFile.exists) {
      throw new Error('Scrobble exclusion backup data file not found');
    }
    const json = await decompressFromFile(dataFile.uri);
    const data: {
      excludedAlbums: Record<string, ScrobbleExclusion>;
      excludedArtists: Record<string, ScrobbleExclusion>;
      excludedPlaylists: Record<string, ScrobbleExclusion>;
    } = JSON.parse(json);
    scrobbleExclusionStore.setState({
      excludedAlbums: data.excludedAlbums,
      excludedArtists: data.excludedArtists,
      excludedPlaylists: data.excludedPlaylists,
    });
    scrobbleExclusionCount =
      Object.keys(data.excludedAlbums).length +
      Object.keys(data.excludedArtists).length +
      Object.keys(data.excludedPlaylists).length;
  }

  return { scrobbleCount, mbidOverrideCount, scrobbleExclusionCount };
}

/* ------------------------------------------------------------------ */
/*  Prune old backups                                                  */
/* ------------------------------------------------------------------ */

export async function pruneBackups(keep = MAX_BACKUPS): Promise<void> {
  const { serverUrl, username } = authStore.getState();
  if (!serverUrl || !username) return;

  // Get all backups for the current username (across all server URLs)
  const { current, other } = await listBackups({ serverUrl, username });
  const allForUser = [...current, ...other];
  allForUser.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (allForUser.length <= keep) return;

  const toDelete = allForUser.slice(keep);
  for (const entry of toDelete) {
    const filesToRemove = [
      metaFileName(entry.stem),
      scrobblesFileName(entry.stem),
      mbidFileName(entry.stem),
      exclusionsFileName(entry.stem),
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

    const stem = name.replace(/\.(scrobbles|mbid|exclusions)\.gz$/, '');
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

    const { serverUrl, username } = authStore.getState();
    if (!serverUrl || !username) return;

    const identityKey = makeBackupIdentityKey(serverUrl, username);
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
