import { create } from 'zustand';

export type BannerState = 'hidden' | 'unreachable' | 'reconnected';

export interface ConnectivityState {
  isInternetReachable: boolean;
  isServerReachable: boolean;
  isAirplaneMode: boolean;
  bannerState: BannerState;

  setInternetReachable: (reachable: boolean) => void;
  setServerReachable: (reachable: boolean) => void;
  setAirplaneMode: (enabled: boolean) => void;
  setBannerState: (state: BannerState) => void;
}

export const connectivityStore = create<ConnectivityState>()((set) => ({
  isInternetReachable: true,
  isServerReachable: true,
  isAirplaneMode: false,
  bannerState: 'hidden',

  setInternetReachable: (reachable) => set({ isInternetReachable: reachable }),
  setServerReachable: (reachable) => set({ isServerReachable: reachable }),
  setAirplaneMode: (enabled) => set({ isAirplaneMode: enabled }),
  setBannerState: (bannerState) => set({ bannerState }),
}));
