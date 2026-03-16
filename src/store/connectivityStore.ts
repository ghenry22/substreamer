import { create } from 'zustand';

export type BannerState = 'hidden' | 'unreachable' | 'reconnected' | 'ssl-error';

export interface ConnectivityState {
  isInternetReachable: boolean;
  isServerReachable: boolean;
  bannerState: BannerState;

  setInternetReachable: (reachable: boolean) => void;
  setServerReachable: (reachable: boolean) => void;
  setBannerState: (state: BannerState) => void;
}

export const connectivityStore = create<ConnectivityState>()((set) => ({
  isInternetReachable: true,
  isServerReachable: true,
  bannerState: 'hidden',

  setInternetReachable: (reachable) => set({ isInternetReachable: reachable }),
  setServerReachable: (reachable) => set({ isServerReachable: reachable }),
  setBannerState: (bannerState) => set({ bannerState }),
}));
