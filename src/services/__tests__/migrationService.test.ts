const mockFileWrite = jest.fn();
let mockFileExists = false;
let mockDirExists = false;
const mockDirDelete = jest.fn();
const mockFileDelete = jest.fn();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = parts.map((p: any) => (typeof p === 'string' ? p : p.uri ?? '')).join('/');
    }
    get exists() { return mockFileExists; }
    write = mockFileWrite;
    delete = mockFileDelete;
    text = jest.fn().mockResolvedValue('');
  }
  class MockDirectory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = parts.map((p: any) => (typeof p === 'string' ? p : p.uri ?? '')).join('/');
    }
    get exists() { return mockDirExists; }
    create = jest.fn();
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

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { Platform } from 'react-native';
import { getPendingTasks, runMigrations } from '../migrationService';

beforeEach(() => {
  mockFileWrite.mockClear();
  mockDirDelete.mockClear();
  mockFileDelete.mockClear();
  mockFileExists = false;
  mockDirExists = false;
  (Platform as any).OS = 'ios';
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

  it('Task 2 uses android databases path', async () => {
    (Platform as any).OS = 'android';
    mockDirExists = true;
    mockFileExists = false;
    await runMigrations(0);
    const logContent = mockFileWrite.mock.calls[0][0] as string;
    expect(logContent).toContain('Checking directory:');
    expect(logContent).toContain('Not found:');
  });
});
