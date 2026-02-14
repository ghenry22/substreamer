/**
 * Player service – initialises RNTP, manages the queue, and keeps
 * the Zustand playerStore in sync with the native player state.
 */

import { AppState, type AppStateStatus } from 'react-native';
import TrackPlayer, {
  Capability,
  Event,
  State,
  type Track,
} from 'react-native-track-player';

import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { playerStore, type PlaybackStatus } from '../store/playerStore';
import { serverInfoStore } from '../store/serverInfoStore';
import { addCompletedScrobble, sendNowPlaying } from './scrobbleService';
import {
  ensureCoverArtAuth,
  getCoverArtUrl,
  getStreamUrl,
  type Child,
} from './subsonicService';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/** Convert a Child (Subsonic song) to an RNTP Track object. */
function childToTrack(child: Child): Track {
  return {
    id: child.id,
    url: getStreamUrl(child.id) ?? '',
    title: child.title,
    artist: child.artist ?? 'Unknown Artist',
    album: child.album ?? undefined,
    artwork: getCoverArtUrl(child.coverArt ?? '', 600) ?? undefined,
    duration: child.duration ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let isPlayerReady = false;
/** The Child[] backing the current RNTP queue, indexed by position. */
let currentChildQueue: Child[] = [];
/** Interval handle for progress polling (null when not polling). */
let progressInterval: ReturnType<typeof setInterval> | null = null;
/** Guard flag to prevent duplicate skipToNext calls during end-of-track stall handling. */
let isAutoAdvancing = false;
/**
 * Highest buffered position (in seconds) observed for the current track.
 * The native player sometimes reports a stale or lower `buffered` value
 * even though more data was previously available.  Tracking the high-water
 * mark ensures the UI and seek logic never regress.
 */
let maxBufferedSeen = 0;
/**
 * Set to true when we detect that the native player has finished downloading
 * the entire stream.  Detection: playback position advances past the stalled
 * `buffered` value for several consecutive polls while the player stays in
 * Playing state — the data must be available even though it isn't reported.
 * When true, the effective buffered value is set to the metadata duration so
 * the UI shows 100 % and seeking is unrestricted.
 */
let isFullyBuffered = false;
/** The last raw `buffered` value from RNTP, used to detect stalls. */
let lastRawBuffered = 0;
/** How many consecutive polls position has exceeded the stalled buffered value. */
let positionPastBufferCount = 0;
/** The previously active Child, used for scrobble-on-completion. */
let previousActiveChild: Child | null = null;
/**
 * Set to true before user-initiated track changes (skip, play new queue)
 * so the PlaybackActiveTrackChanged handler can distinguish them from
 * natural auto-advance and avoid scrobbling partially-played tracks.
 */
let isUserSkipping = false;
/**
 * Seconds added to getProgress().position to compensate for transcoded
 * stream recovery.  When we reload a track with `timeOffset`, the native
 * player resets to position 0, but the real song position is `positionOffset`.
 * Reset to 0 on every genuine track change.
 */
let positionOffset = 0;
/** True while we are reloading the current track for stream recovery. */
let isRecoveringStream = false;
/** Consecutive polls where the buffer has not grown (for underrun detection). */
let bufferStallPollCount = 0;

/* ------------------------------------------------------------------ */
/*  Progress polling                                                   */
/* ------------------------------------------------------------------ */

/** Start polling RNTP for playback position every 250ms. */
function startProgressPolling() {
  if (progressInterval) return;
  progressInterval = setInterval(async () => {
    try {
      const { position, duration, buffered } = await TrackPlayer.getProgress();

      // --- Track buffer stall for transcoded stream recovery ----------
      // The native player sometimes stops reporting buffer growth even
      // though data is available.  We track the stall duration here so
      // the PlaybackState Buffering handler can distinguish a real
      // buffer underrun from a normal mid-stream rebuffer.
      const bufferGrowing = buffered > lastRawBuffered + 0.5;

      if (duration === 0 && buffered > 0 && !bufferGrowing) {
        bufferStallPollCount++;
      } else if (bufferGrowing) {
        bufferStallPollCount = 0;
      }

      // --- Detect when the entire stream has been downloaded --------
      if (!isFullyBuffered) {
        if (bufferGrowing) {
          // Buffer is still growing — reset the stall counter.
          lastRawBuffered = buffered;
          positionPastBufferCount = 0;
        } else if (position > lastRawBuffered + 1) {
          // Position has advanced well past the stalled buffer value
          // while playback hasn't stalled — data must be available.
          positionPastBufferCount++;
          // After ~1 s (4 × 250 ms) of this, declare fully buffered.
          if (positionPastBufferCount >= 4) {
            isFullyBuffered = true;
          }
        }
      }

      // --- Compute effective buffered value -------------------------
      if (isFullyBuffered) {
        const metaDuration =
          playerStore.getState().currentTrack?.duration ?? 0;
        maxBufferedSeen = metaDuration > 0
          ? metaDuration
          : Math.max(maxBufferedSeen, buffered, position);
      } else {
        maxBufferedSeen = Math.max(maxBufferedSeen, buffered, position);
      }

      const adjustedPosition = position + positionOffset;
      playerStore.getState().setProgress(adjustedPosition, duration, maxBufferedSeen);
    } catch {
      /* player not ready */
    }
  }, 250);
}

/** Stop the progress polling interval. */
function stopProgressPolling() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

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
    lastRawBuffered = 0;
    positionPastBufferCount = 0;
    bufferStallPollCount = 0;

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
      // On iOS minBuffer maps to AVPlayerItem.preferredForwardBufferDuration
      // and any non-zero value disables automaticallyWaitsToMinimizeStalling,
      // giving us fast playback start.  A very large value tells AVPlayer to
      // keep buffering aggressively until the entire track is downloaded
      // rather than capping at a short window.
      minBuffer: 86400,
      // maxBuffer is Android-only (ExoPlayer); generous value for parity.
      maxBuffer: 300,
      waitForBuffer: true,
    });
  } catch {
    // setupPlayer throws if already initialised (e.g. after a fast refresh).
    // Swallow and continue — the player is usable.
  }

  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.Stop,
      Capability.SeekTo,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause],
  });

  // --- Event listeners that push state into the Zustand store ---

  TrackPlayer.addEventListener(Event.PlaybackState, async ({ state }) => {
    const store = playerStore.getState();
    store.setPlaybackState(mapState(state));

    if (state === State.Playing) {
      // Clear any previous error when playback resumes successfully.
      if (store.error) store.setError(null);
      isAutoAdvancing = false;
      startProgressPolling();
    } else if (state === State.Buffering || state === State.Loading) {
      // Keep polling during buffering so the UI can show buffer progress.
      startProgressPolling();

      if (state === State.Buffering && !isAutoAdvancing && !isRecoveringStream) {
        try {
          const { position, duration } = await TrackPlayer.getProgress();
          const adjustedPos = position + positionOffset;
          const metadataDuration = store.currentTrack?.duration ?? 0;
          const effectiveDuration =
            duration > 0 ? duration : metadataDuration;

          // --- Transcoded stream buffer underrun recovery ---------------
          // When the native player enters Buffering on a transcoded stream
          // (duration === 0) whose buffer has been stalled and position has
          // caught up, it will re-fetch the URL and the server will
          // transcode from second 0.  Recover with timeOffset so the
          // server resumes from the correct position.
          if (
            duration === 0 &&
            position > 5 &&
            lastRawBuffered > 10 &&
            bufferStallPollCount >= 12 &&
            position >= lastRawBuffered - 2 &&
            adjustedPos < effectiveDuration - 5
          ) {
            isRecoveringStream = true;
            recoverTranscodedStream(adjustedPos);
            return;
          }

          // --- End-of-track stall detection -----------------------------
          // When the server sends an estimated Content-Length that exceeds
          // the real audio data, the native player stalls in Buffering
          // instead of firing State.Ended.  If the current position is at
          // or past the metadata duration we treat it as track-complete
          // and skip forward.
          if (effectiveDuration > 0 && adjustedPos >= effectiveDuration - 2) {
            isAutoAdvancing = true;
            await TrackPlayer.skipToNext().catch(() => {
              // No next track in queue — stop playback.
              isAutoAdvancing = false;
              TrackPlayer.stop();
            });
          }
        } catch {
          /* progress not available yet — ignore */
        }
      }
    } else {
      stopProgressPolling();
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    const message =
      (e as { message?: string }).message ?? 'Playback error occurred';
    playerStore.getState().setError(message);
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
    const sameTrack =
      previousActiveChild?.id != null && previousActiveChild?.id === track?.id;

    // During stream recovery (load() with timeOffset) the active track
    // may fire with the same ID — don't scrobble, don't reset offset.
    if (isRecoveringStream && sameTrack) {
      maxBufferedSeen = 0;
      isFullyBuffered = false;
      lastRawBuffered = 0;
      positionPastBufferCount = 0;
      bufferStallPollCount = 0;
      return;
    }

    // Scrobble: if the previous track finished naturally (not a user skip),
    // record it as a completed scrobble.
    if (previousActiveChild && !isUserSkipping) {
      addCompletedScrobble(previousActiveChild);
    }

    maxBufferedSeen = 0;
    isFullyBuffered = false;
    lastRawBuffered = 0;
    positionPastBufferCount = 0;
    bufferStallPollCount = 0;

    // Reset transcoded stream recovery offset for genuine track changes.
    positionOffset = 0;

    let resolvedChild: Child | null = null;
    if (track != null && track.id) {
      resolvedChild = currentChildQueue.find((c) => c.id === track.id) ?? null;
      playerStore.getState().setCurrentTrack(resolvedChild);

      // Scrobble: send "now playing" for the new track.
      sendNowPlaying(track.id);
    } else {
      playerStore.getState().setCurrentTrack(null);
    }

    previousActiveChild = resolvedChild;
    isUserSkipping = false;
  });

  // --- AppState listener for background → foreground sync ---

  const handleAppState = async (next: AppStateStatus) => {
    if (next === 'active') {
      await syncStoreFromNative();
    }
  };
  AppState.addEventListener('change', handleAppState);

  isPlayerReady = true;
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
    if (activeTrack?.id) {
      const child = currentChildQueue.find((c) => c.id === activeTrack.id) ?? null;
      playerStore.getState().setCurrentTrack(child);
    }

    const { position, duration, buffered } = await TrackPlayer.getProgress();

    if (isFullyBuffered) {
      const metaDuration =
        playerStore.getState().currentTrack?.duration ?? 0;
      maxBufferedSeen = metaDuration > 0
        ? metaDuration
        : Math.max(maxBufferedSeen, buffered, position);
    } else {
      maxBufferedSeen = Math.max(maxBufferedSeen, buffered, position);
    }
    const adjustedPosition = position + positionOffset;
    playerStore.getState().setProgress(adjustedPosition, duration, maxBufferedSeen);

    if (
      state.state === State.Playing ||
      state.state === State.Buffering ||
      state.state === State.Loading
    ) {
      startProgressPolling();
    } else {
      stopProgressPolling();
    }
  } catch {
    // Player may not be ready yet; ignore.
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Start playing a track from a given queue.
 *
 * Resets the RNTP queue, loads all tracks, skips to the tapped index,
 * and begins playback.
 */
export async function playTrack(track: Child, queue: Child[]): Promise<void> {
  isUserSkipping = true;
  positionOffset = 0;
  playerStore.getState().setQueueLoading(true);

  try {
    await ensureCoverArtAuth();

    currentChildQueue = queue;
    playerStore.getState().setQueue(queue);

    const rnTracks = queue.map(childToTrack);
    const startIndex = queue.findIndex((c) => c.id === track.id);

    await TrackPlayer.reset();
    await TrackPlayer.add(rnTracks);

    if (startIndex > 0) {
      await TrackPlayer.skip(startIndex);
    }

    await TrackPlayer.play();
  } finally {
    playerStore.getState().setQueueLoading(false);
  }
}

/** Toggle between play and pause. */
export async function togglePlayPause(): Promise<void> {
  const state = await TrackPlayer.getPlaybackState();
  if (state.state === State.Playing) {
    await TrackPlayer.pause();
  } else {
    await TrackPlayer.play();
  }
}

/** Skip to the next track in the queue. */
export async function skipToNext(): Promise<void> {
  isUserSkipping = true;
  await TrackPlayer.skipToNext();
}

/** Skip to the previous track in the queue. */
export async function skipToPrevious(): Promise<void> {
  isUserSkipping = true;
  await TrackPlayer.skipToPrevious();
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
  // Convert the UI-level position (which may include a recovery offset)
  // back to the native player's timeline.
  const nativeTarget = Math.max(0, position - positionOffset);

  // If the entire stream has been downloaded, seek freely — all data is
  // available even if the native player doesn't report it.
  if (isFullyBuffered) {
    await TrackPlayer.seekTo(nativeTarget);
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
      return;
    }
  }

  await TrackPlayer.seekTo(nativeTarget);
}

/** Skip to a specific track in the queue by index. */
export async function skipToTrack(index: number): Promise<void> {
  isUserSkipping = true;
  await TrackPlayer.skip(index);
  await TrackPlayer.play();
}

/** Clear the current error and attempt to resume playback. */
export async function retryPlayback(): Promise<void> {
  playerStore.getState().setError(null);
  await TrackPlayer.play();
}
