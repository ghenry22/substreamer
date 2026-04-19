// Phase 2 rewrite of the music-cache store. Mirrors the mocking + write-through
// pattern used in `completedScrobbleStore.test.ts` -- every persistence call is
// a jest.fn so we can assert wiring, and `sqliteStorage` is swapped for the
// in-memory mock so the tiny settings blob round-trips.
jest.mock('../persistence/musicCacheTables', () => ({
  hydrateCachedSongs: jest.fn(() => ({})),
  hydrateCachedItems: jest.fn(() => ({})),
  hydrateDownloadQueue: jest.fn(() => []),
  insertDownloadQueueItem: jest.fn(),
  removeDownloadQueueItem: jest.fn(),
  updateDownloadQueueItem: jest.fn(),
  reorderDownloadQueue: jest.fn(),
  markDownloadComplete: jest.fn(),
  upsertCachedItem: jest.fn(),
  deleteCachedItem: jest.fn(),
  upsertCachedSong: jest.fn(),
  deleteCachedSong: jest.fn(),
  removeCachedItemSong: jest.fn(),
  reorderCachedItemSongs: jest.fn(),
  countSongRefs: jest.fn(() => 0),
  clearAllMusicCacheRows: jest.fn(),
}));

jest.mock('../sqliteStorage', () => require('../__mocks__/sqliteStorage'));

import {
  clearAllMusicCacheRows,
  countSongRefs,
  deleteCachedItem,
  deleteCachedSong,
  hydrateCachedItems,
  hydrateCachedSongs,
  hydrateDownloadQueue,
  insertDownloadQueueItem,
  markDownloadComplete,
  removeCachedItemSong,
  removeDownloadQueueItem,
  reorderCachedItemSongs,
  reorderDownloadQueue,
  updateDownloadQueueItem,
  upsertCachedItem,
  upsertCachedSong,
  type CachedItemRow,
  type CachedSongRow,
  type DownloadQueueRow,
} from '../persistence/musicCacheTables';
import {
  clearMusicCacheTables,
  musicCacheStore,
  type CachedItemMeta,
  type CachedSongMeta,
  type DownloadQueueItem,
} from '../musicCacheStore';
import { sqliteStorage } from '../sqliteStorage';

// jest.Mock typed handles -- importing named functions from the mocked module
// gives us the jest.fn spies.
const mockHydrateCachedSongs = hydrateCachedSongs as jest.Mock;
const mockHydrateCachedItems = hydrateCachedItems as jest.Mock;
const mockHydrateDownloadQueue = hydrateDownloadQueue as jest.Mock;
const mockInsertDownloadQueueItem = insertDownloadQueueItem as jest.Mock;
const mockRemoveDownloadQueueItem = removeDownloadQueueItem as jest.Mock;
const mockUpdateDownloadQueueItem = updateDownloadQueueItem as jest.Mock;
const mockReorderDownloadQueue = reorderDownloadQueue as jest.Mock;
const mockMarkDownloadComplete = markDownloadComplete as jest.Mock;
const mockUpsertCachedItem = upsertCachedItem as jest.Mock;
const mockDeleteCachedItem = deleteCachedItem as jest.Mock;
const mockUpsertCachedSong = upsertCachedSong as jest.Mock;
const mockDeleteCachedSong = deleteCachedSong as jest.Mock;
const mockRemoveCachedItemSong = removeCachedItemSong as jest.Mock;
const mockReorderCachedItemSongs = reorderCachedItemSongs as jest.Mock;
const mockCountSongRefs = countSongRefs as jest.Mock;
const mockClearAllMusicCacheRows = clearAllMusicCacheRows as jest.Mock;

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = 'substreamer-music-cache-settings';

function makeSong(id: string, overrides: Partial<CachedSongMeta> = {}): CachedSongMeta {
  return {
    id,
    title: `Song ${id}`,
    albumId: `album-${id}`,
    bytes: 1000,
    duration: 180,
    suffix: 'mp3',
    formatCapturedAt: 1,
    downloadedAt: 1,
    ...overrides,
  };
}

function makeItem(
  itemId: string,
  songIds: string[] = [],
  overrides: Partial<CachedItemMeta> = {},
): CachedItemMeta {
  return {
    itemId,
    type: 'album',
    name: `Item ${itemId}`,
    expectedSongCount: songIds.length,
    lastSyncAt: 1,
    downloadedAt: 1,
    songIds,
    ...overrides,
  };
}

function makeItemRow(itemId: string, songIds: string[]): CachedItemRow {
  return makeItem(itemId, songIds);
}

function makeSongRow(id: string): CachedSongRow {
  return makeSong(id);
}

function makeQueueDraft(itemId: string, totalSongs = 5): Omit<
  DownloadQueueItem,
  'queueId' | 'status' | 'completedSongs' | 'addedAt' | 'queuePosition'
> {
  return {
    itemId,
    type: 'album',
    name: `Item ${itemId}`,
    totalSongs,
    songsJson: '[]',
  };
}

function resetStore() {
  musicCacheStore.setState({
    cachedSongs: {},
    cachedItems: {},
    downloadQueue: [],
    maxConcurrentDownloads: 3,
    totalBytes: 0,
    totalFiles: 0,
    hasHydrated: false,
  });
}

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  resetStore();
  jest.clearAllMocks();
  // Default hydrate returns: empty.
  mockHydrateCachedSongs.mockReturnValue({});
  mockHydrateCachedItems.mockReturnValue({});
  mockHydrateDownloadQueue.mockReturnValue([]);
  mockCountSongRefs.mockReturnValue(0);
  // Wipe the in-memory sqliteStorage mock between tests.
  sqliteStorage.removeItem(SETTINGS_KEY);
});

/* ------------------------------------------------------------------ */
/*  enqueue                                                            */
/* ------------------------------------------------------------------ */

describe('enqueue', () => {
  it('appends a new queue row with generated id, queued status, and position 1', () => {
    musicCacheStore.getState().enqueue(makeQueueDraft('album-1', 3));

    const { downloadQueue } = musicCacheStore.getState();
    expect(downloadQueue).toHaveLength(1);
    expect(downloadQueue[0].queueId).toMatch(/^\d+-[a-z0-9]+$/);
    expect(downloadQueue[0].status).toBe('queued');
    expect(downloadQueue[0].completedSongs).toBe(0);
    expect(downloadQueue[0].queuePosition).toBe(1);
    expect(downloadQueue[0].itemId).toBe('album-1');

    expect(mockInsertDownloadQueueItem).toHaveBeenCalledTimes(1);
    expect(mockInsertDownloadQueueItem).toHaveBeenCalledWith(downloadQueue[0]);
  });

  it('assigns ascending queuePositions for consecutive enqueues', () => {
    musicCacheStore.getState().enqueue(makeQueueDraft('a'));
    musicCacheStore.getState().enqueue(makeQueueDraft('b'));
    musicCacheStore.getState().enqueue(makeQueueDraft('c'));
    const { downloadQueue } = musicCacheStore.getState();
    expect(downloadQueue.map((q) => q.queuePosition)).toEqual([1, 2, 3]);
    expect(mockInsertDownloadQueueItem).toHaveBeenCalledTimes(3);
  });

  it('skips duplicate itemId already in the queue', () => {
    musicCacheStore.getState().enqueue(makeQueueDraft('a'));
    musicCacheStore.getState().enqueue(makeQueueDraft('a'));
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
    expect(mockInsertDownloadQueueItem).toHaveBeenCalledTimes(1);
  });

  it('skips itemId that is already a cached item', () => {
    musicCacheStore.setState({ cachedItems: { 'a': makeItem('a', ['s1']) } });
    musicCacheStore.getState().enqueue(makeQueueDraft('a'));
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
    expect(mockInsertDownloadQueueItem).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  removeFromQueue                                                    */
/* ------------------------------------------------------------------ */

describe('removeFromQueue', () => {
  it('removes the matching row from SQL and in-memory queue', () => {
    musicCacheStore.getState().enqueue(makeQueueDraft('a'));
    musicCacheStore.getState().enqueue(makeQueueDraft('b'));
    const qid = musicCacheStore.getState().downloadQueue[0].queueId;

    musicCacheStore.getState().removeFromQueue(qid);

    expect(mockRemoveDownloadQueueItem).toHaveBeenCalledWith(qid);
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
    expect(musicCacheStore.getState().downloadQueue[0].itemId).toBe('b');
  });

  it('is a no-op when queueId is absent in memory but still calls persistence', () => {
    musicCacheStore.getState().removeFromQueue('does-not-exist');
    // Persistence is still called -- the store doesn't pre-filter unknown IDs.
    expect(mockRemoveDownloadQueueItem).toHaveBeenCalledWith('does-not-exist');
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  reorderQueue                                                       */
/* ------------------------------------------------------------------ */

describe('reorderQueue', () => {
  function seed(count: number) {
    for (let i = 0; i < count; i++) {
      musicCacheStore.getState().enqueue(makeQueueDraft(`item-${i}`));
    }
    // Ignore the insertDownloadQueueItem calls from setup.
    mockInsertDownloadQueueItem.mockClear();
  }

  it('moves forward (smaller index to larger) and uses 1-indexed SQL positions', () => {
    seed(4);
    musicCacheStore.getState().reorderQueue(0, 2);
    expect(mockReorderDownloadQueue).toHaveBeenCalledWith(1, 3);
    expect(musicCacheStore.getState().downloadQueue.map((q) => q.itemId)).toEqual([
      'item-1',
      'item-2',
      'item-0',
      'item-3',
    ]);
  });

  it('moves backward (larger index to smaller)', () => {
    seed(4);
    musicCacheStore.getState().reorderQueue(3, 1);
    expect(mockReorderDownloadQueue).toHaveBeenCalledWith(4, 2);
    expect(musicCacheStore.getState().downloadQueue.map((q) => q.itemId)).toEqual([
      'item-0',
      'item-3',
      'item-1',
      'item-2',
    ]);
  });

  it('no-op when from===to', () => {
    seed(3);
    musicCacheStore.getState().reorderQueue(1, 1);
    expect(mockReorderDownloadQueue).not.toHaveBeenCalled();
  });

  it('no-op when from is out of range', () => {
    seed(3);
    musicCacheStore.getState().reorderQueue(-1, 1);
    musicCacheStore.getState().reorderQueue(10, 1);
    expect(mockReorderDownloadQueue).not.toHaveBeenCalled();
  });

  it('no-op when to is out of range', () => {
    seed(3);
    musicCacheStore.getState().reorderQueue(0, -1);
    musicCacheStore.getState().reorderQueue(0, 99);
    expect(mockReorderDownloadQueue).not.toHaveBeenCalled();
  });

  it('no-op when queue is empty', () => {
    musicCacheStore.getState().reorderQueue(0, 0);
    expect(mockReorderDownloadQueue).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  updateQueueItem                                                    */
/* ------------------------------------------------------------------ */

describe('updateQueueItem', () => {
  it('writes the partial update to SQL and maps it in memory', () => {
    musicCacheStore.getState().enqueue(makeQueueDraft('a'));
    const qid = musicCacheStore.getState().downloadQueue[0].queueId;

    musicCacheStore.getState().updateQueueItem(qid, {
      status: 'downloading',
      completedSongs: 2,
    });

    expect(mockUpdateDownloadQueueItem).toHaveBeenCalledWith(qid, {
      status: 'downloading',
      completedSongs: 2,
    });
    const row = musicCacheStore.getState().downloadQueue.find((q) => q.queueId === qid)!;
    expect(row.status).toBe('downloading');
    expect(row.completedSongs).toBe(2);
  });

  it('leaves non-matching rows alone', () => {
    musicCacheStore.getState().enqueue(makeQueueDraft('a'));
    musicCacheStore.getState().enqueue(makeQueueDraft('b'));
    const [first, second] = musicCacheStore.getState().downloadQueue;

    musicCacheStore.getState().updateQueueItem(first.queueId, { status: 'error', error: 'boom' });
    const after = musicCacheStore.getState().downloadQueue;
    expect(after[0].status).toBe('error');
    expect(after[0].error).toBe('boom');
    expect(after[1]).toEqual(second);
  });
});

/* ------------------------------------------------------------------ */
/*  markItemComplete                                                   */
/* ------------------------------------------------------------------ */

describe('markItemComplete', () => {
  it('delegates to markDownloadComplete and mirrors item + songs in memory', () => {
    musicCacheStore.getState().enqueue(makeQueueDraft('a'));
    const qid = musicCacheStore.getState().downloadQueue[0].queueId;

    const item = makeItem('a', []) as Omit<CachedItemMeta, 'songIds'>;
    const songs = [makeSong('s1'), makeSong('s2'), makeSong('s3')];
    // Intentionally out of order to exercise the sort.
    const edges = [
      { songId: 's3', position: 3 },
      { songId: 's1', position: 1 },
      { songId: 's2', position: 2 },
    ];

    musicCacheStore.getState().markItemComplete(qid, item, songs, edges);

    expect(mockMarkDownloadComplete).toHaveBeenCalledWith(qid, item, songs, edges);
    const state = musicCacheStore.getState();
    expect(state.downloadQueue).toHaveLength(0);
    expect(state.cachedItems['a']).toBeDefined();
    expect(state.cachedItems['a'].songIds).toEqual(['s1', 's2', 's3']);
    expect(state.cachedSongs['s1']).toEqual(songs[0]);
    expect(state.cachedSongs['s2']).toEqual(songs[1]);
    expect(state.cachedSongs['s3']).toEqual(songs[2]);
  });

  it('preserves existing cached songs from other items', () => {
    musicCacheStore.setState({ cachedSongs: { existing: makeSong('existing') } });
    musicCacheStore.getState().markItemComplete(
      'q1',
      makeItem('a', []) as Omit<CachedItemMeta, 'songIds'>,
      [makeSong('new')],
      [{ songId: 'new', position: 1 }],
    );
    const state = musicCacheStore.getState();
    expect(state.cachedSongs['existing']).toBeDefined();
    expect(state.cachedSongs['new']).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  upsertCachedItem                                                   */
/* ------------------------------------------------------------------ */

describe('upsertCachedItem', () => {
  it('inserts new item with empty songIds when none provided', () => {
    const item: Omit<CachedItemMeta, 'songIds'> = makeItem('a', []);
    musicCacheStore.getState().upsertCachedItem(item);
    expect(mockUpsertCachedItem).toHaveBeenCalledWith(item);
    expect(musicCacheStore.getState().cachedItems['a'].songIds).toEqual([]);
  });

  it('inserts new item with explicit songIds when provided', () => {
    musicCacheStore.getState().upsertCachedItem(makeItem('a', []), ['s1', 's2']);
    expect(musicCacheStore.getState().cachedItems['a'].songIds).toEqual(['s1', 's2']);
  });

  it('preserves existing songIds when new upsert omits them', () => {
    musicCacheStore.setState({ cachedItems: { a: makeItem('a', ['s1', 's2']) } });
    musicCacheStore.getState().upsertCachedItem(
      makeItem('a', [], { expectedSongCount: 99 }) as Omit<CachedItemMeta, 'songIds'>,
    );
    const next = musicCacheStore.getState().cachedItems['a'];
    expect(next.songIds).toEqual(['s1', 's2']);
    expect(next.expectedSongCount).toBe(99);
  });

  it('replaces songIds when new ones are explicitly provided', () => {
    musicCacheStore.setState({ cachedItems: { a: makeItem('a', ['s1', 's2']) } });
    musicCacheStore.getState().upsertCachedItem(makeItem('a', []), ['only-new']);
    expect(musicCacheStore.getState().cachedItems['a'].songIds).toEqual(['only-new']);
  });
});

/* ------------------------------------------------------------------ */
/*  removeCachedItem                                                   */
/* ------------------------------------------------------------------ */

describe('removeCachedItem', () => {
  it('removes item and all songs whose refcount drops to 0', () => {
    musicCacheStore.setState({
      cachedItems: { a: makeItem('a', ['s1', 's2']) },
      cachedSongs: { s1: makeSong('s1'), s2: makeSong('s2') },
    });
    mockCountSongRefs.mockReturnValue(0);

    const orphans = musicCacheStore.getState().removeCachedItem('a');

    expect(mockDeleteCachedItem).toHaveBeenCalledWith('a');
    expect(mockCountSongRefs).toHaveBeenCalledTimes(2);
    expect(mockCountSongRefs).toHaveBeenCalledWith('s1');
    expect(mockCountSongRefs).toHaveBeenCalledWith('s2');
    expect(mockDeleteCachedSong).toHaveBeenCalledTimes(2);
    expect(mockDeleteCachedSong).toHaveBeenCalledWith('s1');
    expect(mockDeleteCachedSong).toHaveBeenCalledWith('s2');
    expect(orphans).toEqual(['s1', 's2']);
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a']).toBeUndefined();
    expect(state.cachedSongs).toEqual({});
  });

  it('keeps songs that are still referenced by another item', () => {
    musicCacheStore.setState({
      cachedItems: {
        a: makeItem('a', ['s1', 's2']),
        b: makeItem('b', ['s1']),
      },
      cachedSongs: { s1: makeSong('s1'), s2: makeSong('s2') },
    });
    // s1 still referenced by 'b', s2 orphaned.
    mockCountSongRefs.mockImplementation((songId: string) => (songId === 's1' ? 1 : 0));

    const orphans = musicCacheStore.getState().removeCachedItem('a');

    expect(orphans).toEqual(['s2']);
    expect(mockDeleteCachedSong).toHaveBeenCalledTimes(1);
    expect(mockDeleteCachedSong).toHaveBeenCalledWith('s2');
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a']).toBeUndefined();
    expect(state.cachedItems['b']).toBeDefined();
    expect(state.cachedSongs['s1']).toBeDefined();
    expect(state.cachedSongs['s2']).toBeUndefined();
  });

  it('returns empty array when item is unknown', () => {
    const orphans = musicCacheStore.getState().removeCachedItem('unknown');
    expect(orphans).toEqual([]);
    // deleteCachedItem still runs idempotently at persistence layer.
    expect(mockDeleteCachedItem).toHaveBeenCalledWith('unknown');
    expect(mockDeleteCachedSong).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  removeCachedItemSong                                               */
/* ------------------------------------------------------------------ */

describe('removeCachedItemSong', () => {
  it('removes edge + deletes song when refcount drops to 0', () => {
    musicCacheStore.setState({
      cachedItems: { a: makeItem('a', ['s1', 's2', 's3']) },
      cachedSongs: { s1: makeSong('s1'), s2: makeSong('s2'), s3: makeSong('s3') },
    });
    mockCountSongRefs.mockReturnValue(0);

    const result = musicCacheStore.getState().removeCachedItemSong('a', 2);

    expect(mockRemoveCachedItemSong).toHaveBeenCalledWith('a', 2);
    expect(mockCountSongRefs).toHaveBeenCalledWith('s2');
    expect(mockDeleteCachedSong).toHaveBeenCalledWith('s2');
    expect(result).toEqual({ orphanedSongId: 's2' });
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a'].songIds).toEqual(['s1', 's3']);
    expect(state.cachedSongs['s2']).toBeUndefined();
    expect(state.cachedSongs['s1']).toBeDefined();
    expect(state.cachedSongs['s3']).toBeDefined();
  });

  it('removes edge but keeps song when refcount > 0', () => {
    musicCacheStore.setState({
      cachedItems: { a: makeItem('a', ['s1', 's2']) },
      cachedSongs: { s1: makeSong('s1'), s2: makeSong('s2') },
    });
    mockCountSongRefs.mockReturnValue(1);

    const result = musicCacheStore.getState().removeCachedItemSong('a', 1);

    expect(result).toEqual({ orphanedSongId: null });
    expect(mockDeleteCachedSong).not.toHaveBeenCalled();
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a'].songIds).toEqual(['s2']);
    expect(state.cachedSongs['s1']).toBeDefined();
  });

  it('returns null orphanedSongId when item is unknown', () => {
    const result = musicCacheStore.getState().removeCachedItemSong('unknown', 1);
    expect(result).toEqual({ orphanedSongId: null });
    expect(mockRemoveCachedItemSong).not.toHaveBeenCalled();
    expect(mockDeleteCachedSong).not.toHaveBeenCalled();
  });

  it('returns null when position is out of range (low)', () => {
    musicCacheStore.setState({ cachedItems: { a: makeItem('a', ['s1']) } });
    const result = musicCacheStore.getState().removeCachedItemSong('a', 0);
    expect(result).toEqual({ orphanedSongId: null });
    expect(mockRemoveCachedItemSong).not.toHaveBeenCalled();
  });

  it('returns null when position is out of range (high)', () => {
    musicCacheStore.setState({ cachedItems: { a: makeItem('a', ['s1']) } });
    const result = musicCacheStore.getState().removeCachedItemSong('a', 2);
    expect(result).toEqual({ orphanedSongId: null });
    expect(mockRemoveCachedItemSong).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  reorderCachedItemSongs                                             */
/* ------------------------------------------------------------------ */

describe('reorderCachedItemSongs', () => {
  it('moves forward and updates both SQL and in-memory order', () => {
    musicCacheStore.setState({
      cachedItems: { a: makeItem('a', ['s1', 's2', 's3', 's4']) },
    });
    musicCacheStore.getState().reorderCachedItemSongs('a', 1, 3);
    expect(mockReorderCachedItemSongs).toHaveBeenCalledWith('a', 1, 3);
    expect(musicCacheStore.getState().cachedItems['a'].songIds).toEqual([
      's2', 's3', 's1', 's4',
    ]);
  });

  it('moves backward', () => {
    musicCacheStore.setState({
      cachedItems: { a: makeItem('a', ['s1', 's2', 's3', 's4']) },
    });
    musicCacheStore.getState().reorderCachedItemSongs('a', 4, 2);
    expect(mockReorderCachedItemSongs).toHaveBeenCalledWith('a', 4, 2);
    expect(musicCacheStore.getState().cachedItems['a'].songIds).toEqual([
      's1', 's4', 's2', 's3',
    ]);
  });

  it('no-op when item is unknown', () => {
    musicCacheStore.getState().reorderCachedItemSongs('unknown', 1, 2);
    expect(mockReorderCachedItemSongs).not.toHaveBeenCalled();
  });

  it('no-op when from===to', () => {
    musicCacheStore.setState({ cachedItems: { a: makeItem('a', ['s1', 's2']) } });
    musicCacheStore.getState().reorderCachedItemSongs('a', 1, 1);
    expect(mockReorderCachedItemSongs).not.toHaveBeenCalled();
  });

  it('no-op when positions are out of range', () => {
    musicCacheStore.setState({ cachedItems: { a: makeItem('a', ['s1', 's2']) } });
    musicCacheStore.getState().reorderCachedItemSongs('a', 0, 1);
    musicCacheStore.getState().reorderCachedItemSongs('a', 1, 99);
    expect(mockReorderCachedItemSongs).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  upsertCachedSong / deleteCachedSong                                */
/* ------------------------------------------------------------------ */

describe('upsertCachedSong', () => {
  it('writes to SQL and merges into cachedSongs', () => {
    const song = makeSong('new');
    musicCacheStore.getState().upsertCachedSong(song);
    expect(mockUpsertCachedSong).toHaveBeenCalledWith(song);
    expect(musicCacheStore.getState().cachedSongs['new']).toEqual(song);
  });

  it('overwrites existing song entry', () => {
    musicCacheStore.setState({ cachedSongs: { s1: makeSong('s1', { bytes: 1 }) } });
    musicCacheStore.getState().upsertCachedSong(makeSong('s1', { bytes: 999 }));
    expect(musicCacheStore.getState().cachedSongs['s1'].bytes).toBe(999);
  });
});

describe('deleteCachedSong', () => {
  it('removes song from SQL and in-memory record', () => {
    musicCacheStore.setState({ cachedSongs: { s1: makeSong('s1') } });
    musicCacheStore.getState().deleteCachedSong('s1');
    expect(mockDeleteCachedSong).toHaveBeenCalledWith('s1');
    expect(musicCacheStore.getState().cachedSongs['s1']).toBeUndefined();
  });

  it('is tolerant when song is not present in memory', () => {
    musicCacheStore.getState().deleteCachedSong('missing');
    expect(mockDeleteCachedSong).toHaveBeenCalledWith('missing');
    expect(musicCacheStore.getState().cachedSongs).toEqual({});
  });
});

/* ------------------------------------------------------------------ */
/*  Settings / aggregates                                              */
/* ------------------------------------------------------------------ */

describe('setMaxConcurrentDownloads', () => {
  it('writes the settings blob and updates state', () => {
    musicCacheStore.getState().setMaxConcurrentDownloads(5);
    expect(musicCacheStore.getState().maxConcurrentDownloads).toBe(5);
    const raw = sqliteStorage.getItem(SETTINGS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ maxConcurrentDownloads: 5 });
  });

  it('persists the three valid values (1 | 3 | 5)', () => {
    for (const n of [1, 3, 5] as const) {
      musicCacheStore.getState().setMaxConcurrentDownloads(n);
      expect(JSON.parse(sqliteStorage.getItem(SETTINGS_KEY) as string)).toEqual({
        maxConcurrentDownloads: n,
      });
      expect(musicCacheStore.getState().maxConcurrentDownloads).toBe(n);
    }
  });
});

describe('addBytes / addFiles / recalculate', () => {
  it('addBytes mutates in-memory only', () => {
    musicCacheStore.getState().addBytes(500);
    expect(musicCacheStore.getState().totalBytes).toBe(500);
    musicCacheStore.getState().addBytes(200);
    expect(musicCacheStore.getState().totalBytes).toBe(700);
    // No persistence-level calls.
    expect(mockUpsertCachedSong).not.toHaveBeenCalled();
    expect(mockUpsertCachedItem).not.toHaveBeenCalled();
    expect(mockInsertDownloadQueueItem).not.toHaveBeenCalled();
  });

  it('addFiles mutates in-memory only', () => {
    musicCacheStore.getState().addFiles(3);
    expect(musicCacheStore.getState().totalFiles).toBe(3);
    musicCacheStore.getState().addFiles(2);
    expect(musicCacheStore.getState().totalFiles).toBe(5);
    expect(mockUpsertCachedSong).not.toHaveBeenCalled();
  });

  it('recalculate overwrites aggregates and does not touch persistence', () => {
    musicCacheStore.setState({ totalBytes: 1, totalFiles: 1 });
    musicCacheStore.getState().recalculate({ totalBytes: 42, totalFiles: 7 });
    const s = musicCacheStore.getState();
    expect(s.totalBytes).toBe(42);
    expect(s.totalFiles).toBe(7);
    expect(mockUpsertCachedSong).not.toHaveBeenCalled();
    expect(mockUpsertCachedItem).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  reset                                                              */
/* ------------------------------------------------------------------ */

describe('reset', () => {
  it('wipes persistence + settings blob + in-memory state', () => {
    musicCacheStore.setState({
      cachedSongs: { s1: makeSong('s1') },
      cachedItems: { a: makeItem('a', ['s1']) },
      downloadQueue: [],
      totalBytes: 1000,
      totalFiles: 1,
      maxConcurrentDownloads: 5,
      hasHydrated: true,
    });
    sqliteStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxConcurrentDownloads: 5 }));

    musicCacheStore.getState().reset();

    expect(mockClearAllMusicCacheRows).toHaveBeenCalledTimes(1);
    expect(sqliteStorage.getItem(SETTINGS_KEY)).toBeNull();
    const s = musicCacheStore.getState();
    expect(s.cachedSongs).toEqual({});
    expect(s.cachedItems).toEqual({});
    expect(s.downloadQueue).toEqual([]);
    expect(s.totalBytes).toBe(0);
    expect(s.totalFiles).toBe(0);
    expect(s.maxConcurrentDownloads).toBe(3);
    expect(s.hasHydrated).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  hydrateFromDb                                                      */
/* ------------------------------------------------------------------ */

describe('hydrateFromDb', () => {
  it('loads songs, items, queue, and settings; computes totals; flips hasHydrated', () => {
    const songs: Record<string, CachedSongRow> = {
      s1: makeSongRow('s1'),
      s2: { ...makeSongRow('s2'), bytes: 2500 },
    };
    const items: Record<string, CachedItemRow> = {
      a: makeItemRow('a', ['s1', 's2']),
    };
    const queue: DownloadQueueRow[] = [
      {
        queueId: 'q1',
        itemId: 'z',
        type: 'album',
        name: 'Queued',
        status: 'queued',
        totalSongs: 1,
        completedSongs: 0,
        addedAt: 1,
        queuePosition: 1,
        songsJson: '[]',
      },
    ];

    mockHydrateCachedSongs.mockReturnValue(songs);
    mockHydrateCachedItems.mockReturnValue(items);
    mockHydrateDownloadQueue.mockReturnValue(queue);
    sqliteStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxConcurrentDownloads: 5 }));

    musicCacheStore.getState().hydrateFromDb();

    const s = musicCacheStore.getState();
    expect(s.cachedSongs).toEqual(songs);
    expect(s.cachedItems).toEqual(items);
    expect(s.downloadQueue).toEqual(queue);
    expect(s.maxConcurrentDownloads).toBe(5);
    expect(s.totalBytes).toBe(1000 + 2500);
    expect(s.totalFiles).toBe(2);
    expect(s.hasHydrated).toBe(true);
  });

  it('is idempotent -- second call re-reads and produces the same state', () => {
    mockHydrateCachedSongs.mockReturnValue({ s: makeSong('s') });
    musicCacheStore.getState().hydrateFromDb();
    expect(mockHydrateCachedSongs).toHaveBeenCalledTimes(1);
    const first = musicCacheStore.getState();
    expect(first.hasHydrated).toBe(true);
    musicCacheStore.getState().hydrateFromDb();
    // Hydrate is re-callable by design (see `hydratePerRowStores.ts`).
    // Second call re-reads SQL and produces the same state.
    expect(mockHydrateCachedSongs).toHaveBeenCalledTimes(2);
    const second = musicCacheStore.getState();
    expect(second.hasHydrated).toBe(true);
  });

  it('defaults maxConcurrentDownloads=3 when settings blob is absent', () => {
    // Ensure no settings row exists.
    sqliteStorage.removeItem(SETTINGS_KEY);
    musicCacheStore.getState().hydrateFromDb();
    expect(musicCacheStore.getState().maxConcurrentDownloads).toBe(3);
  });

  it('defaults maxConcurrentDownloads=3 when settings blob is malformed JSON', () => {
    sqliteStorage.setItem(SETTINGS_KEY, 'not-json{');
    musicCacheStore.getState().hydrateFromDb();
    expect(musicCacheStore.getState().maxConcurrentDownloads).toBe(3);
  });

  it('defaults maxConcurrentDownloads=3 when blob has an invalid value', () => {
    sqliteStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxConcurrentDownloads: 9 }));
    musicCacheStore.getState().hydrateFromDb();
    expect(musicCacheStore.getState().maxConcurrentDownloads).toBe(3);
  });

  it('hydrates empty when all sources are empty', () => {
    musicCacheStore.getState().hydrateFromDb();
    const s = musicCacheStore.getState();
    expect(s.cachedSongs).toEqual({});
    expect(s.cachedItems).toEqual({});
    expect(s.downloadQueue).toEqual([]);
    expect(s.totalBytes).toBe(0);
    expect(s.totalFiles).toBe(0);
    expect(s.maxConcurrentDownloads).toBe(3);
    expect(s.hasHydrated).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  clearMusicCacheTables                                              */
/* ------------------------------------------------------------------ */

describe('clearMusicCacheTables', () => {
  it('proxies to clearAllMusicCacheRows on the persistence module', () => {
    clearMusicCacheTables();
    expect(mockClearAllMusicCacheRows).toHaveBeenCalledTimes(1);
  });
});
