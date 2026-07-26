import { create } from 'zustand';

/**
 * ICY now-playing metadata for the currently playing radio station.
 * Session-only (never persisted): the title is stale the moment the stream
 * moves on, so it is cleared whenever the station changes or playback of a
 * non-radio track starts. Written by icyMetadataService, read by the player
 * UI (LIVE row) and the station list.
 */
export interface RadioNowPlayingState {
  /** Stream-reported "StreamTitle" for the active station, or null. */
  title: string | null;
  /** Radio child id the title belongs to — guards against late poll results
   *  landing after the user switched stations. */
  trackId: string | null;
  setNowPlaying: (trackId: string, title: string | null) => void;
  clear: () => void;
}

export const radioNowPlayingStore = create<RadioNowPlayingState>()((set) => ({
  title: null,
  trackId: null,

  setNowPlaying: (trackId, title) => set({ trackId, title }),
  clear: () => set({ title: null, trackId: null }),
}));
