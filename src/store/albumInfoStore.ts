import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getOverride, mbidOverrideStore } from './mbidOverrideStore';
import { kvStorage } from './persistence';

import { getAlbumInfo2, type AlbumInfo } from '../services/subsonicService';
import { getAlbumDescription } from '../services/musicbrainzService';
import { sanitizeBiographyText } from '../utils/formatters';
import { withTimeout } from '../utils/withTimeout';

/** Hard budget for a single album-info fetch (server + enrichment chain). */
const FETCH_TIMEOUT_MS = 15_000;

interface AlbumInfoEntry {
  albumInfo: AlbumInfo;
  /** Wikipedia description if enriched client-side (server had no notes). */
  enrichedNotes: string | null;
  /** Attribution URL for the enriched notes (Wikipedia page). */
  enrichedNotesUrl: string | null;
  /** The MBID override for this album (release-group ID), or null if using server MBID. */
  overrideMbid: string | null;
  /** Timestamp (Date.now()) when this entry was fetched from the server. */
  retrievedAt: number;
}

export type AlbumInfoErrorKind = 'timeout' | 'error';

interface AlbumInfoState {
  /** Album info indexed by album ID. */
  entries: Record<string, AlbumInfoEntry>;
  /** Per-album loading flags (not persisted). */
  loading: Record<string, boolean>;
  /** Per-album error flags (not persisted). Set when the last fetch failed. */
  errors: Record<string, AlbumInfoErrorKind>;
  /**
   * Fetch album info from the Subsonic server, enriching with Wikipedia if
   * the server returns no notes. Pass artistName and albumName so the
   * MusicBrainz search fallback can resolve the album.
   */
  fetchAlbumInfo: (
    albumId: string,
    artistName?: string,
    albumName?: string,
  ) => Promise<AlbumInfoEntry | null>;
  /** Clear all cached album info. */
  clearAlbumInfo: () => void;
}

const PERSIST_KEY = 'substreamer-album-info';

export const albumInfoStore = create<AlbumInfoState>()(
  persist(
    (set, get) => ({
      entries: {},
      loading: {},
      errors: {},

      fetchAlbumInfo: async (
        albumId: string,
        artistName?: string,
        albumName?: string,
      ) => {
        set({
          loading: { ...get().loading, [albumId]: true },
          errors: (() => {
            const { [albumId]: _, ...rest } = get().errors;
            return rest;
          })(),
        });

        const clearLoading = () => {
          const { [albumId]: _, ...rest } = get().loading;
          set({ loading: rest });
        };
        const setError = (kind: AlbumInfoErrorKind) => {
          set({ errors: { ...get().errors, [albumId]: kind } });
        };

        try {
          const result = await withTimeout(async (signal) => {
            const data = await getAlbumInfo2(albumId);

            // Check if the server returned meaningful notes
            const serverNotes = data?.notes ? sanitizeBiographyText(data.notes) : '';
            const hasServerNotes = serverNotes.length > 0;

            let enrichedNotes: string | null = null;
            let enrichedNotesUrl: string | null = null;

            // Check for an MBID override (release-group ID from user selection)
            const overrideMbid = getOverride(
              mbidOverrideStore.getState().overrides,
              'album',
              albumId,
            )?.mbid ?? null;

            if (!hasServerNotes && artistName && albumName) {
              try {
                const mbidToUse = overrideMbid ?? data?.musicBrainzId;
                const desc = await getAlbumDescription(
                  artistName,
                  albumName,
                  mbidToUse,
                  // Override MBIDs are release-group IDs; server MBIDs are release IDs
                  !!overrideMbid,
                  signal,
                );
                if (desc) {
                  enrichedNotes = desc.description;
                  enrichedNotesUrl = desc.url;
                }
              } catch {
                /* non-critical: enrichment is best-effort */
              }
            }

            const entry: AlbumInfoEntry = {
              albumInfo: data ?? {},
              enrichedNotes,
              enrichedNotesUrl,
              overrideMbid,
              retrievedAt: Date.now(),
            };

            return entry;
          }, FETCH_TIMEOUT_MS);

          if (result === 'timeout') {
            setError('timeout');
            return null;
          }

          set({
            entries: { ...get().entries, [albumId]: result },
          });
          return result;
        } catch {
          setError('error');
          return null;
        } finally {
          clearLoading();
        }
      },

      clearAlbumInfo: () => set({ entries: {}, loading: {}, errors: {} }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        entries: state.entries,
      }),
    }
  )
);
