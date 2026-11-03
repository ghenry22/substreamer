/**
 * Central data sync orchestration.
 *
 * Entry points fan out to the store methods in the order/concurrency the app
 * uses, and drive the album-detail walk, change detection, and reconciliation.
 *
 * All entry points are idempotent via a `Map<SyncScope, Promise<void>>` kept
 * on `syncStatusStore.inFlight`. Overlapping calls collapse per the scope
 * subset relation (`isSubsetOf`), applied in `dispatch`.
 */
import { albumListsStore } from '../store/albumListsStore';
import { favoritesStore } from '../store/favoritesStore';
import { genreStore } from '../store/genreStore';
import { authStore } from '../store/authStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { getDb } from '../store/persistence/db';
import { albumIdsPresent, countAlbums, listAlbumIds, upsertAlbums } from '../db/repository/albums';
import { deleteAlbumSongsNotIn, hasAlbumWithoutSongs, upsertSongs } from '../db/repository/songs';
import { countArtists } from '../db/repository/artists';
import { connectivityStore } from '../store/connectivityStore';
import { scanStatusStore } from '../store/scanStatusStore';
import { runWhenIdle } from '../utils/runWhenIdle';
import { kvStorage } from '../store/persistence';
import { downloadedMetadataRefreshStore } from '../store/downloadedMetadataRefreshStore';
import { refreshDownloadedMetadata } from './downloadedMetadataService';
import { logLibrarySync } from './librarySyncLogger';
import { probeServerVersion } from './navidromeReid/reidProbe';
import { runNavidromeReidIfNeeded } from './navidromeReid/runNavidromeReid';
import {
  hasServerAnswered,
  isLegacyThisSession,
  reidVerdict,
  shouldBlockLibraryWrites,
} from './navidromeReid/reidMarker';
import { setServerUpHook } from './connectivityService';
import { serverInfoStore } from '../store/serverInfoStore';
import { syncStatusStore, type SyncScope } from '../store/syncStatusStore';
import { fireAndForget } from '../utils/fireAndForget';
import { runPool } from '../utils/promisePool';
import { minDelay } from '../utils/stringHelpers';
import { registerMusicCacheOnAlbumReferencedHook } from './musicCacheService';
import {
  refreshArtistLibrary,
  refreshPlaylistLibrary,
  runNormalizedLibrarySync,
} from './normalizedLibrarySync';
import { fetchScanStatus, registerScanCompletedHook } from './scanService';
import { registerScrobbleBatchCompletedHook } from './scrobbleService';
import { canUserScan } from './serverCapabilityService';
import {
  ensureCoverArtAuth,
  fetchServerInfo,
  getAlbum,
  getRecentlyAddedAlbums,
  type AlbumID3,
} from './subsonicService';

/** Bounded concurrency for the album-detail walk. */
const WALK_CONCURRENCY = 4;
/**
 * Delay after the JS thread reports idle before kicking off deferred startup
 * prefetches (library lists, genres, detail walk). At ~1.5s the first paint has
 * settled, hydration is done, and the initial network/auth handshakes have landed
 * or timed out. Shorter stutters the splash; longer delays the library appearing.
 */
const STARTUP_PREFETCH_SETTLE_MS = 1500;

/**
 * True when there's library work to do — either the album list hasn't been
 * fetched yet, or we have albums without detail cached. Used to decide
 * whether an offline startup should surface the "paused — offline" banner
 * or stay silent.
 */
async function isLibrarySyncPending(): Promise<boolean> {
  const status = syncStatusStore.getState();
  // Pending if the album list or the song index hasn't fully synced. O(1) —
  // no per-album detail scan (album_details is on-demand now).
  if (!status.librarySyncComplete || !status.songSyncComplete) return true;
  const db = getDb();
  if (!db) return false; // can't count; flags say complete
  return (await countAlbums(db)) === 0;
}

export type PullToRefreshScope =
  | 'home'
  | 'albums'
  | 'songs'
  | 'artists'
  | 'playlists'
  | 'favorites'
  | 'genres'
  | 'all';

/**
 * The sync retried a failing request, failed again, and stopped to tell the user why.
 * Every automatic (re)start has to honour that, or the pause is invisible — the sync
 * restarts itself and runs straight back into the request that failed.
 */
function isErrorPaused(s: ReturnType<typeof syncStatusStore.getState>): boolean {
  return s.detailSyncPhase === 'paused-error' || s.librarySyncPhase === 'paused-error';
}

/**
 * Subset relationship for scope composition. `'all'` is the superset of every
 * other scope; all non-'all' pull scopes are leaves (mutually disjoint).
 */
function isSubsetOf(a: SyncScope, b: SyncScope): boolean {
  if (a === b) return true;
  if (b === 'all') return a === 'home' || a === 'albums' || a === 'songs' || a === 'artists'
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
    case 'songs':
      // Pull-to-refresh (albums AND the songs tab — one library). An unfinished list
      // fetch resumes from its cursor. Once the library is fully fetched a full
      // re-download would be wasteful at scale, so run the cheap incremental
      // change-detection (newest-album probe) instead, which ingests server-added
      // albums and their songs. Server-side removals and bulk metadata rewrites are
      // only picked up by the explicit Settings → Sync Library force-resync.
      if (!syncStatusStore.getState().librarySyncComplete) {
        await runNormalizedLibrarySync({ reason: 'pull-to-refresh' });
      } else {
        await onScanCompleted();
      }
      return;
    case 'artists':
      await refreshArtistLibrary();
      return;
    case 'playlists':
      await refreshPlaylistLibrary();
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
    // Surface "paused — offline" so the user can tell a stale library from a
    // synced one rather than reading a silent banner as "up to date".
    if (await isLibrarySyncPending()) {
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
 * Same as {@link onOnlineResume} but rate-limited, for the connectivity subscriber.
 *
 * A flaky link flips reachable every ~10-15s and would otherwise re-run the whole
 * fan-out each time. A deliberate user action (the offline-mode toggle) keeps the
 * unthrottled path — they asked for it, once.
 */
export async function onConnectivityRestored(): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  await startupOrResumeFlow(true);
}

/**
 * Guards for {@link startupOrResumeFlow}.
 *
 * It has three callers now — startup, the offline-mode toggle, and the connectivity
 * subscriber — and the fan-out it kicks is not cheap or self-limiting:
 * `refreshAllIfDue(0)` can never be time-gated at zero, and `refreshAll` has no
 * in-flight guard of its own. A flaky link flips reachable roughly every 10-15s
 * (two consecutive ping failures at the unreachable interval), which without this
 * re-runs `fetchServerInfo` + scan status + four album-list fetches + a full upsert +
 * cover prefetch + starred, plus the idle artist/playlist/genre fan-out, each time.
 */
let resumeInFlight: Promise<void> | null = null;
let lastResumeAt = 0;
const RESUME_MIN_INTERVAL_MS = 30_000;

/**
 * A ping succeeded. If both of this session's server checks timed out (a VPN still
 * connecting, a container restarting), library writes are still blocked and nothing else
 * would ask again until the server first drops and comes back. Run the resume flow, which
 * checks again. Does nothing once the server has answered, and nothing for any install
 * whose writes are not blocked.
 */
function onServerUp(): void {
  if (!authStore.getState().isLoggedIn) return;
  if (offlineModeStore.getState().offlineMode) return;
  if (hasServerAnswered() || !shouldBlockLibraryWrites()) return;
  void onOnlineResume();
}

async function startupOrResumeFlow(throttled = false): Promise<void> {
  // Idempotent. Here so a launch in offline mode, which never calls `onStartup`, has it too.
  setServerUpHook(onServerUp);
  // De-duplication always: two callers racing must not run the fan-out twice.
  if (resumeInFlight) return resumeInFlight;
  // Throttling only for the caller that can repeat on its own. Startup and the
  // post-re-key re-entry MUST never be throttled — the sync that refills the library
  // runs about two seconds after the one the gate refused, so a blanket interval would
  // silently swallow it and leave the user with an empty library.
  if (throttled && Date.now() - lastResumeAt < RESUME_MIN_INTERVAL_MS) return;
  lastResumeAt = Date.now();
  resumeInFlight = resumeFlowBody().finally(() => { resumeInFlight = null; });
  return resumeInFlight;
}

async function resumeFlowBody(): Promise<void> {
  // Settle the Navidrome re-key question BEFORE anything fetches. The probe is a no-op
  // once the server has answered this session; it does real work when the launch could
  // not reach the server and this flow runs again once it can. Awaiting rather than
  // early-returning on a blocked verdict matters: a bare `return` while the answer was
  // still pending would cost the session its sync.
  await (probeServerVersion() ?? Promise.resolve());
  // An undetermined server version shows its prompt here as well as at the splash, so a
  // login or a launch that could not reach the server still gets it.
  const askPending = reidVerdict() === 'ask' && !isLegacyThisSession();
  if (shouldBlockLibraryWrites() || askPending) {
    // The ids this fan-out would write do not match the ones the rest of the install
    // holds. Writing both is what doubles the library. Run the pass (or show the prompt)
    // instead: the gate renders over the live app, and startup resumes when it finishes.
    logLibrarySync('[reid] startup fan-out held — re-key outstanding or version undetermined');
    void runNavidromeReidIfNeeded();
    return;
  }

  // Not awaited, and with no network timeout it can land after a logout, or after the
  // next login as someone else. Keep it only for the session that asked.
  const askedFor = authStore.getState();
  fetchServerInfo().then((info) => {
    const now = authStore.getState();
    if (!info || !now.isLoggedIn) return;
    if (now.serverUrl !== askedFor.serverUrl || now.username !== askedFor.username) return;
    serverInfoStore.getState().setServerInfo(info);
  });
  fetchScanStatus();
  // Eager home-list refresh, gated on offline/reachability via refreshAllIfDue(0)
  // so a doomed fetch never fires against an unreachable server. This is the only
  // cold-start home refresh.
  albumListsStore.getState().refreshAllIfDue(0);
  // Startup sync — metadata only, art pre-caches on user-initiated views.
  favoritesStore.getState().fetchStarred({ prefetchCovers: false });

  // Deferred library prefetches. requestIdleCallback waits for the JS
  // thread to settle; the STARTUP_PREFETCH_SETTLE_MS delay then keeps
  // network fan-out off the splash → first-paint critical path.
  runWhenIdle(() => {
    setTimeout(async () => {
      // A Pause (or logout) during the startup sync bumps this; nothing below may then
      // start a fresh run and undo it.
      const startGen = syncStatusStore.getState().generation;
      // Full album-LIST fetch only when it isn't already complete on disk. A
      // completed library with rows present skips straight to change-detection;
      // an interrupted/partial fetch (librarySyncComplete=false) resumes the
      // pager from COUNT(*). Reads SQL COUNT (disk truth), not the in-memory
      // array, so hydration timing can't trigger a spurious full re-fetch.
      const gateDb = getDb();
      const rowCount = gateDb ? await countAlbums(gateDb) : 0;
      const sync = syncStatusStore.getState();
      // The local migration alone is enough ONLY when the previous sync ran to completion
      // AND every album has its songs. Anything else means gaps, so back it with an online
      // sync — async, never blocking the splash, filling in behind the user as they browse.
      // Ordered cheapest-first: the `NOT EXISTS` probe only runs once the flags and count pass.
      // `songGapRepairAttempted` short-circuits it once the sync's per-album repair has
      // asked the server about those albums and been told there is nothing — otherwise the
      // empty albums fire a sync on every launch and every online-resume, forever.
      // An error pause is a deliberate stop, and it always leaves the sync incomplete —
      // so every condition below is true and this gate would restart it on the spot,
      // straight back into the request that failed. Resume/Restart are the way out.
      const needsLibraryFetch =
        !isErrorPaused(sync) &&
        (!sync.librarySyncComplete ||
          !sync.songSyncComplete ||
          rowCount === 0 ||
          (!sync.songGapRepairAttempted && gateDb ? await hasAlbumWithoutSongs(gateDb) : false));
      const libPromise = needsLibraryFetch
        ? runNormalizedLibrarySync({ reason: 'startup:needsLibraryFetch' })
        : Promise.resolve();

      const startupDb = getDb();
      const artistCount = startupDb ? await countArtists(startupDb) : 0;
      if (artistCount === 0) {
        refreshArtistLibrary();
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
          refreshPlaylistLibrary();
        }
      }
      genreStore.getState().fetchGenres();

      // One-time repair: re-cache detail + cover art for downloaded items missing it.
      // Flagged by a one-shot migration; runs once the server is genuinely reachable.
      //
      // RESUME, don't restart: `missing` mode only fetches detail that is still
      // absent, so an interrupted run's completed work is never redone and the flag
      // clears to 'done' only when nothing is left missing. A pass that makes NO
      // progress counts toward a cap, so permanently-unfetchable items (deleted
      // albums, chronic errors) can't loop forever — on-demand browse and the manual
      // "Refresh downloads" button still cover the rest.
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
      if (syncStatusStore.getState().generation !== startGen) return;
      if (!offlineModeStore.getState().offlineMode) {
        // Detect changes since last session (scan status or newest-album probe) and
        // surface any new albums + their songs. Detect errors are swallowed — fire
        // the song sync either way.
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
        // Populate the flat Songs list unless already done. The normalized sync runs
        // the album phase then the song phase (search3 pages, or the per-album walk on
        // a basic server), both resuming from their cursors. Progress shows on the
        // banner. `libPromise` above already covers the incomplete-album-list case, and
        // the in-flight guard collapses the two into one run.
        if (!syncStatusStore.getState().songSyncComplete && !isErrorPaused(syncStatusStore.getState())) {
          fireAndForget(runNormalizedLibrarySync({ reason: 'startup:songSyncIncomplete' }), 'sync.songSync');
        }
      }
    }, STARTUP_PREFETCH_SETTLE_MS);
  });
}

let _offlineSyncPhaseUnsub: (() => void) | null = null;

/**
 * Wire the runtime offline-mode → sync-phase reaction. Idempotent, and deliberately
 * NOT at module scope: a module-scope subscribe fires on every test import of
 * `dataSyncService` and bleeds across test files. Called once per session from
 * `deferredDataSyncInit`; the module-state unsub re-registers it on logout → login.
 */
function ensureOfflineSyncPhaseSubscription(): void {
  if (_offlineSyncPhaseUnsub) return;
  _offlineSyncPhaseUnsub = offlineModeStore.subscribe((state, prev) => {
    if (state.offlineMode === prev.offlineMode) return;
    const phase = syncStatusStore.getState().detailSyncPhase;
    if (state.offlineMode) {
      if (phase === 'idle') {
        fireAndForget(
          (async () => {
            if (await isLibrarySyncPending()) {
              syncStatusStore.getState().setDetailSyncPhase('paused-offline');
            }
          })(),
          'sync.offlineToggle.pending',
        );
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
  const db = getDb();
  const knownIds = new Set(db ? await listAlbumIds(db) : []);
  const newAlbums: AlbumID3[] = [];
  for (const album of newestAlbums) {
    if (changedAlbumIds.includes(album.id) && !knownIds.has(album.id)) {
      newAlbums.push(album);
    }
  }
  if (newAlbums.length > 0) {
    const articles = serverInfoStore.getState().ignoredArticles ?? undefined;
    if (db) await upsertAlbums(db, newAlbums, undefined, articles);
  }
  // Pull the changed albums' SONGS in. Keeps the flat Songs list current without a
  // full re-sync.
  await fetchSongsForAlbums(changedAlbumIds);
  // Real data changed (we returned early above when changedAlbumIds was empty).
  syncStatusStore.getState().bumpLibraryUpdated();
}

/**
 * Fetch the given albums' track lists via `getAlbum` and write them into the
 * normalized `songs` table. Used by the incremental change paths (scan-completed,
 * reconcile-added, album-referenced) so newly-surfaced albums' songs land in the flat
 * Songs list without a full re-sync.
 *
 * Bounded concurrency: the reconcile-added caller passes an unbounded set (every album
 * added since the last sync), so an unpooled `Promise.all` would open one request per
 * album at once.
 */
async function fetchSongsForAlbums(ids: readonly string[]): Promise<void> {
  if (ids.length === 0 || offlineModeStore.getState().offlineMode) return;
  const db = getDb();
  if (!db) return;
  const articles = serverInfoStore.getState().ignoredArticles ?? undefined;
  await runPool(
    [...ids],
    async (id) => {
      const album = await getAlbum(id);
      if (album?.song && album.song.length > 0) {
        await upsertSongs(db, album.song, undefined, articles);
        // Drop tracks the server no longer lists for this album (re-tag re-keys ids).
        // A response short of its own `songCount` is truncated, not shrunk — skip.
        await deleteAlbumSongsNotIn(db, id, album.song.map((sg) => sg.id), album.songCount);
      }
    },
    { concurrency: WALK_CONCURRENCY },
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
 * surfaced via `recentlyAdded`).
 *
 * Semantics:
 *   - If the id is already in the library: no-op.
 *   - If the library is cold (zero albums cached): no-op — the startup
 *     path already handles first-fetch via its `length === 0` guard.
 *   - Otherwise: fetch ONLY that album and merge it in. A targeted single-album
 *     upsert, never a full-library re-download (prohibitive at scale).
 */
export async function onAlbumReferenced(albumId: string): Promise<void> {
  if (offlineModeStore.getState().offlineMode) return;
  const db = getDb();
  if (!db) return;
  if ((await countAlbums(db)) === 0) return; // library not synced yet
  if ((await albumIdsPresent(db, [albumId])).size > 0) return; // already known
  try {
    await ensureCoverArtAuth();
    const album = await getAlbum(albumId);
    if (album) {
      // Drop `song` — the album row is a song-less AlbumID3.
      const { song, ...albumMeta } = album;
      const articles = serverInfoStore.getState().ignoredArticles ?? undefined;
      await upsertAlbums(db, [albumMeta], undefined, articles);
      // Also index this album's songs — otherwise an album first seen via a download /
      // recentlyAdded surface never lands in the flat Songs list.
      if (song && song.length > 0) {
        await upsertSongs(db, song, undefined, articles);
        await deleteAlbumSongsNotIn(db, albumId, song.map((sg) => sg.id), album.songCount);
      }
      // A new album was ingested into the library → mark the data as updated.
      syncStatusStore.getState().bumpLibraryUpdated();
    }
  } catch {
    /* best-effort: a missed reference resolves on the next full sync */
  }
}



/**
 * User-triggered full resync from settings — the "something is wrong, start over" hatch.
 *
 * NON-DESTRUCTIVE: it bumps the generation to cancel any in-flight run, then restarts
 * from cursor zero and re-upserts every row in place. It does NOT drop tables, so
 * playlist membership, artist bios and downloaded metadata — none of which the sync can
 * rebuild — survive. Rows the server no longer returns are pruned per-entity for artists
 * and playlists; albums and songs wait for the epoch reap.
 */
export async function forceFullResync(): Promise<void> {
  syncStatusStore.getState().setLastSyncError(null);
  cancelAllSyncs('force-resync');
  // Clear the persisted transport so the run re-probes search3 vs basic — a server
  // upgrade is one of the things "start over" is meant to recover from.
  syncStatusStore.getState().setSyncStrategy(null);
  if (offlineModeStore.getState().offlineMode) return;
  await runNormalizedLibrarySync({ full: true, reason: 'forceFullResync' });
}

/**
 * Resume a paused/incomplete library sync from where it left off (the settings
 * "Resume" button). Continues the album list if it didn't finish, then the song
 * sync — both resume from their persisted cursors, no clear.
 */
export async function resumeSync(): Promise<void> {
  syncStatusStore.getState().setLastSyncError(null);
  if (offlineModeStore.getState().offlineMode) return;
  // One call resumes BOTH phases from their persisted cursors — the normalized sync
  // runs the album list then the song phase itself, so there is no separate song step.
  await runNormalizedLibrarySync({ reason: 'resume-button' });
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
 * Returns only the ids of albums that appear to be new since the last observation;
 * the caller upserts them and fetches their songs.
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
  // Coalesce concurrent callers onto a single probe and hand every one the SAME
  // result. A loser that returned empty would mask the changes the winner found.
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
        const detectDb = getDb();
        const libraryIds = new Set(detectDb ? await listAlbumIds(detectDb) : []);
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
 * Re-enter a library sync that a previous session left mid-flight, resuming from its
 * persisted cursors. No persisted queue: the sync recomputes what is missing at start,
 * so a kill mid-walk costs nothing but the current page.
 *
 * Honors `offlineModeStore.offlineMode` (bails early); the sync's own in-flight guard
 * collapses overlapping calls.
 */
export async function recoverStalledSync(): Promise<void> {
  const status = syncStatusStore.getState();
  const phase = status.detailSyncPhase;
  // Checked before `albumPhaseStalled` below, which an error-paused album phase also
  // satisfies — the pause has to survive a foreground, not be healed away by one.
  if (isErrorPaused(status)) return;
  const resumablePhases: Array<typeof phase> = [
    'syncing',
    'paused-offline',
    'paused-auth-error',
    'paused-metered',
    'error',
  ];
  // An interrupted ALBUM phase leaves `detailSyncPhase` at 'idle' — only
  // `librarySyncPhase` moves — so the album phase must be checked separately or a sync
  // killed during it never self-heals on foreground, only on a cold boot.
  const albumPhaseStalled = !status.librarySyncComplete && status.librarySyncPhase !== 'idle';
  if (!resumablePhases.includes(phase) && !albumPhaseStalled) return;
  if (offlineModeStore.getState().offlineMode) {
    // Still offline — flip to the correct paused phase and stop.
    syncStatusStore.getState().setDetailSyncPhase('paused-offline');
    return;
  }
  // Resumes both phases from their persisted cursors.
  await runNormalizedLibrarySync({ reason: 'app-foreground-resume' });
}

/**
 * Abort every running walk/worker by bumping the generation counter. In-flight
 * workers capture a generation on entry and bail on mismatch (same pattern as
 * `musicCacheService.processingId`).
 */
export function cancelAllSyncs(reason: 'force-resync' | 'user-cancel'): void {
  syncStatusStore.getState().bumpGeneration();
  // Flip phase back to idle so the pill banner doesn't stay stuck showing
  // "syncing N / total" after a user-initiated cancel — the walk's generation
  // guard will exit the pool but does NOT set phase on the cancel path.
  // Reconciliation-based recovery will still pick up missing IDs on the next
  // trigger (app foreground, pull-to-refresh, scan).
  if (reason === 'user-cancel') {
    syncStatusStore.getState().resetDetailSync();
    // The ALBUM loop exits on the generation guard without setting a phase, so
    // without this the card keeps spinning on "Fetching album list…", `isSyncing`
    // stays true, and the Pause button never becomes Resume — leaving the user no
    // way to restart the run they just paused.
    syncStatusStore.getState().setLibrarySyncPhase('idle');
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
registerMusicCacheOnAlbumReferencedHook((albumId) => {
  fireAndForget(onAlbumReferenced(albumId), 'sync.hook.onAlbumReferenced');
});

// When `recentlyAdded` surfaces an id the library doesn't have, route it through
// `onAlbumReferenced`. Lives here rather than as a store-to-store subscribe, which
// would be an import cycle.
async function referenceFirstNewRecentlyAdded(recentlyAdded: readonly AlbumID3[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  const ids = recentlyAdded.map((a) => a.id);
  if (ids.length === 0) return;
  if ((await countAlbums(db)) === 0) return; // library not synced yet
  // Bounded: check only the (few) recently-added ids against the normalized table.
  const known = await albumIdsPresent(db, ids);
  for (const album of recentlyAdded) {
    if (!known.has(album.id)) {
      await onAlbumReferenced(album.id);
      return; // one fetch covers all new ids via reconciliation
    }
  }
}

albumListsStore.subscribe((state, prev) => {
  if (state.recentlyAdded === prev.recentlyAdded) return;
  fireAndForget(referenceFirstNewRecentlyAdded(state.recentlyAdded), 'sync.recentlyAddedReferenced');
});


/* ------------------------------------------------------------------ */
/*  Internals exposed for tests                                        */
/* ------------------------------------------------------------------ */

export const __internal = { isSubsetOf, performScope };
