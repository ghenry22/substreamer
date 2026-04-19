/**
 * Central data sync orchestration.
 *
 * Phase 1: pass-through stubs. Entry points fan out to the existing store
 * methods in the same order/concurrency the app uses today. Later phases
 * take over the actual walk / change detection / reconciliation logic.
 *
 * All entry points are idempotent via a `Map<SyncScope, Promise<void>>` kept
 * on `syncStatusStore.inFlight`. Overlapping calls collapse per the subset
 * matrix documented in `plans/canonical-album-data-sync.md`.
 */
import { albumDetailStore } from '../store/albumDetailStore';
import { albumLibraryStore, registerAlbumLibraryReconcileHook } from '../store/albumLibraryStore';
import { albumListsStore } from '../store/albumListsStore';
import { artistLibraryStore } from '../store/artistLibraryStore';
import { favoritesStore } from '../store/favoritesStore';
import { genreStore } from '../store/genreStore';
import { offlineModeStore } from '../store/offlineModeStore';
import {
  playlistLibraryStore,
  registerPlaylistLibraryReconcileHook,
} from '../store/playlistLibraryStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { scanStatusStore } from '../store/scanStatusStore';
import { authStore } from '../store/authStore';
import { serverInfoStore } from '../store/serverInfoStore';
import { syncStatusStore, type SyncScope } from '../store/syncStatusStore';
import { fireAndForget } from '../utils/fireAndForget';
import { runPool } from '../utils/promisePool';
import { minDelay } from '../utils/stringHelpers';
import { registerMusicCacheOnAlbumReferencedHook } from './musicCacheService';
import { fetchScanStatus, registerScanCompletedHook } from './scanService';
import { registerScrobbleBatchCompletedHook } from './scrobbleService';
import { canUserScan } from './serverCapabilityService';
import { fetchServerInfo, getRecentlyAddedAlbums, type AlbumID3 } from './subsonicService';

/** Bounded concurrency for the album-detail walk. */
const WALK_CONCURRENCY = 4;
/** Skip the walk entirely on tiny libraries — not worth the startup cost. */
const MIN_LIBRARY_FOR_WALK = 1;

/**
 * True when there's library work to do — either the album list hasn't been
 * fetched yet, or we have albums without detail cached. Used to decide
 * whether an offline startup should surface the "paused — offline" banner
 * or stay silent.
 */
function isLibrarySyncPending(): boolean {
  const lib = albumLibraryStore.getState();
  if (lib.albums.length === 0) return true;
  const detail = albumDetailStore.getState().albums;
  for (const album of lib.albums) {
    if (!Object.prototype.hasOwnProperty.call(detail, album.id)) return true;
  }
  return false;
}

export type PullToRefreshScope =
  | 'home'
  | 'albums'
  | 'artists'
  | 'playlists'
  | 'favorites'
  | 'genres'
  | 'all';

/**
 * Subset relationship for scope composition. `'all'` is the superset of every
 * other scope; all non-'all' pull scopes are leaves (mutually disjoint).
 */
function isSubsetOf(a: SyncScope, b: SyncScope): boolean {
  if (a === b) return true;
  if (b === 'all') return a === 'home' || a === 'albums' || a === 'artists'
    || a === 'playlists' || a === 'favorites' || a === 'genres';
  return false;
}

/**
 * Fan out one scope to the underlying store methods. Phase-1 pass-through.
 */
async function performScope(scope: SyncScope): Promise<void> {
  switch (scope) {
    case 'home':
      await albumListsStore.getState().refreshAll();
      return;
    case 'albums':
      await albumLibraryStore.getState().fetchAllAlbums();
      return;
    case 'artists':
      await artistLibraryStore.getState().fetchAllArtists();
      return;
    case 'playlists':
      await playlistLibraryStore.getState().fetchAllPlaylists();
      return;
    case 'favorites':
      // Background sync: refresh metadata without kicking off the
      // eager cover-art fan-out. Opening the Favourites tab directly
      // still pre-caches art (that path doesn't go through performScope).
      await favoritesStore.getState().fetchStarred({ prefetchCovers: false });
      return;
    case 'genres':
      await genreStore.getState().fetchGenres();
      return;
    case 'all':
      // `allSettled` so that if any scope fetcher is ever refactored to
      // throw (today they all swallow their own errors), the remaining
      // scopes still run to completion rather than silently skipping.
      await Promise.allSettled([
        performScope('home'),
        performScope('albums'),
        performScope('artists'),
        performScope('playlists'),
        performScope('favorites'),
        performScope('genres'),
      ]);
      return;
    default:
      return;
  }
}

/**
 * Wrap a scope invocation with dedup + subset awaits. Returns the promise
 * that callers should await.
 */
function dispatch(scope: SyncScope, work: () => Promise<void>): Promise<void> {
  const status = syncStatusStore.getState();
  // Collapse: same scope or a superset is already in flight.
  for (const [running, pending] of status.inFlight) {
    if (running === scope) return pending;
    if (isSubsetOf(scope, running)) return pending;
  }
  // Superset awaits any subsets currently in flight before firing the delta.
  const subsetPromises: Promise<void>[] = [];
  for (const [running, pending] of status.inFlight) {
    if (isSubsetOf(running, scope) && running !== scope) {
      subsetPromises.push(pending);
    }
  }
  const wrapped = (async () => {
    if (subsetPromises.length > 0) {
      await Promise.allSettled(subsetPromises);
    }
    try {
      await work();
    } finally {
      syncStatusStore.getState().clearInFlight(scope);
    }
  })();
  syncStatusStore.getState().setInFlight(scope, wrapped);
  return wrapped;
}

/* ------------------------------------------------------------------ */
/*  Public entry points                                                */
/* ------------------------------------------------------------------ */

/**
 * Called once auth is rehydrated and the app is online. Mirrors the startup
 * prefetch chain currently inlined in `_layout.tsx` — in Phase 1 we don't
 * move the call site; in Phase 2 `_layout.tsx` will delegate here.
 */
export async function onStartup(): Promise<void> {
  if (offlineModeStore.getState().offlineMode) {
    // Surface "paused — offline" so the user knows sync is waiting on
    // connectivity. Without this the banner stayed silent and users
    // couldn't tell whether their library was stale or already synced.
    if (isLibrarySyncPending()) {
      syncStatusStore.getState().setDetailSyncPhase('paused-offline');
    }
    return;
  }
  await startupOrResumeFlow();
}

/**
 * Called when the user toggles offline mode off. Same fan-out as startup.
 */
export async function onOnlineResume(): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  await startupOrResumeFlow();
}

/**
 * Detects server-switch by comparing the current `authStore.serverUrl` +
 * username against the last-known values from the previous session. If
 * they differ, wipes the album-detail + song-index caches so the new
 * server's ingestion path doesn't pick up stale rows from a different
 * library. First-run (no lastKnown) is not treated as a switch.
 *
 * Called at the top of `startupOrResumeFlow`.
 */
function handleServerSwitchIfNeeded(): void {
  const { serverUrl, username } = authStore.getState();
  if (!serverUrl || !username) return;
  const currentIdentity = `${serverUrl}::${username}`;
  const lastKnown = syncStatusStore.getState().lastKnownServerUrl;
  if (lastKnown == null) {
    // First session for this session's identity; just record it.
    syncStatusStore.getState().setLastKnownMarkers({
      lastKnownServerUrl: currentIdentity,
    });
    return;
  }
  if (lastKnown === currentIdentity) return;
  // Server or user changed — clear stale caches before the new library
  // ingestion runs. Same store-clearing steps as `forceFullResync` minus the
  // re-fetch (onStartup handles that).
  cancelAllSyncs('server-switch');
  albumDetailStore.getState().clearAlbums();
  albumLibraryStore.getState().clearAlbums();
  syncStatusStore.getState().setLastKnownMarkers({
    lastKnownServerUrl: currentIdentity,
    // Reset content-change markers so the newest-album probe re-baselines
    // against the new server's top album rather than chasing a phantom
    // "new" id from the previous server.
    lastKnownNewestAlbumId: null,
    lastKnownNewestAlbumCreated: null,
    lastKnownServerSongCount: null,
    lastKnownServerScanTime: null,
  });
}

async function startupOrResumeFlow(): Promise<void> {
  // Detect server/user switch first so any stale cache is cleared before
  // the ingestion chain runs against the new identity.
  handleServerSwitchIfNeeded();
  // Immediate chain — mirrors _layout.tsx:321-326.
  fetchServerInfo().then((info) => {
    if (info) serverInfoStore.getState().setServerInfo(info);
  });
  fetchScanStatus();
  albumListsStore.getState().refreshAll();
  // Startup sync — metadata only, art pre-caches on user-initiated views.
  favoritesStore.getState().fetchStarred({ prefetchCovers: false });

  // Deferred library prefetches — mirrors _layout.tsx:341-354. Uses the same
  // requestIdleCallback + 1500ms settling pattern to avoid a thundering herd
  // on the JS thread at launch. The detail-walk fires only after the library
  // prefetch has actually returned data — running against a stale or empty
  // library snapshot would do nothing useful.
  requestIdleCallback(() => {
    setTimeout(async () => {
      const libPromise = albumLibraryStore.getState().albums.length === 0
        ? albumLibraryStore.getState().fetchAllAlbums()
        : Promise.resolve();

      if (artistLibraryStore.getState().artists.length === 0) {
        artistLibraryStore.getState().fetchAllArtists();
      }
      if (playlistLibraryStore.getState().playlists.length === 0) {
        playlistLibraryStore.getState().fetchAllPlaylists();
      }
      genreStore.getState().fetchGenres();

      // Wait for the library fetch before launching the detail walk. If a
      // walk was stalled from the previous session we run that recovery
      // path instead — same engine either way.
      try {
        await libPromise;
      } catch {
        /* library fetch swallows its own errors; walk will see empty albums */
      }
      if (!offlineModeStore.getState().offlineMode) {
        // Detect changes since last session (scan status or newest-album
        // probe) and surface any new albums + their details before
        // running the full walk. Detect errors are swallowed — fire the
        // walk either way.
        fireAndForget(
          detectChanges().then(({ changedAlbumIds }) => {
            if (changedAlbumIds.length > 0) {
              // Routed through onScanCompleted which already handles upsert
              // + detail fetch for changed IDs.
              fireAndForget(onScanCompleted(), 'sync.onScanCompleted');
            }
          }),
          'sync.detectChanges',
        );
        // Fire-and-forget — walk progress is visible via the pill banner.
        fireAndForget(runFullAlbumDetailSync(), 'sync.runFullAlbumDetailSync');
      }
    }, 1500);
  });
}

/**
 * Called from `_layout.tsx`'s deferred-init chain, alongside
 * `deferredImageCacheInit` / `deferredMusicCacheInit`. Re-enters the walk if
 * a previous session left it stalled. Separate from `onStartup` because it
 * also needs to fire on AppState transitions back to 'active'.
 */
export async function deferredDataSyncInit(): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  await recoverStalledSync();
}

/**
 * User-initiated refresh of a scope. Enforces a minimum spinner duration
 * (for UI feedback) and dedup against any in-flight work for the same/super
 * scope. Runs in the background for supersets when a subset is already doing
 * some of the work.
 */
export async function onPullToRefresh(scope: PullToRefreshScope): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  const delay = minDelay();
  const work = async () => {
    await performScope(scope);
    await delay;
  };
  return dispatch(scope, work);
}

/**
 * Called when a server scan transitions from scanning=true to scanning=false.
 * Runs change detection and upserts any new albums into the library (and
 * their detail), so the UI reflects scan results without requiring the user
 * to pull-to-refresh.
 */
export async function onScanCompleted(): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  const { changedAlbumIds, newestAlbums } = await detectChanges();
  if (changedAlbumIds.length === 0) return;
  // Use the same probe result from detectChanges — no second network call.
  const lib = albumLibraryStore.getState();
  const knownIds = new Set(lib.albums.map((a) => a.id));
  const newAlbums: AlbumID3[] = [];
  for (const album of newestAlbums) {
    if (changedAlbumIds.includes(album.id) && !knownIds.has(album.id)) {
      newAlbums.push(album);
    }
  }
  if (newAlbums.length > 0) {
    lib.upsertAlbums(newAlbums);
  }
  // Fetch detail for each new album so the walk's reconciliation picks it up
  // and the flat song index stays in sync without waiting for a full walk.
  // `prefetchCovers: false` — background metadata sync; covers cache on
  // first user-visible view.
  const detail = albumDetailStore.getState();
  await Promise.all(
    changedAlbumIds.map((id) =>
      detail.fetchAlbum(id, { prefetchCovers: false }).catch(() => null),
    ),
  );
}

/**
 * Called once per successful scrobble batch (anySucceeded === true). Refreshes
 * the recently-played section only — preserves the current narrow behavior
 * of scrobbleService.
 */
export async function onScrobbleCompleted(): Promise<void> {
  await albumListsStore.getState().refreshRecentlyPlayed();
}

/**
 * Called when a caller encounters an album id that may not be in the library
 * cache yet (e.g. download-time from `musicCacheService`, a just-added album
 * surfaced via `recentlyAdded`). Replacement for the legacy
 * `albumLibraryStore.subscribe(albumListsStore)` side-effect retired in
 * Phase 5.
 *
 * Semantics:
 *   - If the id is already in the library: no-op.
 *   - If the library is cold (zero albums cached): no-op — the startup
 *     path already handles first-fetch via its `length === 0` guard.
 *   - Otherwise: kick off a background full-library refetch. `fetchAllAlbums`
 *     has its own loading guard so overlapping callers collapse to one fetch.
 */
export async function onAlbumReferenced(albumId: string): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  const libState = albumLibraryStore.getState();
  if (libState.albums.length === 0) return;
  if (libState.albums.some((a) => a.id === albumId)) return;
  // Fire-and-forget — reconciliation on the fresh library (via the hook
  // registered at module load) will pick up the new album's detail too.
  fireAndForget(libState.fetchAllAlbums(), 'sync.onAlbumReferenced');
}

/** Bounded concurrency for the playlist-detail prefetch (smaller than the
 *  album walk since playlist details can be large per entry). */
const PLAYLIST_PREFETCH_CONCURRENCY = 2;

/**
 * Mirror of `reconcileAlbumLibrary` for the playlist library: reap orphaned
 * detail entries from `playlistDetailStore` and pre-fetch newly added
 * playlists. Unlike albums, playlists don't feed the flat `songIndexStore`.
 */
export function reconcilePlaylistLibrary(
  oldIds: readonly string[],
  newIds: readonly string[],
): void {
  const newSet = new Set(newIds);
  const oldSet = new Set(oldIds);

  const removed: string[] = [];
  for (const id of oldIds) {
    if (!newSet.has(id)) removed.push(id);
  }
  const added: string[] = [];
  for (const id of newIds) {
    if (!oldSet.has(id)) added.push(id);
  }

  if (removed.length > 0) {
    const detail = playlistDetailStore.getState();
    for (const id of removed) detail.removePlaylist(id);
  }

  if (added.length > 0 && !offlineModeStore.getState().offlineMode) {
    const detail = playlistDetailStore.getState();
    // Fire-and-forget with a small pool; playlist detail fetches are
    // individually large so we keep concurrency lower than the album walk.
    // `prefetchCovers: false` — background metadata sync; the detail
    // screen will cache art the first time the user opens a playlist.
    fireAndForget(
      runPool(
        added,
        async (id) => detail.fetchPlaylist(id, { prefetchCovers: false }),
        { concurrency: PLAYLIST_PREFETCH_CONCURRENCY },
      ),
      'sync.playlistDetailPrefetch',
    );
  }
}

/**
 * Reconcile downstream caches (`albumDetailStore`, `songIndexStore`) and
 * the detail walk against the result of a full `albumLibraryStore` refetch.
 *
 * Inputs are the ID lists before and after the refetch. Three effects:
 *   1. **Reap removals** (`oldIds − newIds`): drop orphaned detail entries
 *      + their song-index rows. Closes the ghost-songs bug where a deleted
 *      album's songs would linger in the flat song index.
 *   2. **Pre-fetch additions** (`newIds − oldIds`): kick off the walk.
 *      `runFullAlbumDetailSync` recomputes missing on entry, so the new
 *      IDs are picked up automatically — we just need to trigger it.
 *   3. No-op when both sets are identical.
 *
 * Called by the hook registered with `albumLibraryStore` at module load.
 */
export function reconcileAlbumLibrary(
  oldIds: readonly string[],
  newIds: readonly string[],
): void {
  const newSet = new Set(newIds);
  const oldSet = new Set(oldIds);

  const removed: string[] = [];
  for (const id of oldIds) {
    if (!newSet.has(id)) removed.push(id);
  }
  let addedCount = 0;
  for (const id of newIds) {
    if (!oldSet.has(id)) addedCount++;
  }

  if (removed.length > 0) {
    // `removeEntries` on the detail store cascades the song-index delete.
    albumDetailStore.getState().removeEntries(removed);
  }

  if (addedCount > 0 && !offlineModeStore.getState().offlineMode) {
    // Fire-and-forget — walk is async and in-flight dedup-safe.
    fireAndForget(runFullAlbumDetailSync(), 'sync.reconcileAlbumLibrary');
  }
}

/**
 * User-triggered full resync from settings. Exit hatch when something has
 * gone wrong — wipes the cached library + detail + song index and refires
 * the whole ingestion path.
 *
 * Steps:
 *   1. Cancel any in-flight walk by bumping generation. Worker bails on the
 *      next iteration and the walk's finally block tidies up.
 *   2. Clear `albumDetailStore` (cascades to `songIndexStore` via
 *      `clearDetailTables`) and `albumLibraryStore`.
 *   3. Refetch the album library. The reconcile hook + walk take over the
 *      rest (fresh detail for every album, fresh flat song index).
 *
 * Safe to invoke while offline — it still clears local state, which is
 * useful when the user is troubleshooting bad cached data.
 */
export async function forceFullResync(): Promise<void> {
  cancelAllSyncs('force-resync');
  // Reset orchestration state so the banner starts clean.
  syncStatusStore.getState().resetDetailSync();
  // Clear all cached data. `albumDetailStore.clearAlbums` cascades to
  // `songIndexStore` via the `clearDetailTables` helper.
  albumDetailStore.getState().clearAlbums();
  albumLibraryStore.getState().clearAlbums();

  if (offlineModeStore.getState().offlineMode) {
    // Offline: we've cleared local caches. On reconnect, `onOnlineResume`
    // will refetch. Exit early — no point attempting a network call.
    return;
  }

  // Refetch the library — its reconcile hook kicks off the walk.
  await albumLibraryStore.getState().fetchAllAlbums();
}

/**
 * Normalize a subsonic `created` field (may be Date or ISO-8601 string) to
 * milliseconds. Returns 0 on failure — safe default since a 0-epoch
 * comparison is always "older".
 */
function parseCreatedMs(created: Date | string | undefined | null): number {
  if (!created) return 0;
  if (created instanceof Date) {
    const ms = created.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  const ms = Date.parse(created);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Incremental change detection. Two paths:
 *
 *   - **Primary (scan-aware)**: if the server supports `getScanStatus`
 *     (`canUserScan()` true) and `lastScan` has moved since our recorded
 *     marker, we know the library changed and harvest the newest albums.
 *   - **Fallback (newest-album probe)**: call `getAlbumList2?type=newest`
 *     and compare the top album's `id` AND `created` timestamp against our
 *     last-known markers. The id comparison guards against server-clock
 *     skew that would otherwise mask new content whose `created` is
 *     numerically older than the previous marker.
 *
 * Updates `syncStatusStore.lastKnown*` markers on every call.
 *
 * Returns only the IDs of albums that appear to be new since our last
 * observation. Callers are expected to upsert them into
 * `albumLibraryStore` and then trigger a detail fetch for each.
 */
export async function detectChanges(): Promise<{
  changedAlbumIds: string[];
  newestAlbums: AlbumID3[];
}> {
  if (offlineModeStore.getState().offlineMode) {
    return { changedAlbumIds: [], newestAlbums: [] };
  }

  const existing = syncStatusStore.getState().getInFlight('change-detect');
  if (existing) {
    await existing;
    return { changedAlbumIds: [], newestAlbums: [] };
  }

  let settle: () => void;
  const gate = new Promise<void>((r) => { settle = r; });
  syncStatusStore.getState().setInFlight('change-detect', gate);

  try {
    const status = syncStatusStore.getState();
    const scanState = scanStatusStore.getState();

    // Primary check via scan status (if supported).
    let primaryTriggered = false;
    if (canUserScan()) {
      const scanTimeChanged =
        scanState.lastScan != null
        && scanState.lastScan !== status.lastKnownServerScanTime;
      const countChanged =
        scanState.count > 0
        && scanState.count !== status.lastKnownServerSongCount;
      primaryTriggered = scanTimeChanged || countChanged;
    }

    // Fallback probe — we also run this even when primary was triggered, so
    // we can collect the actual new IDs. One `getRecentlyAddedAlbums` call is
    // cheap and uniform across servers.
    const newest: AlbumID3[] = await getRecentlyAddedAlbums(50);
    const changedAlbumIds: string[] = [];

    if (newest.length > 0) {
      const topId = newest[0].id;
      const topCreated = parseCreatedMs(newest[0].created);

      const idChanged = topId !== status.lastKnownNewestAlbumId;
      const timestampChanged =
        topCreated > (status.lastKnownNewestAlbumCreated ?? 0);

      if (primaryTriggered || idChanged || timestampChanged) {
        // Walk down the list until we hit something we already know.
        const libraryIds = new Set(
          albumLibraryStore.getState().albums.map((a) => a.id),
        );
        for (const album of newest) {
          if (libraryIds.has(album.id)) continue;
          changedAlbumIds.push(album.id);
        }
      }
    }

    // Update last-known markers — but ONLY advance the scan-status markers
    // when we had a complete view (newest probe returned something). If the
    // scan-status primary triggered but the probe was empty (transient
    // error), holding the old scan markers means the next call will re-check
    // and actually harvest the IDs rather than silently consuming the signal.
    const probeGotData = newest.length > 0;
    syncStatusStore.getState().setLastKnownMarkers({
      lastChangeDetectionAt: Date.now(),
      lastKnownServerSongCount: probeGotData
        ? scanState.count
        : status.lastKnownServerSongCount,
      lastKnownServerScanTime: probeGotData
        ? scanState.lastScan
        : status.lastKnownServerScanTime,
      lastKnownNewestAlbumId: newest[0]?.id ?? status.lastKnownNewestAlbumId,
      lastKnownNewestAlbumCreated: newest[0]
        ? parseCreatedMs(newest[0].created)
        : status.lastKnownNewestAlbumCreated,
    });

    return { changedAlbumIds, newestAlbums: newest };
  } catch {
    return { changedAlbumIds: [], newestAlbums: [] };
  } finally {
    syncStatusStore.getState().clearInFlight('change-detect');
    settle!();
  }
}

/**
 * Walk every album in `albumLibraryStore` and populate `albumDetailStore`
 * for any IDs missing from the detail cache. Reconciliation-based:
 * `missing = libraryIds - detailIds` is recomputed at walk start; no persisted
 * queue. Same resumability contract as `musicCacheService.downloadItem` —
 * kill mid-walk, restart, reconciliation picks up where we left off.
 *
 * Idempotent: overlapping calls collapse via `syncStatusStore.inFlight`.
 * Honors `offlineModeStore.offlineMode` (bails early) and the generation
 * counter on `syncStatusStore` (stale workers exit).
 */
export async function runFullAlbumDetailSync(): Promise<void> {
  const existing = syncStatusStore.getState().getInFlight('full-walk');
  if (existing) return existing;

  // Register the in-flight promise SYNCHRONOUSLY before any `await` so a
  // second synchronous caller sees the pending promise instead of starting
  // a second walk. The Promise resolves when the internal walk resolves.
  let settle: () => void;
  const walkPromise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  syncStatusStore.getState().setInFlight('full-walk', walkPromise);

  try {
    await doWalk();
  } finally {
    settle!();
    syncStatusStore.getState().clearInFlight('full-walk');
  }
  return walkPromise;
}

async function doWalk(): Promise<void> {
  // --- gate: must be online, library must be populated ---
  if (offlineModeStore.getState().offlineMode) {
    syncStatusStore.getState().setDetailSyncPhase('paused-offline');
    return;
  }
  const libState = albumLibraryStore.getState();
  if (libState.loading) return; // library still fetching; recovery will retry
  if (libState.albums.length < MIN_LIBRARY_FOR_WALK) {
    syncStatusStore.getState().resetDetailSync();
    return;
  }

  // --- compute missing (reconciliation) ---
  const detailAlbums = albumDetailStore.getState().albums;
  const missing: string[] = [];
  for (const album of libState.albums) {
    if (!Object.prototype.hasOwnProperty.call(detailAlbums, album.id)) {
      missing.push(album.id);
    }
  }
  if (missing.length === 0) {
    syncStatusStore.getState().resetDetailSync();
    return;
  }

  // --- start walk ---
  const capturedGen = syncStatusStore.getState().generation;
  const startedAt = Date.now();
  syncStatusStore.getState().setDetailSyncPhase('syncing');
  syncStatusStore.getState().setDetailSyncTotal(missing.length, startedAt);
  syncStatusStore.getState().setDetailSyncError(null);

  // External abort signals: generation bump (cancel/force-resync/logout) or
  // offline-mode flip. These subscribe for the duration of the walk.
  const ctrl = new AbortController();
  const unsubGen = syncStatusStore.subscribe((state) => {
    if (state.generation !== capturedGen) ctrl.abort();
  });
  const unsubOffline = offlineModeStore.subscribe((state) => {
    if (state.offlineMode) ctrl.abort();
  });

  try {
    const { rejected } = await runPool(
      missing,
      async (id) => {
        // Inner bail — generation may have moved between iterations.
        if (syncStatusStore.getState().generation !== capturedGen) {
          throw new Error('walk-aborted');
        }
        if (offlineModeStore.getState().offlineMode) {
          throw new Error('walk-offline');
        }
        // `prefetchCovers: false` — this is the background album-detail
        // walk. It refreshes metadata for the entire library; we don't
        // want a sync to kick off thousands of image downloads. Cover art
        // lazily caches when the user actually opens an album detail.
        const result = await albumDetailStore
          .getState()
          .fetchAlbum(id, { prefetchCovers: false });
        // fetchAlbum returns null on every non-2xx / timeout / swallowed-error
        // case. Classify those as rejected so the walk's error summary
        // reflects real counts and the next walk actually retries them.
        if (result == null) throw new Error('fetch-returned-null');
        // Bump the persisted completed counter so the banner's progress
        // display is O(1) and accurate even when the library is partially
        // cached at walk start.
        syncStatusStore.getState().incrementDetailSyncCompleted();
        return result;
      },
      { concurrency: WALK_CONCURRENCY, signal: ctrl.signal },
    );

    // Final phase reflects why the walk ended.
    if (syncStatusStore.getState().generation !== capturedGen) {
      // Cancel / logout / force-resync already set state appropriately.
      return;
    }
    if (offlineModeStore.getState().offlineMode) {
      syncStatusStore.getState().setDetailSyncPhase('paused-offline');
      return;
    }
    if (rejected.length > 0) {
      syncStatusStore.getState().setDetailSyncError(
        `${rejected.length} album(s) failed; pull-to-refresh will retry.`,
      );
    } else {
      // Successful completion clears any stale error from a prior walk.
      syncStatusStore.getState().setDetailSyncError(null);
    }
    // Partial failure is acceptable; phase returns to idle either way and
    // the next walk picks up remaining missing IDs via reconciliation.
    syncStatusStore.getState().setDetailSyncPhase('idle');
    syncStatusStore.getState().setDetailSyncTotal(0, null);
  } finally {
    unsubGen();
    unsubOffline();
  }
}

/**
 * Called by AppState-active and `deferredDataSyncInit()` on app start. If a
 * walk was previously running (persisted phase === 'syncing' or 'paused-*'),
 * re-enter the walk — reconciliation re-computes the missing set, so any
 * progress from the previous session is preserved.
 *
 * Safe to call repeatedly. No-op if there's no stalled walk to recover.
 */
export async function recoverStalledSync(): Promise<void> {
  const phase = syncStatusStore.getState().detailSyncPhase;
  const resumablePhases: Array<typeof phase> = [
    'syncing',
    'paused-offline',
    'paused-auth-error',
    'paused-metered',
    'error',
  ];
  if (!resumablePhases.includes(phase)) return;
  if (offlineModeStore.getState().offlineMode) {
    // Still offline — flip to the correct paused phase and stop.
    syncStatusStore.getState().setDetailSyncPhase('paused-offline');
    return;
  }
  await runFullAlbumDetailSync();
}

/**
 * Abort every running walk/worker by bumping the generation counter. In-flight
 * workers capture a generation on entry and bail on mismatch (same pattern as
 * `musicCacheService.processingId`).
 */
export function cancelAllSyncs(reason: 'logout' | 'force-resync' | 'server-switch' | 'user-cancel'): void {
  syncStatusStore.getState().bumpGeneration();
  // Flip phase back to idle so the pill banner doesn't stay stuck showing
  // "syncing N / total" after a user-initiated cancel — the walk's generation
  // guard will exit the pool but does NOT set phase on the cancel path.
  // Reconciliation-based recovery will still pick up missing IDs on the next
  // trigger (app foreground, pull-to-refresh, scan).
  if (reason === 'user-cancel' || reason === 'logout' || reason === 'server-switch') {
    syncStatusStore.getState().resetDetailSync();
  }
}

/* ------------------------------------------------------------------ */
/*  Cross-service wiring (registered at module load)                   */
/* ------------------------------------------------------------------ */

// Connect the hook-based observers in scrobbleService / scanService to the
// orchestration entry points here. This avoids those services importing
// dataSyncService (which would transitively pull the entire store graph
// into any test that mocks them).
registerScrobbleBatchCompletedHook(() => {
  fireAndForget(onScrobbleCompleted(), 'sync.hook.scrobbleBatch');
});
registerScanCompletedHook(() => {
  fireAndForget(onScanCompleted(), 'sync.hook.scanCompleted');
});
registerAlbumLibraryReconcileHook((oldIds, newIds) => reconcileAlbumLibrary(oldIds, newIds));
registerPlaylistLibraryReconcileHook((oldIds, newIds) => reconcilePlaylistLibrary(oldIds, newIds));
registerMusicCacheOnAlbumReferencedHook((albumId) => {
  fireAndForget(onAlbumReferenced(albumId), 'sync.hook.onAlbumReferenced');
});

// Retire the legacy `albumListsStore` → `albumLibraryStore` subscribe by
// reimplementing it here: when `recentlyAdded` surfaces an id the library
// doesn't have, route through `onAlbumReferenced`. This keeps the same
// "new album on home page triggers library refresh" behavior but without
// a store-level import cycle.
albumListsStore.subscribe((state, prev) => {
  if (state.recentlyAdded === prev.recentlyAdded) return;
  const libState = albumLibraryStore.getState();
  if (libState.albums.length === 0) return;
  const knownIds = new Set(libState.albums.map((a) => a.id));
  for (const album of state.recentlyAdded) {
    if (!knownIds.has(album.id)) {
      fireAndForget(onAlbumReferenced(album.id), 'sync.recentlyAddedReferenced');
      return; // one fetch covers all new ids via reconciliation
    }
  }
});

// React to offline-mode toggles at runtime so the sync banner tracks
// reality without relying on the user to relaunch the app. An in-flight
// walk is already handled by the per-walk subscription inside doWalk()
// — this module-scope subscriber fills the gap when phase is 'idle'
// (user flips offline on with a stale library) or 'paused-offline'
// (user flips offline off and we need to resume).
offlineModeStore.subscribe((state, prev) => {
  if (state.offlineMode === prev.offlineMode) return;
  const phase = syncStatusStore.getState().detailSyncPhase;
  if (state.offlineMode) {
    if (phase === 'idle' && isLibrarySyncPending()) {
      syncStatusStore.getState().setDetailSyncPhase('paused-offline');
    }
  } else {
    if (phase === 'paused-offline') {
      fireAndForget(onOnlineResume(), 'sync.offlineToggle.resume');
    }
  }
});

/* ------------------------------------------------------------------ */
/*  Internals exposed for tests                                        */
/* ------------------------------------------------------------------ */

export const __internal = { isSubsetOf, performScope, dispatch };
