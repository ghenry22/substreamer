/**
 * Settle the Navidrome re-key question for a new session, at login, before the session
 * starts.
 *
 * Login has just pinged the server, so its type and version are known. Recording them
 * here, before `setSession`, means nothing keyed on `isLoggedIn` ever runs against an
 * undecided gate. And a new session on an install that holds no server data has nothing
 * to re-key, so on 0.64 or later it is marked done on the spot.
 */

import { serverInfoStore } from '../../store/serverInfoStore';
import { isDbHealthy } from '../../store/persistence';
import { getDb } from '../../store/persistence/db';
import { wipeServerData } from '../../store/resetAllStores';
import { syncStatusStore } from '../../store/syncStatusStore';
import { installHoldsServerIds } from './reidInstall';
import {
  markProbeSettled,
  markServerAnswered,
  resetReidProbeState,
  resetReidSessionLatches,
  setLegacyThisSession,
  setProbedVersion,
  setReidState,
} from './reidMarker';
import { markProbeDone, resetProbeState } from './reidProbe';
import { navidromeReidVerdict } from './navidromeVersion';

/** Forget everything the previous session learned about the re-key. */
export function resetReidSessionState(): void {
  resetReidProbeState();
  resetProbeState();
  resetReidSessionLatches();
}

/**
 * Call after a successful login ping and before `setSession`. Never rejects: on any
 * failure the session starts without a stamp, and the normal startup check decides.
 */
export async function beginReidSession({
  serverType,
  serverVersion,
}: {
  serverType: string | null;
  serverVersion: string | null;
}): Promise<void> {
  try {
    resetReidSessionState();
    // The gate reads the type from here; null would leave it open until the fan-out's
    // own server-info fetch lands, and then close it mid-session.
    serverInfoStore.setState({ serverType, serverVersion });
    // Login's ping is this session's answer: no second probe.
    setProbedVersion(serverVersion);
    markServerAnswered();
    markProbeSettled();
    markProbeDone();

    // With the database down, KV lives in memory and the install may be real: change
    // nothing.
    const db = getDb();
    if (!db || !isDbHealthy()) return;

    // A logged-out install holds no server data, so rows here are leftovers of the
    // previous session (a write that landed after logout's wipe). Clear them first, and
    // never stamp over a wipe that did not take.
    if (await installHoldsServerIds(db)) {
      syncStatusStore.getState().resetLibrarySync();
      syncStatusStore.getState().resetSongSync();
      await wipeServerData();
      if (await installHoldsServerIds(db)) return;
    }

    const verdict = navidromeReidVerdict(serverType, serverVersion);
    if (verdict === 'run') setReidState('complete');
    // Nothing held, so nothing to convert: this session takes the server's ids as given.
    // An undetermined version is asked about on the next launch, which has data.
    else if (verdict === 'ask') setLegacyThisSession();
  } catch (e) {
    // The session still starts; the startup check makes the decision instead.
    // eslint-disable-next-line no-console
    console.warn('[reid] beginReidSession failed:', e);
  }
}
