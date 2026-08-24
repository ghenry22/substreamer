/**
 * In-memory Zustand store for playback state.
 *
 * Updated by playerService event listeners so the UI stays in sync
 * with the native audio player, including across background/foreground
 * transitions.
 */

import { create } from 'zustand';
import type { TrackSource } from 'react-native-queue-player';

import { type EffectiveFormat } from '../types/audio';
import type { Child } from '../services/subsonicService';
import type { QueueTrackOrigin } from '../types/queue';

export type PlaybackStatus =
  | 'idle'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'loading'
  | 'stopped';

export interface PlayerState {
  /** The currently active track, or null when nothing is loaded. */
  currentTrack: Child | null;
  /** Index of the currently active track in the queue, or null when nothing is loaded. */
  currentTrackIndex: number | null;
  /** High-level playback state. */
  playbackState: PlaybackStatus;
  /** The full queue of Child objects currently loaded. */
  queue: Child[];
  /** Positional ownership aligned with `queue`. */
  queueOrigins: QueueTrackOrigin[];
  /** Whether a recommendation batch is currently being prepared. */
  autoplayLoading: boolean;
  /** Current playback position in seconds. */
  position: number;
  /** Duration of the current track in seconds. */
  duration: number;
  /** Absolute buffered edge from the start of the track, in seconds. */
  bufferedPosition: number;
  /** Last playback error message, or null when healthy. */
  error: string | null;
  /** Whether the player is currently auto-retrying after an error. */
  retrying: boolean;
  /** True while `playTrack()` is loading the queue and skipping to the start index. */
  queueLoading: boolean;
  /** Effective post-transcode format for each track in the current queue, keyed by song ID. */
  queueFormats: Record<string, EffectiveFormat>;
  /** Where the active track is playing from: local file, lookahead cache, or live stream. */
  trackSource: TrackSource | null;

  /* ---- Setters (called by playerService) ---- */
  setCurrentTrack: (track: Child | null, index?: number | null) => void;
  setPlaybackState: (state: PlaybackStatus) => void;
  setQueue: (queue: Child[], origins?: QueueTrackOrigin[]) => void;
  setAutoplayLoading: (loading: boolean) => void;
  setProgress: (position: number, duration: number, buffered: number) => void;
  setError: (error: string | null) => void;
  setRetrying: (retrying: boolean) => void;
  setQueueLoading: (loading: boolean) => void;
  setQueueFormats: (formats: Record<string, EffectiveFormat>) => void;
  addQueueFormat: (songId: string, fmt: EffectiveFormat) => void;
  clearQueueFormats: () => void;
  setTrackSource: (source: TrackSource | null) => void;
}

export const playerStore = create<PlayerState>()((set) => ({
  currentTrack: null,
  currentTrackIndex: null,
  playbackState: 'idle',
  queue: [],
  queueOrigins: [],
  autoplayLoading: false,
  position: 0,
  duration: 0,
  bufferedPosition: 0,
  error: null,
  retrying: false,
  queueLoading: false,
  queueFormats: {},
  trackSource: null,

  setCurrentTrack: (track, index) =>
    set({
      currentTrack: track,
      currentTrackIndex: index ?? null,
      ...(track ? {} : { trackSource: null }),
    }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setQueue: (queue, origins) =>
    set({
      queue,
      queueOrigins: origins?.length === queue.length ? origins : queue.map(() => 'manual'),
    }),
  setAutoplayLoading: (autoplayLoading) => set({ autoplayLoading }),
  setProgress: (position, duration, buffered) =>
    set((state) => ({
      position,
      duration: duration > 0 ? duration : (state.currentTrack?.duration ?? 0),
      bufferedPosition: buffered,
    })),
  setError: (error) => set({ error }),
  setRetrying: (retrying) => set({ retrying }),
  setQueueLoading: (loading) => set({ queueLoading: loading }),
  setQueueFormats: (queueFormats) => set({ queueFormats }),
  addQueueFormat: (songId, fmt) =>
    set((state) => ({ queueFormats: { ...state.queueFormats, [songId]: fmt } })),
  clearQueueFormats: () => set({ queueFormats: {} }),
  setTrackSource: (trackSource) => set({ trackSource }),
}));
