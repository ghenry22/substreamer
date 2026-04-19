jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/searchService');

import {
  performOnlineSearch,
  performOfflineSearch,
} from '../../services/searchService';
import { searchStore } from '../searchStore';
import { offlineModeStore } from '../offlineModeStore';

const mockPerformOnlineSearch = performOnlineSearch as jest.MockedFunction<typeof performOnlineSearch>;
const mockPerformOfflineSearch = performOfflineSearch as jest.MockedFunction<typeof performOfflineSearch>;

beforeEach(() => {
  jest.clearAllMocks();
  searchStore.getState().clear();
  offlineModeStore.setState({ offlineMode: false });
});

describe('searchStore', () => {
  describe('setQuery', () => {
    it('updates query text', () => {
      searchStore.getState().setQuery('radiohead');
      expect(searchStore.getState().query).toBe('radiohead');
    });
  });

  describe('performSearch — empty query', () => {
    it('clears results and does not call service', async () => {
      searchStore.setState({ query: '   ' });
      await searchStore.getState().performSearch();
      expect(mockPerformOnlineSearch).not.toHaveBeenCalled();
      expect(mockPerformOfflineSearch).not.toHaveBeenCalled();
      expect(searchStore.getState().results).toEqual({
        albums: [],
        artists: [],
        songs: [],
      });
    });
  });

  describe('performSearch — online', () => {
    it('delegates to performOnlineSearch and stores results', async () => {
      const results = {
        albums: [{ id: 'a1', name: 'Album' }],
        artists: [{ id: 'ar1', name: 'Artist' }],
        songs: [{ id: 's1', title: 'Song' }],
      };
      mockPerformOnlineSearch.mockResolvedValue(results as any);
      searchStore.setState({ query: 'test' });

      await searchStore.getState().performSearch();

      expect(mockPerformOnlineSearch).toHaveBeenCalledWith('test');
      expect(searchStore.getState().results).toEqual(results);
      expect(searchStore.getState().loading).toBe(false);
    });

    it('sets error on failure', async () => {
      mockPerformOnlineSearch.mockRejectedValue(new Error('Network error'));
      searchStore.setState({ query: 'test' });

      await searchStore.getState().performSearch();

      expect(searchStore.getState().error).toBe('Network error');
      expect(searchStore.getState().loading).toBe(false);
    });

    it('sets generic error for non-Error throws', async () => {
      mockPerformOnlineSearch.mockRejectedValue('string');
      searchStore.setState({ query: 'test' });
      await searchStore.getState().performSearch();
      expect(searchStore.getState().error).toBe('Search failed');
    });

    it('reconciles ratings from search results', async () => {
      const results = {
        albums: [{ id: 'a1', name: 'Album', userRating: 4 }],
        artists: [{ id: 'ar1', name: 'Artist' }],
        songs: [{ id: 's1', title: 'Song', userRating: 5 }],
      };
      mockPerformOnlineSearch.mockResolvedValue(results as any);
      searchStore.setState({ query: 'test' });

      // Spy on ratingStore
      const { ratingStore } = require('../ratingStore');
      const reconcileSpy = jest.spyOn(ratingStore.getState(), 'reconcileRatings');

      await searchStore.getState().performSearch();

      expect(reconcileSpy).toHaveBeenCalledWith([
        { id: 'a1', serverRating: 4 },
        { id: 'ar1', serverRating: 0 },
        { id: 's1', serverRating: 5 },
      ]);
      reconcileSpy.mockRestore();
    });
  });

  describe('performSearch — offline', () => {
    it('delegates to performOfflineSearch without calling online search', async () => {
      offlineModeStore.setState({ offlineMode: true });
      const offlineResults = {
        albums: [{ id: 'a1', name: 'Cached Album' }],
        artists: [],
        songs: [{ id: 't1', title: 'Cached Song' }],
      };
      mockPerformOfflineSearch.mockReturnValue(offlineResults as any);
      searchStore.setState({ query: 'cached' });

      await searchStore.getState().performSearch();

      expect(mockPerformOnlineSearch).not.toHaveBeenCalled();
      expect(mockPerformOfflineSearch).toHaveBeenCalledWith('cached');
      expect(searchStore.getState().results).toEqual(offlineResults);
    });
  });

  describe('overlay and header', () => {
    it('showOverlay sets isOverlayVisible', () => {
      searchStore.getState().showOverlay();
      expect(searchStore.getState().isOverlayVisible).toBe(true);
    });

    it('hideOverlay clears isOverlayVisible', () => {
      searchStore.setState({ isOverlayVisible: true });
      searchStore.getState().hideOverlay();
      expect(searchStore.getState().isOverlayVisible).toBe(false);
    });

    it('setHeaderHeight updates height', () => {
      searchStore.getState().setHeaderHeight(64);
      expect(searchStore.getState().headerHeight).toBe(64);
    });
  });

  describe('clear', () => {
    it('resets all search state', () => {
      searchStore.setState({
        query: 'test',
        results: { albums: [{ id: 'a1' }] as any, artists: [], songs: [] },
        loading: true,
        error: 'err',
        isOverlayVisible: true,
      });
      searchStore.getState().clear();
      const state = searchStore.getState();
      expect(state.query).toBe('');
      expect(state.results).toEqual({ albums: [], artists: [], songs: [] });
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.isOverlayVisible).toBe(false);
    });
  });
});
