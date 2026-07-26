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
import { clearDetailTables } from './persistence/detailTables';
import { clearLibraryAlbumsAsync } from './persistence/libraryAlbumsTable';
import { clearPendingScrobbles } from './persistence/pendingScrobbleTable';
import { clearScrobbles } from './persistence/scrobbleTable';
import { clearMusicCacheTables } from './musicCacheStore';
import { teardownMusicCache } from '../services/musicCacheService';
import { clearImageCache, teardownImageCache } from '../services/imageCacheService';

// Persisted stores
import { albumDetailStore } from './albumDetailStore';
import { albumInfoStore } from './albumInfoStore';
import { albumLibraryStore } from './albumLibraryStore';
import { albumListsStore } from './albumListsStore';
import { artistDetailStore } from './artistDetailStore';
import { artistLibraryStore } from './artistLibraryStore';
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
import { mbidOverrideStore } from './mbidOverrideStore';
import { musicCacheStore } from './musicCacheStore';
import { offlineModeStore } from './offlineModeStore';
import { pendingScrobbleStore } from './pendingScrobbleStore';
import { playbackSettingsStore } from './playbackSettingsStore';
import { playlistDetailStore } from './playlistDetailStore';
import { playlistLibraryStore } from './playlistLibraryStore';
import { radioStore } from './radioStore';
import { ratingStore } from './ratingStore';
import { recentSearchStore } from './recentSearchStore';
import { scanStatusStore } from './scanStatusStore';
import { scrobbleExclusionStore } from './scrobbleExclusionStore';
import { serverInfoStore } from './serverInfoStore';
import { shareSettingsStore } from './shareSettingsStore';
import { sharesStore } from './sharesStore';
import { songIndexStore } from './songIndexStore';
import { songLibraryStore } from './songLibraryStore';
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
import { migrationStore } from './migrationStore';
import { moreOptionsStore } from './moreOptionsStore';
import { playbackToastStore } from './playbackToastStore';
import { playerStore } from './playerStore';
import { processingOverlayStore } from './processingOverlayStore';
import { searchStore } from './searchStore';
import { setRatingStore } from './setRatingStore';

const allStores = [
  // Persisted
  albumDetailStore,
  albumInfoStore,
  albumLibraryStore,
  albumListsStore,
  artistDetailStore,
  artistLibraryStore,
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
  mbidOverrideStore,
  musicCacheStore,
  offlineModeStore,
  pendingScrobbleStore,
  playbackSettingsStore,
  playlistDetailStore,
  playlistLibraryStore,
  radioStore,
  ratingStore,
  recentSearchStore,
  scanStatusStore,
  scrobbleExclusionStore,
  serverInfoStore,
  shareSettingsStore,
  sharesStore,
  songIndexStore,
  songLibraryStore,
  sslCertStore,
  storageLimitStore,
  syncStatusStore,
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
  processingOverlayStore,
  searchStore,
  setRatingStore,
];

export async function resetAllStores(): Promise<void> {
  // (Native SSL trust + proxy teardown happens in the logout handler, awaited
  // before this runs — see AccountCard.handleLogout.)

  // Unregister cache-service AppState listeners before clearing state so a
  // background→foreground transition while logged out can't fire stalled-
  // download recovery against a reset store. The next login re-arms them.
  teardownMusicCache();
  teardownImageCache();
  await clearKvStorage();
  // Clear the per-row SQLite tables used by albumDetailStore + songIndexStore.
  // These live in a separate connection (`detailTables.ts`) from the generic
  // `storage` key-value table that `clearKvStorage()` wipes, so they would
  // otherwise persist stale rows across logout.
  await clearDetailTables();
  // albumLibraryStore is row-based now (`library_albums`), in its own table;
  // wipe it here so the browse list doesn't survive logout.
  await clearLibraryAlbumsAsync();
  // completedScrobbleStore also persists to a per-row table (`scrobble_events`)
  // in its own connection; truncate it here so logged-out state is clean.
  await clearScrobbles();
  // pendingScrobbleStore persists to `pending_scrobble_events`; truncate
  // here so the offline transmit queue doesn't survive logout.
  await clearPendingScrobbles();
  // musicCacheStore persists its four v2 tables (cached_songs, cached_items,
  // cached_item_songs, download_queue) in yet another connection; truncate
  // them here and drop the settings blob too.
  await clearMusicCacheTables();
  kvStorage.removeItem('substreamer-music-cache-settings');
  // imageCacheStore persists the `cached_images` table; the service-owned
  // wipe also drops in-memory queue/uriCache state and the on-disk dir.
  // Pass `reinit: false` so the AppState listener teardownImageCache just
  // removed isn't re-armed — the next initImageCache comes from the auth
  // flow on re-login.
  void clearImageCache({ reinit: false });
  kvStorage.removeItem('substreamer-image-cache-settings');
  for (const store of allStores) {
    (store.setState as (state: unknown, replace: boolean) => void)(
      store.getInitialState(),
      true,
    );
  }
  // Drop debounced library-store writes AFTER the reset loop: each
  // `setState(initial, true)` above re-arms a debounce timer via the persist
  // middleware. resetAllStores is fully synchronous, so no timer can fire
  // mid-function — dropping last cancels both any pre-existing pending writes
  // and the ones the resets just armed, so nothing lands after clearKvStorage.
  dropAllPendingPersistWrites();
}
