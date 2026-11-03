import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Synchronous adapter: `isLoggedIn` gates the login redirect at boot — async
// hydration would flash the logged-out state then bounce.
import { isLogoutPending } from './logoutPending';
import { kvStorageSync as kvStorage } from './persistence';

export type ServerSlot = 'primary' | 'secondary';

export interface AuthState {
  /** The ACTIVE server URL — what every existing consumer (subsonicService,
   *  imageCacheService, etc.) reads. Mirrors whichever slot `activeServer`
   *  points to. Never set directly; use `setActiveServer` to swap slots. */
  serverUrl: string | null;
  username: string | null;
  password: string | null;
  apiVersion: string | null;
  legacyAuth: boolean;
  isLoggedIn: boolean;
  rehydrated: boolean;

  /** Canonical primary URL — the address the user logged in with. */
  primaryServerUrl: string | null;
  /** Optional fallback URL for failover. `null` means failover is disabled. */
  secondaryServerUrl: string | null;
  /** Which slot `serverUrl` currently mirrors. */
  activeServer: ServerSlot;

  setSession: (
    serverUrl: string,
    username: string,
    password: string,
    apiVersion: string,
    legacyAuth?: boolean,
  ) => void;
  setRehydrated: (value: boolean) => void;
  /** Change the stored password only. A password change is not a session change:
   *  it must not touch either server slot or `activeServer`. Pair with
   *  `clearApiCache()` — the caches key on url|username|legacyAuth, not the password. */
  setPassword: (password: string) => void;

  /** Atomically swap `serverUrl` to point at the requested slot. No-op if
   *  the slot has no URL configured or already active. */
  setActiveServer: (target: ServerSlot) => void;
  /** Re-address the primary slot WITHOUT changing which slot is live — editing an
   *  address and choosing to use it are separate acts (the latter is failoverService's).
   *  Mirrors into `serverUrl` when primary is already active, since `setActiveServer`
   *  no-ops on the active slot and nothing else would refresh it. */
  setPrimaryServerUrl: (url: string) => void;
  /** Set or clear the secondary URL, mirroring into `serverUrl` when that slot is live.
   *  Clearing never mirrors — `serverUrl` must not go null (every request path bails on
   *  it) — and switching away first stays the caller's job (failoverService). */
  setSecondaryServerUrl: (url: string | null) => void;
  /** Switch the auth scheme (token ↔ legacy plaintext) without disturbing the
   *  server slots. Callers must re-verify against the server first — see the
   *  Account settings toggle. The API + cover-art caches key on `legacyAuth`,
   *  so they rebuild on next use (pair with `clearApiCache()`). */
  setLegacyAuth: (legacyAuth: boolean) => void;
}

const PERSIST_KEY = 'substreamer-auth';

function resolveSlotUrl(
  target: ServerSlot,
  primary: string | null,
  secondary: string | null,
): string | null {
  return target === 'primary' ? primary : secondary;
}

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
      primaryServerUrl: null,
      secondaryServerUrl: null,
      activeServer: 'primary',

      setSession: (serverUrl, username, password, apiVersion, legacyAuth = false) =>
        set({
          // Login defines the primary. Active resets to primary so a
          // re-login after failover always starts on the new primary.
          serverUrl,
          primaryServerUrl: serverUrl,
          activeServer: 'primary',
          username,
          password,
          apiVersion,
          legacyAuth,
          isLoggedIn: true,
          rehydrated: true,
        }),

      setRehydrated: (value) => set({ rehydrated: value }),

      setPassword: (password) => set({ password }),

      setActiveServer: (target) =>
        set((state) => {
          if (state.activeServer === target) return state;
          const nextUrl = resolveSlotUrl(target, state.primaryServerUrl, state.secondaryServerUrl);
          if (!nextUrl) return state;
          return { activeServer: target, serverUrl: nextUrl };
        }),

      setPrimaryServerUrl: (url) =>
        set((state) =>
          state.activeServer === 'primary'
            ? { primaryServerUrl: url, serverUrl: url }
            : { primaryServerUrl: url },
        ),

      setSecondaryServerUrl: (url) =>
        set((state) =>
          // Only mirror when SETTING a live secondary. Mirroring a clear would write
          // `serverUrl: null`, which is persisted and which every request path treats as
          // "no session" — unrecoverable short of logout.
          url != null && state.activeServer === 'secondary'
            ? { secondaryServerUrl: url, serverUrl: url }
            : { secondaryServerUrl: url },
        ),

      setLegacyAuth: (legacyAuth) => set({ legacyAuth }),
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
        primaryServerUrl: state.primaryServerUrl,
        secondaryServerUrl: state.secondaryServerUrl,
        activeServer: state.activeServer,
      }),
      // A pending logout reads as logged out from the first frame; the splash finishes it.
      // The result replaces the whole state, so it must carry the actions.
      merge: (persisted, current) =>
        isLogoutPending() ? current : { ...current, ...(persisted as Partial<AuthState>) },
      // No boot reset: `activeServer` is restored verbatim. If the restored
      // server is unreachable, the connectivity banner offers a switch (detect-
      // and-confirm) — we never silently force a slot on launch.
    },
  ),
);
