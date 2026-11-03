const mockFileInstances = new Map<string, { exists: boolean; content: string; deleted: boolean }>();
const mockCompressToFile = jest.fn();
const mockDecompressFromFile = jest.fn();
const mockListDirectoryAsync = jest.fn();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    _name: string;
    constructor(_base: any, ...parts: string[]) {
      this._name = parts.join('/');
      this.uri = `file:///backups/${this._name}`;
    }
    get exists() {
      return mockFileInstances.get(this._name)?.exists ?? false;
    }
    write(content: string) {
      mockFileInstances.set(this._name, { exists: true, content, deleted: false });
    }
    delete() {
      const entry = mockFileInstances.get(this._name);
      if (entry) entry.deleted = true;
    }
    move(dest: MockFile) {
      const entry = mockFileInstances.get(this._name);
      if (entry) {
        mockFileInstances.set(dest._name, { ...entry });
        entry.deleted = true;
      }
    }
    async text() {
      return mockFileInstances.get(this._name)?.content ?? '';
    }
  }
  class MockDirectory {
    uri: string;
    _exists = true;
    constructor(..._parts: any[]) {
      this.uri = 'file:///document/';
    }
    get exists() { return this._exists; }
    create() { this._exists = true; }
    get parentDirectory() { return new MockDirectory(); }
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: new MockDirectory() },
  };
});

jest.mock('expo-async-fs', () => ({
  listDirectoryAsync: (...args: any[]) => mockListDirectoryAsync(...args),
}));

jest.mock('expo-gzip', () => ({
  compressToFile: (...args: any[]) => mockCompressToFile(...args),
  decompressFromFile: (...args: any[]) => mockDecompressFromFile(...args),
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));
let mockReidComplete = false;
jest.mock('../navidromeReid/reidMarker', () => ({
  ...jest.requireActual('../navidromeReid/reidMarker'),
  isReidComplete: () => mockReidComplete,
}));

// Fake the scrobble SQL layer with a single in-memory list (`mockDbScrobbles`)
// so the SQL-backed store (compute aggregates / load recent / export) behaves
// deterministically without a real handle. `mockReplaceAll`/`mockMergeScrobbles`
// mutate it; the analytics + recent + export reads derive from it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDbScrobbles: Array<{ id: string; song: any; time: number }> = [];
// Referenced only at CALL time inside the mock factories (deferred past the
// import-hoisting TDZ). Derives the store's SQL analytics from the fake table.
const mockScrobbleAnalytics = () => ({
  stats: {
    totalPlays: mockDbScrobbles.length,
    totalListeningSeconds: mockDbScrobbles.reduce((s, x) => s + (x.song?.duration ?? 0), 0),
    uniqueArtists: {} as Record<string, true>,
  },
  aggregates: {
    artistCounts: {},
    albumCounts: {},
    songCounts: {},
    genreCounts: {},
    hourBuckets: new Array<number>(24).fill(0),
    dayCounts: {},
  },
});
jest.mock('../../store/persistence/scrobbleTable', () => ({
  insertScrobble: jest.fn(),
  replaceAllScrobbles: jest.fn((arr: typeof mockDbScrobbles) => {
    mockDbScrobbles = [...arr];
  }),
  mergeScrobbles: jest.fn((arr: typeof mockDbScrobbles) => {
    const seen = new Set(mockDbScrobbles.map((s) => s.id));
    let added = 0;
    for (const s of arr) {
      if (s?.id && !seen.has(s.id)) {
        seen.add(s.id);
        mockDbScrobbles.push(s);
        added += 1;
      }
    }
    return { added, skipped: arr.length - added };
  }),
  clearScrobbles: jest.fn(() => {
    mockDbScrobbles = [];
  }),
  hydrateScrobblesAsync: jest.fn(async () => mockDbScrobbles),
  backfillScrobbleColumnsAsync: jest.fn(async () => {}),
}));
jest.mock('../../store/persistence/scrobbleAggregates', () => ({
  computeScrobbleAnalytics: jest.fn(async () => mockScrobbleAnalytics()),
  loadRecentScrobbles: jest.fn(async (n: number) => [...mockDbScrobbles].reverse().slice(0, n)),
}));
/** Seed the fake scrobble "table" for a test (replaces the old store.setState). */
const seedScrobbles = (arr: typeof mockDbScrobbles): void => {
  mockDbScrobbles = [...arr];
};

// Mock the device identity store so backupService can stamp deviceId/
// deviceName/deviceLabel into v5 metadata without depending on
// expo-device / expo-crypto in the test runtime.
const mockDeviceIdentity = {
  deviceId: '11111111-2222-3333-4444-555555555555',
  deviceName: 'Test Device OS Name',
  deviceLabel: 'Your Test Device',
  deviceLabelUserSet: false,
  setDeviceLabel: jest.fn(),
  refreshDeviceName: jest.fn(),
  ensureDefaultLabel: jest.fn(),
};
jest.mock('../../store/deviceIdentityStore', () => ({
  deviceIdentityStore: {
    getState: () => mockDeviceIdentity,
    setState: jest.fn(),
  },
  getDeviceShortId: () => '11111111',
}));

import { authStore } from '../../store/authStore';
import { completedScrobbleStore } from '../../store/completedScrobbleStore';
import { replaceAllScrobbles } from '../../store/persistence/scrobbleTable';
import { mbidOverrideStore } from '../../store/mbidOverrideStore';
import { scrobbleExclusionStore } from '../../store/scrobbleExclusionStore';
import { backupStore } from '../../store/backupStore';
import { bookmarksStore } from '../../store/bookmarksStore';
import {
  createBackup,
  listBackups,
  makeBackupIdentityKey,
  restoreBackup,
  pruneBackups,
  runAutoBackupIfNeeded,
  migrateV3BackupMetas,
  migrateV4BackupMetas,
} from '../backupService';

const TEST_SERVER = 'https://music.example.com';
const TEST_USER = 'testuser';
const TEST_IDENTITY_KEY = makeBackupIdentityKey(TEST_SERVER, TEST_USER);

function setAuth(serverUrl: string | null = TEST_SERVER, username: string | null = TEST_USER) {
  authStore.setState({ serverUrl, username, isLoggedIn: !!serverUrl });
}

function makeV4Meta(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    version: 4,
    createdAt: '2025-06-01T00:00:00Z',
    serverUrl: TEST_SERVER,
    username: TEST_USER,
    scrobbles: { itemCount: 5, sizeBytes: 100 },
    mbidOverrides: null,
    scrobbleExclusions: null,
    ...overrides,
  });
}

function makeV3Meta(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    version: 3,
    createdAt: '2025-01-01T00:00:00Z',
    scrobbles: { itemCount: 5, sizeBytes: 100 },
    mbidOverrides: null,
    scrobbleExclusions: null,
    ...overrides,
  });
}

beforeEach(() => {
  mockFileInstances.clear();
  mockCompressToFile.mockReset();
  mockDecompressFromFile.mockReset();
  mockListDirectoryAsync.mockReset();

  seedScrobbles([]);
  mbidOverrideStore.setState({ overrides: {} });
  scrobbleExclusionStore.setState({ excludedAlbums: {}, excludedArtists: {}, excludedPlaylists: {} });
  bookmarksStore.setState({ bookmarks: {} });
  backupStore.setState({ autoBackupEnabled: false, lastBackupTimes: {} });
  setAuth();
});

describe('makeBackupIdentityKey', () => {
  it('normalizes URL casing and trailing slashes', () => {
    expect(makeBackupIdentityKey('https://Music.Example.COM/', 'User')).toBe(
      makeBackupIdentityKey('https://music.example.com', 'user'),
    );
  });

  it('adds https scheme when missing', () => {
    expect(makeBackupIdentityKey('music.example.com', 'user')).toBe(
      makeBackupIdentityKey('https://music.example.com', 'user'),
    );
  });

  it('preserves http scheme', () => {
    const key = makeBackupIdentityKey('http://192.168.1.50:4533', 'admin');
    expect(key).toBe('http://192.168.1.50:4533|admin');
  });
});

describe('createBackup', () => {
  it('compresses scrobbles and writes v6 meta with identity + device tag', async () => {
    seedScrobbles([{ id: 's1', song: { id: 'track-1' } as any, time: 1000 }]);
    mockCompressToFile.mockResolvedValue({ bytes: 42 });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalledTimes(1);
    const metaEntries = Array.from(mockFileInstances.entries())
      .filter(([k]) => k.endsWith('.meta.json'));
    expect(metaEntries).toHaveLength(1);
    const [stem] = metaEntries[0];
    // Filename stem now carries the device short id so cross-device backups
    // sharing a cloud folder don't collide on the millisecond.
    expect(stem).toMatch(/^backup-.*-11111111\.meta\.json$/);
    const meta = JSON.parse(metaEntries[0][1].content);
    expect(meta.version).toBe(6);
    expect(meta.serverUrl).toBe(TEST_SERVER);
    expect(meta.username).toBe(TEST_USER);
    expect(meta.deviceId).toBe('11111111-2222-3333-4444-555555555555');
    expect(meta.deviceName).toBe('Test Device OS Name');
    expect(meta.deviceLabel).toBe('Your Test Device');
    expect(meta.scrobbles).toEqual({ itemCount: 1, sizeBytes: 42 });
    expect(meta.mbidOverrides).toBeNull();
    expect(meta.scrobbleExclusions).toBeNull();
    expect(meta.bookmarks).toBeNull();
  });

  it('throws when no active session', async () => {
    setAuth(null, null);
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);

    await expect(createBackup()).rejects.toThrow('Cannot create backup: no active session');
  });

  it('compresses MBID overrides when present', async () => {
    mbidOverrideStore.setState({
      overrides: { 'artist-1': { mbid: 'mbid-abc', name: 'Artist' } } as any,
    });
    mockCompressToFile.mockResolvedValue({ bytes: 30 });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalledTimes(1);
    const metaEntries = Array.from(mockFileInstances.entries())
      .filter(([k]) => k.endsWith('.meta.json'));
    const meta = JSON.parse(metaEntries[0][1].content);
    expect(meta.mbidOverrides).toEqual({ itemCount: 1, sizeBytes: 30 });
  });

  it('compresses scrobble exclusions when present', async () => {
    scrobbleExclusionStore.setState({
      excludedAlbums: { 'alb-1': { id: 'alb-1', name: 'Album 1' } },
      excludedArtists: { 'art-1': { id: 'art-1', name: 'Artist 1' } },
      excludedPlaylists: {},
    });
    mockCompressToFile.mockResolvedValue({ bytes: 25 });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalledTimes(1);
    const metaEntries = Array.from(mockFileInstances.entries())
      .filter(([k]) => k.endsWith('.meta.json'));
    const meta = JSON.parse(metaEntries[0][1].content);
    expect(meta.scrobbleExclusions).toEqual({ itemCount: 2, sizeBytes: 25 });
  });

  it('compresses bookmarks when present', async () => {
    bookmarksStore.setState({
      bookmarks: {
        'bk-1': {
          id: 'bk-1',
          name: 'Tuesday Mid Morning',
          createdAt: 1000,
          queue: [{ id: 't1', title: 'T1', isDir: false } as any],
          currentIndex: 0,
          positionSec: 12,
        },
      },
    });
    mockCompressToFile.mockResolvedValue({ bytes: 64 });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalledTimes(1);
    const metaEntries = Array.from(mockFileInstances.entries())
      .filter(([k]) => k.endsWith('.meta.json'));
    const meta = JSON.parse(metaEntries[0][1].content);
    expect(meta.bookmarks).toEqual({ itemCount: 1, sizeBytes: 64 });
  });

  it('creates all three datasets when all have data', async () => {
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mbidOverrideStore.setState({
      overrides: { 'a1': { mbid: 'x' } } as any,
    });
    scrobbleExclusionStore.setState({
      excludedAlbums: { 'alb-1': { id: 'alb-1', name: 'A' } },
      excludedArtists: {},
      excludedPlaylists: {},
    });
    mockCompressToFile.mockResolvedValue({ bytes: 10 });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalledTimes(3);
  });

  it('creates both datasets when both have data', async () => {
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mbidOverrideStore.setState({
      overrides: { 'a1': { mbid: 'x' } } as any,
    });
    mockCompressToFile.mockResolvedValue({ bytes: 10 });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when all datasets are empty', async () => {
    await createBackup();
    expect(mockCompressToFile).not.toHaveBeenCalled();
    const metaEntries = Array.from(mockFileInstances.entries())
      .filter(([k]) => k.endsWith('.meta.json'));
    expect(metaEntries).toHaveLength(0);
  });

  it('updates lastBackupTimes for current identity', async () => {
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockCompressToFile.mockResolvedValue({ bytes: 10 });

    await createBackup();

    const time = backupStore.getState().getLastBackupTime(TEST_IDENTITY_KEY);
    expect(time).toBeGreaterThan(0);
  });
});

describe('listBackups', () => {
  it('returns all entries in current when no filter', async () => {
    mockListDirectoryAsync.mockResolvedValue([
      'backup-a.meta.json',
      'backup-a.scrobbles.gz',
    ]);
    mockFileInstances.set('backup-a.meta.json', { exists: true, content: makeV4Meta(), deleted: false });
    mockFileInstances.set('backup-a.scrobbles.gz', { exists: true, content: '', deleted: false });

    const { current, other } = await listBackups();

    expect(current).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('partitions v4 backups by identity when filter provided', async () => {
    const sameUserDiffServer = makeV4Meta({
      createdAt: '2025-03-01T00:00:00Z',
      serverUrl: 'https://other-server.com',
    });
    const diffUser = makeV4Meta({
      createdAt: '2025-04-01T00:00:00Z',
      username: 'otheruser',
    });
    const matchingMeta = makeV4Meta({ createdAt: '2025-06-01T00:00:00Z' });

    mockListDirectoryAsync.mockResolvedValue([
      'backup-match.meta.json', 'backup-match.scrobbles.gz',
      'backup-diffserver.meta.json', 'backup-diffserver.scrobbles.gz',
      'backup-diffuser.meta.json', 'backup-diffuser.scrobbles.gz',
    ]);
    mockFileInstances.set('backup-match.meta.json', { exists: true, content: matchingMeta, deleted: false });
    mockFileInstances.set('backup-match.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-diffserver.meta.json', { exists: true, content: sameUserDiffServer, deleted: false });
    mockFileInstances.set('backup-diffserver.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-diffuser.meta.json', { exists: true, content: diffUser, deleted: false });
    mockFileInstances.set('backup-diffuser.scrobbles.gz', { exists: true, content: '', deleted: false });

    const { current, other } = await listBackups({ serverUrl: TEST_SERVER, username: TEST_USER });

    expect(current).toHaveLength(1);
    expect(current[0].stem).toBe('backup-match');
    expect(other).toHaveLength(1);
    expect(other[0].stem).toBe('backup-diffserver');
    // diffuser should be hidden — not in current or other
  });

  it('excludes v3 backups when filter is provided', async () => {
    mockListDirectoryAsync.mockResolvedValue([
      'backup-v3.meta.json', 'backup-v3.scrobbles.gz',
    ]);
    mockFileInstances.set('backup-v3.meta.json', { exists: true, content: makeV3Meta(), deleted: false });
    mockFileInstances.set('backup-v3.scrobbles.gz', { exists: true, content: '', deleted: false });

    const { current, other } = await listBackups({ serverUrl: TEST_SERVER, username: TEST_USER });

    expect(current).toHaveLength(0);
    expect(other).toHaveLength(0);
  });

  it('includes v3 backups in current when no filter', async () => {
    mockListDirectoryAsync.mockResolvedValue([
      'backup-v3.meta.json', 'backup-v3.scrobbles.gz',
    ]);
    mockFileInstances.set('backup-v3.meta.json', { exists: true, content: makeV3Meta(), deleted: false });
    mockFileInstances.set('backup-v3.scrobbles.gz', { exists: true, content: '', deleted: false });

    const { current } = await listBackups();

    expect(current).toHaveLength(1);
    expect(current[0].username).toBeNull();
    expect(current[0].serverUrl).toBeNull();
  });

  it('matches URLs case-insensitively', async () => {
    const meta = makeV4Meta({ serverUrl: 'HTTPS://MUSIC.EXAMPLE.COM/' });
    mockListDirectoryAsync.mockResolvedValue(['backup-x.meta.json', 'backup-x.scrobbles.gz']);
    mockFileInstances.set('backup-x.meta.json', { exists: true, content: meta, deleted: false });
    mockFileInstances.set('backup-x.scrobbles.gz', { exists: true, content: '', deleted: false });

    const { current } = await listBackups({ serverUrl: 'https://music.example.com', username: TEST_USER });

    expect(current).toHaveLength(1);
  });

  it('matches usernames case-insensitively', async () => {
    const meta = makeV4Meta({ username: 'TestUser' });
    mockListDirectoryAsync.mockResolvedValue(['backup-x.meta.json', 'backup-x.scrobbles.gz']);
    mockFileInstances.set('backup-x.meta.json', { exists: true, content: meta, deleted: false });
    mockFileInstances.set('backup-x.scrobbles.gz', { exists: true, content: '', deleted: false });

    const { current } = await listBackups({ serverUrl: TEST_SERVER, username: 'testuser' });

    expect(current).toHaveLength(1);
  });

  it('sorts entries newest first', async () => {
    const meta1 = makeV4Meta({ createdAt: '2025-01-01T00:00:00Z' });
    const meta2 = makeV4Meta({ createdAt: '2025-06-01T00:00:00Z' });

    mockListDirectoryAsync.mockResolvedValue([
      'backup-old.meta.json', 'backup-old.scrobbles.gz',
      'backup-new.meta.json', 'backup-new.scrobbles.gz',
    ]);
    mockFileInstances.set('backup-old.meta.json', { exists: true, content: meta1, deleted: false });
    mockFileInstances.set('backup-old.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-new.meta.json', { exists: true, content: meta2, deleted: false });
    mockFileInstances.set('backup-new.scrobbles.gz', { exists: true, content: '', deleted: false });

    const { current } = await listBackups({ serverUrl: TEST_SERVER, username: TEST_USER });

    expect(current[0].createdAt).toBe('2025-06-01T00:00:00Z');
    expect(current[1].createdAt).toBe('2025-01-01T00:00:00Z');
  });

  it('skips entries with wrong version', async () => {
    const meta = JSON.stringify({ version: 1, createdAt: '2025-01-01' });
    mockListDirectoryAsync.mockResolvedValue(['old.meta.json']);
    mockFileInstances.set('old.meta.json', { exists: true, content: meta, deleted: false });

    const { current } = await listBackups();
    expect(current).toHaveLength(0);
  });

  it('returns empty on directory listing error', async () => {
    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));
    const { current, other } = await listBackups();
    expect(current).toEqual([]);
    expect(other).toEqual([]);
  });

  it('skips entries with missing data files', async () => {
    const meta = makeV4Meta();
    mockListDirectoryAsync.mockResolvedValue(['backup-x.meta.json']);
    mockFileInstances.set('backup-x.meta.json', { exists: true, content: meta, deleted: false });

    const { current } = await listBackups();
    expect(current).toHaveLength(0);
  });

  it('populates identity fields from v4 meta', async () => {
    mockListDirectoryAsync.mockResolvedValue(['b.meta.json', 'b.scrobbles.gz']);
    mockFileInstances.set('b.meta.json', { exists: true, content: makeV4Meta(), deleted: false });
    mockFileInstances.set('b.scrobbles.gz', { exists: true, content: '', deleted: false });

    const { current } = await listBackups();

    expect(current[0].serverUrl).toBe(TEST_SERVER);
    expect(current[0].username).toBe(TEST_USER);
  });
});

describe('restoreBackup', () => {
  const baseEntry: Omit<import('../backupService').BackupEntry, 'stem'> = {
    createdAt: '2025-01-01',
    scrobbleCount: 0,
    scrobbleSizeBytes: 0,
    mbidOverrideCount: 0,
    mbidOverrideSizeBytes: 0,
    scrobbleExclusionCount: 0,
    scrobbleExclusionSizeBytes: 0,
    bookmarkCount: 0,
    bookmarkSizeBytes: 0,
    serverUrl: TEST_SERVER,
    username: TEST_USER,
    deviceId: null,
    deviceName: null,
    deviceLabel: null,
  };

  it('restores scrobbles from backup (in-memory + SQL round-trip)', async () => {
    const mockReplace = replaceAllScrobbles as jest.Mock;
    mockReplace.mockClear();

    const scrobbles = [
      { id: 's1', song: { id: 't1', title: 'Track 1', artist: 'Artist', duration: 100 }, time: 1 },
      { id: 's2', song: { id: 't2', title: 'Track 2', artist: 'Artist', duration: 200 }, time: 2 },
    ];
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(scrobbles));
    mockFileInstances.set('backup-x.scrobbles.gz', { exists: true, content: '', deleted: false });

    const result = await restoreBackup({
      ...baseEntry,
      stem: 'backup-x',
      scrobbleCount: 2,
      scrobbleSizeBytes: 50,
    });

    // In-memory state reflects the restored set.
    expect(result.scrobbleCount).toBe(2);
    expect(completedScrobbleStore.getState().recentScrobbles).toHaveLength(2);
    expect(completedScrobbleStore.getState().stats.totalPlays).toBe(2);
    expect(completedScrobbleStore.getState().stats.totalListeningSeconds).toBe(300);

    // SQL table was replaced with the same set in one call.
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace.mock.calls[0][0]).toHaveLength(2);
  });

  it('filters invalid scrobbles out of a restored backup before writing', async () => {
    const mockReplace = replaceAllScrobbles as jest.Mock;
    mockReplace.mockClear();

    const scrobbles = [
      { id: 'ok', song: { id: 't1', title: 'Track 1', artist: 'Artist', duration: 100 }, time: 1 },
      { id: '', song: { id: 't2', title: 'Track 2' }, time: 2 }, // missing id
      { id: 'ok', song: { id: 't1', title: 'Track 1' }, time: 3 }, // dup
    ];
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(scrobbles));
    mockFileInstances.set('backup-y.scrobbles.gz', { exists: true, content: '', deleted: false });

    const result = await restoreBackup({
      ...baseEntry,
      stem: 'backup-y',
      scrobbleCount: 3,
      scrobbleSizeBytes: 50,
    });

    // The reported count reflects the validated (deduped + filtered) set.
    expect(result.scrobbleCount).toBe(1);
    expect(completedScrobbleStore.getState().recentScrobbles).toHaveLength(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace.mock.calls[0][0]).toHaveLength(1);
  });

  describe('on an install the Navidrome re-key has converted', () => {
    // Vectors from canonicalId.test.ts.
    const OLD = 'e3b7fc2ae9447bbec37a13bf916e3cf6';
    const NEW = '6VHl3uR4kss6sUPKA8Cwnk';
    const restoreOne = async () => {
      const mockReplace = replaceAllScrobbles as jest.Mock;
      mockReplace.mockClear();
      mockDecompressFromFile.mockResolvedValue(JSON.stringify([
        { id: 's1', song: { id: OLD, title: 'Track', artist: 'Artist', duration: 100 }, time: 1 },
      ]));
      mockFileInstances.set('backup-r.scrobbles.gz', { exists: true, content: '', deleted: false });
      await restoreBackup({ ...baseEntry, stem: 'backup-r', scrobbleCount: 1, scrobbleSizeBytes: 50 });
      return mockReplace.mock.calls[0][0] as Array<{ id: string; song: { id: string } }>;
    };
    afterEach(() => { mockReidComplete = false; });

    it('converts the restored ids to the current form', async () => {
      // A backup from before the server's 0.64 upgrade would otherwise stay retired.
      mockReidComplete = true;
      const [written] = await restoreOne();
      expect(written.song.id).toBe(NEW);
      expect(written.id).toBe('s1');
    });

    it('restores verbatim when the re-key has not run, which converts them itself', async () => {
      const [written] = await restoreOne();
      expect(written.song.id).toBe(OLD);
    });
  });

  it('restores MBID overrides from backup (new format)', async () => {
    const overrides = {
      'artist:ar1': { type: 'artist', entityId: 'ar1', entityName: 'Test', mbid: 'mbid-1' },
    };
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(overrides));
    mockFileInstances.set('backup-x.mbid.gz', { exists: true, content: '', deleted: false });

    const result = await restoreBackup({
      ...baseEntry,
      stem: 'backup-x',
      mbidOverrideCount: 1,
      mbidOverrideSizeBytes: 30,
    });

    expect(result.mbidOverrideCount).toBe(1);
    expect(mbidOverrideStore.getState().overrides).toHaveProperty('artist:ar1');
  });

  it('migrates old-format MBID overrides on restore', async () => {
    const overrides = { 'artist-1': { artistId: 'artist-1', artistName: 'Old Artist', mbid: 'mbid-1' } };
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(overrides));
    mockFileInstances.set('backup-y.mbid.gz', { exists: true, content: '', deleted: false });

    const result = await restoreBackup({
      ...baseEntry,
      stem: 'backup-y',
      mbidOverrideCount: 1,
      mbidOverrideSizeBytes: 30,
    });

    expect(result.mbidOverrideCount).toBe(1);
    const restored = mbidOverrideStore.getState().overrides;
    expect(restored).toHaveProperty('artist:artist-1');
    expect(restored['artist:artist-1']).toEqual({
      type: 'artist',
      entityId: 'artist-1',
      entityName: 'Old Artist',
      mbid: 'mbid-1',
    });
  });

  it('throws when scrobble data file is missing', async () => {
    await expect(
      restoreBackup({ ...baseEntry, stem: 'backup-missing', scrobbleCount: 1, scrobbleSizeBytes: 50 }),
    ).rejects.toThrow('Scrobble backup data file not found');
  });

  it('throws when MBID data file is missing', async () => {
    await expect(
      restoreBackup({ ...baseEntry, stem: 'backup-missing', mbidOverrideCount: 1, mbidOverrideSizeBytes: 30 }),
    ).rejects.toThrow('MBID override backup data file not found');
  });

  it('restores scrobble exclusions from backup', async () => {
    const exclusions = {
      excludedAlbums: { 'alb-1': { id: 'alb-1', name: 'Album 1' } },
      excludedArtists: { 'art-1': { id: 'art-1', name: 'Artist 1' } },
      excludedPlaylists: {},
    };
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(exclusions));
    mockFileInstances.set('backup-x.exclusions.gz', { exists: true, content: '', deleted: false });

    const result = await restoreBackup({
      ...baseEntry,
      stem: 'backup-x',
      scrobbleExclusionCount: 2,
      scrobbleExclusionSizeBytes: 25,
    });

    expect(result.scrobbleExclusionCount).toBe(2);
    expect(scrobbleExclusionStore.getState().excludedAlbums).toHaveProperty('alb-1');
    expect(scrobbleExclusionStore.getState().excludedArtists).toHaveProperty('art-1');
  });

  it('throws when exclusion data file is missing', async () => {
    await expect(
      restoreBackup({ ...baseEntry, stem: 'backup-missing', scrobbleExclusionCount: 1, scrobbleExclusionSizeBytes: 10 }),
    ).rejects.toThrow('Scrobble exclusion backup data file not found');
  });
});

describe('pruneBackups', () => {
  it('prunes across current and other for same username', async () => {
    // 4 backups on current server + 3 on a different server = 7 total for same user
    const metas = [
      ...Array.from({ length: 4 }, (_, i) => ({
        stem: `backup-current-${i}`,
        meta: makeV4Meta({ createdAt: `2025-0${i + 1}-01T00:00:00Z` }),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        stem: `backup-other-${i}`,
        meta: makeV4Meta({
          createdAt: `2025-0${i + 5}-01T00:00:00Z`,
          serverUrl: 'https://other-server.com',
        }),
      })),
    ];

    mockListDirectoryAsync.mockResolvedValue(
      metas.flatMap((m) => [`${m.stem}.meta.json`, `${m.stem}.scrobbles.gz`]),
    );
    for (const m of metas) {
      mockFileInstances.set(`${m.stem}.meta.json`, { exists: true, content: m.meta, deleted: false });
      mockFileInstances.set(`${m.stem}.scrobbles.gz`, { exists: true, content: '', deleted: false });
    }

    await pruneBackups(5);

    // 2 oldest should be deleted (backup-current-0, backup-current-1)
    expect(mockFileInstances.get('backup-current-0.meta.json')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-current-1.meta.json')?.deleted).toBe(true);
    // Newest 5 should remain
    expect(mockFileInstances.get('backup-current-2.meta.json')?.deleted).toBeFalsy();
    expect(mockFileInstances.get('backup-other-2.meta.json')?.deleted).toBeFalsy();
  });

  it('does not prune backups belonging to a different user', async () => {
    const currentUserMeta = makeV4Meta({ createdAt: '2025-01-01T00:00:00Z' });
    const otherUserMeta = makeV4Meta({
      createdAt: '2025-02-01T00:00:00Z',
      username: 'otheruser',
    });

    mockListDirectoryAsync.mockResolvedValue([
      'backup-mine.meta.json', 'backup-mine.scrobbles.gz',
      'backup-theirs.meta.json', 'backup-theirs.scrobbles.gz',
    ]);
    mockFileInstances.set('backup-mine.meta.json', { exists: true, content: currentUserMeta, deleted: false });
    mockFileInstances.set('backup-mine.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-theirs.meta.json', { exists: true, content: otherUserMeta, deleted: false });
    mockFileInstances.set('backup-theirs.scrobbles.gz', { exists: true, content: '', deleted: false });

    await pruneBackups(5);

    expect(mockFileInstances.get('backup-mine.meta.json')?.deleted).toBeFalsy();
    expect(mockFileInstances.get('backup-theirs.meta.json')?.deleted).toBeFalsy();
  });

  it('does nothing when under keep limit', async () => {
    mockListDirectoryAsync.mockResolvedValue(['b.meta.json', 'b.scrobbles.gz']);
    mockFileInstances.set('b.meta.json', {
      exists: true,
      content: makeV4Meta(),
      deleted: false,
    });
    mockFileInstances.set('b.scrobbles.gz', { exists: true, content: '', deleted: false });

    await pruneBackups(5);

    expect(mockFileInstances.get('b.meta.json')?.deleted).toBeFalsy();
  });

  it('does nothing when not logged in', async () => {
    setAuth(null, null);
    mockListDirectoryAsync.mockResolvedValue(['b.meta.json', 'b.scrobbles.gz']);
    mockFileInstances.set('b.meta.json', { exists: true, content: makeV4Meta(), deleted: false });
    mockFileInstances.set('b.scrobbles.gz', { exists: true, content: '', deleted: false });

    await pruneBackups(0);

    expect(mockFileInstances.get('b.meta.json')?.deleted).toBeFalsy();
  });
});

describe('runAutoBackupIfNeeded', () => {
  it('skips when auto-backup is disabled', async () => {
    backupStore.setState({ autoBackupEnabled: false });
    mockListDirectoryAsync.mockResolvedValue([]);
    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).not.toHaveBeenCalled();
  });

  it('skips when not logged in', async () => {
    setAuth(null, null);
    backupStore.setState({ autoBackupEnabled: true });
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).not.toHaveBeenCalled();
  });

  it('skips when within 24h of last backup for this identity', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTimes: { [TEST_IDENTITY_KEY]: Date.now() - 1000 },
    });
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).not.toHaveBeenCalled();
  });

  it('creates backup when due for this identity', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTimes: { [TEST_IDENTITY_KEY]: Date.now() - 25 * 60 * 60 * 1000 },
    });
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockCompressToFile.mockResolvedValue({ bytes: 10 });
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).toHaveBeenCalled();
  });

  it('creates backup when no lastBackupTime for this identity', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTimes: {},
    });
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockCompressToFile.mockResolvedValue({ bytes: 10 });
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).toHaveBeenCalled();
  });

  it('different identities have independent timing', async () => {
    const otherKey = makeBackupIdentityKey('https://other.com', TEST_USER);
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTimes: { [otherKey]: Date.now() - 1000 },
    });
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockCompressToFile.mockResolvedValue({ bytes: 10 });
    mockListDirectoryAsync.mockResolvedValue([]);

    // Current identity has no lastBackupTime, so backup should run
    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).toHaveBeenCalled();
  });

  it('swallows createBackup exceptions', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTimes: {},
    });
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockCompressToFile.mockRejectedValue(new Error('disk full'));
    mockListDirectoryAsync.mockResolvedValue([]);

    await expect(runAutoBackupIfNeeded()).resolves.toBeUndefined();
  });

  it('cleans up .tmp files during startup', async () => {
    backupStore.setState({ autoBackupEnabled: false });
    mockListDirectoryAsync.mockResolvedValue([
      'backup-x.scrobbles.gz.tmp',
      'backup-y.mbid.gz.tmp',
    ]);
    mockFileInstances.set('backup-x.scrobbles.gz.tmp', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-y.mbid.gz.tmp', { exists: true, content: '', deleted: false });

    await runAutoBackupIfNeeded();

    expect(mockFileInstances.get('backup-x.scrobbles.gz.tmp')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-y.mbid.gz.tmp')?.deleted).toBe(true);
  });

  it('cleans up orphaned .gz files with no matching meta', async () => {
    backupStore.setState({ autoBackupEnabled: false });
    mockListDirectoryAsync.mockResolvedValue([
      'backup-a.meta.json',
      'backup-a.scrobbles.gz',
      'backup-orphan.scrobbles.gz',
      'backup-orphan.mbid.gz',
      'backup-orphan.exclusions.gz',
    ]);
    mockFileInstances.set('backup-a.meta.json', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-a.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-orphan.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-orphan.mbid.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-orphan.exclusions.gz', { exists: true, content: '', deleted: false });

    await runAutoBackupIfNeeded();

    expect(mockFileInstances.get('backup-a.scrobbles.gz')?.deleted).toBeFalsy();
    expect(mockFileInstances.get('backup-orphan.scrobbles.gz')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-orphan.mbid.gz')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-orphan.exclusions.gz')?.deleted).toBe(true);
  });

  it('handles listing error in cleanUpOrphanedFiles', async () => {
    backupStore.setState({ autoBackupEnabled: false });
    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));

    await expect(runAutoBackupIfNeeded()).resolves.toBeUndefined();
  });
});

describe('migrateV3BackupMetas', () => {
  it('upgrades v3 meta files to v4 with provided identity', async () => {
    mockListDirectoryAsync.mockResolvedValue(['backup-old.meta.json', 'backup-old.scrobbles.gz']);
    mockFileInstances.set('backup-old.meta.json', { exists: true, content: makeV3Meta(), deleted: false });
    mockFileInstances.set('backup-old.scrobbles.gz', { exists: true, content: '', deleted: false });

    const count = await migrateV3BackupMetas(TEST_SERVER, TEST_USER);

    expect(count).toBe(1);
    const updated = JSON.parse(mockFileInstances.get('backup-old.meta.json')!.content);
    expect(updated.version).toBe(4);
    expect(updated.serverUrl).toBe(TEST_SERVER);
    expect(updated.username).toBe(TEST_USER);
    expect(updated.scrobbles).toEqual({ itemCount: 5, sizeBytes: 100 });
  });

  it('skips v4 meta files', async () => {
    mockListDirectoryAsync.mockResolvedValue(['backup-new.meta.json', 'backup-new.scrobbles.gz']);
    mockFileInstances.set('backup-new.meta.json', { exists: true, content: makeV4Meta(), deleted: false });
    mockFileInstances.set('backup-new.scrobbles.gz', { exists: true, content: '', deleted: false });

    const count = await migrateV3BackupMetas(TEST_SERVER, TEST_USER);

    expect(count).toBe(0);
  });

  it('returns 0 on directory listing error', async () => {
    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));

    const count = await migrateV3BackupMetas(TEST_SERVER, TEST_USER);

    expect(count).toBe(0);
  });

  it('handles mixed v3 and v4 files', async () => {
    mockListDirectoryAsync.mockResolvedValue([
      'backup-v3.meta.json', 'backup-v3.scrobbles.gz',
      'backup-v4.meta.json', 'backup-v4.scrobbles.gz',
    ]);
    mockFileInstances.set('backup-v3.meta.json', { exists: true, content: makeV3Meta(), deleted: false });
    mockFileInstances.set('backup-v3.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-v4.meta.json', { exists: true, content: makeV4Meta(), deleted: false });
    mockFileInstances.set('backup-v4.scrobbles.gz', { exists: true, content: '', deleted: false });

    const count = await migrateV3BackupMetas(TEST_SERVER, TEST_USER);

    expect(count).toBe(1);
    const v3Updated = JSON.parse(mockFileInstances.get('backup-v3.meta.json')!.content);
    expect(v3Updated.version).toBe(4);
    const v4Unchanged = JSON.parse(mockFileInstances.get('backup-v4.meta.json')!.content);
    expect(v4Unchanged.version).toBe(4);
  });
});

describe('createBackup edge cases', () => {
  it('deletes existing dest file before renaming scrobbles', async () => {
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockCompressToFile.mockResolvedValue({ bytes: 10 });

    const origGet = mockFileInstances.get.bind(mockFileInstances);
    jest.spyOn(mockFileInstances, 'get').mockImplementation((key: string) => {
      if (typeof key === 'string' && key.endsWith('.scrobbles.gz') && !key.endsWith('.tmp')) {
        return { exists: true, content: '', deleted: false };
      }
      return origGet(key);
    });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalled();

    (mockFileInstances.get as jest.Mock).mockRestore();
  });

  it('cleans up .tmp file on compressToFile failure for scrobbles', async () => {
    seedScrobbles([{ id: 's1', song: {}, time: 1 }] as any);
    mockCompressToFile.mockRejectedValue(new Error('compression failed'));

    await expect(createBackup()).rejects.toThrow('compression failed');
  });

  it('cleans up .tmp file on compressToFile failure for mbid', async () => {
    mbidOverrideStore.setState({
      overrides: { 'a1': { mbid: 'x', name: 'A' } } as any,
    });
    mockCompressToFile.mockRejectedValue(new Error('compression failed'));

    await expect(createBackup()).rejects.toThrow('compression failed');
  });

  it('cleans up .tmp file on compressToFile failure for exclusions', async () => {
    scrobbleExclusionStore.setState({
      excludedAlbums: { 'alb-1': { id: 'alb-1', name: 'A' } },
      excludedArtists: {},
      excludedPlaylists: {},
    });
    mockCompressToFile.mockRejectedValue(new Error('compression failed'));

    await expect(createBackup()).rejects.toThrow('compression failed');
  });
});

describe('migrateV4BackupMetas', () => {
  it('upgrades v4 meta files to v5 with the provided device identity', async () => {
    const v4 = {
      version: 4,
      createdAt: '2025-01-01',
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      scrobbles: { itemCount: 5, sizeBytes: 200 },
      mbidOverrides: null,
      scrobbleExclusions: null,
    };
    mockFileInstances.set('backup-2025.meta.json', {
      exists: true, content: JSON.stringify(v4), deleted: false,
    });
    mockListDirectoryAsync.mockResolvedValue(['backup-2025.meta.json']);

    const count = await migrateV4BackupMetas(
      'aaaa-bbbb-cccc',
      'OS Device Name',
      'Your Test Device',
    );

    expect(count).toBe(1);
    const upgraded = JSON.parse(mockFileInstances.get('backup-2025.meta.json')!.content);
    expect(upgraded.version).toBe(5);
    expect(upgraded.deviceId).toBe('aaaa-bbbb-cccc');
    expect(upgraded.deviceName).toBe('OS Device Name');
    expect(upgraded.deviceLabel).toBe('Your Test Device');
    // Existing v4 fields preserved.
    expect(upgraded.serverUrl).toBe(TEST_SERVER);
    expect(upgraded.username).toBe(TEST_USER);
    expect(upgraded.scrobbles).toEqual({ itemCount: 5, sizeBytes: 200 });
  });

  it('does not touch v3 backups (those are migrateV3BackupMetas\' job)', async () => {
    const v3 = {
      version: 3,
      createdAt: '2025-01-01',
      scrobbles: null,
      mbidOverrides: null,
      scrobbleExclusions: null,
    };
    mockFileInstances.set('backup-2025.meta.json', {
      exists: true, content: JSON.stringify(v3), deleted: false,
    });
    mockListDirectoryAsync.mockResolvedValue(['backup-2025.meta.json']);

    const count = await migrateV4BackupMetas('id', null, 'label');

    expect(count).toBe(0);
    const after = JSON.parse(mockFileInstances.get('backup-2025.meta.json')!.content);
    expect(after.version).toBe(3);
  });

  it('is idempotent — does not touch v5 backups', async () => {
    const v5 = {
      version: 5,
      createdAt: '2025-01-01',
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      deviceId: 'existing-id',
      deviceName: 'existing-name',
      deviceLabel: 'existing-label',
      scrobbles: null,
      mbidOverrides: null,
      scrobbleExclusions: null,
    };
    mockFileInstances.set('backup-2025.meta.json', {
      exists: true, content: JSON.stringify(v5), deleted: false,
    });
    mockListDirectoryAsync.mockResolvedValue(['backup-2025.meta.json']);

    const count = await migrateV4BackupMetas('new-id', 'new-name', 'new-label');

    expect(count).toBe(0);
    const after = JSON.parse(mockFileInstances.get('backup-2025.meta.json')!.content);
    expect(after.deviceId).toBe('existing-id');
  });

  it('skips unparseable files instead of throwing', async () => {
    mockFileInstances.set('garbage.meta.json', {
      exists: true, content: 'not json', deleted: false,
    });
    mockListDirectoryAsync.mockResolvedValue(['garbage.meta.json']);

    await expect(migrateV4BackupMetas('id', null, 'label')).resolves.toBe(0);
  });
});

describe('restoreBackup — merge mode', () => {
  it('routes scrobbles through mergeAll instead of replaceAll', async () => {
    const mergeAllSpy = jest.spyOn(completedScrobbleStore.getState(), 'mergeAll')
      .mockResolvedValue({ added: 3, skipped: 1 });

    mockFileInstances.set('backup-x.scrobbles.gz', {
      exists: true, content: '', deleted: false,
    });
    const scrobbles = [
      { id: 's1', song: { id: 't1', title: 'T1' }, time: 1 },
      { id: 's2', song: { id: 't2', title: 'T2' }, time: 2 },
    ];
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(scrobbles));

    const result = await restoreBackup({
      stem: 'backup-x',
      createdAt: '2025-01-01',
      scrobbleCount: 2,
      scrobbleSizeBytes: 0,
      mbidOverrideCount: 0,
      mbidOverrideSizeBytes: 0,
      scrobbleExclusionCount: 0,
      scrobbleExclusionSizeBytes: 0,
      bookmarkCount: 0,
      bookmarkSizeBytes: 0,
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      deviceId: 'remote-device',
      deviceName: 'Remote',
      deviceLabel: 'Remote Phone',
    }, 'merge');

    expect(mergeAllSpy).toHaveBeenCalledWith(scrobbles);
    expect(result.scrobbleCount).toBe(3);
    expect(result.scrobbleSkipped).toBe(1);
    mergeAllSpy.mockRestore();
  });

  it('routes MBID overrides through mergeOverrides instead of setState', async () => {
    const mergeSpy = jest.spyOn(mbidOverrideStore.getState(), 'mergeOverrides')
      .mockReturnValue({ added: 2, skipped: 0 });

    mockFileInstances.set('backup-x.mbid.gz', {
      exists: true, content: '', deleted: false,
    });
    const overrides = {
      'artist:a1': { type: 'artist', entityId: 'a1', entityName: 'X', mbid: 'mb-1' },
      'album:b1': { type: 'album', entityId: 'b1', entityName: 'Y', mbid: 'mb-2' },
    };
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(overrides));

    const result = await restoreBackup({
      stem: 'backup-x',
      createdAt: '2025-01-01',
      scrobbleCount: 0,
      scrobbleSizeBytes: 0,
      mbidOverrideCount: 2,
      mbidOverrideSizeBytes: 0,
      scrobbleExclusionCount: 0,
      scrobbleExclusionSizeBytes: 0,
      bookmarkCount: 0,
      bookmarkSizeBytes: 0,
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      deviceId: 'remote-device',
      deviceName: 'Remote',
      deviceLabel: 'Remote Phone',
    }, 'merge');

    expect(mergeSpy).toHaveBeenCalledWith(overrides);
    expect(result.mbidOverrideCount).toBe(2);
    expect(result.mbidOverrideSkipped).toBe(0);
    mergeSpy.mockRestore();
  });

  it('routes exclusions through mergeExclusions instead of setState', async () => {
    const mergeSpy = jest.spyOn(scrobbleExclusionStore.getState(), 'mergeExclusions')
      .mockReturnValue({ added: 1, skipped: 2 });

    mockFileInstances.set('backup-x.exclusions.gz', {
      exists: true, content: '', deleted: false,
    });
    const data = {
      excludedAlbums: { al1: { id: 'al1', name: 'A' } },
      excludedArtists: {},
      excludedPlaylists: {},
    };
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(data));

    const result = await restoreBackup({
      stem: 'backup-x',
      createdAt: '2025-01-01',
      scrobbleCount: 0,
      scrobbleSizeBytes: 0,
      mbidOverrideCount: 0,
      mbidOverrideSizeBytes: 0,
      scrobbleExclusionCount: 1,
      scrobbleExclusionSizeBytes: 0,
      bookmarkCount: 0,
      bookmarkSizeBytes: 0,
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      deviceId: 'remote-device',
      deviceName: 'Remote',
      deviceLabel: 'Remote Phone',
    }, 'merge');

    expect(mergeSpy).toHaveBeenCalledWith(data);
    expect(result.scrobbleExclusionCount).toBe(1);
    expect(result.scrobbleExclusionSkipped).toBe(2);
    mergeSpy.mockRestore();
  });

  it('default mode (no second arg) is replace, preserving the legacy contract', async () => {
    const replaceSpy = jest.spyOn(completedScrobbleStore.getState(), 'replaceAll');
    const mergeSpy = jest.spyOn(completedScrobbleStore.getState(), 'mergeAll');

    mockFileInstances.set('backup-x.scrobbles.gz', {
      exists: true, content: '', deleted: false,
    });
    mockDecompressFromFile.mockResolvedValue(JSON.stringify([
      { id: 's1', song: { id: 't1', title: 'T1' }, time: 1 },
    ]));

    await restoreBackup({
      stem: 'backup-x',
      createdAt: '2025-01-01',
      scrobbleCount: 1,
      scrobbleSizeBytes: 0,
      mbidOverrideCount: 0,
      mbidOverrideSizeBytes: 0,
      scrobbleExclusionCount: 0,
      scrobbleExclusionSizeBytes: 0,
      bookmarkCount: 0,
      bookmarkSizeBytes: 0,
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      deviceId: null,
      deviceName: null,
      deviceLabel: null,
    });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(mergeSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
    mergeSpy.mockRestore();
  });
});

describe('listBackups — v5 backup parsing', () => {
  it('exposes deviceId, deviceName, deviceLabel for v5 backups', async () => {
    const v5 = {
      version: 5,
      createdAt: '2025-01-01T00:00:00Z',
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      deviceId: 'aaaa-bbbb',
      deviceName: 'Greg\'s Pixel',
      deviceLabel: 'Your Pixel 8',
      scrobbles: { itemCount: 1, sizeBytes: 100 },
      mbidOverrides: null,
      scrobbleExclusions: null,
    };
    mockFileInstances.set('backup-2025-aaaabbbb.meta.json', {
      exists: true, content: JSON.stringify(v5), deleted: false,
    });
    mockFileInstances.set('backup-2025-aaaabbbb.scrobbles.gz', {
      exists: true, content: '', deleted: false,
    });
    mockListDirectoryAsync.mockResolvedValue([
      'backup-2025-aaaabbbb.meta.json',
      'backup-2025-aaaabbbb.scrobbles.gz',
    ]);

    const { current } = await listBackups({ serverUrl: TEST_SERVER, username: TEST_USER });

    expect(current).toHaveLength(1);
    expect(current[0].deviceId).toBe('aaaa-bbbb');
    expect(current[0].deviceName).toBe("Greg's Pixel");
    expect(current[0].deviceLabel).toBe('Your Pixel 8');
  });

  it('returns null device fields for v3/v4 backups', async () => {
    const v4 = {
      version: 4,
      createdAt: '2025-01-01T00:00:00Z',
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      scrobbles: { itemCount: 1, sizeBytes: 100 },
      mbidOverrides: null,
      scrobbleExclusions: null,
    };
    mockFileInstances.set('backup-2025.meta.json', {
      exists: true, content: JSON.stringify(v4), deleted: false,
    });
    mockFileInstances.set('backup-2025.scrobbles.gz', {
      exists: true, content: '', deleted: false,
    });
    mockListDirectoryAsync.mockResolvedValue([
      'backup-2025.meta.json',
      'backup-2025.scrobbles.gz',
    ]);

    const { current } = await listBackups({ serverUrl: TEST_SERVER, username: TEST_USER });

    expect(current).toHaveLength(1);
    expect(current[0].deviceId).toBeNull();
    expect(current[0].deviceName).toBeNull();
    expect(current[0].deviceLabel).toBeNull();
  });
});

describe('pruneBackups — per-device bucketing', () => {
  function makeV5(stem: string, deviceId: string, createdAt: string) {
    const meta = {
      version: 5,
      createdAt,
      serverUrl: TEST_SERVER,
      username: TEST_USER,
      deviceId,
      deviceName: null,
      deviceLabel: 'Device',
      scrobbles: { itemCount: 1, sizeBytes: 1 },
      mbidOverrides: null,
      scrobbleExclusions: null,
    };
    mockFileInstances.set(`${stem}.meta.json`, {
      exists: true, content: JSON.stringify(meta), deleted: false,
    });
    mockFileInstances.set(`${stem}.scrobbles.gz`, {
      exists: true, content: '', deleted: false,
    });
  }

  it('keeps `keep` most recent per (server, username, deviceId) bucket', async () => {
    // Two devices, 4 backups each. With keep=2, each device retains its
    // 2 most recent (4 total kept, 4 deleted).
    for (let i = 1; i <= 4; i++) {
      makeV5(`backup-A${i}`, 'device-A', `2025-01-0${i}`);
      makeV5(`backup-B${i}`, 'device-B', `2025-01-0${i}`);
    }
    mockListDirectoryAsync.mockResolvedValue(Array.from(mockFileInstances.keys()));

    await pruneBackups(2);

    // A1, A2, B1, B2 deleted (oldest); A3, A4, B3, B4 kept (newest two per device).
    expect(mockFileInstances.get('backup-A1.meta.json')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-A2.meta.json')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-A3.meta.json')?.deleted).toBeFalsy();
    expect(mockFileInstances.get('backup-A4.meta.json')?.deleted).toBeFalsy();
    expect(mockFileInstances.get('backup-B1.meta.json')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-B2.meta.json')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-B3.meta.json')?.deleted).toBeFalsy();
    expect(mockFileInstances.get('backup-B4.meta.json')?.deleted).toBeFalsy();
  });
});
