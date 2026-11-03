/**
 * Scrobble service – manages "now playing" notifications and completed
 * playback scrobble submissions to the Subsonic server.
 *
 * playerService calls sendNowPlaying() and addCompletedScrobble() at the
 * appropriate RNTP event points.  This module handles all API interaction,
 * the persisted pending-scrobble queue, retry logic, and periodic processing.
 */

import { onAppForeground } from '../utils/onAppForeground';

import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { existingScrobbleIds } from '../store/persistence/scrobbleTable';
import { completeSongFromCache } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { pendingScrobbleStore } from '../store/pendingScrobbleStore';
import { scrobbleExclusionStore } from '../store/scrobbleExclusionStore';
import { applyLocalPlay } from './playStatsService';
import { shouldHoldScrobbles } from './navidromeReid/reidMarker';
import { getApi, type Child } from './subsonicService';

/**
 * Hook invoked at the end of a scrobble batch when at least one submission
 * succeeded. Registered by `dataSyncService` at module load so the scrobble
 * path doesn't import the full orchestration graph (which would pull every
 * store into any test that mocks scrobbleService).
 */
let onBatchCompleted: (() => void) | null = null;
export function registerScrobbleBatchCompletedHook(hook: (() => void) | null): void {
  onBatchCompleted = hook;
}

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let isInitialised = false;
/**
 * The run in flight, or null. A boolean would only say that one EXISTS; concurrent
 * callers need something to await, and without it `processScrobbles()` handed them a
 * promise that resolved while the work was still going. Nothing could sequence on it —
 * which is why a test could only sleep and guess, and did so intermittently.
 */
let processing: Promise<void> | null = null;
const PROCESS_INTERVAL_MS = 60_000; // 1 minute

/* ------------------------------------------------------------------ */
/*  Exclusion check                                                    */
/* ------------------------------------------------------------------ */

function isExcluded(song: Child, playlistId?: string): boolean {
  const { excludedAlbums, excludedArtists, excludedPlaylists } =
    scrobbleExclusionStore.getState();
  if (song.albumId && song.albumId in excludedAlbums) return true;
  if (song.artistId && song.artistId in excludedArtists) return true;
  if (playlistId && playlistId in excludedPlaylists) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Initialise the scrobble service.  Starts a periodic timer that drains
 * the pending-scrobble queue and runs an initial processing pass to
 * submit any scrobbles left over from a previous session.
 *
 * Safe to call multiple times – subsequent calls are no-ops.
 */
export function initScrobbleService(): void {
  if (isInitialised) return;
  isInitialised = true;

  // Process any scrobbles persisted from a previous session.
  processScrobbles();

  // Periodically retry pending scrobbles. unref so this background interval
  // never holds the process open (Node/jest); unref is absent in the RN runtime.
  const retryInterval = setInterval(processScrobbles, PROCESS_INTERVAL_MS);
  (retryInterval as { unref?: () => void }).unref?.();

  // On Samsung Android the interval above can stop firing while the app is
  // backgrounded without active audio playback (facebook/react-native#56324), so
  // also drain on foreground rather than waiting out the next tick.
  onAppForeground(() => {
    processScrobbles();
  });

  // Flush the pending queue when the user leaves offline mode.
  offlineModeStore.subscribe((state, prev) => {
    if (prev.offlineMode && !state.offlineMode) {
      processScrobbles();
    }
  });
}

/**
 * Send a "now playing" notification to the server (submission=false).
 * Fire-and-forget – failures are silently ignored.
 * Skipped silently when the song matches a scrobble exclusion.
 */
export async function sendNowPlaying(song: Child, playlistId?: string): Promise<void> {
  if (isExcluded(song, playlistId)) return;
  const api = getApi();
  if (!api) return;
  try {
    await api.scrobble({ id: song.id, submission: false });
  } catch {
    // Best-effort – now-playing is ephemeral.
  }
}

/**
 * Record a completed-playback scrobble.  The item is added to the
 * persisted pending queue and processing is triggered immediately.
 * Skipped silently when the song matches a scrobble exclusion.
 *
 * Whatever fed the queue may have built the track from a narrow list projection, so
 * the gaps are filled from the downloaded row here — a scrobble is a permanent record
 * and this is the last point before it is written. It also decides the exclusion
 * correctly, which reads `artistId`. In-memory, so no DB round trip on the audio path.
 */
export function addCompletedScrobble(incoming: Child, playlistId?: string): Promise<void> {
  if (!incoming?.id || !incoming.title) return Promise.resolve();
  const song = completeSongFromCache(incoming);
  if (isExcluded(song, playlistId)) return Promise.resolve();
  // Bump local play-count + last-played so the UI reflects the play before the
  // server round-trip. Below the exclusion gate, so excluded plays skip it.
  applyLocalPlay(song);
  pendingScrobbleStore.getState().addScrobble(song, Date.now());
  return processScrobbles();
}

/* ------------------------------------------------------------------ */
/*  Queue processing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Process the pending-scrobble queue, submitting items to the server
 * one by one (oldest first).
 *
 * - On success the item is removed from the store.
 * - On failure a single retry is attempted.  If the retry also fails
 *   processing stops and remaining items stay in the queue for the
 *   next cycle (triggered by the periodic timer or a new scrobble).
 */
function processScrobbles(): Promise<void> {
  // Join the run in flight rather than returning as though the work were done.
  if (processing !== null) return processing;
  processing = runScrobblePass().finally(() => { processing = null; });
  return processing;
}

/** Awaitable handle on the queue drain, for callers that must sequence after it. */
export function awaitScrobbleProcessing(): Promise<void> {
  return processing ?? Promise.resolve();
}

async function runScrobblePass(): Promise<void> {
  // A pending Navidrome re-key means every song id here is one the server has retired.
  // Submitting anyway does not merely fail: a missing id comes back as HTTP 200 with
  // error code 70, our wrapper throws only on `!res.ok`, so it reads as SUCCESS and the
  // row is deleted. Listening history has no server copy.
  if (shouldHoldScrobbles()) return;
  try {
    const api = getApi();
    if (!api) return;

    // Snapshot the queue – iterate over a copy so mutations don't
    // interfere with the loop.
    const pending = [...pendingScrobbleStore.getState().pendingScrobbles];
    // Which of the pending items are already committed as completed.
    const completedIds = await existingScrobbleIds(pending.map((s) => s.id));
    let anySucceeded = false;

    for (const item of pending) {
      // Skip items already in the completed store (persistence race).
      if (completedIds.has(item.id)) {
        pendingScrobbleStore.getState().removeScrobble(item.id);
        continue;
      }

      let success = false;

      try {
        await api.scrobble({ id: item.song.id, time: item.time, submission: true });
        success = true;
      } catch {
        // First attempt failed – retry once.
        try {
          await api.scrobble({ id: item.song.id, time: item.time, submission: true });
          success = true;
        } catch {
          // Double failure – stop processing; timer will retry later.
          break;
        }
      }

      if (success) {
        anySucceeded = true;
        pendingScrobbleStore.getState().removeScrobble(item.id);
        completedScrobbleStore.getState().addCompleted({
          id: item.id,
          song: item.song,
          time: item.time,
        });
      }
    }

    // Refresh the home screen's recently played list so it reflects the latest play
    // history. Routed through dataSyncService so change-detection hooks can observe it.
    if (anySucceeded) {
      onBatchCompleted?.();
    }
  } finally {
    // `processing` is cleared by the caller's `.finally`, so a pass that throws still
    // releases the slot.
  }
}
