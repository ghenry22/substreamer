/**
 * Central data sync orchestration.
 *
 * Entry points fan out to the store methods in the order/concurrency the app
 * uses, and drive the album-detail walk, change detection, and reconciliation.
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
import { musicCacheStore } from '../store/musicCacheStore';
import { connectivityStore } from '../store/connectivityStore';
import { scanStatusStore } from '../store/scanStatusStore';
import { authStore } from '../store/authStore';
import { runWhenIdle } from '../utils/runWhenIdle';
import { kvStorage } from '../store/persistence';
import { downloadedMetadataRefreshStore } from '../store/downloadedMetadataRefreshStore';
import { refreshDownloadedMetadata } from './downloadedMetadataService';
import { serverInfoStore } from '../store/serverInfoStore';
import { syncStatusStore, type SyncScope } from '../store/syncStatusStore';
import { fireAndForget } from '../utils/fireAndForget';
import { runPool } from '../utils/promisePool';
import { minDelay } from '../utils/stringHelpers';
import {
  countLibraryAlbumsAsync,
  deleteLibraryAlbumsAsync,
} from '../store/persistence/libraryAlbumsTable';
import {
  bulkUpsertSongs,
  countSongIndexAsync,
  getDetailedAlbumIdsAsync,
} from '../store/persistence/detailTables';
import { songIndexStore } from '../store/songIndexStore';
import { songLibraryStore } from '../store/songLibraryStore';
import { registerMusicCacheOnAlbumReferencedHook, syncCachedItemTracks } from './musicCacheService';
import { fetchScanStatus, registerScanCompletedHook } from './scanService';
import { registerScrobbleBatchCompletedHook } from './scrobbleService';
import { canUserScan } from './serverCapabilityService';
import {
  ensureCoverArtAuth,
  fetchServerInfo,
  getAlbum,
  getRecentlyAddedAlbums,
  probeEmptySearch3,
  searchSongsPage,
  type AlbumID3,
  type Child,
  type Playlist,
} from './subsonicService';

/** Bounded concurrency for the album-detail walk. */
const WALK_CONCURRENCY = 4;
/** Skip the walk entirely on tiny libraries — not worth the startup cost. */
const MIN_LIBRARY_FOR_WALK = 1;
/**
 * Delay after the JS thread reports idle before kicking off deferred
 * startup prefetches (library lists, genres, detail walk). Empirically
 * chosen — at ~1.5s the first paint has settled, hydration is done, and
 * the initial network/auth handshakes have either landed or timed out
 * locally. Shorter values stutter the splash; longer values delay the
 * library appearing on screen.
 */
const STARTUP_PREFETCH_SETTLE_MS = 1500;

/**
 * True when there's library work to do — either the album list hasn't been
 * fetched yet, or we have albums without detail cached. Used to decide
 * whether an offline startup should surface the "paused — offline" banner
 * or stay silent.
 */
function isLibrarySyncPending(): boolean {
  const lib = albumLibraryStore.getState();
  const status = syncStatusStore.getState();
  // Pending if the album list or the song index hasn't fully synced. O(1) —
  // no per-album detail scan (album_details is on-demand now).
  return lib.albums.length === 0 || !status.librarySyncComplete || !status.songSyncComplete;
}

/**
 * One-time upgrade seed: `songSyncComplete` is a new flag (defaults false). An
 * existing install already has a fully-populated `song_index` from the old
 * album-detail walk, so seed it complete to avoid a needless full song re-sync
 * on the first launch after the update.
 */
async function maybeSeedSongSyncComplete(): Promise<void> {
  if (syncStatusStore.getState().songSyncComplete) return;
  // Key off the actual table counts, not the persisted flag (which may not have
  // carried from an older build): a populated song_index + library_albums means
  // a previous version already fully synced. Seeds the count from disk truth too.
  const [songs, albums] = await Promise.all([countSongIndexAsync(), countLibraryAlbumsAsync()]);
  if (songs > 0 && albums > 0) {
    syncStatusStore.getState().markSongSyncComplete();
  }
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
 * Fan out one scope to the underlying store methods.
 */
async function performScope(scope: SyncScope): Promise<void> {
  switch (scope) {
    case 'home':
      await albumListsStore.getState().refreshAll();
      return;
    case 'albums':
      // Pull-to-refresh. If the initial paginated list fetch never finished,
      // resume it (fetchAllAlbums picks up from COUNT(*)). Once the library is
      // fully fetched, a full re-download would be wasteful at scale — instead
      // run the cheap incremental change-detection (newest-album probe) which
      // ingests server-added albums and fires the detail walk. (Server-side
      // removals / bulk metadata rewrites are handled by the explicit
      // Settings → Sync Library force-resync.)
      if (!syncStatusStore.getState().librarySyncComplete) {
        await albumLibraryStore.getState().fetchAllAlbums();
      } else {
        await onScanCompleted();
      }
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
 * Called once auth is rehydrated and the app is online. Runs the startup
 * prefetch chain (delegated here from `_layout.tsx`).
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
async function handleServerSwitchIfNeeded(): Promise<void> {
  const { serverUrl, username } = authStore.getState();
  if (!serverUrl || !username) return;
  const currentIdentity = `${serverUrl}::${username}`;
  const lastKnown = syncStatusStore.getState().lastKnownServerUrl;
  if (lastKnown == null) {
    // No prior identity recorded — store the current one.
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
  await albumDetailStore.getState().clearAlbums();
  await albumLibraryStore.getState().clearAlbums();
  // Reset the song sync + re-probe capability for the new server.
  syncStatusStore.getState().resetSongSync();
  syncStatusStore.getState().setSyncStrategy(null);
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
  await handleServerSwitchIfNeeded();
  // Immediate chain — mirrors _layout.tsx:321-326.
  fetchServerInfo().then((info) => {
    if (info) serverInfoStore.getState().setServerInfo(info);
  });
  fetchScanStatus();
  // Eager home-list refresh (so the home updates promptly), but gated on
  // offline/reachability via refreshAllIfDue(0) so we don't fire a doomed
  // fetch when the server isn't reachable. This is the single cold-start
  // refresh — runDeferredStartup no longer duplicates it.
  albumListsStore.getState().refreshAllIfDue(0);
  // Startup sync — metadata only, art pre-caches on user-initiated views.
  favoritesStore.getState().fetchStarred({ prefetchCovers: false });

  // Deferred library prefetches. requestIdleCallback waits for the JS
  // thread to settle; the STARTUP_PREFETCH_SETTLE_MS delay then keeps
  // network fan-out off the splash → first-paint critical path.
  runWhenIdle(() => {
    setTimeout(async () => {
      // Full album-LIST fetch only when it isn't already complete on disk. A
      // completed library with rows present skips straight to change-detection;
      // an interrupted/partial fetch (librarySyncComplete=false) resumes the
      // pager from COUNT(*). Reads SQL COUNT (disk truth), not the in-memory
      // array, so hydration timing can't trigger a spurious full re-fetch.
      const rowCount = await countLibraryAlbumsAsync();
      const needsLibraryFetch =
        !syncStatusStore.getState().librarySyncComplete ||
        rowCount === 0 ||
        albumLibraryStore.getState().albums.length === 0;
      const libPromise = needsLibraryFetch
        ? albumLibraryStore.getState().fetchAllAlbums()
        : Promise.resolve();

      if (artistLibraryStore.getState().artists.length === 0) {
        artistLibraryStore.getState().fetchAllArtists();
      }
      // Refresh playlists on every ONLINE startup (not just when empty) so the
      // reconcile picks up NEW/UPDATED playlists and refreshes their detail.
      // Three-gate it (mirrors albumListsStore.refreshAllIfDue) so we don't burn
      // a call when offline / the server is known-unreachable.
      {
        const conn = connectivityStore.getState();
        if (
          !offlineModeStore.getState().offlineMode &&
          conn.hasConnection &&
          conn.isServerReachable
        ) {
          playlistLibraryStore.getState().fetchAllPlaylists();
        }
      }
      genreStore.getState().fetchGenres();

      // One-time repair for the 8.0.89 on-demand-detail regression: re-cache
      // detail + cover art for downloaded items missing it. Flagged by migration
      // #33; runs once the server is genuinely reachable.
      //
      // RESUME, don't restart: `missing` mode only fetches detail that's still
      // absent, so an interrupted run's completed work is never redone — each
      // launch picks up just the stragglers. The flag clears to 'done' only when
      // NOTHING is left missing. To avoid looping forever on permanently-
      // unfetchable items (deleted albums, chronic errors), a pass that makes NO
      // progress counts toward a cap; after MAX passes we give up (on-demand
      // browse + the manual "Refresh metadata" button still cover the rest).
      {
        const conn = connectivityStore.getState();
        if (
          !offlineModeStore.getState().offlineMode &&
          conn.hasConnection &&
          conn.isServerReachable &&
          !downloadedMetadataRefreshStore.getState().active
        ) {
          fireAndForget(
            (async () => {
              const KEY = 'substreamer-dl-metadata-backfill';
              const MAX_NO_PROGRESS_PASSES = 3;
              const flag = await kvStorage.getItem(KEY);
              if (flag === null || flag === 'done') return;
              const noProgress = /^\d+$/.test(flag) ? Number(flag) : 0;
              if (noProgress >= MAX_NO_PROGRESS_PASSES) {
                await kvStorage.setItem(KEY, 'done');
                return;
              }
              const { attempted, remaining } = await refreshDownloadedMetadata({ mode: 'missing' });
              if (remaining === 0) {
                await kvStorage.setItem(KEY, 'done'); // every downloaded item has detail
              } else if (remaining < attempted) {
                await kvStorage.setItem(KEY, 'pending'); // progress → resume next launch
              } else {
                await kvStorage.setItem(KEY, String(noProgress + 1)); // stuck → bound retries
              }
            })(),
            'sync.downloadedMetadataBackfill',
          );
        }
      }

      // Wait for the library fetch before launching the detail walk. If a
      // walk was stalled from the previous session we run that recovery
      // path instead — same engine either way.
      try {
        await libPromise;
      } catch {
        /* library fetch swallows its own errors; walk will see empty albums */
      }
      if (!offlineModeStore.getState().offlineMode) {
        // One-time upgrade seed: existing installs already have a populated
        // song_index (from the old walk). Mark the new song sync complete so
        // they don't needlessly re-fetch the whole song catalog.
        await maybeSeedSongSyncComplete();
        // Detect changes since last session (scan status or newest-album
        // probe) and surface any new albums + their songs. Detect errors are
        // swallowed — fire the song sync either way.
        fireAndForget(
          detectChanges().then((result) => {
            if (result.changedAlbumIds.length > 0) {
              // Hand the already-computed result to onScanCompleted so it
              // doesn't re-run detectChanges against now-spent markers (which
              // would return [] and drop the newly-added albums).
              fireAndForget(onScanCompleted(result), 'sync.onScanCompleted');
            }
          }),
          'sync.detectChanges',
        );
        // Populate the flat Songs list (fast paged search3, or the walk
        // fallback) unless already done. Progress is visible via the banner.
        if (!syncStatusStore.getState().songSyncComplete) {
          fireAndForget(syncSongLibrary(), 'sync.syncSongLibrary');
        }
      }
    }, STARTUP_PREFETCH_SETTLE_MS);
  });
}

let _offlineSyncPhaseUnsub: (() => void) | null = null;

/**
 * Wire the runtime offline-mode → sync-phase reaction. Idempotent. Moved
 * out of module scope in Phase 5 so test imports of `dataSyncService` don't
 * register a sticky subscription that bleeds across test files. Called once
 * from `deferredDataSyncInit` per session (re-registers automatically on
 * logout → login cycles via the existing unsub stored in module state).
 */
function ensureOfflineSyncPhaseSubscription(): void {
  if (_offlineSyncPhaseUnsub) return;
  _offlineSyncPhaseUnsub = offlineModeStore.subscribe((state, prev) => {
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
}

/**
 * Called from `_layout.tsx`'s deferred-init chain, alongside
 * `deferredImageCacheInit` / `deferredMusicCacheInit`. Re-enters the walk if
 * a previous session left it stalled. Separate from `onStartup` because it
 * also needs to fire on AppState transitions back to 'active'.
 */
export async function deferredDataSyncInit(): Promise<void> {
  // Register the runtime offline-mode listener at boot time (idempotent).
  ensureOfflineSyncPhaseSubscription();
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
export async function onScanCompleted(
  precomputed?: { changedAlbumIds: string[]; newestAlbums: AlbumID3[] },
): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  const { changedAlbumIds, newestAlbums } = precomputed ?? (await detectChanges());
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
  // Pull the changed albums' SONGS into song_index (album_details stays
  // on-demand). Keeps the flat Songs list current without a full re-sync.
  await fetchSongsForAlbums(changedAlbumIds);
  // Real data changed (we returned early above when changedAlbumIds was empty).
  syncStatusStore.getState().bumpLibraryUpdated();
}

/**
 * Fetch the given albums' track lists via `getAlbum` and write them into
 * `song_index` only (NOT `album_details` — that stays on-demand). Used by the
 * incremental change paths (scan-completed, reconcile-added, album-referenced)
 * so newly-surfaced albums' songs land in the flat Songs list.
 */
async function fetchSongsForAlbums(ids: readonly string[]): Promise<void> {
  if (ids.length === 0 || offlineModeStore.getState().offlineMode) return;
  await Promise.all(
    ids.map(async (id) => {
      const album = await getAlbum(id).catch(() => null);
      if (album?.song && album.song.length > 0) {
        songIndexStore.getState().upsertSongsForAlbum(id, album.song);
      }
    }),
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
 *   - Otherwise: fetch ONLY that album and merge it into the library (#202).
 *     A targeted single-album upsert — never a full-library re-download, which
 *     was prohibitively expensive on large libraries.
 */
export async function onAlbumReferenced(albumId: string): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  const libState = albumLibraryStore.getState();
  if (libState.albums.length === 0) return;
  if (libState.albums.some((a) => a.id === albumId)) return;
  try {
    await ensureCoverArtAuth();
    const album = await getAlbum(albumId);
    if (album) {
      // Drop `song` — the library is a song-less AlbumID3[].
      const { song, ...albumMeta } = album;
      albumLibraryStore.getState().upsertAlbums([albumMeta]);
      // Also index this album's songs (C3) — otherwise an album first seen via
      // a download / recentlyAdded surface never lands in the flat Songs list.
      if (song && song.length > 0) {
        songIndexStore.getState().upsertSongsForAlbum(albumId, song);
      }
      // A new album was ingested into the library → mark the data as updated.
      syncStatusStore.getState().bumpLibraryUpdated();
    }
  } catch {
    /* best-effort: a missed reference resolves on the next full sync */
  }
}

/** Bounded concurrency for the playlist-detail prefetch (smaller than the
 *  album walk since playlist details can be large per entry). */
const PLAYLIST_PREFETCH_CONCURRENCY = 2;

/** Max playlists whose detail we eagerly refetch per reconcile. Bounds bandwidth
 *  when a server bumps `changed` on many playlists at once; the rest refresh on
 *  the next pass / on-demand. Downloaded playlists are exempt (their tracks must
 *  re-sync). */
const PLAYLIST_REFRESH_CAP = 50;

/**
 * Mirror of `reconcileAlbumLibrary` for the playlist library, run after every
 * `fetchAllPlaylists`. Reaps orphaned detail entries and refetches the detail
 * (track listing) of NEW and UPDATED playlists so the cached detail — and any
 * downloaded copy — stays current. Unlike albums, playlists don't feed the flat
 * `songIndexStore`.
 *
 * "Updated" is detected by comparing `changed`/`songCount`. NB: `Playlist.changed`
 * is typed `Date` but is actually a STRING at runtime (subsonic-api does no date
 * revival), persisted the same way — so both sides go through `parseCreatedMs`.
 */
export function reconcilePlaylistLibrary(
  oldPlaylists: readonly Playlist[],
  newPlaylists: readonly Playlist[],
): void {
  const oldById = new Map(oldPlaylists.map((p) => [p.id, p]));
  const newIds = new Set(newPlaylists.map((p) => p.id));
  const cachedItems = musicCacheStore.getState().cachedItems;
  const detail = playlistDetailStore.getState();

  // Reap detail for removed playlists — but KEEP it for still-downloaded ones:
  // the offline/downloaded filter renders from the cached detail, so removing it
  // orphans the files (invisible + unplayable). Drop from the online list only.
  for (const p of oldPlaylists) {
    if (newIds.has(p.id)) continue; // still present
    if (p.id in cachedItems) continue; // downloaded → keep detail
    detail.removePlaylist(p.id);
  }

  // NEW (unseen id) or UPDATED (changed timestamp / songCount differs).
  const toFetch: Playlist[] = [];
  for (const p of newPlaylists) {
    const old = oldById.get(p.id);
    if (!old) {
      toFetch.push(p);
    } else if (
      parseCreatedMs(old.changed) !== parseCreatedMs(p.changed) ||
      old.songCount !== p.songCount
    ) {
      toFetch.push(p);
    }
  }

  if (toFetch.length === 0 || offlineModeStore.getState().offlineMode) return;

  // Cap eager fetches (most-recently-changed first), but always include
  // downloaded playlists so their tracks re-sync regardless of the cap.
  const ordered = [...toFetch].sort(
    (a, b) => parseCreatedMs(b.changed) - parseCreatedMs(a.changed),
  );
  const capped: Playlist[] = [];
  let nonDownloaded = 0;
  for (const p of ordered) {
    if (p.id in cachedItems) {
      capped.push(p);
    } else if (nonDownloaded < PLAYLIST_REFRESH_CAP) {
      capped.push(p);
      nonDownloaded += 1;
    }
  }
  if (capped.length < toFetch.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sync] playlist refresh capped: ${capped.length}/${toFetch.length} eager, ` +
        `${toFetch.length - capped.length} deferred to next refresh`,
    );
  }

  // Fire-and-forget with a small pool; playlist detail fetches are individually
  // large so concurrency stays lower than the album walk. `prefetchCovers:false`
  // — background metadata sync; the detail screen caches art on first open.
  fireAndForget(
    runPool(
      capped,
      async (p) => {
        const updated = await detail.fetchPlaylist(p.id, { prefetchCovers: false });
        // Keep a downloaded playlist's cached tracks in step with the server.
        if (updated && p.id in musicCacheStore.getState().cachedItems) {
          syncCachedItemTracks(p.id, updated.entry ?? []);
        }
      },
      { concurrency: PLAYLIST_PREFETCH_CONCURRENCY },
    ),
    'sync.playlistDetailRefresh',
  );
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

  const cachedItems = musicCacheStore.getState().cachedItems;
  const cachedSongs = musicCacheStore.getState().cachedSongs;
  // Parent albums whose DETAIL backs a downloaded item's offline view but which
  // aren't themselves downloaded as albums: the parent album of a downloaded
  // single song, and the parent albums of favorited songs. Their album_details
  // must survive a server-side removal (so offline "go to album" from the song
  // still works), but their `library_albums` row may go — they weren't
  // downloaded as albums, so they shouldn't resurrect in the browse list.
  const protectedDetailAlbumIds = new Set<string>();
  for (const item of Object.values(cachedItems)) {
    if (item.type === 'song' && item.parentAlbumId) {
      protectedDetailAlbumIds.add(item.parentAlbumId);
    } else if (item.type === 'favorites') {
      for (const songId of item.songIds ?? []) {
        const parent = cachedSongs[songId]?.albumId;
        if (parent) protectedDetailAlbumIds.add(parent);
      }
    }
  }

  const removedDetail: string[] = []; // album_details (+ song-index cascade) to drop
  const removedRows: string[] = []; // lean `library_albums` list rows to drop
  for (const id of oldIds) {
    if (newSet.has(id)) continue;
    // Downloaded albums are NEVER reaped: their detail is the sole offline source
    // of the track list, and the album downloaded-filter renders from the
    // `library_albums` row — so a server-removed-but-downloaded album keeps BOTH
    // (mirrors the playlist guard above). Offline is a filtered view over this
    // cached data; automated sync must not delete it.
    if (id in cachedItems) continue;
    // Parent album of a downloaded song/favorite: keep the DETAIL, drop the row.
    if (protectedDetailAlbumIds.has(id)) {
      removedRows.push(id);
      continue;
    }
    removedDetail.push(id);
    removedRows.push(id);
  }
  const added: string[] = [];
  for (const id of newIds) {
    if (!oldSet.has(id)) added.push(id);
  }

  if (removedDetail.length > 0) {
    // `removeEntries` on the detail store cascades the song-index delete.
    albumDetailStore.getState().removeEntries(removedDetail);
  }
  if (removedRows.length > 0) {
    // Delete the lean list rows — without this, a server-deleted album would
    // resurrect on the next `library_albums` hydrate.
    fireAndForget(deleteLibraryAlbumsAsync(removedRows), 'sync.reconcileRemovals');
  }

  if (added.length > 0 && !offlineModeStore.getState().offlineMode) {
    // Index the added albums' songs (song_index only; album_details stays
    // on-demand). NOT a full walk — the song sync already ran / will run.
    fireAndForget(fetchSongsForAlbums(added), 'sync.reconcileAdded');
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
  // Reset orchestration state so the banner starts clean + re-probe capability.
  syncStatusStore.getState().resetSongSync();
  syncStatusStore.getState().setSyncStrategy(null);
  // Clear all cached data. `albumDetailStore.clearAlbums` cascades to
  // `songIndexStore` via the `clearDetailTables` helper. `albumLibraryStore.
  // clearAlbums` resets the album-list markers (cursor/complete).
  await albumDetailStore.getState().clearAlbums();
  await albumLibraryStore.getState().clearAlbums();

  if (offlineModeStore.getState().offlineMode) {
    // Offline: we've cleared local caches. On reconnect, `onOnlineResume`
    // will refetch. Exit early — no point attempting a network call.
    return;
  }

  // Refetch the album list, then the song list.
  await albumLibraryStore.getState().fetchAllAlbums();
  await syncSongLibrary();
}

/**
 * Resume a paused/incomplete library sync from where it left off (the settings
 * "Resume" button). Continues the album list if it didn't finish, then the song
 * sync — both resume from their persisted cursors, no clear.
 */
export async function resumeSync(): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  if (!syncStatusStore.getState().librarySyncComplete) {
    await albumLibraryStore.getState().fetchAllAlbums();
  }
  await syncSongLibrary();
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
let detectChangesInFlight: Promise<{
  changedAlbumIds: string[];
  newestAlbums: AlbumID3[];
}> | null = null;

export function detectChanges(): Promise<{
  changedAlbumIds: string[];
  newestAlbums: AlbumID3[];
}> {
  if (offlineModeStore.getState().offlineMode) {
    return Promise.resolve({ changedAlbumIds: [], newestAlbums: [] });
  }
  // Coalesce concurrent callers onto a single probe and hand every caller the
  // same real result — the loser previously returned an empty result, masking
  // the changes the winner found.
  if (detectChangesInFlight) return detectChangesInFlight;
  detectChangesInFlight = runDetectChanges().finally(() => {
    detectChangesInFlight = null;
  });
  return detectChangesInFlight;
}

async function runDetectChanges(): Promise<{
  changedAlbumIds: string[];
  newestAlbums: AlbumID3[];
}> {
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
/** Fast-path song page size. Sync time is flat across 2.5k/5k/20k, so the
 *  bottleneck is total-song work (network transfer + JSON parse + insert +
 *  in-memory rebuild), NOT round-trips. 5k keeps the counter ticking a handful
 *  of times without extra round-trips mattering. */
const SEARCH3_SONG_PAGE = 5000;
/** Infinite-loop backstop for the fast song loop. */
const SONG_PAGE_CEILING = 20000;

/**
 * Populate `song_index` (the flat Songs list) — the second sync step after the
 * album list. FAST path: page empty-query `search3` by `songOffset` in 10k
 * chunks → bulk-upsert each page into `song_index` (resumable via the persisted
 * `songSyncCursor`). BASIC path (or if fast-path songs come back without
 * `albumId`): the per-album `getAlbum` walk (`runFullAlbumDetailSync`, which also
 * caches `album_details` and marks `songSyncComplete` on completion).
 * Idempotent via `inFlight('song-sync')`; gated on `songSyncComplete`.
 */
export async function syncSongLibrary(): Promise<void> {
  const existing = syncStatusStore.getState().getInFlight('song-sync');
  if (existing) return existing;
  let settle: () => void;
  const p = new Promise<void>((resolve) => {
    settle = resolve;
  });
  syncStatusStore.getState().setInFlight('song-sync', p);
  try {
    await doSongSync();
  } finally {
    settle!();
    syncStatusStore.getState().clearInFlight('song-sync');
  }
  return p;
}

async function doSongSync(): Promise<void> {
  const status = syncStatusStore.getState();
  if (offlineModeStore.getState().offlineMode) {
    status.setDetailSyncPhase('paused-offline');
    return;
  }
  if (status.songSyncComplete) return;

  const capturedGen = status.generation;
  const genChanged = (): boolean => syncStatusStore.getState().generation !== capturedGen;

  // Strategy follows the album-list probe (persisted). Probe here only if the
  // album list never ran (shouldn't happen — songs sync after the list).
  let strat = syncStatusStore.getState().songSyncStrategy ?? syncStatusStore.getState().syncStrategy;
  if (strat == null) {
    strat = (await probeEmptySearch3()) ? 'search3' : 'basic';
    if (genChanged()) return;
    syncStatusStore.getState().setSyncStrategy(strat);
  }

  if (strat === 'basic') {
    syncStatusStore.getState().setSongSyncStrategy('basic');
    await runFullAlbumDetailSync(); // the walk marks songSyncComplete on completion
    return;
  }

  // --- FAST path: paged search3 songs → bulk-upsert song_index ---
  syncStatusStore.getState().setSongSyncStrategy('search3');
  syncStatusStore.getState().setDetailSyncPhase('syncing');
  syncStatusStore.getState().setDetailSyncTotal(0); // indeterminate (no per-album count)
  let offset = syncStatusStore.getState().songSyncCursor;
  let firstPage = offset === 0;
  let pageCount = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (genChanged()) return;
    if (offlineModeStore.getState().offlineMode) {
      syncStatusStore.getState().setDetailSyncPhase('paused-offline');
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    const page: Child[] = await searchSongsPage(SEARCH3_SONG_PAGE, offset);
    if (page.length === 0) break;
    if (firstPage) {
      firstPage = false;
      // albumId is optional in the spec; song_index keys on it. If the server
      // doesn't populate it, the fast path is unsafe → fall back to the walk.
      const missing = page.filter((s) => !s.albumId).length;
      if (missing / page.length > 0.01) {
        syncStatusStore.getState().setSongSyncStrategy('basic');
        await runFullAlbumDetailSync();
        return;
      }
    }
    if (genChanged()) return;
    // eslint-disable-next-line no-await-in-loop
    await bulkUpsertSongs(page);
    offset += page.length; // advance by the songOffset position (server-returned count)
    syncStatusStore.getState().setSongSyncCursor(offset);
    // Set the count from the actual DB row count — NOT a per-page accumulator,
    // which double-counts when a re-sync upserts songs already in the table.
    // eslint-disable-next-line no-await-in-loop
    await songIndexStore.getState().refreshCountFromDb();
    if ((pageCount += 1) > SONG_PAGE_CEILING) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (genChanged()) return;
  await songLibraryStore.getState().rebuildFromDb();
  syncStatusStore.getState().markSongSyncComplete();
}

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
  // Determine "already detailed" from the SQL id set (disk truth), NOT the
  // in-memory `albumDetailStore.albums` map. On a large library that map may be
  // empty/incomplete when the walk runs (its hydration parses every envelope);
  // reading the lean `SELECT id FROM album_details` set means we skip already-
  // detailed albums correctly and never re-walk all of them each launch.
  const detailedIds = await getDetailedAlbumIdsAsync();
  const missing: string[] = [];
  for (const album of libState.albums) {
    if (!detailedIds.has(album.id)) {
      missing.push(album.id);
    }
  }
  if (missing.length === 0) {
    syncStatusStore.getState().setDetailSyncPhase('idle');
    syncStatusStore.getState().setDetailSyncTotal(0);
    // Every album is detailed → its songs are all in song_index → song sync done.
    syncStatusStore.getState().markSongSyncComplete();
    return;
  }

  // --- start walk ---
  const capturedGen = syncStatusStore.getState().generation;
  syncStatusStore.getState().setDetailSyncPhase('syncing');
  syncStatusStore.getState().setDetailSyncTotal(missing.length);

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
    await runPool(
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
    // Partial failure is acceptable; phase returns to idle either way and
    // the next walk picks up remaining missing IDs via reconciliation.
    syncStatusStore.getState().setDetailSyncPhase('idle');
    syncStatusStore.getState().setDetailSyncTotal(0);
    // Mark the song sync complete only if EVERY album is now detailed (no
    // partial-failure remainder) — else the next walk retries the stragglers.
    const nowDetailed = await getDetailedAlbumIdsAsync();
    if (albumLibraryStore.getState().albums.every((a) => nowDetailed.has(a.id))) {
      syncStatusStore.getState().markSongSyncComplete();
    }
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
  // Resume the song sync (fast path resumes from `songSyncCursor`; the walk
  // fallback resumes from the detailed-ids reconciliation).
  await syncSongLibrary();
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

// NOTE: The runtime offline-mode → sync-phase reaction lived here at module
// scope until Phase 5 of the audit remediation. It now registers inside
// `deferredDataSyncInit` via `ensureOfflineSyncPhaseSubscription()` so test
// imports of this module don't fire the side effect.

/* ------------------------------------------------------------------ */
/*  Internals exposed for tests                                        */
/* ------------------------------------------------------------------ */

export const __internal = { isSubsetOf, performScope };
