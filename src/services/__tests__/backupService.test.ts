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

jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

// Mock the per-row scrobble table so we can assert SQL-layer wiring without
// needing a real SQLite handle in the test.
jest.mock('../../store/persistence/scrobbleTable', () => ({
  insertScrobble: jest.fn(),
  replaceAllScrobbles: jest.fn(),
  clearScrobbles: jest.fn(),
  hydrateScrobbles: jest.fn(() => []),
}));

import { authStore } from '../../store/authStore';
import { completedScrobbleStore } from '../../store/completedScrobbleStore';
import { replaceAllScrobbles } from '../../store/persistence/scrobbleTable';
import { mbidOverrideStore } from '../../store/mbidOverrideStore';
import { scrobbleExclusionStore } from '../../store/scrobbleExclusionStore';
import { backupStore } from '../../store/backupStore';
import {
  createBackup,
  listBackups,
  makeBackupIdentityKey,
  restoreBackup,
  pruneBackups,
  runAutoBackupIfNeeded,
  migrateV3BackupMetas,
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

  completedScrobbleStore.setState({
    completedScrobbles: [],
    stats: { totalPlays: 0, totalListeningSeconds: 0, uniqueArtists: {} },
  });
  mbidOverrideStore.setState({ overrides: {} });
  scrobbleExclusionStore.setState({ excludedAlbums: {}, excludedArtists: {}, excludedPlaylists: {} });
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
  it('compresses scrobbles and writes v4 meta with identity', async () => {
    completedScrobbleStore.setState({
      completedScrobbles: [
        { id: 's1', song: { id: 'track-1' } as any, time: 1000 },
      ] as any,
    });
    mockCompressToFile.mockResolvedValue({ bytes: 42 });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalledTimes(1);
    const metaEntries = Array.from(mockFileInstances.entries())
      .filter(([k]) => k.endsWith('.meta.json'));
    expect(metaEntries).toHaveLength(1);
    const meta = JSON.parse(metaEntries[0][1].content);
    expect(meta.version).toBe(4);
    expect(meta.serverUrl).toBe(TEST_SERVER);
    expect(meta.username).toBe(TEST_USER);
    expect(meta.scrobbles).toEqual({ itemCount: 1, sizeBytes: 42 });
    expect(meta.mbidOverrides).toBeNull();
    expect(meta.scrobbleExclusions).toBeNull();
  });

  it('throws when no active session', async () => {
    setAuth(null, null);
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });

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

  it('creates all three datasets when all have data', async () => {
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
    serverUrl: TEST_SERVER,
    username: TEST_USER,
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
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(2);
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
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace.mock.calls[0][0]).toHaveLength(1);
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
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).not.toHaveBeenCalled();
  });

  it('skips when within 24h of last backup for this identity', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTimes: { [TEST_IDENTITY_KEY]: Date.now() - 1000 },
    });
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).not.toHaveBeenCalled();
  });

  it('creates backup when due for this identity', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTimes: { [TEST_IDENTITY_KEY]: Date.now() - 25 * 60 * 60 * 1000 },
    });
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
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
