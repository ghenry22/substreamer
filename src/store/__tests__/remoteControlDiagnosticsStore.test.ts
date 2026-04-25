const mockFileInstances = new Map<string, { exists: boolean; size: number | null; deleted: boolean }>();

jest.mock('expo-file-system', () => {
  class MockFile {
    _name: string;
    constructor(_base: any, ...parts: string[]) {
      this._name = parts.join('/');
    }
    get exists() {
      return mockFileInstances.get(this._name)?.exists ?? false;
    }
    get size() {
      const entry = mockFileInstances.get(this._name);
      return entry?.exists ? entry.size : null;
    }
    write(_content: string) {
      mockFileInstances.set(this._name, { exists: true, size: 0, deleted: false });
    }
    delete() {
      const entry = mockFileInstances.get(this._name);
      if (entry) {
        entry.exists = false;
        entry.deleted = true;
      }
    }
  }
  class MockDirectory {
    uri = 'file:///document/';
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: new MockDirectory() },
  };
});

import { remoteControlDiagnosticsStore } from '../remoteControlDiagnosticsStore';

beforeEach(() => {
  mockFileInstances.clear();
  remoteControlDiagnosticsStore.setState({ enabled: false, logFileSize: null });
});

describe('remoteControlDiagnosticsStore', () => {
  describe('defaults', () => {
    it('starts disabled with no log file', () => {
      const state = remoteControlDiagnosticsStore.getState();
      expect(state.enabled).toBe(false);
      expect(state.logFileSize).toBeNull();
    });
  });

  describe('setEnabled', () => {
    it('creates flag file when enabling', async () => {
      await remoteControlDiagnosticsStore.getState().setEnabled(true);
      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(true);
      expect(mockFileInstances.get('remote-control-diagnostics-enabled')?.exists).toBe(true);
    });

    it('deletes flag file when disabling', async () => {
      mockFileInstances.set('remote-control-diagnostics-enabled', { exists: true, size: 0, deleted: false });
      await remoteControlDiagnosticsStore.getState().setEnabled(false);
      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(false);
      expect(mockFileInstances.get('remote-control-diagnostics-enabled')?.exists).toBe(false);
    });

    it('handles disabling when flag file does not exist', async () => {
      await remoteControlDiagnosticsStore.getState().setEnabled(false);
      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(false);
    });

    it('is idempotent when enabling twice', async () => {
      await remoteControlDiagnosticsStore.getState().setEnabled(true);
      await remoteControlDiagnosticsStore.getState().setEnabled(true);
      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(true);
    });
  });

  describe('resetLog', () => {
    it('deletes both log files', async () => {
      mockFileInstances.set('remote-control-diagnostics.log', { exists: true, size: 1024, deleted: false });
      mockFileInstances.set('remote-control-diagnostics.old.log', { exists: true, size: 2048, deleted: false });

      await remoteControlDiagnosticsStore.getState().resetLog();

      expect(mockFileInstances.get('remote-control-diagnostics.log')?.deleted).toBe(true);
      expect(mockFileInstances.get('remote-control-diagnostics.old.log')?.deleted).toBe(true);
      expect(remoteControlDiagnosticsStore.getState().logFileSize).toBeNull();
    });

    it('handles missing log files gracefully', async () => {
      await remoteControlDiagnosticsStore.getState().resetLog();
      expect(remoteControlDiagnosticsStore.getState().logFileSize).toBeNull();
    });

    it('deletes only the files that exist', async () => {
      mockFileInstances.set('remote-control-diagnostics.log', { exists: true, size: 512, deleted: false });

      await remoteControlDiagnosticsStore.getState().resetLog();

      expect(mockFileInstances.get('remote-control-diagnostics.log')?.deleted).toBe(true);
      expect(mockFileInstances.has('remote-control-diagnostics.old.log')).toBe(false);
    });
  });

  describe('refreshStatus', () => {
    it('reads enabled state and log file size', async () => {
      mockFileInstances.set('remote-control-diagnostics-enabled', { exists: true, size: 0, deleted: false });
      mockFileInstances.set('remote-control-diagnostics.log', { exists: true, size: 4096, deleted: false });

      await remoteControlDiagnosticsStore.getState().refreshStatus();

      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(true);
      expect(remoteControlDiagnosticsStore.getState().logFileSize).toBe(4096);
    });

    it('reports disabled when flag file is absent', async () => {
      await remoteControlDiagnosticsStore.getState().refreshStatus();

      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(false);
      expect(remoteControlDiagnosticsStore.getState().logFileSize).toBeNull();
    });

    it('reports null size when log file does not exist', async () => {
      mockFileInstances.set('remote-control-diagnostics-enabled', { exists: true, size: 0, deleted: false });

      await remoteControlDiagnosticsStore.getState().refreshStatus();

      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(true);
      expect(remoteControlDiagnosticsStore.getState().logFileSize).toBeNull();
    });

    it('reports enabled false after disabling', async () => {
      mockFileInstances.set('remote-control-diagnostics-enabled', { exists: true, size: 0, deleted: false });
      await remoteControlDiagnosticsStore.getState().refreshStatus();
      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(true);

      await remoteControlDiagnosticsStore.getState().setEnabled(false);
      await remoteControlDiagnosticsStore.getState().refreshStatus();
      expect(remoteControlDiagnosticsStore.getState().enabled).toBe(false);
    });
  });
});
