import { create } from 'zustand';

interface MbidSearchState {
  visible: boolean;
  artistId: string | null;
  artistName: string | null;
  /** Currently assigned MBID to highlight in search results */
  currentMbid: string | null;

  show: (artistId: string, artistName: string, currentMbid: string | null) => void;
  hide: () => void;
}

export const mbidSearchStore = create<MbidSearchState>()((set) => ({
  visible: false,
  artistId: null,
  artistName: null,
  currentMbid: null,

  show: (artistId, artistName, currentMbid) =>
    set({ visible: true, artistId, artistName, currentMbid }),
  hide: () =>
    set({ visible: false, artistId: null, artistName: null, currentMbid: null }),
}));
