import * as ExpoCrypto from 'expo-crypto';
import SubsonicAPI, {
  type AlbumID3,
  type AlbumWithSongsID3,
  type ArtistID3,
  type Child,
  type Playlist,
  type PlaylistWithSongs,
} from 'subsonic-api';

import { authStore } from '../store/authStore';
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

export type LoginResult = { success: true; version: string } | { success: false; error: string };

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

export type { AlbumID3, AlbumWithSongsID3, ArtistID3, Child, Playlist, PlaylistWithSongs };

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
