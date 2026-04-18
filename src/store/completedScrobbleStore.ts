import { create } from 'zustand';

import {
  clearScrobbles,
  hydrateScrobbles,
  insertScrobble,
  replaceAllScrobbles,
} from './persistence/scrobbleTable';

import { type Child } from '../services/subsonicService';
import { getPrimaryGenre } from '../utils/genreHelpers';

export interface CompletedScrobble {
  /** Unique identifier (carried over from the pending entry). */
  id: string;
  /** Full Subsonic songID3 object. */
  song: Child;
  /** Unix timestamp (ms) when playback completed. */
  time: number;
}

export interface ListeningStats {
  totalPlays: number;
  totalListeningSeconds: number;
  uniqueArtists: Record<string, true>;
}

export interface AnalyticsAggregates {
  artistCounts: Record<string, number>;
  albumCounts: Record<string, { artist: string; coverArt?: string; count: number }>;
  songCounts: Record<string, { song: Child; count: number }>;
  genreCounts: Record<string, number>;
  hourBuckets: number[];
  dayCounts: Record<string, number>;
}

const EMPTY_STATS: ListeningStats = {
  totalPlays: 0,
  totalListeningSeconds: 0,
  uniqueArtists: {},
};

const EMPTY_AGGREGATES: AnalyticsAggregates = {
  artistCounts: {},
  albumCounts: {},
  songCounts: {},
  genreCounts: {},
  hourBuckets: new Array(24).fill(0),
  dayCounts: {},
};

function aggregateDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface CompletedScrobbleState {
  completedScrobbles: CompletedScrobble[];
  stats: ListeningStats;
  aggregates: AnalyticsAggregates;
  /** True after the on-start hydration from SQLite has populated the store. */
  hasHydrated: boolean;

  addCompleted: (scrobble: CompletedScrobble) => void;
  rebuildStats: () => void;
  rebuildAggregates: () => void;
  /**
   * Replace the entire scrobble set both in the SQLite table and in memory.
   * Used by backup restore. Rebuilds derived stats + aggregates from the
   * provided list.
   */
  replaceAll: (scrobbles: CompletedScrobble[]) => void;
  /** Called once at app start to load persisted rows into memory. */
  hydrateFromDb: () => void;
}

function buildStats(scrobbles: CompletedScrobble[]): ListeningStats {
  let totalListeningSeconds = 0;
  const uniqueArtists: Record<string, true> = {};
  for (const s of scrobbles) {
    if (s.song.duration) totalListeningSeconds += s.song.duration;
    if (s.song.artist) uniqueArtists[s.song.artist] = true;
  }
  return { totalPlays: scrobbles.length, totalListeningSeconds, uniqueArtists };
}

function buildAggregates(scrobbles: CompletedScrobble[]): AnalyticsAggregates {
  const artistCounts: Record<string, number> = {};
  const albumCounts: Record<string, { artist: string; coverArt?: string; count: number }> = {};
  const songCounts: Record<string, { song: Child; count: number }> = {};
  const genreCounts: Record<string, number> = {};
  const hourBuckets = new Array<number>(24).fill(0);
  const dayCounts: Record<string, number> = {};

  for (const s of scrobbles) {
    const artist = s.song.artist ?? 'Unknown';
    artistCounts[artist] = (artistCounts[artist] ?? 0) + 1;

    const albumKey = `${s.song.album ?? 'Unknown'}::${artist}`;
    const existingAlbum = albumCounts[albumKey];
    if (existingAlbum) {
      existingAlbum.count++;
      if (s.song.coverArt) existingAlbum.coverArt = s.song.coverArt;
    } else {
      albumCounts[albumKey] = { artist, coverArt: s.song.coverArt ?? undefined, count: 1 };
    }

    const existingSong = songCounts[s.song.id];
    if (existingSong) {
      existingSong.count++;
      existingSong.song = s.song;
    } else {
      songCounts[s.song.id] = { song: s.song, count: 1 };
    }

    const genre = getPrimaryGenre(s.song);
    if (genre) {
      genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;
    }

    hourBuckets[new Date(s.time).getHours()]++;

    const dk = aggregateDateKey(s.time);
    dayCounts[dk] = (dayCounts[dk] ?? 0) + 1;
  }

  return { artistCounts, albumCounts, songCounts, genreCounts, hourBuckets, dayCounts };
}

export const completedScrobbleStore = create<CompletedScrobbleState>()((set, get) => ({
  completedScrobbles: [],
  stats: { ...EMPTY_STATS },
  aggregates: { ...EMPTY_AGGREGATES, hourBuckets: new Array(24).fill(0) },
  hasHydrated: false,

  addCompleted: (scrobble) => {
    const state = get();
    if (
      !scrobble.id ||
      !scrobble.song?.id ||
      !scrobble.song.title ||
      state.completedScrobbles.some((s) => s.id === scrobble.id)
    ) {
      return;
    }

    // Persist first so the row is on disk before any subscriber acts on the
    // new in-memory state. insertScrobble is INSERT OR IGNORE so a collision
    // with a concurrently-added row can't throw.
    insertScrobble(scrobble);

    const artist = scrobble.song.artist;
    const newArtists =
      artist && !(artist in state.stats.uniqueArtists)
        ? { ...state.stats.uniqueArtists, [artist]: true as const }
        : state.stats.uniqueArtists;

    // Incremental aggregate updates
    const agg = state.aggregates;
    const artistName = artist ?? 'Unknown';
    const newArtistCounts = { ...agg.artistCounts, [artistName]: (agg.artistCounts[artistName] ?? 0) + 1 };

    const albumKey = `${scrobble.song.album ?? 'Unknown'}::${artistName}`;
    const existingAlbum = agg.albumCounts[albumKey];
    const newAlbumCounts = {
      ...agg.albumCounts,
      [albumKey]: existingAlbum
        ? { ...existingAlbum, count: existingAlbum.count + 1, coverArt: scrobble.song.coverArt ?? existingAlbum.coverArt }
        : { artist: artistName, coverArt: scrobble.song.coverArt ?? undefined, count: 1 },
    };

    const existingSong = agg.songCounts[scrobble.song.id];
    const newSongCounts = {
      ...agg.songCounts,
      [scrobble.song.id]: { song: scrobble.song, count: (existingSong?.count ?? 0) + 1 },
    };

    const genre = getPrimaryGenre(scrobble.song);
    let newGenreCounts = agg.genreCounts;
    if (genre) {
      newGenreCounts = { ...agg.genreCounts, [genre]: (agg.genreCounts[genre] ?? 0) + 1 };
    }

    const newHourBuckets = [...agg.hourBuckets];
    newHourBuckets[new Date(scrobble.time).getHours()]++;

    const dk = aggregateDateKey(scrobble.time);
    const newDayCounts = { ...agg.dayCounts, [dk]: (agg.dayCounts[dk] ?? 0) + 1 };

    set({
      completedScrobbles: [...state.completedScrobbles, scrobble],
      stats: {
        totalPlays: state.stats.totalPlays + 1,
        totalListeningSeconds:
          state.stats.totalListeningSeconds + (scrobble.song.duration ?? 0),
        uniqueArtists: newArtists,
      },
      aggregates: {
        artistCounts: newArtistCounts,
        albumCounts: newAlbumCounts,
        songCounts: newSongCounts,
        genreCounts: newGenreCounts,
        hourBuckets: newHourBuckets,
        dayCounts: newDayCounts,
      },
    });
  },

  rebuildStats: () => {
    const { completedScrobbles } = get();
    set({ stats: buildStats(completedScrobbles) });
  },

  rebuildAggregates: () => {
    const { completedScrobbles } = get();
    set({ aggregates: buildAggregates(completedScrobbles) });
  },

  replaceAll: (scrobbles) => {
    // Dedupe + validate mirror what `hydrateScrobbles` / `insertScrobble`
    // already enforce, so the in-memory array matches what lands on disk.
    const seen = new Set<string>();
    const valid: CompletedScrobble[] = [];
    for (const s of scrobbles) {
      if (!s?.id || !s.song?.id || !s.song.title || seen.has(s.id)) continue;
      seen.add(s.id);
      valid.push(s);
    }
    replaceAllScrobbles(valid);
    set({
      completedScrobbles: valid,
      stats: buildStats(valid),
      aggregates: buildAggregates(valid),
    });
  },

  hydrateFromDb: () => {
    if (get().hasHydrated) return;
    const restored = hydrateScrobbles();
    set({
      completedScrobbles: restored,
      stats: buildStats(restored),
      aggregates: buildAggregates(restored),
      hasHydrated: true,
    });
  },
}));

/**
 * Convenience wrapper that exposes the underlying table clear so
 * `resetAllStores` can wipe disk state alongside the in-memory reset.
 */
export function clearCompletedScrobbleTable(): void {
  clearScrobbles();
}
