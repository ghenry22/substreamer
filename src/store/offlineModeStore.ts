import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

interface OfflineModeState {
  offlineMode: boolean;
  showInFilterBar: boolean;

  toggleOfflineMode: () => void;
  setOfflineMode: (value: boolean) => void;
  setShowInFilterBar: (show: boolean) => void;
}

const PERSIST_KEY = 'substreamer-offline-mode';

export const offlineModeStore = create<OfflineModeState>()(
  persist(
    (set) => ({
      offlineMode: false,
      showInFilterBar: true,

      toggleOfflineMode: () => set((s) => ({ offlineMode: !s.offlineMode })),
      setOfflineMode: (offlineMode) => set({ offlineMode }),
      setShowInFilterBar: (showInFilterBar) => set({ showInFilterBar }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        offlineMode: state.offlineMode,
        showInFilterBar: state.showInFilterBar,
      }),
    }
  )
);

import { filterBarStore } from './filterBarStore';

offlineModeStore.subscribe((state, prevState) => {
  if (state.offlineMode === prevState.offlineMode) return;
  filterBarStore.getState().setDownloadedOnly(state.offlineMode);
});

// Sync initial state -- rehydration completes synchronously during create()
// (sqliteStorage is sync), so the subscription above misses it.
if (offlineModeStore.getState().offlineMode) {
  filterBarStore.getState().setDownloadedOnly(true);
}
