import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  deleteShare as apiDeleteShare,
  getShares,
  type Share,
} from '../services/subsonicService';
import { kvStorage } from './persistence';

interface SharesState {
  shares: Share[];
  loading: boolean;
  error: string | null;
  /** True when the server reports sharing is not available/authorized */
  notAvailable: boolean;

  fetchShares: () => Promise<void>;
  removeShare: (id: string) => Promise<boolean>;
  clear: () => void;
}

export const sharesStore = create<SharesState>()(
  persist(
    (set, get) => ({
      shares: [],
      loading: false,
      error: null,
      notAvailable: false,

      fetchShares: async () => {
        set({ loading: true, error: null, notAvailable: false });
        const result = await getShares();
        if (result.ok) {
          set({ shares: result.shares ?? [], loading: false });
        } else if (result.reason === 'not-available') {
          set({ shares: [], loading: false, notAvailable: true, error: result.message });
        } else {
          set({ loading: false, error: result.message });
        }
      },

      removeShare: async (id: string) => {
        const success = await apiDeleteShare(id);
        if (success) {
          set({ shares: get().shares.filter((s) => s.id !== id) });
        }
        return success;
      },

      clear: () => set({ shares: [], loading: false, error: null, notAvailable: false }),
    }),
    {
      name: 'substreamer-shares',
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({ shares: state.shares }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SharesState>),
        /* Guard against corrupted persisted data where shares is not an array */
        shares: Array.isArray((persisted as Partial<SharesState>)?.shares)
          ? (persisted as Partial<SharesState>).shares!
          : [],
      }),
    },
  ),
);
