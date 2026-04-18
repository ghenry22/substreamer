jest.mock('../sqliteStorage', () => {
  const mock = require('../__mocks__/sqliteStorage');
  return {
    ...mock,
    clearAllStorage: jest.fn(),
  };
});
jest.mock('../../services/subsonicService');
jest.mock('../../services/playerService', () => ({}));
jest.mock('../../services/moreOptionsService', () => ({}));
jest.mock('../../services/scrobbleService', () => ({}));
jest.mock('../../services/imageCacheService', () => ({
  cacheAllSizes: jest.fn().mockResolvedValue(undefined),
  cacheEntityCoverArt: jest.fn(),
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

import { clearAllStorage } from '../sqliteStorage';
import { clearDetailTables } from '../persistence/detailTables';
import { clearScrobbles } from '../persistence/scrobbleTable';
import { authStore } from '../authStore';
import { albumLibraryStore } from '../albumLibraryStore';
import { completedScrobbleStore } from '../completedScrobbleStore';
import { mbidOverrideStore } from '../mbidOverrideStore';
import { scrobbleExclusionStore } from '../scrobbleExclusionStore';
import { playerStore } from '../playerStore';
import { searchStore } from '../searchStore';
import { resetAllStores } from '../resetAllStores';

beforeEach(() => {
  (clearAllStorage as jest.Mock).mockClear();
  (clearDetailTables as jest.Mock).mockClear();
  (clearScrobbles as jest.Mock).mockClear();
});

describe('resetAllStores', () => {
  it('clears SQLite storage', () => {
    resetAllStores();
    expect(clearAllStorage).toHaveBeenCalledTimes(1);
  });

  it('truncates the per-row detail tables (album_details + song_index)', () => {
    resetAllStores();
    expect(clearDetailTables).toHaveBeenCalledTimes(1);
  });

  it('truncates the scrobble_events table', () => {
    resetAllStores();
    expect(clearScrobbles).toHaveBeenCalledTimes(1);
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
