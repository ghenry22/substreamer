/**
 * Centralised "more options" actions used by swipe gestures, long-press
 * menus, and the more-options bottom sheet.
 *
 * Keeps star/queue logic in one place so row and card components stay thin.
 */

import { albumDetailStore } from '../store/albumDetailStore';
import { artistDetailStore } from '../store/artistDetailStore';
import { favoritesStore } from '../store/favoritesStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { playlistLibraryStore } from '../store/playlistLibraryStore';
import { processingOverlayStore } from '../store/processingOverlayStore';
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
  processingOverlayStore.getState().show('Loading…');

  try {
    const tracks = await getSimilarSongs(song.id, 20);
    if (tracks.length === 0) {
      processingOverlayStore.getState().showError('No similar songs found');
      return;
    }

    await playTrack(tracks[0], tracks);
    processingOverlayStore.getState().showSuccess('Playing similar songs');
  } catch {
    processingOverlayStore.getState().showError('Failed to load similar songs');
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
  processingOverlayStore.getState().show('Loading…');

  try {
    const tracks = await getSimilarSongs2(artist.id, 20);
    if (tracks.length === 0) {
      processingOverlayStore.getState().showError('No similar artists mix available');
      return;
    }

    await playTrack(tracks[0], tracks);
    processingOverlayStore.getState().showSuccess('Playing similar artists mix');
  } catch {
    processingOverlayStore.getState().showError('Failed to load similar artists mix');
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
  processingOverlayStore.getState().show('Creating…');

  try {
    let topSongs = artistDetailStore.getState().artists[artist.id]?.topSongs;
    if (!topSongs?.length) {
      const entry = await artistDetailStore.getState().fetchArtist(artist.id);
      topSongs = entry?.topSongs ?? [];
    }

    if (topSongs.length === 0) {
      processingOverlayStore.getState().showError('No top songs available');
      return;
    }

    const songIds = topSongs.map((s) => s.id);
    const success = await createNewPlaylist(`${artist.name} Top Songs`, songIds);
    if (!success) {
      processingOverlayStore.getState().showError('Failed to create playlist');
      return;
    }

    await playlistLibraryStore.getState().fetchAllPlaylists();
    processingOverlayStore.getState().showSuccess('Playlist Created');
  } catch {
    processingOverlayStore.getState().showError('Failed to create playlist');
  }
}

/* ------------------------------------------------------------------ */
/*  Play more by this artist                                           */
/* ------------------------------------------------------------------ */

const MORE_BY_ARTIST_COUNT = 20;
const MORE_BY_ARTIST_MIN = 5;

/** Fisher-Yates (Knuth) in-place shuffle. */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build a shuffled queue of songs by a specific artist and start playback.
 * Online: fetches all albums by the artist, collects songs, shuffles.
 * Offline: scans cached music items for matching tracks.
 */
export async function playMoreByArtist(artistId: string, artistName: string): Promise<void> {
  const offline = offlineModeStore.getState().offlineMode;
  processingOverlayStore.getState().show('Loading…');

  try {
    let songs: Child[];

    if (offline) {
      const items = Object.values(musicCacheStore.getState().cachedItems);
      songs = items.flatMap((item) =>
        item.tracks
          .filter((t) => t.artist === artistName)
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
        processingOverlayStore.getState().showError(`No offline songs by ${artistName}`);
        return;
      }
      if (songs.length < MORE_BY_ARTIST_MIN) {
        processingOverlayStore.getState().showError(`Not enough offline songs by ${artistName}`);
        return;
      }
    } else {
      // Get artist detail (cached or fetched)
      const cached = artistDetailStore.getState().artists[artistId];
      const artistDetail = cached ?? (await artistDetailStore.getState().fetchArtist(artistId));
      const albums = artistDetail?.artist?.album;
      if (!albums?.length) {
        processingOverlayStore.getState().showError(`No songs found by ${artistName}`);
        return;
      }

      // Fetch songs from each album (use cache where available)
      const cachedAlbums = albumDetailStore.getState().albums;
      const albumSongs = await Promise.all(
        albums.map(async (album) => {
          const cached = cachedAlbums[album.id]?.album?.song;
          if (cached?.length) return cached;
          const fetched = await getAlbum(album.id);
          return fetched?.song ?? [];
        }),
      );

      // Flatten and filter to only this artist's songs (handles compilations)
      songs = albumSongs.flat().filter(
        (s) => s.artistId === artistId || s.artist === artistName,
      );

      if (songs.length === 0) {
        processingOverlayStore.getState().showError(`No songs found by ${artistName}`);
        return;
      }
      if (songs.length < MORE_BY_ARTIST_MIN) {
        processingOverlayStore.getState().showError(`Not enough songs by ${artistName}`);
        return;
      }
    }

    shuffleArray(songs);
    const queue = songs.slice(0, MORE_BY_ARTIST_COUNT);
    await playTrack(queue[0], queue);
    processingOverlayStore.getState().showSuccess(`Playing ${artistName} mix`);
  } catch {
    processingOverlayStore.getState().showError(`Failed to load ${artistName} songs`);
  }
}

/* ------------------------------------------------------------------ */
/*  Download management                                                */
/* ------------------------------------------------------------------ */

export { enqueueAlbumDownload, enqueuePlaylistDownload } from './musicCacheService';

export { deleteCachedItem as removeDownload, cancelDownload } from './musicCacheService';
