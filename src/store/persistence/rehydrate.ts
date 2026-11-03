import { errMessage } from '../../utils/errorMessage';
import { albumListsStore, hydrateAlbumListsFromDb } from '../albumListsStore';
import { autoOfflineStore } from '../autoOfflineStore';
import { bookmarksStore } from '../bookmarksStore';
import { completedScrobbleStore } from '../completedScrobbleStore';
import { equalizerSettingsStore } from '../equalizerSettingsStore';
import { favoritesStore } from '../favoritesStore';
import { genreStore } from '../genreStore';
import { imageCacheStore } from '../imageCacheStore';
import { imageDownloadQueueStore } from '../imageDownloadQueueStore';
import { mbidOverrideStore } from '../mbidOverrideStore';
import { musicCacheStore } from '../musicCacheStore';
import { offlineModeStore } from '../offlineModeStore';
import { pendingScrobbleStore } from '../pendingScrobbleStore';
import { playbackSettingsStore } from '../playbackSettingsStore';
import { scanStatusStore } from '../scanStatusStore';
import { scrobbleExclusionStore } from '../scrobbleExclusionStore';
import { serverInfoStore } from '../serverInfoStore';
import { sharesStore } from '../sharesStore';
import { syncStatusStore } from '../syncStatusStore';

export interface RehydrationResult {
  succeeded: string[];
  failed: Array<{ store: string; error: string }>;
}

/**
 * Single entry point for rehydrating every per-row SQLite-backed Zustand
 * store. Each store hydrates in its own try/catch so a corrupt row in one
 * store cannot block the others from loading; the caller receives a
 * structured result describing which succeeded and which failed.
 *
 * Called from exactly two sites: the `rehydrated && isLoggedIn` useEffect
 * in `src/app/_layout.tsx` and the splash post-migration callback in
 * `src/components/AnimatedSplashScreen.tsx`. Both calls are idempotent —
 * each store's `hydrateFromDbAsync()` re-reads the current SQL state and
 * replaces its in-memory mirror, safe under our write-through semantics.
 *
 * Each store hydrates independently — no FK-style dependency between them —
 * so they run **concurrently** via `Promise.all`. The per-store SQLite reads
 * (`getAllAsync`/`getFirstAsync`) execute on op-SQLite's pool thread, and the
 * JS-side JSON.parse / row-mapping is chunked with `setTimeout(0)` yields
 * inside each `hydrateFromDbAsync`, so boot hydration never blocks the JS
 * thread for long even on a large library. Concurrent reads queue FIFO on that
 * one pool thread; correctness is unaffected because each store writes only
 * its own slice of state.
 *
 * **Not exported from `./index.ts`.** This module imports stores; stores
 * import from `./index.ts` for table helpers. Re-exporting here would
 * create a cycle. Consumers import directly from
 * `'../store/persistence/rehydrate'`.
 *
 * kvStorage-backed stores (ratings, theme, etc.) aren't covered by this
 * helper — Zustand's `persist` middleware auto-rehydrates them on store
 * creation.
 */
export async function rehydrateAllStores(): Promise<RehydrationResult> {
  const result: RehydrationResult = { succeeded: [], failed: [] };
  const stores: Array<[string, () => Promise<void>]> = [
    // Album lists are ordered ids in `album_list_entries` joined to `albums`, not a KV
    // blob — the store still persists `lastRefreshedAt`, so it stays in STARTUP_KV_STORES,
    // but the lists themselves are seeded here.
    ['albumLists', () => hydrateAlbumListsFromDb()],
    // The only `persist`-wrapped store here whose DB-hydrated slice is also its
    // persisted one, so its `hydrateFromDbAsync` waits on `persist.hasHydrated()`
    // itself before it replaces anything (see the store).
    ['bookmarks', () => bookmarksStore.getState().hydrateFromDbAsync()],
    ['completedScrobble', () => completedScrobbleStore.getState().hydrateFromDbAsync()],
    ['favorites', () => favoritesStore.getState().hydrateFromDbAsync()],
    // All four are `persist`-wrapped over the slice they DB-hydrate, like bookmarks
    // above, so each waits on its own `persist.hasHydrated()` before replacing anything.
    ['genres', () => genreStore.getState().hydrateFromDbAsync()],
    ['shares', () => sharesStore.getState().hydrateFromDbAsync()],
    ['mbidOverrides', () => mbidOverrideStore.getState().hydrateFromDbAsync()],
    ['scrobbleExclusions', () => scrobbleExclusionStore.getState().hydrateFromDbAsync()],
    ['pendingScrobble', () => pendingScrobbleStore.getState().hydrateFromDbAsync()],
    ['musicCache', () => musicCacheStore.getState().hydrateFromDbAsync()],
    ['imageCache', () => imageCacheStore.getState().hydrateFromDbAsync()],
    ['imageDownloadQueue', () => imageDownloadQueueStore.getState().hydrateFromDbAsync()],
  ];
  await Promise.all(
    stores.map(async ([name, hydrate]) => {
      try {
        await hydrate();
        result.succeeded.push(name);
      } catch (e) {
        result.failed.push({
          store: name,
          error: errMessage(e),
        });
      }
    }),
  );
  if (result.failed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[rehydrateAllStores] partial failure', result.failed);
  }
  return result;
}

/**
 * Stores that back the startup data-sync flow and are persisted via the
 * **async** `kvStorage` adapter. Because async hydration completes a microtask
 * after store creation, the startup chain must wait for these before it reads
 * them — otherwise `onStartup()`'s library-vs-detail comparison
 * (`dataSyncService.ts`) sees an empty `albumLibraryStore` and the
 * `offlineMode`/`autoOffline` branch decisions read stale defaults, which can
 * trigger a spurious "full library resync".
 *
 * Only the startup-critical stores are listed. The rest of the async persist
 * stores (bookmarks, lyrics, shares, settings, …) are read lazily by UI that
 * re-renders reactively on hydration, so they don't need gating.
 */
const STARTUP_KV_STORES = [
  offlineModeStore,
  autoOfflineStore,
  // albumLibraryStore is absent by design: it's row-based, not KV-persisted, so it
  // has no `persist` API to await. Its `hydrateFromDbAsync` runs in
  // `rehydrateAllStores` above (awaited before `onStartup`), and the startup
  // "needs full fetch?" gate reads SQL `COUNT(*)` rather than the in-memory
  // array — so there's no empty-window race to guard here.
  albumListsStore,
  // favoritesStore is absent by design: membership lives in SQL (the `starred` marks +
  // the `favorite_*` remainder), so it has no `persist` API to await. Its
  // `hydrateFromDbAsync` runs in `rehydrateAllStores` above, awaited before
  // `onStartup`.
  genreStore,
  serverInfoStore,
  syncStatusStore,
  scanStatusStore,
  // Settings the headless (car/voice) service reads offline before any UI mounts —
  // awaited here so a headless start + the app boot both have them ready.
  playbackSettingsStore,
  // Read by `initPlayer`, which runs as soon as this resolves.
  equalizerSettingsStore,
];

/**
 * Resolve once every startup-critical async-persisted store has finished
 * hydrating. Stores already hydrated resolve immediately; the rest are awaited
 * via Zustand's `persist.onFinishHydration`. Call before the startup chain
 * reads these stores. The flash-critical stores (theme/locale/auth/onboarding)
 * use the synchronous adapter and are always hydrated at first render, so they
 * are intentionally absent here.
 */
export async function awaitKvHydration(): Promise<void> {
  await Promise.all(
    STARTUP_KV_STORES.map(
      (store) =>
        new Promise<void>((resolve) => {
          if (store.persist.hasHydrated()) {
            resolve();
            return;
          }
          const unsub = store.persist.onFinishHydration(() => {
            unsub();
            resolve();
          });
        }),
    ),
  );
}
