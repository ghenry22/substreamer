import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

interface BatteryOptimizationState {
  /** Whether battery optimization is active (app IS restricted). null = not yet checked. */
  restricted: boolean | null;

  setRestricted: (restricted: boolean) => void;
}

export const batteryOptimizationStore = create<BatteryOptimizationState>()(
  persist(
    (set) => ({
      restricted: null,

      setRestricted: (restricted) => set({ restricted }),
    }),
    {
      name: 'substreamer-battery-optimization',
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({ restricted: state.restricted }),
    }
  )
);
