import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

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
}

export interface ServerInfoState extends ServerInfo {
  setServerInfo: (info: ServerInfo) => void;
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

      clearServerInfo: () => set(initialServerInfo),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        serverType: state.serverType,
        serverVersion: state.serverVersion,
        apiVersion: state.apiVersion,
        openSubsonic: state.openSubsonic,
        extensions: state.extensions,
        lastFetchedAt: state.lastFetchedAt,
        adminRole: state.adminRole,
        shareRole: state.shareRole,
      }),
    }
  )
);
