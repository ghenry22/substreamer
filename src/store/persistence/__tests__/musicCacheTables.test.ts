// Mock expo-sqlite with a minimal no-op DB so `persistence/db.ts`'s
// module-scope init succeeds on import. Individual tests override the
// shared handle via `db.__setDbForTests` with a richer fake.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

import { __setDbForTests } from '../db';
import {
  bulkReplace,
  clearAllMusicCacheRows,
  countCachedItems,
  countCachedSongs,
  countDownloadQueueItems,
  countSongRefs,
  deleteCachedItem,
  deleteCachedSong,
  findOrphanSongs,
  getItemIdsForSong,
  getSongIdsForItem,
  hydrateCachedItems,
  hydrateCachedSongs,
  hydrateDownloadQueue,
  insertCachedItemSong,
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
} from '../musicCacheTables';

/* ------------------------------------------------------------------ */
/*  Fake in-memory DB                                                  */
/* ------------------------------------------------------------------ */

interface SongRec {
  song_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  album_id: string;
  cover_art: string | null;
  bytes: number;
  duration: number;
  suffix: string;
  bit_rate: number | null;
  bit_depth: number | null;
  sampling_rate: number | null;
  format_captured_at: number;
  downloaded_at: number;
}

interface ItemRec {
  item_id: string;
  type: string;
  name: string;
  artist: string | null;
  cover_art_id: string | null;
  expected_song_count: number;
  parent_album_id: string | null;
  last_sync_at: number;
  downloaded_at: number;
}

interface EdgeRec {
  item_id: string;
  position: number;
  song_id: string;
}

interface QueueRec {
  queue_id: string;
  item_id: string;
  type: string;
  name: string;
  artist: string | null;
  cover_art_id: string | null;
  status: string;
  total_songs: number;
  completed_songs: number;
  error: string | null;
  added_at: number;
  queue_position: number;
  songs_json: string;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function makeFakeDb() {
  const songs = new Map<string, SongRec>();
  const items = new Map<string, ItemRec>();
  // Edges keyed by `${item_id}::${position}` for composite PK.
  const edges = new Map<string, EdgeRec>();
  const queue = new Map<string, QueueRec>();

  const edgeKey = (item_id: string, position: number) => `${item_id}::${position}`;

  const runSync = (rawSql: string, params: readonly unknown[] = []): void => {
    const s = normalize(rawSql);

    // ---- cached_songs ----
    // `cached_songs` has no ON DELETE CASCADE children, but we still emulate
    // DELETE-then-INSERT semantics faithfully for REPLACE so the fake
    // mirrors SQLite behavior consistently.
    if (
      s.startsWith('INSERT OR REPLACE INTO cached_songs') ||
      (s.startsWith('INSERT INTO cached_songs') && s.includes('ON CONFLICT'))
    ) {
      const [
        song_id,
        title,
        artist,
        album,
        album_id,
        cover_art,
        bytes,
        duration,
        suffix,
        bit_rate,
        bit_depth,
        sampling_rate,
        format_captured_at,
        downloaded_at,
      ] = params as [
        string,
        string,
        string | null,
        string | null,
        string,
        string | null,
        number,
        number,
        string,
        number | null,
        number | null,
        number | null,
        number,
        number,
      ];
      songs.set(song_id, {
        song_id,
        title,
        artist,
        album,
        album_id,
        cover_art,
        bytes,
        duration,
        suffix,
        bit_rate,
        bit_depth,
        sampling_rate,
        format_captured_at,
        downloaded_at,
      });
      return;
    }
    if (s.startsWith('DELETE FROM cached_songs WHERE song_id = ?')) {
      songs.delete(params[0] as string);
      return;
    }
    if (s === 'DELETE FROM cached_songs;') {
      songs.clear();
      return;
    }

    // ---- cached_items ----
    // SQLite semantics: `INSERT OR REPLACE` is DELETE-then-INSERT when a
    // row with the conflicting primary key already exists. The DELETE fires
    // `ON DELETE CASCADE` on `cached_item_songs`, wiping that item's edges.
    // We faithfully emulate this here because code that relies on
    // `INSERT OR REPLACE` to an FK-parent is buggy (music-downloads-v2 bug),
    // and tests must be able to catch that.
    if (s.startsWith('INSERT OR REPLACE INTO cached_items')) {
      const [
        item_id,
        type,
        name,
        artist,
        cover_art_id,
        expected_song_count,
        parent_album_id,
        last_sync_at,
        downloaded_at,
      ] = params as [
        string,
        string,
        string,
        string | null,
        string | null,
        number,
        string | null,
        number,
        number,
      ];
      if (items.has(item_id)) {
        items.delete(item_id);
        for (const [k, edge] of edges) {
          if (edge.item_id === item_id) edges.delete(k);
        }
      }
      items.set(item_id, {
        item_id,
        type,
        name,
        artist,
        cover_art_id,
        expected_song_count,
        parent_album_id,
        last_sync_at,
        downloaded_at,
      });
      return;
    }
    if (s.startsWith('INSERT INTO cached_items') && s.includes('ON CONFLICT')) {
      // UPSERT: insert if absent, update in place if present. No DELETE, no
      // CASCADE. This is the correct pattern for FK-parent tables.
      const [
        item_id,
        type,
        name,
        artist,
        cover_art_id,
        expected_song_count,
        parent_album_id,
        last_sync_at,
        downloaded_at,
      ] = params as [
        string,
        string,
        string,
        string | null,
        string | null,
        number,
        string | null,
        number,
        number,
      ];
      items.set(item_id, {
        item_id,
        type,
        name,
        artist,
        cover_art_id,
        expected_song_count,
        parent_album_id,
        last_sync_at,
        downloaded_at,
      });
      return;
    }
    if (s.startsWith('DELETE FROM cached_items WHERE item_id = ?')) {
      const id = params[0] as string;
      items.delete(id);
      // Emulate FK ON DELETE CASCADE for the edge table.
      for (const [k, edge] of edges) {
        if (edge.item_id === id) edges.delete(k);
      }
      return;
    }
    if (s === 'DELETE FROM cached_items;') {
      items.clear();
      return;
    }

    // ---- cached_item_songs ----
    if (s.startsWith('INSERT OR IGNORE INTO cached_item_songs')) {
      const [item_id, position, song_id] = params as [string, number, string];
      const k = edgeKey(item_id, position);
      if (!edges.has(k)) {
        edges.set(k, { item_id, position, song_id });
      }
      return;
    }
    if (s.startsWith('DELETE FROM cached_item_songs WHERE item_id = ? AND position = ?')) {
      const [item_id, position] = params as [string, number];
      edges.delete(edgeKey(item_id, position));
      return;
    }
    // Order of these branches matters — the forward-reorder SQL's prefix
    // matches the removeCachedItemSong SQL's prefix, so check the more
    // specific one (with the extra `AND position <= ?` clause) first.
    if (
      s.startsWith(
        'UPDATE cached_item_songs SET position = position - 1 WHERE item_id = ? AND position > ? AND position <= ?',
      )
    ) {
      const [item_id, lo, hi] = params as [string, number, number];
      const toUpdate: EdgeRec[] = [];
      for (const [k, edge] of edges) {
        if (edge.item_id === item_id && edge.position > lo && edge.position <= hi) {
          toUpdate.push(edge);
          edges.delete(k);
        }
      }
      // Ascending order avoids collisions while shifting down.
      toUpdate.sort((a, b) => a.position - b.position);
      for (const edge of toUpdate) {
        const newPos = edge.position - 1;
        if (edges.has(edgeKey(item_id, newPos))) {
          throw new Error('PK collision during forward reorder');
        }
        edges.set(edgeKey(item_id, newPos), { ...edge, position: newPos });
      }
      return;
    }
    if (
      s.startsWith('UPDATE cached_item_songs SET position = position - 1 WHERE item_id = ? AND position > ?')
    ) {
      const [item_id, position] = params as [string, number];
      const toUpdate: EdgeRec[] = [];
      for (const [k, edge] of edges) {
        if (edge.item_id === item_id && edge.position > position) {
          toUpdate.push(edge);
          edges.delete(k);
        }
      }
      toUpdate.sort((a, b) => a.position - b.position);
      for (const edge of toUpdate) {
        edges.set(edgeKey(edge.item_id, edge.position - 1), {
          ...edge,
          position: edge.position - 1,
        });
      }
      return;
    }
    if (s.startsWith('UPDATE cached_item_songs SET position = -1 WHERE item_id = ? AND position = ?')) {
      const [item_id, position] = params as [string, number];
      const k = edgeKey(item_id, position);
      const edge = edges.get(k);
      if (edge) {
        edges.delete(k);
        const newKey = edgeKey(item_id, -1);
        if (edges.has(newKey)) {
          throw new Error('PK collision on sentinel -1');
        }
        edges.set(newKey, { ...edge, position: -1 });
      }
      return;
    }
    if (
      s.startsWith(
        'UPDATE cached_item_songs SET position = position + 1 WHERE item_id = ? AND position >= ? AND position < ?',
      )
    ) {
      const [item_id, lo, hi] = params as [string, number, number];
      const toUpdate: EdgeRec[] = [];
      for (const [k, edge] of edges) {
        if (edge.item_id === item_id && edge.position >= lo && edge.position < hi) {
          toUpdate.push(edge);
          edges.delete(k);
        }
      }
      // Sort descending to avoid collisions while shifting up.
      toUpdate.sort((a, b) => b.position - a.position);
      for (const edge of toUpdate) {
        const newPos = edge.position + 1;
        if (edges.has(edgeKey(item_id, newPos))) {
          throw new Error('PK collision during backward reorder');
        }
        edges.set(edgeKey(item_id, newPos), { ...edge, position: newPos });
      }
      return;
    }
    if (s.startsWith('UPDATE cached_item_songs SET position = ? WHERE item_id = ? AND position = -1')) {
      const [newPos, item_id] = params as [number, string];
      const sentinelKey = edgeKey(item_id, -1);
      const edge = edges.get(sentinelKey);
      if (edge) {
        edges.delete(sentinelKey);
        const finalKey = edgeKey(item_id, newPos);
        if (edges.has(finalKey)) throw new Error('PK collision on final placement');
        edges.set(finalKey, { ...edge, position: newPos });
      }
      return;
    }
    if (s === 'DELETE FROM cached_item_songs;') {
      edges.clear();
      return;
    }

    // ---- download_queue ----
    // `download_queue` has no FK children so REPLACE and UPSERT behave
    // identically here, but we accept both forms so either is allowed.
    if (
      s.startsWith('INSERT OR REPLACE INTO download_queue') ||
      (s.startsWith('INSERT INTO download_queue') && s.includes('ON CONFLICT'))
    ) {
      const [
        queue_id,
        item_id,
        type,
        name,
        artist,
        cover_art_id,
        status,
        total_songs,
        completed_songs,
        error,
        added_at,
        queue_position,
        songs_json,
      ] = params as [
        string,
        string,
        string,
        string,
        string | null,
        string | null,
        string,
        number,
        number,
        string | null,
        number,
        number,
        string,
      ];
      queue.set(queue_id, {
        queue_id,
        item_id,
        type,
        name,
        artist,
        cover_art_id,
        status,
        total_songs,
        completed_songs,
        error,
        added_at,
        queue_position,
        songs_json,
      });
      return;
    }
    if (s.startsWith('DELETE FROM download_queue WHERE queue_id = ?')) {
      queue.delete(params[0] as string);
      return;
    }
    if (s === 'DELETE FROM download_queue;') {
      queue.clear();
      return;
    }
    if (s.startsWith('UPDATE download_queue SET')) {
      // Partial update path and queue reorder path share this prefix.
      if (s.startsWith('UPDATE download_queue SET queue_position = -1 WHERE queue_position = ?')) {
        const pos = params[0] as number;
        for (const [k, q] of queue) {
          if (q.queue_position === pos) {
            queue.set(k, { ...q, queue_position: -1 });
          }
        }
        return;
      }
      if (
        s.startsWith(
          'UPDATE download_queue SET queue_position = queue_position - 1 WHERE queue_position > ? AND queue_position <= ?',
        )
      ) {
        const [lo, hi] = params as [number, number];
        for (const [k, q] of queue) {
          if (q.queue_position > lo && q.queue_position <= hi) {
            queue.set(k, { ...q, queue_position: q.queue_position - 1 });
          }
        }
        return;
      }
      if (
        s.startsWith(
          'UPDATE download_queue SET queue_position = queue_position + 1 WHERE queue_position >= ? AND queue_position < ?',
        )
      ) {
        const [lo, hi] = params as [number, number];
        for (const [k, q] of queue) {
          if (q.queue_position >= lo && q.queue_position < hi) {
            queue.set(k, { ...q, queue_position: q.queue_position + 1 });
          }
        }
        return;
      }
      if (s.startsWith('UPDATE download_queue SET queue_position = ? WHERE queue_position = -1')) {
        const newPos = params[0] as number;
        for (const [k, q] of queue) {
          if (q.queue_position === -1) {
            queue.set(k, { ...q, queue_position: newPos });
          }
        }
        return;
      }
      // Partial update: parse SET clauses like 'status = ?, completed_songs = ?' etc.
      // Params are [...values, queueId].
      const queueId = params[params.length - 1] as string;
      const values = params.slice(0, params.length - 1);
      const setClause = s.substring('UPDATE download_queue SET '.length, s.indexOf(' WHERE'));
      const fields = setClause.split(',').map((c) => c.trim().split(' ')[0]);
      const existing = queue.get(queueId);
      if (!existing) return;
      const next: QueueRec = { ...existing };
      fields.forEach((field, i) => {
        (next as any)[field] = values[i];
      });
      queue.set(queueId, next);
      return;
    }

    throw new Error(`unhandled SQL in fake: ${s}`);
  };

  return {
    songs,
    items,
    edges,
    queue,

    getFirstSync<T>(rawSql: string, params: readonly unknown[] = []): T | undefined {
      const s = normalize(rawSql);
      if (s === 'SELECT COUNT(*) AS c FROM cached_songs;') {
        return { c: songs.size } as T;
      }
      if (s === 'SELECT COUNT(*) AS c FROM cached_items;') {
        return { c: items.size } as T;
      }
      if (s === 'SELECT COUNT(*) AS c FROM download_queue;') {
        return { c: queue.size } as T;
      }
      if (s === 'SELECT COUNT(*) AS c FROM cached_item_songs WHERE song_id = ?;') {
        const songId = params[0] as string;
        let c = 0;
        for (const edge of edges.values()) if (edge.song_id === songId) c += 1;
        return { c } as T;
      }
      return undefined;
    },

    getAllSync<T>(rawSql: string, params: readonly unknown[] = []): T[] {
      const s = normalize(rawSql);
      if (s.startsWith('SELECT song_id, title, artist, album, album_id, cover_art')) {
        return Array.from(songs.values()) as T[];
      }
      if (s.startsWith('SELECT item_id, type, name, artist, cover_art_id, expected_song_count')) {
        return Array.from(items.values()) as T[];
      }
      if (s === 'SELECT item_id, song_id FROM cached_item_songs ORDER BY item_id, position ASC;') {
        return Array.from(edges.values())
          .sort((a, b) => {
            if (a.item_id < b.item_id) return -1;
            if (a.item_id > b.item_id) return 1;
            return a.position - b.position;
          })
          .map((e) => ({ item_id: e.item_id, song_id: e.song_id })) as T[];
      }
      if (s.startsWith('SELECT queue_id, item_id, type, name')) {
        return Array.from(queue.values()).sort(
          (a, b) => a.queue_position - b.queue_position,
        ) as T[];
      }
      if (
        s.startsWith(
          'SELECT song_id FROM cached_songs WHERE song_id NOT IN (SELECT song_id FROM cached_item_songs)',
        )
      ) {
        const referenced = new Set<string>();
        for (const edge of edges.values()) referenced.add(edge.song_id);
        return Array.from(songs.values())
          .filter((song) => !referenced.has(song.song_id))
          .map((song) => ({ song_id: song.song_id })) as T[];
      }
      if (
        s.startsWith('SELECT song_id FROM cached_item_songs WHERE item_id = ? ORDER BY position ASC')
      ) {
        const itemId = params[0] as string;
        return Array.from(edges.values())
          .filter((e) => e.item_id === itemId)
          .sort((a, b) => a.position - b.position)
          .map((e) => ({ song_id: e.song_id })) as T[];
      }
      if (s.startsWith('SELECT item_id FROM cached_item_songs WHERE song_id = ?')) {
        const songId = params[0] as string;
        return Array.from(edges.values())
          .filter((e) => e.song_id === songId)
          .map((e) => ({ item_id: e.item_id })) as T[];
      }
      return [];
    },

    runSync,
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  };
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeSong(overrides: Partial<CachedSongRow> = {}): CachedSongRow {
  return {
    id: 's1',
    title: 'Track 1',
    artist: 'Some Artist',
    album: 'Some Album',
    albumId: 'alb-1',
    coverArt: 'cov-1',
    bytes: 1_000_000,
    duration: 240,
    suffix: 'mp3',
    bitRate: 320,
    bitDepth: 16,
    samplingRate: 44100,
    formatCapturedAt: 1_700_000_000_000,
    downloadedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeItem(overrides: Partial<Omit<CachedItemRow, 'songIds'>> = {}): Omit<CachedItemRow, 'songIds'> {
  return {
    itemId: 'alb-1',
    type: 'album',
    name: 'Some Album',
    artist: 'Some Artist',
    coverArtId: 'cov-1',
    expectedSongCount: 10,
    lastSyncAt: 1_700_000_000_000,
    downloadedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeQueueRow(overrides: Partial<DownloadQueueRow> = {}): DownloadQueueRow {
  return {
    queueId: 'q-1',
    itemId: 'alb-1',
    type: 'album',
    name: 'Some Album',
    artist: 'Some Artist',
    coverArtId: 'cov-1',
    status: 'queued',
    totalSongs: 10,
    completedSongs: 0,
    addedAt: 1_700_000_000_000,
    queuePosition: 1,
    songsJson: '[]',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Test harness                                                       */
/* ------------------------------------------------------------------ */

let fakeDb: ReturnType<typeof makeFakeDb>;

beforeEach(() => {
  fakeDb = makeFakeDb();
  __setDbForTests(fakeDb as any);
});

afterEach(() => {
  __setDbForTests(null);
});

/* ------------------------------------------------------------------ */
/*  cached_songs                                                       */
/* ------------------------------------------------------------------ */

describe('musicCacheTables — cached_songs', () => {
  it('upsertCachedSong + hydrateCachedSongs round-trips every field', () => {
    upsertCachedSong(makeSong());
    const hydrated = hydrateCachedSongs();
    expect(hydrated.s1).toBeDefined();
    expect(hydrated.s1).toEqual({
      id: 's1',
      title: 'Track 1',
      artist: 'Some Artist',
      album: 'Some Album',
      albumId: 'alb-1',
      coverArt: 'cov-1',
      bytes: 1_000_000,
      duration: 240,
      suffix: 'mp3',
      bitRate: 320,
      bitDepth: 16,
      samplingRate: 44100,
      formatCapturedAt: 1_700_000_000_000,
      downloadedAt: 1_700_000_000_000,
    });
  });

  it('upsertCachedSong leaves optional fields absent when null', () => {
    upsertCachedSong(
      makeSong({
        id: 's2',
        artist: undefined,
        album: undefined,
        coverArt: undefined,
        bitRate: undefined,
        bitDepth: undefined,
        samplingRate: undefined,
      }),
    );
    const hydrated = hydrateCachedSongs();
    expect(hydrated.s2).toBeDefined();
    expect(hydrated.s2.artist).toBeUndefined();
    expect(hydrated.s2.album).toBeUndefined();
    expect(hydrated.s2.coverArt).toBeUndefined();
    expect(hydrated.s2.bitRate).toBeUndefined();
    expect(hydrated.s2.bitDepth).toBeUndefined();
    expect(hydrated.s2.samplingRate).toBeUndefined();
    // Required fields still present.
    expect(hydrated.s2.id).toBe('s2');
    expect(hydrated.s2.albumId).toBe('alb-1');
  });

  it('upsertCachedSong drops rows missing id or albumId', () => {
    upsertCachedSong(makeSong({ id: '' }));
    upsertCachedSong(makeSong({ id: 'no-album', albumId: '' }));
    expect(countCachedSongs()).toBe(0);
  });

  it('upsertCachedSong replaces an existing song with the same id', () => {
    upsertCachedSong(makeSong({ bytes: 1 }));
    upsertCachedSong(makeSong({ bytes: 999 }));
    expect(countCachedSongs()).toBe(1);
    expect(hydrateCachedSongs().s1.bytes).toBe(999);
  });

  it('deleteCachedSong removes the row', () => {
    upsertCachedSong(makeSong());
    deleteCachedSong('s1');
    expect(countCachedSongs()).toBe(0);
  });

  it('findOrphanSongs returns songs without any edges', () => {
    upsertCachedSong(makeSong({ id: 's1' }));
    upsertCachedSong(makeSong({ id: 's2' }));
    upsertCachedSong(makeSong({ id: 's3' }));
    upsertCachedItem(makeItem({ itemId: 'alb-1' }));
    insertCachedItemSong('alb-1', 1, 's2');

    const orphans = findOrphanSongs().sort();
    expect(orphans).toEqual(['s1', 's3']);
  });

  it('hydrateCachedSongs skips rows with empty song_id', () => {
    upsertCachedSong(makeSong({ id: 's1' }));
    // Seed a bogus row directly via the fake to exercise the guard.
    fakeDb.songs.set('', {
      song_id: '',
      title: 'x',
      artist: null,
      album: null,
      album_id: 'alb-x',
      cover_art: null,
      bytes: 0,
      duration: 0,
      suffix: 'mp3',
      bit_rate: null,
      bit_depth: null,
      sampling_rate: null,
      format_captured_at: 0,
      downloaded_at: 0,
    });
    const hydrated = hydrateCachedSongs();
    expect(Object.keys(hydrated)).toEqual(['s1']);
  });
});

/* ------------------------------------------------------------------ */
/*  cached_items + edges                                               */
/* ------------------------------------------------------------------ */

describe('musicCacheTables — cached_items + edges', () => {
  it('upsertCachedItem + hydrateCachedItems round-trips the item', () => {
    upsertCachedItem(makeItem());
    const hydrated = hydrateCachedItems();
    expect(hydrated['alb-1']).toBeDefined();
    expect(hydrated['alb-1']).toEqual({
      itemId: 'alb-1',
      type: 'album',
      name: 'Some Album',
      artist: 'Some Artist',
      coverArtId: 'cov-1',
      expectedSongCount: 10,
      lastSyncAt: 1_700_000_000_000,
      downloadedAt: 1_700_000_000_000,
      songIds: [],
    });
  });

  it('hydrateCachedItems joins songIds in position order (not insertion order)', () => {
    upsertCachedItem(makeItem({ itemId: 'pl-1', type: 'playlist' }));
    insertCachedItemSong('pl-1', 3, 's-c');
    insertCachedItemSong('pl-1', 1, 's-a');
    insertCachedItemSong('pl-1', 2, 's-b');
    const hydrated = hydrateCachedItems();
    expect(hydrated['pl-1'].songIds).toEqual(['s-a', 's-b', 's-c']);
  });

  it('hydrateCachedItems leaves optional fields absent when null', () => {
    upsertCachedItem(
      makeItem({
        itemId: 'song:x',
        type: 'song',
        name: 'Lone',
        artist: undefined,
        coverArtId: undefined,
        parentAlbumId: 'alb-9',
      }),
    );
    const hydrated = hydrateCachedItems();
    expect(hydrated['song:x'].artist).toBeUndefined();
    expect(hydrated['song:x'].coverArtId).toBeUndefined();
    expect(hydrated['song:x'].parentAlbumId).toBe('alb-9');
  });

  it('upsertCachedItem drops rows missing itemId', () => {
    upsertCachedItem(makeItem({ itemId: '' }));
    expect(countCachedItems()).toBe(0);
  });

  // Regression: SQLite `INSERT OR REPLACE` on a parent row is implemented as
  // DELETE-then-INSERT; when the parent has children via `ON DELETE CASCADE`,
  // the DELETE fires the cascade and wipes the children. This bit us during
  // music-downloads-v2 rollout: Task 14 migrated playlists correctly, but the
  // first downstream upsertCachedItem call (e.g. from a sync pass) silently
  // cascade-deleted every edge for that item — so on next hydrate the items
  // were empty shells and reconciliation deleted them. The fix is to use
  // UPSERT (`ON CONFLICT(item_id) DO UPDATE SET …`) which updates in place
  // without triggering any DELETE. This test locks in that guarantee.
  it('upsertCachedItem preserves edges when the parent row already exists', () => {
    upsertCachedItem(makeItem({ itemId: 'pl-1', type: 'playlist', name: 'Original' }));
    insertCachedItemSong('pl-1', 1, 's-a');
    insertCachedItemSong('pl-1', 2, 's-b');
    expect(getSongIdsForItem('pl-1')).toEqual(['s-a', 's-b']);

    // Simulate a downstream write touching the same item_id — e.g. a sync
    // pass that re-writes the item's metadata. Before the fix this would
    // fire ON DELETE CASCADE and drop both edges.
    upsertCachedItem(makeItem({ itemId: 'pl-1', type: 'playlist', name: 'Renamed' }));

    expect(getSongIdsForItem('pl-1')).toEqual(['s-a', 's-b']);
  });

  it('upsertCachedItem updates columns on conflict without dropping the row', () => {
    upsertCachedItem(makeItem({ itemId: 'pl-1', name: 'Original', artist: 'First' }));
    upsertCachedItem(
      makeItem({ itemId: 'pl-1', name: 'Renamed', artist: 'Second' }),
    );
    const hydrated = hydrateCachedItems();
    expect(hydrated['pl-1'].name).toBe('Renamed');
    expect(hydrated['pl-1'].artist).toBe('Second');
    expect(countCachedItems()).toBe(1);
  });

  it('insertCachedItemSong ignores duplicate (itemId, position) pairs', () => {
    upsertCachedItem(makeItem());
    insertCachedItemSong('alb-1', 1, 's1');
    insertCachedItemSong('alb-1', 1, 's2');
    const songs = getSongIdsForItem('alb-1');
    expect(songs).toEqual(['s1']);
  });

  it('insertCachedItemSong ignores rows missing itemId or songId', () => {
    insertCachedItemSong('', 1, 's1');
    insertCachedItemSong('alb-1', 1, '');
    expect(getSongIdsForItem('alb-1')).toEqual([]);
  });

  it('deleteCachedItem cascades to edges', () => {
    upsertCachedItem(makeItem());
    insertCachedItemSong('alb-1', 1, 's1');
    insertCachedItemSong('alb-1', 2, 's2');
    deleteCachedItem('alb-1');
    expect(countCachedItems()).toBe(0);
    expect(getSongIdsForItem('alb-1')).toEqual([]);
  });

  it('removeCachedItemSong shifts higher positions down by 1', () => {
    upsertCachedItem(makeItem());
    insertCachedItemSong('alb-1', 1, 's1');
    insertCachedItemSong('alb-1', 2, 's2');
    insertCachedItemSong('alb-1', 3, 's3');
    insertCachedItemSong('alb-1', 4, 's4');
    removeCachedItemSong('alb-1', 2);
    expect(getSongIdsForItem('alb-1')).toEqual(['s1', 's3', 's4']);
    // And positions are contiguous (1, 2, 3) — verified via ordering.
    const edgesList = Array.from(fakeDb.edges.values())
      .filter((e) => e.item_id === 'alb-1')
      .sort((a, b) => a.position - b.position);
    expect(edgesList.map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it('reorderCachedItemSongs moves forward without PK collision', () => {
    upsertCachedItem(makeItem());
    insertCachedItemSong('alb-1', 1, 's1');
    insertCachedItemSong('alb-1', 2, 's2');
    insertCachedItemSong('alb-1', 3, 's3');
    insertCachedItemSong('alb-1', 4, 's4');
    // Move position 1 to position 3 — s2 and s3 shift down by 1.
    reorderCachedItemSongs('alb-1', 1, 3);
    expect(getSongIdsForItem('alb-1')).toEqual(['s2', 's3', 's1', 's4']);
  });

  it('reorderCachedItemSongs moves backward without PK collision', () => {
    upsertCachedItem(makeItem());
    insertCachedItemSong('alb-1', 1, 's1');
    insertCachedItemSong('alb-1', 2, 's2');
    insertCachedItemSong('alb-1', 3, 's3');
    insertCachedItemSong('alb-1', 4, 's4');
    // Move position 4 to position 2 — s2 and s3 shift up by 1.
    reorderCachedItemSongs('alb-1', 4, 2);
    expect(getSongIdsForItem('alb-1')).toEqual(['s1', 's4', 's2', 's3']);
  });

  it('reorderCachedItemSongs is a no-op when from == to', () => {
    upsertCachedItem(makeItem());
    insertCachedItemSong('alb-1', 1, 's1');
    insertCachedItemSong('alb-1', 2, 's2');
    reorderCachedItemSongs('alb-1', 2, 2);
    expect(getSongIdsForItem('alb-1')).toEqual(['s1', 's2']);
  });

  it('getItemIdsForSong returns every referring item', () => {
    upsertCachedSong(makeSong());
    upsertCachedItem(makeItem({ itemId: 'alb-1' }));
    upsertCachedItem(makeItem({ itemId: 'pl-1', type: 'playlist' }));
    upsertCachedItem(makeItem({ itemId: '__starred__', type: 'favorites' }));
    insertCachedItemSong('alb-1', 1, 's1');
    insertCachedItemSong('pl-1', 1, 's1');
    insertCachedItemSong('__starred__', 1, 's1');
    expect(getItemIdsForSong('s1').sort()).toEqual(['__starred__', 'alb-1', 'pl-1']);
  });

  it('countSongRefs counts the number of edges for a song', () => {
    upsertCachedSong(makeSong());
    upsertCachedItem(makeItem({ itemId: 'alb-1' }));
    upsertCachedItem(makeItem({ itemId: 'pl-1', type: 'playlist' }));
    insertCachedItemSong('alb-1', 1, 's1');
    insertCachedItemSong('pl-1', 1, 's1');
    expect(countSongRefs('s1')).toBe(2);
    expect(countSongRefs('s-missing')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  download_queue                                                     */
/* ------------------------------------------------------------------ */

describe('musicCacheTables — download_queue', () => {
  it('insertDownloadQueueItem + hydrateDownloadQueue round-trips', () => {
    insertDownloadQueueItem(makeQueueRow());
    const hydrated = hydrateDownloadQueue();
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]).toEqual({
      queueId: 'q-1',
      itemId: 'alb-1',
      type: 'album',
      name: 'Some Album',
      artist: 'Some Artist',
      coverArtId: 'cov-1',
      status: 'queued',
      totalSongs: 10,
      completedSongs: 0,
      addedAt: 1_700_000_000_000,
      queuePosition: 1,
      songsJson: '[]',
    });
  });

  it('insertDownloadQueueItem drops rows missing queueId', () => {
    insertDownloadQueueItem(makeQueueRow({ queueId: '' }));
    expect(countDownloadQueueItems()).toBe(0);
  });

  it('removeDownloadQueueItem removes the row', () => {
    insertDownloadQueueItem(makeQueueRow());
    removeDownloadQueueItem('q-1');
    expect(countDownloadQueueItems()).toBe(0);
  });

  it('hydrateDownloadQueue returns rows ordered by queue_position ASC', () => {
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-a', queuePosition: 5 }));
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-b', queuePosition: 1 }));
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-c', queuePosition: 3 }));
    const hydrated = hydrateDownloadQueue();
    expect(hydrated.map((q) => q.queueId)).toEqual(['q-b', 'q-c', 'q-a']);
  });

  it('updateDownloadQueueItem updates status only', () => {
    insertDownloadQueueItem(makeQueueRow());
    updateDownloadQueueItem('q-1', { status: 'downloading' });
    expect(hydrateDownloadQueue()[0].status).toBe('downloading');
  });

  it('updateDownloadQueueItem updates completedSongs only', () => {
    insertDownloadQueueItem(makeQueueRow());
    updateDownloadQueueItem('q-1', { completedSongs: 7 });
    expect(hydrateDownloadQueue()[0].completedSongs).toBe(7);
  });

  it('updateDownloadQueueItem updates error only', () => {
    insertDownloadQueueItem(makeQueueRow());
    updateDownloadQueueItem('q-1', { error: 'network fail' });
    expect(hydrateDownloadQueue()[0].error).toBe('network fail');
  });

  it('updateDownloadQueueItem updates multiple fields at once', () => {
    insertDownloadQueueItem(makeQueueRow());
    updateDownloadQueueItem('q-1', {
      status: 'error',
      completedSongs: 3,
      error: 'boom',
    });
    const row = hydrateDownloadQueue()[0];
    expect(row.status).toBe('error');
    expect(row.completedSongs).toBe(3);
    expect(row.error).toBe('boom');
  });

  it('updateDownloadQueueItem is a no-op when update is empty', () => {
    insertDownloadQueueItem(makeQueueRow());
    updateDownloadQueueItem('q-1', {});
    expect(hydrateDownloadQueue()[0].status).toBe('queued');
  });

  it('reorderDownloadQueue shifts queue_position forward', () => {
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-a', queuePosition: 1 }));
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-b', queuePosition: 2 }));
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-c', queuePosition: 3 }));
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-d', queuePosition: 4 }));
    // Move position 1 → position 3.
    reorderDownloadQueue(1, 3);
    const order = hydrateDownloadQueue();
    expect(order.map((q) => q.queueId)).toEqual(['q-b', 'q-c', 'q-a', 'q-d']);
  });

  it('reorderDownloadQueue shifts queue_position backward', () => {
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-a', queuePosition: 1 }));
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-b', queuePosition: 2 }));
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-c', queuePosition: 3 }));
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-d', queuePosition: 4 }));
    // Move position 4 → position 2.
    reorderDownloadQueue(4, 2);
    const order = hydrateDownloadQueue();
    expect(order.map((q) => q.queueId)).toEqual(['q-a', 'q-d', 'q-b', 'q-c']);
  });

  it('reorderDownloadQueue is a no-op when from == to', () => {
    insertDownloadQueueItem(makeQueueRow({ queueId: 'q-a', queuePosition: 1 }));
    reorderDownloadQueue(1, 1);
    expect(hydrateDownloadQueue()[0].queueId).toBe('q-a');
  });

  it('insertDownloadQueueItem replaces rows with the same queue_id', () => {
    insertDownloadQueueItem(makeQueueRow({ totalSongs: 10 }));
    insertDownloadQueueItem(makeQueueRow({ totalSongs: 99 }));
    expect(countDownloadQueueItems()).toBe(1);
    expect(hydrateDownloadQueue()[0].totalSongs).toBe(99);
  });
});

/* ------------------------------------------------------------------ */
/*  markDownloadComplete                                               */
/* ------------------------------------------------------------------ */

describe('musicCacheTables — markDownloadComplete', () => {
  it('atomically deletes the queue row and writes item + songs + edges', () => {
    insertDownloadQueueItem(makeQueueRow());
    markDownloadComplete(
      'q-1',
      makeItem(),
      [
        makeSong({ id: 's1' }),
        makeSong({ id: 's2' }),
        makeSong({ id: 's3' }),
      ],
      [
        { songId: 's1', position: 1 },
        { songId: 's2', position: 2 },
        { songId: 's3', position: 3 },
      ],
    );

    expect(countDownloadQueueItems()).toBe(0);
    expect(countCachedItems()).toBe(1);
    expect(countCachedSongs()).toBe(3);
    const hydrated = hydrateCachedItems();
    expect(hydrated['alb-1'].songIds).toEqual(['s1', 's2', 's3']);
  });

  it('skips songs missing required identifiers inside the transaction', () => {
    markDownloadComplete(
      'q-1',
      makeItem(),
      [
        makeSong({ id: 's1' }),
        makeSong({ id: '', albumId: 'alb-1' }),
        makeSong({ id: 's2', albumId: '' }),
      ],
      [
        { songId: 's1', position: 1 },
        { songId: '', position: 2 }, // skipped
        { songId: 's2', position: 3 },
      ],
    );

    expect(countCachedSongs()).toBe(1);
    // Only the 's1' edge should make it in — 's2' was skipped due to empty songId? No, s2 edge is fine
    // but the songId on the edge list entry with '' must be filtered.
    // Note: position 3 edge songId 's2' is kept, but no row exists for s2; that's allowed
    // because we don't enforce FK on songs here and the store cleans up later.
    expect(getSongIdsForItem('alb-1').sort()).toEqual(['s1', 's2']);
  });

  it('markDownloadComplete works for a fresh item that wasnt previously queued', () => {
    // No queue row to delete; this is the common case when the service is
    // just committing a finished download in one shot.
    markDownloadComplete(
      'missing-queue-id',
      makeItem({ itemId: 'song:x', type: 'song' }),
      [makeSong({ id: 's9', albumId: 'alb-9' })],
      [{ songId: 's9', position: 1 }],
    );
    expect(countCachedItems()).toBe(1);
    expect(countCachedSongs()).toBe(1);
    expect(hydrateCachedItems()['song:x'].songIds).toEqual(['s9']);
  });
});

/* ------------------------------------------------------------------ */
/*  bulkReplace                                                        */
/* ------------------------------------------------------------------ */

describe('musicCacheTables — bulkReplace', () => {
  it('wipes all four tables and re-inserts the supplied state', () => {
    // Seed pre-existing state.
    upsertCachedItem(makeItem({ itemId: 'old-item' }));
    upsertCachedSong(makeSong({ id: 'old-song' }));
    insertCachedItemSong('old-item', 1, 'old-song');
    insertDownloadQueueItem(makeQueueRow({ queueId: 'old-q' }));

    bulkReplace({
      items: [
        makeItem({ itemId: 'alb-new' }),
        makeItem({ itemId: 'pl-new', type: 'playlist' }),
      ],
      songs: [
        makeSong({ id: 's-new-1' }),
        makeSong({ id: 's-new-2' }),
      ],
      edges: [
        { itemId: 'alb-new', position: 1, songId: 's-new-1' },
        { itemId: 'alb-new', position: 2, songId: 's-new-2' },
        { itemId: 'pl-new', position: 1, songId: 's-new-1' },
      ],
      queue: [makeQueueRow({ queueId: 'q-new' })],
    });

    expect(countCachedItems()).toBe(2);
    expect(countCachedSongs()).toBe(2);
    expect(countDownloadQueueItems()).toBe(1);
    const hydrated = hydrateCachedItems();
    expect(hydrated['alb-new'].songIds).toEqual(['s-new-1', 's-new-2']);
    expect(hydrated['pl-new'].songIds).toEqual(['s-new-1']);
    expect(hydrated['old-item']).toBeUndefined();
    expect(hydrateCachedSongs()['old-song']).toBeUndefined();
  });

  it('silently skips invalid rows inside bulkReplace', () => {
    bulkReplace({
      items: [
        makeItem({ itemId: '' }),
        makeItem({ itemId: 'ok-item' }),
      ],
      songs: [
        makeSong({ id: '' }),
        makeSong({ id: 'ok-song', albumId: '' }),
        makeSong({ id: 'real-song' }),
      ],
      edges: [
        { itemId: '', position: 1, songId: 'real-song' },
        { itemId: 'ok-item', position: 1, songId: '' },
        { itemId: 'ok-item', position: 2, songId: 'real-song' },
      ],
      queue: [
        makeQueueRow({ queueId: '' }),
        makeQueueRow({ queueId: 'ok-q' }),
      ],
    });

    expect(countCachedItems()).toBe(1);
    expect(countCachedSongs()).toBe(1);
    expect(countDownloadQueueItems()).toBe(1);
    expect(hydrateCachedItems()['ok-item'].songIds).toEqual(['real-song']);
  });

  it('bulkReplace with empty inputs truncates to empty tables', () => {
    upsertCachedItem(makeItem());
    upsertCachedSong(makeSong());
    insertCachedItemSong('alb-1', 1, 's1');
    insertDownloadQueueItem(makeQueueRow());

    bulkReplace({ items: [], songs: [], edges: [], queue: [] });

    expect(countCachedItems()).toBe(0);
    expect(countCachedSongs()).toBe(0);
    expect(countDownloadQueueItems()).toBe(0);
  });

  // Regression for the music-downloads-v2 durability bug. bulkReplace wipes
  // all four tables and re-inserts. If the per-row INSERTs use
  // `INSERT OR REPLACE` on a FK-parent table, calling bulkReplace twice with
  // identical input could cascade-delete edges between the runs. With UPSERT
  // the second call is a pure no-op (rows already match, UPDATE sets same
  // values, nothing cascades).
  it('survives re-running with identical input — edges intact, counts match', () => {
    const payload = {
      items: [
        {
          itemId: 'pl-1',
          type: 'playlist' as const,
          name: 'Playlist One',
          artist: undefined,
          coverArtId: undefined,
          expectedSongCount: 2,
          parentAlbumId: undefined,
          lastSyncAt: 1000,
          downloadedAt: 1000,
        },
      ],
      songs: [
        { ...makeSong({ id: 's-a', albumId: 'alb-A' }) },
        { ...makeSong({ id: 's-b', albumId: 'alb-B' }) },
      ],
      edges: [
        { itemId: 'pl-1', position: 1, songId: 's-a' },
        { itemId: 'pl-1', position: 2, songId: 's-b' },
      ],
      queue: [],
    };

    bulkReplace(payload);
    expect(countCachedItems()).toBe(1);
    expect(countCachedSongs()).toBe(2);
    expect(getSongIdsForItem('pl-1')).toEqual(['s-a', 's-b']);

    bulkReplace(payload);
    expect(countCachedItems()).toBe(1);
    expect(countCachedSongs()).toBe(2);
    expect(getSongIdsForItem('pl-1')).toEqual(['s-a', 's-b']);
  });
});

/* ------------------------------------------------------------------ */
/*  clearAllMusicCacheRows                                             */
/* ------------------------------------------------------------------ */

describe('musicCacheTables — clearAllMusicCacheRows', () => {
  it('empties all four tables', () => {
    upsertCachedItem(makeItem());
    upsertCachedSong(makeSong());
    insertCachedItemSong('alb-1', 1, 's1');
    insertDownloadQueueItem(makeQueueRow());

    clearAllMusicCacheRows();

    expect(countCachedItems()).toBe(0);
    expect(countCachedSongs()).toBe(0);
    expect(countDownloadQueueItems()).toBe(0);
    expect(findOrphanSongs()).toEqual([]);
  });

  it('is safe to call on empty tables', () => {
    expect(() => clearAllMusicCacheRows()).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/*  Disabled DB                                                        */
/* ------------------------------------------------------------------ */

describe('musicCacheTables — disabled db (healthy=false)', () => {
  beforeEach(() => {
    __setDbForTests(null);
  });

  it('every read returns a safe default', () => {
    expect(hydrateCachedSongs()).toEqual({});
    expect(hydrateCachedItems()).toEqual({});
    expect(hydrateDownloadQueue()).toEqual([]);
    expect(countCachedSongs()).toBe(0);
    expect(countCachedItems()).toBe(0);
    expect(countDownloadQueueItems()).toBe(0);
    expect(countSongRefs('s1')).toBe(0);
    expect(findOrphanSongs()).toEqual([]);
    expect(getSongIdsForItem('alb-1')).toEqual([]);
    expect(getItemIdsForSong('s1')).toEqual([]);
  });

  it('every write is a no-op', () => {
    expect(() => upsertCachedSong(makeSong())).not.toThrow();
    expect(() => deleteCachedSong('s1')).not.toThrow();
    expect(() => upsertCachedItem(makeItem())).not.toThrow();
    expect(() => deleteCachedItem('alb-1')).not.toThrow();
    expect(() => insertCachedItemSong('alb-1', 1, 's1')).not.toThrow();
    expect(() => removeCachedItemSong('alb-1', 1)).not.toThrow();
    expect(() => reorderCachedItemSongs('alb-1', 1, 2)).not.toThrow();
    expect(() => insertDownloadQueueItem(makeQueueRow())).not.toThrow();
    expect(() => removeDownloadQueueItem('q-1')).not.toThrow();
    expect(() => updateDownloadQueueItem('q-1', { status: 'downloading' })).not.toThrow();
    expect(() => reorderDownloadQueue(1, 2)).not.toThrow();
    expect(() =>
      markDownloadComplete('q-1', makeItem(), [makeSong()], [{ songId: 's1', position: 1 }]),
    ).not.toThrow();
    expect(() =>
      bulkReplace({ items: [], songs: [], edges: [], queue: [] }),
    ).not.toThrow();
    expect(() => clearAllMusicCacheRows()).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/*  DB throws (error swallow path)                                     */
/* ------------------------------------------------------------------ */

describe('musicCacheTables — db throws (error swallow path)', () => {
  const throwingDb = {
    getFirstSync() {
      throw new Error('boom');
    },
    getAllSync() {
      throw new Error('boom');
    },
    runSync() {
      throw new Error('boom');
    },
    execSync() {
      throw new Error('boom');
    },
    withTransactionSync() {
      throw new Error('boom');
    },
  };

  beforeEach(() => {
    __setDbForTests(throwingDb as any);
  });

  it('reads return safe defaults on error', () => {
    expect(hydrateCachedSongs()).toEqual({});
    expect(hydrateCachedItems()).toEqual({});
    expect(hydrateDownloadQueue()).toEqual([]);
    expect(countCachedSongs()).toBe(0);
    expect(countCachedItems()).toBe(0);
    expect(countDownloadQueueItems()).toBe(0);
    expect(countSongRefs('s1')).toBe(0);
    expect(findOrphanSongs()).toEqual([]);
    expect(getSongIdsForItem('alb-1')).toEqual([]);
    expect(getItemIdsForSong('s1')).toEqual([]);
  });

  it('writes swallow errors and do not propagate', () => {
    expect(() => upsertCachedSong(makeSong())).not.toThrow();
    expect(() => deleteCachedSong('s1')).not.toThrow();
    expect(() => upsertCachedItem(makeItem())).not.toThrow();
    expect(() => deleteCachedItem('alb-1')).not.toThrow();
    expect(() => insertCachedItemSong('alb-1', 1, 's1')).not.toThrow();
    expect(() => removeCachedItemSong('alb-1', 1)).not.toThrow();
    expect(() => reorderCachedItemSongs('alb-1', 1, 2)).not.toThrow();
    expect(() => insertDownloadQueueItem(makeQueueRow())).not.toThrow();
    expect(() => removeDownloadQueueItem('q-1')).not.toThrow();
    expect(() => updateDownloadQueueItem('q-1', { status: 'downloading' })).not.toThrow();
    expect(() => reorderDownloadQueue(1, 2)).not.toThrow();
    expect(() =>
      markDownloadComplete('q-1', makeItem(), [makeSong()], [{ songId: 's1', position: 1 }]),
    ).not.toThrow();
    expect(() =>
      bulkReplace({ items: [], songs: [], edges: [], queue: [] }),
    ).not.toThrow();
    expect(() => clearAllMusicCacheRows()).not.toThrow();
  });
});
