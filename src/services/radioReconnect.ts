/**
 * Reconnect policy for live radio streams. Internet radio drops routinely
 * (stream server hiccup, Wi-Fi → cellular hand-off), so unlike regular tracks
 * — where an error surfaces a manual Retry — radio errors are retried
 * automatically with exponential backoff. Pure decision logic, kept out of
 * playerService so it can be unit-tested without the native engine.
 */

/** Give up after this many consecutive failed reconnects. */
export const RADIO_RECONNECT_MAX_ATTEMPTS = 5;

const DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/** True while another automatic reconnect should be scheduled. */
export function shouldRadioReconnect(attempt: number): boolean {
  return attempt < RADIO_RECONNECT_MAX_ATTEMPTS;
}

/** Backoff before reconnect number `attempt` (0-based): 1s, 2s, 4s, 8s, 15s. */
export function radioReconnectDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), DELAYS_MS.length - 1);
  return DELAYS_MS[index];
}
