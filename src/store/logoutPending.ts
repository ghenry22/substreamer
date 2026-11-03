/**
 * Marks a logout in progress, so a launch after a kill mid-logout can finish it.
 *
 * Written before any teardown and removed by the KV clear inside `resetAllStores`, so
 * it is present exactly while the logout is incomplete. Read synchronously: the auth
 * store's hydration and the headless service both consult it before any await.
 */

import { kvStorageSync } from './persistence';

const LOGOUT_PENDING_KEY = 'substreamer-logout-pending';

export function markLogoutPending(): void {
  kvStorageSync.setItem(LOGOUT_PENDING_KEY, '1');
}

export function isLogoutPending(): boolean {
  return kvStorageSync.getItem(LOGOUT_PENDING_KEY) !== null;
}
