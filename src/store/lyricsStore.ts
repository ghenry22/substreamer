import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

import { getLyricsForTrack, type LyricsData } from '../services/subsonicService';
import { withTimeout } from '../utils/withTimeout';

/** Hard budget for a single lyrics fetch (OpenSubsonic + classic fallback). */
const FETCH_TIMEOUT_MS = 15_000;

export type LyricsErrorKind = 'timeout' | 'error';

interface LyricsState {
  /** Lyrics data indexed by track ID. */
  entries: Record<string, LyricsData>;
  /** Per-track loading flags (not persisted). */
  loading: Record<string, boolean>;
  /** Per-track error flags (not persisted). Set when the last fetch failed. */
  errors: Record<string, LyricsErrorKind>;
  /** Fetch lyrics for a track. Prefers structured lyrics, falls back to classic. */
  fetchLyrics: (
    trackId: string,
    artist?: string,
    title?: string,
  ) => Promise<LyricsData | null>;
  /** Clear all cached lyrics. */
  clearLyrics: () => void;
}

const PERSIST_KEY = 'substreamer-lyrics';

export const lyricsStore = create<LyricsState>()(
  persist(
    (set, get) => ({
      entries: {},
      loading: {},
      errors: {},

      fetchLyrics: async (trackId, artist, title) => {
        set({
          loading: { ...get().loading, [trackId]: true },
          errors: (() => {
            const { [trackId]: _, ...rest } = get().errors;
            return rest;
          })(),
        });

        const clearLoading = () => {
          const { [trackId]: _, ...rest } = get().loading;
          set({ loading: rest });
        };
        const setError = (kind: LyricsErrorKind) => {
          set({ errors: { ...get().errors, [trackId]: kind } });
        };

        try {
          const result = await withTimeout(
            async (signal) => getLyricsForTrack(trackId, artist, title, signal),
            FETCH_TIMEOUT_MS,
          );

          if (result === 'timeout') {
            setError('timeout');
            return null;
          }

          if (result === null) {
            // Well-defined "no lyrics for this track" case. No entry, no error.
            return null;
          }

          set({
            entries: { ...get().entries, [trackId]: result },
          });
          return result;
        } catch {
          setError('error');
          return null;
        } finally {
          clearLoading();
        }
      },

      clearLyrics: () => set({ entries: {}, loading: {}, errors: {} }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
