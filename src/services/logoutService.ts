/**
 * Logout: end the live session, then clear everything the account left behind.
 *
 * The pending flag goes down first and is removed by the KV clear near the end, so a
 * logout killed part way is finished at the next launch, behind the splash.
 */

import { isLogoutPending, markLogoutPending } from '../store/logoutPending';
import { resetAllStores } from '../store/resetAllStores';
import { clearQueue } from './playerService';
import { stopPolling } from './scanService';
import { clearAllNativeTrust } from './sslTrustService';
import { clearApiCache } from './subsonicService';

export async function logout(): Promise<void> {
  markLogoutPending();
  clearQueue();
  stopPolling();
  clearApiCache();
  await finishLogout();
}

/**
 * The part of logout that holds no live session, so a launch can run it before anything
 * starts. Never rejects; whether it completed is read from `isLogoutPending()`.
 */
export async function finishLogout(): Promise<void> {
  try {
    // Native trust before the JS reset: the native store is what requests actually
    // enforce, so a self-signed re-login must find it already cleared.
    await clearAllNativeTrust();
    await resetAllStores();
  } catch (e) {
    // The flag stays set, so the next launch tries again.
    // eslint-disable-next-line no-console
    console.warn('[logout] finishLogout failed:', e);
  }
  if (isLogoutPending()) {
    // eslint-disable-next-line no-console
    console.warn('[logout] logout incomplete; it finishes at the next launch');
  }
}
