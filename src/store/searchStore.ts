import { create } from 'zustand';

import {
  performOnlineSearch,
  performOfflineSearch,
  type SearchResults,
} from '../services/searchService';
import { type ArtistID3WithRating } from '../services/subsonicService';
import { offlineModeStore } from './offlineModeStore';
import { ratingStore } from './ratingStore';

export type { SearchResults };

const EMPTY_RESULTS: SearchResults = {
  albums: [],
  artists: [],
  songs: [],
};

export interface SearchState {
  /** Current search query text */
  query: string;
  /** Full search results from the server */
  results: SearchResults;
  /** Whether a search request is in progress */
  loading: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Whether the overlay dropdown is visible */
  isOverlayVisible: boolean;
  /** Height of the header (set by SearchableHeader via onLayout) */
  headerHeight: number;

  /** Update the query text */
  setQuery: (query: string) => void;
  /** Execute a search using the current query */
  performSearch: () => Promise<void>;
  /** Show the results overlay */
  showOverlay: () => void;
  /** Hide the results overlay */
  hideOverlay: () => void;
  /** Set measured header height */
  setHeaderHeight: (height: number) => void;
  /** Clear query, results, and hide overlay */
  clear: () => void;
}

export const searchStore = create<SearchState>()((set, get) => ({
  query: '',
  results: EMPTY_RESULTS,
  loading: false,
  error: null,
  isOverlayVisible: false,
  headerHeight: 0,

  setQuery: (query) => set({ query }),

  performSearch: async () => {
    const { query } = get();
    if (!query.trim()) {
      set({ results: EMPTY_RESULTS, loading: false, error: null });
      return;
    }

    if (offlineModeStore.getState().offlineMode) {
      const results = performOfflineSearch(query.trim());
      set({ results, loading: false, error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      const results = await performOnlineSearch(query);
      const ratingEntries: Array<{ id: string; serverRating: number }> = [
        ...results.albums.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 })),
        ...results.artists.map((a) => ({ id: a.id, serverRating: (a as ArtistID3WithRating).userRating ?? 0 })),
        ...results.songs.map((s) => ({ id: s.id, serverRating: s.userRating ?? 0 })),
      ];
      ratingStore.getState().reconcileRatings(ratingEntries);
      set({ results, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Search failed',
      });
    }
  },

  showOverlay: () => set({ isOverlayVisible: true }),
  hideOverlay: () => set({ isOverlayVisible: false }),
  setHeaderHeight: (headerHeight) => set({ headerHeight }),

  clear: () =>
    set({
      query: '',
      results: EMPTY_RESULTS,
      loading: false,
      error: null,
      isOverlayVisible: false,
    }),
}));
