jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');
jest.mock('../../services/imageCacheService', () => ({
  cacheEntityCoverArt: jest.fn(),
}));
jest.mock('../layoutPreferencesStore', () => ({
  layoutPreferencesStore: {
    getState: jest.fn(() => ({ listLength: 20 })),
  },
}));

import {
  ensureCoverArtAuth,
  getRecentlyAddedAlbums,
  getRecentlyPlayedAlbums,
  getFrequentlyPlayedAlbums,
  getRandomAlbums,
} from '../../services/subsonicService';
import { albumListsStore } from '../albumListsStore';

const mockGetRecentlyAdded = getRecentlyAddedAlbums as jest.MockedFunction<typeof getRecentlyAddedAlbums>;
const mockGetRecentlyPlayed = getRecentlyPlayedAlbums as jest.MockedFunction<typeof getRecentlyPlayedAlbums>;
const mockGetFrequentlyPlayed = getFrequentlyPlayedAlbums as jest.MockedFunction<typeof getFrequentlyPlayedAlbums>;
const mockGetRandom = getRandomAlbums as jest.MockedFunction<typeof getRandomAlbums>;

const album = (id: string) => ({ id, name: `Album ${id}` } as any);

beforeEach(() => {
  jest.clearAllMocks();
  albumListsStore.setState({
    recentlyAdded: [],
    recentlyPlayed: [],
    frequentlyPlayed: [],
    randomSelection: [],
  });
});

describe('albumListsStore', () => {
  describe('refreshRecentlyAdded', () => {
    it('fetches and sets recentlyAdded', async () => {
      mockGetRecentlyAdded.mockResolvedValue([album('1')]);
      await albumListsStore.getState().refreshRecentlyAdded();
      expect(ensureCoverArtAuth).toHaveBeenCalled();
      expect(albumListsStore.getState().recentlyAdded).toEqual([album('1')]);
    });

    it('sets empty array on failure', async () => {
      albumListsStore.setState({ recentlyAdded: [album('old')] });
      mockGetRecentlyAdded.mockRejectedValue(new Error('fail'));
      await albumListsStore.getState().refreshRecentlyAdded();
      expect(albumListsStore.getState().recentlyAdded).toEqual([]);
    });
  });

  describe('refreshRecentlyPlayed', () => {
    it('fetches and sets recentlyPlayed', async () => {
      mockGetRecentlyPlayed.mockResolvedValue([album('2')]);
      await albumListsStore.getState().refreshRecentlyPlayed();
      expect(albumListsStore.getState().recentlyPlayed).toEqual([album('2')]);
    });

    it('sets empty on failure', async () => {
      mockGetRecentlyPlayed.mockRejectedValue(new Error('fail'));
      await albumListsStore.getState().refreshRecentlyPlayed();
      expect(albumListsStore.getState().recentlyPlayed).toEqual([]);
    });
  });

  describe('refreshFrequentlyPlayed', () => {
    it('fetches and sets frequentlyPlayed', async () => {
      mockGetFrequentlyPlayed.mockResolvedValue([album('3')]);
      await albumListsStore.getState().refreshFrequentlyPlayed();
      expect(albumListsStore.getState().frequentlyPlayed).toEqual([album('3')]);
    });

    it('sets empty on failure', async () => {
      mockGetFrequentlyPlayed.mockRejectedValue(new Error('fail'));
      await albumListsStore.getState().refreshFrequentlyPlayed();
      expect(albumListsStore.getState().frequentlyPlayed).toEqual([]);
    });
  });

  describe('refreshRandomSelection', () => {
    it('fetches and sets randomSelection', async () => {
      mockGetRandom.mockResolvedValue([album('4')]);
      await albumListsStore.getState().refreshRandomSelection();
      expect(albumListsStore.getState().randomSelection).toEqual([album('4')]);
    });

    it('sets empty on failure', async () => {
      mockGetRandom.mockRejectedValue(new Error('fail'));
      await albumListsStore.getState().refreshRandomSelection();
      expect(albumListsStore.getState().randomSelection).toEqual([]);
    });
  });

  describe('refreshAll', () => {
    it('fetches all lists in parallel', async () => {
      mockGetRecentlyAdded.mockResolvedValue([album('1')]);
      mockGetRecentlyPlayed.mockResolvedValue([album('2')]);
      mockGetFrequentlyPlayed.mockResolvedValue([album('3')]);
      mockGetRandom.mockResolvedValue([album('4')]);

      await albumListsStore.getState().refreshAll();

      const state = albumListsStore.getState();
      expect(state.recentlyAdded).toEqual([album('1')]);
      expect(state.recentlyPlayed).toEqual([album('2')]);
      expect(state.frequentlyPlayed).toEqual([album('3')]);
      expect(state.randomSelection).toEqual([album('4')]);
    });

    it('leaves existing state on failure', async () => {
      albumListsStore.setState({ recentlyAdded: [album('existing')] });
      mockGetRecentlyAdded.mockRejectedValue(new Error('fail'));

      await albumListsStore.getState().refreshAll();

      expect(albumListsStore.getState().recentlyAdded).toEqual([album('existing')]);
    });
  });

  describe('listLength integration', () => {
    it('passes configured listLength to API calls', async () => {
      const { layoutPreferencesStore } = require('../layoutPreferencesStore');
      (layoutPreferencesStore.getState as jest.Mock).mockReturnValue({ listLength: 50 });

      mockGetRecentlyAdded.mockResolvedValue([album('1')]);
      await albumListsStore.getState().refreshRecentlyAdded();
      expect(mockGetRecentlyAdded).toHaveBeenCalledWith(50);
    });

    it('refreshAll uses same listLength for all fetches', async () => {
      const { layoutPreferencesStore } = require('../layoutPreferencesStore');
      (layoutPreferencesStore.getState as jest.Mock).mockReturnValue({ listLength: 100 });

      mockGetRecentlyAdded.mockResolvedValue([]);
      mockGetRecentlyPlayed.mockResolvedValue([]);
      mockGetFrequentlyPlayed.mockResolvedValue([]);
      mockGetRandom.mockResolvedValue([]);

      await albumListsStore.getState().refreshAll();

      expect(mockGetRecentlyAdded).toHaveBeenCalledWith(100);
      expect(mockGetRecentlyPlayed).toHaveBeenCalledWith(100);
      expect(mockGetFrequentlyPlayed).toHaveBeenCalledWith(100);
      expect(mockGetRandom).toHaveBeenCalledWith(100);
    });
  });

  describe('direct setters', () => {
    it('setRecentlyAdded updates list', () => {
      albumListsStore.getState().setRecentlyAdded([album('x')]);
      expect(albumListsStore.getState().recentlyAdded).toEqual([album('x')]);
    });

    it('setRecentlyPlayed updates list', () => {
      albumListsStore.getState().setRecentlyPlayed([album('x')]);
      expect(albumListsStore.getState().recentlyPlayed).toEqual([album('x')]);
    });

    it('setFrequentlyPlayed updates list', () => {
      albumListsStore.getState().setFrequentlyPlayed([album('x')]);
      expect(albumListsStore.getState().frequentlyPlayed).toEqual([album('x')]);
    });

    it('setRandomSelection updates list', () => {
      albumListsStore.getState().setRandomSelection([album('x')]);
      expect(albumListsStore.getState().randomSelection).toEqual([album('x')]);
    });
  });
});
