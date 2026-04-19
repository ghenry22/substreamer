jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');

import { ensureCoverArtAuth, getAllPlaylists } from '../../services/subsonicService';
import { playlistLibraryStore } from '../playlistLibraryStore';

const mockGetAllPlaylists = getAllPlaylists as jest.MockedFunction<typeof getAllPlaylists>;

beforeEach(() => {
  jest.clearAllMocks();
  playlistLibraryStore.setState({ playlists: [], loading: false, error: null, lastFetchedAt: null });
});

const makePlaylist = (id: string, name: string) => ({ id, name } as any);

describe('playlistLibraryStore', () => {
  describe('fetchAllPlaylists', () => {
    it('fetches and stores playlists', async () => {
      mockGetAllPlaylists.mockResolvedValue([makePlaylist('p1', 'Chill')]);

      await playlistLibraryStore.getState().fetchAllPlaylists();

      expect(ensureCoverArtAuth).toHaveBeenCalled();
      const state = playlistLibraryStore.getState();
      expect(state.playlists).toHaveLength(1);
      expect(state.loading).toBe(false);
      expect(state.lastFetchedAt).toBeGreaterThan(0);
    });

    it('prevents duplicate fetches', async () => {
      playlistLibraryStore.setState({ loading: true });
      await playlistLibraryStore.getState().fetchAllPlaylists();
      expect(mockGetAllPlaylists).not.toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      mockGetAllPlaylists.mockRejectedValue(new Error('Network error'));
      await playlistLibraryStore.getState().fetchAllPlaylists();
      expect(playlistLibraryStore.getState().error).toBe('Network error');
    });

    it('sets generic error for non-Error throws', async () => {
      mockGetAllPlaylists.mockRejectedValue('string');
      await playlistLibraryStore.getState().fetchAllPlaylists();
      expect(playlistLibraryStore.getState().error).toBe('Failed to load playlists');
    });
  });

  describe('removePlaylist', () => {
    it('removes playlist by id', () => {
      playlistLibraryStore.setState({
        playlists: [makePlaylist('p1', 'A'), makePlaylist('p2', 'B')],
      });
      playlistLibraryStore.getState().removePlaylist('p1');
      expect(playlistLibraryStore.getState().playlists).toEqual([makePlaylist('p2', 'B')]);
    });

    it('no-ops for non-existing id', () => {
      playlistLibraryStore.setState({ playlists: [makePlaylist('p1', 'A')] });
      playlistLibraryStore.getState().removePlaylist('nonexistent');
      expect(playlistLibraryStore.getState().playlists).toHaveLength(1);
    });
  });

  describe('clearPlaylists', () => {
    it('resets all state', () => {
      playlistLibraryStore.setState({
        playlists: [makePlaylist('p1', 'A')],
        loading: true,
        error: 'err',
        lastFetchedAt: 1000,
      });
      playlistLibraryStore.getState().clearPlaylists();
      const state = playlistLibraryStore.getState();
      expect(state.playlists).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastFetchedAt).toBeNull();
    });
  });
});
