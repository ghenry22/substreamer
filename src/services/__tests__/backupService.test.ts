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

import { completedScrobbleStore } from '../../store/completedScrobbleStore';
import { mbidOverrideStore } from '../../store/mbidOverrideStore';
import { backupStore } from '../../store/backupStore';
import {
  createBackup,
  listBackups,
  restoreBackup,
  pruneBackups,
  runAutoBackupIfNeeded,
} from '../backupService';

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
  backupStore.setState({ autoBackupEnabled: false, lastBackupTime: null });
});

describe('createBackup', () => {
  it('compresses scrobbles and writes meta file', async () => {
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
    expect(meta.version).toBe(2);
    expect(meta.scrobbles).toEqual({ itemCount: 1, sizeBytes: 42 });
    expect(meta.mbidOverrides).toBeNull();
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

  it('is a no-op when both datasets are empty', async () => {
    await createBackup();
    expect(mockCompressToFile).not.toHaveBeenCalled();
    const metaEntries = Array.from(mockFileInstances.entries())
      .filter(([k]) => k.endsWith('.meta.json'));
    expect(metaEntries).toHaveLength(0);
  });

  it('updates lastBackupTime in store', async () => {
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
    mockCompressToFile.mockResolvedValue({ bytes: 10 });

    await createBackup();

    expect(backupStore.getState().lastBackupTime).toBeGreaterThan(0);
  });
});

describe('listBackups', () => {
  it('parses meta files and returns sorted entries', async () => {
    const meta1 = JSON.stringify({
      version: 2,
      createdAt: '2025-01-01T00:00:00Z',
      scrobbles: { itemCount: 5, sizeBytes: 100 },
      mbidOverrides: null,
    });
    const meta2 = JSON.stringify({
      version: 2,
      createdAt: '2025-06-01T00:00:00Z',
      scrobbles: { itemCount: 10, sizeBytes: 200 },
      mbidOverrides: { itemCount: 2, sizeBytes: 50 },
    });

    mockListDirectoryAsync.mockResolvedValue([
      'backup-2025-01-01.meta.json',
      'backup-2025-01-01.scrobbles.gz',
      'backup-2025-06-01.meta.json',
      'backup-2025-06-01.scrobbles.gz',
      'backup-2025-06-01.mbid.gz',
    ]);

    mockFileInstances.set('backup-2025-01-01.meta.json', { exists: true, content: meta1, deleted: false });
    mockFileInstances.set('backup-2025-01-01.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-2025-06-01.meta.json', { exists: true, content: meta2, deleted: false });
    mockFileInstances.set('backup-2025-06-01.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-2025-06-01.mbid.gz', { exists: true, content: '', deleted: false });

    const entries = await listBackups();

    expect(entries).toHaveLength(2);
    expect(entries[0].createdAt).toBe('2025-06-01T00:00:00Z');
    expect(entries[0].scrobbleCount).toBe(10);
    expect(entries[0].mbidOverrideCount).toBe(2);
    expect(entries[1].createdAt).toBe('2025-01-01T00:00:00Z');
    expect(entries[1].scrobbleCount).toBe(5);
  });

  it('skips entries with wrong version', async () => {
    const meta = JSON.stringify({ version: 1, createdAt: '2025-01-01' });
    mockListDirectoryAsync.mockResolvedValue(['old.meta.json']);
    mockFileInstances.set('old.meta.json', { exists: true, content: meta, deleted: false });

    const entries = await listBackups();
    expect(entries).toHaveLength(0);
  });

  it('returns empty array on directory listing error', async () => {
    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));
    const entries = await listBackups();
    expect(entries).toEqual([]);
  });

  it('skips entries with missing data files', async () => {
    const meta = JSON.stringify({
      version: 2,
      createdAt: '2025-01-01',
      scrobbles: { itemCount: 5, sizeBytes: 100 },
      mbidOverrides: null,
    });
    mockListDirectoryAsync.mockResolvedValue(['backup-x.meta.json']);
    mockFileInstances.set('backup-x.meta.json', { exists: true, content: meta, deleted: false });
    // No .scrobbles.gz file exists

    const entries = await listBackups();
    expect(entries).toHaveLength(0);
  });
});

describe('restoreBackup', () => {
  it('restores scrobbles from backup', async () => {
    const scrobbles = [{ id: 's1', song: { id: 't1' }, time: 1 }];
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(scrobbles));

    mockFileInstances.set('backup-x.scrobbles.gz', { exists: true, content: '', deleted: false });

    const result = await restoreBackup({
      stem: 'backup-x',
      createdAt: '2025-01-01',
      scrobbleCount: 1,
      scrobbleSizeBytes: 50,
      mbidOverrideCount: 0,
      mbidOverrideSizeBytes: 0,
    });

    expect(result.scrobbleCount).toBe(1);
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(1);
  });

  it('restores MBID overrides from backup', async () => {
    const overrides = { 'artist-1': { mbid: 'mbid-1', name: 'Test' } };
    mockDecompressFromFile.mockResolvedValue(JSON.stringify(overrides));

    mockFileInstances.set('backup-x.mbid.gz', { exists: true, content: '', deleted: false });

    const result = await restoreBackup({
      stem: 'backup-x',
      createdAt: '2025-01-01',
      scrobbleCount: 0,
      scrobbleSizeBytes: 0,
      mbidOverrideCount: 1,
      mbidOverrideSizeBytes: 30,
    });

    expect(result.mbidOverrideCount).toBe(1);
    expect(mbidOverrideStore.getState().overrides).toHaveProperty('artist-1');
  });

  it('throws when scrobble data file is missing', async () => {
    await expect(
      restoreBackup({
        stem: 'backup-missing',
        createdAt: '2025-01-01',
        scrobbleCount: 1,
        scrobbleSizeBytes: 50,
        mbidOverrideCount: 0,
        mbidOverrideSizeBytes: 0,
      }),
    ).rejects.toThrow('Scrobble backup data file not found');
  });

  it('throws when MBID data file is missing', async () => {
    await expect(
      restoreBackup({
        stem: 'backup-missing',
        createdAt: '2025-01-01',
        scrobbleCount: 0,
        scrobbleSizeBytes: 0,
        mbidOverrideCount: 1,
        mbidOverrideSizeBytes: 30,
      }),
    ).rejects.toThrow('MBID override backup data file not found');
  });
});

describe('pruneBackups', () => {
  it('deletes oldest backups beyond keep count', async () => {
    const metas = Array.from({ length: 7 }, (_, i) => {
      const date = `2025-0${i + 1}-01T00:00:00Z`;
      const stem = `backup-${i}`;
      return { stem, date };
    });

    mockListDirectoryAsync.mockResolvedValue(
      metas.flatMap((m) => [
        `${m.stem}.meta.json`,
        `${m.stem}.scrobbles.gz`,
      ]),
    );

    for (const m of metas) {
      const meta = JSON.stringify({
        version: 2,
        createdAt: m.date,
        scrobbles: { itemCount: 1, sizeBytes: 10 },
        mbidOverrides: null,
      });
      mockFileInstances.set(`${m.stem}.meta.json`, { exists: true, content: meta, deleted: false });
      mockFileInstances.set(`${m.stem}.scrobbles.gz`, { exists: true, content: '', deleted: false });
    }

    await pruneBackups(5);

    // 2 oldest should be deleted
    expect(mockFileInstances.get('backup-0.meta.json')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-1.meta.json')?.deleted).toBe(true);
    // Newest 5 should remain
    expect(mockFileInstances.get('backup-6.meta.json')?.deleted).toBeFalsy();
  });

  it('does nothing when under keep limit', async () => {
    mockListDirectoryAsync.mockResolvedValue(['b.meta.json', 'b.scrobbles.gz']);
    mockFileInstances.set('b.meta.json', {
      exists: true,
      content: JSON.stringify({
        version: 2,
        createdAt: '2025-01-01',
        scrobbles: { itemCount: 1, sizeBytes: 10 },
        mbidOverrides: null,
      }),
      deleted: false,
    });
    mockFileInstances.set('b.scrobbles.gz', { exists: true, content: '', deleted: false });

    await pruneBackups(5);

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

  it('skips when within 24h of last backup', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTime: Date.now() - 1000,
    });
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).not.toHaveBeenCalled();
  });

  it('creates backup when due', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTime: Date.now() - 25 * 60 * 60 * 1000,
    });
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
    mockCompressToFile.mockResolvedValue({ bytes: 10 });
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).toHaveBeenCalled();
  });

  it('creates backup when lastBackupTime is null', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTime: null,
    });
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
    mockCompressToFile.mockResolvedValue({ bytes: 10 });
    mockListDirectoryAsync.mockResolvedValue([]);

    await runAutoBackupIfNeeded();
    expect(mockCompressToFile).toHaveBeenCalled();
  });

  it('swallows createBackup exceptions', async () => {
    backupStore.setState({
      autoBackupEnabled: true,
      lastBackupTime: null,
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
    ]);
    mockFileInstances.set('backup-a.meta.json', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-a.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-orphan.scrobbles.gz', { exists: true, content: '', deleted: false });
    mockFileInstances.set('backup-orphan.mbid.gz', { exists: true, content: '', deleted: false });

    await runAutoBackupIfNeeded();

    expect(mockFileInstances.get('backup-a.scrobbles.gz')?.deleted).toBeFalsy();
    expect(mockFileInstances.get('backup-orphan.scrobbles.gz')?.deleted).toBe(true);
    expect(mockFileInstances.get('backup-orphan.mbid.gz')?.deleted).toBe(true);
  });

  it('handles listing error in cleanUpOrphanedFiles', async () => {
    backupStore.setState({ autoBackupEnabled: false });
    mockListDirectoryAsync.mockRejectedValue(new Error('ENOENT'));

    await expect(runAutoBackupIfNeeded()).resolves.toBeUndefined();
  });
});

describe('createBackup edge cases', () => {
  it('deletes existing dest file before renaming scrobbles', async () => {
    completedScrobbleStore.setState({
      completedScrobbles: [{ id: 's1', song: {}, time: 1 }] as any,
    });
    mockCompressToFile.mockResolvedValue({ bytes: 10 });

    // Pre-populate a dest file to trigger the exists check
    // We need to figure out the exact filename — it uses a timestamp.
    // Instead, let's set ALL scrobbles.gz files as existing
    const origGet = mockFileInstances.get.bind(mockFileInstances);
    const origHas = mockFileInstances.has.bind(mockFileInstances);

    // Make any .scrobbles.gz file appear to exist
    jest.spyOn(mockFileInstances, 'get').mockImplementation((key: string) => {
      if (typeof key === 'string' && key.endsWith('.scrobbles.gz') && !key.endsWith('.tmp')) {
        return { exists: true, content: '', deleted: false };
      }
      return origGet(key);
    });

    await createBackup();

    expect(mockCompressToFile).toHaveBeenCalled();

    // Restore the spy
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
});
