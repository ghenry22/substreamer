import { create } from 'zustand';

import { searchLibrary, type SearchResults } from '../services/searchService';
import { ratingStore } from './ratingStore';

const EMPTY_RESULTS: SearchResults = {
  albums: [],
  artists: [],
  songs: [],
};

export interface SearchState {
  /** Current search query text */
  query: string;
  /** Current local or merged search results */
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

  setQuery: (query) => {
    // Flip `loading` on as soon as the text changes so the overlay can
    // show a "searching" indicator during the debounce + network window,
    // not just after performSearch fires ~300ms later. For empty input
    // we explicitly set false — the overlay early-returns on empty
    // query anyway, but this keeps the flag honest if the overlay is
    // reopened later.
    set({ query, loading: query.trim() !== '', error: null });
  },

  performSearch: async () => {
    const requestQuery = get().query;
    if (!requestQuery.trim()) {
      set({ results: EMPTY_RESULTS, loading: false, error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      // Render local hits while the server search runs and bail on superseded queries.
      const results = await searchLibrary(requestQuery.trim(), {
        shouldAbort: () => get().query !== requestQuery,
        onLocalResults: (local) => {
          if (get().query !== requestQuery) return;
          set({ results: local });
        },
      });
      // Stale-result guard: a newer performSearch is in flight; let it land and
      // ignore this stale response so the list always matches the latest query.
      if (get().query !== requestQuery) return;
      const ratingEntries: Array<{ id: string; serverRating: number }> = [
        ...results.albums.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 })),
        ...results.artists.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 })),
        ...results.songs.map((s) => ({ id: s.id, serverRating: s.userRating ?? 0 })),
      ];
      ratingStore.getState().reconcileRatings(ratingEntries);
      set({ results, loading: false });
    } catch (e) {
      if (get().query !== requestQuery) return;
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
