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
import { listDirectoryAsync } from 'expo-async-fs';
import { Platform } from 'react-native';

import { migrateV3BackupMetas } from './backupService';
import { getAllSongAlbumIds } from '../store/persistence/detailTables';
import {
  completedScrobbleStore,
  type CompletedScrobble,
} from '../store/completedScrobbleStore';
import { mbidOverrideStore, type MbidOverride } from '../store/mbidOverrideStore';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { localeStore } from '../store/localeStore';
import {
  upsertAlbumDetail,
  upsertSongsForAlbum,
} from '../store/persistence/detailTables';
import {
  bulkReplace as bulkReplaceMusicCache,
  countCachedItems as countCachedItemsRow,
  countCachedItemSongs as countCachedItemSongsRow,
  countCachedSongs as countCachedSongsRow,
  countDownloadQueueItems as countDownloadQueueItemsRow,
  readPragma as readMusicCacheTablesPragma,
  type CachedItemRow,
  type CachedSongRow,
  type DownloadQueueRow,
} from '../store/persistence/musicCacheTables';
import { replaceAllScrobbles } from '../store/persistence/scrobbleTable';
import { sqliteStorage } from '../store/sqliteStorage';

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
/**
 * Shared body for Migration 14 (forward run) and Migration 15 (recovery).
 * Reads the v1 `substreamer-music-cache` blob, resolves every track's parent
 * albumId, transforms into v2 rows, commits via `bulkReplaceMusicCache`,
 * writes the `maxConcurrentDownloads` setting, and re-homes files on disk
 * into the album-rooted layout. The filesystem migration is idempotent —
 * files already at the target path are no-ops, so calling this a second
 * time (Migration 15 recovery) is safe even when Migration 14 already moved
 * everything.
 *
 * Returns false if the blob is missing or unparseable (migration is a
 * no-op); true if the migration ran and `bulkReplaceMusicCache` was
 * invoked (even if it silently persisted nothing — the caller can cross-
 * check counts afterwards).
 */
async function migrateMusicCacheFromBlob(
  log: (message: string) => void,
): Promise<boolean> {
  const raw = await sqliteStorage.getItem('substreamer-music-cache');
  if (!raw) {
    log('No persisted music-cache blob — nothing to migrate.');
    return false;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await sqliteStorage.removeItem('substreamer-music-cache');
    log('Failed to parse music-cache blob — removed.');
    return false;
  }
  const state = parsed?.state;
  if (!state || typeof state !== 'object') {
    await sqliteStorage.removeItem('substreamer-music-cache');
    log('Music-cache blob had no state — removed.');
    return false;
  }

  const v1CachedItems: Record<string, any> = state.cachedItems ?? {};
  const v1DownloadQueue: any[] = Array.isArray(state.downloadQueue)
    ? state.downloadQueue
    : [];
  const v1DownloadedFormats: Record<string, any> =
    state.downloadedFormats ?? {};
  const v1MaxConcurrent = state.maxConcurrentDownloads;

  // ===== Diagnostic phase 1: v1 blob parse summary =====
  const v1ItemCount = Object.keys(v1CachedItems).length;
  const v1TypeCounts: Record<string, number> = {};
  const v1TrackCounts: Record<string, number> = {};
  for (const [id, it] of Object.entries(v1CachedItems)) {
    const t = (it as any)?.type ?? 'unknown';
    v1TypeCounts[t] = (v1TypeCounts[t] ?? 0) + 1;
    const tracks = (it as any)?.tracks;
    v1TrackCounts[id] = Array.isArray(tracks) ? tracks.length : 0;
  }
  log(
    `[diag] v1 blob: ${v1ItemCount} item(s) (` +
      Object.entries(v1TypeCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') +
      `), ${v1DownloadQueue.length} queue row(s), ` +
      `${Object.keys(v1DownloadedFormats).length} format stamp(s), ` +
      `maxConcurrent=${String(v1MaxConcurrent)}`,
  );

  // ===== Diagnostic phase 2: SQL pragma state =====
  log(
    `[diag] PRAGMA: foreign_keys=${readMusicCacheTablesPragma('foreign_keys') ?? 'null'}, ` +
      `journal_mode=${readMusicCacheTablesPragma('journal_mode') ?? 'null'}, ` +
      `synchronous=${readMusicCacheTablesPragma('synchronous') ?? 'null'}`,
  );

  // ===== Diagnostic phase 3: pre-bulkReplace SQL table state =====
  log(
    `[diag] SQL before bulkReplace: ` +
      `cached_items=${countCachedItemsRow()}, ` +
      `cached_songs=${countCachedSongsRow()}, ` +
      `cached_item_songs=${countCachedItemSongsRow()}, ` +
      `download_queue=${countDownloadQueueItemsRow()}`,
  );

  // Build trackId -> albumId map from every source that's reliably
  // available at migration time.
  const trackIdToAlbumId = new Map<string, string>();
  let resolvedVia1 = 0, resolvedVia2 = 0, resolvedVia3 = 0, resolvedVia4 = 0;

  // Source 1: v1 album items.
  for (const item of Object.values(v1CachedItems)) {
    if (item?.type === 'album' && Array.isArray(item.tracks)) {
      for (const t of item.tracks) {
        if (t?.id && !trackIdToAlbumId.has(t.id)) {
          trackIdToAlbumId.set(t.id, item.itemId);
          resolvedVia1++;
        }
      }
    }
  }

  // Source 2: song_index SQL table.
  try {
    const sqlMap = getAllSongAlbumIds();
    for (const [songId, albumId] of sqlMap) {
      if (!trackIdToAlbumId.has(songId)) {
        trackIdToAlbumId.set(songId, albumId);
        resolvedVia2++;
      }
    }
  } catch (e) {
    log(`[diag] resolver source 2 (song_index) threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Source 3: substreamer-playlist-details blob.
  try {
    const rawPlaylists = await sqliteStorage.getItem('substreamer-playlist-details');
    if (rawPlaylists) {
      const parsedPlaylists = JSON.parse(rawPlaylists);
      const playlists = parsedPlaylists?.state?.playlists ?? {};
      for (const entry of Object.values(playlists)) {
        const pl = (entry as any)?.playlist;
        const songs = Array.isArray(pl?.entry) ? pl.entry : [];
        for (const s of songs) {
          if (s?.id && s?.albumId && !trackIdToAlbumId.has(s.id)) {
            trackIdToAlbumId.set(s.id, s.albumId);
            resolvedVia3++;
          }
        }
      }
    }
  } catch (e) {
    log(`[diag] resolver source 3 (playlist-details blob) threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Source 4: substreamer-favorites blob.
  try {
    const rawFavs = await sqliteStorage.getItem('substreamer-favorites');
    if (rawFavs) {
      const parsedFavs = JSON.parse(rawFavs);
      const songs = Array.isArray(parsedFavs?.state?.songs)
        ? parsedFavs.state.songs
        : [];
      for (const s of songs) {
        if (s?.id && s?.albumId && !trackIdToAlbumId.has(s.id)) {
          trackIdToAlbumId.set(s.id, s.albumId);
          resolvedVia4++;
        }
      }
    }
  } catch (e) {
    log(`[diag] resolver source 4 (favorites blob) threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  log(
    `[diag] album_id resolver: ${trackIdToAlbumId.size} total mappings ` +
      `(v1-album-items=${resolvedVia1}, song_index=${resolvedVia2}, ` +
      `playlist-details=${resolvedVia3}, favorites=${resolvedVia4})`,
  );

  const resolveAlbumId = (trackId: string): string =>
    trackIdToAlbumId.get(trackId) ?? '_unknown';

  const mapV2Type = (
    itemId: string,
    v1Type: unknown,
  ): 'album' | 'playlist' | 'favorites' | 'song' => {
    if (itemId === '__starred__') return 'favorites';
    if (v1Type === 'album') return 'album';
    return 'playlist';
  };

  const itemRows: Array<Omit<CachedItemRow, 'songIds'>> = [];
  const songsById = new Map<string, CachedSongRow>();
  const edges: Array<{ itemId: string; position: number; songId: string }> = [];

  for (const item of Object.values(v1CachedItems)) {
    if (!item?.itemId) continue;
    const tracksArr: any[] = Array.isArray(item.tracks) ? item.tracks : [];
    const v2Type = mapV2Type(item.itemId, item.type);
    const downloadedAt =
      typeof item.downloadedAt === 'number' ? item.downloadedAt : Date.now();

    itemRows.push({
      itemId: item.itemId,
      type: v2Type,
      name: typeof item.name === 'string' ? item.name : 'Unknown',
      artist: typeof item.artist === 'string' ? item.artist : undefined,
      coverArtId:
        typeof item.coverArtId === 'string' ? item.coverArtId : undefined,
      expectedSongCount: tracksArr.length,
      parentAlbumId: undefined,
      lastSyncAt: downloadedAt,
      downloadedAt,
    });

    tracksArr.forEach((track: any, idx: number) => {
      if (!track?.id) return;

      const albumId =
        v2Type === 'album' ? item.itemId : resolveAlbumId(track.id);

      if (!songsById.has(track.id)) {
        const fileName =
          typeof track.fileName === 'string' ? track.fileName : '';
        const suffix = fileName.includes('.')
          ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
          : 'mp3';

        const fmt = v1DownloadedFormats[track.id];
        const formatCapturedAt =
          typeof fmt?.capturedAt === 'number' ? fmt.capturedAt : downloadedAt;

        const songRow: CachedSongRow = {
          id: track.id,
          title: typeof track.title === 'string' ? track.title : 'Unknown',
          albumId,
          bytes: typeof track.bytes === 'number' ? track.bytes : 0,
          duration: typeof track.duration === 'number' ? track.duration : 0,
          suffix,
          formatCapturedAt,
          downloadedAt,
        };
        if (typeof track.artist === 'string') songRow.artist = track.artist;
        if (typeof track.coverArt === 'string') songRow.coverArt = track.coverArt;
        if (typeof fmt?.bitRate === 'number') songRow.bitRate = fmt.bitRate;
        if (typeof fmt?.bitDepth === 'number') songRow.bitDepth = fmt.bitDepth;
        if (typeof fmt?.samplingRate === 'number') {
          songRow.samplingRate = fmt.samplingRate;
        }
        songsById.set(track.id, songRow);
      }

      edges.push({ itemId: item.itemId, position: idx + 1, songId: track.id });
    });
  }

  const queueRows: DownloadQueueRow[] = v1DownloadQueue
    .filter((q: any) => q?.queueId && q?.itemId)
    .map((q: any, idx: number) => {
      const v2Type = mapV2Type(q.itemId, q.type);
      const tracks: any[] = Array.isArray(q.tracks) ? q.tracks : [];
      const rawStatus =
        typeof q.status === 'string' ? q.status : 'queued';
      const status: DownloadQueueRow['status'] =
        rawStatus === 'downloading'
          ? 'queued'
          : (rawStatus as DownloadQueueRow['status']);
      const row: DownloadQueueRow = {
        queueId: q.queueId,
        itemId: q.itemId,
        type: v2Type,
        name: typeof q.name === 'string' ? q.name : 'Unknown',
        status,
        totalSongs:
          typeof q.totalTracks === 'number' ? q.totalTracks : tracks.length,
        completedSongs:
          typeof q.completedTracks === 'number' ? q.completedTracks : 0,
        addedAt: typeof q.addedAt === 'number' ? q.addedAt : Date.now(),
        queuePosition: idx + 1,
        songsJson: JSON.stringify(tracks),
      };
      if (typeof q.artist === 'string') row.artist = q.artist;
      if (typeof q.coverArtId === 'string') row.coverArtId = q.coverArtId;
      if (typeof q.error === 'string') row.error = q.error;
      return row;
    });

  // ===== Diagnostic phase 4: pre-bulkReplace input summary =====
  const uniqueAlbumIds = new Set<string>();
  for (const s of songsById.values()) uniqueAlbumIds.add(s.albumId);
  const uniqueEdgeItemIds = new Set<string>();
  for (const e of edges) uniqueEdgeItemIds.add(e.itemId);
  const itemIdsSet = new Set(itemRows.map((i) => i.itemId));
  const edgesWithOrphanItemId = edges.filter((e) => !itemIdsSet.has(e.itemId)).length;
  const edgesWithOrphanSongId = edges.filter((e) => !songsById.has(e.songId)).length;
  log(
    `[diag] bulkReplace inputs: items=${itemRows.length} ` +
      `(types=${itemRows.map((i) => i.type).join(',')}; ids=${Array.from(itemIdsSet).join(',')}), ` +
      `songs=${songsById.size}, ` +
      `edges=${edges.length} (spanning ${uniqueEdgeItemIds.size} item_id(s)), ` +
      `unique albumIds in songs=${uniqueAlbumIds.size}, ` +
      `queue=${queueRows.length}. ` +
      `FK sanity: ${edgesWithOrphanItemId} edge(s) ref missing item_id, ` +
      `${edgesWithOrphanSongId} edge(s) ref missing song_id.`,
  );

  let bulkReplaceError: string | null = null;
  try {
    bulkReplaceMusicCache({
      items: itemRows,
      songs: Array.from(songsById.values()),
      edges,
      queue: queueRows,
    });
  } catch (e) {
    bulkReplaceError = e instanceof Error ? e.message : String(e);
    log(`[diag] bulkReplace THREW: ${bulkReplaceError}`);
  }

  // ===== Diagnostic phase 5: post-bulkReplace SQL verification =====
  const afterItems = countCachedItemsRow();
  const afterSongs = countCachedSongsRow();
  const afterEdges = countCachedItemSongsRow();
  const afterQueue = countDownloadQueueItemsRow();
  log(
    `[diag] SQL after bulkReplace: ` +
      `cached_items=${afterItems} (expected ${itemRows.length}), ` +
      `cached_songs=${afterSongs} (expected ${songsById.size}), ` +
      `cached_item_songs=${afterEdges} (expected ${edges.length}), ` +
      `download_queue=${afterQueue} (expected ${queueRows.length})`,
  );
  if (
    afterItems !== itemRows.length ||
    afterSongs !== songsById.size ||
    afterEdges !== edges.length ||
    afterQueue !== queueRows.length
  ) {
    log(
      `[diag] !!! MISMATCH DETECTED !!! bulkReplace did not persist all ` +
        `expected rows. Differences: ` +
        `items Δ=${afterItems - itemRows.length}, ` +
        `songs Δ=${afterSongs - songsById.size}, ` +
        `edges Δ=${afterEdges - edges.length}, ` +
        `queue Δ=${afterQueue - queueRows.length}.`,
    );
  } else {
    log(`[diag] bulkReplace verified: all 4 tables match expected counts.`);
  }

  // Preserve the user's maxConcurrentDownloads setting.
  if (
    v1MaxConcurrent === 1 ||
    v1MaxConcurrent === 3 ||
    v1MaxConcurrent === 5
  ) {
    await sqliteStorage.setItem(
      'substreamer-music-cache-settings',
      JSON.stringify({ maxConcurrentDownloads: v1MaxConcurrent }),
    );
  }

  // Filesystem migration — idempotent + dedup-aware. Safe to call again in
  // the Migration 15 recovery path: files already at the target path are
  // treated as no-ops.
  let movedCount = 0;
  let noopCount = 0;
  let dupesDeleted = 0;
  let missingCount = 0;
  let staleDirsDeleted = 0;
  try {
    const cacheDir = new Directory(Paths.document, 'music-cache');
    if (cacheDir.exists) {
      const filesBySongId = new Map<string, File[]>();
      let topLevelNames: string[] = [];
      try {
        const listed = await listDirectoryAsync(cacheDir.uri);
        topLevelNames = Array.isArray(listed) ? listed : [];
      } catch { /* best-effort */ }

      for (const subDirName of topLevelNames) {
        const subDir = new Directory(cacheDir, subDirName);
        if (!subDir.exists) continue;
        let fileNames: string[] = [];
        try {
          const listed = await listDirectoryAsync(subDir.uri);
          fileNames = Array.isArray(listed) ? listed : [];
        } catch { continue; }
        for (const fileName of fileNames) {
          if (!fileName || fileName.endsWith('.tmp')) continue;
          const dotIdx = fileName.lastIndexOf('.');
          const songId = dotIdx >= 0 ? fileName.slice(0, dotIdx) : fileName;
          const file = new File(subDir, fileName);
          const bucket = filesBySongId.get(songId);
          if (bucket) bucket.push(file);
          else filesBySongId.set(songId, [file]);
        }
      }

      const validAlbumIds = new Set<string>();
      for (const song of songsById.values()) {
        validAlbumIds.add(song.albumId);

        const targetAlbumDir = new Directory(cacheDir, song.albumId);
        if (!targetAlbumDir.exists) {
          try { targetAlbumDir.create(); } catch { /* best-effort */ }
        }
        const targetFile = new File(targetAlbumDir, `${song.id}.${song.suffix}`);
        const sources = filesBySongId.get(song.id) ?? [];

        const alreadyInPlace = sources.find((f) => f.uri === targetFile.uri);
        if (alreadyInPlace) {
          noopCount++;
          for (const dup of sources) {
            if (dup.uri === targetFile.uri) continue;
            try { dup.delete(); dupesDeleted++; } catch { /* best-effort */ }
          }
          continue;
        }

        if (sources.length > 0) {
          const [first, ...rest] = sources;
          try {
            first.move(targetFile);
            movedCount++;
          } catch {
            /* best-effort move — reconciliation heals on next launch. */
          }
          for (const dup of rest) {
            try { dup.delete(); dupesDeleted++; } catch { /* best-effort */ }
          }
          continue;
        }

        missingCount++;
      }

      for (const name of topLevelNames) {
        if (validAlbumIds.has(name)) continue;
        const stale = new Directory(cacheDir, name);
        if (!stale.exists) continue;
        try { stale.delete(); staleDirsDeleted++; } catch { /* best-effort */ }
      }

      log(
        `Filesystem migration: ${noopCount} in-place, ${movedCount} moved, ` +
          `${dupesDeleted} duplicate(s) deleted, ${missingCount} missing, ` +
          `${staleDirsDeleted} stale dir(s) swept.`,
      );
    }
  } catch {
    /* best-effort filesystem migration — reconciliation heals. */
  }

  log(
    `Migrated ${itemRows.length} item(s), ${songsById.size} song(s), ` +
      `${edges.length} edge(s), ${queueRows.length} queue item(s) to per-row tables.`,
  );
  return true;
}

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
    name: 'Backfill downloaded track formats (deprecated in v2)',
    run: async (log) => {
      // In v1 this migration backfilled the `downloadedFormats` map on the
      // musicCacheStore blob. In the v2 re-architecture (see
      // `plans/music-downloads-v2.md`) format metadata lives inline on the
      // `cached_songs` per-row table, so there is no longer a separate map
      // to populate here. Task #14 owns the v1→v2 migration and carries any
      // format info over during that pass. Kept as a no-op so the migration
      // ID sequence is preserved for users whose `completedVersion` is < 10.
      log('Task deprecated in v2; format data now lives in cached_songs — skipping.');
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

  {
    id: 14,
    name: 'Move music cache to per-row SQLite tables and album-rooted directory layout',
    run: async (log) => {
      // musicCacheStore moved off the v1 monolithic
      // `substreamer-music-cache` blob + `{music-cache}/{itemId}/{trackId}.{ext}`
      // directory layout onto per-row SQLite tables
      // (`cached_items`, `cached_songs`, `cached_item_songs`,
      // `download_queue`) owned by
      // `src/store/persistence/musicCacheTables.ts`, with on-disk files
      // re-rooted under `{music-cache}/{albumId}/{songId}.{ext}`. v1 album
      // downloads already used this layout so they're a no-op migration;
      // playlist/__starred__ downloads move their files into the owning
      // album's directory (with dedup — duplicates across items collapse
      // to a single file).
      //
      // See `migrateMusicCacheFromBlob` for the full migration body.
      await migrateMusicCacheFromBlob(log);

      // The v1 blob deletion is COMMENTED OUT for now. Keeping the blob on
      // disk lets us re-test migration 14 end-to-end on the same device
      // and compare against the retained source data if anything surprises
      // us. Before beta, uncomment the line below so the blob is cleaned
      // up once the per-row tables are canonical.
      // TODO: uncomment for beta — removes the retained v1 blob.
      // await sqliteStorage.removeItem('substreamer-music-cache');
      log('v1 blob retained (will be removed before beta by uncommenting the delete).');
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
