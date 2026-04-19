import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getOverride, mbidOverrideStore } from './mbidOverrideStore';
import { kvStorage } from './persistence';

import { cacheEntityCoverArt } from '../services/imageCacheService';
import {
  ensureCoverArtAuth,
  getArtist,
  getArtistInfo2,
  getTopSongs,
  isVariousArtists,
  getVariousArtistsBio,
  VARIOUS_ARTISTS_COVER_ART_ID,
  type ArtistInfo2,
  type ArtistWithAlbumsID3,
  type Child,
} from '../services/subsonicService';
import {
  getArtistBiography,
  searchArtistMBID,
} from '../services/musicbrainzService';
import { sanitizeBiographyText } from '../utils/formatters';
import { withTimeout } from '../utils/withTimeout';
import { layoutPreferencesStore } from './layoutPreferencesStore';
import { ratingStore } from './ratingStore';

/** Hard budget for a single artist-detail fetch (server + MB enrichment). */
const FETCH_TIMEOUT_MS = 15_000;

export interface ArtistDetailEntry {
  artist: ArtistWithAlbumsID3;
  artistInfo: ArtistInfo2 | null;
  topSongs: Child[];
  biography: string | null;
  /** The MBID that was actually used for biography lookup (override > server > auto-search). */
  resolvedMbid: string | null;
  /** Timestamp (Date.now()) when this entry was fetched from the server. */
  retrievedAt: number;
}

export interface ArtistDetailState {
  /** Artist details indexed by artist ID. */
  artists: Record<string, ArtistDetailEntry>;
  /** Fetch artist from API, store it, and return the entry. Returns null on failure.
   *  Pass `{ prefetchCovers: false }` to skip the eager cover-art cache —
   *  used by the background library sync. User-facing fetches omit it. */
  fetchArtist: (id: string, opts?: { prefetchCovers?: boolean }) => Promise<ArtistDetailEntry | null>;
  /** Re-fetch only topSongs for all cached artists (lightweight refresh). */
  refreshTopSongs: () => Promise<void>;
  /** Clear all cached artist details. */
  clearArtists: () => void;
}

const PERSIST_KEY = 'substreamer-artist-details';

export const artistDetailStore = create<ArtistDetailState>()(
  persist(
    (set, get) => ({
      artists: {},

      fetchArtist: async (id: string, opts?: { prefetchCovers?: boolean }) => {
        const prefetchCovers = opts?.prefetchCovers ?? true;
        const result = await withTimeout(async (signal) => {
          await ensureCoverArtAuth();

          const artistData = await getArtist(id);
          if (!artistData) return null;

          // Various Artists: skip all remote enrichment, inject static data.
          if (isVariousArtists(artistData.name)) {
            const entry: ArtistDetailEntry = {
              artist: {
                ...artistData,
                coverArt: VARIOUS_ARTISTS_COVER_ART_ID,
              },
              artistInfo: null,
              topSongs: [],
              biography: getVariousArtistsBio(),
              resolvedMbid: null,
              retrievedAt: Date.now(),
            };
            set({ artists: { ...get().artists, [id]: entry } });
            return entry;
          }

          // Normal artist: fetch info and top songs in parallel.
          const [infoData, topSongs] = await Promise.all([
            getArtistInfo2(id),
            getTopSongs(artistData.name, layoutPreferencesStore.getState().listLength).catch(() => [] as Child[]),
          ]);

          // Resolve biography: prefer Subsonic, fall back to MusicBrainz
          let biography: string | null = null;
          let resolvedMbid: string | null = null;
          const subsonicBio = infoData?.biography ? sanitizeBiographyText(infoData.biography) : null;
          if (subsonicBio && subsonicBio.length > 0) {
            biography = subsonicBio;
            resolvedMbid = getOverride(mbidOverrideStore.getState().overrides, 'artist', id)?.mbid
              ?? infoData?.musicBrainzId
              ?? null;
          } else {
            try {
              const override = getOverride(mbidOverrideStore.getState().overrides, 'artist', id);
              const mbid = override?.mbid
                ?? infoData?.musicBrainzId
                ?? (await searchArtistMBID(artistData.name, signal));
              resolvedMbid = mbid;
              if (mbid) {
                const mbBio = await getArtistBiography(mbid, signal);
                if (mbBio) biography = sanitizeBiographyText(mbBio);
              }
            } catch {
              /* non-critical */
            }
          }

          const entry: ArtistDetailEntry = {
            artist: artistData,
            artistInfo: infoData,
            topSongs,
            biography,
            resolvedMbid,
            retrievedAt: Date.now(),
          };

          const ratingEntries: Array<{ id: string; serverRating: number }> = [
            { id, serverRating: artistData.userRating ?? 0 },
            ...topSongs.map((s) => ({ id: s.id, serverRating: s.userRating ?? 0 })),
            ...(artistData.album ?? []).map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 })),
          ];
          ratingStore.getState().reconcileRatings(ratingEntries);

          set({
            artists: {
              ...get().artists,
              [id]: entry,
            },
          });

          // Proactively cache cover art for new IDs so they survive offline.
          // Skipped during bulk sync — see prefetchCovers contract above.
          if (prefetchCovers && topSongs.length > 0) cacheEntityCoverArt(topSongs);

          return entry;
        }, FETCH_TIMEOUT_MS);

        return result === 'timeout' ? null : result;
      },

      refreshTopSongs: async () => {
        const entries = get().artists;
        const size = layoutPreferencesStore.getState().listLength;
        const updates: Record<string, ArtistDetailEntry> = { ...entries };
        const allTopSongs: Child[] = [];
        for (const [id, entry] of Object.entries(entries)) {
          if (isVariousArtists(entry.artist.name)) continue;
          try {
            const topSongs = await getTopSongs(entry.artist.name, size);
            updates[id] = { ...entry, topSongs };
            allTopSongs.push(...topSongs);
          } catch {
            /* keep existing topSongs */
          }
        }
        set({ artists: updates });

        // Proactively cache cover art for new IDs so they survive offline
        if (allTopSongs.length > 0) cacheEntityCoverArt(allTopSongs);
      },

      clearArtists: () => set({ artists: {} }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        artists: state.artists,
      }),
    }
  )
);

