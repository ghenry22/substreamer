import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence/kvStorage';

import { getInternetRadioStations, type InternetRadioStation } from '../services/subsonicService';

export interface RadioState {
  stations: InternetRadioStation[];
  loading: boolean;
  /** True once a fetch has completed (success or failure) this session. */
  loaded: boolean;
  fetchStations: () => Promise<void>;
}

const PERSIST_KEY = 'substreamer-radio';

export const radioStore = create<RadioState>()(
  persist(
    (set) => ({
      stations: [],
      loading: false,
      loaded: false,

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
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        stations: state.stations,
      }),
    }
  )
);
