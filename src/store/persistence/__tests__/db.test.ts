// Per-suite mocks re-evaluate the module-scope try/catch in db.ts via
// jest.isolateModules. Mirrors the pattern established in the previous
// kvStorage test file.

describe('persistence/db (happy path)', () => {
  let mockGetFirstSync: jest.Mock;
  let mockGetAllSync: jest.Mock;
  let mockRunSync: jest.Mock;
  let mockExecSync: jest.Mock;
  let mockWithTransactionSync: jest.Mock;
  let getDb: typeof import('../db').getDb;
  let __setDbForTests: typeof import('../db').__setDbForTests;
  let dbHealthy: boolean;
  let dbInitError: Error | null;

  beforeAll(() => {
    jest.isolateModules(() => {
      mockGetFirstSync = jest.fn();
      mockGetAllSync = jest.fn();
      mockRunSync = jest.fn();
      mockExecSync = jest.fn();
      mockWithTransactionSync = jest.fn();
      jest.doMock('expo-sqlite', () => ({
        openDatabaseSync: () => ({
          getFirstSync: mockGetFirstSync,
          getAllSync: mockGetAllSync,
          runSync: mockRunSync,
          execSync: mockExecSync,
          withTransactionSync: mockWithTransactionSync,
        }),
      }));
      const mod = require('../db');
      getDb = mod.getDb;
      __setDbForTests = mod.__setDbForTests;
      dbHealthy = mod.dbHealthy;
      dbInitError = mod.dbInitError;
    });
  });

  it('reports healthy with no init error', () => {
    expect(dbHealthy).toBe(true);
    expect(dbInitError).toBeNull();
  });

  it('returns the shared handle from getDb', () => {
    const handle = getDb();
    expect(handle).not.toBeNull();
    expect(handle?.getFirstSync).toBe(mockGetFirstSync);
    expect(handle?.runSync).toBe(mockRunSync);
    expect(handle?.execSync).toBe(mockExecSync);
    expect(handle?.withTransactionSync).toBe(mockWithTransactionSync);
  });

  it('applies PRAGMAs in the documented order', () => {
    const pragmaCalls = mockExecSync.mock.calls
      .map((c) => c[0] as string)
      .filter((sql) => sql.startsWith('PRAGMA'));
    expect(pragmaCalls).toEqual([
      'PRAGMA journal_mode = WAL;',
      'PRAGMA synchronous = NORMAL;',
      'PRAGMA foreign_keys = ON;',
    ]);
  });

  it('creates every persistence table in FK-safe order', () => {
    const creates = mockExecSync.mock.calls
      .map((c) => c[0] as string)
      .filter((sql) => sql.trim().startsWith('CREATE TABLE'));
    // The order here is load-bearing: cached_items must be created before
    // cached_item_songs so the FOREIGN KEY clause resolves.
    const tableNames = creates.map((sql) => {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      return match?.[1];
    });
    expect(tableNames).toEqual([
      'storage',
      'album_details',
      'song_index',
      'scrobble_events',
      'cached_songs',
      'cached_items',
      'cached_item_songs',
      'download_queue',
    ]);
  });

  it('creates every expected index', () => {
    const indexNames = mockExecSync.mock.calls
      .map((c) => c[0] as string)
      .filter((sql) => sql.trim().startsWith('CREATE INDEX'))
      .map((sql) => {
        const match = sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/);
        return match?.[1];
      });
    expect(indexNames.sort()).toEqual(
      [
        'idx_cached_item_songs_song_id',
        'idx_cached_songs_album_id',
        'idx_download_queue_position',
        'idx_download_queue_status',
        'idx_scrobble_events_time',
        'idx_song_index_albumId',
        'idx_song_index_title',
      ].sort(),
    );
  });

  it('cached_item_songs declares ON DELETE CASCADE on item_id', () => {
    // Guards against accidental schema regression — the cascade behavior is
    // exactly what the UPSERT fix in commit 5867ff0 relies on for orphan
    // edges to clean up, and its absence would silently corrupt the
    // refcount-by-COUNT invariant.
    const cascadeDdl = mockExecSync.mock.calls
      .map((c) => c[0] as string)
      .find((sql) => sql.includes('cached_item_songs'));
    expect(cascadeDdl).toMatch(/ON DELETE CASCADE/);
  });

  describe('__setDbForTests', () => {
    it('swaps the shared handle and restores it', () => {
      const original = getDb();
      const fake = {
        getFirstSync: jest.fn(),
        getAllSync: jest.fn(),
        runSync: jest.fn(),
        execSync: jest.fn(),
        withTransactionSync: jest.fn(),
      };
      __setDbForTests(fake);
      expect(getDb()).toBe(fake);
      __setDbForTests(original);
      expect(getDb()).toBe(original);
    });

    it('accepts null to simulate an unhealthy DB', () => {
      const original = getDb();
      __setDbForTests(null);
      expect(getDb()).toBeNull();
      __setDbForTests(original);
    });
  });
});

describe('persistence/db (init failure)', () => {
  let getDb: typeof import('../db').getDb;
  let kvFallback: Map<string, string>;
  let dbHealthy: boolean;
  let dbInitError: Error | null;
  let warnSpy: jest.SpyInstance;

  beforeAll(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.isolateModules(() => {
      jest.doMock('expo-sqlite', () => ({
        openDatabaseSync: () => {
          throw new Error('OEM ICU/JSSE failure');
        },
      }));
      const mod = require('../db');
      getDb = mod.getDb;
      kvFallback = mod.kvFallback;
      dbHealthy = mod.dbHealthy;
      dbInitError = mod.dbInitError;
    });
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('reports unhealthy and captures the init error', () => {
    expect(dbHealthy).toBe(false);
    expect(dbInitError).toBeInstanceOf(Error);
    expect(dbInitError?.message).toContain('OEM ICU/JSSE failure');
  });

  it('getDb returns null when init failed', () => {
    expect(getDb()).toBeNull();
  });

  it('exposes an empty kvFallback Map for the KV adapter to use', () => {
    expect(kvFallback).toBeInstanceOf(Map);
    expect(kvFallback.size).toBe(0);
  });

  it('logs a warning when init fails', () => {
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[persistence/db] init failed'),
      expect.any(String),
    );
  });
});

describe('persistence/db (non-Error throw)', () => {
  let dbInitError: Error | null;
  let warnSpy: jest.SpyInstance;

  beforeAll(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.isolateModules(() => {
      jest.doMock('expo-sqlite', () => ({
        openDatabaseSync: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'string-shaped failure';
        },
      }));
      const mod = require('../db');
      dbInitError = mod.dbInitError;
    });
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('coerces non-Error throws into a real Error', () => {
    expect(dbInitError).toBeInstanceOf(Error);
    expect(dbInitError?.message).toBe('string-shaped failure');
  });
});
