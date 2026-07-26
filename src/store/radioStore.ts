import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence/kvStorage';

import { getInternetRadioStations, type InternetRadioStation } from '../services/subsonicService';

export interface RadioState {
  stations: InternetRadioStation[];
  loading: boolean;
  /** True once a fetch has completed (success or failure) this session. */
  loaded: boolean;
  /** Station id (server id, not the prefixed child id) last played — drives
   *  the "continue listening" card on Home. */
  lastPlayedStationId: string | null;
  /** Locally pinned station ids — the Subsonic API has no star for radio
   *  stations, so favorites live only on this device. */
  favoriteStationIds: string[];
  fetchStations: () => Promise<void>;
  setLastPlayed: (stationId: string) => void;
  toggleFavorite: (stationId: string) => void;
}

const PERSIST_KEY = 'substreamer-radio';

export const radioStore = create<RadioState>()(
  persist(
    (set, get) => ({
      stations: [],
      loading: false,
      loaded: false,
      lastPlayedStationId: null,
      favoriteStationIds: [],

      fetchStations: async () => {
        set({ loading: true });
        const stations = await getInternetRadioStations();
        // null = offline / request failed — keep the persisted list.
        if (stations) {
          set({ stations, loading: false, loaded: true });
        } else {
          set({ loading: false, loaded: true });
        }
      },

      setLastPlayed: (stationId) => {
        if (get().lastPlayedStationId !== stationId) {
          set({ lastPlayedStationId: stationId });
        }
      },

      toggleFavorite: (stationId) => {
        const current = get().favoriteStationIds;
        set({
          favoriteStationIds: current.includes(stationId)
            ? current.filter((id) => id !== stationId)
            : [...current, stationId],
        });
      },
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        stations: state.stations,
        lastPlayedStationId: state.lastPlayedStationId,
        favoriteStationIds: state.favoriteStationIds,
      }),
    }
  )
);
