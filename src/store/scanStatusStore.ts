import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

export interface ScanStatusState {
  scanning: boolean;
  count: number;
  lastScan: number | null;
  folderCount: number | null;
  loading: boolean;
  error: string | null;

  setScanStatus: (status: {
    scanning: boolean;
    count: number;
    lastScan: number | null;
    folderCount: number | null;
  }) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearScanStatus: () => void;
}

const PERSIST_KEY = 'substreamer-scan-status';

const initialState = {
  scanning: false,
  count: 0,
  lastScan: null as number | null,
  folderCount: null as number | null,
  loading: false,
  error: null as string | null,
};

export const scanStatusStore = create<ScanStatusState>()(
  persist(
    (set) => ({
      ...initialState,

      setScanStatus: (status) =>
        set({
          scanning: status.scanning,
          count: status.count,
          lastScan: status.lastScan,
          folderCount: status.folderCount,
          error: null,
        }),

      setLoading: (loading) => set({ loading }),

      setError: (error) => set({ error, loading: false }),

      clearScanStatus: () => set(initialState),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        scanning: state.scanning,
        count: state.count,
        lastScan: state.lastScan,
        folderCount: state.folderCount,
      }),
    }
  )
);
