/**
 * Centralised "more options" actions used by swipe gestures, long-press
 * menus, and the more-options bottom sheet.
 *
 * Keeps star/queue logic in one place so row and card components stay thin.
 */

import i18n from '../i18n/i18n';
import { albumDetailStore } from '../store/albumDetailStore';
import { artistDetailStore } from '../store/artistDetailStore';
import { favoritesStore } from '../store/favoritesStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { playlistLibraryStore } from '../store/playlistLibraryStore';
import { processingOverlayStore } from '../store/processingOverlayStore';
import { shuffleArray } from '../utils/arrayHelpers';
import {
  deleteCachedItem as deleteCachedItemService,
  enqueueSongDownload as enqueueSongDownloadService,
} from './musicCacheService';
import { addToQueue, playTrack, removeFromQueue } from './playerService';
import {
  createNewPlaylist,
  getAlbum,
  getPlaylist,
  getSimilarSongs,
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
        return state.songs.some((s) => s.id === id);
      case 'album':
        return state.albums.some((a) => a.id === id);
      case 'artist':
        return state.artists.some((a) => a.id === id);
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
 * Add every song from an album to the end of the play queue.
 * Uses cached album data when available, otherwise fetches from the API.
 */
export async function addAlbumToQueue(album: AlbumID3): Promise<void> {
  let songs = albumDetailStore.getState().albums[album.id]?.album?.song;
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
  let entries = playlistDetailStore.getState().playlists[playlist.id]?.playlist?.entry;
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
 */
export async function playMoreLikeThis(song: Child): Promise<void> {
  processingOverlayStore.getState().show(i18n.t('loading'));

  try {
    const tracks = await getSimilarSongs(song.id, layoutPreferencesStore.getState().listLength);
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
    let topSongs = artistDetailStore.getState().artists[artist.id]?.topSongs;
    if (!topSongs?.length) {
      const entry = await artistDetailStore.getState().fetchArtist(artist.id);
      topSongs = entry?.topSongs ?? [];
    }

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

    await playlistLibraryStore.getState().fetchAllPlaylists();
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
  const offline = offlineModeStore.getState().offlineMode;

  if (offline) {
    const state = musicCacheStore.getState();
    const items = Object.values(state.cachedItems);
    const songs = items.flatMap((item) =>
      item.songIds
        .map((id) => state.cachedSongs[id])
        .filter((t): t is NonNullable<typeof t> => t !== undefined && t.artist === artistName)
        .map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: item.name,
          coverArt: item.coverArtId,
          duration: t.duration,
          isDir: false,
        } as Child)),
    );

    if (songs.length === 0) {
      processingOverlayStore.getState().showError(i18n.t('noOfflineSongsByArtist', { artist: artistName }));
      return null;
    }
    return songs;
  }

  // Get artist detail (cached or fetched)
  const cached = artistDetailStore.getState().artists[artistId];
  const artistDetail = cached ?? (await artistDetailStore.getState().fetchArtist(artistId));
  const albums = artistDetail?.artist?.album;
  if (!albums?.length) {
    processingOverlayStore.getState().showError(i18n.t('noSongsFoundByArtist', { artist: artistName }));
    return null;
  }

  // Fetch songs from each album (use cache where available)
  const cachedAlbums = albumDetailStore.getState().albums;
  const albumSongs = await Promise.all(
    albums.map(async (album) => {
      const cachedSongs = cachedAlbums[album.id]?.album?.song;
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
 * Remove a single-song download. Deletes the synthetic `song:` item — the
 * service layer refcounts the underlying song and only removes the file if
 * nothing else references it.
 */
export function handleRemoveSongDownload(song: Child): void {
  if (!song?.id) return;
  const itemId = songItemId(song.id);
  try {
    deleteCachedItemService(itemId);
    processingOverlayStore.getState().showSuccess(
      i18n.t('songDownloadRemoved', { title: song.title ?? i18n.t('unknownSong') }),
    );
  } catch {
    processingOverlayStore.getState().showError(i18n.t('failedToLoad'));
  }
}
