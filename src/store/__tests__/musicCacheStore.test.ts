// Phase 2 rewrite of the music-cache store. Mirrors the mocking + write-through
// pattern used in `completedScrobbleStore.test.ts` -- every persistence call is
// a jest.fn so we can assert wiring, and `kvStorage` is swapped for the
// in-memory mock so the tiny settings blob round-trips.
jest.mock('../persistence/musicCacheTables', () => ({
  hydrateCachedSongs: jest.fn(() => ({})),
  hydrateCachedItems: jest.fn(() => ({})),
  hydrateCachedSongsAsync: jest.fn(async () => ({})),
  hydrateCachedItemsAsync: jest.fn(async () => ({})),
  hydrateDownloadQueueAsync: jest.fn(async () => []),
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
  orphanSongIfUnreferencedAsync: jest.fn(async () => ({
    orphaned: false,
    affectedItems: [],
    prunedItems: [],
  })),
  clearAllMusicCacheRows: jest.fn(),
}));

jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import {
  clearAllMusicCacheRows,
  deleteCachedItem,
  deleteCachedSong,
  hydrateCachedItems,
  hydrateCachedItemsAsync,
  hydrateCachedSongs,
  hydrateCachedSongsAsync,
  hydrateDownloadQueueAsync,
  insertDownloadQueueItem,
  markDownloadComplete,
  orphanSongIfUnreferencedAsync,
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
import { kvStorage } from '../persistence';

// jest.Mock typed handles -- importing named functions from the mocked module
// gives us the jest.fn spies.
const mockHydrateCachedSongs = hydrateCachedSongs as jest.Mock;
const mockHydrateCachedItems = hydrateCachedItems as jest.Mock;
const mockHydrateCachedSongsAsync = hydrateCachedSongsAsync as jest.Mock;
const mockHydrateCachedItemsAsync = hydrateCachedItemsAsync as jest.Mock;
const mockHydrateDownloadQueueAsync = hydrateDownloadQueueAsync as jest.Mock;
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
const mockOrphanSongIfUnreferencedAsync = orphanSongIfUnreferencedAsync as jest.Mock;
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
  mockHydrateCachedSongsAsync.mockResolvedValue({});
  mockHydrateCachedItemsAsync.mockResolvedValue({});
  mockHydrateDownloadQueueAsync.mockResolvedValue([]);
  // Orphan-path default: every song orphans, touching/pruning nothing extra.
  // Individual scenarios override this.
  mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
    orphaned: true,
    affectedItems: [],
    prunedItems: [],
  });
  // Wipe the in-memory kvStorage mock between tests.
  kvStorage.removeItem(SETTINGS_KEY);
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
/*  enqueueTopUp                                                       */
/* ------------------------------------------------------------------ */

describe('enqueueTopUp', () => {
  it('bypasses the cachedItems guard (allows re-queuing a partial album)', () => {
    musicCacheStore.setState({
      cachedItems: { 'album-1': makeItem('album-1', ['s1', 's2']) },
    });
    musicCacheStore.getState().enqueueTopUp(makeQueueDraft('album-1', 3));
    const queue = musicCacheStore.getState().downloadQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].itemId).toBe('album-1');
    expect(queue[0].status).toBe('queued');
    expect(queue[0].completedSongs).toBe(0);
  });

  it('still dedupes against an existing queue entry for the same itemId', () => {
    musicCacheStore.getState().enqueueTopUp(makeQueueDraft('album-1'));
    musicCacheStore.getState().enqueueTopUp(makeQueueDraft('album-1'));
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(1);
  });

  it('contrast: plain enqueue refuses when item is already cached', () => {
    musicCacheStore.setState({
      cachedItems: { 'album-1': makeItem('album-1', ['s1']) },
    });
    musicCacheStore.getState().enqueue(makeQueueDraft('album-1'));
    expect(musicCacheStore.getState().downloadQueue).toHaveLength(0);
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

  it('merges edges into existing row on top-up: preserves downloadedAt, appends new songIds', () => {
    // Seed an existing partial album with 3 of 10 songs and a known
    // downloadedAt timestamp that must survive the merge.
    musicCacheStore.setState({
      cachedItems: {
        a: {
          itemId: 'a',
          type: 'album',
          name: 'Album A',
          expectedSongCount: 10,
          lastSyncAt: 100,
          downloadedAt: 111,
          songIds: ['s1', 's2', 's3'],
        },
      },
    });
    musicCacheStore.getState().enqueue(makeQueueDraft('top-up-q'));
    const qid = musicCacheStore.getState().downloadQueue[0].queueId;

    const item: Omit<CachedItemMeta, 'songIds'> = {
      itemId: 'a',
      type: 'album',
      name: 'Album A',
      expectedSongCount: 10,
      lastSyncAt: 999, // new lastSyncAt
      downloadedAt: 999, // CALLER sends "now" — should be ignored in favour of existing
    };
    const songs = [makeSong('s4'), makeSong('s5'), makeSong('s6')];
    const edges = [
      { songId: 's4', position: 1 },
      { songId: 's5', position: 2 },
      { songId: 's6', position: 3 },
    ];
    musicCacheStore.getState().markItemComplete(qid, item, songs, edges);

    const merged = musicCacheStore.getState().cachedItems['a'];
    expect(merged.songIds).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(merged.downloadedAt).toBe(111); // preserved
    expect(merged.lastSyncAt).toBe(999); // refreshed
    expect(merged.expectedSongCount).toBe(10);
  });

  it('dedupes songIds on merge (song already edged to the item is not re-added)', () => {
    musicCacheStore.setState({
      cachedItems: {
        a: {
          itemId: 'a',
          type: 'album',
          name: 'Album A',
          expectedSongCount: 5,
          lastSyncAt: 100,
          downloadedAt: 100,
          songIds: ['s1', 's2'],
        },
      },
    });
    musicCacheStore.getState().markItemComplete(
      'q',
      {
        itemId: 'a',
        type: 'album',
        name: 'Album A',
        expectedSongCount: 5,
        lastSyncAt: 200,
        downloadedAt: 200,
      },
      [makeSong('s2'), makeSong('s3')],
      [
        { songId: 's2', position: 1 },
        { songId: 's3', position: 2 },
      ],
    );
    expect(musicCacheStore.getState().cachedItems['a'].songIds).toEqual(['s1', 's2', 's3']);
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
  it('removes item and all songs whose REAL refcount drops to 0', async () => {
    musicCacheStore.setState({
      cachedItems: { a: makeItem('a', ['s1', 's2']) },
      cachedSongs: { s1: makeSong('s1'), s2: makeSong('s2') },
      totalBytes: 2000,
      totalFiles: 2,
    });
    // No REAL holder remains for either song → both orphan (atomic count+orphan
    // fused into orphanSongIfUnreferencedAsync).
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: true,
      affectedItems: [],
      prunedItems: [],
    });

    const orphans = await musicCacheStore.getState().removeCachedItem('a');

    expect(mockDeleteCachedItem).toHaveBeenCalledWith('a');
    expect(mockOrphanSongIfUnreferencedAsync).toHaveBeenCalledTimes(2);
    expect(mockOrphanSongIfUnreferencedAsync).toHaveBeenCalledWith('s1');
    expect(mockOrphanSongIfUnreferencedAsync).toHaveBeenCalledWith('s2');
    expect(mockDeleteCachedSong).not.toHaveBeenCalled();
    expect(orphans).toEqual(['s1', 's2']);
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a']).toBeUndefined();
    expect(state.cachedSongs).toEqual({});
    // Disk-usage aggregates decrement by the orphaned songs (2 × 1000 bytes).
    expect(state.totalBytes).toBe(0);
    expect(state.totalFiles).toBe(0);
  });

  it('keeps songs that still have a REAL holder (another item)', async () => {
    musicCacheStore.setState({
      cachedItems: {
        a: makeItem('a', ['s1', 's2']),
        b: makeItem('b', ['s1']),
      },
      cachedSongs: { s1: makeSong('s1'), s2: makeSong('s2') },
      totalBytes: 2000,
      totalFiles: 2,
    });
    // s1 still has a REAL holder ('b') → not orphaned; s2 has none → orphans.
    mockOrphanSongIfUnreferencedAsync.mockImplementation(async (songId: string) =>
      songId === 's1'
        ? { orphaned: false, affectedItems: [], prunedItems: [] }
        : { orphaned: true, affectedItems: [], prunedItems: [] },
    );

    const orphans = await musicCacheStore.getState().removeCachedItem('a');

    expect(orphans).toEqual(['s2']);
    // Both songs are checked; only s2 orphans.
    expect(mockOrphanSongIfUnreferencedAsync).toHaveBeenCalledWith('s1');
    expect(mockOrphanSongIfUnreferencedAsync).toHaveBeenCalledWith('s2');
    expect(mockDeleteCachedSong).not.toHaveBeenCalled();
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a']).toBeUndefined();
    expect(state.cachedItems['b']).toBeDefined();
    expect(state.cachedSongs['s1']).toBeDefined();
    expect(state.cachedSongs['s2']).toBeUndefined();
    // Only s2 (1000 bytes) was freed; s1 still counts.
    expect(state.totalBytes).toBe(1000);
    expect(state.totalFiles).toBe(1);
  });

  it('returns empty array when item is unknown', async () => {
    const orphans = await musicCacheStore.getState().removeCachedItem('unknown');
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
  it('removes edge + orphans song when REAL refcount drops to 0', async () => {
    musicCacheStore.setState({
      cachedItems: { a: makeItem('a', ['s1', 's2', 's3']) },
      cachedSongs: { s1: makeSong('s1'), s2: makeSong('s2'), s3: makeSong('s3') },
      totalBytes: 3000,
      totalFiles: 3,
    });
    // After the edge is removed, s2 has no REAL holder left → orphan it.
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: true,
      affectedItems: [],
      prunedItems: [],
    });

    const result = await musicCacheStore.getState().removeCachedItemSong('a', 2);

    expect(mockRemoveCachedItemSong).toHaveBeenCalledWith('a', 2);
    expect(mockOrphanSongIfUnreferencedAsync).toHaveBeenCalledWith('s2');
    expect(mockDeleteCachedSong).not.toHaveBeenCalled();
    expect(result).toEqual({ orphanedSongId: 's2' });
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a'].songIds).toEqual(['s1', 's3']);
    expect(state.cachedSongs['s2']).toBeUndefined();
    expect(state.cachedSongs['s1']).toBeDefined();
    expect(state.cachedSongs['s3']).toBeDefined();
    // The single orphaned song (1000 bytes) is removed from the aggregates.
    expect(state.totalBytes).toBe(2000);
    expect(state.totalFiles).toBe(2);
  });

  it('removes edge but keeps song when a REAL holder remains', async () => {
    musicCacheStore.setState({
      cachedItems: { a: makeItem('a', ['s1', 's2']) },
      cachedSongs: { s1: makeSong('s1'), s2: makeSong('s2') },
    });
    // A REAL holder still references s1 → not orphaned.
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: false,
      affectedItems: [],
      prunedItems: [],
    });

    const result = await musicCacheStore.getState().removeCachedItemSong('a', 1);

    expect(result).toEqual({ orphanedSongId: null });
    expect(mockDeleteCachedSong).not.toHaveBeenCalled();
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a'].songIds).toEqual(['s2']);
    expect(state.cachedSongs['s1']).toBeDefined();
  });

  it('returns null orphanedSongId when item is unknown', async () => {
    const result = await musicCacheStore.getState().removeCachedItemSong('unknown', 1);
    expect(result).toEqual({ orphanedSongId: null });
    expect(mockRemoveCachedItemSong).not.toHaveBeenCalled();
    expect(mockDeleteCachedSong).not.toHaveBeenCalled();
  });

  it('returns null when position is out of range (low)', async () => {
    musicCacheStore.setState({ cachedItems: { a: makeItem('a', ['s1']) } });
    const result = await musicCacheStore.getState().removeCachedItemSong('a', 0);
    expect(result).toEqual({ orphanedSongId: null });
    expect(mockRemoveCachedItemSong).not.toHaveBeenCalled();
  });

  it('returns null when position is out of range (high)', async () => {
    musicCacheStore.setState({ cachedItems: { a: makeItem('a', ['s1']) } });
    const result = await musicCacheStore.getState().removeCachedItemSong('a', 2);
    expect(result).toEqual({ orphanedSongId: null });
    expect(mockRemoveCachedItemSong).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  derived-holder orphan matrix (#derived — removing a real holder)   */
/*                                                                     */
/*  These drive the mocked orphanSongIfUnreferencedAsync to            */
/*  simulate the SQL layer's answers, then assert the store's IN-MEMORY */
/*  cachedItems/cachedSongs reconciliation. The store mirrors, in one   */
/*  set(), the pruned holders + the orphaned-song filtering across      */
/*  surviving (derived) holders.                                        */
/* ------------------------------------------------------------------ */

describe('removeCachedItem — derived-holder orphan matrix', () => {
  it('removing favorites orphans a song held only by a derived album; the album is pruned', async () => {
    // In memory: favorites (real, holds S) + a derived album:A (also holds S).
    musicCacheStore.setState({
      cachedItems: {
        __starred__: makeItem('__starred__', ['S'], { type: 'favorites' }),
        'album:A': makeItem('album:A', ['S'], { derived: true }),
      },
      cachedSongs: { S: makeSong('S') },
    });
    // S has no REAL holder once favorites is gone → orphan. The SQL layer
    // reports album:A as both touched and pruned (it was derived + emptied).
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: true,
      affectedItems: ['album:A'],
      prunedItems: ['album:A'],
    });

    const orphans = await musicCacheStore.getState().removeCachedItem('__starred__');

    expect(orphans).toEqual(['S']);
    expect(mockOrphanSongIfUnreferencedAsync).toHaveBeenCalledWith('S');
    const state = musicCacheStore.getState();
    // Removed item gone, pruned derived holder gone, orphan song gone.
    expect(state.cachedItems['__starred__']).toBeUndefined();
    expect(state.cachedItems['album:A']).toBeUndefined();
    expect(state.cachedSongs['S']).toBeUndefined();
  });

  it('removing favorites orphans S but the derived album survives holding an individually-downloaded S2', async () => {
    // Derived album:A holds S (from favorites) AND S2 (individually downloaded
    // via song:S2). Removing favorites orphans S — but album:A survives because
    // it still holds S2 (kept alive by the real song:S2 holder).
    musicCacheStore.setState({
      cachedItems: {
        __starred__: makeItem('__starred__', ['S'], { type: 'favorites' }),
        'album:A': makeItem('album:A', ['S', 'S2'], { derived: true }),
        'song:S2': makeItem('song:S2', ['S2'], { type: 'song' }),
      },
      cachedSongs: { S: makeSong('S'), S2: makeSong('S2') },
    });
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: true, // S has no real holder left
      affectedItems: ['album:A'], // album:A lost S's edge...
      prunedItems: [], // ...but survived (still holds S2)
    });

    const orphans = await musicCacheStore.getState().removeCachedItem('__starred__');

    expect(orphans).toEqual(['S']);
    const state = musicCacheStore.getState();
    expect(state.cachedItems['__starred__']).toBeUndefined();
    // album:A survives with only S2 — the orphaned S is filtered out of songIds.
    expect(state.cachedItems['album:A']).toBeDefined();
    expect(state.cachedItems['album:A'].songIds).toEqual(['S2']);
    // song:S2 real holder untouched.
    expect(state.cachedItems['song:S2']).toBeDefined();
    // S gone, S2 still cached.
    expect(state.cachedSongs['S']).toBeUndefined();
    expect(state.cachedSongs['S2']).toBeDefined();
  });

  it('does not orphan a song that still has a surviving REAL holder', async () => {
    // Removing album 'a', but S1 is also in a real playlist pl-1.
    musicCacheStore.setState({
      cachedItems: {
        a: makeItem('a', ['S1']),
        'pl-1': makeItem('pl-1', ['S1'], { type: 'playlist' }),
      },
      cachedSongs: { S1: makeSong('S1') },
    });
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: false, // pl-1 still holds S1
      affectedItems: [],
      prunedItems: [],
    });

    const orphans = await musicCacheStore.getState().removeCachedItem('a');

    expect(orphans).toEqual([]);
    const state = musicCacheStore.getState();
    expect(state.cachedItems['a']).toBeUndefined();
    expect(state.cachedItems['pl-1']).toBeDefined();
    expect(state.cachedItems['pl-1'].songIds).toEqual(['S1']);
    expect(state.cachedSongs['S1']).toBeDefined();
  });
});

describe('removeCachedItemSong — derived-holder orphan matrix', () => {
  it('orphans a song held only by a derived album; the album is pruned', async () => {
    // Remove S from favorites (position 1). S is also on derived album:A.
    musicCacheStore.setState({
      cachedItems: {
        __starred__: makeItem('__starred__', ['S'], { type: 'favorites' }),
        'album:A': makeItem('album:A', ['S'], { derived: true }),
      },
      cachedSongs: { S: makeSong('S') },
    });
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: true,
      affectedItems: ['album:A'],
      prunedItems: ['album:A'],
    });

    const result = await musicCacheStore.getState().removeCachedItemSong('__starred__', 1);

    expect(result).toEqual({ orphanedSongId: 'S' });
    expect(mockRemoveCachedItemSong).toHaveBeenCalledWith('__starred__', 1);
    expect(mockOrphanSongIfUnreferencedAsync).toHaveBeenCalledWith('S');
    const state = musicCacheStore.getState();
    // The favorites row survives (empty) — removeCachedItemSong only removes the
    // one edge; the holder itself is not pruned by this path.
    expect(state.cachedItems['__starred__']).toBeDefined();
    expect(state.cachedItems['__starred__'].songIds).toEqual([]);
    // Derived album pruned, song orphaned.
    expect(state.cachedItems['album:A']).toBeUndefined();
    expect(state.cachedSongs['S']).toBeUndefined();
  });

  it('orphans S but keeps the derived album that still holds an individually-downloaded S2', async () => {
    musicCacheStore.setState({
      cachedItems: {
        __starred__: makeItem('__starred__', ['S'], { type: 'favorites' }),
        'album:A': makeItem('album:A', ['S', 'S2'], { derived: true }),
        'song:S2': makeItem('song:S2', ['S2'], { type: 'song' }),
      },
      cachedSongs: { S: makeSong('S'), S2: makeSong('S2') },
    });
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: true,
      affectedItems: ['album:A'],
      prunedItems: [],
    });

    const result = await musicCacheStore.getState().removeCachedItemSong('__starred__', 1);

    expect(result).toEqual({ orphanedSongId: 'S' });
    const state = musicCacheStore.getState();
    expect(state.cachedItems['__starred__'].songIds).toEqual([]);
    // album:A survives with only S2 — S filtered out of its songIds.
    expect(state.cachedItems['album:A']).toBeDefined();
    expect(state.cachedItems['album:A'].songIds).toEqual(['S2']);
    expect(state.cachedItems['song:S2']).toBeDefined();
    expect(state.cachedSongs['S']).toBeUndefined();
    expect(state.cachedSongs['S2']).toBeDefined();
  });

  it('does not orphan when a surviving REAL holder remains', async () => {
    musicCacheStore.setState({
      cachedItems: {
        'pl-1': makeItem('pl-1', ['S1', 'S2'], { type: 'playlist' }),
        'pl-2': makeItem('pl-2', ['S1'], { type: 'playlist' }),
      },
      cachedSongs: { S1: makeSong('S1'), S2: makeSong('S2') },
    });
    mockOrphanSongIfUnreferencedAsync.mockResolvedValue({
      orphaned: false, // pl-2 still holds S1
      affectedItems: [],
      prunedItems: [],
    });

    const result = await musicCacheStore.getState().removeCachedItemSong('pl-1', 1);

    expect(result).toEqual({ orphanedSongId: null });
    const state = musicCacheStore.getState();
    expect(state.cachedItems['pl-1'].songIds).toEqual(['S2']);
    expect(state.cachedItems['pl-2'].songIds).toEqual(['S1']);
    expect(state.cachedSongs['S1']).toBeDefined();
    expect(state.cachedSongs['S2']).toBeDefined();
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
    const raw = kvStorage.getItem(SETTINGS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ maxConcurrentDownloads: 5 });
  });

  it('persists the three valid values (1 | 3 | 5)', () => {
    for (const n of [1, 3, 5] as const) {
      musicCacheStore.getState().setMaxConcurrentDownloads(n);
      expect(JSON.parse(kvStorage.getItem(SETTINGS_KEY) as string)).toEqual({
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
    kvStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxConcurrentDownloads: 5 }));

    musicCacheStore.getState().reset();

    expect(mockClearAllMusicCacheRows).toHaveBeenCalledTimes(1);
    expect(kvStorage.getItem(SETTINGS_KEY)).toBeNull();
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
/*  hydrateFromDbAsync                                                      */
/* ------------------------------------------------------------------ */

describe('hydrateFromDbAsync', () => {
  it('loads songs, items, queue, and settings; computes totals; flips hasHydrated', async () => {
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

    mockHydrateCachedSongsAsync.mockResolvedValue(songs);
    mockHydrateCachedItemsAsync.mockResolvedValue(items);
    mockHydrateDownloadQueueAsync.mockResolvedValue(queue);
    kvStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxConcurrentDownloads: 5 }));

    await musicCacheStore.getState().hydrateFromDbAsync();

    const s = musicCacheStore.getState();
    expect(s.cachedSongs).toEqual(songs);
    expect(s.cachedItems).toEqual(items);
    expect(s.downloadQueue).toEqual(queue);
    expect(s.maxConcurrentDownloads).toBe(5);
    expect(s.totalBytes).toBe(1000 + 2500);
    expect(s.totalFiles).toBe(2);
    expect(s.hasHydrated).toBe(true);
  });

  it('is idempotent -- second call re-reads and produces the same state', async () => {
    mockHydrateCachedSongsAsync.mockResolvedValue({ s: makeSong('s') });
    await musicCacheStore.getState().hydrateFromDbAsync();
    expect(mockHydrateCachedSongsAsync).toHaveBeenCalledTimes(1);
    const first = musicCacheStore.getState();
    expect(first.hasHydrated).toBe(true);
    await musicCacheStore.getState().hydrateFromDbAsync();
    // Hydrate is re-callable by design (see `rehydrateAllStores.ts`).
    // Second call re-reads SQL and produces the same state.
    expect(mockHydrateCachedSongsAsync).toHaveBeenCalledTimes(2);
    const second = musicCacheStore.getState();
    expect(second.hasHydrated).toBe(true);
  });

  it('defaults maxConcurrentDownloads=3 when settings blob is absent', async () => {
    // Ensure no settings row exists.
    kvStorage.removeItem(SETTINGS_KEY);
    await musicCacheStore.getState().hydrateFromDbAsync();
    expect(musicCacheStore.getState().maxConcurrentDownloads).toBe(3);
  });

  it('defaults maxConcurrentDownloads=3 when settings blob is malformed JSON', async () => {
    kvStorage.setItem(SETTINGS_KEY, 'not-json{');
    await musicCacheStore.getState().hydrateFromDbAsync();
    expect(musicCacheStore.getState().maxConcurrentDownloads).toBe(3);
  });

  it('defaults maxConcurrentDownloads=3 when blob has an invalid value', async () => {
    kvStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxConcurrentDownloads: 9 }));
    await musicCacheStore.getState().hydrateFromDbAsync();
    expect(musicCacheStore.getState().maxConcurrentDownloads).toBe(3);
  });

  it('hydrates empty when all sources are empty', async () => {
    await musicCacheStore.getState().hydrateFromDbAsync();
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

/* ------------------------------------------------------------------ */
/*  Envelope accessors                                                 */
/* ------------------------------------------------------------------ */

describe('getSongEnvelope', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const storeModule = require('../musicCacheStore');
  const { getSongEnvelope } = storeModule;
  /* eslint-enable @typescript-eslint/no-require-imports */

  beforeEach(() => {
    musicCacheStore.setState({ cachedSongs: {}, cachedItems: {} } as any);
  });

  it('returns null when the song row is missing', () => {
    expect(getSongEnvelope('nope')).toBeNull();
  });

  it('returns null when raw_json is absent', () => {
    musicCacheStore.setState({
      cachedSongs: {
        s1: makeSong('s1'), // no rawJson
      } as any,
    });
    expect(getSongEnvelope('s1')).toBeNull();
  });

  it('parses and caches the Child envelope; repeated calls return the same object', () => {
    musicCacheStore.setState({
      cachedSongs: {
        s1: { ...makeSong('s1'), rawJson: '{"id":"s1","isDir":false,"title":"T","track":7,"genre":"Rock"}' },
      } as any,
    });
    const a = getSongEnvelope('s1');
    const b = getSongEnvelope('s1');
    expect(a).toBeTruthy();
    expect(a).toBe(b); // memoised identity
    expect(a.track).toBe(7);
    expect(a.genre).toBe('Rock');
  });

  it('returns null on malformed JSON', () => {
    musicCacheStore.setState({
      cachedSongs: {
        s1: { ...makeSong('s1'), rawJson: '{not-json' },
      } as any,
    });
    expect(getSongEnvelope('s1')).toBeNull();
  });

  it('re-parses after the row is replaced by an upsert (no stale memo)', () => {
    musicCacheStore.setState({
      cachedSongs: {
        s1: { ...makeSong('s1'), rawJson: '{"id":"s1","isDir":false,"title":"Old"}' },
      } as any,
    });
    expect(getSongEnvelope('s1')?.title).toBe('Old');
    // Replace the row object (an upsert) — the WeakMap is keyed on the row, so
    // the new row misses the cache and re-parses.
    musicCacheStore.setState({
      cachedSongs: {
        s1: { ...makeSong('s1'), rawJson: '{"id":"s1","isDir":false,"title":"New"}' },
      } as any,
    });
    expect(getSongEnvelope('s1')?.title).toBe('New');
  });
});
