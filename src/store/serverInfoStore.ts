import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

interface OpenSubsonicExtension {
  name: string;
  versions: number[];
}

export interface ServerInfo {
  serverType: string | null;
  serverVersion: string | null;
  apiVersion: string | null;
  openSubsonic: boolean;
  extensions: OpenSubsonicExtension[];
  lastFetchedAt: number | null;
  adminRole: boolean | null;
  shareRole: boolean | null;
  /**
   * The space-separated `ignoredArticles` hint returned by the server's
   * `getIndexes` / `getArtists` endpoint, parsed into an array. Drives
   * the article-stripped sort in album/artist/playlist lists when
   * present. `null` until the first successful fetch; falls back to
   * `DEFAULT_IGNORED_ARTICLES` in `sortHelpers.ts` when null.
   */
  ignoredArticles: string[] | null;
}

export interface ServerInfoState extends ServerInfo {
  setServerInfo: (info: ServerInfo) => void;
  setIgnoredArticles: (articles: string[] | null) => void;
  clearServerInfo: () => void;
}

const PERSIST_KEY = 'substreamer-server-info';

const initialServerInfo: ServerInfo = {
  serverType: null,
  serverVersion: null,
  apiVersion: null,
  openSubsonic: false,
  extensions: [],
  lastFetchedAt: null,
  adminRole: null,
  shareRole: null,
  ignoredArticles: null,
};

export const serverInfoStore = create<ServerInfoState>()(
  persist(
    (set) => ({
      ...initialServerInfo,

      setServerInfo: (info) =>
        set({
          ...info,
          lastFetchedAt: info.lastFetchedAt ?? Date.now(),
        }),

      setIgnoredArticles: (articles) => set({ ignoredArticles: articles }),

      clearServerInfo: () => set(initialServerInfo),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        serverType: state.serverType,
        serverVersion: state.serverVersion,
        apiVersion: state.apiVersion,
        openSubsonic: state.openSubsonic,
        extensions: state.extensions,
        lastFetchedAt: state.lastFetchedAt,
        adminRole: state.adminRole,
        shareRole: state.shareRole,
        ignoredArticles: state.ignoredArticles,
      }),
    }
  )
);
