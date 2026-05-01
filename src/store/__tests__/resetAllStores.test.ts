jest.mock('../persistence/kvStorage', () => {
  const mock = require('../persistence/__mocks__/kvStorage');
  return {
    ...mock,
    kvStorage: {
      ...mock.kvStorage,
      removeItem: jest.fn(),
    },
    clearKvStorage: jest.fn(),
  };
});
jest.mock('../../services/subsonicService');
jest.mock('../../services/playerService', () => ({}));
jest.mock('../../services/moreOptionsService', () => ({}));
jest.mock('../../services/scrobbleService', () => ({}));
jest.mock('../../services/imageCacheService', () => ({
  cacheAllSizes: jest.fn().mockResolvedValue(undefined),
  cacheEntityCoverArt: jest.fn(),
  teardownImageCache: jest.fn(),
  wipeImageCacheForLogout: jest.fn(),
}));
jest.mock('../../services/musicCacheService', () => ({
  teardownMusicCache: jest.fn(),
}));
jest.mock('../persistence/detailTables', () => ({
  clearDetailTables: jest.fn(),
  hydrateAlbumDetails: jest.fn(() => ({})),
  upsertAlbumDetail: jest.fn(),
  deleteAlbumDetail: jest.fn(),
  upsertSongsForAlbum: jest.fn(),
  deleteSongsForAlbums: jest.fn(),
  countAlbumDetails: jest.fn(() => 0),
  countSongIndex: jest.fn(() => 0),
}));
jest.mock('../persistence/scrobbleTable', () => ({
  clearScrobbles: jest.fn(),
  insertScrobble: jest.fn(),
  replaceAllScrobbles: jest.fn(),
  hydrateScrobbles: jest.fn(() => []),
}));
jest.mock('../persistence/pendingScrobbleTable', () => ({
  clearPendingScrobbles: jest.fn(),
  insertPendingScrobble: jest.fn(),
  deletePendingScrobble: jest.fn(),
  replaceAllPendingScrobbles: jest.fn(),
  hydratePendingScrobbles: jest.fn(() => []),
  countPendingScrobbles: jest.fn(() => 0),
}));
jest.mock('../persistence/musicCacheTables', () => ({
  clearAllMusicCacheRows: jest.fn(),
  hydrateCachedSongs: jest.fn(() => ({})),
  hydrateCachedItems: jest.fn(() => ({})),
  hydrateDownloadQueue: jest.fn(() => []),
  countSongRefs: jest.fn(() => 0),
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

import { kvStorage, clearKvStorage } from '../persistence';
import { clearDetailTables } from '../persistence/detailTables';
import { clearPendingScrobbles } from '../persistence/pendingScrobbleTable';
import { clearScrobbles } from '../persistence/scrobbleTable';
import { clearAllMusicCacheRows } from '../persistence/musicCacheTables';
import { authStore } from '../authStore';
import { albumLibraryStore } from '../albumLibraryStore';
import { completedScrobbleStore } from '../completedScrobbleStore';
import { mbidOverrideStore } from '../mbidOverrideStore';
import { scrobbleExclusionStore } from '../scrobbleExclusionStore';
import { playerStore } from '../playerStore';
import { searchStore } from '../searchStore';
import { resetAllStores } from '../resetAllStores';

beforeEach(() => {
  (clearKvStorage as jest.Mock).mockClear();
  (clearDetailTables as jest.Mock).mockClear();
  (clearScrobbles as jest.Mock).mockClear();
  (clearPendingScrobbles as jest.Mock).mockClear();
  (clearAllMusicCacheRows as jest.Mock).mockClear();
  (kvStorage.removeItem as jest.Mock).mockClear();
});

describe('resetAllStores', () => {
  it('clears SQLite storage', () => {
    resetAllStores();
    expect(clearKvStorage).toHaveBeenCalledTimes(1);
  });

  it('truncates the per-row detail tables (album_details + song_index)', () => {
    resetAllStores();
    expect(clearDetailTables).toHaveBeenCalledTimes(1);
  });

  it('truncates the scrobble_events table', () => {
    resetAllStores();
    expect(clearScrobbles).toHaveBeenCalledTimes(1);
  });

  it('truncates the pending_scrobble_events table', () => {
    resetAllStores();
    expect(clearPendingScrobbles).toHaveBeenCalledTimes(1);
  });

  it('truncates the music cache tables (cached_songs + cached_items + cached_item_songs + download_queue)', () => {
    resetAllStores();
    expect(clearAllMusicCacheRows).toHaveBeenCalledTimes(1);
  });

  it('removes the music cache settings blob', () => {
    resetAllStores();
    expect(kvStorage.removeItem).toHaveBeenCalledWith('substreamer-music-cache-settings');
  });

  it('resets persisted stores to initial state', () => {
    // Populate stores with non-default data
    authStore.getState().setSession('https://example.com', 'user', 'pass', '1.16');
    albumLibraryStore.setState({ albums: [{ id: 'a1' }] as any });
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1' }] as any,
    });
    mbidOverrideStore.setState({
      overrides: { 'art-1': { mbid: 'x', name: 'A' } } as any,
    });
    scrobbleExclusionStore.setState({
      excludedAlbums: { 'alb-1': { id: 'alb-1', name: 'X' } },
    });

    resetAllStores();

    expect(authStore.getState().isLoggedIn).toBe(false);
    expect(authStore.getState().serverUrl).toBeNull();
    expect(albumLibraryStore.getState().albums).toEqual([]);
    expect(completedScrobbleStore.getState().completedScrobbles).toEqual([]);
    expect(mbidOverrideStore.getState().overrides).toEqual({});
    expect(scrobbleExclusionStore.getState().excludedAlbums).toEqual({});
  });

  it('resets non-persisted stores to initial state', () => {
    playerStore.setState({ currentTrack: { id: 'track-1' } as any });
    searchStore.setState({ query: 'hello' });

    resetAllStores();

    expect(playerStore.getState().currentTrack).toBeNull();
    expect(searchStore.getState().query).toBe('');
  });
});
