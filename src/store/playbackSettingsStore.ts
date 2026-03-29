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

/** Supported skip interval durations in seconds. */
export const SKIP_INTERVALS = [5, 10, 15, 30, 45, 60] as const;
export type SkipInterval = (typeof SKIP_INTERVALS)[number];

/** Whether lock screen / notification remote shows skip-track or skip-interval. */
export type RemoteControlMode = 'skip-track' | 'skip-interval';

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

  /** Maximum bitrate for offline downloads. */
  downloadMaxBitRate: MaxBitRate;
  /** Format for offline downloads. */
  downloadFormat: StreamFormat;

  /** Whether skip-interval buttons appear on the player view. */
  showSkipIntervalButtons: boolean;
  /** Backward skip interval in seconds. */
  skipBackwardInterval: SkipInterval;
  /** Forward skip interval in seconds. */
  skipForwardInterval: SkipInterval;
  /** What the lock screen / Control Center remote shows. */
  remoteControlMode: RemoteControlMode;

  setMaxBitRate: (bitRate: MaxBitRate) => void;
  setStreamFormat: (format: StreamFormat) => void;
  setEstimateContentLength: (enabled: boolean) => void;
  setRepeatMode: (mode: RepeatModeSetting) => void;
  setPlaybackRate: (rate: PlaybackRate) => void;
  setDownloadMaxBitRate: (bitRate: MaxBitRate) => void;
  setDownloadFormat: (format: StreamFormat) => void;
  setShowSkipIntervalButtons: (show: boolean) => void;
  setSkipBackwardInterval: (interval: SkipInterval) => void;
  setSkipForwardInterval: (interval: SkipInterval) => void;
  setRemoteControlMode: (mode: RemoteControlMode) => void;
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
      downloadMaxBitRate: 320,
      downloadFormat: 'mp3',
      showSkipIntervalButtons: false,
      skipBackwardInterval: 15,
      skipForwardInterval: 30,
      remoteControlMode: 'skip-track',

      setMaxBitRate: (maxBitRate) => set({ maxBitRate }),
      setStreamFormat: (streamFormat) => set({ streamFormat }),
      setEstimateContentLength: (estimateContentLength) => set({ estimateContentLength }),
      setRepeatMode: (repeatMode) => set({ repeatMode }),
      setPlaybackRate: (playbackRate) => set({ playbackRate }),
      setDownloadMaxBitRate: (downloadMaxBitRate) => set({ downloadMaxBitRate }),
      setDownloadFormat: (downloadFormat) => set({ downloadFormat }),
      setShowSkipIntervalButtons: (showSkipIntervalButtons) => set({ showSkipIntervalButtons }),
      setSkipBackwardInterval: (skipBackwardInterval) => set({ skipBackwardInterval }),
      setSkipForwardInterval: (skipForwardInterval) => set({ skipForwardInterval }),
      setRemoteControlMode: (remoteControlMode) => set({ remoteControlMode }),
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
        downloadMaxBitRate: state.downloadMaxBitRate,
        downloadFormat: state.downloadFormat,
        showSkipIntervalButtons: state.showSkipIntervalButtons,
        skipBackwardInterval: state.skipBackwardInterval,
        skipForwardInterval: state.skipForwardInterval,
        remoteControlMode: state.remoteControlMode,
      }),
    }
  )
);
