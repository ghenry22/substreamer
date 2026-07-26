/**
 * Re-cache metadata (album/playlist detail) + cover art for DOWNLOADED items.
 *
 * Downloads are meant to carry their own metadata (see the download flow in
 * `musicCacheService`), so offline is just a filtered view over cached data.
 * This pass repairs downloaded items whose detail/art is missing (e.g. the
 * 8.0.89 on-demand-detail regression) and backs the proactive migration + the
 * manual "Refresh downloaded metadata" settings button.
 *
 * - `missing`: only fetch detail that isn't already cached (cheap; migration).
 * - `all`: re-fetch everything (manual refresh / update).
 *
 * Online-gated (no-op offline — `fetchAlbum`/`fetchPlaylist` short-circuit to the
 * cached entry offline anyway). One run at a time. Bounded concurrency.
 */
import { albumDetailStore } from '../store/albumDetailStore';
import { downloadedMetadataRefreshStore } from '../store/downloadedMetadataRefreshStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { runPool } from '../utils/promisePool';

const CONCURRENCY = 3;

type Task = { kind: 'album' | 'playlist'; id: string };

/** Outcome of a pass. `remaining` is measured from ACTUAL store presence after
 *  the pass (not fetch return values), so a `fetchAlbum` that returns null on a
 *  timeout/error counts as still-missing. `remaining < attempted` ⇒ progress was
 *  made; `remaining === attempted` ⇒ no progress (the stragglers keep failing). */
export interface RefreshOutcome {
  attempted: number;
  remaining: number;
}

/**
 * Ensure every downloaded item's detail + cover art is cached. Idempotent and
 * RESUMABLE: `missing` mode only fetches detail that's still absent, so an
 * interrupted run's completed work is never redone — a re-run just picks up the
 * stragglers. (0/0 when offline or nothing to do.)
 */
export async function refreshDownloadedMetadata(opts: {
  mode: 'missing' | 'all';
}): Promise<RefreshOutcome> {
  if (offlineModeStore.getState().offlineMode) return { attempted: 0, remaining: 0 };
  if (downloadedMetadataRefreshStore.getState().active) return { attempted: 0, remaining: 0 };

  const cachedItems = musicCacheStore.getState().cachedItems;
  const cachedSongs = musicCacheStore.getState().cachedSongs;

  // Collect the album + playlist ids whose detail must be present for offline
  // rendering: explicit album/playlist downloads, a song's parent album, and the
  // parent albums of favorited songs.
  const albumIds = new Set<string>();
  const playlistIds = new Set<string>();
  for (const [id, item] of Object.entries(cachedItems)) {
    if (item.type === 'album') albumIds.add(id);
    else if (item.type === 'playlist') playlistIds.add(id);
    else if (item.type === 'song' && item.parentAlbumId) albumIds.add(item.parentAlbumId);
    else if (item.type === 'favorites') {
      for (const songId of item.songIds ?? []) {
        const parent = cachedSongs[songId]?.albumId;
        if (parent) albumIds.add(parent);
      }
    }
  }

  const albums = albumDetailStore.getState().albums;
  const playlists = playlistDetailStore.getState().playlists;
  const tasks: Task[] = [
    ...[...albumIds]
      .filter((id) => opts.mode === 'all' || !albums[id])
      .map((id) => ({ kind: 'album' as const, id })),
    ...[...playlistIds]
      .filter((id) => opts.mode === 'all' || !playlists[id])
      .map((id) => ({ kind: 'playlist' as const, id })),
  ];

  if (tasks.length === 0) return { attempted: 0, remaining: 0 };

  const progress = downloadedMetadataRefreshStore.getState();
  progress.start(tasks.length);
  try {
    await runPool(
      tasks,
      async (t) => {
        try {
          if (t.kind === 'album') {
            await albumDetailStore.getState().fetchAlbum(t.id, { prefetchCovers: true });
          } else {
            await playlistDetailStore.getState().fetchPlaylist(t.id, { prefetchCovers: true });
          }
          downloadedMetadataRefreshStore.getState().tick(true);
        } catch (e) {
          downloadedMetadataRefreshStore.getState().tick(false);
          throw e;
        }
      },
      { concurrency: CONCURRENCY },
    );
    // Covers are prefetched by `fetchAlbum`/`fetchPlaylist` (prefetchCovers:true)
    // onto imageCacheService's self-draining in-memory download queue, so they
    // land without an explicit drain here — and they're purge-protected +
    // reconcile-recached + backfilled, so an in-flight cover survives an app
    // kill. We report done on DETAIL presence (measured below), not covers.
  } finally {
    downloadedMetadataRefreshStore.getState().finish();
  }

  // Measure what's STILL missing from actual store presence (not fetch return
  // values — `fetchAlbum` resolves null on a timeout/error without throwing).
  // `remaining < attempted` ⇒ progress was made; `=== attempted` ⇒ the
  // stragglers keep failing. The backfill caller uses this to resume-until-
  // complete across launches without looping forever on unfetchable items.
  const albumsAfter = albumDetailStore.getState().albums;
  const playlistsAfter = playlistDetailStore.getState().playlists;
  const remaining = tasks.filter((t) =>
    t.kind === 'album' ? !albumsAfter[t.id] : !playlistsAfter[t.id],
  ).length;
  return { attempted: tasks.length, remaining };
}
