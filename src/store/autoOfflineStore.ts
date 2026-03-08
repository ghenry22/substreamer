import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

type AutoOfflineMode = 'home-wifi' | 'wifi-only';

interface AutoOfflineState {
  enabled: boolean;
  mode: AutoOfflineMode;
  homeSSIDs: string[];
  locationPermissionGranted: boolean;

  setEnabled: (enabled: boolean) => void;
  setMode: (mode: AutoOfflineMode) => void;
  addSSID: (ssid: string) => void;
  removeSSID: (ssid: string) => void;
  updateSSID: (oldSsid: string, newSsid: string) => void;
  setLocationPermissionGranted: (granted: boolean) => void;
}

export const autoOfflineStore = create<AutoOfflineState>()(
  persist(
    (set) => ({
      enabled: false,
      mode: 'wifi-only',
      homeSSIDs: [],
      locationPermissionGranted: false,

      setEnabled: (enabled) => set({ enabled }),
      setMode: (mode) => set({ mode }),
      addSSID: (ssid) =>
        set((s) => {
          if (s.homeSSIDs.includes(ssid)) return s;
          return { homeSSIDs: [...s.homeSSIDs, ssid] };
        }),
      removeSSID: (ssid) =>
        set((s) => ({ homeSSIDs: s.homeSSIDs.filter((s2) => s2 !== ssid) })),
      updateSSID: (oldSsid, newSsid) =>
        set((s) => ({
          homeSSIDs: s.homeSSIDs.map((s2) => (s2 === oldSsid ? newSsid : s2)),
        })),
      setLocationPermissionGranted: (granted) =>
        set({ locationPermissionGranted: granted }),
    }),
    {
      name: 'substreamer-auto-offline',
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        mode: state.mode,
        homeSSIDs: state.homeSSIDs,
        locationPermissionGranted: state.locationPermissionGranted,
      }),
    }
  )
);

export { type AutoOfflineMode };
