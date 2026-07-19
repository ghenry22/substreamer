/**
 * Player service — drives the RNQP (react-native-queue-player) engine, manages
 * the queue, and keeps the Zustand playerStore in sync with native events.
 *
 * The engine itself is configured once at module load in `playerBootstrap.ts`
 * (per the RNQP setup guide — configure() must run before the UI mounts, so
 * cold-start system wakes find the player ready). This module attaches the
 * event listeners, applies persisted settings + remote controls, and exposes
 * the public queue/transport API used across the app.
 */

import { AppState, Platform } from 'react-native';
import i18n from '../i18n/i18n';
import { getTrackPlayer, getEqualizer } from 'react-native-queue-player';

import { type EffectiveFormat } from '../types/audio';
import {
  playbackSettingsStore,
  type PitchCorrection,
  type PlaybackRate,
  type RepeatModeSetting,
} from '../store/playbackSettingsStore';
import { backgroundPlaybackPromptStore } from '../store/backgroundPlaybackPromptStore';
import { playbackToastStore } from '../store/playbackToastStore';
import { playerStore } from '../store/playerStore';
import { appStateStore } from '../store/appStateStore';
import { equalizerSettingsStore, EQ_CUSTOM_PRESET_LABEL } from '../store/equalizerSettingsStore';
import { sleepTimerStore } from '../store/sleepTimerStore';
import { shuffleArray } from '../utils/arrayHelpers';
import { addCompletedScrobble, sendNowPlaying } from './scrobbleService';
import { registerPlayerPlayStatListener } from './playStatsService';
import { syncProxyUpstreams } from './sslTrustService';
import { getLocalTrackUri, waitForTrackMapsReady } from './musicCacheService';
import {
  persistQueue,
  persistPositionIfDue,
  flushPosition,
  clearPersistedQueue,
  getPersistedQueue,
  getPersistedPosition,
} from './queuePersistenceService';
import {
  ensureCoverArtAuth,
  isRadioChild,
  radioStationIdFromChildId,
  type Child,
} from './subsonicService';
import {
  radioReconnectDelayMs,
  shouldRadioReconnect,
} from './radioReconnect';
import { radioStore } from '../store/radioStore';
import { radioNowPlayingStore } from '../store/radioNowPlayingStore';
import { startIcyPolling, stopIcyPolling } from './icyMetadataService';
import {
  buildPlayableQueue,
  mapRepeatMode,
  mapState,
  stampQueueFormat,
} from './playerHelpers';
import { isFireOS } from '../utils/isFireOS';

/** The RNQP player singleton. Safe to hold — `getTrackPlayer()` always returns
 *  the same instance; the engine is configured in `playerBootstrap.ts`. */
const tp = getTrackPlayer();

/** The RNQP equalizer singleton. */
const eq = getEqualizer();

/**
 * One-time Fire-OS background-playback guidance. Fired the first time the user
 * starts playback on a Fire tablet. Non-blocking — it only flips store state.
 * No-op off Fire OS and after it has been shown once.
 */
function maybePromptFireBackgroundPlayback(): void {
  if (!isFireOS()) return;
  if (backgroundPlaybackPromptStore.getState().seen) return;
  backgroundPlaybackPromptStore.getState().markSeenAndShow();
}

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let isPlayerReady = false;
/** The Child[] backing the current native queue, indexed by position. */
let currentChildQueue: Child[] = [];
/** Maps trackId → playlistId for tracks that originated from a playlist. */
const trackPlaylistMap = new Map<string, string>();
/**
 * In-flight promise for an async queue-rehydration after a cold-start restore.
 * Public entry points await this before touching the native queue so a user
 * tap can't race the (async prerequisite + setQueue) restore. Null when no
 * hydration is pending.
 */
let hydrationPromise: Promise<void> | null = null;
/** Pending resume position from a persisted-queue restore, consumed by hydrate. */
let pendingResumePosition: { trackId: string; position: number } | null = null;

/* --- Playback-report scrobble guard: exactly one report per playthrough.
 * `activeScrobbleIndex` = the track whose current play the guard tracks;
 * `activeScrobbleDone` flips once the configured milestone OR the completion
 * fallback has reported it; `lastMilestoneValue` detects a repeat-one loop
 * (milestone value wraps 90→25) so the loop starts a fresh playthrough. --- */
let activeScrobbleIndex: number | null = null;
let activeScrobbleDone = false;
let lastMilestoneValue = 0;

/* --- Radio auto-reconnect: consecutive failed reconnects for the current
 * radio track. Reset when playback recovers or the track changes. --- */
let radioReconnectAttempt = 0;
let radioReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function cancelRadioReconnect(): void {
  if (radioReconnectTimer) {
    clearTimeout(radioReconnectTimer);
    radioReconnectTimer = null;
  }
}

/** Report a completed play once per playthrough, guarded by `activeScrobbleDone`. */
function reportPlay(trackIndex: number): void {
  if (activeScrobbleDone) return;
  activeScrobbleDone = true;
  const child = currentChildQueue[trackIndex];
  if (child) addCompletedScrobble(child, trackPlaylistMap.get(child.id));
}

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

/**
 * Apply persisted settings + remote controls and attach the RNQP event
 * listeners that push native state into the Zustand store. The engine is
 * already configured by `playerBootstrap.ts`. Idempotent — safe to call from
 * both the UI boot AND the headless CarPlay/Siri boot.
 */
export async function initPlayer(): Promise<void> {
  if (isPlayerReady) return;
  isPlayerReady = true;

  // Lock-screen / notification skip buttons (track vs interval) from settings.
  await updateRemoteCapabilities();

  // Apply persisted playback settings.
  const settings = playbackSettingsStore.getState();
  await tp.setRepeatMode(mapRepeatMode(settings.repeatMode));
  await tp.setPlaybackSpeed(settings.playbackRate);
  // Pitch correction (only effective at rate != 1x). RNQP defaults to 'voice',
  // so the persisted mode must be pushed explicitly (our default is 'none').
  await tp.setPitchCorrectionMode(settings.pitchCorrection);

  // Lookahead cache: enable + track count from settings (fixed max is set at
  // configure()). Runtime-settable via applyLookaheadCacheConfig().
  await applyLookaheadCacheConfig();

  // Gapless / crossfade track transitions.
  await applyPlaybackMode();

  // Equalizer: RNQP's native EQ doesn't restore active state across restarts,
  // so re-apply the persisted enabled flag + band gains.
  await applyEqualizerConfig();

  // ReplayGain loudness normalisation (off / track / album) — also not restored
  // natively across restarts, so re-apply the persisted choice.
  await applyReplayGain();

  // --- Playback state → store ---
  tp.onStateChange((state) => {
    const store = playerStore.getState();
    store.setPlaybackState(mapState(state));
    if (state === 'playing') {
      if (store.error) store.setError(null);
      if (store.retrying) store.setRetrying(false);
      // Playback recovered — a future radio drop starts a fresh backoff ladder.
      radioReconnectAttempt = 0;
    }
  });

  // --- Progress → store. Foreground 500ms; near-paused (10s) while backgrounded
  // — the background throttle is handled natively via configure(
  // backgroundProgressUpdateIntervalMs), which re-emits immediately on
  // foreground, so no app-side gating of the store write is needed here. ---
  tp.onProgress(({ position, duration, buffered }) => {
    // RNQP `buffered` is seconds buffered AHEAD of `position`; the store +
    // progress bar want the absolute buffered edge from the start of the track.
    playerStore.getState().setProgress(position, duration, position + buffered);
    const currentTrack = playerStore.getState().currentTrack;
    if (currentTrack?.id && position > 0) {
      persistPositionIfDue(position, currentTrack.id, currentTrack.duration);
    }
  });

  // --- Active-track change → store + now-playing scrobble + persist ---
  tp.onTrackChange((track, index, reason) => {
    // Completion fallback: a natural auto-advance means the OUTGOING track
    // finished — report it if the configured milestone was missed (e.g. a seek
    // skipped it). User skips / queue replacement are NOT completion.
    if (reason === 'auto-advance' && activeScrobbleIndex != null) {
      reportPlay(activeScrobbleIndex);
    }
    if (track?.id) {
      const child = currentChildQueue.find((c) => c.id === track.id) ?? null;
      playerStore.getState().setCurrentTrack(child, index ?? null);
      if (child) sendNowPlaying(child, trackPlaylistMap.get(child.id));
      if (index != null && index >= 0) persistQueue(currentChildQueue, index);
    } else {
      playerStore.getState().setCurrentTrack(null, null);
    }
    // Radio bookkeeping: a station change resets the reconnect ladder and the
    // ICY now-playing side-channel; leaving radio stops both.
    cancelRadioReconnect();
    radioReconnectAttempt = 0;
    const newTrack = playerStore.getState().currentTrack;
    if (newTrack && isRadioChild(newTrack)) {
      radioStore.getState().setLastPlayed(radioStationIdFromChildId(newTrack.id));
      startIcyPolling(newTrack.id, newTrack.radioStreamUrl);
    } else {
      stopIcyPolling();
      radioNowPlayingStore.getState().clear();
    }
    // Start a fresh playthrough for the incoming track.
    activeScrobbleIndex = index != null && index >= 0 ? index : null;
    activeScrobbleDone = false;
    lastMilestoneValue = 0;
    refreshTrackSource();
  });

  // --- Playback source (local / cached / streaming) → store. No dedicated
  // event, so re-read on the signals that can flip it: a streaming track
  // becomes 'cached' once the lookahead cache holds it / it fully buffers. ---
  tp.onCacheStatusChange(() => refreshTrackSource());
  tp.onFullyBufferedChange(() => refreshTrackSource());

  // --- Playback-report scrobble at the user-configured milestone (25/50/75/90;
  // 100 = on-completion only, which never matches a milestone so only the
  // completion fallback fires). Exact match; the completion fallback in
  // onTrackChange/onQueueEnd catches a milestone skipped by a seek. ---
  tp.onPlaybackMilestone((milestone, trackIndex) => {
    // New track, or a repeat-one loop (milestone value wraps down) → fresh play.
    if (trackIndex !== activeScrobbleIndex || milestone < lastMilestoneValue) {
      activeScrobbleIndex = trackIndex;
      activeScrobbleDone = false;
    }
    lastMilestoneValue = milestone;
    if (milestone === playbackSettingsStore.getState().scrobbleTrigger) {
      reportPlay(trackIndex);
    }
  });

  // --- Errors. Transient errors are auto-retried natively; surface the error
  // so the UI can offer a manual "Retry" (→ tp.retry()). Live radio drops are
  // routine (stream hiccup, network hand-off), so those reconnect automatically
  // with backoff before falling back to the manual Retry. ---
  tp.onError((error) => {
    const store = playerStore.getState();
    store.setError(error.message ?? i18n.t('playbackErrorOccurred'));
    const track = store.currentTrack;
    if (track && isRadioChild(track) && shouldRadioReconnect(radioReconnectAttempt)) {
      const attempt = radioReconnectAttempt++;
      store.setRetrying(true);
      const expectedId = track.id;
      cancelRadioReconnect();
      radioReconnectTimer = setTimeout(() => {
        radioReconnectTimer = null;
        // Only reconnect if the user is still on the same station.
        if (playerStore.getState().currentTrack?.id === expectedId) {
          tp.retry();
        } else {
          playerStore.getState().setRetrying(false);
        }
      }, radioReconnectDelayMs(attempt));
      return;
    }
    store.setRetrying(false);
  });

  // --- Queue end: report the final track's play (completion fallback) if the
  // milestone was missed, then pin progress to 100% so the bar completes. ---
  tp.onQueueEnd(() => {
    if (activeScrobbleIndex != null) reportPlay(activeScrobbleIndex);
    const currentTrack = playerStore.getState().currentTrack;
    const endDuration = currentTrack?.duration ?? 0;
    if (endDuration > 0) {
      playerStore.getState().setProgress(endDuration, endDuration, endDuration);
    }
  });

  // --- Sleep timer → store. RNQP emits only on arm/clear/convert/fire, so a
  // 1s interval recomputes the display countdown from the wall-clock deadline
  // (the UI reads sleepTimerStore.remaining). The native timer fires the actual
  // pause; this interval is display-only, so it's paused while backgrounded (the
  // capsule is invisible) and resumed on foreground. ---
  let sleepTimerInterval: ReturnType<typeof setInterval> | null = null;
  const stopSleepCountdown = () => {
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
  };
  const startSleepCountdown = (endTimeSec: number) => {
    stopSleepCountdown();
    const tick = () => {
      const remaining = Math.max(0, Math.round(endTimeSec - Date.now() / 1000));
      sleepTimerStore.getState().setRemaining(remaining);
    };
    tick();
    if (appStateStore.getState().isActive) {
      sleepTimerInterval = setInterval(tick, 1000);
    }
  };
  tp.onSleepTimerChange((state) => {
    stopSleepCountdown();
    const store = sleepTimerStore.getState();
    if (!state.active) {
      store.clear();
      return;
    }
    const endTimeSec = state.endsAtEpochMs != null ? state.endsAtEpochMs / 1000 : null;
    store.setTimer(endTimeSec, state.endOfTrack);
    if (!state.endOfTrack && endTimeSec != null) {
      startSleepCountdown(endTimeSec);
    } else {
      store.setRemaining(null);
    }
  });

  // --- On background: flush the resume position to SQLite + pause the
  // sleep-timer display countdown. On foreground: resume the countdown. ---
  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      // Resume the sleep-timer display countdown if one is armed.
      const st = sleepTimerStore.getState();
      if (st.endTime != null && !st.endOfTrack) {
        startSleepCountdown(st.endTime);
      }
    } else {
      stopSleepCountdown();
      const { position, currentTrack } = playerStore.getState();
      if (currentTrack?.id && position > 0) {
        flushPosition(position, currentTrack.id, currentTrack.duration);
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Persisted-queue restore (deferred to after the splash)             */
/* ------------------------------------------------------------------ */

/**
 * True when the shared engine already holds an ACTIVE session this process
 * lifetime — a car/Siri browse tap started playback (via `playTrack`) before the
 * phone UI mounted. `configure()` wipes the engine on every launch, so a
 * non-empty active queue at boot can only be this-process car/Siri.
 */
function hasLiveEngineSession(): boolean {
  const queue = tp.getQueue();
  const idx = tp.getCurrentTrackIndex();
  if (queue.length === 0 || idx < 0 || idx >= queue.length) return false;
  const state = tp.getState();
  return (
    state === 'playing' ||
    state === 'buffering' ||
    state === 'loading' ||
    state === 'paused' ||
    state === 'error'
  );
}

/**
 * Adopt a live car/Siri session on phone-app open: read-only reconcile of the
 * store to the live engine, WITHOUT touching the engine. `currentChildQueue` is
 * authoritative (the car's `playTrack` set it); align the current index to the
 * engine's truth so a headless auto-advance doesn't leave the mini-player a
 * track behind. Never setQueue/seekTo/play, never set `hydrationPromise`, never
 * clear the persisted queue, leave `pendingResumePosition` null.
 */
function adoptLiveEngineSession(): void {
  const liveIndex = tp.getCurrentTrackIndex();
  const store = playerStore.getState();
  if (currentChildQueue.length > 0) {
    store.setQueue(currentChildQueue);
    const formats: Record<string, EffectiveFormat> = {};
    for (const child of currentChildQueue) formats[child.id] = stampQueueFormat(child);
    store.setQueueFormats(formats);
    const liveChild = currentChildQueue[liveIndex] ?? store.currentTrack ?? null;
    store.setCurrentTrack(liveChild, liveIndex >= 0 ? liveIndex : null);
  }
  store.setTrackSource(tp.getCurrentTrackSource() ?? null);
  store.setPlaybackState(mapState(tp.getState()));
}

/**
 * Restore the previous session's queue, driven from the root layout after the
 * animated splash. `restorePersistedQueue()` seeds the Zustand store
 * synchronously so the mini player renders immediately; if a queue exists it
 * kicks off the async hydration that loads it into the native engine.
 */
export function restorePersistedQueueAfterBoot(): void {
  // A car/Siri browse tap may have started playback in this same process before
  // the phone UI mounted (shared RNQP engine). Adopt that live session instead
  // of re-driving the engine with setQueue (which restarts the current track).
  if (hasLiveEngineSession()) {
    adoptLiveEngineSession();
    return;
  }
  const needsHydration = restorePersistedQueue();
  if (needsHydration) {
    hydrationPromise = hydrateRestoredQueue().finally(() => {
      hydrationPromise = null;
    });
  }
}

/**
 * Seed the Zustand store + module `currentChildQueue` from the persisted queue
 * so the mini player renders immediately. Does NOT touch the native engine —
 * that's `hydrateRestoredQueue()`. Returns true when a non-empty queue was
 * restored (caller should hydrate).
 */
function restorePersistedQueue(): boolean {
  try {
    const persisted = getPersistedQueue();
    if (!persisted) return false;

    const { queue, currentTrackIndex } = persisted;
    if (queue.length === 0) return false;
    const clampedIndex = Math.min(currentTrackIndex, queue.length - 1);

    currentChildQueue = queue;
    playerStore.getState().setQueue(queue);

    const formats: Record<string, EffectiveFormat> = {};
    for (const child of queue) formats[child.id] = stampQueueFormat(child);
    playerStore.getState().setQueueFormats(formats);

    const currentChild = queue[clampedIndex] ?? null;
    playerStore.getState().setCurrentTrack(currentChild, clampedIndex);

    const persistedPosition = getPersistedPosition();
    if (
      persistedPosition &&
      currentChild &&
      persistedPosition.trackId === currentChild.id &&
      persistedPosition.position > 0
    ) {
      playerStore.getState().setProgress(
        persistedPosition.position,
        currentChild.duration ?? 0,
        0,
      );
      pendingResumePosition = {
        trackId: persistedPosition.trackId,
        position: persistedPosition.position,
      };
    }

    return true;
  } catch (e) {
    console.warn('[Player] Failed to restore persisted queue:', e);
    return false;
  }
}

/**
 * Load the restored queue into the native engine. A single atomic
 * `setQueue(tracks, startIndex)` (which does NOT auto-play) replaces the
 * former RNTP mute→reset→verify→skip→seek→pause ceremony. The prerequisite
 * waits stay — they resolve local URIs / cover-art auth / the iOS SSL proxy so
 * downloaded songs use local files rather than server URLs that stall offline.
 */
async function hydrateRestoredQueue(): Promise<void> {
  try {
    await waitForTrackMapsReady();
    await ensureCoverArtAuth();
    // (iOS) register the self-signed streaming proxy BEFORE building tracks, so
    // getStreamUrl resolves to the loopback proxy rather than a raw self-signed
    // https URL. No-op when no self-signed host is configured.
    if (Platform.OS === 'ios') {
      await syncProxyUpstreams();
    }

    const originalIndex = playerStore.getState().currentTrackIndex ?? 0;
    const originalChild = currentChildQueue[originalIndex] ?? null;
    const resume = pendingResumePosition;
    pendingResumePosition = null;

    const { rnTracks, filteredQueue } = await buildPlayableQueue(currentChildQueue);
    if (rnTracks.length === 0) {
      // Nothing playable (offline + no cached files) — clear the stale queue.
      playbackToastStore.getState().fail();
      await clearPlayerStateInternal();
      return;
    }

    const pruned = filteredQueue.length !== currentChildQueue.length;
    if (pruned) {
      currentChildQueue = filteredQueue;
      playerStore.getState().setQueue(filteredQueue);
    }

    // Translate the restored current track onto the filtered queue.
    let startIndex = 0;
    if (originalChild) {
      const idx = filteredQueue.findIndex((c) => c.id === originalChild.id);
      if (idx !== -1) startIndex = idx;
    }

    await tp.setQueue(rnTracks, startIndex);
    if (
      resume &&
      filteredQueue[startIndex]?.id === resume.trackId &&
      resume.position > 0
    ) {
      await tp.seekTo(resume.position);
    }

    if (pruned) persistQueue(filteredQueue, startIndex);
  } catch (e) {
    console.warn('[Player] Queue hydration failed:', e);
    throw e;
  }
}

/** Await any in-flight cold-start hydration before touching the native queue. */
async function awaitHydration(): Promise<void> {
  if (hydrationPromise) {
    try {
      await hydrationPromise;
    } catch {
      /* hydration failed; clearPlayerStateInternal already cleaned up */
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Start playing a track from a given queue. Atomic: builds the playable queue,
 * loads it positioned at the tapped index, then plays.
 *
 * @param sourcePlaylistId  When playback originates from a playlist, pass its
 *   ID so per-track scrobble exclusions work correctly.
 */
export async function playTrack(
  track: Child,
  queue: Child[],
  sourcePlaylistId?: string | null,
): Promise<void> {
  await awaitHydration();
  maybePromptFireBackgroundPlayback();
  pendingResumePosition = null;
  playerStore.getState().setQueueLoading(true);

  try {
    // Populate the track-URI map first so a tap right after cold launch doesn't
    // downgrade a downloaded song to a server URL.
    await waitForTrackMapsReady();
    await ensureCoverArtAuth();

    const { rnTracks, filteredQueue } = await buildPlayableQueue(queue);
    if (rnTracks.length === 0) {
      playbackToastStore.getState().fail();
      await clearQueue();
      return;
    }

    currentChildQueue = filteredQueue;
    trackPlaylistMap.clear();
    if (sourcePlaylistId) {
      for (const child of filteredQueue) trackPlaylistMap.set(child.id, sourcePlaylistId);
    }
    playerStore.getState().setQueue(filteredQueue);

    const formats: Record<string, EffectiveFormat> = {};
    for (const child of filteredQueue) formats[child.id] = stampQueueFormat(child);
    playerStore.getState().setQueueFormats(formats);

    // Translate the tapped track onto the filtered queue; fall back to 0.
    let startIndex = filteredQueue.findIndex((c) => c.id === track.id);
    if (startIndex === -1) startIndex = 0;

    await tp.setQueue(rnTracks, startIndex);
    await tp.play();
    persistQueue(filteredQueue, startIndex);
  } catch {
    playbackToastStore.getState().fail();
  } finally {
    playerStore.getState().setQueueLoading(false);
  }
}

/** Toggle between play and pause. */
export async function togglePlayPause(): Promise<void> {
  await awaitHydration();
  if (tp.getState() === 'playing') {
    await tp.pause();
  } else {
    // Covers a returning user resuming a restored queue via the mini-player.
    maybePromptFireBackgroundPlayback();
    await tp.play();
  }
}

/** Skip to the next track in the queue. */
export async function skipToNext(): Promise<void> {
  await awaitHydration();
  await tp.skipToNext();
}

/** Skip to the previous track in the queue. */
export async function skipToPrevious(): Promise<void> {
  await awaitHydration();
  await tp.skipToPrevious();
}

/** Whether skip-to-next is possible given current queue position and repeat mode. */
export function canSkipToNext(): boolean {
  const { currentTrackIndex, queue } = playerStore.getState();
  const { repeatMode } = playbackSettingsStore.getState();
  if (currentTrackIndex == null || queue.length === 0) return false;
  if (repeatMode !== 'off') return true;
  return currentTrackIndex < queue.length - 1;
}

/** Whether skip-to-previous is possible (native restarts the current track if
 *  there is no previous). */
export function canSkipToPrevious(): boolean {
  const { currentTrackIndex, queue } = playerStore.getState();
  return currentTrackIndex != null && queue.length > 0;
}

/**
 * Seek to a position in seconds. RNQP handles seek-within-buffer protection
 * natively (constant-bitrate seeking, and a no-op on genuinely-unseekable
 * streams), so this is a straight passthrough with an optimistic store update.
 */
export async function seekTo(position: number): Promise<void> {
  await awaitHydration();
  const target = Math.max(0, position);
  await tp.seekTo(target);
  const store = playerStore.getState();
  store.setProgress(target, store.duration, store.bufferedPosition);
}

/** Skip to a specific track in the queue by index. */
export async function skipToTrack(index: number): Promise<void> {
  await awaitHydration();
  await tp.skipToIndex(index);
  await tp.play();
}

/**
 * Skip forward or backward by a relative number of seconds.
 * Positive values skip forward, negative values skip backward.
 */
export async function skipByInterval(seconds: number): Promise<void> {
  const { position, duration } = playerStore.getState();
  const target = Math.max(0, Math.min(position + seconds, duration || Infinity));
  await seekTo(target);
}

/**
 * Apply the user's lock-screen / notification skip-control preference to the
 * native engine: skip between tracks, or jump forward/back by a fixed interval.
 */
export async function updateRemoteCapabilities(): Promise<void> {
  const { remoteControlMode, skipForwardInterval, skipBackwardInterval } =
    playbackSettingsStore.getState();
  await tp.setRemoteControls({
    skipMode: remoteControlMode === 'skip-interval' ? 'interval' : 'track',
    forwardJumpInterval: skipForwardInterval,
    backwardJumpInterval: skipBackwardInterval,
  });
}

/** Push the current playback source (local / cached / streaming) into the store. */
function refreshTrackSource(): void {
  playerStore.getState().setTrackSource(tp.getCurrentTrackSource() ?? null);
}

/**
 * Apply the lookahead-cache config from settings: enable + track count (both
 * runtime-settable, live on both platforms). The disk budget and eviction
 * policy are fixed at `configure()` (`lookaheadCacheMaxSizeMb` /
 * `lookaheadCacheEvictionPolicy`), so they aren't part of this call. Called at
 * startup and whenever the user changes the cache settings.
 */
export async function applyLookaheadCacheConfig(): Promise<void> {
  const { lookaheadEnabled, lookaheadCount } = playbackSettingsStore.getState();
  await tp.setLookaheadCache({
    enabled: lookaheadEnabled,
    lookaheadCount,
  });
}

/** Wipe the lookahead cache (upcoming-track prefetch). Does not stop prefetch. */
export async function clearLookaheadCache(): Promise<void> {
  await tp.clearLookaheadCache();
}

/**
 * Apply the gapless/crossfade transition mode from settings. RNQP applies the
 * change at the next track boundary; the crossfade duration is only sent when
 * the mode is `crossfade`. Called at startup and when the user changes it.
 */
export async function applyPlaybackMode(): Promise<void> {
  const { playbackMode, crossfadeDurationMs } = playbackSettingsStore.getState();
  await tp.setPlaybackMode({
    kind: playbackMode,
    crossfadeDurationMs: playbackMode === 'crossfade' ? crossfadeDurationMs : undefined,
  });
}

/* ------------------------------------------------------------------ */
/*  Equalizer                                                          */
/* ------------------------------------------------------------------ */

/** Re-apply the persisted equalizer state (band gains + enabled) to the engine. */
export async function applyEqualizerConfig(): Promise<void> {
  const { enabled, gains } = equalizerSettingsStore.getState();
  await eq.setAllBandGains(gains);
  await eq.setEnabled(enabled);
}

/** Toggle the equalizer on/off (persists). */
export async function setEqualizerEnabled(enabled: boolean): Promise<void> {
  equalizerSettingsStore.getState().setEnabled(enabled);
  await eq.setEnabled(enabled);
}

/** Apply a preset (built-in or custom) by name; persists the resulting gains. */
export async function applyEqualizerPreset(name: string): Promise<void> {
  const preset = eq.getPresets().find((p) => p.name === name);
  const gains = preset ? preset.gains.slice() : equalizerSettingsStore.getState().gains;
  const s = equalizerSettingsStore.getState();
  s.setGains(gains);
  s.setPresetName(name);
  await eq.setAllBandGains(gains);
}

/** Set one band's gain (persists; marks the selected preset as Custom). */
export async function setEqualizerBandGain(index: number, gainDb: number): Promise<void> {
  const s = equalizerSettingsStore.getState();
  s.setBandGain(index, gainDb);
  s.setPresetName(EQ_CUSTOM_PRESET_LABEL);
  await eq.setBandGain(index, gainDb);
}

/** Reset all bands to flat (persists). */
export async function resetEqualizer(): Promise<void> {
  equalizerSettingsStore.getState().resetGains();
  await eq.reset();
}

/** Save the current gains as a named custom preset (RNQP persists it natively). */
export async function saveEqualizerPreset(name: string): Promise<void> {
  await eq.saveCustomPreset(name);
  equalizerSettingsStore.getState().setPresetName(name);
}

/** Delete a custom preset (RNQP native). */
export async function deleteEqualizerPreset(name: string): Promise<void> {
  await eq.deleteCustomPreset(name);
}

/** The available presets (16 built-ins + user customs). */
export function getEqualizerPresets(): ReturnType<typeof eq.getPresets> {
  return eq.getPresets();
}

/** Clear the current error and re-attempt the errored track. */
export async function retryPlayback(): Promise<void> {
  await awaitHydration();
  const store = playerStore.getState();
  store.setError(null);
  store.setRetrying(false);
  await tp.retry();
}

/** Arm a sleep timer that pauses playback after `seconds`. */
export function setSleepTimer(seconds: number): void {
  void tp.setSleepTimer(seconds);
}

/** Arm a sleep timer that pauses playback when the current track ends. */
export function setSleepTimerToTrackEnd(): void {
  void tp.setSleepTimerToTrackEnd();
}

/** Cancel any armed sleep timer. */
export function clearSleepTimer(): void {
  void tp.clearSleepTimer();
}

/** Internal clear-state helper (does not await hydration — hydrate calls it). */
async function clearPlayerStateInternal(): Promise<void> {
  pendingResumePosition = null;
  currentChildQueue = [];
  trackPlaylistMap.clear();

  await tp.clearQueue();
  clearPersistedQueue();

  const store = playerStore.getState();
  store.setCurrentTrack(null);
  store.setQueue([]);
  store.setPlaybackState('idle');
  store.setProgress(0, 0, 0);
  store.setError(null);
  store.setRetrying(false);
  store.clearQueueFormats();
}

/** Stop playback, clear the queue, and reset all player state to defaults. */
export async function clearQueue(): Promise<void> {
  await awaitHydration();
  await clearPlayerStateInternal();
}

/**
 * Rebuild the native queue in-place from the current Child[] queue so every
 * track's stream/artwork URL is regenerated against the now-active server —
 * the right hammer immediately after a primary/secondary server switch.
 * Downloaded tracks keep playing from local files (childToTrack prefers the
 * local URI). No-op when the queue is empty.
 */
export async function rebuildQueueForServerSwitch(): Promise<void> {
  await awaitHydration();
  const queue = currentChildQueue;
  if (queue.length === 0) return;

  const idx = playerStore.getState().currentTrackIndex ?? 0;
  const position = playerStore.getState().position;
  const wasPlaying = playerStore.getState().playbackState === 'playing';

  try {
    // Re-establish cover-art auth + the iOS streaming proxy against the NEW
    // server BEFORE regenerating URLs — the switch nulled the token.
    await ensureCoverArtAuth();
    if (Platform.OS === 'ios') {
      await syncProxyUpstreams();
    }

    const { rnTracks, filteredQueue } = await buildPlayableQueue(queue);
    if (rnTracks.length === 0) return;

    const safeIdx = Math.min(Math.max(0, idx), rnTracks.length - 1);
    await tp.setQueue(rnTracks, safeIdx);
    if (position > 0) await tp.seekTo(position);
    if (wasPlaying) await tp.play();

    currentChildQueue = filteredQueue;
    playerStore.getState().setQueue(filteredQueue);
    persistQueue(filteredQueue, safeIdx);
  } catch {
    // Best-effort — a failed switch leaves the prior queue loaded.
  }
}

/**
 * Append one or more tracks to the end of the current queue. If the queue is
 * empty, starts playback from the first supplied track.
 */
export async function addToQueue(
  tracks: Child[],
  sourcePlaylistId?: string | null,
): Promise<void> {
  if (tracks.length === 0) return;
  await awaitHydration();

  if (currentChildQueue.length === 0) {
    await playTrack(tracks[0], tracks, sourcePlaylistId);
    return;
  }

  await waitForTrackMapsReady();
  await ensureCoverArtAuth();

  const { rnTracks, filteredQueue: playable } = await buildPlayableQueue(tracks);
  if (rnTracks.length === 0) {
    playbackToastStore.getState().fail();
    return;
  }

  await tp.addToQueue(rnTracks);

  if (sourcePlaylistId) {
    for (const child of playable) trackPlaylistMap.set(child.id, sourcePlaylistId);
  }
  for (const child of playable) {
    playerStore.getState().addQueueFormat(child.id, stampQueueFormat(child));
  }

  currentChildQueue = [...currentChildQueue, ...playable];
  playerStore.getState().setQueue(currentChildQueue);
  persistQueue(currentChildQueue, playerStore.getState().currentTrackIndex ?? 0);
}

/**
 * Insert a single song immediately after the current track so it plays next.
 * When the queue is empty, behaves like `playTrack`.
 */
export async function playSongNext(song: Child): Promise<void> {
  await awaitHydration();

  if (currentChildQueue.length === 0) {
    await playTrack(song, [song]);
    return;
  }

  await waitForTrackMapsReady();
  await ensureCoverArtAuth();

  const { rnTracks, filteredQueue: playable } = await buildPlayableQueue([song]);
  if (rnTracks.length === 0) {
    playbackToastStore.getState().fail();
    return;
  }

  const currentIndex = playerStore.getState().currentTrackIndex ?? 0;
  const insertBefore = Math.min(currentIndex + 1, currentChildQueue.length);

  // addToQueue(tracks, insertBefore) inserts BEFORE the given index.
  await tp.addToQueue(rnTracks, insertBefore);

  for (const child of playable) {
    playerStore.getState().addQueueFormat(child.id, stampQueueFormat(child));
  }

  const newQueue = [...currentChildQueue];
  newQueue.splice(insertBefore, 0, ...playable);
  currentChildQueue = newQueue;
  playerStore.getState().setQueue(currentChildQueue);
  // Re-read the index AFTER the awaited add in case an auto-advance moved it.
  persistQueue(currentChildQueue, playerStore.getState().currentTrackIndex ?? 0);
}

/**
 * Remove a track from the play queue by index. When the removed track is
 * before the active one the native engine re-indexes; we read the new index
 * back rather than adjusting by hand. Clears the queue when it was the last.
 */
export async function removeFromQueue(index: number): Promise<void> {
  await awaitHydration();

  if (index < 0 || index >= currentChildQueue.length) return;
  if (currentChildQueue.length === 1) {
    await clearQueue();
    return;
  }

  const removedChild = currentChildQueue[index];
  await tp.removeFromQueue([index]);

  trackPlaylistMap.delete(removedChild.id);
  currentChildQueue = currentChildQueue.filter((_, i) => i !== index);
  playerStore.getState().setQueue(currentChildQueue);

  // Re-sync the active index from native (recomputed on removal).
  const nativeIndex = tp.getCurrentTrackIndex();
  playerStore.getState().setCurrentTrack(
    playerStore.getState().currentTrack,
    nativeIndex >= 0 ? nativeIndex : null,
  );
  persistQueue(currentChildQueue, playerStore.getState().currentTrackIndex ?? 0);
}

/**
 * Remove all non-downloaded tracks from the queue (called when entering
 * offline mode). Iterates in reverse to avoid index shifting; clears the
 * queue if nothing remains.
 */
export async function removeNonDownloadedTracks(): Promise<void> {
  await awaitHydration();

  if (currentChildQueue.length === 0) return;

  const indicesToRemove: number[] = [];
  for (let i = currentChildQueue.length - 1; i >= 0; i--) {
    if (!getLocalTrackUri(currentChildQueue[i].id)) {
      indicesToRemove.push(i);
    }
  }

  if (indicesToRemove.length === 0) return;
  if (indicesToRemove.length === currentChildQueue.length) {
    await clearQueue();
    return;
  }

  for (const index of indicesToRemove) {
    await removeFromQueue(index);
  }
}

/** Cycle the repeat mode: off → all → one → off (persisted + native). */
export async function cycleRepeatMode(): Promise<void> {
  const current = playbackSettingsStore.getState().repeatMode;
  const next: RepeatModeSetting =
    current === 'off' ? 'all' : current === 'all' ? 'one' : 'off';
  playbackSettingsStore.getState().setRepeatMode(next);
  await tp.setRepeatMode(mapRepeatMode(next));
}

/** Set the playback rate (persisted store + native engine). */
export async function applyPlaybackRate(rate: PlaybackRate): Promise<void> {
  playbackSettingsStore.getState().setPlaybackRate(rate);
  await tp.setPlaybackSpeed(rate);
}

/**
 * Set the pitch-correction mode (none / voice / music). Only effective at rate
 * != 1x; RNQP persists it + auto-bypasses at 1x, so it need not be re-applied on
 * rate changes. Persists the choice + pushes it to the engine.
 */
export async function applyPitchCorrection(mode: PitchCorrection): Promise<void> {
  playbackSettingsStore.getState().setPitchCorrection(mode);
  await tp.setPitchCorrectionMode(mode);
}

/**
 * Push the persisted ReplayGain mode (off / track / album) to the engine. RNQP
 * doesn't restore this across restarts, so it's re-applied at boot from settings.
 */
export async function applyReplayGain(): Promise<void> {
  await tp.setReplayGainMode(playbackSettingsStore.getState().replayGainMode);
}

/**
 * Eagerly bump local play stats for a just-scrobbled song on the ephemeral
 * player copies (module `currentChildQueue` + `playerStore.currentTrack`), so
 * the player-view info panel reflects the new count before any server call.
 * Called from `playStatsService.applyLocalPlay`.
 */
export function applyLocalPlayToPlayer(songId: string, now: string): void {
  for (let i = 0; i < currentChildQueue.length; i++) {
    const t = currentChildQueue[i];
    if (t.id === songId) {
      currentChildQueue[i] = {
        ...t,
        playCount: (t.playCount ?? 0) + 1,
        played: now,
      };
    }
  }

  const cur = playerStore.getState().currentTrack;
  if (cur && cur.id === songId) {
    playerStore.setState({
      currentTrack: {
        ...cur,
        playCount: (cur.playCount ?? 0) + 1,
        played: now,
      },
    });
  }
}

// Wire the ephemeral player-state updater into playStatsService (inverts the
// dependency so playStatsService doesn't import playerService).
registerPlayerPlayStatListener(applyLocalPlayToPlayer);

/**
 * Shuffle the current queue in place and restart from index 0. We shuffle the
 * Child[] ourselves (so the shuffled order is what we persist for restore) and
 * load it atomically. `trackPlaylistMap` is left intact — IDs are unchanged.
 */
export async function shuffleQueue(): Promise<void> {
  await awaitHydration();
  if (currentChildQueue.length < 2) return;

  try {
    const shuffled = shuffleArray(currentChildQueue);
    const { rnTracks, filteredQueue } = await buildPlayableQueue(shuffled);
    if (rnTracks.length === 0) {
      playbackToastStore.getState().fail();
      await clearPlayerStateInternal();
      return;
    }

    currentChildQueue = filteredQueue;
    playerStore.getState().setQueue(filteredQueue);

    await tp.setQueue(rnTracks, 0);
    await tp.play();
    persistQueue(filteredQueue, 0);
  } catch {
    playbackToastStore.getState().fail();
  }
}
