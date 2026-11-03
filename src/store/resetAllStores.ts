/**
 * Resets all Zustand stores to their initial state and wipes
 * all persisted data from SQLite. Called on logout.
 *
 * Backup files on disk are intentionally preserved.
 */

// Synchronous adapter: the hand-rolled settings-blob keys are removed
// synchronously alongside the rest of the logout teardown.
import {
  kvStorageSync as kvStorage,
  clearKvStorage,
  dropAllPendingPersistWrites,
} from './persistence';
import { getDb } from './persistence/db';
import { awaitDbWritesIdle } from '../db/client';
import { KEPT_TABLES, resetNormalizedSchema } from '../db/createNormalizedTables';
import { dropIdMap } from '../services/navidromeReid/reidMap';
import { clearPendingScrobbles } from './persistence/pendingScrobbleTable';
import { clearScrobbles } from './persistence/scrobbleTable';
import { clearMusicCacheTables } from './musicCacheStore';
import { clearMusicCache, teardownMusicCache } from '../services/musicCacheService';
import { clearImageCache, teardownImageCache } from '../services/imageCacheService';
import { resetFavoritesSyncFlags } from '../services/favoritesSyncService';
import { releaseLibrarySyncQueue } from '../services/normalizedLibrarySync';

// Persisted stores
import { albumInfoStore } from './albumInfoStore';
import { albumListsStore } from './albumListsStore';
import { authStore } from './authStore';
import { autoOfflineStore } from './autoOfflineStore';
import { backupStore } from './backupStore';
import { batteryOptimizationStore } from './batteryOptimizationStore';
import { bookmarksStore } from './bookmarksStore';
import { completedScrobbleStore } from './completedScrobbleStore';
import { favoritesStore } from './favoritesStore';
import { genreStore } from './genreStore';
import { imageCacheStore } from './imageCacheStore';
import { layoutPreferencesStore } from './layoutPreferencesStore';
import { lyricsStore } from './lyricsStore';
import { mbidOverrideStore } from './mbidOverrideStore';
import { musicCacheStore } from './musicCacheStore';
import { offlineModeStore } from './offlineModeStore';
import { pendingScrobbleStore } from './pendingScrobbleStore';
import { playbackSettingsStore } from './playbackSettingsStore';
import { ratingStore } from './ratingStore';
import { recentSearchStore } from './recentSearchStore';
import { scanStatusStore } from './scanStatusStore';
import { scrobbleExclusionStore } from './scrobbleExclusionStore';
import { serverInfoStore } from './serverInfoStore';
import { shareSettingsStore } from './shareSettingsStore';
import { sharesStore } from './sharesStore';
import { sslCertStore } from './sslCertStore';
import { localeStore } from './localeStore';
import { storageLimitStore } from './storageLimitStore';
import { syncStatusStore } from './syncStatusStore';

// Non-persisted stores
import { addToPlaylistStore } from './addToPlaylistStore';
import { certPromptStore } from './certPromptStore';
import { connectivityStore } from './connectivityStore';
import { createShareStore } from './createShareStore';
import { devOptionsStore } from './devOptionsStore';
import { editShareStore } from './editShareStore';
import { filterBarStore } from './filterBarStore';
import { mbidSearchStore } from './mbidSearchStore';
import { migrationGateStore } from './migrationGateStore';
import { migrationStore } from './migrationStore';
import { moreOptionsStore } from './moreOptionsStore';
import { playbackToastStore } from './playbackToastStore';
import { playerStore } from './playerStore';
import { processingOverlayStore } from './processingOverlayStore';
import { searchStore } from './searchStore';
import { setRatingStore } from './setRatingStore';

const allStores = [
  // Persisted
  albumInfoStore,
  albumListsStore,
  authStore,
  autoOfflineStore,
  backupStore,
  batteryOptimizationStore,
  bookmarksStore,
  completedScrobbleStore,
  favoritesStore,
  genreStore,
  imageCacheStore,
  layoutPreferencesStore,
  localeStore,
  // Session cache over the `lyrics` table, which logout drops with the rest of the
  // model. Reset here too: the keys are server-scoped song ids, so a map surviving a
  // server switch can show another server's words against a colliding id.
  lyricsStore,
  mbidOverrideStore,
  musicCacheStore,
  offlineModeStore,
  pendingScrobbleStore,
  playbackSettingsStore,
  ratingStore,
  recentSearchStore,
  scanStatusStore,
  scrobbleExclusionStore,
  serverInfoStore,
  shareSettingsStore,
  sharesStore,
  sslCertStore,
  storageLimitStore,
  syncStatusStore,
  // A deferral notice must not carry into the next account's Settings.
  migrationGateStore,
  migrationStore,
  // Non-persisted
  addToPlaylistStore,
  certPromptStore,
  connectivityStore,
  createShareStore,
  devOptionsStore,
  editShareStore,
  filterBarStore,
  mbidSearchStore,
  moreOptionsStore,
  playbackToastStore,
  playerStore,
  // processingOverlayStore is deliberately NOT reset here: logout itself runs behind
  // that overlay, so clearing it mid-teardown would blank the only progress the user
  // can see. The caller owns showing and hiding it.
  searchStore,
  setRatingStore,
];

/**
 * Truncate the legacy blob tables on logout. They are not in `schema.ts`, so
 * `resetNormalizedSchema` does not touch them, and `clearKvStorage()` wipes the blob→
 * normalized ETL's one-shot flag — so rows left here get re-imported into the NEXT
 * server's library on the following launch. One serialized slot per table with its own
 * try/catch: a table missing (fresh install, or a lineage that never had `library_albums`)
 * must not abort the others.
 */
async function clearLegacyBlobTables(): Promise<void> {
  const db = getDb();
  if (db === null) return;
  for (const table of ['album_details', 'song_index', 'library_albums']) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.runAsync(`DELETE FROM ${table};`);
    } catch {
      /* table absent on this install — nothing to clear */
    }
  }
}

/**
 * Empty every KEPT table, derived from the list itself.
 *
 * `KEPT_TABLES` means "survives a full resync", NOT "survives logout" — logging out is
 * how you switch user or server, so none of this belongs to the next account. Only the
 * on-disk backup files outlive it, by design: they carry data across accounts and servers
 * with the user choosing what to restore.
 *
 * Derived rather than a hand-written list of per-table calls, because that list is how
 * `image_download_queue` was missed: it was added to `KEPT_TABLES` and never to logout,
 * so its rows were revived to `queued` on every later launch and refetched against
 * whichever server signed in next. A table added tomorrow is swept by this automatically.
 *
 * Deferred FKs because the sweep spans parents and their children in one batch.
 */
async function clearKeptTables(): Promise<void> {
  const db = getDb();
  if (db === null) return;
  const present = new Set(
    (await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )).map((r) => r.name),
  );
  const commands: Array<[string, unknown[]]> = [['PRAGMA defer_foreign_keys = ON', []]];
  for (const table of KEPT_TABLES) {
    // `storage` is the KV store, cleared by `clearKvStorage` once the data is gone.
    if (table !== 'storage' && present.has(table)) commands.push([`DELETE FROM "${table}"`, []]);
  }
  try {
    await db.runAtomicBatchAsync(commands as never);
  } catch (e) {
    console.warn('[resetAllStores] kept-table sweep failed:', e);
  }
}

/**
 * Wipe everything the previous server's session left in the install: the legacy blobs,
 * the normalized model and id map, scrobbles, downloads (rows and files), the image cache
 * and every KEPT table except `storage`. Never rejects; each step is independent, so one
 * failing must not leave the rest in place. Logout runs it before clearing credentials,
 * and login runs it when it finds leftovers.
 */
export async function wipeServerData(): Promise<void> {
  const step = async (label: string, run: () => unknown): Promise<void> => {
    try {
      await run();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[resetAllStores] ${label} failed:`, e);
    }
  };
  await step('legacy blob clear', clearLegacyBlobTables);
  const normDb = getDb();
  if (normDb) {
    // `resetNormalizedSchema` is `withTransactionSync` — its `BEGIN` runs on the JS
    // thread and hard-fails if a batch's savepoint is open on the pool. Wait for the
    // pool to be write-idle immediately before it, with no await in between.
    await awaitDbWritesIdle();
    try {
      resetNormalizedSchema(normDb);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[resetAllStores] normalized schema reset failed:', e);
    }
    // The Navidrome re-key's id map is created imperatively, so it is not in the generated
    // DDL and `resetNormalizedSchema` cannot know about it. Left behind, a mid-pass logout
    // would leak one server's id pairs into the next server's run.
    await step('id-map drop', () => dropIdMap(normDb));
  }
  await step('scrobble clear', clearScrobbles);
  await step('pending scrobble clear', clearPendingScrobbles);
  await step('music cache tables clear', clearMusicCacheTables);
  // The download files, off the JS thread. Can throw when the cache directory cannot be
  // created.
  await step('music cache files clear', clearMusicCache);
  await step('image cache clear', () => clearImageCache());
  await step('kept tables clear', clearKeptTables);
}

export async function resetAllStores(): Promise<void> {
  // (Native SSL trust + proxy teardown happens before this runs — see
  // logoutService.finishLogout.)

  // 0. Stop the library sync without waiting for it: a fetch can hang (OkHttp has no
  // timeouts). The bump makes every later write of a running sync a no-op, and the
  // release lets the next account's first sync start instead of queueing behind it.
  syncStatusStore.getState().bumpGeneration();
  releaseLibrarySyncQueue();
  // Unregister the cache services' AppState listeners so a foreground transition during
  // the teardown cannot fire recovery against a half-reset store. Clearing the caches
  // below re-initialises them, which re-arms the listeners against the empty caches.
  teardownMusicCache();
  teardownImageCache();
  // Module-scope flags in favoritesSyncService: zustand's `getInitialState()` returns a
  // memoised object and never re-runs the store initializer, so the reset loop below
  // cannot clear them.
  resetFavoritesSyncFlags();

  // 1. Reset the sync state first and get it on disk. A logout killed later is finished
  // at the next launch, and must never find a cursor over a wiped library.
  syncStatusStore.getState().resetLibrarySync();
  syncStatusStore.getState().resetSongSync();
  await awaitDbWritesIdle();

  // 2. The data. An interrupted logout is finished at the next launch (logoutPending).
  await wipeServerData();

  // 3. Last, the KV store and the in-memory state, auth included.
  await clearKvStorage();
  kvStorage.removeItem('substreamer-music-cache-settings');
  kvStorage.removeItem('substreamer-image-cache-settings');
  // `generation` is in-memory only and may already be above its initial 0. It must only
  // ever increase, or a run that captured the reset value would read as current again.
  const generation = syncStatusStore.getState().generation;
  for (const store of allStores) {
    (store.setState as (state: unknown, replace: boolean) => void)(
      store.getInitialState(),
      true,
    );
  }
  syncStatusStore.setState({ generation: generation + 1 });
  // Drop debounced library-store writes AFTER the reset loop: each
  // `setState(initial, true)` above re-arms a debounce timer via the persist
  // middleware. resetAllStores is fully synchronous, so no timer can fire
  // mid-function — dropping last cancels both any pre-existing pending writes
  // and the ones the resets just armed, so nothing lands after clearKvStorage.
  dropAllPendingPersistWrites();

  // The backstop: a download, scrobble or image write that landed during the teardown.
  await clearKeptTables();
}
