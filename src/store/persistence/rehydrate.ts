import { albumDetailStore } from '../albumDetailStore';
import { completedScrobbleStore } from '../completedScrobbleStore';
import { musicCacheStore } from '../musicCacheStore';
import { songIndexStore } from '../songIndexStore';

/**
 * Single entry point for rehydrating every per-row SQLite-backed Zustand
 * store. Replaces four scattered `hydrateFromDb()` calls.
 *
 * Called from exactly two sites: the `rehydrated && isLoggedIn` useEffect
 * in `src/app/_layout.tsx` (before any data-sync flow runs) and the splash
 * post-migration callback in `src/components/AnimatedSplashScreen.tsx` (so
 * migrations get a chance to populate tables before the stores read). Both
 * calls are idempotent — each store's `hydrateFromDb()` re-reads the
 * current SQL state and replaces its in-memory mirror, safe under our
 * write-through semantics.
 *
 * Order matters only for future cross-store dependencies: albumDetail and
 * songIndex are naturally paired, completedScrobble and musicCache are
 * independent. Keep the current order stable so anyone adding a new store
 * sees an obvious spot to plug in.
 *
 * **Not exported from `./index.ts`.** This module imports stores; stores
 * import from `./index.ts` for table helpers. Re-exporting here would
 * create a cycle. Consumers import directly from
 * `'../store/persistence/rehydrate'`.
 *
 * kvStorage-backed stores (favorites, ratings, theme, etc.) aren't covered
 * by this helper — Zustand's `persist` middleware auto-rehydrates them on
 * store creation.
 */
export function rehydrateAllStores(): void {
  try {
    albumDetailStore.getState().hydrateFromDb();
    songIndexStore.getState().hydrateFromDb();
    completedScrobbleStore.getState().hydrateFromDb();
    musicCacheStore.getState().hydrateFromDb();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[rehydrateAllStores] failed', e);
  }
}
