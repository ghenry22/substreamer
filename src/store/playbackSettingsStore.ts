import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';
import { type StreamFormat, type MaxBitRate } from '../types/audio';

export type { StreamFormat, MaxBitRate } from '../types/audio';

/**
 * Codec group identifier — presets sharing the same group are visually
 * grouped together in the picker (with separators between groups).
 * Variants within a group keep a consistent ordering: base codec → ReplayGain
 * variant → Car-mode variant.
 */
export type FormatGroup = 'raw' | 'mp3' | 'aac' | 'opus' | 'ogg' | 'flac';

/** A built-in format preset shown in the picker. */
export interface FormatPreset {
  /** Value sent to the server as `format=`. */
  value: StreamFormat;
  /** i18n key for the display label. */
  labelKey: string;
  /** Codec group — used for visual grouping in the picker. */
  group: FormatGroup;
  /**
   * HIGH default max bitrate substituted when the user has the bitrate
   * picker set to "no limit" (null). `null` = lossless / pass-through,
   * never send `maxBitRate` for this format.
   */
  highBitrate: MaxBitRate;
  /** Lossless / pass-through format — never send `maxBitRate`. */
  lossless: boolean;
}

/**
 * Built-in stream format presets, grouped by base codec with consistent
 * variant ordering (base → ReplayGain → Car mode). HIGH default bitrates
 * are applied when the user has the bitrate picker set to "no limit".
 * Custom-entered values (anything not in this list) are treated as lossy
 * and fall back to 320.
 */
export const FORMAT_PRESETS: FormatPreset[] = [
  { value: 'raw',      labelKey: 'formatOriginal',  group: 'raw',  highBitrate: null, lossless: true  },
  { value: 'mp3',      labelKey: 'formatMp3',       group: 'mp3',  highBitrate: 320, lossless: false },
  { value: 'mp3_rg',   labelKey: 'formatMp3Rg',     group: 'mp3',  highBitrate: 320, lossless: false },
  { value: 'mp3_car',  labelKey: 'formatMp3Car',    group: 'mp3',  highBitrate: 320, lossless: false },
  { value: 'aac',      labelKey: 'formatAac',       group: 'aac',  highBitrate: 320, lossless: false },
  { value: 'm4a',      labelKey: 'formatM4a',       group: 'aac',  highBitrate: 320, lossless: false },
  { value: 'opus',     labelKey: 'formatOpus',      group: 'opus', highBitrate: 320, lossless: false },
  { value: 'opus_rg',  labelKey: 'formatOpusRg',    group: 'opus', highBitrate: 320, lossless: false },
  { value: 'opus_car', labelKey: 'formatOpusCar',   group: 'opus', highBitrate: 192, lossless: false },
  { value: 'ogg',      labelKey: 'formatOggVorbis', group: 'ogg',  highBitrate: 320, lossless: false },
  { value: 'flac',     labelKey: 'formatFlac',      group: 'flac', highBitrate: null, lossless: true  },
];

/** Normalize a user-entered or selected format value. */
function normalizeFormat(value: StreamFormat): StreamFormat {
  return value === 'raw' ? 'raw' : value.trim().toLowerCase();
}

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

/** Whether artist play/shuffle buttons use top songs or all songs across all albums. */
export type ArtistPlayMode = 'topSongs' | 'allSongs';

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
  /** Whether the sleep timer button appears on the player view. */
  showSleepTimerButton: boolean;
  /** Backward skip interval in seconds. */
  skipBackwardInterval: SkipInterval;
  /** Forward skip interval in seconds. */
  skipForwardInterval: SkipInterval;
  /** What the lock screen / Control Center remote shows. */
  remoteControlMode: RemoteControlMode;
  /** Whether artist play/shuffle uses top songs or all songs. */
  artistPlayMode: ArtistPlayMode;

  setMaxBitRate: (bitRate: MaxBitRate) => void;
  setStreamFormat: (format: StreamFormat) => void;
  setEstimateContentLength: (enabled: boolean) => void;
  setRepeatMode: (mode: RepeatModeSetting) => void;
  setPlaybackRate: (rate: PlaybackRate) => void;
  setDownloadMaxBitRate: (bitRate: MaxBitRate) => void;
  setDownloadFormat: (format: StreamFormat) => void;
  setShowSkipIntervalButtons: (show: boolean) => void;
  setShowSleepTimerButton: (show: boolean) => void;
  setSkipBackwardInterval: (interval: SkipInterval) => void;
  setSkipForwardInterval: (interval: SkipInterval) => void;
  setRemoteControlMode: (mode: RemoteControlMode) => void;
  setArtistPlayMode: (mode: ArtistPlayMode) => void;
}

const PERSIST_KEY = 'substreamer-playback-settings';

export const playbackSettingsStore = create<PlaybackSettingsState>()(
  persist(
    (set) => ({
      maxBitRate: null,
      streamFormat: 'raw',
      estimateContentLength: Platform.OS === 'android',
      repeatMode: 'off',
      playbackRate: 1,
      downloadMaxBitRate: 320,
      downloadFormat: 'mp3',
      showSkipIntervalButtons: false,
      showSleepTimerButton: false,
      skipBackwardInterval: 15,
      skipForwardInterval: 30,
      remoteControlMode: 'skip-track',
      artistPlayMode: 'topSongs',

      setMaxBitRate: (maxBitRate) => set({ maxBitRate }),
      setStreamFormat: (streamFormat) => set({ streamFormat: normalizeFormat(streamFormat) }),
      setEstimateContentLength: (estimateContentLength) => set({ estimateContentLength }),
      setRepeatMode: (repeatMode) => set({ repeatMode }),
      setPlaybackRate: (playbackRate) => set({ playbackRate }),
      setDownloadMaxBitRate: (downloadMaxBitRate) => set({ downloadMaxBitRate }),
      setDownloadFormat: (downloadFormat) => set({ downloadFormat: normalizeFormat(downloadFormat) }),
      setShowSkipIntervalButtons: (showSkipIntervalButtons) => set({ showSkipIntervalButtons }),
      setShowSleepTimerButton: (showSleepTimerButton) => set({ showSleepTimerButton }),
      setSkipBackwardInterval: (skipBackwardInterval) => set({ skipBackwardInterval }),
      setSkipForwardInterval: (skipForwardInterval) => set({ skipForwardInterval }),
      setRemoteControlMode: (remoteControlMode) => set({ remoteControlMode }),
      setArtistPlayMode: (artistPlayMode) => set({ artistPlayMode }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        maxBitRate: state.maxBitRate,
        streamFormat: state.streamFormat,
        estimateContentLength: state.estimateContentLength,
        repeatMode: state.repeatMode,
        playbackRate: state.playbackRate,
        downloadMaxBitRate: state.downloadMaxBitRate,
        downloadFormat: state.downloadFormat,
        showSkipIntervalButtons: state.showSkipIntervalButtons,
        showSleepTimerButton: state.showSleepTimerButton,
        skipBackwardInterval: state.skipBackwardInterval,
        skipForwardInterval: state.skipForwardInterval,
        remoteControlMode: state.remoteControlMode,
        artistPlayMode: state.artistPlayMode,
      }),
    }
  )
);
