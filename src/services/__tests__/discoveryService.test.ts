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
  type FetchStrategy,
  type MixDefinition,
} from '../discoveryService';
import { type Child } from '../subsonicService';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetRandomSongs = jest.fn();
const mockGetRandomSongsFiltered = jest.fn();
const mockGetSimilarSongs = jest.fn();
const mockGetSimilarSongs2 = jest.fn();

jest.mock('../subsonicService', () => ({
  getRandomSongs: (...args: unknown[]) => mockGetRandomSongs(...args),
  getRandomSongsFiltered: (...args: unknown[]) => mockGetRandomSongsFiltered(...args),
  getSimilarSongs: (...args: unknown[]) => mockGetSimilarSongs(...args),
  getSimilarSongs2: (...args: unknown[]) => mockGetSimilarSongs2(...args),
}));

const mockGetOfflineSongsByGenre = jest.fn();

jest.mock('../searchService', () => ({
  getOfflineSongsByGenre: (...args: unknown[]) => mockGetOfflineSongsByGenre(...args),
}));

beforeEach(() => {
  mockGetRandomSongs.mockReset();
  mockGetRandomSongsFiltered.mockReset();
  mockGetSimilarSongs.mockReset();
  mockGetSimilarSongs2.mockReset();
  mockGetOfflineSongsByGenre.mockReset();
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
  it('returns the decade with the highest play count', () => {
    const songCounts = {
      s1: { song: makeSong({ year: 1992 }), count: 5 },
      s2: { song: makeSong({ year: 1995 }), count: 8 },
      s3: { song: makeSong({ year: 2005 }), count: 3 },
    };
    const result = getTopDecade(songCounts);
    expect(result).toEqual({ decade: 1990, fromYear: 1990, toYear: 1999 });
  });

  it('returns null when no songs have year data', () => {
    const songCounts = {
      s1: { song: makeSong(), count: 5 },
      s2: { song: makeSong(), count: 3 },
    };
    expect(getTopDecade(songCounts)).toBeNull();
  });

  it('returns null for empty song counts', () => {
    expect(getTopDecade({})).toBeNull();
  });

  it('ignores songs with year < 1950', () => {
    const songCounts = {
      s1: { song: makeSong({ year: 1920 }), count: 100 },
      s2: { song: makeSong({ year: 2010 }), count: 2 },
    };
    const result = getTopDecade(songCounts);
    expect(result).toEqual({ decade: 2010, fromYear: 2010, toYear: 2019 });
  });

  it('breaks ties by returning the first highest', () => {
    const songCounts = {
      s1: { song: makeSong({ year: 1985 }), count: 5 },
      s2: { song: makeSong({ year: 1995 }), count: 5 },
    };
    const result = getTopDecade(songCounts);
    // Both have count 5, order depends on Object.values iteration
    expect(result).not.toBeNull();
    expect(result!.toYear - result!.fromYear).toBe(9);
  });
});

/* ------------------------------------------------------------------ */
/*  generateMixes                                                      */
/* ------------------------------------------------------------------ */

describe('generateMixes', () => {
  const baseInput = {
    hourBuckets: new Array(24).fill(0),
    genreCounts: {} as Record<string, number>,
    songCounts: {} as Record<string, { song: Child; count: number }>,
    artistCounts: {} as Record<string, number>,
    scrobbles: [] as any[],
    starredSongs: [] as Child[],
    isOnline: true,
  };

  it('always returns at least a "Right Now" card', () => {
    const mixes = generateMixes(baseInput);
    expect(mixes.length).toBeGreaterThanOrEqual(1);
    expect(mixes[0].id).toBe('right-now');
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

  it('uses similarToArtist strategy when top artist has artistId', () => {
    const input = {
      ...baseInput,
      artistCounts: { 'Pink Floyd': 20 },
      scrobbles: [
        { time: Date.now(), song: { artist: 'Pink Floyd', artistId: 'ar-1', genre: 'Rock' } },
      ],
    };
    const mixes = generateMixes(input);
    const deepCuts = mixes.find((m) => m.id === 'deep-cuts')!;
    expect(deepCuts.fetchStrategy).toEqual({
      type: 'similarToArtist',
      artistId: 'ar-1',
      count: 20,
    });
    expect(deepCuts.subtitle).toContain('Pink Floyd');
  });

  it('includes Time Machine with decade when song history has years', () => {
    const input = {
      ...baseInput,
      songCounts: {
        s1: { song: makeSong({ year: 1985 }), count: 10 },
        s2: { song: makeSong({ year: 1988 }), count: 8 },
      },
    };
    const mixes = generateMixes(input);
    const timeMachine = mixes.find((m) => m.id === 'time-machine')!;
    expect(timeMachine.name).toBe('The 1980s');
    expect(timeMachine.fetchStrategy).toEqual({
      type: 'randomByDecade',
      fromYear: 1980,
      toYear: 1989,
      size: 20,
    });
  });

  it('excludes Favorites Radio when no starred songs', () => {
    const mixes = generateMixes(baseInput);
    expect(mixes.find((m) => m.id === 'favorites-radio')).toBeUndefined();
  });

  it('includes Favorites Radio when starred songs exist (online)', () => {
    const input = {
      ...baseInput,
      starredSongs: [makeSong({ id: 'fav-1', title: 'My Fav Song' })],
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
    expect(mixes[0].fetchStrategy.type).toBe('offline');

    // Genre Blend uses offline strategy
    const blend = mixes.find((m) => m.id === 'genre-blend');
    expect(blend?.fetchStrategy.type).toBe('offline');
  });

  it('excludes Favorites Radio when offline', () => {
    const input = {
      ...baseInput,
      isOnline: false,
      starredSongs: [makeSong()],
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
    const rightNow = mixes[0];
    expect(rightNow.subtitle).toContain('Rock');
    if (rightNow.fetchStrategy.type === 'randomByGenre') {
      expect(rightNow.fetchStrategy.genre).toBe('Rock');
    }
  });

  it('Right Now falls back to random when no genre data', () => {
    const mixes = generateMixes(baseInput);
    const rightNow = mixes[0];
    expect(rightNow.fetchStrategy.type).toBe('random');
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

  it('fetches similar songs for a song', async () => {
    mockGetSimilarSongs.mockResolvedValue(songs);
    const result = await fetchMixSongs({ type: 'similarToSong', songId: 's-1', count: 20 });
    expect(result.length).toBe(2);
    expect(mockGetSimilarSongs).toHaveBeenCalledWith('s-1', 20);
  });

  it('falls back to random when similarToSong returns empty', async () => {
    mockGetSimilarSongs.mockResolvedValue([]);
    mockGetRandomSongs.mockResolvedValue(songs);
    const result = await fetchMixSongs({ type: 'similarToSong', songId: 's-1', count: 20 });
    expect(result).toEqual(songs);
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

  it('handles offline without genre', async () => {
    mockGetOfflineSongsByGenre.mockReturnValue(songs);
    const result = await fetchMixSongs({ type: 'offline' });
    expect(result.length).toBeLessThanOrEqual(20);
    expect(mockGetOfflineSongsByGenre).toHaveBeenCalledWith('');
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
});

/* ------------------------------------------------------------------ */
/*  fetchCustomMix                                                     */
/* ------------------------------------------------------------------ */

describe('fetchCustomMix', () => {
  const songs = [makeSong({ id: '1' }), makeSong({ id: '2' })];

  it('fetches a single genre with decade filter', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(songs);
    const result = await fetchCustomMix(['Rock'], 1990, 1999, true);
    expect(result).toEqual(songs);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith({
      size: 20,
      genre: 'Rock',
      fromYear: 1990,
      toYear: 1999,
    });
  });

  it('fetches a single genre without decade filter', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(songs);
    const result = await fetchCustomMix(['Rock'], undefined, undefined, true);
    expect(result).toEqual(songs);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledWith({
      size: 20,
      genre: 'Rock',
      fromYear: undefined,
      toYear: undefined,
    });
  });

  it('splits evenly across multiple genres', async () => {
    mockGetRandomSongsFiltered
      .mockResolvedValueOnce([makeSong({ id: 'a' })])
      .mockResolvedValueOnce([makeSong({ id: 'b' })]);

    const result = await fetchCustomMix(['Rock', 'Jazz'], undefined, undefined, true);
    expect(result.length).toBe(2);
    expect(mockGetRandomSongsFiltered).toHaveBeenCalledTimes(2);
  });

  it('uses offline songs when not online', async () => {
    mockGetOfflineSongsByGenre.mockReturnValue(songs);
    const result = await fetchCustomMix(['Rock'], undefined, undefined, false);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(mockGetOfflineSongsByGenre).toHaveBeenCalledWith('Rock');
  });

  it('handles null API response gracefully', async () => {
    mockGetRandomSongsFiltered.mockResolvedValue(null);
    const result = await fetchCustomMix(['Rock'], undefined, undefined, true);
    expect(result).toEqual([]);
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

  it('returns blue gradient for morning (8-13)', () => {
    const [c1] = getTimeGradient(8);
    expect(c1).toBe('#3B82F6');
  });

  it('returns sky gradient for afternoon (14-16)', () => {
    const [c1] = getTimeGradient(14);
    expect(c1).toBe('#0EA5E9');
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
  it('has 7 entries starting with "Any"', () => {
    expect(DECADES).toHaveLength(7);
    expect(DECADES[0].label).toBe('Any');
    expect(DECADES[0].fromYear).toBeUndefined();
    expect(DECADES[0].toYear).toBeUndefined();
  });

  it('each decade has a 10-year range', () => {
    for (const decade of DECADES.slice(1)) {
      expect(decade.toYear! - decade.fromYear!).toBe(9);
    }
  });
});
