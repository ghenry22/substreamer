// The store now delegates persistence to `scrobbleTable`. Tests mock that
// module so we can assert the wiring (SQL calls happen at the right moments)
// without needing a real SQLite handle. The in-memory state behaviour is
// unchanged from the pre-migration store and is still exercised directly.
jest.mock('../persistence/scrobbleTable', () => ({
  insertScrobble: jest.fn(),
  replaceAllScrobbles: jest.fn(),
  clearScrobbles: jest.fn(),
  hydrateScrobbles: jest.fn(() => []),
}));

import {
  clearCompletedScrobbleTable,
  completedScrobbleStore,
  type AnalyticsAggregates,
  type CompletedScrobble,
  type ListeningStats,
} from '../completedScrobbleStore';
import {
  clearScrobbles,
  hydrateScrobbles,
  insertScrobble,
  replaceAllScrobbles,
} from '../persistence/scrobbleTable';

const mockInsertScrobble = insertScrobble as jest.Mock;
const mockReplaceAllScrobbles = replaceAllScrobbles as jest.Mock;
const mockClearScrobbles = clearScrobbles as jest.Mock;
const mockHydrateScrobbles = hydrateScrobbles as jest.Mock;

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

function validScrobble(overrides?: Partial<CompletedScrobble>): CompletedScrobble {
  return {
    id: 'scrobble-1',
    song: { id: 's1', title: 'Song', artist: 'Artist', duration: 180 },
    time: Date.now(),
    ...overrides,
  } as CompletedScrobble;
}

function resetStore() {
  completedScrobbleStore.setState({
    completedScrobbles: [],
    stats: { ...EMPTY_STATS },
    aggregates: { ...EMPTY_AGGREGATES, hourBuckets: new Array(24).fill(0) },
    hasHydrated: false,
  });
}

beforeEach(() => {
  resetStore();
  mockInsertScrobble.mockClear();
  mockReplaceAllScrobbles.mockClear();
  mockClearScrobbles.mockClear();
  mockHydrateScrobbles.mockReset();
  mockHydrateScrobbles.mockReturnValue([]);
});

describe('addCompleted', () => {
  it('adds valid scrobble, increments stats, and persists to SQL', () => {
    const s = validScrobble();
    completedScrobbleStore.getState().addCompleted(s);

    const state = completedScrobbleStore.getState();
    expect(state.completedScrobbles).toHaveLength(1);
    expect(state.completedScrobbles[0]).toEqual(s);
    expect(state.stats.totalPlays).toBe(1);
    expect(state.stats.totalListeningSeconds).toBe(180);
    expect(state.stats.uniqueArtists).toEqual({ Artist: true });
    expect(mockInsertScrobble).toHaveBeenCalledTimes(1);
    expect(mockInsertScrobble).toHaveBeenCalledWith(s);
  });

  it('rejects when id is missing and does not touch SQL', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '' }));
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(0);
    expect(mockInsertScrobble).not.toHaveBeenCalled();
  });

  it('rejects when song.id is missing', () => {
    completedScrobbleStore.getState().addCompleted(
      validScrobble({ song: { id: '', title: 'X', artist: 'A' } as any }),
    );
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(0);
    expect(mockInsertScrobble).not.toHaveBeenCalled();
  });

  it('rejects when song.title is missing', () => {
    completedScrobbleStore.getState().addCompleted(
      validScrobble({ song: { id: 's1', title: '', artist: 'A' } as any }),
    );
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(0);
    expect(mockInsertScrobble).not.toHaveBeenCalled();
  });

  it('rejects duplicates by id (in-memory) and does not double-write', () => {
    const s = validScrobble();
    completedScrobbleStore.getState().addCompleted(s);
    completedScrobbleStore.getState().addCompleted(s);
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(1);
    expect(mockInsertScrobble).toHaveBeenCalledTimes(1);
  });

  it('handles missing duration', () => {
    completedScrobbleStore.getState().addCompleted(
      validScrobble({ song: { id: 's1', title: 'X', artist: 'A' } as any }),
    );
    expect(completedScrobbleStore.getState().stats.totalListeningSeconds).toBe(0);
  });

  it('handles missing artist', () => {
    completedScrobbleStore.getState().addCompleted(
      validScrobble({ song: { id: 's1', title: 'X' } as any }),
    );
    expect(completedScrobbleStore.getState().stats.uniqueArtists).toEqual({});
  });

  it('tracks multiple unique artists', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Artist1', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'Artist2', duration: 200 } as any }));
    expect(completedScrobbleStore.getState().stats.uniqueArtists).toEqual({
      Artist1: true,
      Artist2: true,
    });
  });

  it('rejects when song is null', () => {
    completedScrobbleStore.getState().addCompleted(
      { id: 'x', song: null as any, time: Date.now() } as CompletedScrobble,
    );
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(0);
    expect(mockInsertScrobble).not.toHaveBeenCalled();
  });

  it('accumulates stats correctly over many adds', () => {
    for (let i = 0; i < 10; i++) {
      completedScrobbleStore.getState().addCompleted(
        validScrobble({
          id: `s-${i}`,
          song: { id: `song-${i}`, title: `T${i}`, artist: `A${i % 3}`, duration: 100 } as any,
        }),
      );
    }
    const { stats } = completedScrobbleStore.getState();
    expect(stats.totalPlays).toBe(10);
    expect(stats.totalListeningSeconds).toBe(1000);
    expect(Object.keys(stats.uniqueArtists)).toHaveLength(3);
    expect(mockInsertScrobble).toHaveBeenCalledTimes(10);
  });
});

describe('aggregates – incremental updates', () => {
  it('updates artistCounts incrementally', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'ArtistX', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'ArtistX', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '3', song: { id: 's3', title: 'C', artist: 'ArtistY', duration: 100 } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.artistCounts['ArtistX']).toBe(2);
    expect(aggregates.artistCounts['ArtistY']).toBe(1);
  });

  it('updates albumCounts incrementally', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Art', album: 'AlbumA', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'Art', album: 'AlbumA', duration: 100 } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.albumCounts['AlbumA::Art'].count).toBe(2);
    expect(aggregates.albumCounts['AlbumA::Art'].artist).toBe('Art');
  });

  it('updates album coverArt when later scrobble provides it', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Art', album: 'AlbumA', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'Art', album: 'AlbumA', coverArt: 'al-123', duration: 100 } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.albumCounts['AlbumA::Art'].coverArt).toBe('al-123');
  });

  it('does not clear album coverArt when later scrobble lacks it', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Art', album: 'AlbumA', coverArt: 'al-123', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'Art', album: 'AlbumA', duration: 100 } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.albumCounts['AlbumA::Art'].coverArt).toBe('al-123');
  });

  it('updates songCounts incrementally and keeps latest song metadata', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'Old Title', artist: 'Art', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', song: { id: 's1', title: 'New Title', artist: 'Art', duration: 100 } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.songCounts['s1'].count).toBe(2);
    expect(aggregates.songCounts['s1'].song.title).toBe('New Title');
  });

  it('updates genreCounts incrementally', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Art', genre: 'Rock', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'Art', genre: 'Rock', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '3', song: { id: 's3', title: 'C', artist: 'Art', genre: 'Jazz', duration: 100 } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.genreCounts['Rock']).toBe(2);
    expect(aggregates.genreCounts['Jazz']).toBe(1);
  });

  it('extracts genre from genres array with {name} objects', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({
      id: '1',
      song: { id: 's1', title: 'A', artist: 'Art', genres: [{ name: 'Rock' }], duration: 100 } as any,
    }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.genreCounts['Rock']).toBe(1);
    expect(aggregates.genreCounts['[object Object]']).toBeUndefined();
  });

  it('updates hourBuckets incrementally', () => {
    const time = new Date(2025, 0, 15, 14, 30).getTime();
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', time, song: { id: 's1', title: 'A', artist: 'Art', duration: 100 } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.hourBuckets[14]).toBe(1);
    expect(aggregates.hourBuckets.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('updates dayCounts incrementally', () => {
    const time1 = new Date(2025, 0, 15, 10).getTime();
    const time2 = new Date(2025, 0, 15, 14).getTime();
    const time3 = new Date(2025, 0, 16, 10).getTime();
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', time: time1, song: { id: 's1', title: 'A', artist: 'Art', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', time: time2, song: { id: 's2', title: 'B', artist: 'Art', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '3', time: time3, song: { id: 's3', title: 'C', artist: 'Art', duration: 100 } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.dayCounts['2025-01-15']).toBe(2);
    expect(aggregates.dayCounts['2025-01-16']).toBe(1);
  });

  it('handles missing artist by using Unknown', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A' } as any }));

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.artistCounts['Unknown']).toBe(1);
  });

  it('does not update aggregates on rejected scrobble', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '' }));
    const { aggregates } = completedScrobbleStore.getState();
    expect(Object.keys(aggregates.artistCounts)).toHaveLength(0);
    expect(Object.keys(aggregates.songCounts)).toHaveLength(0);
  });

  it('incremental aggregates match full rebuild', () => {
    for (let i = 0; i < 10; i++) {
      completedScrobbleStore.getState().addCompleted(
        validScrobble({
          id: `s-${i}`,
          song: { id: `song-${i % 3}`, title: `T${i}`, artist: `A${i % 2}`, album: `Alb${i % 4}`, genre: i % 2 === 0 ? 'Rock' : 'Jazz', duration: 100 } as any,
          time: new Date(2025, 0, 10 + (i % 5), i % 24).getTime(),
        }),
      );
    }
    const incrementalAgg = completedScrobbleStore.getState().aggregates;

    completedScrobbleStore.setState({ aggregates: { ...EMPTY_AGGREGATES, hourBuckets: new Array(24).fill(0) } });
    completedScrobbleStore.getState().rebuildAggregates();
    const rebuiltAgg = completedScrobbleStore.getState().aggregates;

    expect(incrementalAgg.artistCounts).toEqual(rebuiltAgg.artistCounts);
    expect(incrementalAgg.albumCounts).toEqual(rebuiltAgg.albumCounts);
    expect(incrementalAgg.genreCounts).toEqual(rebuiltAgg.genreCounts);
    expect(incrementalAgg.hourBuckets).toEqual(rebuiltAgg.hourBuckets);
    expect(incrementalAgg.dayCounts).toEqual(rebuiltAgg.dayCounts);
    for (const key of Object.keys(rebuiltAgg.songCounts)) {
      expect(incrementalAgg.songCounts[key].count).toBe(rebuiltAgg.songCounts[key].count);
    }
  });
});

describe('rebuildStats', () => {
  it('recomputes stats from scrobbles', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'A', duration: 100 } as any }));
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'B', duration: 200 } as any }));

    completedScrobbleStore.setState({ stats: EMPTY_STATS });
    completedScrobbleStore.getState().rebuildStats();

    const { stats } = completedScrobbleStore.getState();
    expect(stats.totalPlays).toBe(2);
    expect(stats.totalListeningSeconds).toBe(300);
    expect(stats.uniqueArtists).toEqual({ A: true, B: true });
  });

  it('rebuild is idempotent', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'A', duration: 100 } as any }));
    const statsAfterAdd = { ...completedScrobbleStore.getState().stats };
    completedScrobbleStore.getState().rebuildStats();
    const statsAfterRebuild = completedScrobbleStore.getState().stats;
    expect(statsAfterRebuild).toEqual(statsAfterAdd);
  });

  it('rebuild matches incremental stats exactly', () => {
    for (let i = 0; i < 5; i++) {
      completedScrobbleStore.getState().addCompleted(
        validScrobble({
          id: `s-${i}`,
          song: { id: `song-${i}`, title: `T${i}`, artist: `A${i % 2}`, duration: 50 * (i + 1) } as any,
        }),
      );
    }
    const incrementalStats = { ...completedScrobbleStore.getState().stats };
    completedScrobbleStore.setState({ stats: EMPTY_STATS });
    completedScrobbleStore.getState().rebuildStats();
    expect(completedScrobbleStore.getState().stats).toEqual(incrementalStats);
  });
});

describe('rebuildAggregates', () => {
  it('rebuilds all aggregate fields from scrobbles', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({
      id: '1',
      song: { id: 's1', title: 'A', artist: 'Art', album: 'Alb', genre: 'Rock', duration: 100 } as any,
      time: new Date(2025, 0, 15, 10).getTime(),
    }));
    completedScrobbleStore.getState().addCompleted(validScrobble({
      id: '2',
      song: { id: 's2', title: 'B', artist: 'Art', album: 'Alb', genre: 'Jazz', duration: 200 } as any,
      time: new Date(2025, 0, 15, 14).getTime(),
    }));

    completedScrobbleStore.setState({ aggregates: { ...EMPTY_AGGREGATES, hourBuckets: new Array(24).fill(0) } });
    completedScrobbleStore.getState().rebuildAggregates();

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.artistCounts['Art']).toBe(2);
    expect(aggregates.albumCounts['Alb::Art'].count).toBe(2);
    expect(aggregates.songCounts['s1'].count).toBe(1);
    expect(aggregates.songCounts['s2'].count).toBe(1);
    expect(aggregates.genreCounts['Rock']).toBe(1);
    expect(aggregates.genreCounts['Jazz']).toBe(1);
    expect(aggregates.hourBuckets[10]).toBe(1);
    expect(aggregates.hourBuckets[14]).toBe(1);
    expect(aggregates.dayCounts['2025-01-15']).toBe(2);
  });

  it('is idempotent', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 } as any }));
    const aggAfterAdd = { ...completedScrobbleStore.getState().aggregates };
    completedScrobbleStore.getState().rebuildAggregates();
    const aggAfterRebuild = completedScrobbleStore.getState().aggregates;
    expect(aggAfterRebuild.artistCounts).toEqual(aggAfterAdd.artistCounts);
    expect(aggAfterRebuild.dayCounts).toEqual(aggAfterAdd.dayCounts);
  });

  it('picks up album coverArt from later scrobbles', () => {
    completedScrobbleStore.setState({
      completedScrobbles: [
        validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Art', album: 'Alb', duration: 100 } as any }),
        validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'Art', album: 'Alb', coverArt: 'al-99', duration: 100 } as any }),
      ],
      stats: { ...EMPTY_STATS },
      aggregates: { ...EMPTY_AGGREGATES, hourBuckets: new Array(24).fill(0) },
    });
    completedScrobbleStore.getState().rebuildAggregates();

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.albumCounts['Alb::Art'].coverArt).toBe('al-99');
  });

  it('does not clear album coverArt when later scrobbles lack it', () => {
    completedScrobbleStore.setState({
      completedScrobbles: [
        validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Art', album: 'Alb', coverArt: 'al-99', duration: 100 } as any }),
        validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'Art', album: 'Alb', duration: 100 } as any }),
      ],
      stats: { ...EMPTY_STATS },
      aggregates: { ...EMPTY_AGGREGATES, hourBuckets: new Array(24).fill(0) },
    });
    completedScrobbleStore.getState().rebuildAggregates();

    const { aggregates } = completedScrobbleStore.getState();
    expect(aggregates.albumCounts['Alb::Art'].coverArt).toBe('al-99');
  });
});

describe('hydrateFromDb', () => {
  it('loads scrobbles from SQL, rebuilds derived state, and flips hasHydrated', () => {
    const rows: CompletedScrobble[] = [
      validScrobble({
        id: 'a',
        song: { id: 's1', title: 'A', artist: 'Art', duration: 100 } as any,
        time: new Date(2025, 0, 15, 10).getTime(),
      }),
      validScrobble({
        id: 'b',
        song: { id: 's2', title: 'B', artist: 'Art', duration: 200 } as any,
        time: new Date(2025, 0, 15, 14).getTime(),
      }),
    ];
    mockHydrateScrobbles.mockReturnValue(rows);

    completedScrobbleStore.getState().hydrateFromDb();

    const state = completedScrobbleStore.getState();
    expect(state.hasHydrated).toBe(true);
    expect(state.completedScrobbles).toEqual(rows);
    expect(state.stats.totalPlays).toBe(2);
    expect(state.stats.totalListeningSeconds).toBe(300);
    expect(state.aggregates.artistCounts['Art']).toBe(2);
    expect(state.aggregates.dayCounts['2025-01-15']).toBe(2);
  });

  it('is idempotent — second call re-reads and produces the same state', () => {
    mockHydrateScrobbles.mockReturnValue([
      validScrobble({ id: 'a', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 } as any }),
    ]);

    completedScrobbleStore.getState().hydrateFromDb();
    const firstState = completedScrobbleStore.getState();
    expect(firstState.hasHydrated).toBe(true);
    expect(firstState.completedScrobbles).toHaveLength(1);

    completedScrobbleStore.getState().hydrateFromDb();
    // Hydrate is intentionally re-callable (e.g. once from the auth-
    // rehydrated useEffect, once from the splash post-migration callback).
    // The SQL re-read is cheap; the end state is identical.
    expect(mockHydrateScrobbles).toHaveBeenCalledTimes(2);
    const secondState = completedScrobbleStore.getState();
    expect(secondState.hasHydrated).toBe(true);
    expect(secondState.completedScrobbles).toHaveLength(1);
  });

  it('hydrates empty when SQL returns no rows', () => {
    mockHydrateScrobbles.mockReturnValue([]);
    completedScrobbleStore.getState().hydrateFromDb();
    const state = completedScrobbleStore.getState();
    expect(state.hasHydrated).toBe(true);
    expect(state.completedScrobbles).toEqual([]);
    expect(state.stats).toEqual({ totalPlays: 0, totalListeningSeconds: 0, uniqueArtists: {} });
  });
});

describe('replaceAll', () => {
  it('writes to SQL and updates in-memory state with rebuilt stats/aggregates', () => {
    const scrobbles: CompletedScrobble[] = [
      validScrobble({ id: '1', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 } as any, time: new Date(2025, 0, 15, 10).getTime() }),
      validScrobble({ id: '2', song: { id: 's2', title: 'B', artist: 'Art', duration: 200 } as any, time: new Date(2025, 0, 15, 14).getTime() }),
    ];

    completedScrobbleStore.getState().replaceAll(scrobbles);

    expect(mockReplaceAllScrobbles).toHaveBeenCalledTimes(1);
    expect(mockReplaceAllScrobbles).toHaveBeenCalledWith(scrobbles);

    const state = completedScrobbleStore.getState();
    expect(state.completedScrobbles).toEqual(scrobbles);
    expect(state.stats.totalPlays).toBe(2);
    expect(state.stats.totalListeningSeconds).toBe(300);
    expect(state.aggregates.artistCounts['Art']).toBe(2);
  });

  it('drops invalid records and dedupes before writing to SQL', () => {
    const dirty = [
      validScrobble({ id: 'ok', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 } as any }),
      validScrobble({ id: 'ok', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 } as any }), // dup
      validScrobble({ id: '', song: { id: 's2', title: 'B' } as any }),
      validScrobble({ id: 'bad-song', song: { id: '', title: 'x' } as any }),
      validScrobble({ id: 'no-title', song: { id: 's3', title: '' } as any }),
      { id: 'null', song: null as any, time: Date.now() } as CompletedScrobble,
    ];

    completedScrobbleStore.getState().replaceAll(dirty);

    expect(mockReplaceAllScrobbles).toHaveBeenCalledTimes(1);
    const [cleaned] = mockReplaceAllScrobbles.mock.calls[0];
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].id).toBe('ok');

    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(1);
  });

  it('replaceAll with empty array resets the store to empty', () => {
    completedScrobbleStore.getState().addCompleted(validScrobble({ id: '1' }));
    completedScrobbleStore.getState().replaceAll([]);

    expect(mockReplaceAllScrobbles).toHaveBeenCalledWith([]);
    const state = completedScrobbleStore.getState();
    expect(state.completedScrobbles).toEqual([]);
    expect(state.stats.totalPlays).toBe(0);
    expect(state.aggregates.artistCounts).toEqual({});
  });
});

describe('clearCompletedScrobbleTable', () => {
  it('proxies to clearScrobbles on the persistence module', () => {
    clearCompletedScrobbleTable();
    expect(mockClearScrobbles).toHaveBeenCalledTimes(1);
  });
});
