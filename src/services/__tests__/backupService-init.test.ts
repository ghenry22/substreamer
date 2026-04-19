/**
 * Verifies that the backupService module survives an FS failure at
 * module-init time. The top-level initBackupDir() call is wrapped in
 * try/catch so that exceptions from the filesystem cannot crash the
 * JS bundle load chain (which transitively imports this module via
 * migrationService and _layout.tsx).
 */

jest.mock('expo-file-system', () => {
  class ThrowingDirectory {
    uri = 'file:///document/backups';
    get exists() {
      return false;
    }
    create() {
      throw new Error('simulated FS failure at init');
    }
    get parentDirectory() {
      return new ThrowingDirectory();
    }
  }
  class MockFile {
    uri: string;
    constructor(_base: any, ...parts: string[]) {
      this.uri = `file:///document/${parts.join('/')}`;
    }
    get exists() {
      return false;
    }
    write() {}
    delete() {}
    async text() {
      return '';
    }
  }
  return {
    File: MockFile,
    Directory: ThrowingDirectory,
    Paths: { document: new ThrowingDirectory() },
  };
});

jest.mock('expo-async-fs', () => ({
  listDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('expo-gzip', () => ({
  compressToFile: jest.fn(),
  decompressFromFile: jest.fn(),
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

describe('backupService module init resilience', () => {
  it('imports cleanly when Directory.create throws at module-init time', () => {
    // The act of requiring the module triggers the top-level
    // initBackupDir() call. If the try/catch guard is missing this
    // throws and the require fails, which would crash app startup.
    expect(() => require('../backupService')).not.toThrow();
  });

  it('leaves exported functions callable after init failure', async () => {
    const mod = require('../backupService');
    // runAutoBackupIfNeeded() swallows its own errors, so it must
    // resolve without throwing even though the underlying directory
    // can never be created.
    await expect(mod.runAutoBackupIfNeeded()).resolves.toBeUndefined();
  });
});
