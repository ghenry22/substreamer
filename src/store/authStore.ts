import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

export interface AuthState {
  serverUrl: string | null;
  username: string | null;
  password: string | null;
  apiVersion: string | null;
  legacyAuth: boolean;
  isLoggedIn: boolean;
  rehydrated: boolean;
  setSession: (
    serverUrl: string,
    username: string,
    password: string,
    apiVersion: string,
    legacyAuth?: boolean
  ) => void;
  clearSession: () => void;
  setRehydrated: (value: boolean) => void;
}

const PERSIST_KEY = 'substreamer-auth';

export const authStore = create<AuthState>()(
  persist(
    (set) => ({
      serverUrl: null,
      username: null,
      password: null,
      apiVersion: null,
      legacyAuth: false,
      isLoggedIn: false,
      rehydrated: false,

      setSession: (serverUrl, username, password, apiVersion, legacyAuth = false) =>
        set({
          serverUrl,
          username,
          password,
          apiVersion,
          legacyAuth,
          isLoggedIn: true,
          rehydrated: true,
        }),

      clearSession: () =>
        set({
          serverUrl: null,
          username: null,
          password: null,
          apiVersion: null,
          legacyAuth: false,
          isLoggedIn: false,
        }),

      setRehydrated: (value) => set({ rehydrated: value }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        username: state.username,
        password: state.password,
        apiVersion: state.apiVersion,
        legacyAuth: state.legacyAuth,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
);
