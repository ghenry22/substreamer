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
type FormatGroup = 'raw' | 'mp3' | 'aac' | 'opus' | 'ogg' | 'flac';

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

/**
 * Pitch-correction quality mode applied when playing at non-1x speed:
 * - none  → no pitch correction (pitch rises with speed / varispeed)
 * - voice → default built-in processor (iOS timeDomain / Android Sonic)
 * - music → high-quality music-grade time-stretch (iOS spectral / Android tbd)
 * NOTE: the backing audio-processing is not wired up yet — this stores the
 * user's choice; the player will honour it in a follow-up.
 */
export const PITCH_CORRECTION_MODES = ['none', 'voice', 'music'] as const;
export type PitchCorrection = (typeof PITCH_CORRECTION_MODES)[number];

/** Supported skip interval durations in seconds. */
export const SKIP_INTERVALS = [5, 10, 15, 30, 45, 60] as const;
export type SkipInterval = (typeof SKIP_INTERVALS)[number];

/** Whether lock screen / notification remote shows skip-track or skip-interval. */
export type RemoteControlMode = 'skip-track' | 'skip-interval';

/** Whether artist play/shuffle buttons use top songs or all songs across all albums. */
export type ArtistPlayMode = 'topSongs' | 'allSongs';

/** Track-count options for the RNQP lookahead cache (tracks prefetched ahead). */
export const LOOKAHEAD_COUNTS = [3, 5, 10, 20] as const;
export type LookaheadCount = (typeof LOOKAHEAD_COUNTS)[number];

/**
 * Percent-of-track milestones at which the playback-report scrobble may fire.
 * 25/50/75/90 map to RNQP `onPlaybackMilestone`; `100` is a sentinel for
 * "on completion only" (RNQP never emits a 100 milestone, so the exact-match
 * trigger never fires and only the always-on completion fallback scrobbles).
 */
export const SCROBBLE_MILESTONES = [25, 50, 75, 90, 100] as const;
export type ScrobbleTrigger = (typeof SCROBBLE_MILESTONES)[number];

/** Track-transition mode. Maps to RNQP `setPlaybackMode({ kind })`. */
export const PLAYBACK_MODES = ['gapless', 'crossfade'] as const;
export type PlaybackModeSetting = (typeof PLAYBACK_MODES)[number];

/**
 * Crossfade durations offered in the UI (ms) — a curated subset of RNQP's valid
 * 500 ms-quantised 1000–12000 range (`crossfadeDurationBounds`). Only read when
 * mode is `crossfade`.
 */
export const CROSSFADE_DURATIONS_MS = [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000] as const;
export type CrossfadeDurationMs = (typeof CROSSFADE_DURATIONS_MS)[number];

/**
 * ReplayGain loudness normalisation. Maps directly to RNQP `setReplayGainMode`:
 * 'off' (no normalisation, default), 'track' (even loudness across a shuffled
 * mix), 'album' (preserve an album's intentional dynamics — no track-gain
 * fallback for untagged tracks).
 */
export const REPLAY_GAIN_MODES = ['off', 'track', 'album'] as const;
export type ReplayGainModeSetting = (typeof REPLAY_GAIN_MODES)[number];

/**
 * Fixed on-disk budget for the lookahead cache, in MB. Set ONCE at startup (via
 * the RNQP `configure()` initial-cache-size option) and never resized at
 * runtime — so track count is the only utilization lever and behaviour is
 * identical on iOS + Android (avoids Media3's SimpleCache live-resize limit).
 * Generous enough that the largest (20-track) window never size-evicts; the
 * window is preferentially kept, so this is really a history-retention + disk cap.
 */
export const LOOKAHEAD_MAX_CACHE_MB = 512;

export interface PlaybackSettingsState {
  /** Maximum bitrate for streaming. null = no limit (server default). */
  maxBitRate: MaxBitRate;
  /** Stream format. 'raw' = original format, 'mp3' = transcode to MP3. */
  streamFormat: StreamFormat;
  /** Whether the server should estimate and set Content-Length headers. */
  estimateContentLength: boolean;
  /** Repeat mode for queue playback. */
  repeatMode: RepeatModeSetting;
  /** Append related tracks as the manual queue runs out. */
  autoplayEnabled: boolean;
  /** Playback speed multiplier (1 = normal). */
  playbackRate: PlaybackRate;
  /** Pitch-correction mode applied at non-1x speed (default 'none'). */
  pitchCorrection: PitchCorrection;

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

  /** Whether the RNQP lookahead cache is enabled (proactive prefetch of upcoming tracks). */
  lookaheadEnabled: boolean;
  /** How many upcoming tracks the lookahead cache proactively caches. */
  lookaheadCount: LookaheadCount;

  /** Percent of a track at which the playback-report scrobble fires (25/50/75/90);
   *  100 = report on completion only. Completion is always a fallback. */
  scrobbleTrigger: ScrobbleTrigger;

  /** Track-transition mode: gapless auto-advance or crossfade. */
  playbackMode: PlaybackModeSetting;
  /** Crossfade duration in ms (only applied when `playbackMode === 'crossfade'`). */
  crossfadeDurationMs: CrossfadeDurationMs;

  /** ReplayGain loudness normalisation: off / track / album. */
  replayGainMode: ReplayGainModeSetting;

  setMaxBitRate: (bitRate: MaxBitRate) => void;
  setStreamFormat: (format: StreamFormat) => void;
  setEstimateContentLength: (enabled: boolean) => void;
  setRepeatMode: (mode: RepeatModeSetting) => void;
  setAutoplayEnabled: (enabled: boolean) => void;
  setPlaybackRate: (rate: PlaybackRate) => void;
  setPitchCorrection: (mode: PitchCorrection) => void;
  setDownloadMaxBitRate: (bitRate: MaxBitRate) => void;
  setDownloadFormat: (format: StreamFormat) => void;
  setShowSkipIntervalButtons: (show: boolean) => void;
  setShowSleepTimerButton: (show: boolean) => void;
  setSkipBackwardInterval: (interval: SkipInterval) => void;
  setSkipForwardInterval: (interval: SkipInterval) => void;
  setRemoteControlMode: (mode: RemoteControlMode) => void;
  setArtistPlayMode: (mode: ArtistPlayMode) => void;
  setLookaheadEnabled: (enabled: boolean) => void;
  setLookaheadCount: (count: LookaheadCount) => void;
  setScrobbleTrigger: (trigger: ScrobbleTrigger) => void;
  setPlaybackMode: (mode: PlaybackModeSetting) => void;
  setCrossfadeDurationMs: (ms: CrossfadeDurationMs) => void;
  setReplayGainMode: (mode: ReplayGainModeSetting) => void;
}

const PERSIST_KEY = 'substreamer-playback-settings';

/**
 * v1 — one-time enable of the sleep-timer + skip-interval buttons, which shipped
 * behind off-by-default toggles. Flips them on once for everyone upgrading from
 * v0; whatever the user sets afterwards persists normally and is never
 * overwritten again.
 */
export function migratePlaybackSettings(persisted: any, version: number) {
  if (!persisted || typeof persisted !== 'object') return persisted;
  if (version === 0 || version === undefined) {
    return {
      ...persisted,
      showSkipIntervalButtons: true,
      showSleepTimerButton: true,
    };
  }
  return persisted;
}

export const playbackSettingsStore = create<PlaybackSettingsState>()(
  persist(
    (set) => ({
      maxBitRate: null,
      streamFormat: 'raw',
      estimateContentLength: Platform.OS === 'android',
      repeatMode: 'off',
      autoplayEnabled: false,
      playbackRate: 1,
      pitchCorrection: 'none',
      downloadMaxBitRate: 320,
      downloadFormat: 'mp3',
      showSkipIntervalButtons: true,
      showSleepTimerButton: true,
      skipBackwardInterval: 15,
      skipForwardInterval: 30,
      remoteControlMode: 'skip-track',
      artistPlayMode: 'topSongs',
      lookaheadEnabled: true,
      lookaheadCount: 3,
      scrobbleTrigger: 50,
      playbackMode: 'gapless',
      crossfadeDurationMs: 5000,
      replayGainMode: 'off',

      setMaxBitRate: (maxBitRate) => set({ maxBitRate }),
      setStreamFormat: (streamFormat) => set({ streamFormat: normalizeFormat(streamFormat) }),
      setEstimateContentLength: (estimateContentLength) => set({ estimateContentLength }),
      setRepeatMode: (repeatMode) => set({ repeatMode }),
      setAutoplayEnabled: (autoplayEnabled) => set({ autoplayEnabled }),
      setPlaybackRate: (playbackRate) => set({ playbackRate }),
      setPitchCorrection: (pitchCorrection) => set({ pitchCorrection }),
      setDownloadMaxBitRate: (downloadMaxBitRate) => set({ downloadMaxBitRate }),
      setDownloadFormat: (downloadFormat) => set({ downloadFormat: normalizeFormat(downloadFormat) }),
      setShowSkipIntervalButtons: (showSkipIntervalButtons) => set({ showSkipIntervalButtons }),
      setShowSleepTimerButton: (showSleepTimerButton) => set({ showSleepTimerButton }),
      setSkipBackwardInterval: (skipBackwardInterval) => set({ skipBackwardInterval }),
      setSkipForwardInterval: (skipForwardInterval) => set({ skipForwardInterval }),
      setRemoteControlMode: (remoteControlMode) => set({ remoteControlMode }),
      setArtistPlayMode: (artistPlayMode) => set({ artistPlayMode }),
      setLookaheadEnabled: (lookaheadEnabled) => set({ lookaheadEnabled }),
      setLookaheadCount: (lookaheadCount) => set({ lookaheadCount }),
      setScrobbleTrigger: (scrobbleTrigger) => set({ scrobbleTrigger }),
      setPlaybackMode: (playbackMode) => set({ playbackMode }),
      setCrossfadeDurationMs: (crossfadeDurationMs) => set({ crossfadeDurationMs }),
      setReplayGainMode: (replayGainMode) => set({ replayGainMode }),
    }),
    {
      name: PERSIST_KEY,
      version: 1,
      migrate: migratePlaybackSettings,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        maxBitRate: state.maxBitRate,
        streamFormat: state.streamFormat,
        estimateContentLength: state.estimateContentLength,
        repeatMode: state.repeatMode,
        autoplayEnabled: state.autoplayEnabled,
        playbackRate: state.playbackRate,
        pitchCorrection: state.pitchCorrection,
        downloadMaxBitRate: state.downloadMaxBitRate,
        downloadFormat: state.downloadFormat,
        showSkipIntervalButtons: state.showSkipIntervalButtons,
        showSleepTimerButton: state.showSleepTimerButton,
        skipBackwardInterval: state.skipBackwardInterval,
        skipForwardInterval: state.skipForwardInterval,
        remoteControlMode: state.remoteControlMode,
        artistPlayMode: state.artistPlayMode,
        lookaheadEnabled: state.lookaheadEnabled,
        lookaheadCount: state.lookaheadCount,
        scrobbleTrigger: state.scrobbleTrigger,
        playbackMode: state.playbackMode,
        crossfadeDurationMs: state.crossfadeDurationMs,
        replayGainMode: state.replayGainMode,
      }),
    }
  )
);
