import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

export interface AuthState {
  serverUrl: string | null;
  username: string | null;
  password: string | null;
  apiVersion: string | null;
  isLoggedIn: boolean;
  rehydrated: boolean;
  setSession: (
    serverUrl: string,
    username: string,
    password: string,
    apiVersion: string
  ) => void;
  clearSession: () => void;
  setRehydrated: (value: boolean) => void;
}

const PERSIST_KEY = 'substreamer-auth';

/**
 * Clears all persisted auth data (SQLite + in-memory state).
 * Intended for development/debugging use.
 */
export async function clearPersistedData(): Promise<void> {
  sqliteStorage.removeItem(PERSIST_KEY);
  authStore.getState().clearSession();
}

export const authStore = create<AuthState>()(
  persist(
    (set) => ({
      serverUrl: null,
      username: null,
      password: null,
      apiVersion: null,
      isLoggedIn: false,
      rehydrated: false,

      setSession: (serverUrl, username, password, apiVersion) =>
        set({
          serverUrl,
          username,
          password,
          apiVersion,
          isLoggedIn: true,
        }),

      clearSession: () =>
        set({
          serverUrl: null,
          username: null,
          password: null,
          apiVersion: null,
          isLoggedIn: false,
        }),

      setRehydrated: (value) => set({ rehydrated: value }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        username: state.username,
        password: state.password,
        apiVersion: state.apiVersion,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
);
