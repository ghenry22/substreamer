import { create } from 'zustand';

import {
  ensureCoverArtAuth,
  search3,
  type AlbumID3,
  type ArtistID3,
  type Child,
} from '../services/subsonicService';

export interface SearchResults {
  albums: AlbumID3[];
  artists: ArtistID3[];
  songs: Child[];
}

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

    set({ loading: true, error: null });
    try {
      await ensureCoverArtAuth();
      const results = await search3(query);
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
