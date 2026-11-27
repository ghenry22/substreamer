import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

interface SearchSettingsState {
  alwaysSearchServer: boolean;
  setAlwaysSearchServer: (value: boolean) => void;
}

export const searchSettingsStore = create<SearchSettingsState>()(
  persist(
    (set) => ({
      alwaysSearchServer: false,
      setAlwaysSearchServer: (alwaysSearchServer) => set({ alwaysSearchServer }),
    }),
    {
      name: 'substreamer-search-settings',
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({ alwaysSearchServer: state.alwaysSearchServer }),
    },
  ),
);
