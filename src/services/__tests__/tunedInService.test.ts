import {
  DECADES,
  fetchCustomMix,
  fetchMixSongs,
  generateMixes,
  getTimeGradient,
  getTimeIcon,
  getTimeOfDayLabel,
  getTopDecade,
  getTopGenreForHour,
  resolveGenreSlot,
} from '../tunedInService';
import * as arrayHelpers from '../../utils/arrayHelpers';
import { type Child } from '../subsonicService';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetRandomSongs = jest.fn();
const mockGetRandomSongsFiltered = jest.fn();
const mockGetSimilarSongs2 = jest.fn();
const mockFetchSimilarSongsOrRandom = jest.fn();

jest.mock('../subsonicService', () => ({
  getRandomSongs: (...args: unknown[]) => mockGetRandomSongs(...args),
  getRandomSongsFiltered: (...args: unknown[]) => mockGetRandomSongsFiltered(...args),
  getSimilarSongs2: (...args: unknown[]) => mockGetSimilarSongs2(...args),
}));

jest.mock('../recommendationService', () => ({
  fetchSimilarSongsOrRandom: (...args: unknown[]) => mockFetchSimilarSongsOrRandom(...args),
}));

const mockGetOfflineSongsByGenre = jest.fn();
const mockGetOfflineSongsAll = jest.fn();

jest.mock('../searchService', () => ({
  getOfflineSongsByGenre: (...args: unknown[]) => mockGetOfflineSongsByGenre(...args),
  getOfflineSongsAll: (...args: unknown[]) => mockGetOfflineSongsAll(...args),
}));

beforeEach(() => {
  mockGetRandomSongs.mockReset();
  mockGetRandomSongsFiltered.mockReset();
  mockGetSimilarSongs2.mockReset();
  mockFetchSimilarSongsOrRandom.mockReset();
  mockGetOfflineSongsByGenre.mockReset();
  mockGetOfflineSongsAll.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeSong(overrides: Partial<Child> = {}): Child {
  return {
    id: overrides.id ?? 'song-1',
    title: overrides.title ?? 'Test Song',
    artist: overrides.artist ?? 'Test Artist',
    isDir: false,
    ...overrides,
  } as Child;
}

/* ------------------------------------------------------------------ */
/*  getTimeOfDayLabel                                                  */
/* ------------------------------------------------------------------ */

describe('getTimeOfDayLabel', () => {
  it('returns "Early Morning" for hours 5-7', () => {
    expect(getTimeOfDayLabel(5)).toBe('Early Morning');
    expect(getTimeOfDayLabel(7)).toBe('Early Morning');
  });

  it('returns "Morning" for hours 8-10', () => {
    expect(getTimeOfDayLabel(8)).toBe('Morning');
    expect(getTimeOfDayLabel(10)).toBe('Morning');
  });

  it('returns "Midday" for hours 11-13', () => {
    expect(getTimeOfDayLabel(11)).toBe('Midday');
    expect(getTimeOfDayLabel(13)).toBe('Midday');
  });

  it('returns "Afternoon" for hours 14-16', () => {
    expect(getTimeOfDayLabel(14)).toBe('Afternoon');
    expect(getTimeOfDayLabel(16)).toBe('Afternoon');
  });

  it('returns "Evening" for hours 17-19', () => {
    expect(getTimeOfDayLabel(17)).toBe('Evening');
    expect(getTimeOfDayLabel(19)).toBe('Evening');
  });

  it('returns "Night" for hours 20-22', () => {
    expect(getTimeOfDayLabel(20)).toBe('Night');
    expect(getTimeOfDayLabel(22)).toBe('Night');
  });

  it('returns "Late Night" for hours 23-4', () => {
    expect(getTimeOfDayLabel(23)).toBe('Late Night');
    expect(getTimeOfDayLabel(0)).toBe('Late Night');
    expect(getTimeOfDayLabel(3)).toBe('Late Night');
    expect(getTimeOfDayLabel(4)).toBe('Late Night');
  });
});

/* ------------------------------------------------------------------ */
/*  getTopGenreForHour                                                 */
/* ------------------------------------------------------------------ */

describe('getTopGenreForHour', () => {
  it('returns genre from time-window scrobbles when available', () => {
    const currentHour = new Date().getHours();
    const scrobbles = [
      { time: new Date().setHours(currentHour, 0, 0, 0), song: { genre: 'Rock' } },
      { time: new Date().setHours(currentHour, 15, 0, 0), song: { genre: 'Rock' } },
      { time: new Date().setHours(currentHour, 30, 0, 0), song: { genre: 'Jazz' } },
    ];

    const result = getTopGenreForHour(
      new Array(24).fill(0),
      { Rock: 5, Jazz: 10 },
      scrobbles,
    );
    expect(result).toBe('Rock');
  });

  it('falls back to overall top genre when no time-window data', () => {
    const result = getTopGenreForHour(
      new Array(24).fill(0),
      { Rock: 5, Jazz: 10, Pop: 3 },
      [],
    );
    expect(result).toBe('Jazz');
  });

  it('returns null when no genres at all', () => {
    const result = getTopGenreForHour(
      new Array(24).fill(0),
      {},
      [],
    );
    expect(result).toBeNull();
  });

  it('handles genres array with {name} objects', () => {
    const currentHour = new Date().getHours();
    const scrobbles = [
      {
        time: new Date().setHours(currentHour, 0, 0, 0),
        song: { genres: [{ name: 'Electronic' }] },
      },
    ];

    const result = getTopGenreForHour(
      new Array(24).fill(0),
      {},
      scrobbles,
    );
    expect(result).toBe('Electronic');
  });
});

/* ------------------------------------------------------------------ */
/*  getTopDecade                                                       */
/* ------------------------------------------------------------------ */

describe('getTopDecade', () => {
  it('returns a valid decade or null from the candidates (weighted random)', () => {
    const songStats = {
      s1: { year: 1992, count: 5 },
      s2: { year: 1995, count: 8 },
      s3: { year: 2005, count: 3 },
    };
    // Run multiple times to account for randomness
    const decades = new Set<number | null>();
    for (let i = 0; i < 100; i++) {
      const result = getTopDecade(songStats);
      decades.add(result?.decade ?? null);
    }
    // Should only produce valid candidates or null (generic fallback)
    for (const d of decades) {
      if (d !== null) expect([1990, 2000]).toContain(d);
    }
  });

  it('returns null when no songs have year data', () => {
    const songStats = {
      s1: { count: 5 },
      s2: { count: 3 },
    };
    expect(getTopDecade(songStats)).toBeNull();
  });

  it('returns null for empty song counts', () => {
    expect(getTopDecade({})).toBeNull();
  });

  it('ignores songs with year < 1950', () => {
    const songStats = {
      s1: { year: 1920, count: 100 },
      s2: { year: 2010, count: 2 },
    };
    // Only the 2010s is valid; null (generic fallback) also possible
    const result = getTopDecade(songStats);
    if (result !== null) {
      expect(result).toEqual({ decade: 2010, fromYear: 2010, toYear: 2019 });
    }
  });

  it('returns a valid decade or null when counts are tied', () => {
    const songStats = {
      s1: { year: 1985, count: 5 },
      s2: { year: 1995, count: 5 },
    };
    const result = getTopDecade(songStats);
    if (result !== null) {
      expect([1980, 1990]).toContain(result.decade);
      expect(result.toYear - result.fromYear).toBe(9);
    }
  });

  it('favors higher-count decades over many runs', () => {
    const songStats = {
      s1: { year: 1992, count: 100 },
      s2: { year: 2005, count: 1 },
    };
    const results = new Map<string, number>();
    for (let i = 0; i < 500; i++) {
      const r = getTopDecade(songStats);
      const key = r?.decade?.toString() ?? 'null';
      results.set(key, (results.get(key) ?? 0) + 1);
    }
    // 1990s should appear far more often than 2000s
    expect(results.get('1990')!).toBeGreaterThan(results.get('2000') ?? 0);
  });

  it('sometimes returns null (generic fallback) even when decades exist', () => {
    const songStats = {
      s1: { year: 1992, count: 10 },
      s2: { year: 2005, count: 10 },
    };
    let nullCount = 0;
    for (let i = 0; i < 500; i++) {
      if (getTopDecade(songStats) === null) nullCount++;
    }
    // Generic fallback should appear sometimes but not dominate
    expect(nullCount).toBeGreaterThan(0);
    expect(nullCount).toBeLessThan(400);
  });
});

/* ------------------------------------------------------------------ */
/*  generateMixes                                                      */
/* ------------------------------------------------------------------ */

describe('generateMixes', () => {
  const baseInput = {
    hourBuckets: new Array(24).fill(0),
    genreCounts: {} as Record<string, number>,
    songStats: {} as Record<string, { count: number; year?: number }>,
    artistCounts: {} as Record<string, { count: number; artistId?: string }>,
    scrobbles: [] as any[],
    favoritesSeed: null as { id: string; title?: string } | null,
    isOnline: true,
  };

  it('always returns "Right Now" as first card and includes "Mix It Up"', () => {
    const mixes = generateMixes(baseInput);
    expect(mixes.length).toBeGreaterThanOrEqual(2);
    expect(mixes[0].id).toBe('right-now');
    expect(mixes.map((m) => m.id)).toContain('mix-it-up');
  });

  it('includes Deep Cuts, Time Machine when online', () => {
    const mixes = generateMixes(baseInput);
    const ids = mixes.map((m) => m.id);
    expect(ids).toContain('deep-cuts');
    expect(ids).toContain('time-machine');
  });

  it('uses "Surprise Me" fallback for deep cuts when no artist data', () => {
    const mixes = generateMixes(baseInput);
    const deepCuts = mixes.find((m) => m.id === 'deep-cuts')!;
    expect(deepCuts.name).toBe('Surprise Me');
    expect(deepCuts.fetchStrategy.type).toBe('random');
  });

  it('uses similarToArtist or Surprise Me when artist has artistId (weighted random)', () => {
    const input = {
      ...baseInput,
      artistCounts: { 'Pink Floyd': { count: 20, artistId: 'ar-1' } },
      scrobbles: [
        { time: Date.now(), song: { artist: 'Pink Floyd', artistId: 'ar-1', genre: 'Rock' } },
      ],
    };
    const mixes = generateMixes(input);
    const deepCuts = mixes.find((m) => m.id === 'deep-cuts')!;
    // Weighted random: could be the artist or the generic fallback
    if (deepCuts.fetchStrategy.type === 'similarToArtist') {
      expect(deepCuts.fetchStrategy).toEqual({
        type: 'similarToArtist',
        artistId: 'ar-1',
        count: 20, // default listLength
      });
      expect(deepCuts.subtitle).toContain('Pink Floyd');
    } else {
      expect(deepCuts.name).toBe('Surprise Me');
      expect(deepCuts.fetchStrategy.type).toBe('random');
    }
  });

  it('includes Time Machine when song history has years', () => {
    const input = {
      ...baseInput,
      songStats: {
        s1: { year: 1985, count: 10 },
        s2: { year: 1988, count: 8 },
      },
    };
    const mixes = generateMixes(input);
    const timeMachine = mixes.find((m) => m.id === 'time-machine')!;
    expect(timeMachine).toBeDefined();
    // Weighted random: could be a specific decade or the generic fallback
    if (timeMachine.name === 'The 1980s') {
      expect(timeMachine.fetchStrategy).toEqual({
        type: 'randomByDecade',
        fromYear: 1980,
        toYear: 1989,
        size: 20,
      });
    } else {
      expect(timeMachine.name).toBe('Time Machine');
      expect(timeMachine.fetchStrategy).toEqual({ type: 'random', size: 20 });
    }
  });

  it('excludes Favorites Radio when no starred songs', () => {
    const mixes = generateMixes(baseInput);
    expect(mixes.find((m) => m.id === 'favorites-radio')).toBeUndefined();
  });

  it('includes Favorites Radio when starred songs exist (online)', () => {
    const input = {
      ...baseInput,
      favoritesSeed: { id: 'fav-1', title: 'My Fav Song' },
    };
    const mixes = generateMixes(input);
    const favRadio = mixes.find((m) => m.id === 'favorites-radio')!;
    expect(favRadio).toBeDefined();
    expect(favRadio.fetchStrategy.type).toBe('similarToSong');
    expect(favRadio.subtitle).toContain('My Fav Song');
  });

  it('excludes Genre Blend when fewer than 2 genres', () => {
    const input = {
      ...baseInput,
      genreCounts: { Rock: 10 },
    };
    const mixes = generateMixes(input);
    expect(mixes.find((m) => m.id === 'genre-blend')).toBeUndefined();
  });

  it('includes Genre Blend when 2+ genres in history', () => {
    const input = {
      ...baseInput,
      genreCounts: { Rock: 10, Jazz: 8, Pop: 3 },
    };
    const mixes = generateMixes(input);
    const blend = mixes.find((m) => m.id === 'genre-blend')!;
    expect(blend).toBeDefined();
    expect(blend.name).toContain('Rock');
    expect(blend.name).toContain('Jazz');
    expect(blend.fetchStrategy.type).toBe('multiGenreBlend');
  });

  it('uses offline strategies when not online', () => {
    const input = {
      ...baseInput,
      isOnline: false,
      genreCounts: { Rock: 10, Jazz: 5 },
    };
    const mixes = generateMixes(input);
    const ids = mixes.map((m) => m.id);

    // Deep Cuts and Time Machine are excluded offline
    expect(ids).not.toContain('deep-cuts');
    expect(ids).not.toContain('time-machine');

    // Right Now uses offline strategy
    const rightNow = mixes.find((m) => m.id === 'right-now')!;
    expect(rightNow.fetchStrategy.type).toBe('offline');

    // Genre Blend uses offline strategy
    const blend = mixes.find((m) => m.id === 'genre-blend');
    expect(blend?.fetchStrategy.type).toBe('offline');
  });

  it('excludes Favorites Radio when offline', () => {
    const input = {
      ...baseInput,
      isOnline: false,
      favoritesSeed: { id: 's1' },
    };
    const mixes = generateMixes(input);
    expect(mixes.find((m) => m.id === 'favorites-radio')).toBeUndefined();
  });

  it('Right Now uses genre from listening window when available', () => {
    const currentHour = new Date().getHours();
    const input = {
      ...baseInput,
      genreCounts: { Rock: 5 },
      scrobbles: [
        { time: new Date().setHours(currentHour, 0, 0, 0), song: { genre: 'Rock' } },
      ],
    };
    const mixes = generateMixes(input);
    const rightNow = mixes.find((m) => m.id === 'right-now')!;
    expect(rightNow.subtitle).toContain('Rock');
    if (rightNow.fetchStrategy.type === 'randomByGenre') {
      expect(rightNow.fetchStrategy.genre).toBe('Rock');
    }
  });

  it('Right Now falls back to random when no genre data', () => {
    const mixes = generateMixes(baseInput);
    const rightNow = mixes.find((m) => m.id === 'right-now')!;
    expect(rightNow.fetchStrategy.type).toBe('random');
  });

  it('uses custom listLength in fetch strategies', () => {
    const input = {
      ...baseInput,
      genreCounts: { Rock: 10, Jazz: 8 },
      favoritesSeed: { id: 'fav-1' },
      listLength: 50,
    };
    const mixes = generateMixes(input);

    // Right Now should use listLength
    const rightNow = mixes.find((m) => m.id === 'right-now')!;
    if (rightNow.fetchStrategy.type === 'randomByGenre') {
      expect(rightNow.fetchStrategy.size).toBe(50);
    } else if (rightNow.fetchStrategy.type === 'random') {
      expect(rightNow.fetchStrategy.size).toBe(50);
    }

    // Genre Blend should split listLength across genres
    const blend = mixes.find((m) => m.id === 'genre-blend')!;
    if (blend.fetchStrategy.type === 'multiGenreBlend') {
      expect(blend.fetchStrategy.genres[0].size).toBe(25);
      expect(blend.fetchStrategy.genres[1].size).toBe(25);
    }

    // Favorites Radio should use listLength
    const favRadio = mixes.find((m) => m.id === 'favorites-radio')!;
    if (favRadio.fetchStrategy.type === 'similarToSong') {
      expect(favRadio.fetchStrategy.count).toBe(50);
    }
  });

  describe('Heavy Rotation', () => {
    const now = Date.now();
    const recentTime = now - 2 * 24 * 60 * 60 * 1000; // 2 days ago

    it('includes Heavy Rotation when 5+ songs played in last 7 days', () => {
      const scrobbles = Array.from({ length: 8 }, (_, i) => ({
        time: recentTime + i * 1000,
        song: { id: `song-${i % 5}`, title: `Song ${i % 5}`, artist: 'Artist', genre: 'Rock' },
      }));
      const input = { ...baseInput, scrobbles };
      const mixes = generateMixes(input);
      const hr = mixes.find((m) => m.id === 'heavy-rotation');
      expect(hr).toBeDefined();
      expect(hr!.name).toBe('Heavy Rotation');
      expect(hr!.fetchStrategy.type).toBe('recentTopSongs');
    });

    it('excludes Heavy Rotation when fewer than 5 songs played recently', () => {
      const scrobbles = Array.from({ length: 3 }, (_, i) => ({
        time: recentTime + i * 1000,
        song: { id: `song-${i}`, title: `Song ${i}`, artist: 'Artist', genre: 'Rock' },
      }));
      const input = { ...baseInput, scrobbles };
      const mixes = generateMixes(input);
      expect(mixes.find((m) => m.id === 'heavy-rotation')).toBeUndefined();
    });

    it('excludes songs older than 7 days', () => {
      const oldTime = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago
      const scrobbles = Array.from({ length: 10 }, (_, i) => ({
        time: oldTime + i * 1000,
        song: { id: `song-${i}`, title: `Song ${i}`, artist: 'Artist', genre: 'Rock' },
      }));
      const input = { ...baseInput, scrobbles };
      const mixes = generateMixes(input);
      expect(mixes.find((m) => m.id === 'heavy-rotation')).toBeUndefined();
    });

    it('sorts songs by play count descending', () => {
      // song-0 played 5 times, song-1 played 2 times, others once
      const scrobbles = [
        ...Array.from({ length: 5 }, (_, i) => ({
          time: recentTime + i * 1000,
          song: { id: 'song-0', title: 'Top Song', artist: 'Artist', genre: 'Rock' },
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          time: recentTime + (5 + i) * 1000,
          song: { id: 'song-1', title: 'Second Song', artist: 'Artist', genre: 'Rock' },
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          time: recentTime + (7 + i) * 1000,
          song: { id: `song-${2 + i}`, title: `Song ${2 + i}`, artist: 'Artist', genre: 'Rock' },
        })),
      ];
      const input = { ...baseInput, scrobbles };
      const mixes = generateMixes(input);
      const hr = mixes.find((m) => m.id === 'heavy-rotation')!;
      expect(hr).toBeDefined();
      if (hr.fetchStrategy.type === 'recentTopSongs') {
        expect(hr.fetchStrategy.songs[0].id).toBe('song-0');
        expect(hr.fetchStrategy.songs[1].id).toBe('song-1');
      }
    });

    it('works in offline mode', () => {
      const scrobbles = Array.from({ length: 8 }, (_, i) => ({
        time: recentTime + i * 1000,
        song: { id: `song-${i % 5}`, title: `Song ${i % 5}`, artist: 'Artist', genre: 'Rock' },
      }));
      const input = { ...baseInput, isOnline: false, scrobbles };
      const mixes = generateMixes(input);
      const hr = mixes.find((m) => m.id === 'heavy-rotation');
      expect(hr).toBeDefined();
      expect(hr!.fetchStrategy.type).toBe('recentTopSongs');
    });
  });
});

/* ------------------------------------------------------------------ */
/*  fetchMixSongs                                                      */
/* ------------------------------------------------------------------ */

describe('fetchMixSongs', () => {
  const songs = [makeSong({ id: '1' }), makeSong({ id: '2' })];

  it('fetches random songs by genre', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(songs);
    const result = await fetchMixSongs({ type: 'randomByGenre', genre: 'Rock', size: 20 });
    expect(result).toEqual(songs);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith({ size: 20, genre: 'Rock' });
  });

  it('fetches random songs by decade', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(songs);
    const result = await fetchMixSongs({ type: 'randomByDecade', fromYear: 1990, toYear: 1999, size: 20 });
    expect(result).toEqual(songs);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith({ size: 20, fromYear: 1990, toYear: 1999 });
  });

  it('fetches similar songs for an artist', async () => {
    mockGetSimilarSongs2.mockResolvedValue(songs);
    const result = await fetchMixSongs({ type: 'similarToArtist', artistId: 'ar-1', count: 20 });
    expect(result.length).toBe(2);
    expect(mockGetSimilarSongs2).toHaveBeenCalledWith('ar-1', 20);
  });

  it('falls back to random when similarToArtist returns empty', async () => {
    mockGetSimilarSongs2.mockResolvedValue([]);
    mockGetRandomSongs.mockResolvedValue(songs);
    const result = await fetchMixSongs({ type: 'similarToArtist', artistId: 'ar-1', count: 20 });
    expect(result).toEqual(songs);
    expect(mockGetRandomSongs).toHaveBeenCalledWith(20);
  });

  it('fetches and shuffles the shared similar-to-song result', async () => {
    mockFetchSimilarSongsOrRandom.mockResolvedValue(songs);
    const shuffle = jest.spyOn(arrayHelpers, 'shuffleArray').mockReturnValue([...songs].reverse());

    const result = await fetchMixSongs({ type: 'similarToSong', songId: 's-1', count: 20 });
    expect(result).toEqual([...songs].reverse());
    expect(mockFetchSimilarSongsOrRandom).toHaveBeenCalledWith('s-1', 20);
    expect(shuffle).toHaveBeenCalledWith(songs);
  });

  it('returns an empty shared similar-to-song result', async () => {
    mockFetchSimilarSongsOrRandom.mockResolvedValue([]);
    const result = await fetchMixSongs({ type: 'similarToSong', songId: 's-1', count: 20 });
    expect(result).toEqual([]);
    expect(mockGetRandomSongs).not.toHaveBeenCalled();
  });

  it('blends multiple genres', async () => {
    mockGetRandomSongsFiltered
      .mockResolvedValueOnce([makeSong({ id: 'a' })])
      .mockResolvedValueOnce([makeSong({ id: 'b' })]);

    const result = await fetchMixSongs({
      type: 'multiGenreBlend',
      genres: [
        { name: 'Rock', size: 10 },
        { name: 'Jazz', size: 10 },
      ],
    });
    expect(result.length).toBe(2);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(2);
  });

  it('handles null responses in multi-genre blend', async () => {
    mockGetRandomSongsFiltered
      .mockResolvedValueOnce([makeSong({ id: 'a' })])
      .mockResolvedValueOnce(null);

    const result = await fetchMixSongs({
      type: 'multiGenreBlend',
      genres: [
        { name: 'Rock', size: 10 },
        { name: 'Jazz', size: 10 },
      ],
    });
    expect(result.length).toBe(1);
  });

  it('fetches pure random songs', async () => {
    mockGetRandomSongs.mockResolvedValue(songs);
    const result = await fetchMixSongs({ type: 'random', size: 20 });
    expect(result).toEqual(songs);
  });

  it('handles offline with genre', async () => {
    mockGetOfflineSongsByGenre.mockReturnValue(songs);
    const result = await fetchMixSongs({ type: 'offline', genre: 'Rock' });
    expect(result.length).toBe(2);
    expect(mockGetOfflineSongsByGenre).toHaveBeenCalledWith('Rock');
  });

  it('limits offline with genre to listLength', async () => {
    const manySongs = Array.from({ length: 100 }, (_, i) => makeSong({ id: `s${i}` }));
    mockGetOfflineSongsByGenre.mockReturnValue(manySongs);
    const result = await fetchMixSongs({ type: 'offline', genre: 'Rock' }, 30);
    expect(result.length).toBe(30);
  });

  it('limits multiGenreBlend to listLength', async () => {
    const genreA = Array.from({ length: 15 }, (_, i) => makeSong({ id: `a${i}` }));
    const genreB = Array.from({ length: 15 }, (_, i) => makeSong({ id: `b${i}` }));
    mockGetRandomSongsFiltered
      .mockResolvedValueOnce(genreA)
      .mockResolvedValueOnce(genreB);
    const result = await fetchMixSongs({
      type: 'multiGenreBlend',
      genres: [
        { name: 'Rock', size: 15 },
        { name: 'Jazz', size: 15 },
      ],
    }, 20);
    expect(result.length).toBe(20);
  });

  it('handles offline without genre', async () => {
    mockGetOfflineSongsAll.mockReturnValue(songs);
    const result = await fetchMixSongs({ type: 'offline' });
    expect(result.length).toBeLessThanOrEqual(20);
    expect(mockGetOfflineSongsAll).toHaveBeenCalled();
  });

  it('uses custom listLength for fallback random calls', async () => {
    mockGetSimilarSongs2.mockResolvedValue([]);
    mockGetRandomSongs.mockResolvedValue(songs);
    await fetchMixSongs({ type: 'similarToArtist', artistId: 'ar-1', count: 50 }, 50);
    expect(mockGetRandomSongs).toHaveBeenCalledWith(50);
  });

  it('uses custom listLength for offline slice', async () => {
    const manySongs = Array.from({ length: 100 }, (_, i) => makeSong({ id: `s${i}` }));
    mockGetOfflineSongsAll.mockReturnValue(manySongs);
    const result = await fetchMixSongs({ type: 'offline' }, 50);
    expect(result.length).toBe(50);
  });

  it('returns empty array on null API response', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(null);
    const result = await fetchMixSongs({ type: 'randomByGenre', genre: 'Rock', size: 20 });
    expect(result).toEqual([]);
  });

  it('falls back to random on API error', async () => {
    mockGetRandomSongsFiltered.mockRejectedValue(new Error('network'));
    mockGetRandomSongs.mockResolvedValue(songs);
    const result = await fetchMixSongs({ type: 'randomByGenre', genre: 'Rock', size: 20 });
    expect(result).toEqual(songs);
  });

  it('returns empty array when both primary and fallback fail', async () => {
    mockGetRandomSongsFiltered.mockRejectedValue(new Error('network'));
    mockGetRandomSongs.mockRejectedValue(new Error('also broken'));
    const result = await fetchMixSongs({ type: 'randomByGenre', genre: 'Rock', size: 20 });
    expect(result).toEqual([]);
  });

  it('returns embedded songs for recentTopSongs strategy', async () => {
    const songs = [makeSong({ id: 'a' }), makeSong({ id: 'b' })];
    const result = await fetchMixSongs({ type: 'recentTopSongs', songs });
    expect(result).toEqual(songs);
    // No API calls should be made
    expect(mockGetRandomSongs).not.toHaveBeenCalled();
    expect(mockGetRandomSongsFiltered).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  fetchCustomMix                                                     */
/* ------------------------------------------------------------------ */

describe('fetchCustomMix', () => {
  const songs = [makeSong({ id: '1' }), makeSong({ id: '2' })];

  it('fetches a single genre with decade filter', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(songs);
    const result = await fetchCustomMix(['Rock'], [{ fromYear: 1990, toYear: 1999 }], true);
    expect(result).toEqual(expect.arrayContaining(songs));
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith({
      size: 20,
      genre: 'Rock',
      fromYear: 1990,
      toYear: 1999,
    });
  });

  it('fetches a single genre without decade filter', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(songs);
    const result = await fetchCustomMix(['Rock'], [], true);
    expect(result).toEqual(expect.arrayContaining(songs));
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith({
      size: 20,
      genre: 'Rock',
      fromYear: undefined,
      toYear: undefined,
    });
  });

  // An era-only mix (no genre) must still honour fromYear/toYear: one call to
  // getRandomSongsFiltered with the year window and no genre, never a fall-
  // through to "fully random".
  it('fetches with era filter only when no genres are selected', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(songs);
    const result = await fetchCustomMix([], [{ fromYear: 2000, toYear: 2009 }], true);
    expect(result).toEqual(expect.arrayContaining(songs));
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(1);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith({
      size: 20,
      fromYear: 2000,
      toYear: 2009,
    });
  });

  it('splits evenly across multiple genres', async () => {
    mockGetRandomSongsFiltered
      .mockResolvedValueOnce([makeSong({ id: 'a' })])
      .mockResolvedValueOnce([makeSong({ id: 'b' })]);

    const result = await fetchCustomMix(['Rock', 'Jazz'], [], true);
    expect(result.length).toBe(2);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(2);
  });

  it('uses offline songs when not online', async () => {
    mockGetOfflineSongsByGenre.mockReturnValue(songs);
    const result = await fetchCustomMix(['Rock'], [], false);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(mockGetOfflineSongsByGenre).toHaveBeenCalledWith('Rock');
  });

  it('handles null API response gracefully', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(null);
    const result = await fetchCustomMix(['Rock'], [], true);
    expect(result).toEqual([]);
  });

  it('uses custom listLength for single genre', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(songs);
    await fetchCustomMix(['Rock'], [{ fromYear: 1990, toYear: 1999 }], true, 50);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith({
      size: 50,
      genre: 'Rock',
      fromYear: 1990,
      toYear: 1999,
    });
  });

  it('splits custom listLength across multiple genres', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue([makeSong()]);
    await fetchCustomMix(['Rock', 'Jazz', 'Pop'], [], true, 50);
    // Math.ceil(50 / 3) = 17
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ size: 17, genre: 'Rock' }),
    );
  });

  it('uses custom listLength for offline slice', async () => {
    const manySongs = Array.from({ length: 100 }, (_, i) => makeSong({ id: `s${i}` }));
    mockGetOfflineSongsByGenre.mockReturnValue(manySongs);
    const result = await fetchCustomMix(['Rock'], [], false, 50);
    expect(result.length).toBe(50);
  });

  it('limits online multi-genre results to listLength', async () => {
    const genreA = Array.from({ length: 10 }, (_, i) => makeSong({ id: `a${i}` }));
    const genreB = Array.from({ length: 10 }, (_, i) => makeSong({ id: `b${i}` }));
    mockGetRandomSongsFiltered
      .mockResolvedValueOnce(genreA)
      .mockResolvedValueOnce(genreB);
    const result = await fetchCustomMix(['Rock', 'Jazz'], [], true, 15);
    expect(result.length).toBe(15);
  });

  it('queries each selected decade separately (non-contiguous eras)', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue([makeSong()]);
    await fetchCustomMix(
      ['Rock'],
      [{ fromYear: 1970, toYear: 1979 }, { fromYear: 1990, toYear: 1999 }],
      true,
    );
    // 1 genre × 2 decades = 2 separate queries (a single year window can't
    // express 70s + 90s without also pulling in the 80s).
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(2);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ genre: 'Rock', fromYear: 1970, toYear: 1979 }),
    );
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ genre: 'Rock', fromYear: 1990, toYear: 1999 }),
    );
  });

  it('fans out across the genre × decade cross-product', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue([makeSong()]);
    await fetchCustomMix(
      ['Rock', 'Jazz'],
      [{ fromYear: 1980, toYear: 1989 }, { fromYear: 2000, toYear: 2009 }],
      true,
    );
    // 2 genres × 2 decades = 4 combos
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(4);
  });

  it('filters offline songs by selected decades client-side', async () => {
    mockGetOfflineSongsByGenre.mockReturnValue([
      makeSong({ id: 'old', year: 1975 }),
      makeSong({ id: 'mid', year: 1985 }),
      makeSong({ id: 'new', year: 1995 }),
    ]);
    const result = await fetchCustomMix(
      ['Rock'],
      [{ fromYear: 1970, toYear: 1979 }, { fromYear: 1990, toYear: 1999 }],
      false,
    );
    expect(result.map((s) => s.id).sort()).toEqual(['new', 'old']); // 1985 excluded
  });
});

/* ------------------------------------------------------------------ */
/*  DECADES constant                                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  getTimeIcon                                                        */
/* ------------------------------------------------------------------ */

describe('getTimeIcon', () => {
  it('returns sunny-outline for early morning (5-7)', () => {
    expect(getTimeIcon(5)).toBe('sunny-outline');
    expect(getTimeIcon(7)).toBe('sunny-outline');
  });

  it('returns sunny for daytime (8-16)', () => {
    expect(getTimeIcon(8)).toBe('sunny');
    expect(getTimeIcon(12)).toBe('sunny');
    expect(getTimeIcon(16)).toBe('sunny');
  });

  it('returns partly-sunny-outline for evening (17-19)', () => {
    expect(getTimeIcon(17)).toBe('partly-sunny-outline');
    expect(getTimeIcon(19)).toBe('partly-sunny-outline');
  });

  it('returns moon-outline for night (20+, 0-4)', () => {
    expect(getTimeIcon(20)).toBe('moon-outline');
    expect(getTimeIcon(23)).toBe('moon-outline');
    expect(getTimeIcon(0)).toBe('moon-outline');
    expect(getTimeIcon(4)).toBe('moon-outline');
  });
});

/* ------------------------------------------------------------------ */
/*  getTimeGradient                                                    */
/* ------------------------------------------------------------------ */

describe('getTimeGradient', () => {
  it('returns warm gradient for early morning (5-7)', () => {
    const [c1] = getTimeGradient(5);
    expect(c1).toBe('#F59E0B');
  });

  it('returns warm-to-blue gradient for morning (8-10)', () => {
    const [c1, c2] = getTimeGradient(8);
    expect(c1).toBe('#F97316');
    expect(c2).toBe('#3B82F6');
  });

  it('returns blue gradient for midday (11-13)', () => {
    const [c1] = getTimeGradient(11);
    expect(c1).toBe('#3B82F6');
  });

  it('returns blue-to-sky gradient for afternoon (14-16)', () => {
    const [c1, c2] = getTimeGradient(14);
    expect(c1).toBe('#2563EB');
    expect(c2).toBe('#0EA5E9');
  });

  it('returns orange gradient for evening (17-19)', () => {
    const [c1] = getTimeGradient(17);
    expect(c1).toBe('#F97316');
  });

  it('returns indigo gradient for night (20-22)', () => {
    const [c1] = getTimeGradient(20);
    expect(c1).toBe('#6366F1');
  });

  it('returns deep indigo gradient for late night (23+, 0-4)', () => {
    const [c1] = getTimeGradient(23);
    expect(c1).toBe('#312E81');
    const [c2] = getTimeGradient(0);
    expect(c2).toBe('#312E81');
  });
});

/* ------------------------------------------------------------------ */
/*  DECADES constant                                                   */
/* ------------------------------------------------------------------ */

describe('DECADES', () => {
  it('starts with "Any" (no era filter)', () => {
    expect(DECADES[0].label).toBe('Any');
    expect(DECADES[0].fromYear).toBeUndefined();
    expect(DECADES[0].toYear).toBeUndefined();
  });

  it('named decades (50s–20s) span exactly 10 years', () => {
    for (const decade of DECADES.filter((d) => /^\d0s$/.test(d.label))) {
      expect(decade.toYear! - decade.fromYear!).toBe(9);
    }
  });

  it('includes 50s and 60s', () => {
    const labels = DECADES.map((d) => d.label);
    expect(labels).toContain('50s');
    expect(labels).toContain('60s');
  });

  it('has an "Earlier" shortcut for everything before the 50s', () => {
    const earlier = DECADES.find((d) => d.label === 'Earlier');
    expect(earlier).toBeDefined();
    expect(earlier!.toYear).toBe(1949);
  });

  it('has a "Recent" shortcut covering the last several years', () => {
    const recent = DECADES.find((d) => d.label === 'Recent');
    expect(recent).toBeDefined();
    expect(recent!.toYear! - recent!.fromYear!).toBeGreaterThanOrEqual(4);
  });
});

describe('resolveGenreSlot', () => {
  const song = (id: string) => ({ id }) as Child;

  it('returns the primary result in a single call when it has songs', async () => {
    mockGetRandomSongsFiltered.mockResolvedValueOnce([song('a')]);
    const result = await resolveGenreSlot('Rock', {}, 10);
    expect(result).toEqual([song('a')]);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(1);
  });

  it('splits a compound genre and merges parts when the primary is empty', async () => {
    mockGetRandomSongsFiltered
      .mockResolvedValueOnce([]) // "Folk, World, & Country" — no match
      .mockResolvedValueOnce([song('f')]) // Folk
      .mockResolvedValueOnce([song('w')]) // World
      .mockResolvedValueOnce([song('c')]); // Country
    const result = await resolveGenreSlot('Folk, World, & Country', {}, 12);
    expect(result).toEqual([song('f'), song('w'), song('c')]);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(4);
  });

  it('treats a null primary as empty and still splits a compound genre', async () => {
    mockGetRandomSongsFiltered
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([song('f')])
      .mockResolvedValueOnce([song('w')]);
    const result = await resolveGenreSlot('Folk, World', {}, 10);
    expect(result).toEqual([song('f'), song('w')]);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(3);
  });

  it('does not split a single-value genre — one call, empty stays empty', async () => {
    mockGetRandomSongsFiltered.mockResolvedValueOnce([]);
    const result = await resolveGenreSlot('Rock', {}, 10);
    expect(result).toEqual([]);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(1);
  });

  it('makes exactly one call for an era-only slot (no genre)', async () => {
    mockGetRandomSongsFiltered.mockResolvedValueOnce([song('x')]);
    const result = await resolveGenreSlot(undefined, { fromYear: 1990, toYear: 1999 }, 10);
    expect(result).toEqual([song('x')]);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(1);
  });
});
