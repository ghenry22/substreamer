import * as ExpoCrypto from 'expo-crypto';
import SubsonicAPI, {
  type AlbumID3,
  type AlbumInfo,
  type AlbumWithSongsID3,
  type ArtistID3,
  type ArtistInfo2,
  type ArtistWithAlbumsID3,
  type Child,
  type Genre,
  type Playlist,
  type PlaylistWithSongs,
  type ScanStatus,
  type Share,
  type StructuredLyrics,
} from 'subsonic-api';

import i18n from '../i18n/i18n';

import { authStore } from '../store/authStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { FORMAT_PRESETS, playbackSettingsStore, type StreamFormat, type MaxBitRate } from '../store/playbackSettingsStore';
import { serverInfoStore, type ServerInfo } from '../store/serverInfoStore';
import { supports } from './serverCapabilityService';

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
  password: string,
  legacyAuth = false
): Promise<LoginResult> {
  const url = normalizeServerUrl(serverUrl);
  const api = new SubsonicAPI({
    url,
    auth: { username: username.trim(), password },
    legacyAuth,
    reuseSalt: true,
    crypto: reactNativeCrypto,
    clientName: 'substreamer8',
    clientVersion: '1.15.0',
  });

  try {
    const response = await api.ping();

    if (response.status !== 'ok') {
      const err = (response as { error?: { code?: number; message?: string } }).error;
      const message =
        err?.message ?? (err?.code === 40 ? i18n.t('wrongUsernameOrPassword') : i18n.t('authenticationFailed'));
      return { success: false, error: message };
    }

    const version =
      response.openSubsonic && 'serverVersion' in response
        ? response.serverVersion
        : response.version;
    return { success: true, version: version ?? response.version };
  } catch (err) {
    const message = err instanceof Error ? err.message : i18n.t('connectionFailed');
    return { success: false, error: message };
  }
}

export function getApi(): SubsonicAPI | null {
  if (offlineModeStore.getState().offlineMode) return null;
  return getApiUnchecked();
}

/**
 * Return the cached SubsonicAPI instance without checking offline mode.
 * Used by the connectivity service which must ping the server regardless
 * of offline state to detect when it becomes reachable again.
 */
export function getApiUnchecked(): SubsonicAPI | null {
  const { isLoggedIn, serverUrl, username, password, legacyAuth } = authStore.getState();
  if (!isLoggedIn || !serverUrl || !username || !password) {
    return null;
  }
  const key = `${normalizeServerUrl(serverUrl)}|${username}|${legacyAuth}`;
  if (cachedKey === key && cachedApi) {
    return cachedApi;
  }
  cachedApi = new SubsonicAPI({
    url: normalizeServerUrl(serverUrl),
    auth: { username, password },
    legacyAuth,
    reuseSalt: true,
    crypto: reactNativeCrypto,
    clientName: 'substreamer8',
    clientVersion: '1.15.0',
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

export type { AlbumID3, AlbumInfo, AlbumWithSongsID3, ArtistID3, ArtistInfo2, ArtistWithAlbumsID3, Child, Genre, Playlist, PlaylistWithSongs, ScanStatus, Share };

// ------------------------------------------------------------------ //
//  Various Artists pseudo-artist                                      //
// ------------------------------------------------------------------ //

export const VARIOUS_ARTISTS_NAME = 'Various Artists';

export const VARIOUS_ARTISTS_BIO =
  'Various Artists collects compilation albums, soundtracks, tribute records and other ' +
  'releases that feature songs from multiple artists.\n\n' +
  'Browse the albums below to discover what\'s in your collection.';

/** Translated display name for Various Artists. Use for UI display only. */
export function getVariousArtistsName(): string {
  return i18n.t('variousArtists');
}

/** Translated bio for Various Artists. Use for UI display only. */
export function getVariousArtistsBio(): string {
  return i18n.t('variousArtistsBio');
}

/** Sentinel coverArtId — CachedImage maps this to the bundled asset. */
export const VARIOUS_ARTISTS_COVER_ART_ID = '__various_artists_cover__';

/** Case-insensitive check for the Various Artists pseudo-artist name. */
export function isVariousArtists(name: string | undefined): boolean {
  return name?.trim().toLowerCase() === 'various artists';
}

export async function ensureCoverArtAuth(): Promise<void> {
  const { isLoggedIn, serverUrl, username, password, legacyAuth } = authStore.getState();
  if (!isLoggedIn || !serverUrl || !username || !password) return;
  const key = `${normalizeServerUrl(serverUrl)}|${username}|${legacyAuth}`;
  if (cachedCoverArtKey === key && cachedCoverArtToken) return;

  if (legacyAuth) {
    cachedCoverArtSalt = null;
    cachedCoverArtToken = 'enc:' + Array.from(password)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  } else {
    const bytes = await getRandomBytesAsync(16);
    cachedCoverArtSalt = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    cachedCoverArtToken = await digestStringAsync(
      CryptoDigestAlgorithm.MD5,
      password + cachedCoverArtSalt,
      { encoding: CryptoEncoding.HEX }
    );
  }
  cachedCoverArtKey = key;
}

/**
 * Navidrome coverArt IDs use `{type}-{entityId}_{hexTimestamp}`. The hex
 * suffix changes when art is re-indexed but the entity is the same.
 * Stripping it produces a stable key for caching and server requests.
 * Idempotent: returns the original ID when no hex suffix is present.
 */
const HEX_SUFFIX_RE = /^[0-9a-f]+$/i;

export function stripCoverArtSuffix(coverArtId: string): string {
  const i = coverArtId.lastIndexOf('_');
  if (i <= 0) return coverArtId;
  const suffix = coverArtId.slice(i + 1);
  if (!HEX_SUFFIX_RE.test(suffix)) return coverArtId;
  return coverArtId.slice(0, i);
}

function applyUrlAuth(params: URLSearchParams, username: string): void {
  params.set('u', username);
  if (cachedCoverArtSalt != null) {
    params.set('t', cachedCoverArtToken!);
    params.set('s', cachedCoverArtSalt);
  } else {
    params.set('p', cachedCoverArtToken!);
  }
}

export function getCoverArtUrl(coverArtId: string, size?: number): string | null {
  const { isLoggedIn, serverUrl, username } = authStore.getState();
  if (!coverArtId || !isLoggedIn || !serverUrl || !username) return null;
  if (cachedCoverArtKey === null || !cachedCoverArtToken) return null;
  if (offlineModeStore.getState().offlineMode) return null;
  const base = `${normalizeServerUrl(serverUrl)}/rest/getCoverArt.view`;
  const params = new URLSearchParams({
    id: stripCoverArtSuffix(coverArtId),
    v: '1.15.0',
    c: 'substreamer8',
  });
  applyUrlAuth(params, username);
  if (size != null && size > 0) params.set('size', String(size));
  return `${base}?${params.toString()}`;
}

/**
 * Apply the `format=` and `maxBitRate=` query params for a stream/download
 * URL based on the user's chosen format and bitrate. Skips both params
 * for the `'raw'` sentinel and any `lossless` preset (e.g. flac). For
 * lossy formats, substitutes a per-codec HIGH default bitrate when the
 * user has the bitrate picker set to "no limit".
 */
function applyFormatAndBitrate(
  params: URLSearchParams,
  format: StreamFormat,
  maxBitRate: MaxBitRate,
): void {
  if (format !== 'raw') {
    params.set('format', format);
  }
  const preset = FORMAT_PRESETS.find((p) => p.value === format);
  // raw or any lossless preset → never send maxBitRate
  if (format === 'raw' || preset?.lossless) return;
  // For lossy formats, fall back to the preset HIGH default when the
  // user has bitrate at "no limit"; for custom (unrecognized) values,
  // fall back to 320.
  const effective = maxBitRate ?? preset?.highBitrate ?? 320;
  if (effective != null) {
    params.set('maxBitRate', String(effective));
  }
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
  if (cachedCoverArtKey === null || !cachedCoverArtToken) return null;
  if (offlineModeStore.getState().offlineMode) return null;
  const base = `${normalizeServerUrl(serverUrl)}/rest/stream.view`;
  const params = new URLSearchParams({
    id: trackId,
    v: '1.15.0',
    c: 'substreamer8',
  });
  applyUrlAuth(params, username);

  // Apply playback settings
  const { maxBitRate, streamFormat, estimateContentLength } =
    playbackSettingsStore.getState();
  applyFormatAndBitrate(params, streamFormat, maxBitRate);
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
  if (cachedCoverArtKey === null || !cachedCoverArtToken) return null;
  const base = `${normalizeServerUrl(serverUrl)}/rest/stream.view`;
  const params = new URLSearchParams({
    id: trackId,
    v: '1.15.0',
    c: 'substreamer8',
    estimateContentLength: 'true',
  });
  applyUrlAuth(params, username);

  const { downloadMaxBitRate, downloadFormat } =
    playbackSettingsStore.getState();
  applyFormatAndBitrate(params, downloadFormat, downloadMaxBitRate);

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

export async function getAlbumInfo2(albumId: string): Promise<AlbumInfo | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const response = await api.getAlbumInfo2({ id: albumId });
    return response.albumInfo ?? null;
  } catch {
    // Some servers don't support getAlbumInfo2
    return null;
  }
}

// ------------------------------------------------------------------ //
//  Lyrics                                                             //
// ------------------------------------------------------------------ //

export interface LyricsLine {
  /** Milliseconds from the start of the track. Only meaningful when `synced` is true. */
  startMs: number;
  text: string;
}

export interface LyricsData {
  synced: boolean;
  lines: LyricsLine[];
  /** Lowercase 2-letter locale if the server supplied a real value. `xxx`/`und` normalised away. */
  lang?: string;
  /** Spec says "assume 0" when omitted. */
  offsetMs: number;
  /**
   * `structured` — from `getLyricsBySongId` (OpenSubsonic).
   * `classic` — from `getLyrics` (classic Subsonic, plain text by artist+title).
   * `fake` is assigned by the UI layer when fake line timings are synthesised.
   */
  source: 'structured' | 'classic' | 'fake';
}

const UNSPECIFIED_LANGS = new Set(['xxx', 'und']);

function pickStructuredEntry(entries: StructuredLyrics[]): StructuredLyrics | null {
  if (entries.length === 0) return null;
  const device = (i18n.language ?? 'en').slice(0, 2).toLowerCase();
  for (const entry of entries) {
    const lang = entry.lang?.slice(0, 2).toLowerCase();
    if (lang && !UNSPECIFIED_LANGS.has(lang) && lang === device) return entry;
  }
  return entries[0];
}

function normaliseLang(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const short = lang.slice(0, 2).toLowerCase();
  if (UNSPECIFIED_LANGS.has(lang.toLowerCase()) || UNSPECIFIED_LANGS.has(short)) return undefined;
  return short;
}

function structuredToLyricsData(entry: StructuredLyrics): LyricsData | null {
  if (!entry.line || entry.line.length === 0) return null;
  const synced = !!entry.synced;
  const lines: LyricsLine[] = entry.line.map((l) => ({
    // Spec mandates `start` be omitted for unsynced lines. Use the `synced`
    // flag as the source of truth — if a buggy server includes `start` on an
    // unsynced entry, ignore it.
    startMs: synced ? (l.start ?? 0) : 0,
    text: l.value ?? '',
  }));
  if (synced) lines.sort((a, b) => a.startMs - b.startMs);
  return {
    synced,
    lines,
    lang: normaliseLang(entry.lang),
    offsetMs: entry.offset ?? 0,
    source: 'structured',
  };
}

function classicValueToLyricsData(value: string): LyricsData | null {
  const raw = value.split('\n').map((l) => l.replace(/\s+$/, ''));
  // Drop leading/trailing fully-empty lines, keep interior empties.
  let start = 0;
  let end = raw.length;
  while (start < end && raw[start].length === 0) start++;
  while (end > start && raw[end - 1].length === 0) end--;
  const lines = raw.slice(start, end);
  if (lines.length === 0) return null;
  return {
    synced: false,
    lines: lines.map((text) => ({ startMs: 0, text })),
    offsetMs: 0,
    source: 'classic',
  };
}

/**
 * Fetch lyrics for a track. Prefers OpenSubsonic `getLyricsBySongId` when the
 * server supports the `songLyrics` extension; falls back to the classic
 * `getLyrics` endpoint (by artist + title). Returns `null` when neither
 * source produces usable data. Errors are not classified here — the caller
 * (store) owns timeout vs error classification.
 */
export async function getLyricsForTrack(
  trackId: string,
  artist?: string,
  title?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _signal?: AbortSignal,
): Promise<LyricsData | null> {
  const api = getApi();
  if (!api) return null;

  if (supports('structuredLyrics')) {
    try {
      const response = await api.getLyricsBySongId({ id: trackId });
      // Ampache deviation: `structuredLyrics` arrives as a single object
      // (not an array) when lyrics exist. Normalise to array here so the
      // rest of the code can assume the spec-compliant shape.
      const raw = response.lyricsList?.structuredLyrics as
        | StructuredLyrics[]
        | StructuredLyrics
        | undefined;
      const structured: StructuredLyrics[] = Array.isArray(raw)
        ? raw
        : raw
          ? [raw]
          : [];
      const picked = pickStructuredEntry(structured);
      if (picked) {
        const data = structuredToLyricsData(picked);
        if (data) return data;
      }
    } catch {
      // Fall through to classic fallback.
    }
  }

  if (artist && title) {
    try {
      const response = await api.getLyrics({ artist, title });
      const value = response.lyrics?.value;
      if (value && value.trim().length > 0) {
        const data = classicValueToLyricsData(value);
        if (data) return data;
      }
    } catch {
      // No classic lyrics available.
    }
  }

  return null;
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
 *
 * Side-effect: captures the response's `ignoredArticles` hint into
 * `serverInfoStore` so the article-stripped sort in album/artist/playlist
 * lists matches the server's configured article list (Navidrome admins
 * can extend this beyond the Subsonic default).
 */
export async function getAllArtists(): Promise<ArtistID3[]> {
  const api = getApi();
  if (!api) return [];
  const response = await api.getArtists();
  const ignoredArticlesRaw = response.artists?.ignoredArticles;
  if (typeof ignoredArticlesRaw === 'string') {
    const articles = ignoredArticlesRaw
      .split(/\s+/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    serverInfoStore.getState().setIgnoredArticles(articles);
  }
  const indexes = response.artists?.index ?? [];
  const artists = indexes.flatMap((idx) => idx.artist ?? []);
  return artists.map((a) =>
    isVariousArtists(a.name)
      ? { ...a, name: VARIOUS_ARTISTS_NAME, coverArt: VARIOUS_ARTISTS_COVER_ART_ID }
      : a,
  );
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
  if (isVariousArtists(artistName)) return [];
  const api = getApi();
  if (!api) return [];
  try {
    const response = await api.getTopSongs({ artist: artistName, count });
    return response.topSongs?.song ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch similar songs for a given song ID.
 * Returns an empty array if the server does not support this endpoint or returns no results.
 */
export async function getSimilarSongs(songId: string, count = 20): Promise<Child[]> {
  const api = getApi();
  if (!api) return [];
  try {
    const response = await api.getSimilarSongs({ id: songId, count });
    return response.similarSongs?.song ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch similar songs for a given artist ID (mix of similar artists).
 * Returns an empty array if the server does not support this endpoint or returns no results.
 */
export async function getSimilarSongs2(artistId: string, count = 20): Promise<Child[]> {
  const api = getApi();
  if (!api) return [];
  try {
    const response = await api.getSimilarSongs2({ id: artistId, count });
    return response.similarSongs2?.song ?? [];
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
 * Create a new playlist with the given name and initial songs.
 */
export async function createNewPlaylist(
  name: string,
  songIds: string[],
): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    await api.createPlaylist({ name, songId: songIds });
    return true;
  } catch {
    return false;
  }
}

/**
 * Add songs to an existing playlist by ID.
 */
export async function addToPlaylist(
  playlistId: string,
  songIds: string[],
): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    await api.updatePlaylist({ playlistId, songIdToAdd: songIds });
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

export async function changePassword(username: string, password: string): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    const response = await api.changePassword({ username, password });
    return response.status === 'ok';
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

    let adminRole: boolean | null = null;
    let shareRole: boolean | null = null;
    try {
      const username = authStore.getState().username;
      if (username) {
        const userResponse = await api.getUser({ username });
        if (userResponse.status === 'ok' && userResponse.user) {
          adminRole = userResponse.user.adminRole;
          shareRole = userResponse.user.shareRole;
        }
      }
    } catch {
      /* Server may not support getUser, or user may lack permission — roles stay null */
    }

    return {
      serverType,
      serverVersion,
      apiVersion,
      openSubsonic,
      extensions,
      lastFetchedAt: Date.now(),
      adminRole,
      shareRole,
      // `ignoredArticles` is populated separately by `getAllArtists` —
      // `getServerInfo` doesn't fetch it. Preserve any previously-set
      // value rather than wiping it on every `setServerInfo` call.
      ignoredArticles: serverInfoStore.getState().ignoredArticles,
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
/*  Rating                                                             */
/* ------------------------------------------------------------------ */

export async function setRating(id: string, rating: number): Promise<void> {
  const api = getApi();
  if (!api) return;
  await api.setRating({ id, rating });
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
/*  Genres                                                             */
/* ------------------------------------------------------------------ */

export async function getGenres(): Promise<Genre[] | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const response = await api.getGenres();
    return response.genres?.genre ?? [];
  } catch {
    return null;
  }
}

export async function getSongsByGenre(
  genre: string,
  count?: number,
  offset?: number,
): Promise<Child[] | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const args: { genre: string; count?: number; offset?: number } = { genre };
    if (count != null) args.count = count;
    if (offset != null) args.offset = offset;
    const response = await api.getSongsByGenre(args);
    return response.songsByGenre?.song ?? [];
  } catch {
    return null;
  }
}

export async function getRandomSongs(
  size?: number,
  genre?: string,
): Promise<Child[] | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const args: { size?: number; genre?: string } = {};
    if (size != null) args.size = size;
    if (genre != null) args.genre = genre;
    const response = await api.getRandomSongs(args);
    return response.randomSongs?.song ?? [];
  } catch {
    return null;
  }
}

export async function getRandomSongsFiltered(args: {
  size?: number;
  genre?: string;
  fromYear?: number;
  toYear?: number;
}): Promise<Child[] | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const params: { size?: number; genre?: string; fromYear?: number; toYear?: number } = {};
    if (args.size != null) params.size = args.size;
    if (args.genre != null) params.genre = args.genre;
    if (args.fromYear != null) params.fromYear = args.fromYear;
    if (args.toYear != null) params.toYear = args.toYear;
    const response = await api.getRandomSongs(params);
    return response.randomSongs?.song ?? [];
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Shares                                                             */
/* ------------------------------------------------------------------ */

export type GetSharesResult =
  | { ok: true; shares: Share[] }
  | { ok: false; reason: 'not-available' | 'error'; message: string };

export async function getShares(): Promise<GetSharesResult> {
  const api = getApi();
  if (!api) return { ok: false, reason: 'error', message: i18n.t('notConnectedToServer') };
  try {
    const response = await api.getShares();
    if (response.status === 'failed' || response.status === 'fail') {
      const err = (response as Record<string, unknown>).error as
        | { code?: number; message?: string }
        | undefined;
      return { ok: false, reason: 'not-available', message: err?.message ?? i18n.t('sharingNotAvailableOnServer') };
    }
    return { ok: true, shares: response.shares?.share ?? [] };
  } catch (e) {
    /* The server rejected the request (HTTP error, auth failure, etc.)
       rather than returning a Subsonic-level error response. Treat as
       not-available since we know the server is otherwise reachable. */
    const msg = e instanceof Error ? e.message : '';
    return { ok: false, reason: 'not-available', message: msg || i18n.t('sharingNotAvailableOnServer') };
  }
}

export async function createShare(
  id: string | string[],
  description?: string,
  expires?: number,
): Promise<Share | null> {
  const api = getApi();
  if (!api) return null;
  const ids = Array.isArray(id) ? id : [id];
  if (ids.length === 0) return null;
  try {
    const args: { id: string | string[]; description?: string; expires?: number } = { id: ids.length === 1 ? ids[0] : ids };
    if (description) args.description = description;
    if (expires != null) args.expires = expires;
    const response = await api.createShare(args);
    const shares = response.shares?.share ?? [];
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
