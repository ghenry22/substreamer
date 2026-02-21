import * as ExpoCrypto from 'expo-crypto';
import SubsonicAPI, {
  type AlbumID3,
  type AlbumWithSongsID3,
  type ArtistID3,
  type ArtistInfo2,
  type ArtistWithAlbumsID3,
  type Child,
  type Playlist,
  type PlaylistWithSongs,
  type ScanStatus,
  type Share,
} from 'subsonic-api';

import { authStore } from '../store/authStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import type { ServerInfo } from '../store/serverInfoStore';

const reactNativeCrypto: Crypto = {
  getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
    ExpoCrypto.getRandomValues(array as Uint8Array);
    return array;
  },
} as Crypto;

const { CryptoDigestAlgorithm, CryptoEncoding, getRandomBytesAsync, digestStringAsync } =
  ExpoCrypto;

function normalizeServerUrl(url: string): string {
  let base = url.trim();
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = `https://${base}`;
  }
  return base.replace(/\/+$/, '');
}

let cachedApi: SubsonicAPI | null = null;
let cachedKey: string | null = null;

let cachedCoverArtKey: string | null = null;
let cachedCoverArtSalt: string | null = null;
let cachedCoverArtToken: string | null = null;

type LoginResult = { success: true; version: string } | { success: false; error: string };

export async function login(
  serverUrl: string,
  username: string,
  password: string
): Promise<LoginResult> {
  const url = normalizeServerUrl(serverUrl);
  const api = new SubsonicAPI({
    url,
    auth: { username: username.trim(), password },
    reuseSalt: true,
    crypto: reactNativeCrypto,
  });

  try {
    const response = await api.ping();

    if (response.status !== 'ok') {
      const err = (response as { error?: { code?: number; message?: string } }).error;
      const message =
        err?.message ?? (err?.code === 40 ? 'Wrong username or password' : 'Authentication failed');
      return { success: false, error: message };
    }

    const version =
      response.openSubsonic && 'serverVersion' in response
        ? response.serverVersion
        : response.version;
    return { success: true, version: version ?? response.version };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    return { success: false, error: message };
  }
}

export function getApi(): SubsonicAPI | null {
  if (offlineModeStore.getState().offlineMode) return null;
  const { isLoggedIn, serverUrl, username, password } = authStore.getState();
  if (!isLoggedIn || !serverUrl || !username || !password) {
    return null;
  }
  const key = `${normalizeServerUrl(serverUrl)}|${username}`;
  if (cachedKey === key && cachedApi) {
    return cachedApi;
  }
  cachedApi = new SubsonicAPI({
    url: normalizeServerUrl(serverUrl),
    auth: { username, password },
    reuseSalt: true,
    crypto: reactNativeCrypto,
  });
  cachedKey = key;
  return cachedApi;
}

export function clearApiCache(): void {
  cachedApi = null;
  cachedKey = null;
  cachedCoverArtKey = null;
  cachedCoverArtSalt = null;
  cachedCoverArtToken = null;
}

export type { AlbumID3, AlbumWithSongsID3, ArtistID3, ArtistInfo2, ArtistWithAlbumsID3, Child, Playlist, PlaylistWithSongs, ScanStatus, Share };

export async function ensureCoverArtAuth(): Promise<void> {
  const { isLoggedIn, serverUrl, username, password } = authStore.getState();
  if (!isLoggedIn || !serverUrl || !username || !password) return;
  const key = `${normalizeServerUrl(serverUrl)}|${username}`;
  if (cachedCoverArtKey === key && cachedCoverArtSalt && cachedCoverArtToken) return;
  const bytes = await getRandomBytesAsync(16);
  const salt = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const token = await digestStringAsync(
    CryptoDigestAlgorithm.MD5,
    password + salt,
    { encoding: CryptoEncoding.HEX }
  );
  cachedCoverArtKey = key;
  cachedCoverArtSalt = salt;
  cachedCoverArtToken = token;
}

export function getCoverArtUrl(coverArtId: string, size?: number): string | null {
  const { isLoggedIn, serverUrl, username } = authStore.getState();
  if (!coverArtId || !isLoggedIn || !serverUrl || !username) return null;
  if (cachedCoverArtKey === null || !cachedCoverArtSalt || !cachedCoverArtToken) return null;
  const base = `${normalizeServerUrl(serverUrl)}/rest/getCoverArt.view`;
  const params = new URLSearchParams({
    id: coverArtId,
    v: '1.16.1',
    c: 'substreamer',
    u: username,
    t: cachedCoverArtToken,
    s: cachedCoverArtSalt,
  });
  if (size != null && size > 0) params.set('size', String(size));
  return `${base}?${params.toString()}`;
}

/**
 * Build an authenticated stream URL for a given track ID.
 * Mirrors getCoverArtUrl but targets the /rest/stream.view endpoint.
 * Must call ensureCoverArtAuth() before using this.
 */
export function getStreamUrl(
  trackId: string,
  timeOffset?: number,
): string | null {
  const { isLoggedIn, serverUrl, username } = authStore.getState();
  if (!trackId || !isLoggedIn || !serverUrl || !username) return null;
  if (cachedCoverArtKey === null || !cachedCoverArtSalt || !cachedCoverArtToken) return null;
  const base = `${normalizeServerUrl(serverUrl)}/rest/stream.view`;
  const params = new URLSearchParams({
    id: trackId,
    v: '1.16.1',
    c: 'substreamer',
    u: username,
    t: cachedCoverArtToken,
    s: cachedCoverArtSalt,
  });

  // Apply playback settings
  const { maxBitRate, streamFormat, estimateContentLength } =
    playbackSettingsStore.getState();
  if (maxBitRate != null) {
    params.set('maxBitRate', String(maxBitRate));
  }
  if (streamFormat === 'mp3') {
    params.set('format', 'mp3');
  }
  if (estimateContentLength) {
    params.set('estimateContentLength', 'true');
  }

  // Resume transcoded streams from a given offset (OpenSubsonic timeOffset).
  if (timeOffset != null && timeOffset > 0) {
    params.set('timeOffset', String(timeOffset));
  }

  return `${base}?${params.toString()}`;
}

/**
 * Build an authenticated stream URL for downloading a track.
 * Uses the separate download quality settings (downloadMaxBitRate,
 * downloadFormat) and always sets estimateContentLength=true for
 * accurate progress tracking.
 */
export function getDownloadStreamUrl(trackId: string): string | null {
  const { isLoggedIn, serverUrl, username } = authStore.getState();
  if (!trackId || !isLoggedIn || !serverUrl || !username) return null;
  if (cachedCoverArtKey === null || !cachedCoverArtSalt || !cachedCoverArtToken) return null;
  const base = `${normalizeServerUrl(serverUrl)}/rest/stream.view`;
  const params = new URLSearchParams({
    id: trackId,
    v: '1.16.1',
    c: 'substreamer',
    u: username,
    t: cachedCoverArtToken,
    s: cachedCoverArtSalt,
    estimateContentLength: 'true',
  });

  const { downloadMaxBitRate, downloadFormat } =
    playbackSettingsStore.getState();
  if (downloadMaxBitRate != null) {
    params.set('maxBitRate', String(downloadMaxBitRate));
  }
  if (downloadFormat === 'mp3') {
    params.set('format', 'mp3');
  }

  return `${base}?${params.toString()}`;
}

export async function getRecentlyAddedAlbums(size?: number): Promise<AlbumID3[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.getAlbumList2({ type: 'newest', size: size ?? 20 });
  return response.albumList2?.album ?? [];
}

export async function getRecentlyPlayedAlbums(size?: number): Promise<AlbumID3[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.getAlbumList2({ type: 'recent', size: size ?? 20 });
  return response.albumList2?.album ?? [];
}

export async function getFrequentlyPlayedAlbums(size?: number): Promise<AlbumID3[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.getAlbumList2({ type: 'frequent', size: size ?? 20 });
  return response.albumList2?.album ?? [];
}

export async function getRandomAlbums(size?: number): Promise<AlbumID3[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.getAlbumList2({ type: 'random', size: size ?? 20 });
  return response.albumList2?.album ?? [];
}

export async function getAlbum(albumId: string): Promise<AlbumWithSongsID3 | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const response = await api.getAlbum({ id: albumId });
    return response.album ?? null;
  } catch {
    return null;
  }
}

/**
 * Attempt to fetch all albums via search3 with an empty query.
 * Some servers return the full library this way; others return nothing.
 */
export async function searchAllAlbums(): Promise<AlbumID3[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.search3({
    query: '',
    albumCount: 10000,
    songCount: 0,
    artistCount: 0,
  });
  return response.searchResult3?.album ?? [];
}

/**
 * Fetch a page of albums sorted alphabetically by artist.
 */
export async function getAlbumListAlphabetical(
  size: number,
  offset: number
): Promise<AlbumID3[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.getAlbumList2({
    type: 'alphabeticalByArtist',
    size,
    offset,
  });
  return response.albumList2?.album ?? [];
}

/**
 * Fetch all albums by paginating through getAlbumList2 (alphabeticalByArtist).
 * The API returns a max of 500 results per request, so we loop until exhausted.
 */
export async function getAllAlbumsAlphabetical(): Promise<AlbumID3[]> {
  const PAGE_SIZE = 500;
  let offset = 0;
  const allAlbums: AlbumID3[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await getAlbumListAlphabetical(PAGE_SIZE, offset);
    allAlbums.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allAlbums;
}

/**
 * Fetch all artists via the getArtists endpoint.
 * Flattens the index-based response into a flat array of ArtistID3.
 */
export async function getAllArtists(): Promise<ArtistID3[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.getArtists();
  const indexes = response.artists?.index ?? [];
  return indexes.flatMap((idx) => idx.artist ?? []);
}

/**
 * Fetch a single artist by ID, including their albums.
 */
export async function getArtist(id: string): Promise<ArtistWithAlbumsID3 | null> {
  const api = getApi();
  if (!api) return null;
  const response = await api.getArtist({ id });
  return response.artist ?? null;
}

/**
 * Fetch additional info for an artist (biography, similar artists, images).
 * Returns null gracefully if the server does not support this endpoint.
 */
export async function getArtistInfo2(id: string): Promise<ArtistInfo2 | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const response = await api.getArtistInfo2({ id });
    return response.artistInfo2 ?? null;
  } catch {
    // Some servers don't support getArtistInfo2
    return null;
  }
}

/**
 * Fetch top songs for a given artist by name.
 * Returns an empty array if the server does not support this endpoint.
 */
export async function getTopSongs(artistName: string, count = 20): Promise<Child[]> {
  const api = getApi();
  if (!api) return [];
  try {
    const response = await api.getTopSongs({ artist: artistName, count } as any);
    return response.topSongs?.song ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch all playlists via the getPlaylists endpoint.
 */
export async function getAllPlaylists(): Promise<Playlist[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.getPlaylists();
  return response.playlists?.playlist ?? [];
}

/**
 * Fetch a single playlist by ID, including its songs.
 */
export async function getPlaylist(id: string): Promise<PlaylistWithSongs | null> {
  const api = getApi();
  if (!api) return null;
  const response = await api.getPlaylist({ id });
  return response.playlist ?? null;
}

/**
 * Delete a playlist by ID.
 */
export async function deletePlaylist(id: string): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    await api.deletePlaylist({ id });
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace the contents of an existing playlist with a new ordered list
 * of song IDs. Uses createPlaylist with an existing playlistId, which
 * the Subsonic API treats as a full replacement.
 */
export async function updatePlaylistOrder(
  playlistId: string,
  name: string,
  songIds: string[],
): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    await api.createPlaylist({ playlistId, name, songId: songIds });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove songs from a playlist by their zero-based indexes.
 */
export async function removeFromPlaylist(
  playlistId: string,
  songIndexes: number[],
): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    await api.updatePlaylist({ playlistId, songIndexToRemove: songIndexes });
    return true;
  } catch {
    return false;
  }
}

export async function fetchServerInfo(): Promise<ServerInfo | null> {
  const api = getApi();
  if (!api) return null;

  try {
    const pingResponse = await api.ping();
    if (pingResponse.status !== 'ok') return null;

    const apiVersion = pingResponse.version ?? null;
    const openSubsonic = Boolean(
      pingResponse.openSubsonic && 'serverVersion' in pingResponse
    );
    const serverType = openSubsonic && 'type' in pingResponse ? pingResponse.type : null;
    const serverVersion =
      openSubsonic && 'serverVersion' in pingResponse
        ? pingResponse.serverVersion
        : null;

    let extensions: ServerInfo['extensions'] = [];
    if (openSubsonic) {
      try {
        const extResponse = await api.getOpenSubsonicExtensions();
        if (extResponse.status === 'ok' && extResponse.openSubsonicExtensions) {
          extensions = extResponse.openSubsonicExtensions.map((e) => ({
            name: e.name,
            versions: e.versions ?? [],
          }));
        }
      } catch {
        // Server may not support getOpenSubsonicExtensions
      }
    }

    return {
      serverType,
      serverVersion,
      apiVersion,
      openSubsonic,
      extensions,
      lastFetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch all starred (favorited) items via getStarred2.
 * Returns albums, artists, and songs in ID3 format.
 */
export async function getStarred2(): Promise<{
  albums: AlbumID3[];
  artists: ArtistID3[];
  songs: Child[];
}> {
  const api = getApi();
  if (!api) return { albums: [], artists: [], songs: [] };
  const response = await api.getStarred2();
  const starred = response.starred2;
  return {
    albums: starred?.album ?? [],
    artists: starred?.artist ?? [],
    songs: starred?.song ?? [],
  };
}

/**
 * Search for albums, artists, and songs using the search3 API.
 * Returns up to 20 results per category.
 */
export async function search3(query: string): Promise<{
  albums: AlbumID3[];
  artists: ArtistID3[];
  songs: Child[];
}> {
  const api = getApi();
  if (!api || !query.trim()) return { albums: [], artists: [], songs: [] };
  const response = await api.search3({
    query: query.trim(),
    albumCount: 20,
    artistCount: 20,
    songCount: 20,
  });
  const r = response.searchResult3;
  return {
    albums: r?.album ?? [],
    artists: r?.artist ?? [],
    songs: r?.song ?? [],
  };
}

/* ------------------------------------------------------------------ */
/*  Star / Unstar                                                     */
/* ------------------------------------------------------------------ */

/**
 * Star (favorite) an album by its ID3 albumId.
 */
export async function starAlbum(albumId: string): Promise<void> {
  const api = getApi();
  if (!api) return;
  await api.star({ albumId });
}

/**
 * Unstar (unfavorite) an album by its ID3 albumId.
 */
export async function unstarAlbum(albumId: string): Promise<void> {
  const api = getApi();
  if (!api) return;
  await api.unstar({ albumId });
}

/**
 * Star (favorite) an artist by its ID3 artistId.
 */
export async function starArtist(artistId: string): Promise<void> {
  const api = getApi();
  if (!api) return;
  await api.star({ artistId });
}

/**
 * Unstar (unfavorite) an artist by its ID3 artistId.
 */
export async function unstarArtist(artistId: string): Promise<void> {
  const api = getApi();
  if (!api) return;
  await api.unstar({ artistId });
}

/**
 * Star (favorite) a song/media item by its id.
 */
export async function starSong(id: string): Promise<void> {
  const api = getApi();
  if (!api) return;
  await api.star({ id });
}

/**
 * Unstar (unfavorite) a song/media item by its id.
 */
export async function unstarSong(id: string): Promise<void> {
  const api = getApi();
  if (!api) return;
  await api.unstar({ id });
}

/* ------------------------------------------------------------------ */
/*  Library Scan                                                       */
/* ------------------------------------------------------------------ */

interface ScanStatusResult {
  scanning: boolean;
  count: number;
  lastScan: number | null;
  folderCount: number | null;
}

/**
 * Fetch the current scan status from the server.
 */
export async function getScanStatus(): Promise<ScanStatusResult | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const response = await api.getScanStatus();
    return {
      scanning: response.scanStatus.scanning,
      count: response.scanStatus.count ?? 0,
      lastScan: response.lastScan ?? null,
      folderCount: response.folderCount ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Start a library scan on the server.
 * @param fullScan Only supported by Navidrome – performs a full scan instead of incremental.
 */
export async function startScan(fullScan?: boolean): Promise<ScanStatusResult | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const response = await api.startScan(fullScan != null ? { fullScan } : undefined);
    return {
      scanning: response.scanStatus.scanning,
      count: response.scanStatus.count ?? 0,
      lastScan: null,
      folderCount: null,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Shares                                                             */
/* ------------------------------------------------------------------ */

export async function getShares(): Promise<Share[] | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const response = await api.getShares();
    return response.shares?.share ?? [];
  } catch {
    return null;
  }
}

export async function createShare(
  id: string,
  description?: string,
  expires?: number,
): Promise<Share | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const args: { id: string; description?: string; expires?: number } = { id };
    if (description) args.description = description;
    if (expires != null) args.expires = expires;
    const response = await api.createShare(args);
    const shares = response.shares?.share ?? [];
    return shares[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a share with multiple song IDs (e.g. for sharing a queue).
 * The subsonic-api library only supports a single `id`, so we build the
 * request manually using repeated `id` query parameters.
 */
export async function createShareMultiple(
  ids: string[],
  description?: string,
  expires?: number,
): Promise<Share | null> {
  if (ids.length === 0) return null;
  if (ids.length === 1) return createShare(ids[0], description, expires);

  const { isLoggedIn, serverUrl, username, password } = authStore.getState();
  if (!isLoggedIn || !serverUrl || !username || !password) return null;

  try {
    const base = normalizeServerUrl(serverUrl);
    const bytes = await getRandomBytesAsync(16);
    const salt = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const token = await digestStringAsync(
      CryptoDigestAlgorithm.MD5,
      password + salt,
      { encoding: CryptoEncoding.HEX },
    );

    const params = new URLSearchParams({
      v: '1.16.1',
      c: 'substreamer',
      f: 'json',
      u: username,
      t: token,
      s: salt,
    });
    if (description) params.set('description', description);
    if (expires != null) params.set('expires', String(expires));

    const idParams = ids.map((i) => `id=${encodeURIComponent(i)}`).join('&');
    const url = `${base}/rest/createShare.view?${params.toString()}&${idParams}`;

    const response = await fetch(url);
    const json = await response.json();
    const root = json['subsonic-response'];
    if (root?.status !== 'ok') return null;
    const shares: Share[] = root.shares?.share ?? [];
    return shares[0] ?? null;
  } catch {
    return null;
  }
}

export async function updateShare(
  id: string,
  description?: string,
  expires?: number,
): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    const args: { id: string; description?: string; expires?: number } = { id };
    if (description !== undefined) args.description = description;
    if (expires !== undefined) args.expires = expires;
    await api.updateShare(args);
    return true;
  } catch {
    return false;
  }
}

export async function deleteShare(id: string): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    await api.deleteShare({ id });
    return true;
  } catch {
    return false;
  }
}
