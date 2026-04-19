/**
 * Resets all Zustand stores to their initial state and wipes
 * all persisted data from SQLite. Called on logout.
 *
 * Backup files on disk are intentionally preserved.
 */

import { sqliteStorage, clearAllStorage } from './sqliteStorage';
import { clearDetailTables } from './persistence/detailTables';
import { clearScrobbles } from './persistence/scrobbleTable';
import { clearMusicCacheTables } from './musicCacheStore';

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
import { ratingStore } from './ratingStore';
import { scanStatusStore } from './scanStatusStore';
import { scrobbleExclusionStore } from './scrobbleExclusionStore';
import { serverInfoStore } from './serverInfoStore';
import { shareSettingsStore } from './shareSettingsStore';
import { sharesStore } from './sharesStore';
import { songIndexStore } from './songIndexStore';
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
  ratingStore,
  scanStatusStore,
  scrobbleExclusionStore,
  serverInfoStore,
  shareSettingsStore,
  sharesStore,
  songIndexStore,
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

export function resetAllStores(): void {
  clearAllStorage();
  // Clear the per-row SQLite tables used by albumDetailStore + songIndexStore.
  // These live in a separate connection (`detailTables.ts`) from the generic
  // `storage` key-value table that `clearAllStorage()` wipes, so they would
  // otherwise persist stale rows across logout.
  clearDetailTables();
  // completedScrobbleStore also persists to a per-row table (`scrobble_events`)
  // in its own connection; truncate it here so logged-out state is clean.
  clearScrobbles();
  // musicCacheStore persists its four v2 tables (cached_songs, cached_items,
  // cached_item_songs, download_queue) in yet another connection; truncate
  // them here and drop the settings blob too.
  clearMusicCacheTables();
  sqliteStorage.removeItem('substreamer-music-cache-settings');
  for (const store of allStores) {
    (store.setState as (state: unknown, replace: boolean) => void)(
      store.getInitialState(),
      true,
    );
  }
}
