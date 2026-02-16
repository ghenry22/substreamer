import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

export type StreamFormat = 'raw' | 'mp3';
export type MaxBitRate = 64 | 128 | 256 | 320 | null;

/** Repeat mode: off → repeat queue → repeat single track. */
export type RepeatModeSetting = 'off' | 'all' | 'one';

/** Supported playback speed multipliers. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export interface PlaybackSettingsState {
  /** Maximum bitrate for streaming. null = no limit (server default). */
  maxBitRate: MaxBitRate;
  /** Stream format. 'raw' = original format, 'mp3' = transcode to MP3. */
  streamFormat: StreamFormat;
  /** Whether the server should estimate and set Content-Length headers. */
  estimateContentLength: boolean;
  /** Repeat mode for queue playback. */
  repeatMode: RepeatModeSetting;
  /** Playback speed multiplier (1 = normal). */
  playbackRate: PlaybackRate;

  setMaxBitRate: (bitRate: MaxBitRate) => void;
  setStreamFormat: (format: StreamFormat) => void;
  setEstimateContentLength: (enabled: boolean) => void;
  setRepeatMode: (mode: RepeatModeSetting) => void;
  setPlaybackRate: (rate: PlaybackRate) => void;
}

const PERSIST_KEY = 'substreamer-playback-settings';

export const playbackSettingsStore = create<PlaybackSettingsState>()(
  persist(
    (set) => ({
      maxBitRate: null,
      streamFormat: 'raw',
      estimateContentLength: false,
      repeatMode: 'off',
      playbackRate: 1,

      setMaxBitRate: (maxBitRate) => set({ maxBitRate }),
      setStreamFormat: (streamFormat) => set({ streamFormat }),
      setEstimateContentLength: (estimateContentLength) => set({ estimateContentLength }),
      setRepeatMode: (repeatMode) => set({ repeatMode }),
      setPlaybackRate: (playbackRate) => set({ playbackRate }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        maxBitRate: state.maxBitRate,
        streamFormat: state.streamFormat,
        estimateContentLength: state.estimateContentLength,
        repeatMode: state.repeatMode,
        playbackRate: state.playbackRate,
      }),
    }
  )
);
