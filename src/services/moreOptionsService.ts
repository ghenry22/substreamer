/**
 * Centralised "more options" actions used by swipe gestures, long-press
 * menus, and the more-options bottom sheet.
 *
 * Keeps star/queue logic in one place so row and card components stay thin.
 */

import i18n from '../i18n/i18n';
import { fetchArtistBase, fetchArtistTopSongs } from './detailFetchService';
import { favoritesStore } from '../store/favoritesStore';
import { getSongEnvelope, musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { refreshPlaylistLibrary } from './normalizedLibrarySync';
import { buildMoreLikeThisQueue } from './relatedTracksService';
import { getDb } from '../store/persistence/db';
import { getAlbumDetail, getPlaylistDetail } from '../db/repository/details';
import { processingOverlayStore } from '../store/processingOverlayStore';
import { shuffleArray } from '../utils/arrayHelpers';
import {
  deleteCachedItem as deleteCachedItemService,
  enqueueSongDownload as enqueueSongDownloadService,
  removeCachedAlbumSong as removeCachedAlbumSongService,
} from './musicCacheService';
import { addToQueue, playSongNext, playTrack, removeFromQueue } from './playerService';
import {
  createNewPlaylist,
  getAlbum,
  getPlaylist,
  getSimilarSongs2,
  starAlbum,
  starArtist,
  starSong,
  unstarAlbum,
  unstarArtist,
  unstarSong,
  type AlbumID3,
  type ArtistID3,
  type Child,
  type Playlist,
} from './subsonicService';

/* ------------------------------------------------------------------ */
/*  Star / Unstar                                                      */
/* ------------------------------------------------------------------ */

type StarrableType = 'song' | 'album' | 'artist';

/**
 * Toggle the starred (favorite) state for an item and refresh the
 * favorites store so all views stay in sync.
 *
 * Reads current starred state from `favoritesStore` (the single source of
 * truth) and applies an optimistic override for instant UI feedback before
 * the server round-trip completes.
 *
 * Returns the new starred state (`true` = now starred).
 */
export async function toggleStar(
  type: StarrableType,
  id: string,
): Promise<boolean> {
  const state = favoritesStore.getState();

  const currentlyStarred = (() => {
    if (id in state.overrides) return state.overrides[id];
    switch (type) {
      case 'song':
        return state.songIds.has(id);
      case 'album':
        return state.albumIds.has(id);
      case 'artist':
        return state.artistIds.has(id);
    }
  })();

  const starred = !currentlyStarred;

  // Optimistic update – UI reflects the change immediately
  state.setOverride(id, starred);

  try {
    switch (type) {
      case 'song':
        if (starred) await starSong(id);
        else await unstarSong(id);
        break;
      case 'album':
        if (starred) await starAlbum(id);
        else await unstarAlbum(id);
        break;
      case 'artist':
        if (starred) await starArtist(id);
        else await unstarArtist(id);
        break;
    }

    // Refresh from server (clears overrides on success)
    favoritesStore.getState().fetchStarred();
  } catch {
    // Revert optimistic update on failure
    state.setOverride(id, currentlyStarred);
  }

  return starred;
}

/* ------------------------------------------------------------------ */
/*  Queue management                                                   */
/* ------------------------------------------------------------------ */

/**
 * Add a single song / track to the end of the play queue.
 */
export async function addSongToQueue(song: Child): Promise<void> {
  await addToQueue([song]);
}

/**
 * Insert a single song right after the currently-playing track so it
 * plays next without disturbing what's playing now. Falls back to
 * starting fresh playback when the queue is empty.
 */
export async function playSongNextInQueue(song: Child): Promise<void> {
  await playSongNext(song);
}

/**
 * Add every song from an album to the end of the play queue.
 * Uses cached album data when available, otherwise fetches from the API.
 */
export async function addAlbumToQueue(album: AlbumID3): Promise<void> {
  const db = getDb();
  let songs: Child[] | undefined = db ? (await getAlbumDetail(db, album.id))?.songs : undefined;
  if (!songs?.length) {
    const full = await getAlbum(album.id);
    songs = full?.song;
  }
  if (!songs?.length) return;
  await addToQueue(songs);
}

/**
 * Add every song from a playlist to the end of the play queue.
 * Uses cached playlist data when available, otherwise fetches from the API.
 */
export async function addPlaylistToQueue(playlist: Playlist): Promise<void> {
  const db = getDb();
  let entries: Child[] | undefined = db
    ? (await getPlaylistDetail(db, playlist.id))?.entry
    : undefined;
  if (!entries?.length) {
    const full = await getPlaylist(playlist.id);
    entries = full?.entry;
  }
  if (!entries?.length) return;
  await addToQueue(entries, playlist.id);
}

/**
 * Remove a track from the play queue by its index.
 */
export async function removeItemFromQueue(index: number): Promise<void> {
  await removeFromQueue(index);
}

/* ------------------------------------------------------------------ */
/*  Play more like this                                                */
/* ------------------------------------------------------------------ */

/**
 * Fetch similar songs for a given track and set them as the play queue.
 * Uses processing overlay for progress, success, and error feedback.
 * Falls back through `buildMoreLikeThisQueue` to keep the queue full
 * even when the server returns few per-song matches.
 */
export async function playMoreLikeThis(song: Child): Promise<void> {
  processingOverlayStore.getState().show(i18n.t('loading'));

  try {
    const target = layoutPreferencesStore.getState().listLength;
    const tracks = await buildMoreLikeThisQueue(song, target);
    if (tracks.length === 0) {
      processingOverlayStore.getState().showError(i18n.t('noSimilarSongsFound'));
      return;
    }

    await playTrack(tracks[0], tracks);
    processingOverlayStore.getState().showSuccess(i18n.t('playingSimilarSongs'));
  } catch {
    processingOverlayStore.getState().showError(i18n.t('failedToLoadSimilarSongs'));
  }
}

/* ------------------------------------------------------------------ */
/*  Play mix of similar artists                                        */
/* ------------------------------------------------------------------ */

/**
 * Fetch similar songs for a given artist (mix of similar artists) and set them as the play queue.
 * Uses processing overlay for progress, success, and error feedback.
 */
export async function playSimilarArtistsMix(artist: ArtistID3): Promise<void> {
  processingOverlayStore.getState().show(i18n.t('loading'));

  try {
    const tracks = await getSimilarSongs2(artist.id, layoutPreferencesStore.getState().listLength);
    if (tracks.length === 0) {
      processingOverlayStore.getState().showError(i18n.t('noSimilarArtistsMixAvailable'));
      return;
    }

    await playTrack(tracks[0], tracks);
    processingOverlayStore.getState().showSuccess(i18n.t('playingSimilarArtistsMix'));
  } catch {
    processingOverlayStore.getState().showError(i18n.t('failedToLoadSimilarArtistsMix'));
  }
}

/* ------------------------------------------------------------------ */
/*  Artist top songs playlist                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a new playlist from an artist's top songs.
 * Uses cached data when available, otherwise fetches artist detail.
 * Shows processing overlay for feedback; refreshes playlist library on success.
 */
export async function saveArtistTopSongsPlaylist(artist: ArtistID3): Promise<void> {
  processingOverlayStore.getState().show(i18n.t('creating'));

  try {
    // Local-first inside the fetcher: this only hits the server on a genuine miss.
    const topSongs = (await fetchArtistTopSongs(artist.id))?.songs ?? [];

    if (topSongs.length === 0) {
      processingOverlayStore.getState().showError(i18n.t('noTopSongsAvailable'));
      return;
    }

    const songIds = topSongs.map((s) => s.id);
    const success = await createNewPlaylist(`${artist.name} Top Songs`, songIds);
    if (!success) {
      processingOverlayStore.getState().showError(i18n.t('failedToCreatePlaylist'));
      return;
    }

    await refreshPlaylistLibrary();
    processingOverlayStore.getState().showSuccess(i18n.t('playlistCreated'));
  } catch {
    processingOverlayStore.getState().showError(i18n.t('failedToCreatePlaylist'));
  }
}

/* ------------------------------------------------------------------ */
/*  Play more by this artist                                           */
/* ------------------------------------------------------------------ */

const MORE_BY_ARTIST_MIN = 5;

/**
 * Fetch all songs by an artist across all albums.
 * Online: walks every album in the artist detail, fetches songs, filters by artist.
 * Offline: scans cached music items for matching tracks.
 * Returns `null` with an error overlay if no songs are found.
 */
async function fetchAllArtistSongs(
  artistId: string,
  artistName: string,
): Promise<Child[] | null> {
  // Both callers show the processing overlay then immediately await this function,
  // so yield one tick to let that overlay frame paint: the flatMap/filter below
  // blocks the JS thread on a prolific artist's discography. setTimeout, not rAF —
  // rAF can stall on Fabric.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const offline = offlineModeStore.getState().offlineMode;

  if (offline) {
    const state = musicCacheStore.getState();
    const items = Object.values(state.cachedItems);
    // Match on the row (cheap) and build the full `Child` only for the hits.
    // `album`/`coverArt` keep coming from the containing item, as they always have.
    const songs = items.flatMap((item) =>
      item.songIds.flatMap((id) => {
        if (state.cachedSongs[id]?.artist !== artistName) return [];
        const envelope = getSongEnvelope(id);
        return envelope ? [{ ...envelope, album: item.name, coverArt: item.coverArtId }] : [];
      }),
    );

    if (songs.length === 0) {
      processingOverlayStore.getState().showError(i18n.t('noOfflineSongsByArtist', { artist: artistName }));
      return null;
    }
    return songs;
  }

  // Local-first inside the fetcher: only hits the server when we don't hold the albums.
  const db = getDb();
  const albums = (await fetchArtistBase(artistId))?.albums;
  if (!albums?.length) {
    processingOverlayStore.getState().showError(i18n.t('noSongsFoundByArtist', { artist: artistName }));
    return null;
  }

  // Fetch songs from each album (normalized detail where available, else server).
  const albumSongs = await Promise.all(
    albums.map(async (album) => {
      const cachedSongs = db ? (await getAlbumDetail(db, album.id))?.songs : undefined;
      if (cachedSongs?.length) return cachedSongs;
      const fetched = await getAlbum(album.id);
      return fetched?.song ?? [];
    }),
  );

  // Flatten and filter to only this artist's songs (handles compilations)
  const songs = albumSongs.flat().filter(
    (s) => s.artistId === artistId || s.artist === artistName,
  );

  if (songs.length === 0) {
    processingOverlayStore.getState().showError(i18n.t('noSongsFoundByArtist', { artist: artistName }));
    return null;
  }
  return songs;
}

/**
 * Build a shuffled queue of songs by a specific artist and start playback.
 * Online: fetches all albums by the artist, collects songs, shuffles.
 * Offline: scans cached music items for matching tracks.
 */
export async function playMoreByArtist(artistId: string, artistName: string): Promise<void> {
  processingOverlayStore.getState().show(i18n.t('loading'));

  try {
    const songs = await fetchAllArtistSongs(artistId, artistName);
    if (!songs) return;

    if (songs.length < MORE_BY_ARTIST_MIN) {
      const offline = offlineModeStore.getState().offlineMode;
      const key = offline ? 'notEnoughOfflineSongsByArtist' : 'notEnoughSongsByArtist';
      processingOverlayStore.getState().showError(i18n.t(key, { artist: artistName }));
      return;
    }

    const queue = shuffleArray(songs).slice(0, layoutPreferencesStore.getState().listLength);
    await playTrack(queue[0], queue);
    processingOverlayStore.getState().showSuccess(i18n.t('playingArtistMix', { artist: artistName }));
  } catch {
    processingOverlayStore.getState().showError(i18n.t('failedToLoadArtistSongs', { artist: artistName }));
  }
}

/**
 * Play all songs by an artist. When shuffle is false, songs are ordered
 * chronologically by album (year → disc → track). No song count cap.
 */
export async function playAllByArtist(
  artistId: string,
  artistName: string,
  shuffle: boolean,
): Promise<void> {
  processingOverlayStore.getState().show(i18n.t('loading'));

  try {
    const songs = await fetchAllArtistSongs(artistId, artistName);
    if (!songs) return;

    let queue: Child[];
    if (shuffle) {
      queue = shuffleArray(songs);
    } else {
      // Sort by album year → disc → track for a natural listening order
      queue = [...songs].sort((a, b) => {
        const yearDiff = (a.year ?? 0) - (b.year ?? 0);
        if (yearDiff !== 0) return yearDiff;
        const discDiff = (a.discNumber ?? 1) - (b.discNumber ?? 1);
        if (discDiff !== 0) return discDiff;
        return (a.track ?? 0) - (b.track ?? 0);
      });
    }

    await playTrack(queue[0], queue);
    processingOverlayStore.getState().showSuccess(
      i18n.t(shuffle ? 'shufflingAllSongsByArtist' : 'playingAllSongsByArtist', { artist: artistName }),
    );
  } catch {
    processingOverlayStore.getState().showError(i18n.t('failedToLoadArtistSongs', { artist: artistName }));
  }
}

/* ------------------------------------------------------------------ */
/*  Download management                                                */
/* ------------------------------------------------------------------ */

export {
  enqueueAlbumDownload,
  enqueuePlaylistDownload,
  enqueueSongDownload,
} from './musicCacheService';

export { deleteCachedItem as removeDownload, cancelDownload } from './musicCacheService';

/** Synthetic itemId used for single-song download items. */
export function songItemId(songId: string): string {
  return `song:${songId}`;
}

/**
 * Trigger a single-song download and surface a toast / overlay confirming the
 * action. If the underlying song is already fully pooled, the call still
 * creates the `song:` item edge so the song is visible in the music-cache
 * browser — the service layer handles that short-circuit internally.
 */
export async function handleDownloadSong(song: Child): Promise<void> {
  if (!song?.id) return;
  try {
    await enqueueSongDownloadService(song);
    processingOverlayStore.getState().showSuccess(
      i18n.t('songDownloadStarted', { title: song.title ?? i18n.t('unknownSong') }),
    );
  } catch {
    processingOverlayStore.getState().showError(i18n.t('downloadFailed'));
  }
}

/**
 * Remove a song's download. Covers both ways a song can be cached:
 *   1. A synthetic `song:` item (explicit single-song download).
 *   2. Pooled via its parent album — that album edge is dropped, reverting
 *      the album to a partial download.
 * The service layer refcounts the underlying song and only deletes the file
 * once nothing else references it.
 */
export async function handleRemoveSongDownload(song: Child): Promise<void> {
  if (!song?.id) return;
  try {
    let removed = false;

    // Explicit single-song download edge, if any.
    if (musicCacheStore.getState().cachedItems[songItemId(song.id)]) {
      await deleteCachedItemService(songItemId(song.id));
      removed = true;
    }

    // Pooled via its parent album → drop the album edge (album becomes partial).
    if (song.albumId && (await removeCachedAlbumSongService(song.albumId, song.id))) {
      removed = true;
    }

    if (removed) {
      processingOverlayStore.getState().showSuccess(
        i18n.t('songDownloadRemoved', { title: song.title ?? i18n.t('unknownSong') }),
      );
    } else {
      processingOverlayStore.getState().showError(i18n.t('failedToLoad'));
    }
  } catch {
    processingOverlayStore.getState().showError(i18n.t('failedToLoad'));
  }
}
