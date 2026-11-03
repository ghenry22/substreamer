/**
 * Primary / secondary server failover — detect-and-confirm.
 *
 * We never switch servers on our own. Two surfaces:
 *
 *   - `switchToServer(target)` — atomic swap of the active slot. Used by the
 *     manual Settings switch, the EditServerUrl flow, and the banner's "tap to
 *     switch" offer. serverInfoStore is NOT cleared — primary and secondary
 *     serve the SAME Subsonic instance through different URLs (same caps).
 *
 *   - `evaluateServerDownPrompt()` — the connectivityService hook fired at the
 *     2-fail threshold. When the ACTIVE server is unreachable and the OTHER slot
 *     is configured + preflight-pings OK, it sets `connectivityStore.offerTarget`
 *     so the unreachable banner becomes a tappable "switch to {slot}" offer. It
 *     does NOT switch — the user taps to confirm.
 *
 * `pingUrl` is the one-shot reachability preflight. (The old automatic switching
 * + 60s recovery poller + hysteresis were removed in favour of this model.)
 */

import { authStore, type ServerSlot } from '../store/authStore';
import { errMessage } from '../utils/errorMessage';
import { connectivityStore } from '../store/connectivityStore';
import { PING_TIMEOUT_MS, setServerDownHook } from './connectivityService';
import { retryRemoteImagesForServerSwitch } from './imageCacheService';
import { rebuildQueueForServerSwitch } from './playerService';
import { buildPingApi, clearApiCache, ensureCoverArtAuth } from './subsonicService';
import { withTimeout } from '../utils/withTimeout';


let switchInFlight = false;
/** Latest switch intent that arrived while a switch was in flight (replayed on
 *  completion so the newest decision isn't dropped). */
let pendingSwitch: ServerSlot | null = null;

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Atomically swap the active server slot. No-op when the target has no URL,
 * we're already on it, or another switch is in flight (re-entrancy guard).
 */
export async function switchToServer(target: ServerSlot): Promise<void> {
  if (switchInFlight) {
    pendingSwitch = target;
    return;
  }
  const auth = authStore.getState();
  if (auth.activeServer === target) {
    connectivityStore.getState().clearFailoverPrompt();
    return;
  }
  const targetUrl =
    target === 'primary' ? auth.primaryServerUrl : auth.secondaryServerUrl;
  if (!targetUrl) return;

  switchInFlight = true;
  try {
    // 1. Auth swap — every future getStreamUrl / getCoverArtUrl reads the new
    //    URL. setActiveServer is the single source of truth.
    auth.setActiveServer(target);
    // The offer (if any) is now satisfied — we're switching to it.
    connectivityStore.getState().clearFailoverPrompt();

    // 2. Drop the cached SubsonicAPI instance (keyed by URL). Caps unchanged.
    clearApiCache();

    // 2b. Re-establish the cover-art auth token against the new server — step 2
    //     nulled it, and the queue rebuild + image retry need a valid token.
    await ensureCoverArtAuth();

    // 3. Rebuild the RNTP queue against the new base. Brief audio pause.
    await rebuildQueueForServerSwitch();

    // 3b. Tell the image layer to retry so mounted CachedImages reload from the
    //     new server without needing a list-row recycle.
    retryRemoteImagesForServerSwitch();
  } catch (e) {
    // Best-effort: the active-slot swap (step 1) already took effect, so a
    // failure in any later step must NOT reject and crash the caller (manual
    // tap / banner offer). Log and continue; the user can retry.
    console.warn(
      '[failover] switchToServer step failed:',
      errMessage(e),
    );
  } finally {
    switchInFlight = false;
    const next = pendingSwitch;
    pendingSwitch = null;
    if (next != null && authStore.getState().activeServer !== next) {
      void switchToServer(next);
    }
  }
}

/**
 * One-shot reachability check against an arbitrary URL using the current
 * credentials. Returns true on a Subsonic `status === 'ok'`, false on timeout /
 * network error / auth failure / non-ok. Does NOT touch the cached API client
 * (it's keyed by the active URL and would thrash cross-URL).
 */
export async function pingUrl(
  url: string,
  timeoutMs: number = PING_TIMEOUT_MS,
): Promise<boolean> {
  const api = buildPingApi(url);
  if (!api) return false;
  try {
    const response = await withTimeout(() => api.ping(), timeoutMs);
    if (response === 'timeout') return false;
    return response.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Connectivity hook fired when the ACTIVE server hits the 2-fail threshold.
 * Checks the OTHER configured slot and drives the banner prompt — never switches
 * on its own:
 *   - other reachable     → offer a one-tap switch to it.
 *   - other also down     → 'both-down' (show "both servers unavailable").
 *   - no other configured → clear (plain single-server "unreachable" banner).
 */
export async function evaluateServerDownPrompt(): Promise<void> {
  const auth = authStore.getState();
  const otherSlot: ServerSlot =
    auth.activeServer === 'primary' ? 'secondary' : 'primary';
  const otherUrl =
    otherSlot === 'primary' ? auth.primaryServerUrl : auth.secondaryServerUrl;

  const store = connectivityStore.getState();
  if (!otherUrl) {
    store.clearFailoverPrompt();
    return;
  }
  // Preflight: only offer a switch to a server that's actually reachable now.
  const otherUp = await pingUrl(otherUrl);
  store.setFailoverPrompt(otherUp ? otherSlot : 'both-down');
}

/**
 * Register the connectivity hook at boot. Idempotent. (No poller, no auth
 * subscription — the detect-and-confirm model has no background lifecycle.)
 */
export function initFailover(): void {
  setServerDownHook(evaluateServerDownPrompt);
}

/* ------------------------------------------------------------------ */
/*  Test-only — reset module state between test cases.                  */
/* ------------------------------------------------------------------ */

export function _resetForTest(): void {
  switchInFlight = false;
  pendingSwitch = null;
  setServerDownHook(null);
}
