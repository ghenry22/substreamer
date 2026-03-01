import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mbidOverrideStore } from './mbidOverrideStore';
import { sqliteStorage } from './sqliteStorage';

import {
  ensureCoverArtAuth,
  getArtist,
  getArtistInfo2,
  getTopSongs,
  type ArtistInfo2,
  type ArtistWithAlbumsID3,
  type Child,
} from '../services/subsonicService';
import {
  getArtistBiography,
  searchArtistMBID,
} from '../services/musicbrainzService';
import { sanitizeBiographyText } from '../utils/formatters';

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
  /** Fetch artist from API, store it, and return the entry. Returns null on failure. */
  fetchArtist: (id: string) => Promise<ArtistDetailEntry | null>;
  /** Clear all cached artist details. */
  clearArtists: () => void;
}

const PERSIST_KEY = 'substreamer-artist-details';

export const artistDetailStore = create<ArtistDetailState>()(
  persist(
    (set, get) => ({
      artists: {},

      fetchArtist: async (id: string) => {
        await ensureCoverArtAuth();

        const [artistData, infoData] = await Promise.all([
          getArtist(id),
          getArtistInfo2(id),
        ]);

        if (!artistData) return null;

        // Fetch top songs
        let topSongs: Child[] = [];
        try {
          topSongs = await getTopSongs(artistData.name, 20);
        } catch {
          /* non-critical */
        }

        // Resolve biography: prefer Subsonic, fall back to MusicBrainz
        let biography: string | null = null;
        let resolvedMbid: string | null = null;
        const subsonicBio = infoData?.biography ? sanitizeBiographyText(infoData.biography) : null;
        if (subsonicBio && subsonicBio.length > 0) {
          biography = subsonicBio;
          resolvedMbid = mbidOverrideStore.getState().overrides[id]?.mbid
            ?? infoData?.musicBrainzId
            ?? null;
        } else {
          try {
            const override = mbidOverrideStore.getState().overrides[id];
            const mbid = override?.mbid
              ?? infoData?.musicBrainzId
              ?? (await searchArtistMBID(artistData.name));
            resolvedMbid = mbid;
            if (mbid) {
              const mbBio = await getArtistBiography(mbid);
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

        set({
          artists: {
            ...get().artists,
            [id]: entry,
          },
        });

        return entry;
      },

      clearArtists: () => set({ artists: {} }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        artists: state.artists,
      }),
    }
  )
);
