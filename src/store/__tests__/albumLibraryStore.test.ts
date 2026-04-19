jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');

import {
  ensureCoverArtAuth,
  searchAllAlbums,
  getAllAlbumsAlphabetical,
} from '../../services/subsonicService';
import { albumLibraryStore } from '../albumLibraryStore';
import { albumListsStore } from '../albumListsStore';
import { layoutPreferencesStore } from '../layoutPreferencesStore';

const mockSearchAllAlbums = searchAllAlbums as jest.MockedFunction<typeof searchAllAlbums>;
const mockGetAllAlbumsAlphabetical = getAllAlbumsAlphabetical as jest.MockedFunction<typeof getAllAlbumsAlphabetical>;

beforeEach(() => {
  jest.clearAllMocks();
  albumLibraryStore.setState({ albums: [], loading: false, error: null, lastFetchedAt: null });
  albumListsStore.setState({ recentlyAdded: [] } as any);
  layoutPreferencesStore.setState({ albumSortOrder: 'artist' });
});

const makeAlbum = (id: string, name: string, artist: string) =>
  ({ id, name, artist } as any);

describe('albumLibraryStore', () => {
  describe('fetchAllAlbums', () => {
    it('fetches via search3 and sorts by artist', async () => {
      const albums = [
        makeAlbum('a2', 'Zebra', 'B Artist'),
        makeAlbum('a1', 'Alpha', 'A Artist'),
      ];
      mockSearchAllAlbums.mockResolvedValue(albums);

      await albumLibraryStore.getState().fetchAllAlbums();

      expect(ensureCoverArtAuth).toHaveBeenCalled();
      const state = albumLibraryStore.getState();
      expect(state.loading).toBe(false);
      expect(state.albums[0].artist).toBe('A Artist');
      expect(state.albums[1].artist).toBe('B Artist');
      expect(state.lastFetchedAt).toBeGreaterThan(0);
    });

    it('falls back to getAlbumList2 when search3 returns empty', async () => {
      mockSearchAllAlbums.mockResolvedValue([]);
      mockGetAllAlbumsAlphabetical.mockResolvedValue([makeAlbum('a1', 'Test', 'Artist')]);

      await albumLibraryStore.getState().fetchAllAlbums();

      expect(mockGetAllAlbumsAlphabetical).toHaveBeenCalled();
      expect(albumLibraryStore.getState().albums).toHaveLength(1);
    });

    it('sorts by title when albumSortOrder is title', async () => {
      layoutPreferencesStore.setState({ albumSortOrder: 'title' });
      const albums = [
        makeAlbum('a2', 'Zebra', 'A Artist'),
        makeAlbum('a1', 'Alpha', 'Z Artist'),
      ];
      mockSearchAllAlbums.mockResolvedValue(albums);

      await albumLibraryStore.getState().fetchAllAlbums();

      expect(albumLibraryStore.getState().albums[0].name).toBe('Alpha');
      expect(albumLibraryStore.getState().albums[1].name).toBe('Zebra');
    });

    it('handles null artist/name during sort', async () => {
      const albums = [
        { id: 'a1', name: 'Alpha', artist: null } as any,
        makeAlbum('a2', 'Zebra', 'A Artist'),
      ];
      mockSearchAllAlbums.mockResolvedValue(albums);

      await albumLibraryStore.getState().fetchAllAlbums();

      // null artist sorts as '' which comes before 'A Artist'
      expect(albumLibraryStore.getState().albums[0].id).toBe('a1');
    });

    it('prevents duplicate fetches', async () => {
      albumLibraryStore.setState({ loading: true });
      await albumLibraryStore.getState().fetchAllAlbums();
      expect(mockSearchAllAlbums).not.toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      mockSearchAllAlbums.mockRejectedValue(new Error('Network error'));

      await albumLibraryStore.getState().fetchAllAlbums();

      const state = albumLibraryStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toBe('Network error');
    });

    it('sets generic error for non-Error throws', async () => {
      mockSearchAllAlbums.mockRejectedValue('string error');

      await albumLibraryStore.getState().fetchAllAlbums();

      expect(albumLibraryStore.getState().error).toBe('Failed to load albums');
    });
  });

  describe('resortAlbums', () => {
    it('re-sorts existing albums by current sort order', () => {
      albumLibraryStore.setState({
        albums: [makeAlbum('a2', 'Zebra', 'A'), makeAlbum('a1', 'Alpha', 'Z')],
      });
      layoutPreferencesStore.setState({ albumSortOrder: 'title' });

      albumLibraryStore.getState().resortAlbums();

      expect(albumLibraryStore.getState().albums[0].name).toBe('Alpha');
    });

    it('no-ops when albums array is empty', () => {
      albumLibraryStore.setState({ albums: [] });
      albumLibraryStore.getState().resortAlbums();
      expect(albumLibraryStore.getState().albums).toEqual([]);
    });

    it('handles albums with null sort key values', () => {
      albumLibraryStore.setState({
        albums: [
          makeAlbum('a1', 'Zebra', 'Artist'),
          { id: 'a2', name: null, artist: null } as any,
        ],
      });
      layoutPreferencesStore.setState({ albumSortOrder: 'title' });
      albumLibraryStore.getState().resortAlbums();
      // null sorts before non-null (empty string < 'Zebra')
      expect(albumLibraryStore.getState().albums[0].id).toBe('a2');
    });
  });

  describe('cross-store subscription', () => {
    it('re-sorts albums when albumSortOrder changes', () => {
      albumLibraryStore.setState({
        albums: [makeAlbum('a1', 'Alpha', 'Z Artist'), makeAlbum('a2', 'Zebra', 'A Artist')],
      });
      // Trigger the subscription by changing albumSortOrder
      layoutPreferencesStore.getState().setAlbumSortOrder('title');
      expect(albumLibraryStore.getState().albums[0].name).toBe('Alpha');
    });
  });

  // NOTE: the `recentlyAdded` → `fetchAllAlbums` side-effect was retired
  // from `albumLibraryStore` in Phase 5. The equivalent behavior now lives
  // in `dataSyncService.onAlbumReferenced`, which is exercised by
  // `dataSyncService.test.ts`.

  describe('empty-response safety (transient-failure guard)', () => {
    it('does not wipe a populated cache when both strategies return empty', async () => {
      albumLibraryStore.setState({
        albums: [
          makeAlbum('a1', 'A', 'A Artist'),
          makeAlbum('a2', 'B', 'B Artist'),
        ],
      });
      mockSearchAllAlbums.mockResolvedValue([]);
      mockGetAllAlbumsAlphabetical.mockResolvedValue([]);

      await albumLibraryStore.getState().fetchAllAlbums();

      expect(albumLibraryStore.getState().albums).toHaveLength(2);
      expect(albumLibraryStore.getState().error).toBeTruthy();
      expect(albumLibraryStore.getState().loading).toBe(false);
    });

    it('DOES replace when the old list was empty and new list is empty (initial state)', async () => {
      albumLibraryStore.setState({ albums: [] });
      mockSearchAllAlbums.mockResolvedValue([]);
      mockGetAllAlbumsAlphabetical.mockResolvedValue([]);

      await albumLibraryStore.getState().fetchAllAlbums();
      // Empty → empty transition on cold cache: not an error, just a quiet no-op.
      expect(albumLibraryStore.getState().albums).toEqual([]);
      expect(albumLibraryStore.getState().error).toBeNull();
    });
  });

  describe('clearAlbums', () => {
    it('resets all state', () => {
      albumLibraryStore.setState({
        albums: [makeAlbum('a1', 'Test', 'Artist')],
        loading: true,
        error: 'old',
        lastFetchedAt: 1000,
      });
      albumLibraryStore.getState().clearAlbums();
      const state = albumLibraryStore.getState();
      expect(state.albums).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastFetchedAt).toBeNull();
    });
  });
});
