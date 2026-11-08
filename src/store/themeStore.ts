import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Synchronous adapter: theme must be hydrated before first paint — async
// hydration would reintroduce the startup white/wrong-mode flash.
import { kvStorageSync as kvStorage } from './persistence';

export type ThemePreference = 'light' | 'dark' | 'system';

export const DEFAULT_PRIMARY_COLOR = '#8A8A8A';

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
