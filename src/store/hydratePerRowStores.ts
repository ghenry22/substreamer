import { albumDetailStore } from './albumDetailStore';
import { completedScrobbleStore } from './completedScrobbleStore';
import { musicCacheStore } from './musicCacheStore';
import { songIndexStore } from './songIndexStore';

/**
 * Hydrate every store backed by per-row SQLite tables. Safe to call multiple
 * times — each store's `hydrateFromDb` re-reads the current SQL state and
 * replaces its in-memory mirror, which is idempotent in practice because
 * every write path is write-through (SQL commit happens during the store
 * action, not later).
 *
 * **Must** run before any consumer reads these stores — in particular
 * before `onStartup()` kicks off the data-sync fan-out (library fetches,
 * full album-detail walk, etc.). Previously this only ran inside the splash
 * completion callback, which races against the auth-rehydrated useEffect
 * in `_layout.tsx` — splash animations typically exceed the walk's 1500 ms
 * deferred start, so `doWalk` would run against an empty
 * `albumDetailStore` and trigger a redundant full-library resync on every
 * launch. Calling this at the top of the auth-rehydrated useEffect
 * eliminates the race by guaranteeing hydration completes before the
 * dependent flow starts.
 *
 * sqliteStorage-backed stores (favorites, ratings, theme, etc.) aren't
 * covered by this helper — Zustand's `persist` middleware auto-rehydrates
 * them on store creation.
 */
export function hydratePerRowStores(): void {
  try {
    albumDetailStore.getState().hydrateFromDb();
    songIndexStore.getState().hydrateFromDb();
    completedScrobbleStore.getState().hydrateFromDb();
    musicCacheStore.getState().hydrateFromDb();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[hydratePerRowStores] failed', e);
  }
}
