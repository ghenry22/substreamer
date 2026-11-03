/**
 * Whether the Navidrome id re-key still has to run, and how far it got.
 *
 * A STANDING check, not a one-shot tied to a release. Users upgrade their server on their
 * own schedule — someone deliberately holding Navidrome at 0.63 for a year still needs
 * this the day they upgrade — so the condition is evaluated on every launch and this
 * module stays in the app indefinitely. No transition tracking is needed: the condition
 * simply becomes true once their server crosses 0.64.0.
 *
 * Reads and writes go through `kvStorageSync`, because the gate is consulted on the boot
 * path and by the headless media service, neither of which can await a hydration.
 *
 * One install points at one server: editing the server URL reaches the same server at a
 * different address, and switching servers means logging out, which clears the marker
 * along with the data. So a single marker describes the situation exactly.
 */

import { kvStorageSync } from '../../store/persistence';
import { serverInfoStore } from '../../store/serverInfoStore';
import { navidromeReidVerdict, type ReidVerdict } from './navidromeVersion';

const MARKER_KEY = 'substreamer-navidrome-reid';
/** Where `serverInfoStore` persists. Read directly when the store has not hydrated. */
const SERVER_INFO_KEY = 'substreamer-server-info';
/** Set when the user answers the `ask` prompt: they told us their server is updated. */
const OVERRIDE_KEY = 'substreamer-navidrome-reid-confirmed';

/**
 * `pending` — nothing done, or a run was interrupted before the re-key committed.
 * `complete` — everything done; the pass never runs again for this install.
 *
 * Deliberately two states. An earlier design had a middle "files moved, stores not yet
 * rehydrated" state, but the app does not launch until the marker reads `complete`, so
 * that state could never be observed — and re-running the file move on resume is free,
 * because moving a file already at its destination is a no-op.
 */
export type ReidState = 'pending' | 'complete';

function read(): ReidState | null {
  try {
    const raw = kvStorageSync.getItem(MARKER_KEY);
    if (typeof raw !== 'string' || raw === '') return null;
    const parsed = JSON.parse(raw) as { state?: unknown };
    return parsed.state === 'pending' || parsed.state === 'complete' ? parsed.state : null;
  } catch {
    // An unreadable marker means "not done", which re-runs a pass that is idempotent.
    return null;
  }
}

/** Record progress. Called by the pass; nothing else should write this. */
export function setReidState(state: ReidState): void {
  try {
    kvStorageSync.setItem(MARKER_KEY, JSON.stringify({ state, at: Date.now() }));
  } catch {
    /* A failed write re-runs the pass next launch, which is safe. */
  }
}

/**
 * Record that the user confirmed their server has been updated.
 *
 * The version string could not settle it, so their answer is the only evidence there is.
 * Persisted, so a kill between the answer and the pass finishing does not lose it.
 */
export function setUserConfirmedReid(): void {
  try {
    kvStorageSync.setItem(OVERRIDE_KEY, '1');
  } catch {
    /* the prompt simply reappears next launch */
  }
}

function userConfirmed(): boolean {
  try {
    return kvStorageSync.getItem(OVERRIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Test-only: forget the marker. */
export function clearReidMarker(): void {
  try {
    kvStorageSync.removeItem(MARKER_KEY);
    kvStorageSync.removeItem(OVERRIDE_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Has the pass finished for this install? */
export function isReidComplete(): boolean {
  return read() === 'complete';
}

/**
 * The server's type and version, without waiting for a hydration.
 *
 * `serverInfoStore` persists through the ASYNC `kvStorage`, so on a headless cold wake —
 * exactly the path {@link shouldBlockContent} exists for — its in-memory state is still
 * the initial `serverType: null` when this is called. Reading the store alone therefore
 * answers "not Navidrome" for an affected server and the content block never engages,
 * which is the one direction that must not fail. So fall back to the persisted blob,
 * which `kvStorageSync` can read on the spot.
 */
export function currentServerInfo(): { serverType: string | null; serverVersion: string | null } {
  const live = serverInfoStore.getState();
  if (live.serverType !== null) return live;
  try {
    const raw = kvStorageSync.getItem(SERVER_INFO_KEY);
    if (typeof raw !== 'string' || raw === '') return live;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    const { serverType, serverVersion } = parsed.state ?? {};
    return {
      serverType: typeof serverType === 'string' ? serverType : null,
      serverVersion: typeof serverVersion === 'string' ? serverVersion : null,
    };
  } catch {
    // Unreadable: keep the store's answer rather than inventing one.
    return live;
  }
}

/**
 * What should happen about the re-key on this launch?
 *
 * `run` unattended, `skip` entirely, or `ask` the user because the server's version string
 * has no number to read (see `navidromeReidVerdict`). Always `skip` once the pass has
 * completed.
 *
 * Synchronous and cheap — one KV read plus a string compare — so it is safe on every
 * launch and on the headless path.
 */
export function reidVerdict(): ReidVerdict {
  if (isReidComplete()) return 'skip';
  const { serverType, serverVersion } = currentServerInfo();
  // The probe, when it has an answer, outranks the persisted copy — that copy is the
  // pre-upgrade version on exactly the launch this pass exists for.
  const verdict = navidromeReidVerdict(serverType, probedVersion ?? serverVersion);
  // The user has already answered the prompt; do not ask again.
  return verdict === 'ask' && userConfirmed() ? 'run' : verdict;
}

/** Will the pass run without asking? */
export function isReidRequired(): boolean {
  return reidVerdict() === 'run';
}

/**
 * Must the app refuse to serve content right now?
 *
 * The interstitial holds the UI launch path, but it cannot hold a headless one: `index.js`
 * requires `playerBootstrap` before `expo-router/entry`, so a CarPlay, Android Auto, Siri
 * or lock-screen cold wake arms the media service without ever rendering `_layout` — and a
 * headless boot does not run the migration chain either. Serving retired ids to a car head
 * unit fails anyway; failing deliberately, before any write, is the difference between a
 * blank browse tree and a corrupted download set.
 */
export function shouldBlockContent(): boolean {
  // `ask` does not block: an undetermined version runs in legacy mode until the user
  // chooses to update, and a car wake has no screen to ask on.
  return reidVerdict() === 'run';
}

/**
 * Must pending scrobbles be held rather than submitted?
 *
 * Navidrome answers a scrobble with OK even when it cannot register it
 * (`reference/navidrome/server/subsonic/media_annotation.go:178-190`), and the row is then
 * deleted, so a scrobble sent under a retired id is lost. Held while the pass is
 * outstanding, and for an undetermined version until the user has chosen legacy mode.
 */
export function shouldHoldScrobbles(): boolean {
  const verdict = reidVerdict();
  return verdict === 'run' || (verdict === 'ask' && !legacyThisSession);
}

// --- Per-session answers to the gate ----------------------------------------------
//
// Here rather than in `runNavidromeReid` so the scrobble check above can read them: the
// repository layer imports this module and must not reach `runNavidromeReid`.

/** The user chose "Run in legacy mode" this session. */
let legacyThisSession = false;
/** The user chose "Continue without updating" after a failed pass this session. */
let continuedAfterFailureThisSession = false;

export function setLegacyThisSession(): void {
  legacyThisSession = true;
}

export function isLegacyThisSession(): boolean {
  return legacyThisSession;
}

export function setContinuedAfterFailureThisSession(): void {
  continuedAfterFailureThisSession = true;
}

export function hasContinuedAfterFailureThisSession(): boolean {
  return continuedAfterFailureThisSession;
}

/** Forget both answers. The next session decides afresh. */
export function resetReidSessionLatches(): void {
  legacyThisSession = false;
  continuedAfterFailureThisSession = false;
}

// --- The live version probe -------------------------------------------------------
//
// The verdict depends on the server's CURRENT version, but `serverInfoStore` holds the
// version as of the last session. On the one launch this pass exists for — the first
// after the user upgrades their server — that copy is the pre-upgrade version and the
// verdict comes back `skip`. So the version is probed before the app launches.
//
// The result lives HERE, in module state, and is never routed through `serverInfoStore`:
// zustand's default persist merge is `{...current, ...persisted}` applied with
// `set(state, true)` (`zustand/middleware.js:337-340, 419-423`), so the persisted value
// wins and a probe landing before hydration would be clobbered back to the stale one.

/** The version the server reported this session, authoritative over the persisted copy. */
let probedVersion: string | null = null;
/** Whether the probe has produced an answer yet. Until it has, writes are refused. */
let probeSettled = false;

/**
 * The network half lives in `reidProbe`, not here. This module is imported by
 * `db/repository/{songs,albums}` for the write guard, and that layer must not pull in
 * `subsonicService` and the Expo stack behind it.
 */
export function setProbedVersion(version: string | null): void {
  if (version !== null) probedVersion = version;
}

/** Called by the probe when it has an answer, or has given up. */
export function markProbeSettled(): void {
  probeSettled = true;
}

/**
 * Set only when the server actually responded this session.
 *
 * Distinct from `probeSettled`, which is also true after a timeout. The re-key discards
 * the library and depends on the sync that follows to rebuild it, so "we believe we are
 * online" is not good enough to start it — a server that never answers leaves the app
 * empty with no way back. Only a real round-trip proves there is something to refill from.
 */
let serverAnswered = false;

export function markServerAnswered(): void {
  serverAnswered = true;
}

/** The version the server reported this launch, or null if it never answered. */
export function probedServerVersion(): string | null {
  return probedVersion;
}

/** Did the server respond to us this session? */
export function hasServerAnswered(): boolean {
  return serverAnswered;
}

/** Forget the probe result, so the next session decides afresh. Called at login. */
export function resetReidProbeState(): void {
  probedVersion = null;
  probeSettled = false;
  serverAnswered = false;
}

/**
 * Must server-sourced library writes be refused right now?
 *
 * Separate from {@link shouldBlockContent}, which gates the headless READ paths. Those
 * never probe, so widening that function would make a CarPlay cold wake serve nothing to
 * every Navidrome user for as long as the app was not launched.
 *
 * An unsettled probe counts as blocked. That is the fail-safe direction and it is what
 * makes a bounded probe acceptable: timing out costs a delayed sync, never a library
 * written half in retired ids and half in current ones.
 */
export function shouldBlockLibraryWrites(): boolean {
  if (isReidComplete()) return false;
  if (currentServerInfo().serverType?.toLowerCase() !== 'navidrome') return false;
  if (!probeSettled) return true;
  // Settled is not the same as answered. A TIMEOUT settles, leaving `probedVersion`
  // null, so the verdict falls back to the PERSISTED version — which on the launch
  // after a server upgrade still reads the old one and yields 'skip'. Writes would then
  // be allowed and the sync would run against an upgraded server with retired ids: the
  // doubled library, reached by a slow ping rather than by offline mode.
  //
  // Safe only because a settled-but-unanswered probe stays retryable (`reidProbe`), so
  // this blocks until we can actually ask rather than for the whole session.
  if (!hasServerAnswered()) return true;
  // `ask` stays open: legacy mode is fully functional on the old ids.
  return reidVerdict() === 'run';
}
