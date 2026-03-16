/**
 * Player service – initialises RNTP, manages the queue, and keeps
 * the Zustand playerStore in sync with the native player state.
 */

import { AppState, type AppStateStatus } from 'react-native';
import TrackPlayer, {
  Capability,
  Event,
  IOSCategory,
  RepeatMode,
  State,
  type Track,
} from 'react-native-track-player';

import {
  PLAYBACK_RATES,
  playbackSettingsStore,
  type PlaybackRate,
  type RepeatModeSetting,
} from '../store/playbackSettingsStore';
import { playbackToastStore } from '../store/playbackToastStore';
import { playerStore, type PlaybackStatus } from '../store/playerStore';
import { serverInfoStore } from '../store/serverInfoStore';
import { addCompletedScrobble, sendNowPlaying } from './scrobbleService';
import { getCachedImageUri } from './imageCacheService';
import { getLocalTrackUri } from './musicCacheService';
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

/** Convert a Child (Subsonic song) to an RNTP Track object. */
function childToTrack(child: Child): Track {
  const localUri = getLocalTrackUri(child.id);
  const cachedArt = getCachedImageUri(child.coverArt ?? '', 600);
  const contentType = localUri ? mimeFromUri(localUri) : undefined;
  return {
    id: child.id,
    url: localUri ?? getStreamUrl(child.id) ?? '',
    title: child.title,
    artist: child.artist ?? 'Unknown Artist',
    album: child.album ?? undefined,
    artwork: cachedArt ?? getCoverArtUrl(child.coverArt ?? '', 600) ?? undefined,
    duration: child.duration ?? 0,
    ...(contentType ? { contentType } : {}),
  };
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
/** True while the queue is being shuffled, to guard event handlers. */
let isShuffling = false;
/**
 * True during multi-step queue operations (playTrack, shuffleQueue) where
 * multiple PlaybackActiveTrackChanged events fire for a single user action.
 * Prevents intermediate tracks from being falsely scrobbled.
 */
let isSettingQueue = false;


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
    // Native progress events at 250ms interval, replacing JS-side polling.
    progressUpdateEventInterval: 0.25,
  });

  // Apply persisted playback settings to the native player.
  const settings = playbackSettingsStore.getState();
  await TrackPlayer.setRepeatMode(mapRepeatMode(settings.repeatMode));
  await TrackPlayer.setRate(settings.playbackRate);

  // --- Event listeners that push state into the Zustand store ---

  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    const store = playerStore.getState();
    store.setPlaybackState(mapState(state));

    if (state === State.Playing) {
      // Clear any previous error and retrying state when playback resumes.
      if (store.error) store.setError(null);
      if (store.retrying) store.setRetrying(false);
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackError, async (e) => {
    const message =
      (e as { message?: string }).message ?? 'Playback error occurred';
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

  TrackPlayer.addEventListener(Event.PlaybackBufferEmpty, (e) => {
    console.log('[Player] Buffer empty:', e.isEmpty);
  });

  TrackPlayer.addEventListener(Event.PlaybackBufferFull, (e) => {
    console.log('[Player] Buffer full:', e.isFull);
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
  });

  TrackPlayer.addEventListener(Event.PlaybackSeekCompleted, (e) => {
    console.log(
      '[Player] Seek completed: position',
      e.position,
      'didFinish',
      e.didFinish
    );
  });

  TrackPlayer.addEventListener(Event.PlaybackEndedWithReason, (e) => {
    console.log(
      '[Player] Playback ended: reason',
      e.reason,
      'track',
      e.track,
      'position',
      e.position
    );

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
      addCompletedScrobble(trackThatEnded, trackPlaylistMap.get(trackThatEnded.id));
    }

    // If savedTrackForScrobble was null, we fired before ActiveTrackChanged —
    // tell the upcoming ActiveTrackChanged not to save a stale reference.
    if (savedTrackForScrobble == null) {
      scrobbleHandledByEnded = true;
    }
    savedTrackForScrobble = null;
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

    // During a shuffle the queue is replaced atomically.  RNTP may fire
    // a transient null-track event — ignore it so the UI stays open.
    if (isShuffling && (track == null || !track.id)) {
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

    // Reset transcoded stream recovery offset for genuine track changes.
    positionOffset = 0;

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

    // Only reset the skip flag outside of queue-setup operations, where
    // multiple ActiveTrackChanged events fire for a single user action.
    if (!isSettingQueue) {
      isUserSkipping = false;
    }
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
    const activeTrackIndex = await TrackPlayer.getActiveTrackIndex();
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
  resetScrobbleCoordination();
  isUserSkipping = true;
  isSettingQueue = true;
  positionOffset = 0;
  playerStore.getState().setQueueLoading(true);
  playbackToastStore.getState().show();

  try {
    await ensureCoverArtAuth();

    currentChildQueue = queue;
    trackPlaylistMap.clear();
    if (sourcePlaylistId) {
      for (const child of queue) trackPlaylistMap.set(child.id, sourcePlaylistId);
    }
    playerStore.getState().setQueue(queue);

    const rnTracks = queue.map(childToTrack);
    const startIndex = queue.findIndex((c) => c.id === track.id);

    await TrackPlayer.reset();
    await TrackPlayer.add(rnTracks);

    if (startIndex > 0) {
      await TrackPlayer.skip(startIndex);
    }

    await TrackPlayer.play();
    playbackToastStore.getState().succeed();
  } catch (e) {
    playbackToastStore.getState().fail(
      e instanceof Error ? e.message : 'Playback error',
    );
  } finally {
    isSettingQueue = false;
    isUserSkipping = false;
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
  isUserSkipping = true;
  await TrackPlayer.skip(index);
  await TrackPlayer.play();
}

/** Clear the current error and attempt to resume playback. */
export async function retryPlayback(): Promise<void> {
  playerStore.getState().setError(null);
  await TrackPlayer.play();
}

/**
 * Stop playback, clear the queue, and reset all player state to defaults.
 *
 * Resets both the native RNTP player and the Zustand store so the UI
 * returns to its idle state (MiniPlayer hidden, no current track).
 */
export async function clearQueue(): Promise<void> {
  resetScrobbleCoordination();
  isUserSkipping = true;
  positionOffset = 0;
  maxBufferedSeen = 0;
  isFullyBuffered = false;
  isRecoveringStream = false;
  previousActiveChild = null;
  currentChildQueue = [];
  trackPlaylistMap.clear();

  await TrackPlayer.reset();

  const store = playerStore.getState();
  store.setCurrentTrack(null);
  store.setQueue([]);
  store.setPlaybackState('idle');
  store.setProgress(0, 0, 0);
  store.setError(null);
  store.setRetrying(false);
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

  // Nothing loaded yet – start fresh playback with these tracks.
  if (currentChildQueue.length === 0) {
    await playTrack(tracks[0], tracks, sourcePlaylistId);
    return;
  }

  await ensureCoverArtAuth();

  const rnTracks = tracks.map(childToTrack);
  await TrackPlayer.add(rnTracks);

  if (sourcePlaylistId) {
    for (const child of tracks) trackPlaylistMap.set(child.id, sourcePlaylistId);
  }

  currentChildQueue = [...currentChildQueue, ...tracks];
  playerStore.getState().setQueue(currentChildQueue);
}

/**
 * Remove a track from the play queue by its index.
 *
 * Handles the edge case where the removed track is the currently playing
 * track – RNTP will automatically advance to the next track.  If the
 * removed track is the last one in the queue the player is cleared.
 */
export async function removeFromQueue(index: number): Promise<void> {
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
}

/**
 * Remove all non-downloaded tracks from the play queue.
 *
 * Called when entering offline mode (manual or auto) so that only
 * locally available tracks remain. Iterates in reverse to avoid
 * index shifting issues. If all tracks are removed, clears the queue.
 */
export async function removeNonDownloadedTracks(): Promise<void> {
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
export async function shuffleQueue(): Promise<void> {
  if (currentChildQueue.length < 2) return;

  resetScrobbleCoordination();
  isUserSkipping = true;
  isSettingQueue = true;
  isShuffling = true;
  positionOffset = 0;
  maxBufferedSeen = 0;
  isFullyBuffered = false;

  try {
    await TrackPlayer.pause();

    // Fisher-Yates shuffle on a copy.
    const shuffled = [...currentChildQueue];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    currentChildQueue = shuffled;
    playerStore.getState().setQueue(shuffled);

    // Replace the RNTP queue atomically, skip to the first track, and play.
    await TrackPlayer.setQueue(shuffled.map(childToTrack));
    await TrackPlayer.skip(0);
    await TrackPlayer.play();
  } finally {
    isSettingQueue = false;
    isUserSkipping = false;
    isShuffling = false;
  }
}
