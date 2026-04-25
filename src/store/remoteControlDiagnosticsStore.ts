import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';

const FLAG_FILE_NAME = 'remote-control-diagnostics-enabled';
const LOG_FILE_NAME = 'remote-control-diagnostics.log';
const OLD_LOG_FILE_NAME = 'remote-control-diagnostics.old.log';

interface RemoteControlDiagnosticsState {
  enabled: boolean;
  logFileSize: number | null;
  setEnabled: (enabled: boolean) => Promise<void>;
  resetLog: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

export const remoteControlDiagnosticsStore = create<RemoteControlDiagnosticsState>()((set) => ({
  enabled: false,
  logFileSize: null,

  setEnabled: async (enabled: boolean) => {
    const flagFile = new File(Paths.document, FLAG_FILE_NAME);
    try {
      if (enabled) {
        flagFile.write('');
      } else {
        if (flagFile.exists) flagFile.delete();
      }
      set({ enabled });
    } catch { /* best-effort: flag file I/O failure is non-critical */ }
  },

  resetLog: async () => {
    try {
      const logFile = new File(Paths.document, LOG_FILE_NAME);
      const oldLogFile = new File(Paths.document, OLD_LOG_FILE_NAME);
      if (logFile.exists) logFile.delete();
      if (oldLogFile.exists) oldLogFile.delete();
      set({ logFileSize: null });
    } catch { /* best-effort */ }
  },

  refreshStatus: async () => {
    try {
      const flagFile = new File(Paths.document, FLAG_FILE_NAME);
      const logFile = new File(Paths.document, LOG_FILE_NAME);
      const enabled = flagFile.exists;
      let logFileSize: number | null = null;
      if (logFile.exists) {
        logFileSize = logFile.size ?? null;
      }
      set({ enabled, logFileSize });
    } catch { /* best-effort */ }
  },
}));
