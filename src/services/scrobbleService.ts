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
import { scrobbleExclusionStore } from '../store/scrobbleExclusionStore';
import { getApi, type Child } from './subsonicService';

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let isInitialised = false;
let isProcessing = false;
let timerHandle: ReturnType<typeof setInterval> | null = null;

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
 */
export function addCompletedScrobble(song: Child, playlistId?: string): void {
  if (!song?.id || !song.title) return;
  if (isExcluded(song, playlistId)) return;
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
    const completedIds = new Set(
      completedScrobbleStore.getState().completedScrobbles.map((s) => s.id),
    );
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

    // Refresh the home screen's recently played list if any scrobbles
    // were submitted so it reflects the latest play history.
    if (anySucceeded) {
      albumListsStore.getState().refreshRecentlyPlayed();
    }
  } finally {
    isProcessing = false;
  }
}
