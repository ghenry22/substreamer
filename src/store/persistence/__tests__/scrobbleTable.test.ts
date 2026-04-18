// Mock expo-sqlite with a minimal no-op DB so module init succeeds and the
// CREATE TABLE / CREATE INDEX / PRAGMA paths are exercised for coverage.
// Individual tests override via `__setDbForTests` with a richer fake.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

import {
  __setDbForTests,
  clearScrobbles,
  countScrobbles,
  hydrateScrobbles,
  insertScrobble,
  replaceAllScrobbles,
} from '../scrobbleTable';

/** Minimal InternalDb fake that records rows in a Map keyed by id. */
function makeFakeDb() {
  const rows = new Map<string, { id: string; song_json: string; time: number }>();

  const runSync = (sql: string, params: readonly unknown[] = []): void => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT OR IGNORE INTO scrobble_events')) {
      const [id, song_json, time] = params as [string, string, number];
      if (!rows.has(id)) {
        rows.set(id, { id, song_json, time });
      }
    } else if (s.startsWith('DELETE FROM scrobble_events')) {
      rows.clear();
    } else {
      throw new Error(`unhandled SQL in fake: ${s}`);
    }
  };

  return {
    rows,
    getFirstSync<T>(sql: string): T | undefined {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('COUNT(*) AS c FROM scrobble_events')) {
        return { c: rows.size } as T;
      }
      return undefined;
    },
    getAllSync<T>(sql: string): T[] {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT id, song_json, time FROM scrobble_events')) {
        // Mimic ORDER BY time ASC so hydrate order assertions are meaningful.
        return Array.from(rows.values()).sort((a, b) => a.time - b.time) as T[];
      }
      return [];
    },
    runSync,
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  };
}

function makeScrobble(overrides?: Record<string, any>): any {
  return {
    id: 'sc-1',
    song: { id: 's1', title: 'Song One', artist: 'Artist', duration: 180 },
    time: 1_700_000_000_000,
    ...overrides,
  };
}

let fakeDb: ReturnType<typeof makeFakeDb>;

beforeEach(() => {
  fakeDb = makeFakeDb();
  __setDbForTests(fakeDb as any);
});

afterEach(() => {
  __setDbForTests(null);
});

describe('scrobbleTable — insert + hydrate', () => {
  it('insertScrobble + hydrateScrobbles round-trip preserves fields', () => {
    const s = makeScrobble();
    insertScrobble(s);

    const restored = hydrateScrobbles();
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('sc-1');
    expect(restored[0].time).toBe(1_700_000_000_000);
    expect(restored[0].song.id).toBe('s1');
    expect(restored[0].song.title).toBe('Song One');
    expect(restored[0].song.artist).toBe('Artist');
  });

  it('insertScrobble is INSERT OR IGNORE — duplicate ids are silently skipped', () => {
    insertScrobble(makeScrobble({ id: 'dup', time: 1 }));
    insertScrobble(makeScrobble({ id: 'dup', time: 999, song: { id: 's2', title: 'Different' } }));

    expect(countScrobbles()).toBe(1);
    const restored = hydrateScrobbles();
    // First insert wins (INSERT OR IGNORE) — neither time nor song should change.
    expect(restored[0].time).toBe(1);
    expect(restored[0].song.id).toBe('s1');
  });

  it('insertScrobble skips records missing id / song.id / song.title', () => {
    insertScrobble(makeScrobble({ id: '' }));
    insertScrobble(makeScrobble({ id: 'bad-song-id', song: { id: '', title: 'x' } }));
    insertScrobble(makeScrobble({ id: 'no-title', song: { id: 's1', title: '' } }));
    insertScrobble(makeScrobble({ id: 'null-song', song: null }));

    expect(countScrobbles()).toBe(0);
  });

  it('hydrateScrobbles returns rows in time-ascending order', () => {
    insertScrobble(makeScrobble({ id: 'a', time: 300 }));
    insertScrobble(makeScrobble({ id: 'b', time: 100 }));
    insertScrobble(makeScrobble({ id: 'c', time: 200 }));

    const restored = hydrateScrobbles();
    expect(restored.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('hydrateScrobbles returns empty when table is empty', () => {
    expect(hydrateScrobbles()).toEqual([]);
  });

  it('hydrateScrobbles skips unparseable song_json rows', () => {
    fakeDb.rows.set('good', {
      id: 'good',
      song_json: JSON.stringify({ id: 's1', title: 'OK' }),
      time: 1,
    });
    fakeDb.rows.set('bad', { id: 'bad', song_json: '{not valid', time: 2 });

    const restored = hydrateScrobbles();
    expect(restored.map((s) => s.id)).toEqual(['good']);
  });

  it('hydrateScrobbles filters rows whose decoded song is invalid', () => {
    fakeDb.rows.set('missing-song-id', {
      id: 'missing-song-id',
      song_json: JSON.stringify({ title: 'no id' }),
      time: 1,
    });
    fakeDb.rows.set('missing-title', {
      id: 'missing-title',
      song_json: JSON.stringify({ id: 's1' }),
      time: 2,
    });
    fakeDb.rows.set('null-decoded', { id: 'null-decoded', song_json: 'null', time: 3 });
    fakeDb.rows.set('ok', {
      id: 'ok',
      song_json: JSON.stringify({ id: 's9', title: 'Valid' }),
      time: 4,
    });

    const restored = hydrateScrobbles();
    expect(restored.map((s) => s.id)).toEqual(['ok']);
  });

  it('hydrateScrobbles dedupes rows that share an id (defense in depth)', () => {
    // Bypass the Map key-uniqueness of the fake by smuggling in a
    // duplicate-id row via a second Map entry — getAllSync pulls both.
    fakeDb.rows.set('key1', {
      id: 'dup',
      song_json: JSON.stringify({ id: 's1', title: 'First' }),
      time: 1,
    });
    fakeDb.rows.set('key2', {
      id: 'dup',
      song_json: JSON.stringify({ id: 's1', title: 'Second' }),
      time: 2,
    });

    const restored = hydrateScrobbles();
    expect(restored).toHaveLength(1);
    expect(restored[0].song.title).toBe('First');
  });
});

describe('scrobbleTable — replaceAllScrobbles', () => {
  it('wipes existing rows and inserts the new set', () => {
    insertScrobble(makeScrobble({ id: 'old-1' }));
    insertScrobble(makeScrobble({ id: 'old-2' }));
    expect(countScrobbles()).toBe(2);

    replaceAllScrobbles([
      makeScrobble({ id: 'new-1', time: 5 }),
      makeScrobble({ id: 'new-2', time: 10 }),
    ]);

    expect(countScrobbles()).toBe(2);
    const restored = hydrateScrobbles();
    expect(restored.map((s) => s.id).sort()).toEqual(['new-1', 'new-2']);
  });

  it('drops invalid / duplicate records before inserting', () => {
    replaceAllScrobbles([
      makeScrobble({ id: 'ok' }),
      makeScrobble({ id: 'ok' }),
      makeScrobble({ id: '' }),
      makeScrobble({ id: 'bad-song', song: { id: '', title: 'x' } }),
      makeScrobble({ id: 'no-title', song: { id: 's1', title: '' } }),
      makeScrobble({ id: 'null-song', song: null }),
    ] as any);

    expect(countScrobbles()).toBe(1);
    const restored = hydrateScrobbles();
    expect(restored[0].id).toBe('ok');
  });

  it('replaceAllScrobbles with empty array clears the table', () => {
    insertScrobble(makeScrobble({ id: 'a' }));
    replaceAllScrobbles([]);
    expect(countScrobbles()).toBe(0);
  });
});

describe('scrobbleTable — clearScrobbles', () => {
  it('wipes the table', () => {
    insertScrobble(makeScrobble({ id: 'a' }));
    insertScrobble(makeScrobble({ id: 'b' }));
    clearScrobbles();
    expect(countScrobbles()).toBe(0);
    expect(hydrateScrobbles()).toEqual([]);
  });

  it('is safe to call on an empty table', () => {
    expect(() => clearScrobbles()).not.toThrow();
    expect(countScrobbles()).toBe(0);
  });
});

describe('scrobbleTable — disabled db (healthy=false path)', () => {
  beforeEach(() => {
    __setDbForTests(null);
  });

  it('all mutations are no-ops when db is unavailable', () => {
    insertScrobble(makeScrobble());
    replaceAllScrobbles([makeScrobble()]);
    clearScrobbles();
    expect(countScrobbles()).toBe(0);
    expect(hydrateScrobbles()).toEqual([]);
  });
});

describe('scrobbleTable — db throws (error swallow path)', () => {
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

  it('mutations swallow errors and do not propagate', () => {
    expect(() => insertScrobble(makeScrobble())).not.toThrow();
    expect(() => replaceAllScrobbles([makeScrobble()])).not.toThrow();
    expect(() => clearScrobbles()).not.toThrow();
  });

  it('reads return safe defaults on DB error', () => {
    expect(countScrobbles()).toBe(0);
    expect(hydrateScrobbles()).toEqual([]);
  });
});
