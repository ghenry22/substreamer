jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');

import { ensureCoverArtAuth, getAllArtists } from '../../services/subsonicService';
import { artistLibraryStore } from '../artistLibraryStore';

const mockGetAllArtists = getAllArtists as jest.MockedFunction<typeof getAllArtists>;

beforeEach(() => {
  jest.clearAllMocks();
  artistLibraryStore.setState({ artists: [], loading: false, error: null, lastFetchedAt: null });
});

const makeArtist = (id: string, name: string) => ({ id, name } as any);

describe('artistLibraryStore', () => {
  describe('fetchAllArtists', () => {
    it('fetches and stores artists', async () => {
      mockGetAllArtists.mockResolvedValue([makeArtist('ar1', 'Radiohead')]);

      await artistLibraryStore.getState().fetchAllArtists();

      expect(ensureCoverArtAuth).toHaveBeenCalled();
      const state = artistLibraryStore.getState();
      expect(state.artists).toHaveLength(1);
      expect(state.loading).toBe(false);
      expect(state.lastFetchedAt).toBeGreaterThan(0);
    });

    it('prevents duplicate fetches', async () => {
      artistLibraryStore.setState({ loading: true });
      await artistLibraryStore.getState().fetchAllArtists();
      expect(mockGetAllArtists).not.toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      mockGetAllArtists.mockRejectedValue(new Error('Network error'));

      await artistLibraryStore.getState().fetchAllArtists();

      expect(artistLibraryStore.getState().error).toBe('Network error');
      expect(artistLibraryStore.getState().loading).toBe(false);
    });

    it('sets generic error for non-Error throws', async () => {
      mockGetAllArtists.mockRejectedValue('string');
      await artistLibraryStore.getState().fetchAllArtists();
      expect(artistLibraryStore.getState().error).toBe('Failed to load artists');
    });
  });

  describe('clearArtists', () => {
    it('resets all state', () => {
      artistLibraryStore.setState({
        artists: [makeArtist('ar1', 'A')],
        loading: true,
        error: 'err',
        lastFetchedAt: 1000,
      });
      artistLibraryStore.getState().clearArtists();
      const state = artistLibraryStore.getState();
      expect(state.artists).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastFetchedAt).toBeNull();
    });
  });
});
