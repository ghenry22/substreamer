/**
 * Remote library sync — writes ONLY the normalized model (`albums` and `songs` +
 * children, via the repository). Single writer, bounded memory: page → upsert →
 * free. NO blob tables (`library_albums`/`song_index`), NO in-memory whole-library
 * arrays, NO reconcile fan-out.
 *
 * Progress is derived from the RESUME CURSOR, not from counting rows: the search3 phase
 * maps `songSyncCursor` onto the album list via the server's total track count, and the
 * basic walk counts albums it has actually fetched. Counting rows would read as 100% for
 * the whole phase, since a full resync overwrites the tables in place rather than
 * emptying them first. Resumes from `librarySyncCursor` / `songSyncCursor`.
 *
 * Handles both transports: paged `search3` where songs carry `albumId`, and the
 * per-album `getAlbum` walk for basic servers (and for search3 servers whose songs
 * come back without `albumId`).
 */
import type { AlbumID3, Child, Playlist } from 'subsonic-api';

import type { InternalDb } from '@/db/client';
import { resetNormalizedSchema } from '@/db/createNormalizedTables';
import { albumIdsPresent, countAlbums, listAlbumIds, sumAlbumSongCounts, upsertAlbums } from '@/db/repository/albums';
import { deleteArtistsNotIn, upsertArtists } from '@/db/repository/artists';
import {
  clearPlaylistDetailMarkers,
  deletePlaylistsNotIn,
  listPlaylistDetailState,
  stampPlaylistDetailSynced,
  upsertPlaylists,
  type PlaylistDetailStateRow,
} from '@/db/repository/playlists';
import { getProtectedPlaylistIds } from '@/db/protectedIds';
import {
  countSongs,
  deleteAlbumSongsNotIn,
  hasAlbumWithoutSongs,
  listSongAlbumIds,
  upsertSongs,
} from '@/db/repository/songs';
import { getDb } from '@/store/persistence/db';
import { offlineModeStore } from '@/store/offlineModeStore';
import { ratingStore } from '@/store/ratingStore';
import { serverInfoStore } from '@/store/serverInfoStore';
import { shouldBlockLibraryWrites } from './navidromeReid/reidMarker';
import { syncStatusStore, type SyncStrategy } from '@/store/syncStatusStore';
import {
  flushLibrarySyncLog,
  logLibrarySync,
  readLibrarySyncLogFlag,
} from './librarySyncLogger';
import { runPool } from '@/utils/promisePool';
import { withTimeout } from '@/utils/withTimeout';
import { fireAndForget } from '@/utils/fireAndForget';
import { toEpoch } from '@/db/repository/mappers';
import { fetchPlaylistDetail } from './detailFetchService';
import { syncCachedItemTracks } from './musicCacheService';

import {
  ensureCoverArtAuth,
  getAlbumResult,
  getAlbumsPageByName,
  getAllArtists,
  getAllPlaylists,
  getApi,
  probeEmptySearch3,
  searchAlbumsPage,
  searchSongsPage,
} from './subsonicService';

// Page sizes. `search3` counts are uncapped on every server read; `getAlbumList2` has a
// documented spec maximum of 500 which we honour everywhere. See SERVERS.md.
//
// `let` rather than `const` solely so tests can shrink them: paging behaviour is defined
// by "a page shorter than requested is the last one", which a fixture cannot express
// without either 1000-row fixtures or an adjustable page size.
let ALBUM_PAGE = 1000;
let SONG_PAGE = 1000;
let BASIC_PAGE = 500;

/** Test-only: shrink the page sizes so a small fixture can produce a FULL page and
 *  therefore a real multi-page enumeration. Pass no argument to restore. */
export function __setPageSizesForTest(sizes?: { album?: number; song?: number; basic?: number }): void {
  ALBUM_PAGE = sizes?.album ?? 1000;
  SONG_PAGE = sizes?.song ?? 1000;
  BASIC_PAGE = sizes?.basic ?? 500;
}
/** Update the progress bar every N song pages — the bar doesn't need per-page precision. */
const PROGRESS_EVERY = 5;
/** Concurrent per-album `getAlbum` fetches during the basic-server song walk. */
const WALK_CONCURRENCY = 4;
/** How many times an empty page must REPEAT before it counts as the end of the library.
 *  A 200 with no `albumList2`/`searchResult3` (mid-rescan, proxied, rate limited) is
 *  indistinguishable from exhaustion, and believing one ends the walk over a partial
 *  library. Real transport/Subsonic failures throw instead, and never get here. */
const EMPTY_PAGE_RETRIES = 3;
/** Backoff base between corroboration attempts (200ms, 400ms, 800ms). Short on purpose:
 *  each attempt also costs a round trip, and an exhausted library pays the whole ladder
 *  once per paged phase. */
const EMPTY_PAGE_RETRY_MS = 200;

/**
 * Consecutive-empty-page counter + backoff for one paged walk, shared by the album and
 * the song phase. `shouldRetry` answers "this empty page is still unproven, ask again"
 * and waits out the backoff before saying so; `reset` is called on any page with rows.
 *
 * It deliberately does NOT own the exit: the song loop returns 'done'/'bailed' where the
 * album loop returns or breaks, and a common return type would fit neither.
 */
function createEmptyPageCorroborator(): {
  shouldRetry: () => Promise<boolean>;
  reset: () => void;
} {
  let empties = 0;
  return {
    async shouldRetry(): Promise<boolean> {
      empties += 1;
      if (empties > EMPTY_PAGE_RETRIES) return false;
      await new Promise<void>((r) => setTimeout(r, EMPTY_PAGE_RETRY_MS * 2 ** (empties - 1)));
      return true;
    },
    reset(): void {
      empties = 0;
    },
  };
}

const nowMs = (): number => {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return p && typeof p.now === 'function' ? p.now() : Date.now();
};

let inFlight: Promise<void> | null = null;
/** Generation + fullness of the in-flight run, so a later caller can tell whether
 *  joining it would actually satisfy the request. See `runNormalizedLibrarySync`. */
let inFlightGen = -1;
let inFlightFull = false;

/**
 * Basic (non-search3) servers: songs don't carry `albumId`, so the paged fast path can't
 * key them. Walk each album we don't yet have songs for (`listAlbumIds − listSongAlbumIds
 * − notFoundAlbumIds`) and upsert its `getAlbum` song list. Resumable (skips
 * already-populated albums) and bails on a generation bump, an offline flip or a failed
 * fetch; progress is albums-with-songs / total-albums.
 */
async function doBasicSongWalk(
  db: InternalDb,
  articles: readonly string[] | undefined,
  capturedGen: number,
  /** Repair pass: fetch ONLY the albums that have no songs, whatever `fullWalkPending`
   *  says. The gap repair runs before `markSongSyncComplete` clears that flag, and it
   *  must never turn a handful of holes into a whole-library re-fetch. */
  onlyMissing = false,
): Promise<'done' | 'bailed'> {
  const genChanged = (): boolean => syncStatusStore.getState().generation !== capturedGen;
  const isOffline = (): boolean => offlineModeStore.getState().offlineMode;
  // Seeded from the store so a resumed walk keeps counting up rather than restarting.
  let walkSongsFetched = syncStatusStore.getState().songSyncFetched;

  const allIds = await listAlbumIds(db);
  // A full resync must re-fetch EVERY album's songs. A full resync does not drop the
  // tables, so the incremental walk's skip-albums-that-have-songs rule would make it an
  // instant no-op and silently mark the sync complete.
  const fullWalk = !onlyMissing && syncStatusStore.getState().fullWalkPending;
  const have = fullWalk ? new Set<string>() : new Set(await listSongAlbumIds(db));
  // Albums the server has already said are gone. They hold no songs, so every walk
  // would otherwise pick them straight back up and re-ask for the same 70.
  const knownGone = new Set(syncStatusStore.getState().notFoundAlbumIds);
  const missing = allIds.filter((id) => !have.has(id) && !knownGone.has(id));
  syncStatusStore.getState().setDetailSyncTotal(allIds.length);
  let done = allIds.length - missing.length;
  syncStatusStore.getState().setDetailSyncCompleted(done);
  if (missing.length === 0) return 'done';

  // Abort the pool on a generation bump (cancel/force-resync/logout) or an offline flip.
  const ctrl = new AbortController();
  const unsubGen = syncStatusStore.subscribe((s) => {
    if (s.generation !== capturedGen) ctrl.abort();
  });
  const unsubOffline = offlineModeStore.subscribe((s) => {
    if (s.offlineMode) ctrl.abort();
  });
  let result;
  try {
    result = await runPool(
      missing,
      async (id) => {
        if (genChanged() || isOffline()) throw new Error('walk-bail');
        const result = await getAlbumResult(id);
        // A logout or Pause during the fetch: nothing from it may be written.
        if (genChanged()) throw new Error('walk-bail');
        // The server's own verdict that this album is gone: skip it and let the walk
        // reach completion. A single deleted album bailing the run is unrecoverable:
        // `fullWalkPending` clears only on completion, so every later sync re-walks
        // the entire library and bails on the same album.
        if (result.status === 'not-found') return 'not-found' as const;
        // Everything else — a transport failure, any other Subsonic error code — throws
        // so it lands in runPool's `rejected`. Otherwise a flaky connection (or an
        // expired token) silently leaves albums track-less and still reports success.
        if (result.status !== 'ok') throw new Error('walk-fetch-failed');
        const album = result.album;
        // An album the server returned no songs for is NOT walked: counting it would
        // drive the progress bar to 100% and read as a completed walk over a library
        // that still has album-shaped holes in it.
        if (!album.song || album.song.length === 0) return undefined;
        await upsertSongs(db, album.song, undefined, articles);
        if (genChanged()) throw new Error('walk-bail');
        // The walk has no song offset of its own, so accumulate what it wrote —
        // the card's Songs row is this sync's progress, not the local total.
        walkSongsFetched += album.song.length;
        syncStatusStore.getState().setSongSyncFetched(walkSongsFetched);
        await deleteAlbumSongsNotIn(db, id, album.song.map((s) => s.id), album.songCount);
        done += 1;
        if (done % PROGRESS_EVERY === 0) syncStatusStore.getState().setDetailSyncCompleted(done);
        return undefined;
      },
      { concurrency: WALK_CONCURRENCY, signal: ctrl.signal },
    );
  } finally {
    unsubGen();
    unsubOffline();
  }

  // After a logout the verdicts belong to the previous server, and the store is persisted.
  if (genChanged()) return 'bailed';
  syncStatusStore.getState().setDetailSyncCompleted(done);
  // Persist the server's not-found verdicts even on a bail — they are facts about the
  // server, independent of why the rest of the walk stopped.
  syncStatusStore.getState().recordNotFoundAlbums(
    result.fulfilled.filter((f) => f.value === 'not-found').map((f) => f.item),
  );
  // A partial walk must NOT read as success: it would clear `fullWalkPending` and mark
  // the song sync complete with albums still missing their tracks.
  if (result.aborted || result.rejected.length > 0) return 'bailed';
  return 'done';
}

/**
 * search3 (fast-path) song phase: page empty-query songs and bulk-upsert them. Keeps the
 * safety fallback — if the first page's songs lack `albumId` (a server that pages albums
 * via search3 but not songs), switch to the per-album walk. Returns 'bailed' on a
 * generation bump / offline flip (resumable), else 'done'.
 */
async function runSearch3SongPhase(
  db: InternalDb,
  articles: readonly string[] | undefined,
  capturedGen: number,
): Promise<'done' | 'bailed'> {
  const genChanged = (): boolean => syncStatusStore.getState().generation !== capturedGen;
  const isOffline = (): boolean => offlineModeStore.getState().offlineMode;
  // Progress = "which album we're up to" / total albums, derived from the resume cursor.
  // NOT `COUNT(DISTINCT album_id) FROM songs`: a full resync no longer empties the table,
  // so that counts rows this run hasn't rewritten and pins the bar at 100% for the whole
  // phase. The cursor is monotonic, resume-stable, and costs no per-page scan.
  const totalAlbumsForProgress = await countAlbums(db);
  const totalSongsForProgress = await sumAlbumSongCounts(db);
  const albumsUpTo = (songsFetched: number): number =>
    totalSongsForProgress > 0
      ? Math.min(
          totalAlbumsForProgress,
          Math.round((songsFetched / totalSongsForProgress) * totalAlbumsForProgress),
        )
      : 0;
  let songOffset = syncStatusStore.getState().songSyncCursor;
  syncStatusStore.getState().setDetailSyncCompleted(albumsUpTo(songOffset));
  // The first page THIS RUN fetches, not offset 0: a resumed walk gets its `albumId`
  // sanity check too. A server that stops populating `albumId` part-way writes rows with
  // `album_id` NULL — the album reads empty while `countSongs` stays right, so nothing
  // downstream can see the damage.
  let firstPage = true;
  let songPage = 0;
  // Guards the same server behaviour the album loop guards. `null` is what protects
  // the first page of a run — `songOffset` is seeded from the persisted cursor and is
  // non-zero on a resume.
  let prevFirstSongId: string | null = null;
  const corroborate = createEmptyPageCorroborator();
  for (;;) {
    if (genChanged()) return 'bailed';
    if (isOffline()) {
      syncStatusStore.getState().setDetailSyncPhase('paused-offline');
      return 'bailed';
    }
    const tSongPage = nowMs();
    // eslint-disable-next-line no-await-in-loop
    const fetched = await fetchPageWithRetry(
      () => searchSongsPage(SONG_PAGE, songOffset),
      `song page offset=${songOffset}`,
    );
    // Before the error branch too: a fetch that failed during a logout must not persist
    // `paused-error` into the next session.
    if (genChanged()) return 'bailed';
    if (!fetched.ok) {
      pauseForError(fetched.error, 'song');
      return 'bailed';
    }
    const page: Child[] = fetched.page;

    // An empty page means "end of library" ONLY if we actually had an API to ask. With
    // no usable API (mid-logout, pre-auth-restore) the page fns resolve [] without
    // throwing, and treating that as the end marks a truncated library complete.
    if (page.length === 0) {
      if (getApi() === null) return 'bailed';
      // One empty page is not proof. Ask again, with backoff, and only believe the end of
      // the library when the answer repeats: believing a single hiccup costs the user
      // every song after this offset, permanently, under a `complete` flag.
      // eslint-disable-next-line no-await-in-loop
      if (await corroborate.shouldRetry()) {
        // The retry re-requests the SAME offset — clear the tracker so the duplicate
        // check below cannot misread the repeat as the end.
        prevFirstSongId = null;
        continue;
      }
      return 'done';
    }
    corroborate.reset();
    // Duplicate page. Unlike the album loop this delegates rather than ending: the
    // per-album walk is a genuinely different mechanism that recovers the full song
    // set, so ending here would truncate. UNVERIFIED against any real implementation —
    // the empty and short checks fire first on every server in reference/.
    if (page[0]?.id != null && page[0].id === prevFirstSongId) {
      syncStatusStore.getState().setSongSyncStrategy('basic');
      logLibrarySync(
        `song repeated first id=${page[0].id} offset=${songOffset} — per-album walk`,
      );
      // eslint-disable-next-line no-await-in-loop
      const walk = await doBasicSongWalk(db, articles, capturedGen);
      return walk === 'done' && !genChanged() && !isOffline() ? 'done' : 'bailed';
    }
    prevFirstSongId = page[0]?.id ?? null;
    if (firstPage) {
      firstPage = false;
      const missing = page.filter((s) => !s.albumId).length;
      if (missing / page.length > 0.01) {
        // Songs lack albumId — fall back to the per-album walk, and record it on the sync
        // card: this branch turns a ~40-request paged sync into thousands of per-album
        // fetches, which would otherwise read as unexplained slowness.
        syncStatusStore.getState().setSongSyncStrategy('basic');
        logLibrarySync(
          `song missing albumId (${missing}/${page.length}) — per-album walk`,
        );
        // eslint-disable-next-line no-console
        console.warn(
          `[normalized-sync] search3 songs missing albumId (${missing}/${page.length}) — falling back to the per-album walk`,
        );
        // eslint-disable-next-line no-await-in-loop
        const walk = await doBasicSongWalk(db, articles, capturedGen);
        return walk === 'done' && !genChanged() && !isOffline() ? 'done' : 'bailed';
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await upsertSongs(db, page, undefined, articles);
    if (genChanged()) return 'bailed';
    const songPageStart = songOffset;
    // Advance by what we asked for — see the album loop.
    songOffset += SONG_PAGE;
    syncStatusStore.getState().setSongSyncCursor(songOffset);
    syncStatusStore.getState().setSongSyncFetched(songOffset);
    if (songPage % PROGRESS_EVERY === 0) {
      logLibrarySync(
        `song page offset=${songPageStart} got=${page.length} `
          + `ms=${Math.round(nowMs() - tSongPage)}`,
      );
    }
    // Short page = end of results, after the upsert and the advance. Correct the
    // counters to the true total on the way out.
    if (page.length < SONG_PAGE) {
      syncStatusStore.getState().setSongSyncCursor(songPageStart + page.length);
      syncStatusStore.getState().setSongSyncFetched(songPageStart + page.length);
      return 'done';
    }
    if (songPage % PROGRESS_EVERY === 0) {
      syncStatusStore.getState().setDetailSyncCompleted(albumsUpTo(songOffset));
    }
    songPage += 1;
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** Initial sync of the (lightweight) artists list into the normalized `artists` table —
 *  tacked onto the library sync so the user's first Artists tab open is instant. */
export async function syncArtistsNormalized(
  db: InternalDb,
  articles: readonly string[] | undefined,
): Promise<void> {
  await ensureCoverArtAuth();
  const artists = await getAllArtists();
  ratingStore.getState().reconcileRatings(
    artists.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 })),
  );
  await upsertArtists(db, artists, undefined, articles);
  // Prune only when the API actually answered — same shape as the playlist prune.
  // Nothing else ever removes an artist row, so a server-side rename (ids are name
  // hashes on some servers) would otherwise leave the old artist in the list forever.
  if (getApi() === null) return;
  await deleteArtistsNotIn(db, artists.map((a) => a.id));
  syncStatusStore.getState().bumpLibraryUpdated();
}

/** Initial sync of the (lightweight) playlists list into the normalized `playlists`
 *  table, pruning server-removed playlists. Track membership stays on-demand. */
export async function syncPlaylistsNormalized(
  db: InternalDb,
  articles: readonly string[] | undefined,
): Promise<void> {
  await ensureCoverArtAuth();
  const playlists = await getAllPlaylists();
  // Read the detail markers BEFORE the upsert — they live on the same rows.
  const markers = new Map(
    (await listPlaylistDetailState(db)).map((r) => [r.id, r]),
  );
  await upsertPlaylists(db, playlists, undefined, articles);
  // Prune only when the API actually answered — `getAllPlaylists` returns `[]` (not a
  // throw) when there is no usable API, and pruning against that empties the table.
  // This is also the offline guard for the fan-out below (`getApi()` is null offline).
  if (getApi() === null) return;
  const protectedIds = await getProtectedPlaylistIds(db);
  await deletePlaylistsNotIn(db, playlists.map((p) => p.id), [...protectedIds]);
  syncStatusStore.getState().bumpLibraryUpdated();
  // Fire-and-forget: awaiting would block the Add-to-Playlist sheet's spinner, delay the
  // list repaint (`playlistLibraryLastFetchedAt`), and gate change-detect + the song kick
  // behind playlist fetches, since this is the last step of `doNormalizedSync`.
  fireAndForget(
    reconcilePlaylistDetails(db, playlists, markers, protectedIds),
    'sync.playlistDetailReconcile',
  );
}

/** Cap on eager detail fetches per pass for NON-downloaded playlists. */
const PLAYLIST_REFRESH_CAP = 50;
/** Playlist detail payloads are individually large — keep well under the album walk. */
const PLAYLIST_PREFETCH_CONCURRENCY = 2;
/** Per-fetch budget. `runPool` awaits every worker, so one hung `getPlaylist` would
 *  otherwise leave the in-flight promise below unsettled and disable the reconcile for
 *  the rest of the session. */
const PLAYLIST_FETCH_TIMEOUT_MS = 20_000;

let detailReconcileInFlight: Promise<void> | null = null;

/**
 * Re-fetch the track membership of playlists the server says have changed.
 *
 * Nothing else does this any more: `playlist_songs` is written only by the on-demand
 * detail fetch, and the detail screen skips its mount fetch when it already has rows — so
 * without this a server-side track change stays invisible, and a downloaded playlist's
 * cached files drift, until the user manually pulls.
 *
 * "Changed" is judged against markers only this function writes, NOT the row's
 * `changed`/`song_count` — `fetchPlaylistDetail` rewrites those from the DETAIL envelope,
 * so on a server whose list and detail endpoints disagree the comparison would never
 * settle and every refresh would refetch the cap.
 */
async function reconcilePlaylistDetails(
  db: InternalDb,
  playlists: readonly Playlist[],
  markers: Map<string, PlaylistDetailStateRow>,
  downloadedIds: ReadonlySet<string>,
): Promise<void> {
  if (detailReconcileInFlight) return detailReconcileInFlight;
  const run = (async () => {
    const capturedGen = syncStatusStore.getState().generation;
    // `?? 0` on both sides so NULL means exactly one thing: never fetched. `toEpoch`
    // returns null for a missing/unparseable `changed`, which some servers omit.
    const stale = playlists.filter((p) => {
      const m = markers.get(p.id);
      return (
        (m?.detail_changed ?? null) !== (toEpoch(p.changed) ?? 0) ||
        (m?.detail_song_count ?? null) !== (p.songCount ?? 0)
      );
    });
    if (stale.length === 0) return;

    // Most-recently-changed first; downloaded playlists always included regardless of cap.
    const ordered = [...stale].sort((a, b) => (toEpoch(b.changed) ?? 0) - (toEpoch(a.changed) ?? 0));
    const capped: Playlist[] = [];
    let nonDownloaded = 0;
    for (const p of ordered) {
      if (downloadedIds.has(p.id)) capped.push(p);
      else if (nonDownloaded < PLAYLIST_REFRESH_CAP) {
        capped.push(p);
        nonDownloaded += 1;
      }
    }
    if (capped.length < stale.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[normalized-sync] playlist detail refresh capped: ${capped.length}/${stale.length}, ` +
          `${stale.length - capped.length} deferred (markers unstamped, so they retry)`,
      );
    }

    const ctrl = new AbortController();
    const unsubGen = syncStatusStore.subscribe((st) => {
      if (st.generation !== capturedGen) ctrl.abort();
    });
    const unsubOffline = offlineModeStore.subscribe((st) => {
      if (st.offlineMode) ctrl.abort();
    });
    let stamped = 0;
    try {
      await runPool(
        capped,
        async (p) => {
          // Check either side of the fetch: `fetchPlaylistDetail` returns LOCAL data on
          // its offline branch, so a non-null result is not proof the server answered —
          // stamping that would suppress the refetch permanently.
          if (getApi() === null) return;
          const updated = await withTimeout(
            () => fetchPlaylistDetail(p.id, { prefetchCovers: false, force: true }),
            PLAYLIST_FETCH_TIMEOUT_MS,
          );
          if (updated === 'timeout' || !updated || getApi() === null) return;
          await stampPlaylistDetailSynced(db, p.id, toEpoch(p.changed) ?? 0, p.songCount ?? 0);
          stamped += 1;
          if (downloadedIds.has(p.id)) syncCachedItemTracks(p.id, updated.entry ?? []);
        },
        { concurrency: PLAYLIST_PREFETCH_CONCURRENCY, signal: ctrl.signal },
      );
    } finally {
      unsubGen();
      unsubOffline();
    }
    // Once, not per playlist: the refresh runs up to 50 fetches at concurrency 2, and a
    // per-item bump would re-arm the car refresh every 30s for the whole run.
    if (stamped > 0) syncStatusStore.getState().bumpLibraryUpdated();
  })();
  // Store `run` itself — assigning `run.finally(...)` would store a DIFFERENT promise,
  // so the identity check below never matches and the slot never clears.
  detailReconcileInFlight = run;
  void run.finally(() => {
    if (detailReconcileInFlight === run) detailReconcileInFlight = null;
  });
  return run;
}

/**
 * Refresh the artist list from the server into `artists`.
 *
 * Wraps {@link syncArtistsNormalized} with the dedup guard + the `loading` /
 * `lastFetchedAt` state on `syncStatusStore` that the list screens render from.
 */
export async function refreshArtistLibrary(): Promise<void> {
  if (syncStatusStore.getState().artistLibraryLoading) return;
  const db = getDb();
  if (!db) return;
  syncStatusStore.getState().setListRefresh('artists', true);
  try {
    await syncArtistsNormalized(db, serverInfoStore.getState().ignoredArticles ?? undefined);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[normalized-sync] artist refresh failed', e);
  } finally {
    syncStatusStore.getState().setListRefresh('artists', false);
  }
}

/** Refresh the playlist list from the server into `playlists`. See {@link refreshArtistLibrary}. */
export async function refreshPlaylistLibrary(): Promise<void> {
  if (syncStatusStore.getState().playlistLibraryLoading) return;
  const db = getDb();
  if (!db) return;
  syncStatusStore.getState().setListRefresh('playlists', true);
  try {
    await syncPlaylistsNormalized(db, serverInfoStore.getState().ignoredArticles ?? undefined);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[normalized-sync] playlist refresh failed', e);
  } finally {
    syncStatusStore.getState().setListRefresh('playlists', false);
  }
}

/**
 * Run the full remote library sync into the normalized model. `full` restarts from
 * cursor zero and re-walks every album's songs, without dropping the tables.
 *
 * Deduping is conditional: a plain concurrent call joins the running promise, but a
 * `full` request must never silently join a non-full run (that is the user tapping the
 * exit hatch and getting nothing), and neither may a call whose generation has moved on
 * — `forceFullResync` bumps the generation immediately before asking for the full run.
 */
/**
 * Forget the running sync so the next request does not queue behind it. Logout calls
 * this after bumping the generation: the old run may be parked in a fetch that never
 * returns (OkHttp has no timeouts), and its generation checks stop it writing anything.
 */
export function releaseLibrarySyncQueue(): void {
  inFlight = null;
}

export function runNormalizedLibrarySync(
  opts: { full?: boolean; reason?: string } = {},
): Promise<void> {
  // Refused outright rather than left to the guard inside `upsertSongs` / `upsertAlbums`:
  // that one returns 0 rows written, which this walk cannot tell from an empty page, so
  // it would page the whole library advancing cursors and persist a "complete" sync that
  // wrote nothing.
  if (shouldBlockLibraryWrites()) {
    logLibrarySync(`sync refused — Navidrome re-key outstanding (reason=${opts.reason ?? 'unknown'})`);
    return Promise.resolve();
  }
  const gen = syncStatusStore.getState().generation;
  const canJoin = inFlight !== null && gen === inFlightGen && (!opts.full || inFlightFull);
  if (canJoin) return inFlight as Promise<void>;
  const previous = inFlight;
  inFlightGen = gen;
  inFlightFull = opts.full === true;
  const run = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => doNormalizedSync({ ...opts, gen }));
  // Store `run` itself, not `run.finally(...)` — that returns a different promise, so the
  // identity check never matches, the slot never clears, and every later call joins a
  // stale resolved promise and silently does nothing.
  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** One retry after a short pause, then give up. Transient network blips and the odd
 *  500 should not end an hour-long sync; a second failure is treated as real and
 *  pauses the run so the user can resume from the persisted cursor. */
const PAGE_RETRY_DELAY_MS = 2000;

async function fetchPageWithRetry<T>(
  fetch: () => Promise<T>,
  label: string,
): Promise<{ ok: true; page: T } | { ok: false; error: string }> {
  try {
    return { ok: true, page: await fetch() };
  } catch (first) {
    logLibrarySync(`${label} error (1/2) — retrying: ${errText(first)}`);
    await new Promise<void>((r) => setTimeout(r, PAGE_RETRY_DELAY_MS));
    try {
      return { ok: true, page: await fetch() };
    } catch (second) {
      return { ok: false, error: errText(second) };
    }
  }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Park the run in a resumable paused state with the reason attached. Returns rather
 *  than throwing on purpose — the outer catch force-writes `error`/`idle`, which would
 *  overwrite the pause and lose the explanation. */
function pauseForError(message: string, phase: 'album' | 'song'): void {
  logLibrarySync(`run PAUSED (${phase}) after retry — ${message}`);
  const st = syncStatusStore.getState();
  st.setLastSyncError(message);
  if (phase === 'album') st.setLibrarySyncPhase('paused-error');
  else st.setDetailSyncPhase('paused-error');
}

async function doNormalizedSync(
  {
    full = false,
    // Diagnostic only: which call site asked for this run. Logged with the stats so an
    // unexplained sync (and the banner it drives) can be traced to its trigger.
    reason = 'unknown',
    // The generation the run was REQUESTED under. A run queued behind another starts
    // only when that one settles, by which time a logout may have bumped it.
    gen,
  }: { full?: boolean; reason?: string; gen: number },
): Promise<void> {
  if (syncStatusStore.getState().generation !== gen) return;
  const db = getDb();
  if (!db) return;
  if (offlineModeStore.getState().offlineMode) return;

  // Snapshot the diagnostic flag ONCE for the run. The store writes the same cached
  // flag whenever the Logging screen mounts, so re-reading it per call could have a
  // deliberate mid-run toggle clobbered back to the file's value.
  const syncLogOn = readLibrarySyncLogFlag();

  const capturedGen = gen;
  const genChanged = (): boolean => syncStatusStore.getState().generation !== capturedGen;
  const isOffline = (): boolean => offlineModeStore.getState().offlineMode;

  // The reap epoch, minted before the first write so everything this run writes carries
  // `synced_at >= epoch`. `full` only: a non-full run resumes from its cursors and never
  // enumerates the whole library, so it can authorise nothing. Local to the run — one
  // that bails or is interrupted takes its epoch with it and persists nothing.
  const epoch = full ? Date.now() : null;

  const tStart = nowMs();
  try {
    if (full) {
      // Deliberately NOT `resetNormalizedSchema`. Dropping the tables also destroys the
      // things the sync never rebuilds — playlist membership, artist bio/similar/top
      // songs — and album/playlist detail read only the normalized tables, so a
      // downloaded album's track list goes blank offline until the song phase finishes,
      // permanently if it is interrupted. Upserts overwrite every server-derived column
      // anyway, so a restart-from-zero rebuild is equivalent without the collateral.
      syncStatusStore.getState().resetLibrarySync();
      syncStatusStore.getState().resetSongSync();
      // The resync overwrites rows in place, so the detail markers would survive and
      // make the one manual repair the UI offers skip every playlist.
      await clearPlaylistDetailMarkers(db);
    }

    // Transport: the user override wins outright, else the persisted resume
    // strategy, else probe once and persist. The override is deliberately not
    // persisted as `syncStrategy` — that field means "what the probe found", and
    // toggling the override off has to re-probe rather than inherit 'basic'.
    let strat: SyncStrategy | null = syncStatusStore.getState().forceLegacySync
      ? 'basic'
      : syncStatusStore.getState().syncStrategy;
    if (strat == null) {
      strat = (await probeEmptySearch3()) ? 'search3' : 'basic';
      if (genChanged()) return;
      syncStatusStore.getState().setSyncStrategy(strat);
    }

    logLibrarySync(
      `run start reason=${reason} full=${full} probe=${strat} `
        + `forceLegacy=${syncStatusStore.getState().forceLegacySync} `
        + `albumCursor=${syncStatusStore.getState().librarySyncCursor} `
        + `songCursor=${syncStatusStore.getState().songSyncCursor} `
        + `albums=${await countAlbums(db)} songs=${await countSongs(db)}`,
    );

    // The effective ignored-article list (server's, else the local default) — the
    // same list the alphabet scroller uses, so stored sort keys match its sections.
    const articles = serverInfoStore.getState().ignoredArticles ?? undefined;

    // ── Album phase → normalized `albums` ──────────────────────────────────────
    const tAlbum0 = nowMs();
    syncStatusStore.getState().setLibrarySyncPhase('fetching');
    // A previous run may have fallen back to the per-album list mid-phase. That has
    // to survive the resume, or we restart the fast path, hit whatever stopped it,
    // and re-walk everything again. Read it BEFORE announcing the phase, or the
    // announcement overwrites what we are about to read.
    const resumedAlbumTransport = syncStatusStore.getState().albumSyncStrategy;
    const useBasic = (resumedAlbumTransport ?? strat) === 'basic';
    const transport: SyncStrategy = useBasic ? 'basic' : 'search3';
    // The fast path is uncapped on every server we support; getAlbumList2 has a
    // documented spec maximum of 500 that we honour everywhere. See SERVERS.md.
    const requested = useBasic ? BASIC_PAGE : ALBUM_PAGE;
    // Discards a cursor left by the OTHER transport, atomically. Seed `albumOffset`
    // only afterwards — reading it first would resume at the foreign offset the
    // discard exists to throw away.
    syncStatusStore.getState().startAlbumPhase(transport);
    let albumOffset = syncStatusStore.getState().librarySyncCursor;
    logLibrarySync(
      `album-phase start transport=${useBasic ? 'basic' : 'search3'} offset=${albumOffset} `
        + `resumed=${resumedAlbumTransport ?? 'none'} probe=${strat}`,
    );
    let prevFirstId: string | null = null;
    const corroborate = createEmptyPageCorroborator();
    for (;;) {
      if (genChanged()) return;
      if (isOffline()) {
        syncStatusStore.getState().setLibrarySyncPhase('paused-offline');
        return;
      }
      const tPage = nowMs();
      // eslint-disable-next-line no-await-in-loop
      const fetched = await fetchPageWithRetry(
        () => (useBasic ? getAlbumsPageByName(requested, albumOffset) : searchAlbumsPage(requested, albumOffset)),
        `album page offset=${albumOffset}`,
      );
      // Before the error branch too: see the song phase.
      if (genChanged()) return;
      if (!fetched.ok) {
        // Twice in a row is not a blip. Pause rather than fail: the cursor is already
        // persisted per page, so Resume picks up exactly here.
        pauseForError(fetched.error, 'album');
        return;
      }
      const page: AlbumID3[] = fetched.page;
      // ── Termination, in this order. `page.length === 0` also satisfies `< requested`,
      // so checking short first would make this branch — and the API-null bail and the
      // corroborator inside it — unreachable.
      if (page.length === 0) {
        // End of library ONLY if we actually had an API to ask — the page fns resolve
        // [] without throwing when there is none (mid-logout, pre-auth-restore), and
        // marking the library complete off that leaves it permanently truncated.
        if (getApi() === null) return;
        // And only once the answer repeats: a well-formed 200 with no albums (mid-rescan,
        // proxied, rate limited) reads exactly like exhaustion, and believing one latches
        // a truncated album library 'complete'.
        // eslint-disable-next-line no-await-in-loop
        if (await corroborate.shouldRetry()) {
          // The retry re-requests the SAME offset, so a server answering empty-then-data
          // could return the page before the empty one. Clear the tracker or the
          // duplicate check below would misread that as the end.
          prevFirstId = null;
          continue;
        }
        break;
      }
      corroborate.reset();
      // Defensive end-of-results: a page identical to the previous one. No server in
      // reference/ behaves this way — the empty and short checks fire first — but this
      // loop is otherwise unbounded. UNVERIFIED against any real implementation.
      if (page[0]?.id != null && page[0].id === prevFirstId) {
        logLibrarySync(`album duplicate page at offset=${albumOffset} — treating as end of results`);
        break;
      }
      prevFirstId = page[0]?.id ?? null;
      // Correct any stale optimistic rating override against the server value. Per page
      // rather than at the end, so it stays bounded-memory.
      ratingStore.getState().reconcileRatings(
        page.map((a) => ({ id: a.id, serverRating: a.userRating ?? 0 })),
      );
      // How many of this page are actually new — the number that separates "the sync
      // is stuck" from "this pass is re-covering albums we already hold". Exact and
      // index-backed, and only computed when the diagnostic log is on. Ids are deduped
      // because a repeating server can send the same id twice in one page, which would
      // otherwise under-count matches and overstate `new`.
      let newInPage = -1;
      if (syncLogOn) {
        const ids = [...new Set(page.map((a) => a.id))];
        // eslint-disable-next-line no-await-in-loop
        newInPage = ids.length - (await albumIdsPresent(db, ids)).size;
        if (genChanged()) return;
      }
      // eslint-disable-next-line no-await-in-loop
      await upsertAlbums(db, page, undefined, articles);
      // A cursor written after logout's sync reset would resume over a wiped library.
      if (genChanged()) return;
      const pageStart = albumOffset;
      // Advance by what we ASKED for, not by what came back. Those are the same on any
      // server that honours the contract; where they differ, advancing by the reply
      // lets a server's own paging bug drive our cursor.
      albumOffset += requested;
      // The cursor IS the progress number. A row count cannot tell "re-writing rows
      // we already hold" from "doing nothing", so a pass over known albums looked
      // like a stall for as long as it ran.
      syncStatusStore.getState().setLibrarySyncCursor(albumOffset, transport);
      logLibrarySync(
        `album page offset=${pageStart} got=${page.length} new=${newInPage} `
          + `ms=${Math.round(nowMs() - tPage)} first=${page[0]?.id ?? '-'} last=${page[page.length - 1]?.id ?? '-'}`,
      );
      // Short page = end of results. AFTER the upsert and the advance, so the final
      // page is stored; the cursor is corrected to the true total on the way out.
      if (page.length < requested) {
        syncStatusStore.getState().setLibrarySyncCursor(pageStart + page.length, transport);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    if (genChanged()) return;
    syncStatusStore.getState().markLibrarySyncComplete();
    // Signal the car browse tree here, not just at the artist/playlist tails: every
    // song-phase bail below returns before them, so an interrupted sync would otherwise
    // leave thousands of new albums invisible to CarPlay.
    syncStatusStore.getState().bumpLibraryUpdated();
    const albumMs = nowMs() - tAlbum0;
    const totalAlbums = await countAlbums(db);

    // ── Song phase → normalized `songs` ────────────────────────────────────────
    const tSong0 = nowMs();
    syncStatusStore.getState().setDetailSyncPhase('syncing');
    syncStatusStore.getState().setDetailSyncTotal(totalAlbums);
    // Each song phase seeds its own progress from its resume cursor (search3) or its
    // walk position (basic) — both immune to rows a full resync hasn't rewritten yet.
    syncStatusStore.getState().setSongSyncStrategy(strat);
    // Did the song phase itself ask the server about every album that has no songs? The
    // basic walk does exactly that, so a repair pass after it would only re-ask albums
    // the server has already said it has nothing for.
    let walkedGaps = false;
    if (strat === 'basic') {
      // Basic (non-search3) server: songs don't carry albumId, so walk each album's
      // getAlbum song list instead of paging search3.
      if ((await doBasicSongWalk(db, articles, capturedGen)) === 'bailed') return;
      if (genChanged() || isOffline()) return;
      walkedGaps = true;
    } else if ((await runSearch3SongPhase(db, articles, capturedGen)) === 'bailed') {
      return;
    }
    if (genChanged()) return;

    // ── Gap repair ─────────────────────────────────────────────────────────────
    // Reaching the last page is necessary, not sufficient: a page the server thinned, or
    // an id it re-keyed, leaves whole albums with no tracks while the cursor sails past.
    // Repair it here rather than re-detecting it on every launch forever. A healthy
    // library costs ONE indexed `LIMIT 1` probe and no network at all.
    let gapped =
      !syncStatusStore.getState().songGapRepairAttempted && (await hasAlbumWithoutSongs(db));
    if (gapped && !walkedGaps) {
      // `onlyMissing` — `listAlbumIds − listSongAlbumIds`, never the whole library, and
      // never `fullWalkPending` (that would force all of it).
      if ((await doBasicSongWalk(db, articles, capturedGen, true)) === 'bailed') return;
      if (genChanged() || isOffline()) return;
      gapped = await hasAlbumWithoutSongs(db);
    }
    if (gapped) {
      // Asked per album and the server still has no tracks for them. Record it, or the
      // gates below and in `startupOrResumeFlow` re-trigger this run forever.
      syncStatusStore.getState().markSongGapRepairAttempted();
    }

    if (genChanged()) return;
    syncStatusStore.getState().setDetailSyncCompleted(totalAlbums);
    syncStatusStore.getState().markSongSyncComplete();
    // Both markers reached inside one full run: the enumeration is authoritative, so the
    // epoch is worth keeping. `recordFullResyncEpoch` re-checks both flags — a run
    // finished by a non-full resume gets here with no epoch and mints nothing.
    if (epoch !== null) syncStatusStore.getState().recordFullResyncEpoch(epoch);
    const songMs = nowMs() - tSong0;

    // ── Artists + Playlists — lightweight lists, tacked onto the initial sync so the
    // user's first Artists/Playlists tab open is instant, not an on-demand fetch.
    if (!isOffline() && !genChanged()) {
      // eslint-disable-next-line no-console
      await syncArtistsNormalized(db, articles).catch((e) => console.warn('[normalized-sync] artists failed', e));
    }
    if (!isOffline() && !genChanged()) {
      // eslint-disable-next-line no-console
      await syncPlaylistsNormalized(db, articles).catch((e) => console.warn('[normalized-sync] playlists failed', e));
    }

    const nAlbums = await countAlbums(db);
    const nSongs = await countSongs(db);
    // Row totals and this run's own numbers are different questions, and on a server
    // whose enumeration is short of its true library the two diverge permanently: rows
    // survive every resync, so the totals hold whatever any earlier run reached. Note a
    // RESUMED run reports the walk's position, which includes what it resumed from.
    const st = syncStatusStore.getState();
    const albumsThisRun = st.librarySyncCursor;
    const songsThisRun = st.songSyncFetched;
    // eslint-disable-next-line no-console
    logLibrarySync(
      `run done albums=${nAlbums} albumsThisRun=${albumsThisRun} songs=${nSongs} `
        + `songsThisRun=${songsThisRun} albumMs=${Math.round(albumMs)} `
        + `songMs=${Math.round(songMs)} totalMs=${Math.round(nowMs() - tStart)}`,
    );
    void flushLibrarySyncLog();
    console.log('[normalized-sync] done', {
      reason,
      full,
      albums: nAlbums,
      albumsThisRun,
      songs: nSongs,
      songsThisRun,
      albumMs: Math.round(albumMs),
      songMs: Math.round(songMs),
      totalMs: Math.round(nowMs() - tStart),
      // Rate of THIS run's work. Against the row total it reads as a throughput figure
      // for songs the run never fetched — wildly overstated on an incremental sync.
      songsPerSec: songMs > 0 ? Math.round(songsThisRun / (songMs / 1000)) : 0,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    logLibrarySync(
      `run FAILED phase=${syncStatusStore.getState().librarySyncPhase}/`
        + `${syncStatusStore.getState().detailSyncPhase} `
        + `albumCursor=${syncStatusStore.getState().librarySyncCursor} `
        + `songCursor=${syncStatusStore.getState().songSyncCursor} err=${e instanceof Error ? e.message : String(e)}`,
    );
    void flushLibrarySyncLog();
    // eslint-disable-next-line no-console
    console.warn('[normalized-sync] failed', e);
    syncStatusStore.getState().setDetailSyncPhase('error');
    // A throw in the ALBUM phase never reaches `markLibrarySyncComplete`, so without this
    // `librarySyncPhase` stays 'fetching' — and it is persisted, so the "Fetching
    // library…" banner survives the relaunch with nothing fetching.
    syncStatusStore.getState().setLibrarySyncPhase('idle');
  }
}
