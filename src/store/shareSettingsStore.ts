import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { authStore } from './authStore';
import { kvStorage } from './persistence';

interface ShareSettingsState {
  shareBaseUrl: string | null;
  setShareBaseUrl: (url: string | null) => void;
}

export const shareSettingsStore = create<ShareSettingsState>()(
  persist(
    (set) => ({
      shareBaseUrl: null,
      setShareBaseUrl: (url) => set({ shareBaseUrl: url || null }),
    }),
    {
      name: 'substreamer-share-settings',
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({ shareBaseUrl: state.shareBaseUrl }),
    },
  ),
);

/**
 * Returns the effective base URL for share links.
 * Uses the user-configured alternate URL if set, otherwise falls back
 * to the server URL from authStore.
 */
export function getEffectiveShareBaseUrl(): string | null {
  return shareSettingsStore.getState().shareBaseUrl ?? authStore.getState().serverUrl;
}

/**
 * Rewrites a share URL from the server to use the alternate base URL.
 * If no alternate URL is configured, returns the original URL unchanged.
 */
export function rewriteShareUrl(originalUrl: string): string {
  const alternate = shareSettingsStore.getState().shareBaseUrl;
  if (!alternate) return originalUrl;

  const serverUrl = authStore.getState().serverUrl;
  if (!serverUrl) return originalUrl;

  try {
    const serverOrigin = new URL(serverUrl).origin;
    const alternateOrigin = new URL(alternate).origin;
    return originalUrl.replace(serverOrigin, alternateOrigin);
  } catch {
    return originalUrl;
  }
}
