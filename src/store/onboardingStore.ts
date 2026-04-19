import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

interface OnboardingState {
  /** Whether the user has completed (or skipped) the onboarding guide. Persisted. */
  hasCompleted: boolean;
  /** Whether the onboarding modal is currently visible. Transient. */
  visible: boolean;
  /** Show the onboarding guide. */
  show: () => void;
  /** Dismiss the guide and mark as completed so it won't auto-show again. */
  dismiss: () => void;
  /** Reset completion flag so the guide can be replayed from settings. */
  reset: () => void;
}

export const onboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      hasCompleted: false,
      visible: false,
      show: () => set({ visible: true }),
      dismiss: () => set({ hasCompleted: true, visible: false }),
      reset: () => set({ hasCompleted: false }),
    }),
    {
      name: 'substreamer-onboarding',
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({ hasCompleted: state.hasCompleted }),
    }
  )
);
