import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

export interface LocaleState {
  /** User's explicit locale choice, or null to follow the device setting. */
  locale: string | null;
  setLocale: (locale: string | null) => void;
}

const PERSIST_KEY = 'substreamer-locale';

export const localeStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: null,
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({ locale: state.locale }),
    }
  )
);
