import i18n from '../i18n/i18n';
import type { IoniconsName } from '../utils/iconNames';

import {
  getRandomSongs,
  getRandomSongsFiltered,
  getSimilarSongs2,
  type Child,
} from './subsonicService';
import { fetchSimilarSongsOrRandom } from './recommendationService';
import { getOfflineSongsByGenre, getOfflineSongsAll } from './searchService';
import { shuffleArray } from '../utils/arrayHelpers';
import { splitGenreValue } from '../utils/genreHelpers';

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
  icon: IoniconsName;
  gradientColors: [string, string];
  fetchStrategy: FetchStrategy;
}

/* ------------------------------------------------------------------ */
/*  Time-of-day helpers                                                */
/* ------------------------------------------------------------------ */

interface TimeSlot {
  labelKey: string;
  range: [number, number];
}

const TIME_SLOTS: TimeSlot[] = [
  { labelKey: 'earlyMorning', range: [5, 8] },
  { labelKey: 'morning', range: [8, 11] },
  { labelKey: 'midday', range: [11, 14] },
  { labelKey: 'afternoon', range: [14, 17] },
  { labelKey: 'evening', range: [17, 20] },
  { labelKey: 'night', range: [20, 23] },
  { labelKey: 'lateNight', range: [23, 5] },
];

export function getTimeOfDayLabel(hour: number): string {
  for (const slot of TIME_SLOTS) {
    const [start, end] = slot.range;
    if (start < end) {
      if (hour >= start && hour < end) return i18n.t(slot.labelKey);
    } else {
      if (hour >= start || hour < end) return i18n.t(slot.labelKey);
    }
  }
  return i18n.t('lateNight');
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function getDayOfWeek(): string {
  return i18n.t(DAY_KEYS[new Date().getDay()]);
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
  songStats: Record<string, { count: number; year?: number }>,
): { decade: number; fromYear: number; toYear: number } | null {
  const decadeCounts: Record<number, number> = {};

  for (const entry of Object.values(songStats)) {
    const year = entry.year;
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
  songStats: Record<string, { count: number; year?: number }>;
  artistCounts: Record<string, { count: number; artistId?: string }>;
  scrobbles: Array<{ time: number; song: { genre?: string; genres?: unknown[]; artist?: string; artistId?: string } }>;
  /** One random starred song to seed "Favorites Radio", or null when there are none.
   *  A single seed, not the whole set: the mix only ever reads one id + title. */
  favoritesSeed: { id: string; title?: string } | null;
  isOnline: boolean;
  listLength?: number;
}

export function generateMixes(input: GenerateMixesInput): MixDefinition[] {
  const { hourBuckets, genreCounts, songStats, artistCounts, scrobbles, favoritesSeed, isOnline, listLength = 20 } = input;
  const mixes: MixDefinition[] = [];

  // 1. "Right Now" — Time-of-Day Mix (always shown)
  const currentHour = new Date().getHours();
  const timeLabel = getTimeOfDayLabel(currentHour);
  const dayOfWeek = getDayOfWeek();
  const topGenreForHour = getTopGenreForHour(hourBuckets, genreCounts, scrobbles);

  if (topGenreForHour) {
    const subtitle = i18n.t('genreForTimeSlot', { genre: topGenreForHour, dayOfWeek, timeSlot: timeLabel.toLowerCase() });
    mixes.push({
      id: 'right-now',
      name: timeLabel,
      subtitle,
      icon: getTimeIcon(currentHour),
      gradientColors: getTimeGradient(currentHour),
      fetchStrategy: isOnline
        ? { type: 'randomByGenre', genre: topGenreForHour, size: listLength }
        : { type: 'offline', genre: topGenreForHour },
    });
  } else {
    mixes.push({
      id: 'right-now',
      name: timeLabel,
      subtitle: i18n.t('randomMixForTimeSlot', { dayOfWeek, timeSlot: timeLabel.toLowerCase() }),
      icon: getTimeIcon(currentHour),
      gradientColors: getTimeGradient(currentHour),
      fetchStrategy: isOnline
        ? { type: 'random', size: listLength }
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
      .map(([name, val]) => ({ name, artistId: artistIdMap.get(name)!, count: val.count }));

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
          name: i18n.t('deepCuts'),
          subtitle: i18n.t('artistsLikeYouMightLove', { artist: picked.name }),
          icon: 'compass-outline',
          gradientColors: ['#7C3AED', '#4338CA'],
          fetchStrategy: { type: 'similarToArtist', artistId: picked.artistId, count: listLength },
        });
      } else {
        mixes.push({
          id: 'deep-cuts',
          name: i18n.t('surpriseMe'),
          subtitle: i18n.t('randomSelectionFromLibrary'),
          icon: 'shuffle-outline',
          gradientColors: ['#7C3AED', '#4338CA'],
          fetchStrategy: { type: 'random', size: listLength },
        });
      }
    } else {
      mixes.push({
        id: 'deep-cuts',
        name: i18n.t('surpriseMe'),
        subtitle: i18n.t('randomSelectionFromLibrary'),
        icon: 'shuffle-outline',
        gradientColors: ['#7C3AED', '#4338CA'],
        fetchStrategy: { type: 'random', size: listLength },
      });
    }
  }

  // 3. "Time Machine" — Decade Mix (online only)
  if (isOnline) {
    const pickedDecade = getTopDecade(songStats);
    if (pickedDecade) {
      const decadeLabel = `${pickedDecade.decade}s`;
      mixes.push({
        id: 'time-machine',
        name: i18n.t('theDecade', { decade: decadeLabel }),
        subtitle: i18n.t('yourFavoriteEraReshuffled'),
        icon: 'time-outline',
        gradientColors: ['#D97706', '#EA580C'],
        fetchStrategy: {
          type: 'randomByDecade',
          fromYear: pickedDecade.fromYear,
          toYear: pickedDecade.toYear,
          size: listLength,
        },
      });
    } else {
      mixes.push({
        id: 'time-machine',
        name: i18n.t('timeMachine'),
        subtitle: i18n.t('randomSongsAcrossDecades'),
        icon: 'time-outline',
        gradientColors: ['#D97706', '#EA580C'],
        fetchStrategy: { type: 'random', size: listLength },
      });
    }
  }

  // 3b. "Mix It Up" — Completely random songs (always shown)
  mixes.push({
    id: 'mix-it-up',
    name: i18n.t('mixItUp'),
    subtitle: i18n.t('completelyRandomMix'),
    icon: 'shuffle',
    gradientColors: ['#3B82F6', '#6366F1'],
    fetchStrategy: isOnline
      ? { type: 'random', size: listLength }
      : { type: 'offline' },
  });

  // 4. "Favorites Radio" — Based on Starred Songs (online only, needs starred songs)
  if (isOnline && favoritesSeed) {
    mixes.push({
      id: 'favorites-radio',
      name: i18n.t('favoritesRadio'),
      subtitle: i18n.t('inspiredBy', { title: favoritesSeed.title }),
      icon: 'heart',
      gradientColors: ['#E11D48', '#DB2777'],
      fetchStrategy: { type: 'similarToSong', songId: favoritesSeed.id, count: listLength },
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
      subtitle: i18n.t('crossoverOfTopGenres'),
      icon: 'git-merge-outline',
      gradientColors: ['#059669', '#0D9488'],
      fetchStrategy: isOnline
        ? {
            type: 'multiGenreBlend',
            genres: [
              { name: genre1, size: Math.ceil(listLength / 2) },
              { name: genre2, size: Math.ceil(listLength / 2) },
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
    .slice(0, listLength)
    .map((entry) => entry.song);

  if (heavyRotationSongs.length >= 5) {
    mixes.push({
      id: 'heavy-rotation',
      name: i18n.t('heavyRotation'),
      subtitle: i18n.t('mostPlayedThisWeek'),
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

/**
 * Resolve songs for one genre[+era] slot. Primary is a random pull for the
 * genre; if that comes back empty and the genre is a compound tag (e.g.
 * "Folk, World, & Country"), retry each split part and merge — a server that
 * stores split single-value genres can't match the joined string. Era-only
 * slots (no genre) make exactly one call.
 */
export async function resolveGenreSlot(
  genre: string | undefined,
  era: { fromYear?: number; toYear?: number },
  size: number,
): Promise<Child[]> {
  const primary = await getRandomSongsFiltered({
    size,
    genre,
    fromYear: era.fromYear,
    toYear: era.toYear,
  });
  if (primary && primary.length > 0) return primary;
  const parts = genre ? splitGenreValue(genre) : [];
  if (parts.length <= 1) return primary ?? [];
  const batches = await Promise.all(
    parts.map((p) =>
      getRandomSongsFiltered({ size, genre: p, fromYear: era.fromYear, toYear: era.toYear })
        .then((s) => s ?? [])
        .catch(() => []),
    ),
  );
  return batches.flat();
}

export async function fetchMixSongs(strategy: FetchStrategy, listLength = 20): Promise<Child[]> {
  try {
    switch (strategy.type) {
      case 'randomByGenre': {
        // await (not bare return) so a rejection is caught by the outer
        // try/catch below and falls back to random.
        return await resolveGenreSlot(strategy.genre, {}, strategy.size);
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
        return (await getRandomSongs(listLength)) ?? [];
      }
      case 'similarToSong': {
        const songs = await fetchSimilarSongsOrRandom(strategy.songId, strategy.count);
        return shuffleArray([...songs]);
      }
      case 'multiGenreBlend': {
        const results: Child[] = [];
        for (const g of strategy.genres) {
          results.push(...(await resolveGenreSlot(g.name, {}, g.size)));
        }
        return shuffleArray(results).slice(0, listLength);
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
          return shuffleArray([...songs]).slice(0, listLength);
        }
        // No genre filter — get all offline songs and shuffle
        const songs = getOfflineSongsAll();
        return shuffleArray([...songs]).slice(0, listLength);
      }
    }
  } catch {
    // Last resort fallback
    try {
      return (await getRandomSongs(listLength)) ?? [];
    } catch {
      return [];
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Custom mix builder                                                 */
/* ------------------------------------------------------------------ */

/** A selected era. Both bounds undefined means "any era". */
export interface DecadeRange {
  fromYear?: number;
  toYear?: number;
}

export async function fetchCustomMix(
  genres: string[],
  decades: DecadeRange[],
  isOnline = true,
  listLength = 20,
): Promise<Child[]> {
  // Only ranges with real bounds constrain the era; ignore "any" entries.
  const ranges = decades.filter(
    (d) => d.fromYear !== undefined && d.toYear !== undefined,
  );

  if (!isOnline) {
    let pool: Child[] = [];
    if (genres.length === 0) {
      pool = [...getOfflineSongsAll()];
    } else {
      for (const genre of genres) pool.push(...getOfflineSongsByGenre(genre));
    }
    // Decades can be non-contiguous (e.g. 70s + 90s), so filter the offline
    // pool client-side against any selected range rather than a single window.
    if (ranges.length > 0) {
      pool = pool.filter(
        (s) =>
          s.year != null &&
          ranges.some((r) => s.year! >= r.fromYear! && s.year! <= r.toYear!),
      );
    }
    return shuffleArray(pool).slice(0, listLength);
  }

  // Online: fan out across the genre × era cross-product. Each axis falls
  // back to a single "any" slot so genre-only, era-only, and both work the
  // same way. Non-contiguous decades each get their own server query.
  const genreSlots: (string | undefined)[] = genres.length > 0 ? genres : [undefined];
  const eraSlots: DecadeRange[] = ranges.length > 0 ? ranges : [{}];

  const combos: Array<{ genre?: string } & DecadeRange> = [];
  for (const genre of genreSlots) {
    for (const era of eraSlots) {
      combos.push({ genre, fromYear: era.fromYear, toYear: era.toYear });
    }
  }

  const perCombo = Math.max(1, Math.ceil(listLength / combos.length));
  const batches = await Promise.all(
    combos.map((c) =>
      resolveGenreSlot(c.genre, { fromYear: c.fromYear, toYear: c.toYear }, perCombo).catch(() => []),
    ),
  );
  return shuffleArray(batches.flat()).slice(0, listLength);
}

/* ------------------------------------------------------------------ */
/*  Visual helpers                                                     */
/* ------------------------------------------------------------------ */

export function getTimeIcon(hour: number): IoniconsName {
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

export interface BuilderDecade {
  /** Stable identity + default display string. */
  label: string;
  /** i18n key for word labels (Earlier/Recent); numeric decades render `label`. */
  i18nKey?: string;
  /** Both undefined means "any era". */
  fromYear?: number;
  toYear?: number;
}

// "Recent" tracks the rolling last ~5 years, so its range is resolved at module
// load from the current year rather than hard-coded.
const CURRENT_YEAR = new Date().getFullYear();

export const DECADES: BuilderDecade[] = [
  { label: 'Any', fromYear: undefined, toYear: undefined },
  { label: 'Earlier', i18nKey: 'decadeEarlier', fromYear: 0, toYear: 1949 },
  { label: '50s', fromYear: 1950, toYear: 1959 },
  { label: '60s', fromYear: 1960, toYear: 1969 },
  { label: '70s', fromYear: 1970, toYear: 1979 },
  { label: '80s', fromYear: 1980, toYear: 1989 },
  { label: '90s', fromYear: 1990, toYear: 1999 },
  { label: '00s', fromYear: 2000, toYear: 2009 },
  { label: '10s', fromYear: 2010, toYear: 2019 },
  { label: '20s', fromYear: 2020, toYear: 2029 },
  { label: 'Recent', i18nKey: 'decadeRecent', fromYear: CURRENT_YEAR - 4, toYear: CURRENT_YEAR + 1 },
];

/** Decades the builder offers as multi-select pills — drops the "Any" sentinel
    (no decades selected already means "any era", mirroring genres). */
export const SELECTABLE_DECADES: BuilderDecade[] = DECADES.filter(
  (d) => d.fromYear !== undefined,
);

/** Map selected decade labels to the year ranges `fetchCustomMix` expects. */
export function decadeRangesForLabels(labels: string[]): DecadeRange[] {
  return SELECTABLE_DECADES.filter((d) => labels.includes(d.label)).map((d) => ({
    fromYear: d.fromYear,
    toYear: d.toYear,
  }));
}
