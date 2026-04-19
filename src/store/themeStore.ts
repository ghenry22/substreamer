import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

export type ThemePreference = 'light' | 'dark' | 'system';

export const DEFAULT_PRIMARY_COLOR = '#1D9BF0';

export interface ThemeState {
  themePreference: ThemePreference;
  primaryColor: string | null;
  setThemePreference: (preference: ThemePreference) => void;
  setPrimaryColor: (color: string | null) => void;
}

const PERSIST_KEY = 'substreamer-theme';

export const themeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themePreference: 'dark',
      primaryColor: null,
      setThemePreference: (themePreference) => set({ themePreference }),
      setPrimaryColor: (primaryColor) => set({ primaryColor }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        themePreference: state.themePreference,
        primaryColor: state.primaryColor,
      }),
    }
  )
);
