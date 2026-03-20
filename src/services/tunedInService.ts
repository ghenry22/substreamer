import { type Ionicons } from '@expo/vector-icons';

import {
  getRandomSongs,
  getRandomSongsFiltered,
  getSimilarSongs,
  getSimilarSongs2,
  type Child,
} from './subsonicService';
import { getOfflineSongsByGenre } from './searchService';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type FetchStrategy =
  | { type: 'randomByGenre'; genre: string; size: number }
  | { type: 'randomByDecade'; fromYear: number; toYear: number; size: number }
  | { type: 'similarToArtist'; artistId: string; count: number }
  | { type: 'similarToSong'; songId: string; count: number }
  | { type: 'multiGenreBlend'; genres: { name: string; size: number }[] }
  | { type: 'random'; size: number }
  | { type: 'offline'; genre?: string }
  | { type: 'recentTopSongs'; songs: Child[] };

export interface MixDefinition {
  id: string;
  name: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  gradientColors: [string, string];
  fetchStrategy: FetchStrategy;
}

/* ------------------------------------------------------------------ */
/*  Time-of-day helpers                                                */
/* ------------------------------------------------------------------ */

interface TimeSlot {
  label: string;
  range: [number, number];
}

const TIME_SLOTS: TimeSlot[] = [
  { label: 'Early Morning', range: [5, 8] },
  { label: 'Morning', range: [8, 11] },
  { label: 'Midday', range: [11, 14] },
  { label: 'Afternoon', range: [14, 17] },
  { label: 'Evening', range: [17, 20] },
  { label: 'Night', range: [20, 23] },
  { label: 'Late Night', range: [23, 5] },
];

export function getTimeOfDayLabel(hour: number): string {
  for (const slot of TIME_SLOTS) {
    const [start, end] = slot.range;
    if (start < end) {
      if (hour >= start && hour < end) return slot.label;
    } else {
      if (hour >= start || hour < end) return slot.label;
    }
  }
  return 'Late Night';
}

function getDayOfWeek(): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date().getDay()
  ];
}

/**
 * Derive the genre the user most listens to around the current hour.
 * Cross-references hour buckets with scrobble data to find genre affinity
 * for the current time window (+/- 1 hour).
 */
export function getTopGenreForHour(
  hourBuckets: number[],
  genreCounts: Record<string, number>,
  scrobbles: Array<{ time: number; song: { genre?: string; genres?: unknown[] } }>,
): string | null {
  const currentHour = new Date().getHours();

  // Build genre counts for the current time window (+/- 1 hour)
  const windowHours = new Set([
    (currentHour - 1 + 24) % 24,
    currentHour,
    (currentHour + 1) % 24,
  ]);

  const genreCountsForWindow: Record<string, number> = {};
  for (const s of scrobbles) {
    const hour = new Date(s.time).getHours();
    if (!windowHours.has(hour)) continue;
    const genre = extractPrimaryGenre(s.song);
    if (genre) {
      genreCountsForWindow[genre] = (genreCountsForWindow[genre] ?? 0) + 1;
    }
  }

  // If we have time-specific genre data, use it
  const windowEntries = Object.entries(genreCountsForWindow).sort(([, a], [, b]) => b - a);
  if (windowEntries.length > 0) {
    return windowEntries[0][0];
  }

  // Fallback: use overall top genre
  const topGenre = Object.entries(genreCounts).sort(([, a], [, b]) => b - a);
  return topGenre.length > 0 ? topGenre[0][0] : null;
}

function extractPrimaryGenre(song: { genre?: string; genres?: unknown[] }): string | null {
  if (song.genres && Array.isArray(song.genres) && song.genres.length > 0) {
    const first = song.genres[0];
    if (typeof first === 'string') return first;
    if (first != null && typeof first === 'object' && 'name' in first) {
      return (first as { name: string }).name;
    }
  }
  return song.genre ?? null;
}

/* ------------------------------------------------------------------ */
/*  Decade detection                                                   */
/* ------------------------------------------------------------------ */

export function getTopDecade(
  songCounts: Record<string, { song: Child; count: number }>,
): { decade: number; fromYear: number; toYear: number } | null {
  const decadeCounts: Record<number, number> = {};

  for (const entry of Object.values(songCounts)) {
    const year = entry.song.year;
    if (!year || year < 1950) continue;
    const decade = Math.floor(year / 10) * 10;
    decadeCounts[decade] = (decadeCounts[decade] ?? 0) + entry.count;
  }

  const decadeCandidates = Object.entries(decadeCounts)
    .map(([d, count]) => ({ decade: Number(d), count }));

  if (decadeCandidates.length === 0) return null;

  // Compress weights with sqrt so the top decade doesn't dominate.
  // e.g. counts 100/10/5 become weights ~10/3.2/2.2 instead of 100/10/5.
  const softened = decadeCandidates.map((c) => ({ ...c, weight: Math.sqrt(c.count) }));

  // Include the generic "Time Machine" (null) weighted at the average
  // so it occasionally appears even when decade data exists.
  const avgWeight = softened.reduce((sum, c) => sum + c.weight, 0) / softened.length;
  const candidates: { decade: number | null; weight: number }[] = [
    ...softened,
    { decade: null, weight: avgWeight },
  ];

  // Weighted random selection — more-listened decades still appear more
  // often but the gap between top and bottom is narrower
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = Math.random() * totalWeight;
  let picked = candidates[0];
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) {
      picked = c;
      break;
    }
  }

  if (picked.decade === null) return null;
  return { decade: picked.decade, fromYear: picked.decade, toYear: picked.decade + 9 };
}

/* ------------------------------------------------------------------ */
/*  Mix generation (pure function)                                     */
/* ------------------------------------------------------------------ */

interface GenerateMixesInput {
  hourBuckets: number[];
  genreCounts: Record<string, number>;
  songCounts: Record<string, { song: Child; count: number }>;
  artistCounts: Record<string, number>;
  scrobbles: Array<{ time: number; song: { genre?: string; genres?: unknown[]; artist?: string; artistId?: string } }>;
  starredSongs: Child[];
  isOnline: boolean;
}

export function generateMixes(input: GenerateMixesInput): MixDefinition[] {
  const { hourBuckets, genreCounts, songCounts, artistCounts, scrobbles, starredSongs, isOnline } = input;
  const mixes: MixDefinition[] = [];

  // 1. "Right Now" — Time-of-Day Mix (always shown)
  const currentHour = new Date().getHours();
  const timeLabel = getTimeOfDayLabel(currentHour);
  const dayOfWeek = getDayOfWeek();
  const topGenreForHour = getTopGenreForHour(hourBuckets, genreCounts, scrobbles);

  if (topGenreForHour) {
    const subtitle = `${topGenreForHour} for your ${dayOfWeek} ${timeLabel.toLowerCase()}`;
    mixes.push({
      id: 'right-now',
      name: timeLabel,
      subtitle,
      icon: getTimeIcon(currentHour),
      gradientColors: getTimeGradient(currentHour),
      fetchStrategy: isOnline
        ? { type: 'randomByGenre', genre: topGenreForHour, size: 20 }
        : { type: 'offline', genre: topGenreForHour },
    });
  } else {
    mixes.push({
      id: 'right-now',
      name: timeLabel,
      subtitle: `A random mix for your ${dayOfWeek} ${timeLabel.toLowerCase()}`,
      icon: getTimeIcon(currentHour),
      gradientColors: getTimeGradient(currentHour),
      fetchStrategy: isOnline
        ? { type: 'random', size: 20 }
        : { type: 'offline' },
    });
  }

  // 2. "Deep Cuts" — Similar Artist Discovery (online only)
  if (isOnline) {
    // Build weighted artist candidates from those with an artistId in scrobbles
    const artistIdMap = new Map<string, string>();
    for (const s of scrobbles) {
      if (s.song.artist && s.song.artistId && !artistIdMap.has(s.song.artist)) {
        artistIdMap.set(s.song.artist, s.song.artistId);
      }
    }

    const artistCandidates = Object.entries(artistCounts)
      .filter(([name]) => artistIdMap.has(name))
      .map(([name, count]) => ({ name, artistId: artistIdMap.get(name)!, count }));

    if (artistCandidates.length > 0) {
      // Include "Surprise Me" fallback weighted at the average
      const avgCount = artistCandidates.reduce((sum, c) => sum + c.count, 0) / artistCandidates.length;
      const pool: { name: string | null; artistId: string | null; count: number }[] = [
        ...artistCandidates,
        { name: null, artistId: null, count: avgCount },
      ];

      const totalWeight = pool.reduce((sum, c) => sum + c.count, 0);
      let roll = Math.random() * totalWeight;
      let picked = pool[0];
      for (const c of pool) {
        roll -= c.count;
        if (roll <= 0) { picked = c; break; }
      }

      if (picked.artistId) {
        mixes.push({
          id: 'deep-cuts',
          name: 'Deep Cuts',
          subtitle: `Artists like ${picked.name} you might love`,
          icon: 'compass-outline',
          gradientColors: ['#7C3AED', '#4338CA'],
          fetchStrategy: { type: 'similarToArtist', artistId: picked.artistId, count: 20 },
        });
      } else {
        mixes.push({
          id: 'deep-cuts',
          name: 'Surprise Me',
          subtitle: 'A random selection from your library',
          icon: 'shuffle-outline',
          gradientColors: ['#7C3AED', '#4338CA'],
          fetchStrategy: { type: 'random', size: 20 },
        });
      }
    } else {
      mixes.push({
        id: 'deep-cuts',
        name: 'Surprise Me',
        subtitle: 'A random selection from your library',
        icon: 'shuffle-outline',
        gradientColors: ['#7C3AED', '#4338CA'],
        fetchStrategy: { type: 'random', size: 20 },
      });
    }
  }

  // 3. "Time Machine" — Decade Mix (online only)
  if (isOnline) {
    const pickedDecade = getTopDecade(songCounts);
    if (pickedDecade) {
      const decadeLabel = `${pickedDecade.decade}s`;
      mixes.push({
        id: 'time-machine',
        name: `The ${decadeLabel}`,
        subtitle: 'Your favorite era, reshuffled',
        icon: 'time-outline',
        gradientColors: ['#D97706', '#EA580C'],
        fetchStrategy: {
          type: 'randomByDecade',
          fromYear: pickedDecade.fromYear,
          toYear: pickedDecade.toYear,
          size: 20,
        },
      });
    } else {
      mixes.push({
        id: 'time-machine',
        name: 'Time Machine',
        subtitle: 'Random songs from across the decades',
        icon: 'time-outline',
        gradientColors: ['#D97706', '#EA580C'],
        fetchStrategy: { type: 'random', size: 20 },
      });
    }
  }

  // 4. "Favorites Radio" — Based on Starred Songs (online only, needs starred songs)
  if (isOnline && starredSongs.length > 0) {
    const randomStar = starredSongs[Math.floor(Math.random() * starredSongs.length)];
    mixes.push({
      id: 'favorites-radio',
      name: 'Favorites Radio',
      subtitle: `Inspired by ${randomStar.title}`,
      icon: 'heart',
      gradientColors: ['#E11D48', '#DB2777'],
      fetchStrategy: { type: 'similarToSong', songId: randomStar.id, count: 20 },
    });
  }

  // 5. "Genre Blend" — Cross-Genre Mix (needs 2+ genres)
  const topGenres = Object.entries(genreCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([genre]) => genre);

  if (topGenres.length >= 2) {
    const genre1 = topGenres[0];
    const genre2 = topGenres[1];
    mixes.push({
      id: 'genre-blend',
      name: `${genre1} \u00D7 ${genre2}`,
      subtitle: 'A crossover of your top genres',
      icon: 'git-merge-outline',
      gradientColors: ['#059669', '#0D9488'],
      fetchStrategy: isOnline
        ? {
            type: 'multiGenreBlend',
            genres: [
              { name: genre1, size: 10 },
              { name: genre2, size: 10 },
            ],
          }
        : { type: 'offline', genre: genre1 },
    });
  }

  // 6. "Heavy Rotation" — Most played songs in last 7 days (local data only)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCounts = new Map<string, { song: Child; count: number }>();
  for (const s of scrobbles) {
    if (s.time < sevenDaysAgo) continue;
    const song = s.song as Child;
    if (!song.id) continue;
    const existing = recentCounts.get(song.id);
    if (existing) {
      existing.count += 1;
    } else {
      recentCounts.set(song.id, { song, count: 1 });
    }
  }

  const heavyRotationSongs = [...recentCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((entry) => entry.song);

  if (heavyRotationSongs.length >= 5) {
    mixes.push({
      id: 'heavy-rotation',
      name: 'Heavy Rotation',
      subtitle: 'Your most played this week',
      icon: 'repeat',
      gradientColors: ['#6366F1', '#4F46E5'],
      fetchStrategy: { type: 'recentTopSongs', songs: heavyRotationSongs },
    });
  }

  return mixes;
}

/* ------------------------------------------------------------------ */
/*  Fetch execution                                                    */
/* ------------------------------------------------------------------ */

function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function fetchMixSongs(strategy: FetchStrategy): Promise<Child[]> {
  try {
    switch (strategy.type) {
      case 'randomByGenre': {
        const songs = await getRandomSongsFiltered({ size: strategy.size, genre: strategy.genre });
        return songs ?? [];
      }
      case 'randomByDecade': {
        const songs = await getRandomSongsFiltered({
          size: strategy.size,
          fromYear: strategy.fromYear,
          toYear: strategy.toYear,
        });
        return songs ?? [];
      }
      case 'similarToArtist': {
        const songs = await getSimilarSongs2(strategy.artistId, strategy.count);
        if (songs.length > 0) return shuffleArray([...songs]);
        // Fallback to random
        return (await getRandomSongs(20)) ?? [];
      }
      case 'similarToSong': {
        const songs = await getSimilarSongs(strategy.songId, strategy.count);
        if (songs.length > 0) return shuffleArray([...songs]);
        // Fallback to random
        return (await getRandomSongs(20)) ?? [];
      }
      case 'multiGenreBlend': {
        const results: Child[] = [];
        for (const g of strategy.genres) {
          const songs = await getRandomSongsFiltered({ size: g.size, genre: g.name });
          if (songs) results.push(...songs);
        }
        return shuffleArray(results);
      }
      case 'random': {
        return (await getRandomSongs(strategy.size)) ?? [];
      }
      case 'recentTopSongs': {
        return strategy.songs;
      }
      case 'offline': {
        if (strategy.genre) {
          const songs = getOfflineSongsByGenre(strategy.genre);
          return shuffleArray([...songs]);
        }
        // No genre filter — get all offline songs and shuffle
        const songs = getOfflineSongsByGenre('');
        return shuffleArray([...songs]).slice(0, 20);
      }
    }
  } catch {
    // Last resort fallback
    try {
      return (await getRandomSongs(20)) ?? [];
    } catch {
      return [];
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Custom mix builder                                                 */
/* ------------------------------------------------------------------ */

export async function fetchCustomMix(
  genres: string[],
  fromYear?: number,
  toYear?: number,
  isOnline = true,
): Promise<Child[]> {
  if (!isOnline) {
    const results: Child[] = [];
    for (const genre of genres) {
      const songs = getOfflineSongsByGenre(genre);
      results.push(...songs);
    }
    return shuffleArray(results).slice(0, 20);
  }

  if (genres.length === 1) {
    const songs = await getRandomSongsFiltered({
      size: 20,
      genre: genres[0],
      fromYear,
      toYear,
    });
    return songs ?? [];
  }

  // Multiple genres: split evenly
  const perGenre = Math.ceil(20 / genres.length);
  const results: Child[] = [];
  for (const genre of genres) {
    const songs = await getRandomSongsFiltered({
      size: perGenre,
      genre,
      fromYear,
      toYear,
    });
    if (songs) results.push(...songs);
  }
  return shuffleArray(results);
}

/* ------------------------------------------------------------------ */
/*  Visual helpers                                                     */
/* ------------------------------------------------------------------ */

export function getTimeIcon(hour: number): keyof typeof Ionicons.glyphMap {
  if (hour >= 5 && hour < 8) return 'sunny-outline';
  if (hour >= 8 && hour < 17) return 'sunny';
  if (hour >= 17 && hour < 20) return 'partly-sunny-outline';
  return 'moon-outline';
}

export function getTimeGradient(hour: number): [string, string] {
  if (hour >= 5 && hour < 8) return ['#F59E0B', '#F97316'];
  if (hour >= 8 && hour < 11) return ['#F97316', '#3B82F6'];
  if (hour >= 11 && hour < 14) return ['#3B82F6', '#2563EB'];
  if (hour >= 14 && hour < 17) return ['#2563EB', '#0EA5E9'];
  if (hour >= 17 && hour < 20) return ['#F97316', '#DC2626'];
  if (hour >= 20 && hour < 23) return ['#6366F1', '#4F46E5'];
  return ['#312E81', '#1E1B4B'];
}

/* ------------------------------------------------------------------ */
/*  Decade definitions for the builder                                 */
/* ------------------------------------------------------------------ */

export const DECADES = [
  { label: 'Any', fromYear: undefined, toYear: undefined },
  { label: '70s', fromYear: 1970, toYear: 1979 },
  { label: '80s', fromYear: 1980, toYear: 1989 },
  { label: '90s', fromYear: 1990, toYear: 1999 },
  { label: '00s', fromYear: 2000, toYear: 2009 },
  { label: '10s', fromYear: 2010, toYear: 2019 },
  { label: '20s', fromYear: 2020, toYear: 2029 },
] as const;
