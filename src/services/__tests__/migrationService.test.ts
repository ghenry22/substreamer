const mockFileWrite = jest.fn();
let mockFileExists = false;
let mockDirExists = false;
const mockDirDelete = jest.fn();
const mockFileDelete = jest.fn();
const mockFileMove = jest.fn();
const mockDirCreate = jest.fn();
// Per-path overrides — when set, these take precedence over the global flags.
// Keyed by the uri produced by MockFile/MockDirectory (segments joined with '/').
let mockFileExistsForUri: ((uri: string) => boolean) | null = null;
let mockDirExistsForUri: ((uri: string) => boolean) | null = null;

jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

// detailTables imports expo-sqlite directly; stub it so the migration test
// doesn't drag the real native handle through expo-asset + expo-constants.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('mocked — detailTables fallback path used in tests');
  },
}));

// Task #13 delegates bulk-insert to the scrobble table helper. Mock it so we
// can assert wiring without needing a real SQLite handle.
jest.mock('../../store/persistence/scrobbleTable', () => ({
  replaceAllScrobbles: jest.fn(),
  insertScrobble: jest.fn(),
  clearScrobbles: jest.fn(),
  hydrateScrobbles: jest.fn(() => []),
}));

// Task #14 calls bulkReplace to write the v2 rows. Mock the whole module so
// tests don't need a real SQLite handle; assertions are on the mock calls.
jest.mock('../../store/persistence/musicCacheTables', () => ({
  bulkReplace: jest.fn(),
  deleteCachedSong: jest.fn(),
  deleteCachedItem: jest.fn(),
  clearAllMusicCacheRows: jest.fn(),
  hydrateCachedSongs: jest.fn(() => ({})),
  hydrateCachedItems: jest.fn(() => ({})),
  hydrateDownloadQueue: jest.fn(() => []),
  // Task 14 diagnostic helpers.
  countCachedSongs: jest.fn(() => 0),
  countCachedItems: jest.fn(() => 0),
  countCachedItemSongs: jest.fn(() => 0),
  countDownloadQueueItems: jest.fn(() => 0),
  readPragma: jest.fn(() => '1'),
  insertCachedItemSong: jest.fn(),
  upsertCachedItem: jest.fn(),
  musicCacheTablesHealthy: true,
  musicCacheTablesInitError: null,
}));

// Task #14 consults albumDetailStore for albumId resolution when a playlist
// track's album wasn't itself cached as a v1 album item. Mock with a
// controllable getState() so tests can dial the resolution map up and down.
let mockAlbumDetailAlbums: Record<string, any> = {};
jest.mock('../../store/albumDetailStore', () => ({
  albumDetailStore: {
    getState: () => ({ albums: mockAlbumDetailAlbums }),
  },
}));

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = parts.map((p: any) => (typeof p === 'string' ? p : p.uri ?? '')).join('/');
    }
    get exists() {
      if (mockFileExistsForUri) return mockFileExistsForUri(this.uri);
      return mockFileExists;
    }
    write = mockFileWrite;
    delete = mockFileDelete;
    move = (target: any) => mockFileMove(this.uri, target?.uri ?? target);
    text = jest.fn().mockResolvedValue('');
  }
  class MockDirectory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = parts.map((p: any) => (typeof p === 'string' ? p : p.uri ?? '')).join('/');
    }
    get exists() {
      if (mockDirExistsForUri) return mockDirExistsForUri(this.uri);
      return mockDirExists;
    }
    create = (...args: any[]) => mockDirCreate(this.uri, ...args);
    delete = mockDirDelete;
    get parentDirectory() { return new MockDirectory('parent'); }
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: {
      document: new MockDirectory('document'),
    },
  };
});

const mockListDirectoryAsync = jest.fn().mockResolvedValue([]);

jest.mock('expo-async-fs', () => ({
  listDirectoryAsync: (...args: any[]) => mockListDirectoryAsync(...args),
}));

jest.mock('expo-gzip', () => ({
  compressToFile: jest.fn().mockResolvedValue({ bytes: 0 }),
  decompressFromFile: jest.fn().mockResolvedValue(''),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { Platform } from 'react-native';
import { getPendingTasks, runMigrations } from '../migrationService';
import { completedScrobbleStore } from '../../store/completedScrobbleStore';
import { mbidOverrideStore } from '../../store/mbidOverrideStore';
import { musicCacheStore } from '../../store/musicCacheStore';
import { playbackSettingsStore } from '../../store/playbackSettingsStore';
import { bulkReplace } from '../../store/persistence/musicCacheTables';
import { replaceAllScrobbles } from '../../store/persistence/scrobbleTable';
import { sqliteStorage } from '../../store/sqliteStorage';

const mockReplaceAllScrobbles = replaceAllScrobbles as jest.Mock;
const mockBulkReplace = bulkReplace as jest.Mock;

function seedAuthInSqlite(serverUrl: string | null, username: string | null) {
  if (!serverUrl || !username) {
    sqliteStorage.removeItem('substreamer-auth');
    return;
  }
  sqliteStorage.setItem(
    'substreamer-auth',
    JSON.stringify({ state: { serverUrl, username } }),
  );
}

beforeEach(() => {
  mockFileWrite.mockClear();
  // Use mockReset (not mockClear) on mocks that individual tests override
  // via mockImplementation — mockClear preserves implementations, which
  // leaks test-specific behaviour into unrelated later tests.
  mockDirDelete.mockReset();
  mockFileDelete.mockReset();
  mockFileMove.mockReset();
  mockDirCreate.mockReset();
  mockListDirectoryAsync.mockReset().mockResolvedValue([]);
  mockFileExists = false;
  mockDirExists = false;
  mockFileExistsForUri = null;
  mockDirExistsForUri = null;
  (Platform as any).OS = 'ios';
  sqliteStorage.removeItem('substreamer-auth');
  sqliteStorage.removeItem('substreamer-mbid-overrides');
  sqliteStorage.removeItem('substreamer-playback-settings');
  sqliteStorage.removeItem('substreamer-shares');
  sqliteStorage.removeItem('substreamer-music-cache');
  sqliteStorage.removeItem('substreamer-music-cache-settings');
  sqliteStorage.removeItem('substreamer-completed-scrobbles');
  sqliteStorage.removeItem('substreamer-playlist-details');
  sqliteStorage.removeItem('substreamer-favorites');
  mbidOverrideStore.setState({ overrides: {} } as any);
  musicCacheStore.setState({ cachedSongs: {}, cachedItems: {} } as any);
  mockReplaceAllScrobbles.mockClear();
  mockBulkReplace.mockClear();
  // Reset mocks used by Task 14's diagnostic logging between tests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mct = require('../../store/persistence/musicCacheTables');
  mct.countCachedSongs.mockReset().mockReturnValue(0);
  mct.countCachedItems.mockReset().mockReturnValue(0);
  mct.countCachedItemSongs.mockReset().mockReturnValue(0);
  mct.countDownloadQueueItems.mockReset().mockReturnValue(0);
  mct.readPragma.mockReset().mockReturnValue('1');
  mockAlbumDetailAlbums = {};
  seedAuthInSqlite('https://music.example.com', 'testuser');
});

describe('getPendingTasks', () => {
  it('returns all tasks when completedVersion is 0', () => {
    const tasks = getPendingTasks(0);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks[0].id).toBe(1);
  });

  it('returns tasks after completedVersion', () => {
    const tasks = getPendingTasks(1);
    expect(tasks.every((t) => t.id > 1)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array when all tasks are completed', () => {
    const tasks = getPendingTasks(999);
    expect(tasks).toHaveLength(0);
  });

  it('returns tasks in order', () => {
    const tasks = getPendingTasks(0);
    for (let i = 1; i < tasks.length; i++) {
      expect(tasks[i].id).toBeGreaterThan(tasks[i - 1].id);
    }
  });
});

describe('runMigrations', () => {
  it('runs pending tasks and returns new completedVersion', async () => {
    const newVersion = await runMigrations(0);
    expect(newVersion).toBeGreaterThanOrEqual(2);
  });

  it('calls onProgress for each task', async () => {
    const onProgress = jest.fn();
    await runMigrations(0, onProgress);
    expect(onProgress).toHaveBeenCalledTimes(getPendingTasks(0).length);
    expect(onProgress.mock.calls[0][0]).toHaveProperty('id', 1);
    expect(onProgress.mock.calls[0][0]).toHaveProperty('name');
  });

  it('writes a migration log file', async () => {
    await runMigrations(0);
    expect(mockFileWrite).toHaveBeenCalledTimes(1);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Migration run:');
    expect(logContent).toContain('Task 1');
    expect(logContent).toContain('Task 2');
  });

  it('returns same version when no tasks are pending', async () => {
    const newVersion = await runMigrations(999);
    expect(newVersion).toBe(999);
  });

  it('writes a log file even when no tasks are pending', async () => {
    await runMigrations(999);
    expect(mockFileWrite).toHaveBeenCalledTimes(1);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Migration run:');
    expect(logContent).not.toContain('Task 1');
  });

  it('logs include platform info', async () => {
    await runMigrations(0);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Platform: ios');
  });

  it('Task 1 includes android files dir in bases', async () => {
    (Platform as any).OS = 'android';
    await runMigrations(0);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Platform: android');
    // The android branch adds a 'files' subdirectory to the bases list
    expect(logContent).toContain('files');
  });

  it('Task 1 deletes existing legacy directories', async () => {
    mockDirExists = true;
    await runMigrations(0);
    expect(mockDirDelete).toHaveBeenCalled();
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Removed:');
  });

  it('Task 1 logs failure when dir.delete throws', async () => {
    mockDirExists = true;
    mockDirDelete.mockImplementation(() => { throw new Error('EPERM'); });
    await runMigrations(0);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to remove:');
  });

  it('Task 2 deletes legacy database files when dbDir exists', async () => {
    mockDirExists = true;
    mockFileExists = true;
    await runMigrations(0);
    expect(mockFileDelete).toHaveBeenCalled();
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Checking directory:');
    expect(logContent).toContain('Removed:');
  });

  it('Task 2 logs failure when file.delete throws', async () => {
    mockDirExists = true;
    mockFileExists = true;
    mockFileDelete.mockImplementation(() => { throw new Error('EPERM'); });
    await runMigrations(0);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to remove:');
  });

  it('Task 3 skips aggregate rebuild when no scrobbles', async () => {
    completedScrobbleStore.setState({ completedScrobbles: [] } as any);
    await runMigrations(2);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No scrobbles');
    expect(logContent).toContain('skipping aggregate rebuild');
  });

  it('Task 3 rebuilds aggregates when scrobbles exist', async () => {
    const mockRebuild = jest.fn();
    completedScrobbleStore.setState({
      completedScrobbles: [
        { id: '1', song: { id: 's1', title: 'Song', artist: 'A', duration: 200 }, time: Date.now() },
      ],
      rebuildAggregates: mockRebuild,
    } as any);
    await runMigrations(2);
    expect(mockRebuild).toHaveBeenCalled();
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Rebuilt aggregates for 1 scrobbles');
  });

  it('Task 2 uses android databases path', async () => {
    (Platform as any).OS = 'android';
    mockDirExists = true;
    mockFileExists = false;
    await runMigrations(0);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Checking directory:');
    expect(logContent).toContain('Not found:');
  });

  it('Task 4 skips when no persisted shares data', async () => {
    sqliteStorage.removeItem('substreamer-shares');
    await runMigrations(3);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted shares data');
  });

  it('Task 4 skips when shares data is valid', async () => {
    sqliteStorage.setItem('substreamer-shares', JSON.stringify({ state: { shares: [] } }));
    await runMigrations(3);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Shares data is valid');
  });

  it('Task 4 fixes corrupted shares field', async () => {
    sqliteStorage.setItem('substreamer-shares', JSON.stringify({ state: { shares: null } }));
    await runMigrations(3);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Fixed corrupted shares field');
    const restored = JSON.parse(sqliteStorage.getItem('substreamer-shares') as string);
    expect(restored.state.shares).toEqual([]);
  });

  it('Task 4 removes unparseable JSON', async () => {
    sqliteStorage.setItem('substreamer-shares', '{bad json');
    await runMigrations(3);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Removed unparseable shares data');
    expect(sqliteStorage.getItem('substreamer-shares')).toBeNull();
  });

  it('Task 5 skips when no persisted MBID overrides', async () => {
    sqliteStorage.removeItem('substreamer-mbid-overrides');
    await runMigrations(4);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted MBID overrides');
  });

  it('Task 5 skips when persisted MBID overrides are unparseable', async () => {
    sqliteStorage.setItem('substreamer-mbid-overrides', '{bad json');
    await runMigrations(4);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to parse MBID overrides');
  });

  it('Task 5 skips when persisted data has no overrides object', async () => {
    sqliteStorage.setItem('substreamer-mbid-overrides', JSON.stringify({ state: {} }));
    await runMigrations(4);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No overrides object');
  });

  it('Task 5 skips when overrides object is empty', async () => {
    sqliteStorage.setItem(
      'substreamer-mbid-overrides',
      JSON.stringify({ state: { overrides: {} } }),
    );
    await runMigrations(4);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('MBID overrides empty');
  });

  it('Task 5 skips when overrides already migrated', async () => {
    sqliteStorage.setItem(
      'substreamer-mbid-overrides',
      JSON.stringify({
        state: {
          overrides: {
            'artist:123': { type: 'artist', entityId: '123', entityName: 'Test', mbid: 'abc' },
          },
        },
      }),
    );
    await runMigrations(4);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('already in new format');
  });

  it('Task 5 migrates old-format overrides to new format', async () => {
    sqliteStorage.setItem(
      'substreamer-mbid-overrides',
      JSON.stringify({
        state: {
          overrides: {
            '123': { artistId: '123', artistName: 'Test Artist', mbid: 'abc-def' },
          },
        },
      }),
    );
    await runMigrations(4);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Migrated 1 MBID override(s)');

    const persisted = JSON.parse(sqliteStorage.getItem('substreamer-mbid-overrides') as string);
    expect(persisted.state.overrides['artist:123']).toEqual({
      type: 'artist',
      entityId: '123',
      entityName: 'Test Artist',
      mbid: 'abc-def',
    });
    expect(mbidOverrideStore.getState().overrides['artist:123']).toEqual({
      type: 'artist',
      entityId: '123',
      entityName: 'Test Artist',
      mbid: 'abc-def',
    });
  });

  it('Task 5 skips entries without mbid when migrating', async () => {
    sqliteStorage.setItem(
      'substreamer-mbid-overrides',
      JSON.stringify({
        state: {
          overrides: {
            '123': { artistId: '123', artistName: 'With MBID', mbid: 'abc' },
            '456': { artistId: '456', artistName: 'Missing MBID' },
          },
        },
      }),
    );
    await runMigrations(4);
    const persisted = JSON.parse(sqliteStorage.getItem('substreamer-mbid-overrides') as string);
    expect(Object.keys(persisted.state.overrides)).toEqual(['artist:123']);
  });

  it('Task 6 sets default on in-memory store when no persisted playback settings', async () => {
    (Platform as any).OS = 'android';
    playbackSettingsStore.setState({ estimateContentLength: false });
    // Remove AFTER setState — Zustand persist writes through to SQLite on setState.
    sqliteStorage.removeItem('substreamer-playback-settings');
    await runMigrations(5);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted playback settings');
    expect(playbackSettingsStore.getState().estimateContentLength).toBe(true);
  });

  it('Task 6 updates in-memory store after persisting', async () => {
    (Platform as any).OS = 'android';
    sqliteStorage.setItem(
      'substreamer-playback-settings',
      JSON.stringify({ state: { estimateContentLength: false } }),
    );
    playbackSettingsStore.setState({ estimateContentLength: false });
    await runMigrations(5);
    expect(playbackSettingsStore.getState().estimateContentLength).toBe(true);
  });

  it('Task 6 sets estimateContentLength to false on iOS', async () => {
    (Platform as any).OS = 'ios';
    sqliteStorage.setItem(
      'substreamer-playback-settings',
      JSON.stringify({ state: { estimateContentLength: true } }),
    );
    await runMigrations(5);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Set estimateContentLength to false (ios)');
    const restored = JSON.parse(sqliteStorage.getItem('substreamer-playback-settings') as string);
    expect(restored.state.estimateContentLength).toBe(false);
  });

  it('Task 6 sets estimateContentLength to true on Android', async () => {
    (Platform as any).OS = 'android';
    sqliteStorage.setItem(
      'substreamer-playback-settings',
      JSON.stringify({ state: { estimateContentLength: false } }),
    );
    await runMigrations(5);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Set estimateContentLength to true (android)');
    const restored = JSON.parse(sqliteStorage.getItem('substreamer-playback-settings') as string);
    expect(restored.state.estimateContentLength).toBe(true);
  });

  it('Task 6 skips when persisted data has no state', async () => {
    sqliteStorage.setItem('substreamer-playback-settings', JSON.stringify({}));
    await runMigrations(5);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No state in persisted data');
  });

  it('Task 6 handles corrupted JSON gracefully', async () => {
    sqliteStorage.setItem('substreamer-playback-settings', '{bad json');
    await runMigrations(5);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to parse playback settings');
  });

  it('Task 7 skips when no persisted auth', async () => {
    seedAuthInSqlite(null, null);
    await runMigrations(6);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted auth');
  });

  it('Task 7 skips when persisted auth is unparseable', async () => {
    sqliteStorage.setItem('substreamer-auth', '{bad json');
    await runMigrations(6);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to parse persisted auth');
  });

  it('Task 7 skips when persisted auth has no serverUrl/username', async () => {
    sqliteStorage.setItem('substreamer-auth', JSON.stringify({ state: {} }));
    await runMigrations(6);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No active session');
  });

  it('Task 7 skips when no v3 backups found', async () => {
    mockListDirectoryAsync.mockResolvedValue([]);
    await runMigrations(6);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No v3 backup files found');
  });

  it('Task 7 logs task header when processing backup files', async () => {
    // The actual migration logic is tested in backupService.test.ts.
    // Here we verify the migration task logs correctly when delegate runs.
    mockListDirectoryAsync.mockResolvedValue(['backup-old.meta.json']);
    await runMigrations(6);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Task 7: Stamp backup files with user identity');
  });

  it('Task 8 skips when no persisted overrides', async () => {
    sqliteStorage.removeItem('substreamer-mbid-overrides');
    await runMigrations(7);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted MBID overrides — nothing to repair');
  });

  it('Task 8 skips when overrides payload is unparseable', async () => {
    sqliteStorage.setItem('substreamer-mbid-overrides', '{bad json');
    await runMigrations(7);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to parse MBID overrides — skipping repair');
  });

  it('Task 8 skips when overrides object is missing', async () => {
    sqliteStorage.setItem('substreamer-mbid-overrides', JSON.stringify({ state: {} }));
    await runMigrations(7);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No overrides object');
  });

  it('Task 8 reports when all entries are already in correct shape', async () => {
    sqliteStorage.setItem(
      'substreamer-mbid-overrides',
      JSON.stringify({
        state: {
          overrides: {
            'artist:123': { type: 'artist', entityId: '123', entityName: 'X', mbid: 'm1' },
          },
        },
      }),
    );
    await runMigrations(7);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('already in correct shape');
  });

  it('Task 8 synthesizes normalized entry from old-shape key without prefix', async () => {
    sqliteStorage.setItem(
      'substreamer-mbid-overrides',
      JSON.stringify({
        state: {
          overrides: {
            '123': { artistId: '123', artistName: 'Old Artist', mbid: 'm1' },
          },
        },
      }),
    );
    await runMigrations(7);
    const persisted = JSON.parse(sqliteStorage.getItem('substreamer-mbid-overrides') as string);
    expect(persisted.state.overrides['artist:123']).toEqual({
      type: 'artist',
      entityId: '123',
      entityName: 'Old Artist',
      mbid: 'm1',
    });
    expect(mbidOverrideStore.getState().overrides['artist:123']).toBeDefined();
  });

  it('Task 8 synthesizes album entry when key has album: prefix', async () => {
    sqliteStorage.setItem(
      'substreamer-mbid-overrides',
      JSON.stringify({
        state: {
          overrides: {
            'album:999': { mbid: 'm2' },
          },
        },
      }),
    );
    await runMigrations(7);
    const persisted = JSON.parse(sqliteStorage.getItem('substreamer-mbid-overrides') as string);
    expect(persisted.state.overrides['album:999']).toEqual({
      type: 'album',
      entityId: '999',
      entityName: '',
      mbid: 'm2',
    });
  });

  it('Task 8 skips entries without mbid', async () => {
    sqliteStorage.setItem(
      'substreamer-mbid-overrides',
      JSON.stringify({
        state: {
          overrides: {
            '123': { artistId: '123', artistName: 'Missing MBID' },
            '456': { artistId: '456', artistName: 'Has MBID', mbid: 'm1' },
          },
        },
      }),
    );
    await runMigrations(7);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('skipped 1 malformed');
    const persisted = JSON.parse(sqliteStorage.getItem('substreamer-mbid-overrides') as string);
    expect(Object.keys(persisted.state.overrides)).toEqual(['artist:456']);
  });

  it('Task 9 delegates to v3 backup stamping helper', async () => {
    seedAuthInSqlite('https://music.example.com', 'testuser');
    mockListDirectoryAsync.mockResolvedValue([]);
    await runMigrations(8);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Task 9: Repair v3 backup identity stamping');
    expect(logContent).toContain('No v3 backup files found');
  });

  it('Task 9 skips when no persisted auth', async () => {
    seedAuthInSqlite(null, null);
    await runMigrations(8);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted auth');
  });
});

describe('Task 10 – Backfill downloaded track formats (deprecated in v2)', () => {
  // Task 10 was the v1 migration that populated `downloadedFormats` on the
  // music-cache blob. In v2 that map no longer exists — format metadata
  // lives inline on the `cached_songs` per-row table, and Task 14 owns the
  // v1 → v2 migration. Task 10 is kept as a no-op so the migration ID
  // sequence is preserved for users whose `completedVersion` is still < 10.
  it('logs the deprecated-task notice and makes no store or blob writes', async () => {
    // Seed a v1 blob that would previously have exercised the backfill path
    // to prove that the no-op implementation ignores it.
    sqliteStorage.setItem(
      'substreamer-music-cache',
      JSON.stringify({
        state: {
          cachedItems: {
            album1: {
              tracks: [
                { id: 't1', fileName: 'song.flac' },
                { id: 't2', fileName: 'track.mp3' },
              ],
            },
          },
          downloadedFormats: {},
        },
      }),
    );

    await runMigrations(9);

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Task deprecated in v2');
    expect(logContent).toContain('format data now lives in cached_songs');
  });

  it('is a no-op when no music-cache blob exists', async () => {
    sqliteStorage.removeItem('substreamer-music-cache');
    await runMigrations(9);

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Task deprecated in v2');
  });
});

describe('Task 11 – Migrate legacy zh locale to zh-Hans', () => {
  function seedLocale(locale: string | null) {
    sqliteStorage.setItem('substreamer-locale', JSON.stringify({
      state: { locale },
    }));
  }

  it('remaps "zh" to "zh-Hans"', async () => {
    seedLocale('zh');
    await runMigrations(10);

    const raw = sqliteStorage.getItem('substreamer-locale') as string;
    expect(JSON.parse(raw).state.locale).toBe('zh-Hans');

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Remapped legacy "zh" locale preference to "zh-Hans"');
  });

  it('leaves non-zh locales unchanged', async () => {
    seedLocale('ru');
    await runMigrations(10);

    const raw = sqliteStorage.getItem('substreamer-locale') as string;
    expect(JSON.parse(raw).state.locale).toBe('ru');

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('no remap needed');
  });

  it('leaves null (device-default) unchanged', async () => {
    seedLocale(null);
    await runMigrations(10);

    const raw = sqliteStorage.getItem('substreamer-locale') as string;
    expect(JSON.parse(raw).state.locale).toBeNull();

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('no remap needed');
  });

  it('skips when no persisted locale exists', async () => {
    sqliteStorage.removeItem('substreamer-locale');
    await runMigrations(10);

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted locale');
  });

  it('skips when persisted locale is unparseable', async () => {
    sqliteStorage.setItem('substreamer-locale', '{bad json');
    await runMigrations(10);

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to parse locale');
  });
});

describe('Task 13 – Move completed scrobbles to per-row SQLite table', () => {
  function seedBlob(scrobbles: any[]) {
    sqliteStorage.setItem(
      'substreamer-completed-scrobbles',
      JSON.stringify({ state: { completedScrobbles: scrobbles } }),
    );
  }

  it('skips when no persisted blob exists', async () => {
    sqliteStorage.removeItem('substreamer-completed-scrobbles');
    await runMigrations(12);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted scrobble blob');
    expect(mockReplaceAllScrobbles).not.toHaveBeenCalled();
  });

  it('removes corrupt blob and skips', async () => {
    sqliteStorage.setItem('substreamer-completed-scrobbles', '{bad json');
    await runMigrations(12);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to parse scrobble blob');
    expect(sqliteStorage.getItem('substreamer-completed-scrobbles')).toBeNull();
    expect(mockReplaceAllScrobbles).not.toHaveBeenCalled();
  });

  it('removes blob and skips when scrobble array is empty', async () => {
    seedBlob([]);
    await runMigrations(12);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Scrobble blob was empty');
    expect(sqliteStorage.getItem('substreamer-completed-scrobbles')).toBeNull();
    expect(mockReplaceAllScrobbles).not.toHaveBeenCalled();
  });

  it('removes blob and skips when scrobble field is missing/non-array', async () => {
    sqliteStorage.setItem(
      'substreamer-completed-scrobbles',
      JSON.stringify({ state: { completedScrobbles: 'not-an-array' } }),
    );
    await runMigrations(12);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Scrobble blob was empty');
    expect(sqliteStorage.getItem('substreamer-completed-scrobbles')).toBeNull();
    expect(mockReplaceAllScrobbles).not.toHaveBeenCalled();
  });

  it('migrates valid scrobbles into the table and deletes the blob', async () => {
    const scrobbles = [
      { id: 'a', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 }, time: 1 },
      { id: 'b', song: { id: 's2', title: 'B', artist: 'Art', duration: 200 }, time: 2 },
    ];
    seedBlob(scrobbles);

    await runMigrations(12);

    expect(mockReplaceAllScrobbles).toHaveBeenCalledTimes(1);
    const [passed] = mockReplaceAllScrobbles.mock.calls[0];
    expect(passed).toHaveLength(2);
    expect(passed.map((s: any) => s.id)).toEqual(['a', 'b']);
    expect(sqliteStorage.getItem('substreamer-completed-scrobbles')).toBeNull();

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Migrated 2 scrobble(s) to per-row table');
    expect(logContent).not.toContain('dropped');
  });

  it('drops invalid records and duplicates before migrating', async () => {
    const scrobbles = [
      { id: 'ok', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 }, time: 1 },
      { id: 'ok', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 }, time: 2 }, // dup
      { id: '', song: { id: 's2', title: 'x' }, time: 3 }, // missing id
      { id: 'bad-song', song: { id: '', title: 'x' }, time: 4 }, // missing song.id
      { id: 'no-title', song: { id: 's3', title: '' }, time: 5 }, // missing title
      { id: 'null-song', song: null, time: 6 }, // null song
      null, // bad entry
      { id: 'keep', song: { id: 's9', title: 'Z', artist: 'Art' }, time: 7 },
    ];
    seedBlob(scrobbles);

    await runMigrations(12);

    expect(mockReplaceAllScrobbles).toHaveBeenCalledTimes(1);
    const [passed] = mockReplaceAllScrobbles.mock.calls[0];
    expect(passed.map((s: any) => s.id).sort()).toEqual(['keep', 'ok']);

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Migrated 2 scrobble(s) to per-row table');
    expect(logContent).toContain('dropped 6 invalid/duplicate');
  });

  it('is idempotent — second run is a no-op once the blob is gone', async () => {
    seedBlob([{ id: 'a', song: { id: 's1', title: 'A', artist: 'Art', duration: 100 }, time: 1 }]);

    await runMigrations(12);
    expect(mockReplaceAllScrobbles).toHaveBeenCalledTimes(1);
    expect(sqliteStorage.getItem('substreamer-completed-scrobbles')).toBeNull();

    mockReplaceAllScrobbles.mockClear();
    await runMigrations(12);
    expect(mockReplaceAllScrobbles).not.toHaveBeenCalled();
  });
});

describe('Task 14 – Move music cache to per-row SQLite tables and album-rooted directory layout', () => {
  function seedBlob(state: any) {
    sqliteStorage.setItem(
      'substreamer-music-cache',
      JSON.stringify({ state }),
    );
  }

  it('skips when no persisted blob exists', async () => {
    sqliteStorage.removeItem('substreamer-music-cache');
    await runMigrations(13);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('No persisted music-cache blob');
    expect(mockBulkReplace).not.toHaveBeenCalled();
  });

  it('removes corrupt blob and skips', async () => {
    sqliteStorage.setItem('substreamer-music-cache', '{bad json');
    await runMigrations(13);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Failed to parse music-cache blob — removed.');
    expect(sqliteStorage.getItem('substreamer-music-cache')).toBeNull();
    expect(mockBulkReplace).not.toHaveBeenCalled();
  });

  it('removes blob and skips when state is missing', async () => {
    sqliteStorage.setItem(
      'substreamer-music-cache',
      JSON.stringify({ state: null }),
    );
    await runMigrations(13);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Music-cache blob had no state — removed.');
    expect(sqliteStorage.getItem('substreamer-music-cache')).toBeNull();
    expect(mockBulkReplace).not.toHaveBeenCalled();
  });

  it('migrates an album-only cache into v2 rows + settings; RETAINS the v1 blob for diagnostic purposes', async () => {
    seedBlob({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'First Album',
          artist: 'Artist A',
          coverArtId: 'cover-1',
          downloadedAt: 1000,
          tracks: [
            { id: 't1', title: 'Track 1', artist: 'Artist A', fileName: 't1.mp3', bytes: 100, duration: 180 },
            { id: 't2', title: 'Track 2', artist: 'Artist A', fileName: 't2.mp3', bytes: 200, duration: 200 },
          ],
        },
      },
      downloadQueue: [],
      maxConcurrentDownloads: 3,
    });

    await runMigrations(13);

    expect(mockBulkReplace).toHaveBeenCalledTimes(1);
    const payload = mockBulkReplace.mock.calls[0][0];
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      itemId: 'album-1',
      type: 'album',
      name: 'First Album',
      artist: 'Artist A',
      coverArtId: 'cover-1',
      expectedSongCount: 2,
      downloadedAt: 1000,
      lastSyncAt: 1000,
    });
    expect(payload.songs).toHaveLength(2);
    expect(payload.songs.map((s: any) => s.id).sort()).toEqual(['t1', 't2']);
    // All songs in an album item take that album's id.
    expect(payload.songs.every((s: any) => s.albumId === 'album-1')).toBe(true);
    expect(payload.edges).toHaveLength(2);
    expect(payload.edges.find((e: any) => e.songId === 't1')).toMatchObject({
      itemId: 'album-1',
      position: 1,
    });
    expect(payload.edges.find((e: any) => e.songId === 't2')).toMatchObject({
      itemId: 'album-1',
      position: 2,
    });

    // Settings blob picks up maxConcurrentDownloads.
    const settings = sqliteStorage.getItem('substreamer-music-cache-settings');
    expect(settings).not.toBeNull();
    expect(JSON.parse(settings as string)).toEqual({ maxConcurrentDownloads: 3 });

    // Task 14 retains the v1 blob: the cleanup call is currently commented
    // out so we can re-test migration end-to-end on the same device. Will
    // be uncommented before beta.
    expect(sqliteStorage.getItem('substreamer-music-cache')).not.toBeNull();

    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Migrated 1 item(s), 2 song(s), 2 edge(s), 0 queue item(s)');
    expect(logContent).toContain('v1 blob retained');
  });

  it('resolves album_id for playlist tracks via v1 album items; falls back to _unknown otherwise', async () => {
    seedBlob({
      cachedItems: {
        'album-X': {
          itemId: 'album-X',
          type: 'album',
          name: 'Album X',
          downloadedAt: 2000,
          tracks: [
            { id: 't-x1', title: 'X1', fileName: 'x1.mp3', bytes: 10, duration: 60 },
            { id: 't-x2', title: 'X2', fileName: 'x2.mp3', bytes: 10, duration: 60 },
          ],
        },
        'playlist-Y': {
          itemId: 'playlist-Y',
          type: 'playlist',
          name: 'Playlist Y',
          downloadedAt: 3000,
          tracks: [
            { id: 't-x1', title: 'X1', fileName: 'x1.mp3', bytes: 10, duration: 60 },
            { id: 't-orphan', title: 'Orphan', fileName: 'orphan.mp3', bytes: 10, duration: 60 },
          ],
        },
      },
      downloadQueue: [],
    });

    await runMigrations(13);

    expect(mockBulkReplace).toHaveBeenCalledTimes(1);
    const { songs } = mockBulkReplace.mock.calls[0][0];
    const byId = new Map(songs.map((s: any) => [s.id, s]));
    expect((byId.get('t-x1') as any).albumId).toBe('album-X');
    expect((byId.get('t-x2') as any).albumId).toBe('album-X');
    expect((byId.get('t-orphan') as any).albumId).toBe('_unknown');
  });

  it('resolves album_id for a playlist track via the persisted substreamer-playlist-details blob', async () => {
    // Playlist blob carries full Child entries (each with albumId). This
    // covers tracks from playlist downloads whose parent album was never
    // cached as its own item.
    sqliteStorage.setItem(
      'substreamer-playlist-details',
      JSON.stringify({
        state: {
          playlists: {
            'playlist-P': {
              playlist: {
                id: 'playlist-P',
                entry: [{ id: 't-detail', title: 'Detail Track', albumId: 'detail-album-Z' }],
              },
            },
          },
        },
      }),
    );
    seedBlob({
      cachedItems: {
        'playlist-P': {
          itemId: 'playlist-P',
          type: 'playlist',
          name: 'Playlist P',
          downloadedAt: 4000,
          tracks: [
            { id: 't-detail', title: 'Detail Track', fileName: 'd.flac', bytes: 1, duration: 1 },
          ],
        },
      },
      downloadQueue: [],
    });

    await runMigrations(13);

    const { songs } = mockBulkReplace.mock.calls[0][0];
    expect(songs).toHaveLength(1);
    expect(songs[0].albumId).toBe('detail-album-Z');
    // suffix derived from fileName extension
    expect(songs[0].suffix).toBe('flac');
  });

  it('resolves album_id for a starred song via the persisted substreamer-favorites blob', async () => {
    // Favorites blob carries full Child entries (each with albumId). This
    // covers __starred__ virtual-playlist tracks whose parent album
    // wasn't cached as its own item.
    sqliteStorage.setItem(
      'substreamer-favorites',
      JSON.stringify({
        state: {
          songs: [{ id: 't-fav', title: 'Starred Track', albumId: 'fav-album-Y' }],
        },
      }),
    );
    seedBlob({
      cachedItems: {
        __starred__: {
          itemId: '__starred__',
          type: 'playlist',
          name: 'Favorite Songs',
          downloadedAt: 5000,
          tracks: [
            { id: 't-fav', title: 'Starred Track', fileName: 'fav.mp3', bytes: 1, duration: 1 },
          ],
        },
      },
      downloadQueue: [],
    });

    await runMigrations(13);

    const { songs } = mockBulkReplace.mock.calls[0][0];
    expect(songs).toHaveLength(1);
    expect(songs[0].albumId).toBe('fav-album-Y');
  });

  it('maps __starred__ virtual playlist to type=favorites', async () => {
    seedBlob({
      cachedItems: {
        __starred__: {
          itemId: '__starred__',
          type: 'playlist',
          name: 'Favorite Songs',
          downloadedAt: 5000,
          tracks: [
            { id: 't-star', title: 'Starred', fileName: 's.mp3', bytes: 1, duration: 1 },
          ],
        },
      },
      downloadQueue: [],
    });

    await runMigrations(13);

    const { items } = mockBulkReplace.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemId: '__starred__', type: 'favorites' });
  });

  it('deduplicates songs across items — one song row, two edges', async () => {
    seedBlob({
      cachedItems: {
        'album-A': {
          itemId: 'album-A',
          type: 'album',
          name: 'A',
          downloadedAt: 1000,
          tracks: [
            { id: 'shared', title: 'Shared', fileName: 'shared.mp3', bytes: 42, duration: 100 },
          ],
        },
        'playlist-B': {
          itemId: 'playlist-B',
          type: 'playlist',
          name: 'B',
          downloadedAt: 2000,
          tracks: [
            { id: 'shared', title: 'Shared', fileName: 'shared.mp3', bytes: 42, duration: 100 },
          ],
        },
      },
      downloadQueue: [],
    });

    await runMigrations(13);

    const { songs, edges } = mockBulkReplace.mock.calls[0][0];
    expect(songs).toHaveLength(1);
    expect(songs[0].id).toBe('shared');
    expect(edges).toHaveLength(2);
    expect(edges.map((e: any) => e.itemId).sort()).toEqual(['album-A', 'playlist-B']);
  });

  it('merges downloadedFormats into song rows', async () => {
    seedBlob({
      cachedItems: {
        'album-A': {
          itemId: 'album-A',
          type: 'album',
          name: 'A',
          downloadedAt: 1000,
          tracks: [
            { id: 'track-1', title: 'T1', fileName: 'track-1.flac', bytes: 500, duration: 200 },
          ],
        },
      },
      downloadedFormats: {
        'track-1': {
          suffix: 'flac',
          bitRate: 1411,
          bitDepth: 16,
          samplingRate: 44100,
          capturedAt: 123,
        },
      },
      downloadQueue: [],
    });

    await runMigrations(13);

    const { songs } = mockBulkReplace.mock.calls[0][0];
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: 'track-1',
      bitRate: 1411,
      bitDepth: 16,
      samplingRate: 44100,
      formatCapturedAt: 123,
    });
  });

  it('migrates the download queue; any in-flight status resets to queued', async () => {
    seedBlob({
      cachedItems: {},
      downloadQueue: [
        {
          queueId: 'q1',
          itemId: 'album-1',
          type: 'album',
          name: 'Album One',
          artist: 'Artist',
          coverArtId: 'c1',
          status: 'downloading',
          totalTracks: 3,
          completedTracks: 1,
          addedAt: 9000,
          tracks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        },
      ],
    });

    await runMigrations(13);

    const { queue } = mockBulkReplace.mock.calls[0][0];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      queueId: 'q1',
      itemId: 'album-1',
      type: 'album',
      name: 'Album One',
      artist: 'Artist',
      coverArtId: 'c1',
      status: 'queued',
      totalSongs: 3,
      completedSongs: 1,
      addedAt: 9000,
      queuePosition: 1,
    });
    expect(JSON.parse(queue[0].songsJson)).toEqual([
      { id: 't1' },
      { id: 't2' },
      { id: 't3' },
    ]);
  });

  it('handles __starred__ in the queue as type=favorites and preserves non-downloading statuses', async () => {
    seedBlob({
      cachedItems: {},
      downloadQueue: [
        {
          queueId: 'q-fav',
          itemId: '__starred__',
          type: 'playlist',
          name: 'Favorite Songs',
          status: 'error',
          error: 'boom',
          totalTracks: 2,
          completedTracks: 0,
          addedAt: 1000,
          tracks: [],
        },
      ],
    });

    await runMigrations(13);

    const { queue } = mockBulkReplace.mock.calls[0][0];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      queueId: 'q-fav',
      type: 'favorites',
      status: 'error',
      error: 'boom',
    });
  });

  it('ignores unknown maxConcurrentDownloads values', async () => {
    seedBlob({
      cachedItems: {},
      downloadQueue: [],
      maxConcurrentDownloads: 99,
    });
    await runMigrations(13);
    expect(sqliteStorage.getItem('substreamer-music-cache-settings')).toBeNull();
  });

  it('persists maxConcurrentDownloads = 5 into the settings blob', async () => {
    seedBlob({
      cachedItems: {},
      downloadQueue: [],
      maxConcurrentDownloads: 5,
    });
    await runMigrations(13);
    const settings = sqliteStorage.getItem('substreamer-music-cache-settings');
    expect(JSON.parse(settings as string)).toEqual({ maxConcurrentDownloads: 5 });
  });

  it('second runMigrations(13) with the retained blob re-runs idempotently', async () => {
    seedBlob({
      cachedItems: {
        'album-1': {
          itemId: 'album-1',
          type: 'album',
          name: 'A',
          downloadedAt: 1000,
          tracks: [{ id: 't1', title: 'T', fileName: 't1.mp3', bytes: 1, duration: 1 }],
        },
      },
      downloadQueue: [],
    });

    await runMigrations(13);
    expect(mockBulkReplace).toHaveBeenCalledTimes(1);
    // Blob is RETAINED (cleanup call is commented out pending beta).
    expect(sqliteStorage.getItem('substreamer-music-cache')).not.toBeNull();

    mockBulkReplace.mockClear();
    mockFileWrite.mockClear();
    // Second runMigrations(13): Task 14 re-runs (blob still present) and
    // bulkReplace is invoked again with identical input. UPSERT makes this
    // a safe idempotent no-op at the SQL level.
    await runMigrations(13);
    expect(mockBulkReplace).toHaveBeenCalledTimes(1);
  });

  describe('filesystem migration', () => {
    // v2 layout = {music-cache}/{albumId}/{songId}.{ext}. v1 albums already
    // used this layout so they're no-ops; v1 playlists/starred used the same
    // shape with playlistId as the parent dir and need moves into albumId.

    it('album-cached files stay in place — zero moves, zero stale-dir sweeps', async () => {
      seedBlob({
        cachedItems: {
          'album-A': {
            itemId: 'album-A',
            type: 'album',
            name: 'A',
            downloadedAt: 1000,
            tracks: [
              { id: 's1', title: 'S1', fileName: 's1.mp3', bytes: 1, duration: 1 },
              { id: 's2', title: 'S2', fileName: 's2.mp3', bytes: 1, duration: 1 },
            ],
          },
        },
        downloadQueue: [],
      });

      const cacheRoot = 'document/music-cache';
      mockDirExistsForUri = (uri) =>
        uri === cacheRoot || uri === `${cacheRoot}/album-A`;
      // v1 album files ARE at the v2 target path (same layout).
      mockFileExistsForUri = (uri) =>
        uri === `${cacheRoot}/album-A/s1.mp3` ||
        uri === `${cacheRoot}/album-A/s2.mp3`;
      mockListDirectoryAsync.mockImplementation(async (uri: string) => {
        if (uri === cacheRoot) return ['album-A'];
        if (uri === `${cacheRoot}/album-A`) return ['s1.mp3', 's2.mp3'];
        return [];
      });

      await runMigrations(13);

      expect(mockBulkReplace).toHaveBeenCalledTimes(1);
      // Album files already at target path — no moves.
      expect(mockFileMove).not.toHaveBeenCalled();
      // album-A is a valid album_id, so the top-level sweep doesn't delete it.
      expect(mockDirDelete).not.toHaveBeenCalled();

      const logContent = mockFileWrite.mock.calls[0][0] as string;
      expect(logContent).toContain(
        'Filesystem migration: 2 in-place, 0 moved, 0 duplicate(s) deleted, 0 missing, 0 stale dir(s) swept.',
      );
    });

    it('playlist-cached song moves into its parent album dir', async () => {
      // Playlist P contains song s1 with albumId album-A. v1 had the file
      // at {music-cache}/P/s1.mp3; v2 wants it at {music-cache}/album-A/s1.mp3.
      sqliteStorage.setItem(
        'substreamer-playlist-details',
        JSON.stringify({
          state: {
            playlists: {
              P: { playlist: { id: 'P', entry: [{ id: 's1', albumId: 'album-A' }] } },
            },
          },
        }),
      );
      seedBlob({
        cachedItems: {
          P: {
            itemId: 'P',
            type: 'playlist',
            name: 'Playlist P',
            downloadedAt: 1000,
            tracks: [
              { id: 's1', title: 'S1', fileName: 's1.mp3', bytes: 1, duration: 1 },
            ],
          },
        },
        downloadQueue: [],
      });

      const cacheRoot = 'document/music-cache';
      const createdDirs = new Set<string>();
      mockDirExistsForUri = (uri) =>
        uri === cacheRoot || uri === `${cacheRoot}/P` || createdDirs.has(uri);
      mockDirCreate.mockImplementation((uri: string) => { createdDirs.add(uri); });

      const movedTargets = new Set<string>();
      mockFileMove.mockImplementation((_src: string, target: string) => {
        movedTargets.add(target);
      });
      mockFileExistsForUri = (uri) => {
        if (movedTargets.has(uri)) return true;
        // Source lives under v1 playlist dir.
        return uri === `${cacheRoot}/P/s1.mp3`;
      };
      mockListDirectoryAsync.mockImplementation(async (uri: string) => {
        if (uri === cacheRoot) return ['P'];
        if (uri === `${cacheRoot}/P`) return ['s1.mp3'];
        return [];
      });

      await runMigrations(13);

      expect(mockFileMove).toHaveBeenCalledTimes(1);
      const [[src, dst]] = mockFileMove.mock.calls;
      expect(src).toBe(`${cacheRoot}/P/s1.mp3`);
      expect(dst).toBe(`${cacheRoot}/album-A/s1.mp3`);
      // The playlist directory P is not a valid album_id — swept.
      expect(mockDirDelete).toHaveBeenCalled();

      const logContent = mockFileWrite.mock.calls[0][0] as string;
      expect(logContent).toContain(
        'Filesystem migration: 0 in-place, 1 moved, 0 duplicate(s) deleted, 0 missing, 1 stale dir(s) swept.',
      );
    });

    it('duplicates across album + playlist collapse to the album copy', async () => {
      // Album A already has s1.mp3. A playlist P also has a copy of s1.mp3.
      // Expected: no move, the playlist copy is deleted, dir P swept.
      seedBlob({
        cachedItems: {
          'album-A': {
            itemId: 'album-A',
            type: 'album',
            name: 'A',
            downloadedAt: 1000,
            tracks: [
              { id: 's1', title: 'S1', fileName: 's1.mp3', bytes: 1, duration: 1 },
            ],
          },
          P: {
            itemId: 'P',
            type: 'playlist',
            name: 'P',
            downloadedAt: 1000,
            tracks: [
              { id: 's1', title: 'S1', fileName: 's1.mp3', bytes: 1, duration: 1 },
            ],
          },
        },
        downloadQueue: [],
      });

      const cacheRoot = 'document/music-cache';
      mockDirExistsForUri = (uri) =>
        uri === cacheRoot ||
        uri === `${cacheRoot}/album-A` ||
        uri === `${cacheRoot}/P`;
      mockFileExistsForUri = (uri) =>
        uri === `${cacheRoot}/album-A/s1.mp3` ||
        uri === `${cacheRoot}/P/s1.mp3`;
      mockListDirectoryAsync.mockImplementation(async (uri: string) => {
        if (uri === cacheRoot) return ['album-A', 'P'];
        if (uri === `${cacheRoot}/album-A`) return ['s1.mp3'];
        if (uri === `${cacheRoot}/P`) return ['s1.mp3'];
        return [];
      });

      await runMigrations(13);

      // No moves — the album copy is already at target.
      expect(mockFileMove).not.toHaveBeenCalled();
      // The playlist duplicate gets deleted.
      expect(mockFileDelete).toHaveBeenCalled();

      const logContent = mockFileWrite.mock.calls[0][0] as string;
      expect(logContent).toContain(
        'Filesystem migration: 1 in-place, 0 moved, 1 duplicate(s) deleted, 0 missing, 1 stale dir(s) swept.',
      );
    });

    it('skips songs whose target file already exists (idempotent re-run)', async () => {
      seedBlob({
        cachedItems: {
          'album-A': {
            itemId: 'album-A',
            type: 'album',
            name: 'A',
            downloadedAt: 1000,
            tracks: [
              { id: 's1', title: 'S1', fileName: 's1.mp3', bytes: 1, duration: 1 },
            ],
          },
        },
        downloadQueue: [],
      });

      const cacheRoot = 'document/music-cache';
      mockDirExistsForUri = (uri) =>
        uri === cacheRoot || uri === `${cacheRoot}/album-A`;
      mockFileExistsForUri = (uri) =>
        uri === `${cacheRoot}/album-A/s1.mp3`;
      mockListDirectoryAsync.mockImplementation(async (uri: string) => {
        if (uri === cacheRoot) return ['album-A'];
        if (uri === `${cacheRoot}/album-A`) return ['s1.mp3'];
        return [];
      });

      await runMigrations(13);

      expect(mockFileMove).not.toHaveBeenCalled();
      const logContent = mockFileWrite.mock.calls[0][0] as string;
      expect(logContent).toContain('1 in-place, 0 moved');
    });

    it('counts songs whose source file is missing without throwing', async () => {
      seedBlob({
        cachedItems: {
          'album-A': {
            itemId: 'album-A',
            type: 'album',
            name: 'A',
            downloadedAt: 1000,
            tracks: [
              { id: 's1', title: 'S1', fileName: 's1.mp3', bytes: 1, duration: 1 },
            ],
          },
        },
        downloadQueue: [],
      });

      const cacheRoot = 'document/music-cache';
      mockDirExistsForUri = (uri) =>
        uri === cacheRoot || uri === `${cacheRoot}/album-A`;
      // Neither source nor target exists anywhere.
      mockFileExistsForUri = () => false;
      mockListDirectoryAsync.mockImplementation(async (uri: string) => {
        if (uri === cacheRoot) return ['album-A'];
        return [];
      });

      await expect(runMigrations(13)).resolves.toBeGreaterThanOrEqual(14);

      expect(mockFileMove).not.toHaveBeenCalled();
      const logContent = mockFileWrite.mock.calls[0][0] as string;
      expect(logContent).toContain('0 moved, 0 duplicate(s) deleted, 1 missing');
      expect(mockBulkReplace).toHaveBeenCalledTimes(1);
      // Blob is RETAINED (cleanup call is commented out pending beta).
      expect(sqliteStorage.getItem('substreamer-music-cache')).not.toBeNull();
    });

    it('no filesystem work when the cache directory does not exist', async () => {
      seedBlob({
        cachedItems: {
          'album-A': {
            itemId: 'album-A',
            type: 'album',
            name: 'A',
            downloadedAt: 1000,
            tracks: [
              { id: 's1', title: 'S1', fileName: 's1.mp3', bytes: 1, duration: 1 },
            ],
          },
        },
        downloadQueue: [],
      });

      // cache dir doesn't exist → the whole filesystem branch is skipped.
      mockDirExistsForUri = () => false;

      await runMigrations(13);

      expect(mockFileMove).not.toHaveBeenCalled();
      expect(mockListDirectoryAsync).not.toHaveBeenCalled();
      // SQL side of the migration still ran.
      expect(mockBulkReplace).toHaveBeenCalledTimes(1);
      // Blob is RETAINED (cleanup call is commented out pending beta).
      expect(sqliteStorage.getItem('substreamer-music-cache')).not.toBeNull();
      const logContent = mockFileWrite.mock.calls[0][0] as string;
      // The filesystem-migration log line is absent when the branch is skipped.
      expect(logContent).not.toContain('Filesystem migration:');
    });
  });
});

describe('runMigrations resilience', () => {
  it('breaks loop and persists partial progress when a task throws', async () => {
    // Seed unparseable shares so Task 4 doesn't throw (it catches JSON errors),
    // then force Task 3 to throw via a rebuildAggregates that throws.
    completedScrobbleStore.setState({
      completedScrobbles: [
        { id: '1', song: { id: 's1', title: 'Song', artist: 'A', duration: 200 }, time: Date.now() },
      ],
      rebuildAggregates: () => {
        throw new Error('simulated task failure');
      },
    } as any);
    const finalVersion = await runMigrations(2);
    // Task 3 threw → final version should stay at 2 (last successful).
    expect(finalVersion).toBe(2);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('FAILED: simulated task failure');
    // Should not have progressed to subsequent tasks.
    expect(logContent).not.toContain('Task 4:');
  });

  it('does not throw when log file write fails', async () => {
    mockFileWrite.mockImplementationOnce(() => {
      throw new Error('EROFS: read-only filesystem');
    });
    await expect(runMigrations(0)).resolves.toBeGreaterThanOrEqual(2);
  });
});
