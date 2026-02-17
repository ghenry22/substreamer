/**
 * In-memory Zustand store for playback state.
 *
 * Updated by playerService event listeners so the UI stays in sync
 * with the native audio player, including across background/foreground
 * transitions.
 */

import { create } from 'zustand';

import type { Child } from '../services/subsonicService';

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
  /** Current playback position in seconds. */
  position: number;
  /** Duration of the current track in seconds. */
  duration: number;
  /** How far ahead the player has buffered, in seconds. */
  bufferedPosition: number;
  /** Last playback error message, or null when healthy. */
  error: string | null;
  /** Whether the player is currently auto-retrying after an error. */
  retrying: boolean;
  /** True while `playTrack()` is loading the queue and skipping to the start index. */
  queueLoading: boolean;

  /* ---- Setters (called by playerService) ---- */
  setCurrentTrack: (track: Child | null, index?: number | null) => void;
  setPlaybackState: (state: PlaybackStatus) => void;
  setQueue: (queue: Child[]) => void;
  setProgress: (position: number, duration: number, buffered: number) => void;
  setError: (error: string | null) => void;
  setRetrying: (retrying: boolean) => void;
  setQueueLoading: (loading: boolean) => void;
}

export const playerStore = create<PlayerState>()((set) => ({
  currentTrack: null,
  currentTrackIndex: null,
  playbackState: 'idle',
  queue: [],
  position: 0,
  duration: 0,
  bufferedPosition: 0,
  error: null,
  retrying: false,
  queueLoading: false,

  setCurrentTrack: (track, index) => set({ currentTrack: track, currentTrackIndex: index ?? null }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setQueue: (queue) => set({ queue }),
  setProgress: (position, duration, buffered) =>
    set((state) => ({
      position,
      duration: duration > 0 ? duration : (state.currentTrack?.duration ?? 0),
      bufferedPosition: buffered,
    })),
  setError: (error) => set({ error }),
  setRetrying: (retrying) => set({ retrying }),
  setQueueLoading: (loading) => set({ queueLoading: loading }),
}));
