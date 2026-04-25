/**
 * Player service – initialises RNTP, manages the queue, and keeps
 * the Zustand playerStore in sync with the native player state.
 */

import { AppState, type AppStateStatus } from 'react-native';
import i18n from '../i18n/i18n';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  RepeatMode,
  State,
  type Track,
} from 'react-native-track-player';

import { type EffectiveFormat } from '../types/audio';
import {
  PLAYBACK_RATES,
  playbackSettingsStore,
  type PlaybackRate,
  type RepeatModeSetting,
} from '../store/playbackSettingsStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playbackToastStore } from '../store/playbackToastStore';
import { playerStore, type PlaybackStatus } from '../store/playerStore';
import { sleepTimerStore } from '../store/sleepTimerStore';
import { serverInfoStore } from '../store/serverInfoStore';
import { shuffleArray } from '../utils/arrayHelpers';
import { addCompletedScrobble, sendNowPlaying } from './scrobbleService';
import { registerPlayerPlayStatListener } from './playStatsService';
import { getCachedImageUri } from './imageCacheService';
import { getLocalTrackUri, waitForTrackMapsReady } from './musicCacheService';
import {
  persistQueue,
  persistPositionIfDue,
  flushPosition,
  clearPersistedQueue,
  getPersistedQueue,
  getPersistedPosition,
} from './queuePersistenceService';
import { resolveEffectiveFormat } from '../utils/effectiveFormat';
import { withTimeout } from '../utils/withTimeout';
import {
  ensureCoverArtAuth,
  getCoverArtUrl,
  getStreamUrl,
  type Child,
} from './subsonicService';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Map our RepeatModeSetting to RNTP's RepeatMode enum. */
function mapRepeatMode(mode: RepeatModeSetting): RepeatMode {
  switch (mode) {
    case 'all':
      return RepeatMode.Queue;
    case 'one':
      return RepeatMode.Track;
    default:
      return RepeatMode.Off;
  }
}

/** Map RNTP State enum to our simplified PlaybackStatus. */
function mapState(state: State): PlaybackStatus {
  switch (state) {
    case State.Playing:
      return 'playing';
    case State.Paused:
      return 'paused';
    case State.Buffering:
      return 'buffering';
    case State.Loading:
      return 'loading';
    case State.Stopped:
    case State.Ended:
      return 'stopped';
    default:
      return 'idle';
  }
}

const EXT_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

function mimeFromUri(uri: string): string | undefined {
  const ext = uri.split('.').pop()?.toLowerCase();
  return ext ? EXT_TO_MIME[ext] : undefined;
}

/**
 * Build an EffectiveFormat stamp for a track being added to the queue.
 * If the track has a downloaded copy with a persisted format, use that;
 * otherwise resolve from the current streaming settings.
 */
function stampQueueFormat(child: Child): EffectiveFormat {
  const downloadedSong = musicCacheStore.getState().cachedSongs[child.id];
  if (downloadedSong) {
    return {
      suffix: downloadedSong.suffix.toLowerCase(),
      bitRate: downloadedSong.bitRate,
      bitDepth: downloadedSong.bitDepth,
      samplingRate: downloadedSong.samplingRate,
      capturedAt: downloadedSong.formatCapturedAt,
    };
  }

  const { streamFormat, maxBitRate } = playbackSettingsStore.getState();
  return resolveEffectiveFormat({
    sourceSuffix: child.suffix,
    sourceBitRate: child.bitRate,
    sourceBitDepth: child.bitDepth,
    sourceSamplingRate: child.samplingRate,
    formatSetting: streamFormat,
    bitRateSetting: maxBitRate,
  });
}

/**
 * Convert a Child (Subsonic song) to an RNTP Track object.
 *
 * Returns `null` when the track can't be played right now:
 * - Offline mode + no local cached file → RNTP must not receive a
 *   server stream URL (AVPlayer would latch onto it and stall
 *   indefinitely waiting for data from an unreachable server).
 * - No local URI AND stream-URL construction failed (e.g. auth not
 *   yet initialised). An empty-string URL in RNTP produces the same
 *   stall, so filter it out here rather than push it downstream.
 *
 * Callers must filter nulls out of the resulting array and treat an
 * all-null queue as "nothing playable" (toast + clearQueue).
 */
function childToTrack(child: Child): Track | null {
  const localUri = getLocalTrackUri(child.id);
  const offline = offlineModeStore.getState().offlineMode;
  if (!localUri && offline) return null;

  const url = localUri ?? getStreamUrl(child.id);
  if (!url) return null;

  const cachedArt = getCachedImageUri(child.coverArt ?? '', 600);
  const contentType = localUri ? mimeFromUri(localUri) : undefined;
  // In offline mode drop any server-only artwork so RNTP's lock-screen
  // artwork fetch can't hit the network either. (`getCoverArtUrl` also
  // returns null under offline mode now; this is belt-and-braces.)
  const artwork = cachedArt
    ?? (offline ? undefined : getCoverArtUrl(child.coverArt ?? '', 600) ?? undefined);

  return {
    id: child.id,
    url,
    title: child.title,
    artist: child.artist ?? i18n.t('unknownArtist'),
    album: child.album ?? undefined,
    artwork,
    duration: child.duration ?? 0,
    userAgent: 'substreamer8',
    ...(contentType ? { contentType } : {}),
  };
}

/**
 * Build (RNTP tracks, filtered child queue) from a Child queue, dropping
 * entries that aren't currently playable. Preserves source order so
 * callers can translate desired indices onto the filtered queue by
 * looking up the original Child.
 */
function buildPlayableQueue(queue: readonly Child[]): {
  rnTracks: Track[];
  filteredQueue: Child[];
} {
  const rnTracks: Track[] = [];
  const filteredQueue: Child[] = [];
  for (const child of queue) {
    const track = childToTrack(child);
    if (track) {
      rnTracks.push(track);
      filteredQueue.push(child);
    }
  }
  return { rnTracks, filteredQueue };
}

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let isPlayerReady = false;
/** The Child[] backing the current RNTP queue, indexed by position. */
let currentChildQueue: Child[] = [];
/** Maps trackId → playlistId for tracks that originated from a playlist. */
const trackPlaylistMap = new Map<string, string>();
/**
 * Highest buffered position (in seconds) observed for the current track.
 * The native player sometimes reports a stale or lower `buffered` value
 * even though more data was previously available.  Tracking the high-water
 * mark ensures the UI and seek logic never regress.
 */
let maxBufferedSeen = 0;
/**
 * Set to true when the PlaybackBufferFull event fires, indicating the
 * native player has finished downloading the entire stream.  When true,
 * the effective buffered value is set to the metadata duration so the UI
 * shows 100% and seeking is unrestricted.
 */
let isFullyBuffered = false;
/** The previously active Child, used for scrobble-on-completion. */
let previousActiveChild: Child | null = null;
/**
 * Saved by PlaybackActiveTrackChanged when it fires BEFORE
 * PlaybackEndedWithReason.  Ensures the ended handler scrobbles the
 * correct (outgoing) track even when RNTP delivers events in reverse.
 */
let savedTrackForScrobble: Child | null = null;
/**
 * True when PlaybackEndedWithReason fired before PlaybackActiveTrackChanged
 * for the current transition.  Prevents the subsequent ActiveTrackChanged
 * from saving a stale outgoing track reference.
 */
let scrobbleHandledByEnded = false;
/**
 * Seconds added to getProgress().position to compensate for transcoded
 * stream recovery.  When we reload a track with `timeOffset`, the native
 * player resets to position 0, but the real song position is `positionOffset`.
 * Reset to 0 on every genuine track change.
 */
let positionOffset = 0;
/** True while we are reloading the current track for stream recovery. */
let isRecoveringStream = false;
/** True while the queue is being shuffled, to guard event handlers. */
let isShuffling = false;
/**
 * True during multi-step queue operations (playTrack, shuffleQueue) where
 * multiple PlaybackActiveTrackChanged events fire for a single user action.
 * Prevents intermediate tracks from being falsely scrobbled.
 */
let isSettingQueue = false;
/**
 * In-flight promise for an async queue-rehydration after a cold-start
 * restore. Consumers that touch the native queue (play/skip/seek, or
 * queue-replacing actions) await this before issuing their own commands
 * so they can't race an eager hydration still wiring up RNTP.
 * Null when no hydration is pending (e.g. fresh install, post-completion,
 * or after the queue has been replaced by playTrack/clearQueue).
 */
let hydrationPromise: Promise<void> | null = null;
/**
 * Pending resume position from a persisted queue restore. Consumed by
 * hydrateRestoredQueue() to seek before the explicit post-load pause.
 */
let pendingResumePosition: { trackId: string; position: number } | null = null;
/** Consecutive raw stream recovery attempts for the current track. */
let rawRecoveryAttempts = 0;
const MAX_RAW_RECOVERY_ATTEMPTS = 3;


/* ------------------------------------------------------------------ */
/*  Transcoded stream recovery                                         */
/* ------------------------------------------------------------------ */

/**
 * Reload the current track with `timeOffset` so the server resumes
 * transcoding from the given position instead of from the start.
 *
 * Called when we detect the buffer is about to run out on a transcoded
 * stream (duration === 0).  Without this, the native player would
 * re-request the URL and the server would start from second 0.
 */
async function recoverTranscodedStream(adjustedPosition: number): Promise<void> {
  try {
    // Only attempt recovery if the server supports the transcodeOffset
    // OpenSubsonic extension — otherwise timeOffset will be ignored and
    // the server will transcode from the start again.
    const supportsOffset = serverInfoStore
      .getState()
      .extensions.some((e) => e.name === 'transcodeOffset');
    if (!supportsOffset) return;

    const activeTrack = await TrackPlayer.getActiveTrack();
    if (!activeTrack?.id) return;

    const child = currentChildQueue.find((c) => c.id === activeTrack.id);
    if (!child) return;

    const timeOffset = Math.floor(adjustedPosition);
    const newUrl = getStreamUrl(child.id, timeOffset);
    if (!newUrl) return;

    // Set offset BEFORE load so event handlers know we're recovering.
    positionOffset = adjustedPosition;

    // Reset buffer tracking for the fresh stream segment.
    maxBufferedSeen = 0;
    isFullyBuffered = false;

    await TrackPlayer.load({
      ...activeTrack,
      url: newUrl,
    });
    await TrackPlayer.play();
  } catch {
    // Recovery failed — reset offset so the UI doesn't jump.
    positionOffset = 0;
  } finally {
    isRecoveringStream = false;
  }
}

/**
 * Retry the current raw (non-transcoded) stream after a playback error
 * and verify the playback position is preserved.
 *
 * Unlike transcoded recovery (which reloads with a new timeOffset URL),
 * raw streams use the native retry mechanism directly — the server
 * serves the full file and the native player can seek freely.  The
 * explicit seekTo() after retry() is a safety net: if the native layer
 * lost position (stale lastPosition on iOS, failed byte-range on
 * Android), we restore it.
 */
async function recoverRawStream(adjustedPosition: number): Promise<void> {
  try {
    console.warn(
      '[Player] Attempting raw stream recovery at position',
      adjustedPosition,
    );

    maxBufferedSeen = 0;
    isFullyBuffered = false;

    await TrackPlayer.retry();
    await TrackPlayer.seekTo(adjustedPosition);
    await TrackPlayer.play();

    console.warn('[Player] Raw stream recovery completed');
  } catch (e) {
    console.warn('[Player] Raw stream recovery failed:', e);
  } finally {
    isRecoveringStream = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

/**
 * Set up the RNTP player, register event listeners, and start
 * AppState monitoring.  Safe to call multiple times (no-ops after first).
 */
export async function initPlayer(): Promise<void> {
  if (isPlayerReady) return;

  try {
    await TrackPlayer.setupPlayer({
      // On iOS minBuffer maps to AVPlayerItem.preferredForwardBufferDuration.
      // A very large value tells AVPlayer to keep buffering aggressively
      // until the entire track is downloaded rather than capping at a
      // short window.  automaticallyWaitsToMinimizeStalling is left at
      // its default (true) so the player properly waits for sufficient
      // buffer before starting playback.
      minBuffer: 86400,
      // maxBuffer is Android-only (ExoPlayer); must be >= minBuffer.
      maxBuffer: 86400,
      iosCategory: IOSCategory.Playback,
      autoHandleInterruptions: true,
    });
  } catch (err) {
    // Two shapes of failure land here:
    //   (a) "player_already_initialized" — RNTP survived the previous app
    //       lifecycle (Android foreground service persistence, iOS AVPlayer
    //       retained across cold-restart, or a Fast Refresh). The JS bridge
    //       is disconnected from a native queue that may still hold stale
    //       tracks. Expected; the unconditional reset() below cleans it up.
    //   (b) Any other error — a real init failure. Bail so consumers don't
    //       attempt playback against a dead native player.
    const message = (err as { message?: string })?.message ?? '';
    const code = (err as { code?: string })?.code ?? '';
    const alreadyInit =
      code.toLowerCase().includes('already_initialized') ||
      message.toLowerCase().includes('already');
    if (!alreadyInit) {
      console.error('[Player] setupPlayer failed:', err);
      return;
    }
  }

  // Unconditional post-setup reset: guarantees a clean native queue
  // regardless of whether setupPlayer() fresh-initialized or re-attached to
  // a zombie service from the previous app lifecycle. RNTP's reset()
  // occasionally resolves before the native queue is fully cleared (see
  // upstream issue #1445), so wrap in withTimeout and settle briefly.
  try {
    await withTimeout(() => TrackPlayer.reset(), 2000);
  } catch {
    // reset() failed or timed out — continue. hydrateRestoredQueue()
    // calls reset() again before add() as a second line of defence.
  }
  await new Promise((r) => setTimeout(r, 150));

  // Apply remote capabilities based on user preference (skip-track vs skip-interval).
  await updateRemoteCapabilities();

  // Apply persisted playback settings to the native player.
  const settings = playbackSettingsStore.getState();
  await TrackPlayer.setRepeatMode(mapRepeatMode(settings.repeatMode));
  await TrackPlayer.setRate(settings.playbackRate);

  // --- Event listeners that push state into the Zustand store ---

  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    const store = playerStore.getState();
    store.setPlaybackState(mapState(state));

    if (state === State.Playing) {
      if (store.error) store.setError(null);
      if (store.retrying) store.setRetrying(false);
      rawRecoveryAttempts = 0;
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackError, async (e) => {
    const message =
      (e as { message?: string }).message ?? i18n.t('playbackErrorOccurred');
    const errorPosition = (e as { position?: number }).position ?? 0;
    const store = playerStore.getState();

    // --- Transcoded stream recovery ----------------------------------
    // If the error occurred mid-stream on a transcoded track, attempt to
    // recover by reloading with a timeOffset so the server resumes from
    // the failure position.  This replaces the old polling-based heuristic.
    if (!isRecoveringStream && errorPosition > 5) {
      const adjustedPos = errorPosition + positionOffset;
      const metadataDuration = store.currentTrack?.duration ?? 0;
      if (metadataDuration > 0 && adjustedPos < metadataDuration - 5) {
        const { streamFormat, maxBitRate } = playbackSettingsStore.getState();
        const isTranscoding = streamFormat !== 'raw' || maxBitRate != null;
        if (isTranscoding) {
          isRecoveringStream = true;
          recoverTranscodedStream(adjustedPos);
          return;
        }
        if (rawRecoveryAttempts < MAX_RAW_RECOVERY_ATTEMPTS) {
          rawRecoveryAttempts++;
          isRecoveringStream = true;
          recoverRawStream(adjustedPos);
          return;
        }
      }
    }

    // --- Normal error handling with auto-retry -----------------------
    if (!store.retrying) {
      store.setError(message);
      store.setRetrying(true);
      // Brief delay before retrying to let transient issues settle.
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await TrackPlayer.retry();
        // If retry succeeds, the PlaybackState -> Playing handler clears
        // the error.  If it fails, this listener fires again and we'll
        // hit the else branch below.
      } catch {
        // retry() itself threw — surface the error immediately.
        playerStore.getState().setRetrying(false);
      }
    } else {
      // Auto-retry already attempted and failed — show error for manual retry.
      store.setRetrying(false);
      store.setError(message);
    }
  });

  // --- Playback diagnostic events ---

  TrackPlayer.addEventListener(Event.PlaybackStalled, (e) => {
    console.warn(
      '[Player] Playback stalled at position',
      e.position,
      'track',
      e.track
    );
  });

  TrackPlayer.addEventListener(Event.PlaybackErrorLog, (e) => {
    for (const entry of e.entries) {
      console.warn(
        '[Player] Error log entry:',
        entry.errorStatusCode,
        entry.errorDomain,
        entry.errorComment ?? '',
        entry.uri ?? ''
      );
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackBufferFull, (e) => {
    if (e.isFull) {
      isFullyBuffered = true;
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e) => {
    const { position, duration, buffered } = e;

    // Compute effective buffered value using high-water mark.
    if (isFullyBuffered) {
      const metaDuration =
        playerStore.getState().currentTrack?.duration ?? 0;
      maxBufferedSeen = Math.max(
        maxBufferedSeen, metaDuration, duration, buffered, position
      );
    } else {
      maxBufferedSeen = Math.max(maxBufferedSeen, buffered, position);
    }

    const adjustedPosition = position + positionOffset;
    playerStore.getState().setProgress(adjustedPosition, duration, maxBufferedSeen);

    const currentTrack = playerStore.getState().currentTrack;
    if (currentTrack?.id && adjustedPosition > 0) {
      persistPositionIfDue(adjustedPosition, currentTrack.id);
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackEndedWithReason, (e) => {
    // During queue-setup operations, skip scrobble coordination entirely.
    if (isSettingQueue || isShuffling) return;

    // Resolve the track that actually finished: prefer the snapshot saved
    // by ActiveTrackChanged (if it fired first), otherwise use the current
    // previousActiveChild (if we fired first — it hasn't been overwritten yet).
    const trackThatEnded = savedTrackForScrobble ?? previousActiveChild;

    if (
      (e.reason === 'playedUntilEnd' || e.reason === 'PLAYED_UNTIL_END') &&
      trackThatEnded
    ) {
      // Force the store to reflect the true end-of-track position. RNTP's
      // last `PlaybackProgressUpdated` typically fires before the track
      // finishes (polling cadence), so without this write the store can be
      // left at e.g. 150/200 when the track ends — a visible ~75% progress
      // bar instead of a full one. Using the Subsonic metadata duration
      // (authoritative) keeps MiniPlayer and PlayerProgressBar in lockstep.
      const endDuration = trackThatEnded.duration ?? 0;
      if (endDuration > 0) {
        playerStore.getState().setProgress(endDuration, endDuration, endDuration);
      }
      addCompletedScrobble(trackThatEnded, trackPlaylistMap.get(trackThatEnded.id));
    }

    // If savedTrackForScrobble was null, we fired before ActiveTrackChanged —
    // tell the upcoming ActiveTrackChanged not to save a stale reference.
    if (savedTrackForScrobble == null) {
      scrobbleHandledByEnded = true;
    }
    savedTrackForScrobble = null;
  });

  // Belt-and-braces: iOS RNTP also emits PlaybackQueueEnded after the last
  // track in the queue finishes. Pin progress to the end in case the
  // PlaybackEndedWithReason path was skipped (queue-setup guards, platform
  // quirks). Same "store is the only source of truth" contract.
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    const currentTrack = playerStore.getState().currentTrack;
    const endDuration = currentTrack?.duration ?? 0;
    if (endDuration > 0) {
      playerStore.getState().setProgress(endDuration, endDuration, endDuration);
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track, index: activeIndex }) => {
    const sameTrack =
      previousActiveChild?.id != null && previousActiveChild?.id === track?.id;

    // During stream recovery (load() with timeOffset) the active track
    // may fire with the same ID — don't scrobble, don't reset offset.
    if (isRecoveringStream && sameTrack) {
      maxBufferedSeen = 0;
      isFullyBuffered = false;
      return;
    }

    // During a shuffle or queue replacement (playTrack) RNTP may fire a
    // transient null-track event from reset() — ignore it so the tablet
    // panel stays open and the UI doesn't flicker.
    if ((isShuffling || isSettingQueue) && (track == null || !track.id)) {
      return;
    }

    // --- Scrobble coordination: save the outgoing track for EndedWithReason ---
    if (!isSettingQueue && !isShuffling && !isRecoveringStream) {
      if (scrobbleHandledByEnded) {
        // EndedWithReason already fired first for this transition and
        // consumed previousActiveChild — don't save a stale reference.
        scrobbleHandledByEnded = false;
      } else {
        // We fired first — snapshot the outgoing track so EndedWithReason
        // can read it even though previousActiveChild is about to change.
        savedTrackForScrobble = previousActiveChild;
      }
    }

    maxBufferedSeen = 0;
    isFullyBuffered = false;

    // Reset recovery state for genuine track changes.
    positionOffset = 0;
    rawRecoveryAttempts = 0;

    let resolvedChild: Child | null = null;
    if (track != null && track.id) {
      resolvedChild = currentChildQueue.find((c) => c.id === track.id) ?? null;
      playerStore.getState().setCurrentTrack(resolvedChild, activeIndex ?? null);

      // Scrobble: send "now playing" for the new track.
      if (resolvedChild) {
        sendNowPlaying(resolvedChild, trackPlaylistMap.get(resolvedChild.id));
      }
    } else {
      playerStore.getState().setCurrentTrack(null, null);
    }

    previousActiveChild = resolvedChild;

    if (!isSettingQueue && !isShuffling && activeIndex != null) {
      persistQueue(currentChildQueue, activeIndex);
    }
  });

  // --- Sleep timer event listeners ---

  let sleepTimerInterval: ReturnType<typeof setInterval> | null = null;

  TrackPlayer.addEventListener(Event.SleepTimerChanged, (e) => {
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    const store = sleepTimerStore.getState();
    if (e.active) {
      store.setTimer(e.endTime ?? null, e.endOfTrack);
      if (!e.endOfTrack && e.endTime != null) {
        // Start JS-side countdown for UI display
        const tick = () => {
          const now = Date.now() / 1000;
          const remaining = Math.max(0, Math.round((e.endTime as number) - now));
          sleepTimerStore.getState().setRemaining(remaining);
        };
        tick();
        sleepTimerInterval = setInterval(tick, 1000);
      } else {
        store.setRemaining(null);
      }
    } else {
      store.clear();
    }
  });

  TrackPlayer.addEventListener(Event.SleepTimerComplete, () => {
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    sleepTimerStore.getState().clear();
  });

  // --- AppState listener for background → foreground sync ---

  const handleAppState = async (next: AppStateStatus) => {
    if (next === 'active') {
      await syncStoreFromNative();
    } else {
      const { position, currentTrack } = playerStore.getState();
      if (currentTrack?.id && position > 0) {
        flushPosition(position, currentTrack.id);
      }
    }
  };
  AppState.addEventListener('change', handleAppState);

  isPlayerReady = true;

  // --- Restore persisted queue from previous session ---
  //
  // restorePersistedQueue() populates the Zustand store synchronously so the
  // MiniPlayer can render immediately. If it returns true, a previously
  // active queue exists; kick off the async hydration sequence which loads
  // tracks into RNTP in a muted, paused, seek-positioned state so the first
  // user tap plays without negotiating any native-layer uncertainty.
  const needsHydration = restorePersistedQueue();
  if (needsHydration) {
    hydrationPromise = hydrateRestoredQueue().finally(() => {
      hydrationPromise = null;
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Sync helper                                                        */
/* ------------------------------------------------------------------ */

/** Query RNTP for current state/track/progress and push into the store. */
async function syncStoreFromNative(): Promise<void> {
  try {
    const state = await TrackPlayer.getPlaybackState();
    playerStore.getState().setPlaybackState(mapState(state.state));

    const activeTrack = await TrackPlayer.getActiveTrack();
    const activeTrackIndex = await TrackPlayer.getActiveTrackIndex();

    // Detect missed track transitions (e.g. native auto-advanced in
    // background but the JS event was deferred).  This is a safety net —
    // if the native fixes work correctly, this should never trigger.
    const storeTrackIndex = playerStore.getState().currentTrackIndex;
    if (
      activeTrackIndex !== undefined &&
      activeTrackIndex !== null &&
      activeTrackIndex !== storeTrackIndex
    ) {
      console.warn(
        `[Player] Detected background track transition: store=${storeTrackIndex}, native=${activeTrackIndex}`,
      );
    }

    if (activeTrack?.id) {
      const child = currentChildQueue.find((c) => c.id === activeTrack.id) ?? null;
      playerStore.getState().setCurrentTrack(child, activeTrackIndex ?? null);
    }

    const { position, duration, buffered } = await TrackPlayer.getProgress();

    if (isFullyBuffered) {
      const metaDuration =
        playerStore.getState().currentTrack?.duration ?? 0;
      maxBufferedSeen = Math.max(
        maxBufferedSeen, metaDuration, duration, buffered, position
      );
    } else {
      maxBufferedSeen = Math.max(maxBufferedSeen, buffered, position);
    }
    const adjustedPosition = position + positionOffset;
    playerStore.getState().setProgress(adjustedPosition, duration, maxBufferedSeen);
  } catch {
    // Player may not be ready yet; ignore.
  }
}

/**
 * Restore the persisted queue from a previous session.
 *
 * Called once during initPlayer(). Populates the Zustand store and
 * module-level currentChildQueue so the MiniPlayer renders immediately.
 * Does NOT touch RNTP — that's the job of the async hydrateRestoredQueue()
 * that initPlayer() kicks off next.
 *
 * @returns true when a non-empty persisted queue was restored (caller
 *   should start async hydration); false otherwise.
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

    previousActiveChild = currentChild;
    return true;
  } catch (e) {
    console.warn('[Player] Failed to restore persisted queue:', e);
    return false;
  }
}

/**
 * Load the restored queue into RNTP with a bulletproof mute → load → seek
 * → pause → unmute sequence.
 *
 * Called from initPlayer() right after restorePersistedQueue() seeds the
 * JS store. Runs while the splash screen / boot is still visible so the
 * user never sees a tap-to-play latency.
 *
 * Sequence rationale:
 *   1. Wait for prerequisites (track maps + cover-art auth) so childToTrack
 *      sees local URIs for downloaded songs — without this, a race against
 *      populateTrackMapsAsync() produces server URLs that stall offline.
 *   2. reset() again to guarantee a clean native queue even if initPlayer's
 *      post-setup reset somehow left residue. withTimeout prevents a wedged
 *      native player from blocking hydration forever.
 *   3. Mute — muscle-memory defence against any native state where add()
 *      or seekTo() could produce a momentary audible artefact.
 *   4. add() the tracks and verify via getQueue() that they landed. One
 *      retry on length mismatch; if it still fails, surface a toast and
 *      bail cleanly so the UI doesn't lie about the queue state.
 *   5. Position the queue with skip(startIndex) and seekTo(resumePosition).
 *   6. pause() explicitly — never rely on default state. The user's first
 *      play() call then has a single known starting point.
 *   7. Unmute — the next play() will be at normal volume.
 */
async function hydrateRestoredQueue(): Promise<void> {
  const resume = pendingResumePosition;
  pendingResumePosition = null;

  try {
    // 1. Prerequisites.
    await waitForTrackMapsReady();
    await ensureCoverArtAuth();

    const originalIndex = playerStore.getState().currentTrackIndex ?? 0;
    const originalChild = currentChildQueue[originalIndex] ?? null;

    const { rnTracks, filteredQueue } = buildPlayableQueue(currentChildQueue);

    if (rnTracks.length === 0) {
      // Nothing in the restored queue is playable right now (offline + no
      // cached files). Surface a toast and clear the stale queue so the
      // MiniPlayer doesn't linger on an unplayable track. Call the
      // internal helper — clearQueue() would deadlock awaiting us.
      playbackToastStore.getState().fail(i18n.t('noOfflineTracksInQueue'));
      await clearPlayerStateInternal();
      return;
    }

    const pruned = filteredQueue.length !== currentChildQueue.length;
    if (pruned) {
      currentChildQueue = filteredQueue;
      playerStore.getState().setQueue(filteredQueue);
    }

    // Translate the restored current-track onto the filtered queue. If the
    // desired track was dropped (non-cached offline), fall back to 0.
    let startIndex = 0;
    if (originalChild) {
      const idx = filteredQueue.findIndex((c) => c.id === originalChild.id);
      if (idx !== -1) startIndex = idx;
    }

    // 2. Pre-load clean slate.
    try {
      await withTimeout(() => TrackPlayer.reset(), 2000);
    } catch {
      // Reset failed — continue; add() below will surface a real problem
      // via the length-verification retry.
    }
    await new Promise((r) => setTimeout(r, 100));

    // 3. Mute (belt-and-braces).
    await TrackPlayer.setVolume(0);

    // 4. Load + verify. RNTP add() sometimes resolves before the native
    //    queue is fully populated, or silently drops tracks when the native
    //    layer is in a degraded post-zombie state. Check getQueue() length
    //    and retry once with a fresh reset if it doesn't match.
    let loaded = await loadTracksWithVerification(rnTracks);
    if (!loaded) {
      try {
        await withTimeout(() => TrackPlayer.reset(), 2000);
      } catch {
        /* best-effort teardown before retry */
      }
      await new Promise((r) => setTimeout(r, 100));
      loaded = await loadTracksWithVerification(rnTracks);
    }
    if (!loaded) {
      // The native player is refusing to accept the queue. Surface a
      // failure so the user isn't stuck with a visibly-restored but
      // unplayable queue, and unmute so the next action isn't silent.
      // Internal helper — clearQueue() would deadlock awaiting us.
      await TrackPlayer.setVolume(1).catch(() => {});
      playbackToastStore.getState().fail(i18n.t('playbackError'));
      await clearPlayerStateInternal();
      return;
    }

    // 5. Position.
    if (startIndex > 0) {
      await TrackPlayer.skip(startIndex);
    }
    if (
      resume &&
      filteredQueue[startIndex]?.id === resume.trackId &&
      resume.position > 0
    ) {
      await TrackPlayer.seekTo(resume.position);
    }

    // 6. Quiesce to a single known state: paused at the target position.
    //    add() + skip() + seekTo() don't auto-play, but RNTP has historical
    //    bugs where zombie native state reports Playing — pause() here
    //    means the user's first play() has no variability to negotiate.
    await TrackPlayer.pause();

    // 7. Unmute.
    await TrackPlayer.setVolume(1);

    if (pruned) {
      persistQueue(filteredQueue, startIndex);
    }
  } catch (e) {
    console.warn('[Player] Queue hydration failed:', e);
    // Restore the volume so a future play() is audible even if hydration
    // bailed mid-sequence.
    await TrackPlayer.setVolume(1).catch(() => {});
    throw e;
  }
}

/**
 * Call TrackPlayer.add(rnTracks) and confirm via getQueue() that every
 * track landed. Returns true when the native queue length matches, false
 * when the add was partial or the verification call itself failed.
 */
async function loadTracksWithVerification(rnTracks: Track[]): Promise<boolean> {
  try {
    await TrackPlayer.add(rnTracks);
  } catch (e) {
    console.warn('[Player] TrackPlayer.add() rejected:', e);
    return false;
  }
  try {
    const queue = await TrackPlayer.getQueue();
    return queue.length >= rnTracks.length;
  } catch (e) {
    console.warn('[Player] TrackPlayer.getQueue() failed post-add:', e);
    return false;
  }
}

/**
 * Await the in-flight hydration promise (if any) before proceeding.
 *
 * Called by every public API entry point that touches RNTP. When no
 * hydration is pending this is a near-free no-op. Swallows rejections —
 * if hydration failed, clearQueue() has already been called so there's
 * no stale queue to worry about, and the caller can surface its own
 * follow-up error.
 */
async function awaitHydration(): Promise<void> {
  if (hydrationPromise) {
    try {
      await hydrationPromise;
    } catch {
      /* hydration failed; clearQueue() already cleaned up */
    }
  }
}

/** Reset scrobble coordination state (call before queue-level operations). */
function resetScrobbleCoordination() {
  savedTrackForScrobble = null;
  scrobbleHandledByEnded = false;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Start playing a track from a given queue.
 *
 * Resets the RNTP queue, loads all tracks, skips to the tapped index,
 * and begins playback.
 *
 * @param sourcePlaylistId  When playback originates from a playlist,
 *   pass its ID so per-track scrobble exclusions work correctly.
 */
export async function playTrack(
  track: Child,
  queue: Child[],
  sourcePlaylistId?: string | null,
): Promise<void> {
  // Wait out any in-flight cold-start rehydration. playTrack replaces the
  // queue outright, so racing an eager hydration would leave either half
  // overwritten.
  await awaitHydration();

  resetScrobbleCoordination();
  isSettingQueue = true;
  positionOffset = 0;
  pendingResumePosition = null;
  playerStore.getState().setQueueLoading(true);

  try {
    // Populate trackUriMap before deciding which tracks are playable so
    // a tap right after cold launch doesn't downgrade a downloaded song
    // to a server URL.
    await waitForTrackMapsReady();
    await ensureCoverArtAuth();

    const { rnTracks, filteredQueue } = buildPlayableQueue(queue);

    if (rnTracks.length === 0) {
      playbackToastStore.getState().fail(i18n.t('noOfflineTracksInQueue'));
      await clearQueue();
      return;
    }

    currentChildQueue = filteredQueue;
    trackPlaylistMap.clear();
    if (sourcePlaylistId) {
      for (const child of filteredQueue) trackPlaylistMap.set(child.id, sourcePlaylistId);
    }
    playerStore.getState().setQueue(filteredQueue);

    // Stamp effective format for each track in the queue.
    const formats: Record<string, EffectiveFormat> = {};
    for (const child of filteredQueue) formats[child.id] = stampQueueFormat(child);
    playerStore.getState().setQueueFormats(formats);

    // Translate the tapped track onto the filtered queue. If the tapped
    // track isn't playable (non-cached + offline), start at 0 rather
    // than blocking — users expect something to happen.
    let startIndex = filteredQueue.findIndex((c) => c.id === track.id);
    if (startIndex === -1) startIndex = 0;

    await TrackPlayer.reset();
    await TrackPlayer.add(rnTracks);

    if (startIndex > 0) {
      await TrackPlayer.skip(startIndex);
    }

    await TrackPlayer.play();
    persistQueue(filteredQueue, startIndex);
  } catch (e) {
    playbackToastStore.getState().fail(
      e instanceof Error ? e.message : i18n.t('playbackError'),
    );
  } finally {
    isSettingQueue = false;
    playerStore.getState().setQueueLoading(false);
  }
}

/** Toggle between play and pause. */
export async function togglePlayPause(): Promise<void> {
  await awaitHydration();

  const state = await TrackPlayer.getPlaybackState();
  if (state.state === State.Playing) {
    await TrackPlayer.pause();
  } else {
    await TrackPlayer.play();
  }
}

/** Skip to the next track in the queue. */
export async function skipToNext(): Promise<void> {
  await awaitHydration();
  await TrackPlayer.skipToNext();
}

/** Skip to the previous track in the queue. */
export async function skipToPrevious(): Promise<void> {
  await awaitHydration();
  await TrackPlayer.skipToPrevious();
}

/** Whether skip-to-next is possible given current queue position and repeat mode. */
export function canSkipToNext(): boolean {
  const { currentTrackIndex, queue } = playerStore.getState();
  const { repeatMode } = playbackSettingsStore.getState();
  if (currentTrackIndex == null || queue.length === 0) return false;
  if (repeatMode !== 'off') return true;
  return currentTrackIndex < queue.length - 1;
}

/** Whether skip-to-previous is possible. Always true when a track is loaded,
 *  since the native layer will restart the current track if there is no previous. */
export function canSkipToPrevious(): boolean {
  const { currentTrackIndex, queue } = playerStore.getState();
  return currentTrackIndex != null && queue.length > 0;
}

/**
 * Seek to a position in seconds.
 *
 * On transcoded streams (non-raw format or bitrate-limited) whose native
 * duration is reported as 0, the native player cannot seek beyond the
 * buffered range via HTTP Range requests.  In that case we clamp the
 * seek to just inside the end of the buffered range so the user gets as
 * close as possible without the seek silently failing.
 */
export async function seekTo(position: number): Promise<void> {
  await awaitHydration();

  // Convert the UI-level position (which may include a recovery offset)
  // back to the native player's timeline.
  const nativeTarget = Math.max(0, position - positionOffset);

  // If the entire stream has been downloaded, seek freely — all data is
  // available even if the native player doesn't report it.
  if (isFullyBuffered) {
    await TrackPlayer.seekTo(nativeTarget);
    const store = playerStore.getState();
    store.setProgress(position, store.duration, maxBufferedSeen);
    return;
  }

  const { duration, buffered, position: currentPos } = await TrackPlayer.getProgress();
  // Use the high-water mark so we never clamp tighter than what was
  // previously known to be available.
  const effectiveBuffered = Math.max(maxBufferedSeen, buffered, currentPos);

  // Only apply the clamp when ALL of these are true:
  //  1. The native player reports duration as 0 (transcoded stream without
  //     reliable duration metadata).
  //  2. The stream is transcoded (non-raw format or bitrate-limited).
  //  3. The seek target is beyond the effective buffered range.
  if (duration === 0 && nativeTarget > effectiveBuffered && effectiveBuffered > 0) {
    const { streamFormat, maxBitRate } = playbackSettingsStore.getState();
    const isTranscoding = streamFormat !== 'raw' || maxBitRate != null;

    if (isTranscoding) {
      await TrackPlayer.seekTo(effectiveBuffered - 1);
      const store = playerStore.getState();
      store.setProgress((effectiveBuffered - 1) + positionOffset, store.duration, maxBufferedSeen);
      return;
    }
  }

  await TrackPlayer.seekTo(nativeTarget);
  const store = playerStore.getState();
  store.setProgress(position, store.duration, maxBufferedSeen);
}

/** Skip to a specific track in the queue by index. */
export async function skipToTrack(index: number): Promise<void> {
  await awaitHydration();
  await TrackPlayer.skip(index);
  await TrackPlayer.play();
}

/**
 * Skip forward or backward by a relative number of seconds.
 *
 * Positive values skip forward, negative values skip backward.
 * Delegates to `seekTo()` so transcoded stream clamping is applied.
 */
export async function skipByInterval(seconds: number): Promise<void> {
  const { position, duration } = playerStore.getState();
  const target = Math.max(0, Math.min(position + seconds, duration || Infinity));
  await seekTo(target);
}

/**
 * Update RNTP remote capabilities based on the user's preference.
 *
 * In 'skip-track' mode the lock screen / notification shows next/previous
 * track buttons. In 'skip-interval' mode it shows jump forward/backward
 * buttons with the configured intervals.
 */
export async function updateRemoteCapabilities(): Promise<void> {
  const { remoteControlMode, skipForwardInterval, skipBackwardInterval } =
    playbackSettingsStore.getState();

  const baseCapabilities = [
    Capability.Play,
    Capability.Pause,
    Capability.Stop,
    Capability.SeekTo,
  ];

  const capabilities =
    remoteControlMode === 'skip-interval'
      ? [...baseCapabilities, Capability.JumpForward, Capability.JumpBackward]
      : [...baseCapabilities, Capability.SkipToNext, Capability.SkipToPrevious];

  await TrackPlayer.updateOptions({
    capabilities,
    notificationCapabilities: capabilities,
    forwardJumpInterval: skipForwardInterval,
    backwardJumpInterval: skipBackwardInterval,
    progressUpdateEventInterval: 0.25,
    android: {
      appKilledPlaybackBehavior:
        AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    },
  });
}

/** Clear the current error and attempt to resume playback. */
export async function retryPlayback(): Promise<void> {
  await awaitHydration();
  playerStore.getState().setError(null);
  await TrackPlayer.play();
}

/**
 * Internal clear-state helper. Does the actual work without awaiting
 * hydrationPromise so hydrateRestoredQueue() can bail out cleanly when
 * its queue is entirely unplayable (calling clearQueue() from inside the
 * hydration body would otherwise deadlock on its own promise).
 */
async function clearPlayerStateInternal(): Promise<void> {
  resetScrobbleCoordination();
  positionOffset = 0;
  rawRecoveryAttempts = 0;
  pendingResumePosition = null;
  maxBufferedSeen = 0;
  isFullyBuffered = false;
  isRecoveringStream = false;
  previousActiveChild = null;
  currentChildQueue = [];
  trackPlaylistMap.clear();

  // Native RNTP.reset() is normally synchronous, but if the active track
  // is stalled on an unreachable stream URL the native teardown can block.
  // Cap the await so the store cleanup below always runs — the user's tap
  // must be visibly respected even when the native player is wedged.
  try {
    await withTimeout(() => TrackPlayer.reset(), 2000);
  } catch {
    /* RNTP reset failed — fall through to store cleanup anyway. */
  }
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

/**
 * Stop playback, clear the queue, and reset all player state to defaults.
 *
 * Resets both the native RNTP player and the Zustand store so the UI
 * returns to its idle state (MiniPlayer hidden, no current track).
 */
export async function clearQueue(): Promise<void> {
  // Wait for any in-flight cold-start hydration so its mid-sequence
  // reset/add/seek/pause can't race our teardown and leave RNTP with a
  // queue the store has already cleared.
  await awaitHydration();
  await clearPlayerStateInternal();
}

/**
 * Append one or more tracks to the end of the current play queue.
 *
 * If the queue is empty (nothing loaded), this starts playback from the
 * first track in the supplied array.  Otherwise the tracks are silently
 * appended and playback continues uninterrupted.
 */
export async function addToQueue(
  tracks: Child[],
  sourcePlaylistId?: string | null,
): Promise<void> {
  if (tracks.length === 0) return;

  await awaitHydration();

  // Nothing loaded yet – start fresh playback with these tracks.
  if (currentChildQueue.length === 0) {
    await playTrack(tracks[0], tracks, sourcePlaylistId);
    return;
  }

  await waitForTrackMapsReady();
  await ensureCoverArtAuth();

  const { rnTracks, filteredQueue: playable } = buildPlayableQueue(tracks);

  if (rnTracks.length === 0) {
    playbackToastStore.getState().fail(i18n.t('noOfflineTracksInQueue'));
    return;
  }

  await TrackPlayer.add(rnTracks);

  if (sourcePlaylistId) {
    for (const child of playable) trackPlaylistMap.set(child.id, sourcePlaylistId);
  }

  // Stamp format for each appended track using current settings.
  for (const child of playable) {
    playerStore.getState().addQueueFormat(child.id, stampQueueFormat(child));
  }

  currentChildQueue = [...currentChildQueue, ...playable];
  playerStore.getState().setQueue(currentChildQueue);
  persistQueue(currentChildQueue, playerStore.getState().currentTrackIndex ?? 0);
}

/**
 * Remove a track from the play queue by its index.
 *
 * Handles the edge case where the removed track is the currently playing
 * track – RNTP will automatically advance to the next track.  If the
 * removed track is the last one in the queue the player is cleared.
 */
export async function removeFromQueue(index: number): Promise<void> {
  await awaitHydration();

  if (index < 0 || index >= currentChildQueue.length) return;

  // If this is the only track, just clear everything.
  if (currentChildQueue.length === 1) {
    await clearQueue();
    return;
  }

  const removedChild = currentChildQueue[index];
  await TrackPlayer.remove(index);

  trackPlaylistMap.delete(removedChild.id);
  currentChildQueue = currentChildQueue.filter((_, i) => i !== index);
  playerStore.getState().setQueue(currentChildQueue);

  // When a track before the currently playing track is removed, RNTP
  // shifts its internal index but won't fire PlaybackActiveTrackChanged
  // (the active track itself didn't change). Adjust our stored index so
  // it continues to point at the correct track.
  const { currentTrackIndex } = playerStore.getState();
  if (currentTrackIndex != null && index < currentTrackIndex) {
    playerStore.getState().setCurrentTrack(
      playerStore.getState().currentTrack,
      currentTrackIndex - 1,
    );
  }
  persistQueue(currentChildQueue, playerStore.getState().currentTrackIndex ?? 0);
}

/**
 * Remove all non-downloaded tracks from the play queue.
 *
 * Called when entering offline mode (manual or auto) so that only
 * locally available tracks remain. Iterates in reverse to avoid
 * index shifting issues. If all tracks are removed, clears the queue.
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

/**
 * Cycle the repeat mode: off → all → one → off.
 *
 * Updates both the persisted store and the native RNTP player.
 */
export async function cycleRepeatMode(): Promise<void> {
  const current = playbackSettingsStore.getState().repeatMode;
  const next: RepeatModeSetting =
    current === 'off' ? 'all' : current === 'all' ? 'one' : 'off';
  playbackSettingsStore.getState().setRepeatMode(next);
  await TrackPlayer.setRepeatMode(mapRepeatMode(next));
}

/**
 * Cycle the playback rate through the predefined steps.
 *
 * 0.5 → 0.75 → 1 → 1.25 → 1.5 → 2 → 0.5 …
 *
 * Updates both the persisted store and the native RNTP player.
 */
export async function cyclePlaybackRate(): Promise<void> {
  const current = playbackSettingsStore.getState().playbackRate;
  const currentIndex = PLAYBACK_RATES.indexOf(current);
  const nextIndex = (currentIndex + 1) % PLAYBACK_RATES.length;
  const next: PlaybackRate = PLAYBACK_RATES[nextIndex];
  playbackSettingsStore.getState().setPlaybackRate(next);
  await TrackPlayer.setRate(next);
}

/**
 * Shuffle the current queue using Fisher-Yates, then reload RNTP and
 * start playback from the first track of the new order.
 */
/**
 * Eagerly bump local play stats for a just-scrobbled song on the ephemeral
 * player copies. Updates every matching entry in the module-scope
 * `currentChildQueue` (repeat-one and queues that include the song
 * multiple times get all entries bumped) and the `playerStore.currentTrack`
 * copy if it's the scrobbled song.
 *
 * Called from `playStatsService.applyLocalPlay` as part of the scrobble-time
 * fan-out so the player-view info panel reflects the new count immediately,
 * before any server round-trip.
 */
export function applyLocalPlayToPlayer(songId: string, now: string): void {
  // Walk currentChildQueue and replace any matching entries. Repeat-one
  // means the same song may appear once but a user could have added the
  // same song multiple times manually; cover both.
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

  // Update the store's currentTrack if it's the scrobbled song — this is
  // what AlbumInfoContent in the player view reads from, so the info
  // panel must see the bump immediately on repeat-one and on the brief
  // window between PlaybackEndedWithReason and PlaybackActiveTrackChanged.
  // Use setState directly (not setCurrentTrack) to avoid clobbering the
  // existing currentTrackIndex — setCurrentTrack resets it to null when
  // the caller omits the second argument.
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

// Wire the ephemeral player-state updater into playStatsService. Inverts
// the dependency so `playStatsService` no longer imports `playerService`,
// breaking the playerService ↔ scrobbleService ↔ playStatsService cycle.
registerPlayerPlayStatListener(applyLocalPlayToPlayer);

export async function shuffleQueue(): Promise<void> {
  await awaitHydration();

  if (currentChildQueue.length < 2) return;

  resetScrobbleCoordination();
  isSettingQueue = true;
  isShuffling = true;
  positionOffset = 0;
  maxBufferedSeen = 0;
  isFullyBuffered = false;

  try {
    await TrackPlayer.pause();

    const shuffled = shuffleArray(currentChildQueue);
    const { rnTracks, filteredQueue } = buildPlayableQueue(shuffled);

    if (rnTracks.length === 0) {
      playbackToastStore.getState().fail(i18n.t('noOfflineTracksInQueue'));
      await clearQueue();
      return;
    }

    currentChildQueue = filteredQueue;
    playerStore.getState().setQueue(filteredQueue);

    // Replace the RNTP queue atomically, skip to the first track, and play.
    await TrackPlayer.setQueue(rnTracks);
    await TrackPlayer.skip(0);
    await TrackPlayer.play();
    persistQueue(filteredQueue, 0);
  } finally {
    isSettingQueue = false;
    isShuffling = false;
  }
}
