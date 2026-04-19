import {
  ensureCoverArtAuth,
  search3,
  type AlbumID3,
  type ArtistID3,
  type Child,
} from './subsonicService';
import { albumDetailStore } from '../store/albumDetailStore';
import { albumLibraryStore } from '../store/albumLibraryStore';
import { favoritesStore } from '../store/favoritesStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { playlistLibraryStore } from '../store/playlistLibraryStore';
import { getGenreNames } from '../utils/genreHelpers';

export interface SearchResults {
  albums: AlbumID3[];
  artists: ArtistID3[];
  songs: Child[];
}

/**
 * Build a map of trackId → coverArtId from playlist detail, album detail,
 * and favorites stores. Shared by offline search and genre filtering.
 */
function buildTrackCoverArtMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of Object.values(playlistDetailStore.getState().playlists)) {
    for (const song of entry.playlist.entry ?? []) {
      if (song.coverArt) map.set(song.id, song.coverArt);
    }
  }
  for (const entry of Object.values(albumDetailStore.getState().albums)) {
    for (const song of entry.album.song ?? []) {
      if (song.coverArt) map.set(song.id, song.coverArt);
    }
  }
  for (const song of favoritesStore.getState().songs) {
    if (song.coverArt) map.set(song.id, song.coverArt);
  }
  return map;
}

export async function performOnlineSearch(query: string): Promise<SearchResults> {
  await ensureCoverArtAuth();
  return search3(query);
}

export function performOfflineSearch(query: string): SearchResults {
  const q = query.toLowerCase();
  const { cachedItems, cachedSongs } = musicCacheStore.getState();

  const cachedIds = new Set(Object.keys(cachedItems));

  const albums = albumLibraryStore
    .getState()
    .albums.filter(
      (a) =>
        cachedIds.has(a.id) &&
        (a.name.toLowerCase().includes(q) ||
          (a.artist?.toLowerCase().includes(q) ?? false))
    );

  const playlists = playlistLibraryStore
    .getState()
    .playlists.filter(
      (p) => cachedIds.has(p.id) && p.name.toLowerCase().includes(q)
    );

  const playlistAlbums: AlbumID3[] = playlists.map((p) => ({
    id: p.id,
    name: p.name,
    artist: p.owner,
    coverArt: p.coverArt,
    songCount: p.songCount,
    duration: p.duration,
    created: p.created,
  }));

  const trackCoverArt = buildTrackCoverArtMap();

  const songs: Child[] = [];
  const seenSongIds = new Set<string>();
  for (const item of Object.values(cachedItems)) {
    for (const songId of item.songIds) {
      if (seenSongIds.has(songId)) continue;
      const track = cachedSongs[songId];
      if (!track) continue;
      if (
        track.title.toLowerCase().includes(q) ||
        (track.artist?.toLowerCase().includes(q) ?? false)
      ) {
        seenSongIds.add(track.id);
        songs.push({
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: item.name,
          duration: track.duration,
          isDir: false,
          coverArt: trackCoverArt.get(track.id) ?? item.coverArtId,
        });
      }
    }
  }

  return {
    albums: [...albums, ...playlistAlbums],
    artists: [],
    songs,
  };
}

function collectOfflineSongs(genreFilter?: string): Child[] {
  const g = genreFilter?.toLowerCase();
  const { cachedItems } = musicCacheStore.getState();

  const cachedItemIds = new Set(Object.keys(cachedItems));
  const cachedTrackIds = new Set<string>();
  for (const item of Object.values(cachedItems)) {
    for (const songId of item.songIds) {
      cachedTrackIds.add(songId);
    }
  }

  const trackCoverArt = buildTrackCoverArtMap();
  const results: Child[] = [];
  const seenIds = new Set<string>();

  function addSong(song: Child): void {
    if (seenIds.has(song.id) || !cachedTrackIds.has(song.id)) return;
    if (g && !getGenreNames(song).some((name) => name.toLowerCase() === g)) return;
    seenIds.add(song.id);
    results.push({
      ...song,
      coverArt: song.coverArt ?? trackCoverArt.get(song.id),
    });
  }

  // Songs from cached albums
  for (const entry of Object.values(albumDetailStore.getState().albums)) {
    if (!cachedItemIds.has(entry.album.id)) continue;
    for (const song of entry.album.song ?? []) {
      addSong(song);
    }
  }

  // Songs from cached playlists
  for (const entry of Object.values(playlistDetailStore.getState().playlists)) {
    if (!cachedItemIds.has(entry.playlist.id)) continue;
    for (const song of entry.playlist.entry ?? []) {
      addSong(song);
    }
  }

  // Starred songs that are cached
  for (const song of favoritesStore.getState().songs) {
    addSong(song);
  }

  return results;
}

export function getOfflineSongsByGenre(genre: string): Child[] {
  return collectOfflineSongs(genre);
}

export function getOfflineSongsAll(): Child[] {
  return collectOfflineSongs();
}
