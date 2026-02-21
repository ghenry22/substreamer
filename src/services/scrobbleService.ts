/**
 * Scrobble service – manages "now playing" notifications and completed
 * playback scrobble submissions to the Subsonic server.
 *
 * playerService calls sendNowPlaying() and addCompletedScrobble() at the
 * appropriate RNTP event points.  This module handles all API interaction,
 * the persisted pending-scrobble queue, retry logic, and periodic processing.
 */

import { albumListsStore } from '../store/albumListsStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { pendingScrobbleStore } from '../store/pendingScrobbleStore';
import { getApi, type Child } from './subsonicService';

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let isInitialised = false;
let isProcessing = false;
let timerHandle: ReturnType<typeof setInterval> | null = null;

const PROCESS_INTERVAL_MS = 60_000; // 1 minute

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

  // Periodically retry pending scrobbles.
  timerHandle = setInterval(processScrobbles, PROCESS_INTERVAL_MS);

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
 */
export async function sendNowPlaying(songId: string): Promise<void> {
  const api = getApi();
  if (!api) return;
  try {
    await api.scrobble({ id: songId, submission: false });
  } catch {
    // Best-effort – now-playing is ephemeral.
  }
}

/**
 * Record a completed-playback scrobble.  The item is added to the
 * persisted pending queue and processing is triggered immediately.
 */
export function addCompletedScrobble(song: Child): void {
  pendingScrobbleStore.getState().addScrobble(song, Date.now());
  processScrobbles();
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
async function processScrobbles(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const api = getApi();
    if (!api) return;

    // Snapshot the queue – iterate over a copy so mutations don't
    // interfere with the loop.
    const pending = [...pendingScrobbleStore.getState().pendingScrobbles];
    let anySucceeded = false;

    for (const item of pending) {
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

    // Refresh the home screen's recently played list if any scrobbles
    // were submitted so it reflects the latest play history.
    if (anySucceeded) {
      albumListsStore.getState().refreshRecentlyPlayed();
    }
  } finally {
    isProcessing = false;
  }
}
