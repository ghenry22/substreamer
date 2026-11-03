jest.mock('../persistence/kvStorage', () => {
  const mock = require('../persistence/__mocks__/kvStorage');
  // resetAllStores removes the hand-rolled settings-blob keys via the *sync*
  // adapter. Share one removeItem spy across both names so existing
  // `kvStorage.removeItem` assertions observe the production `kvStorageSync`
  // calls.
  const removeItem = jest.fn();
  return {
    ...mock,
    kvStorage: { ...mock.kvStorage, removeItem },
    kvStorageSync: { ...mock.kvStorageSync, removeItem },
    clearKvStorage: jest.fn(),
  };
});
// Partial: `openDbConnection` must stay real (persistence/db opens the substitute with it).
// Only `awaitDbWritesIdle` is wrapped, so the guard in front of the DROP loop is
// assertable — it is one easily-deleted line standing between logout and a
// nested-BEGIN failure that skips the rest of the teardown.
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return { ...actual, awaitDbWritesIdle: jest.fn(() => actual.awaitDbWritesIdle()) };
});
jest.mock('../../services/subsonicService');
jest.mock('../../services/playerService', () => ({}));
jest.mock('../../services/moreOptionsService', () => ({}));
jest.mock('../../services/scrobbleService', () => ({}));
jest.mock('../../services/imageCacheService', () => ({
  ensureCached: jest.fn().mockResolvedValue(undefined),
  prefetchCoverArt: jest.fn(),
  teardownImageCache: jest.fn(),
  clearImageCache: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../services/musicCacheService', () => ({
  teardownMusicCache: jest.fn(),
  clearMusicCache: jest.fn().mockResolvedValue(0),
}));
jest.mock('../persistence/scrobbleTable', () => ({
  clearScrobbles: jest.fn(),
  insertScrobble: jest.fn(),
  replaceAllScrobbles: jest.fn(),
}));
jest.mock('../persistence/pendingScrobbleTable', () => ({
  clearPendingScrobbles: jest.fn(),
  insertPendingScrobble: jest.fn(),
  deletePendingScrobble: jest.fn(),
  replaceAllPendingScrobbles: jest.fn(),
}));
jest.mock('../persistence/musicCacheTables', () => ({
  clearAllMusicCacheRows: jest.fn(),
  hydrateCachedSongs: jest.fn(() => ({})),
  hydrateCachedItems: jest.fn(() => ({})),
  deleteCachedItem: jest.fn(),
  deleteCachedSong: jest.fn(),
  insertDownloadQueueItem: jest.fn(),
  markDownloadComplete: jest.fn(),
  removeCachedItemSong: jest.fn(),
  removeDownloadQueueItem: jest.fn(),
  reorderCachedItemSongs: jest.fn(),
  reorderDownloadQueue: jest.fn(),
  updateDownloadQueueItem: jest.fn(),
  upsertCachedItem: jest.fn(),
  upsertCachedSong: jest.fn(),
}));

import type { AlbumID3, Child } from 'subsonic-api';

import { kvStorage, clearKvStorage } from '../persistence';
import { getDb, __setDbForTests } from '../persistence/db';
import { awaitDbWritesIdle } from '../../db/client';
import { KEPT_TABLES, ensureNormalizedSchema } from '../../db/createNormalizedTables';
import {
  markStarredSongs,
  replaceFavoriteAlbums,
  replaceFavoriteArtists,
  replaceFavoriteSongs,
} from '../../db/repository/favorites';
import { upsertSongs } from '../../db/repository/songs';
import { favoritesStore } from '../favoritesStore';
import { clearPendingScrobbles } from '../persistence/pendingScrobbleTable';
import { clearScrobbles } from '../persistence/scrobbleTable';
import { clearAllMusicCacheRows } from '../persistence/musicCacheTables';
import { authStore } from '../authStore';
import { completedScrobbleStore } from '../completedScrobbleStore';
import { mbidOverrideStore } from '../mbidOverrideStore';
import { scrobbleExclusionStore } from '../scrobbleExclusionStore';
import { playerStore } from '../playerStore';
import { processingOverlayStore } from '../processingOverlayStore';
import { searchStore } from '../searchStore';
import { resetAllStores } from '../resetAllStores';
import { syncStatusStore } from '../syncStatusStore';
import { migrationGateStore } from '../migrationGateStore';
import { clearImageCache } from '../../services/imageCacheService';
import { clearMusicCache } from '../../services/musicCacheService';

beforeEach(() => {
  (clearKvStorage as jest.Mock).mockClear();
  (clearScrobbles as jest.Mock).mockClear();
  (clearPendingScrobbles as jest.Mock).mockClear();
  (clearAllMusicCacheRows as jest.Mock).mockClear();
  (kvStorage.removeItem as jest.Mock).mockClear();
});

describe('resetAllStores', () => {
  it('clears SQLite storage', async () => {
    await resetAllStores();
    expect(clearKvStorage).toHaveBeenCalledTimes(1);
  });

  // `clearKvStorage()` wipes the blob→normalized ETL's one-shot flag, so any row left
  // in these tables gets re-imported into the NEXT server's library on the following
  // launch. `resetNormalizedSchema` doesn't cover them — they aren't in schema.ts.
  it('truncates the legacy blob tables (album_details + song_index + library_albums)', async () => {
    const handle = getDb()!;
    const runAsync = jest.spyOn(handle, 'runAsync');
    await resetAllStores();
    expect(runAsync.mock.calls.map((c) => c[0] as string)).toEqual(
      expect.arrayContaining([
        'DELETE FROM album_details;',
        'DELETE FROM song_index;',
        'DELETE FROM library_albums;',
      ]),
    );
    runAsync.mockRestore();
  });

  it('skips the legacy-table clear when SQLite is unavailable', async () => {
    const handle = getDb();
    __setDbForTests(null);
    await expect(resetAllStores()).resolves.toBeUndefined();
    __setDbForTests(handle);
  });

  it('truncates the scrobble_events table', async () => {
    await resetAllStores();
    expect(clearScrobbles).toHaveBeenCalledTimes(1);
  });

  it('truncates the pending_scrobble_events table', async () => {
    await resetAllStores();
    expect(clearPendingScrobbles).toHaveBeenCalledTimes(1);
  });

  it('truncates the music cache tables (cached_songs + cached_items + cached_item_songs + download_queue)', async () => {
    await resetAllStores();
    expect(clearAllMusicCacheRows).toHaveBeenCalledTimes(1);
  });

  it('removes the music cache settings blob', async () => {
    await resetAllStores();
    expect(kvStorage.removeItem).toHaveBeenCalledWith('substreamer-music-cache-settings');
  });

  it('resets persisted stores to initial state', async () => {
    // Populate stores with non-default data
    authStore.getState().setSession('https://example.com', 'user', 'pass', '1.16');
    completedScrobbleStore.setState({
      recentScrobbles: [{ id: 's1' }] as any,
    });
    mbidOverrideStore.setState({
      overrides: { 'art-1': { mbid: 'x', name: 'A' } } as any,
    });
    scrobbleExclusionStore.setState({
      excludedAlbums: { 'alb-1': { id: 'alb-1', name: 'X' } },
    });

    await resetAllStores();

    expect(authStore.getState().isLoggedIn).toBe(false);
    expect(authStore.getState().serverUrl).toBeNull();
    expect(completedScrobbleStore.getState().recentScrobbles).toEqual([]);
    expect(mbidOverrideStore.getState().overrides).toEqual({});
    expect(scrobbleExclusionStore.getState().excludedAlbums).toEqual({});
  });

  it('resets non-persisted stores to initial state', async () => {
    playerStore.setState({ currentTrack: { id: 'track-1' } as any });
    searchStore.setState({ query: 'hello' });

    await resetAllStores();

    expect(playerStore.getState().currentTrack).toBeNull();
    expect(searchStore.getState().query).toBe('');
  });

  it('wipes the favourites — both the marks and the remainder — so server B starts clean', async () => {
    // Favourites are server-scoped and live in two places: `starred` marks on the
    // library rows and the `favorite_*` remainder tables. Logging out of server A and
    // into server B must leave neither behind.
    const handle = getDb()!;
    ensureNormalizedSchema(handle);
    await upsertSongs(handle, [{ id: 's1', title: 'A', isDir: false } as Child]);
    await markStarredSongs(handle, [{ id: 's1', starredAt: 500 }]);
    await replaceFavoriteSongs(handle, [{ id: 'rem1', title: 'B', isDir: false } as Child]);
    await replaceFavoriteAlbums(handle, [{ id: 'ral1', name: 'C' } as AlbumID3]);
    await replaceFavoriteArtists(handle, [{ id: 'rar1', name: 'D', albumCount: 0 }]);
    favoritesStore.setState({ songIds: new Set(['s1', 'rem1']), version: 3 });

    await resetAllStores();

    for (const table of ['songs', 'favorite_songs', 'favorite_albums', 'favorite_artists']) {
      expect(
        handle.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n,
      ).toBe(0);
    }
    expect(favoritesStore.getState().songIds.size).toBe(0);
  });

  it('waits for the pool to be write-idle BEFORE the DROP loop', async () => {
    // `resetNormalizedSchema`'s `BEGIN` runs on the JS thread and bypasses the pool, so
    // it hard-fails on Android if a pool transaction is still open. Ordering is the
    // whole point of the guard — asserted here because the substitute runs everything
    // synchronously and cannot reproduce the overlap itself.
    const handle = getDb()!;
    const withTransactionSync = jest.spyOn(handle, 'withTransactionSync');

    await resetAllStores();

    // The LAST idle wait before the reset, not the first: logout also waits earlier, after
    // resetting the sync state, and an await between that one and the BEGIN would let a
    // batch in.
    const begin = withTransactionSync.mock.invocationCallOrder[0];
    const idleBefore = (awaitDbWritesIdle as jest.Mock).mock.invocationCallOrder
      .filter((order) => order < begin);
    expect(idleBefore.length).toBeGreaterThan(0);
    const lastIdle = Math.max(...idleBefore);
    expect((clearScrobbles as jest.Mock).mock.invocationCallOrder[0]).toBeGreaterThan(begin);
    expect(lastIdle).toBeLessThan(begin);
    withTransactionSync.mockRestore();
  });

  it('resets the sync state first and clears the KV store only after every data wipe', async () => {
    // A kill part way through logout must leave the user logged in over a sync that
    // starts from zero, never logged out over the previous account's data.
    const resetLibrarySync = jest.spyOn(syncStatusStore.getState(), 'resetLibrarySync');
    syncStatusStore.setState({ resetLibrarySync } as never);

    await resetAllStores();

    const kv = (clearKvStorage as jest.Mock).mock.invocationCallOrder[0];
    const first = resetLibrarySync.mock.invocationCallOrder[0];
    for (const wipe of [clearScrobbles, clearAllMusicCacheRows, clearMusicCache, clearImageCache]) {
      const order = (wipe as jest.Mock).mock.invocationCallOrder.at(-1)!;
      expect(order).toBeGreaterThan(first);
      expect(order).toBeLessThan(kv);
    }
    resetLibrarySync.mockRestore();
  });

  it('clears a pending-update notice so it does not reach the next account', async () => {
    migrationGateStore.getState().setDeferred(true);

    await resetAllStores();

    expect(migrationGateStore.getState().deferred).toBe(false);
  });

  it('only ever raises the sync generation', async () => {
    // In-memory only and can be above 0 already. A reset back to 0 would let a run that
    // captured 0 earlier read as current again.
    syncStatusStore.setState({ generation: 7 });

    await resetAllStores();

    expect(syncStatusStore.getState().generation).toBeGreaterThan(7);
  });

  it('carries on when clearing the download files throws', async () => {
    (clearMusicCache as jest.Mock).mockRejectedValueOnce(new TypeError('no cache dir'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    authStore.setState({ isLoggedIn: true });

    await expect(resetAllStores()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      '[resetAllStores] music cache files clear failed:',
      expect.any(TypeError),
    );
    expect(clearImageCache).toHaveBeenCalled();
    expect(clearKvStorage).toHaveBeenCalledTimes(1);
    expect(authStore.getState().isLoggedIn).toBe(false);
    warn.mockRestore();
  });

  it('carries on when the normalized-schema reset throws', async () => {
    // `resetNormalizedSchema` is a `withTransactionSync` DROP-TABLE loop; its `BEGIN`
    // hard-fails if a batch's savepoint is still open on the connection. Unguarded, that
    // threw straight out of here and everything after it — scrobbles, the music cache,
    // the image cache, the store resets — silently never ran, so the next login saw the
    // previous server's data.
    const handle = getDb()!;
    const withTransactionSync = jest
      .spyOn(handle, 'withTransactionSync')
      .mockImplementation(() => {
        throw new Error('cannot start a transaction within a transaction');
      });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    playerStore.setState({ currentTrack: { id: 'track-1' } as any });

    await expect(resetAllStores()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      '[resetAllStores] normalized schema reset failed:',
      expect.objectContaining({ message: 'cannot start a transaction within a transaction' }),
    );
    expect(clearScrobbles).toHaveBeenCalledTimes(1);
    expect(clearAllMusicCacheRows).toHaveBeenCalledTimes(1);
    expect(playerStore.getState().currentTrack).toBeNull();
    withTransactionSync.mockRestore();
    warn.mockRestore();
  });

  it('leaves the processing overlay alone — logout runs behind it', async () => {
    // Logout shows the overlay, then calls this. Resetting it here would blank the
    // only progress the user can see, half way through a multi-second teardown.
    processingOverlayStore.getState().show('Logging out…');

    await resetAllStores();

    expect(processingOverlayStore.getState().status).toBe('processing');
    expect(processingOverlayStore.getState().label).toBe('Logging out…');
    processingOverlayStore.getState().hide();
  });
});

describe('the KEPT-table sweep', () => {
  // KEPT_TABLES means "survives a full resync", NOT "survives logout" — logging out is
  // how you switch user or server. The sweep is derived from the list because the
  // hand-written per-table teardown is exactly how image_download_queue was missed: its
  // rows were revived to `queued` every launch and refetched against the next server.
  it('empties a kept table that no per-table teardown call covers', async () => {
    const handle = getDb()!;
    await handle.runAsync(
      'INSERT INTO image_download_queue (cover_art_id, scope, status, attempts, added_at, cycle_id)'
      + " VALUES ('al-retired_69eaaaa1', 'refresh-downloads', 'queued', 0, 0, 'cyc-old');",
    );
    const before = await handle.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM image_download_queue',
    );
    expect(before?.n).toBe(1);

    await resetAllStores();

    const after = await handle.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM image_download_queue',
    );
    expect(after?.n).toBe(0);
  });

  it('leaves no rows in ANY kept table (storage is the KV store, cleared by clearKvStorage)', async () => {
    const handle = getDb()!;
    await handle.runAsync(
      'INSERT INTO image_download_queue (cover_art_id, scope, status, attempts, added_at, cycle_id)'
      + " VALUES ('al-x_1', 'refresh-all', 'queued', 0, 0, 'cyc-1');",
    );

    await resetAllStores();

    expect(clearKvStorage).toHaveBeenCalledTimes(1);
    for (const table of KEPT_TABLES.filter((t) => t !== 'storage')) {
      // eslint-disable-next-line no-await-in-loop
      const row = await handle.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM "${table}"`,
      ).catch(() => ({ n: 0 }));
      expect({ table, n: row?.n ?? 0 }).toEqual({ table, n: 0 });
    }
  });
});

