jest.mock('subsonic-api', () => ({
  __esModule: true,
  default: class {},
}));
jest.mock('expo-crypto', () => ({
  getRandomValues: jest.fn((arr: Uint8Array) => arr),
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(16)),
  digestStringAsync: jest.fn().mockResolvedValue('mocktoken'),
  CryptoDigestAlgorithm: { MD5: 'MD5' },
  CryptoEncoding: { HEX: 'hex' },
}));
jest.mock('../../store/authStore', () => ({
  authStore: { getState: jest.fn() },
}));
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: { getState: jest.fn(() => ({ offlineMode: false })) },
}));
jest.mock('../../store/playbackSettingsStore', () => ({
  playbackSettingsStore: { getState: jest.fn() },
  FORMAT_PRESETS: [
    { value: 'raw',      labelKey: 'formatOriginal',  highBitrate: null, lossless: true  },
    { value: 'mp3',      labelKey: 'formatMp3',       highBitrate: 320,  lossless: false },
    { value: 'aac',      labelKey: 'formatAac',       highBitrate: 320,  lossless: false },
    { value: 'opus',     labelKey: 'formatOpus',      highBitrate: 320,  lossless: false },
    { value: 'opus_rg',  labelKey: 'formatOpusRg',    highBitrate: 320,  lossless: false },
    { value: 'opus_car', labelKey: 'formatOpusCar',   highBitrate: 192,  lossless: false },
    { value: 'ogg',      labelKey: 'formatOggVorbis', highBitrate: 320,  lossless: false },
    { value: 'flac',     labelKey: 'formatFlac',      highBitrate: null, lossless: true  },
  ],
}));

import { authStore } from '../../store/authStore';
import { playbackSettingsStore } from '../../store/playbackSettingsStore';
import {
  clearApiCache,
  ensureCoverArtAuth,
  getCoverArtUrl,
  getDownloadStreamUrl,
  getStreamUrl,
  stripCoverArtSuffix,
} from '../subsonicService';

const mockAuthStore = authStore as jest.Mocked<typeof authStore>;
const mockPlaybackSettingsStore = playbackSettingsStore as jest.Mocked<typeof playbackSettingsStore>;

beforeEach(() => {
  clearApiCache();
  mockAuthStore.getState.mockReturnValue({
    isLoggedIn: true,
    serverUrl: 'https://music.example.com',
    username: 'user',
    password: 'pass',
    apiVersion: '1.16',
    rehydrated: true,
  } as any);
  mockPlaybackSettingsStore.getState.mockReturnValue({
    maxBitRate: null,
    streamFormat: 'raw' as const,
    estimateContentLength: false,
    downloadMaxBitRate: null,
    downloadFormat: 'raw' as const,
  } as any);
});

describe('stripCoverArtSuffix', () => {
  it('strips hex suffix', () => {
    expect(stripCoverArtSuffix('al-123_abc123')).toBe('al-123');
    expect(stripCoverArtSuffix('pl-456_def456')).toBe('pl-456');
  });

  it('is idempotent when no suffix', () => {
    expect(stripCoverArtSuffix('al-123')).toBe('al-123');
  });

  it('preserves when suffix is not hex', () => {
    expect(stripCoverArtSuffix('al-123_xyz')).toBe('al-123_xyz');
  });

  it('preserves when no underscore', () => {
    expect(stripCoverArtSuffix('al123')).toBe('al123');
  });

  it('handles empty string', () => {
    expect(stripCoverArtSuffix('')).toBe('');
  });

  it('handles underscore at start', () => {
    expect(stripCoverArtSuffix('_abc123')).toBe('_abc123');
  });

  it('strips only last underscore segment', () => {
    expect(stripCoverArtSuffix('al-123_extra_abc123')).toBe('al-123_extra');
  });
});

describe('getCoverArtUrl', () => {
  it('returns null when not logged in', async () => {
    mockAuthStore.getState.mockReturnValue({
      isLoggedIn: false,
      serverUrl: 'https://x.com',
      username: 'u',
    } as any);
    await ensureCoverArtAuth();
    expect(getCoverArtUrl('al-1')).toBeNull();
  });

  it('returns null for empty coverArtId', async () => {
    await ensureCoverArtAuth();
    expect(getCoverArtUrl('')).toBeNull();
  });

  it('returns null when ensureCoverArtAuth has not been called', () => {
    clearApiCache();
    expect(getCoverArtUrl('al-1')).toBeNull();
  });

  it('builds URL with stripped coverArtId', async () => {
    await ensureCoverArtAuth();
    const url = getCoverArtUrl('al-123_abc');
    expect(url).toContain('https://music.example.com/rest/getCoverArt.view');
    expect(url).toContain('id=al-123');
    expect(url).toContain('u=user');
  });

  it('includes size param when provided', async () => {
    await ensureCoverArtAuth();
    const url = getCoverArtUrl('al-1', 300);
    expect(url).toContain('size=300');
  });

  it('omits size param when not provided', async () => {
    await ensureCoverArtAuth();
    const url = getCoverArtUrl('al-1');
    expect(url).not.toContain('size=');
  });

  it('returns null when offline mode is on', async () => {
    await ensureCoverArtAuth();
    const { offlineModeStore } = require('../../store/offlineModeStore');
    offlineModeStore.getState.mockReturnValue({ offlineMode: true });
    try {
      expect(getCoverArtUrl('al-1')).toBeNull();
    } finally {
      offlineModeStore.getState.mockReturnValue({ offlineMode: false });
    }
  });
});

describe('getStreamUrl', () => {
  it('returns null when not logged in', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    await ensureCoverArtAuth();
    expect(getStreamUrl('track-1')).toBeNull();
  });

  it('returns null for empty trackId', async () => {
    await ensureCoverArtAuth();
    expect(getStreamUrl('')).toBeNull();
  });

  it('builds stream URL with playback settings', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      maxBitRate: 320,
      streamFormat: 'mp3' as const,
      estimateContentLength: true,
    } as any);
    const url = getStreamUrl('track-1');
    expect(url).toContain('https://music.example.com/rest/stream.view');
    expect(url).toContain('id=track-1');
    expect(url).toContain('maxBitRate=320');
    expect(url).toContain('format=mp3');
    expect(url).toContain('estimateContentLength=true');
  });

  it('omits format and bitrate when set to raw/null', async () => {
    await ensureCoverArtAuth();
    const url = getStreamUrl('track-1');
    expect(url).not.toContain('format=');
    expect(url).not.toContain('maxBitRate=');
    expect(url).not.toContain('estimateContentLength=');
  });

  it('includes timeOffset when provided', async () => {
    await ensureCoverArtAuth();
    const url = getStreamUrl('track-1', 120);
    expect(url).toContain('timeOffset=120');
  });

  it('omits timeOffset when zero', async () => {
    await ensureCoverArtAuth();
    const url = getStreamUrl('track-1', 0);
    expect(url).not.toContain('timeOffset');
  });

  it('returns null when offline mode is on', async () => {
    await ensureCoverArtAuth();
    const { offlineModeStore } = require('../../store/offlineModeStore');
    offlineModeStore.getState.mockReturnValue({ offlineMode: true });
    try {
      expect(getStreamUrl('track-1')).toBeNull();
    } finally {
      offlineModeStore.getState.mockReturnValue({ offlineMode: false });
    }
  });
});

describe('getDownloadStreamUrl', () => {
  it('returns null when not logged in', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    await ensureCoverArtAuth();
    expect(getDownloadStreamUrl('track-1')).toBeNull();
  });

  it('returns null for empty trackId', async () => {
    await ensureCoverArtAuth();
    expect(getDownloadStreamUrl('')).toBeNull();
  });

  it('builds download URL with estimateContentLength', async () => {
    await ensureCoverArtAuth();
    const url = getDownloadStreamUrl('track-1');
    expect(url).toContain('estimateContentLength=true');
  });

  it('includes download format when set', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      downloadMaxBitRate: 256,
      downloadFormat: 'mp3' as const,
    } as any);
    const url = getDownloadStreamUrl('track-1');
    expect(url).toContain('maxBitRate=256');
    expect(url).toContain('format=mp3');
  });

  it('omits format and bitrate when using raw defaults', async () => {
    await ensureCoverArtAuth();
    const url = getDownloadStreamUrl('track-1');
    expect(url).not.toContain('format=');
    expect(url).not.toContain('maxBitRate=');
  });
});

describe('format/bitrate URL building (FORMAT_PRESETS)', () => {
  it('mp3 with no explicit bitrate sends the HIGH default (320)', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      maxBitRate: null,
      streamFormat: 'mp3' as const,
      estimateContentLength: false,
    } as any);
    const url = getStreamUrl('track-1');
    expect(url).toContain('format=mp3');
    expect(url).toContain('maxBitRate=320');
  });

  it('mp3 with explicit bitrate honors the user choice', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      maxBitRate: 128,
      streamFormat: 'mp3' as const,
      estimateContentLength: false,
    } as any);
    const url = getStreamUrl('track-1');
    expect(url).toContain('format=mp3');
    expect(url).toContain('maxBitRate=128');
  });

  it('opus_car with no explicit bitrate sends 192 (lower HIGH default)', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      maxBitRate: null,
      streamFormat: 'opus_car' as const,
      estimateContentLength: false,
    } as any);
    const url = getStreamUrl('track-1');
    expect(url).toContain('format=opus_car');
    expect(url).toContain('maxBitRate=192');
  });

  it('flac never sends maxBitRate even when picker is set to a value', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      maxBitRate: 320,
      streamFormat: 'flac' as const,
      estimateContentLength: false,
    } as any);
    const url = getStreamUrl('track-1');
    expect(url).toContain('format=flac');
    expect(url).not.toContain('maxBitRate=');
  });

  it('raw never sends format= or maxBitRate= even when picker has a value', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      maxBitRate: 256,
      streamFormat: 'raw' as const,
      estimateContentLength: false,
    } as any);
    const url = getStreamUrl('track-1');
    expect(url).not.toContain('format=');
    expect(url).not.toContain('maxBitRate=');
  });

  it('arbitrary custom format passes through verbatim and uses 320 fallback', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      maxBitRate: null,
      streamFormat: 'opus_128_car' as const,
      estimateContentLength: false,
    } as any);
    const url = getStreamUrl('track-1');
    expect(url).toContain('format=opus_128_car');
    expect(url).toContain('maxBitRate=320');
  });

  it('download path: opus_car + null bitrate sends 192', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      downloadMaxBitRate: null,
      downloadFormat: 'opus_car' as const,
    } as any);
    const url = getDownloadStreamUrl('track-1');
    expect(url).toContain('format=opus_car');
    expect(url).toContain('maxBitRate=192');
  });

  it('download path: flac + 256 picker omits maxBitRate', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      downloadMaxBitRate: 256,
      downloadFormat: 'flac' as const,
    } as any);
    const url = getDownloadStreamUrl('track-1');
    expect(url).toContain('format=flac');
    expect(url).not.toContain('maxBitRate=');
  });

  it('download path: custom format + null bitrate uses 320 fallback', async () => {
    await ensureCoverArtAuth();
    mockPlaybackSettingsStore.getState.mockReturnValue({
      downloadMaxBitRate: null,
      downloadFormat: 'mp3_320_v0' as const,
    } as any);
    const url = getDownloadStreamUrl('track-1');
    expect(url).toContain('format=mp3_320_v0');
    expect(url).toContain('maxBitRate=320');
  });
});

describe('getApi', () => {
  it('returns null in offline mode', () => {
    const { offlineModeStore } = require('../../store/offlineModeStore');
    offlineModeStore.getState.mockReturnValue({ offlineMode: true });
    const { getApi } = require('../subsonicService');
    expect(getApi()).toBeNull();
    offlineModeStore.getState.mockReturnValue({ offlineMode: false });
  });

  it('returns null when not logged in', () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getApi } = require('../subsonicService');
    expect(getApi()).toBeNull();
  });

  it('returns null when serverUrl is missing', () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: true, serverUrl: null, username: 'u', password: 'p' } as any);
    const { getApi } = require('../subsonicService');
    expect(getApi()).toBeNull();
  });

  it('returns an API instance when logged in', () => {
    const { getApi } = require('../subsonicService');
    const api = getApi();
    expect(api).not.toBeNull();
  });

  it('returns cached instance on repeated calls with same credentials', () => {
    const { getApi } = require('../subsonicService');
    const api1 = getApi();
    const api2 = getApi();
    expect(api1).toBe(api2);
  });

  it('creates new instance when credentials change', () => {
    const { getApi } = require('../subsonicService');
    const api1 = getApi();
    clearApiCache();
    mockAuthStore.getState.mockReturnValue({
      isLoggedIn: true,
      serverUrl: 'https://other.example.com',
      username: 'user2',
      password: 'pass2',
      apiVersion: '1.16',
      rehydrated: true,
    } as any);
    const api2 = getApi();
    expect(api2).not.toBe(api1);
  });
});

describe('login', () => {
  const { default: SubsonicAPI } = require('subsonic-api');

  it('returns success with version on successful ping', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.0',
    });
    const { login } = require('../subsonicService');
    const result = await login('music.example.com', 'user', 'pass');
    expect(result).toEqual({ success: true, version: '1.16.0' });
  });

  it('adds https:// to bare hostname', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.0',
    });
    const { login } = require('../subsonicService');
    const result = await login('music.example.com', 'user', 'pass');
    expect(result.success).toBe(true);
  });

  it('returns error on failed ping', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'failed',
      error: { code: 40, message: 'Wrong username or password' },
    });
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com', 'user', 'wrong');
    expect(result).toEqual({ success: false, error: 'Wrong username or password' });
  });

  it('returns error on code 40 without message', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'failed',
      error: { code: 40 },
    });
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com', 'user', 'wrong');
    expect(result).toEqual({ success: false, error: 'Wrong username or password' });
  });

  it('returns generic error on unknown failure code', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'failed',
      error: { code: 99 },
    });
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com', 'user', 'pass');
    expect(result).toEqual({ success: false, error: 'Authentication failed' });
  });

  it('returns connection error on exception', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com', 'user', 'pass');
    expect(result).toEqual({ success: false, error: 'ECONNREFUSED' });
  });

  it('returns generic error on non-Error exception', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockRejectedValue('something');
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com', 'user', 'pass');
    expect(result).toEqual({ success: false, error: 'Connection failed' });
  });

  it('prefers serverVersion for OpenSubsonic servers', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.0',
      openSubsonic: true,
      serverVersion: '0.52.5',
    });
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com', 'user', 'pass');
    expect(result).toEqual({ success: true, version: '0.52.5' });
  });
});

describe('normalizeServerUrl (tested indirectly via login)', () => {
  const { default: SubsonicAPI } = require('subsonic-api');

  it('trims whitespace from URL', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.0',
    });
    const { login } = require('../subsonicService');
    const result = await login('  music.example.com  ', 'user', 'pass');
    expect(result.success).toBe(true);
  });

  it('strips trailing slashes', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.0',
    });
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com///', 'user', 'pass');
    expect(result.success).toBe(true);
  });

  it('preserves http:// prefix', async () => {
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.0',
    });
    const { login } = require('../subsonicService');
    const result = await login('http://music.local', 'user', 'pass');
    expect(result.success).toBe(true);
  });
});

describe('API wrapper functions', () => {
  it('getAlbum returns null when getApi returns null', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getAlbum } = require('../subsonicService');
    expect(await getAlbum('a1')).toBeNull();
  });

  it('getAlbum returns album on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbum = jest.fn().mockResolvedValue({
      album: { id: 'a1', name: 'Test Album' },
    });
    const { getAlbum, getApi } = require('../subsonicService');
    const api = getApi();
    expect(api).not.toBeNull();
    const result = await getAlbum('a1');
    expect(result).toEqual({ id: 'a1', name: 'Test Album' });
  });

  it('getAlbum returns null on API exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbum = jest.fn().mockRejectedValue(new Error('fail'));
    const { getAlbum, getApi } = require('../subsonicService');
    getApi();
    const result = await getAlbum('a1');
    expect(result).toBeNull();
  });

  it('getRecentlyAddedAlbums returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getRecentlyAddedAlbums } = require('../subsonicService');
    expect(await getRecentlyAddedAlbums()).toEqual([]);
  });

  it('getAllArtists returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getAllArtists } = require('../subsonicService');
    expect(await getAllArtists()).toEqual([]);
  });

  it('getAllPlaylists returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getAllPlaylists } = require('../subsonicService');
    expect(await getAllPlaylists()).toEqual([]);
  });

  it('getStarred2 returns empty lists when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getStarred2 } = require('../subsonicService');
    expect(await getStarred2()).toEqual({ albums: [], artists: [], songs: [] });
  });

  it('search3 returns empty results when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { search3 } = require('../subsonicService');
    expect(await search3('test')).toEqual({ albums: [], artists: [], songs: [] });
  });

  it('starSong calls api.star with correct params', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.star = jest.fn().mockResolvedValue(undefined);
    const { starSong, getApi } = require('../subsonicService');
    getApi();
    await starSong('s1');
    expect(SubsonicAPI.prototype.star).toHaveBeenCalledWith({ id: 's1' });
  });

  it('unstarSong calls api.unstar with correct params', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.unstar = jest.fn().mockResolvedValue(undefined);
    const { unstarSong, getApi } = require('../subsonicService');
    getApi();
    await unstarSong('s1');
    expect(SubsonicAPI.prototype.unstar).toHaveBeenCalledWith({ id: 's1' });
  });

  it('setRating calls api.setRating', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.setRating = jest.fn().mockResolvedValue(undefined);
    const { setRating, getApi } = require('../subsonicService');
    getApi();
    await setRating('s1', 4);
    expect(SubsonicAPI.prototype.setRating).toHaveBeenCalledWith({ id: 's1', rating: 4 });
  });

  it('deletePlaylist returns true on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.deletePlaylist = jest.fn().mockResolvedValue(undefined);
    const { deletePlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await deletePlaylist('p1');
    expect(result).toBe(true);
  });

  it('deletePlaylist returns false on failure', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.deletePlaylist = jest.fn().mockRejectedValue(new Error('fail'));
    const { deletePlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await deletePlaylist('p1');
    expect(result).toBe(false);
  });

  it('getScanStatus returns null when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getScanStatus } = require('../subsonicService');
    expect(await getScanStatus()).toBeNull();
  });

  it('getTopSongs returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getTopSongs } = require('../subsonicService');
    expect(await getTopSongs('Artist')).toEqual([]);
  });

  it('getTopSongs returns empty for Various Artists without calling API', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getTopSongs = jest.fn();
    const { getTopSongs } = require('../subsonicService');
    expect(await getTopSongs('Various Artists')).toEqual([]);
    expect(SubsonicAPI.prototype.getTopSongs).not.toHaveBeenCalled();
  });

  it('getTopSongs returns empty for case-variant Various Artists', async () => {
    const { getTopSongs } = require('../subsonicService');
    expect(await getTopSongs('various artists')).toEqual([]);
    expect(await getTopSongs('  Various Artists  ')).toEqual([]);
  });

  it('getAllArtists normalises Various Artists entries', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getArtists = jest.fn().mockResolvedValue({
      artists: {
        index: [
          {
            artist: [
              { id: 'ar-1', name: 'various artists', coverArt: 'ar-1_abc' },
              { id: 'ar-2', name: 'Radiohead', coverArt: 'ar-2_def' },
            ],
          },
        ],
      },
    });
    const { getAllArtists, getApi, VARIOUS_ARTISTS_NAME, VARIOUS_ARTISTS_COVER_ART_ID } = require('../subsonicService');
    getApi();
    const artists = await getAllArtists();
    expect(artists).toHaveLength(2);
    expect(artists[0].name).toBe(VARIOUS_ARTISTS_NAME);
    expect(artists[0].coverArt).toBe(VARIOUS_ARTISTS_COVER_ART_ID);
    expect(artists[0].id).toBe('ar-1');
    expect(artists[1].name).toBe('Radiohead');
    expect(artists[1].coverArt).toBe('ar-2_def');
  });
});

describe('isVariousArtists', () => {
  it('matches exact name', () => {
    const { isVariousArtists } = require('../subsonicService');
    expect(isVariousArtists('Various Artists')).toBe(true);
  });

  it('matches case-insensitively', () => {
    const { isVariousArtists } = require('../subsonicService');
    expect(isVariousArtists('various artists')).toBe(true);
    expect(isVariousArtists('VARIOUS ARTISTS')).toBe(true);
  });

  it('trims whitespace', () => {
    const { isVariousArtists } = require('../subsonicService');
    expect(isVariousArtists('  Various Artists  ')).toBe(true);
  });

  it('rejects other names', () => {
    const { isVariousArtists } = require('../subsonicService');
    expect(isVariousArtists('Radiohead')).toBe(false);
    expect(isVariousArtists('Various')).toBe(false);
    expect(isVariousArtists('')).toBe(false);
  });

  it('handles undefined', () => {
    const { isVariousArtists } = require('../subsonicService');
    expect(isVariousArtists(undefined)).toBe(false);
  });
});

describe('getRecentlyPlayedAlbums', () => {
  it('returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getRecentlyPlayedAlbums } = require('../subsonicService');
    expect(await getRecentlyPlayedAlbums()).toEqual([]);
  });

  it('returns albums on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbumList2 = jest.fn().mockResolvedValue({
      albumList2: { album: [{ id: 'a1', name: 'Recent' }] },
    });
    const { getRecentlyPlayedAlbums, getApi } = require('../subsonicService');
    getApi();
    const result = await getRecentlyPlayedAlbums();
    expect(result).toEqual([{ id: 'a1', name: 'Recent' }]);
    expect(SubsonicAPI.prototype.getAlbumList2).toHaveBeenCalledWith({ type: 'recent', size: 20 });
  });
});

describe('getFrequentlyPlayedAlbums', () => {
  it('returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getFrequentlyPlayedAlbums } = require('../subsonicService');
    expect(await getFrequentlyPlayedAlbums()).toEqual([]);
  });

  it('returns albums on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbumList2 = jest.fn().mockResolvedValue({
      albumList2: { album: [{ id: 'a2', name: 'Frequent' }] },
    });
    const { getFrequentlyPlayedAlbums, getApi } = require('../subsonicService');
    getApi();
    const result = await getFrequentlyPlayedAlbums();
    expect(result).toEqual([{ id: 'a2', name: 'Frequent' }]);
    expect(SubsonicAPI.prototype.getAlbumList2).toHaveBeenCalledWith({ type: 'frequent', size: 20 });
  });
});

describe('getRandomAlbums', () => {
  it('returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getRandomAlbums } = require('../subsonicService');
    expect(await getRandomAlbums()).toEqual([]);
  });

  it('returns albums on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbumList2 = jest.fn().mockResolvedValue({
      albumList2: { album: [{ id: 'a3', name: 'Random' }] },
    });
    const { getRandomAlbums, getApi } = require('../subsonicService');
    getApi();
    const result = await getRandomAlbums();
    expect(result).toEqual([{ id: 'a3', name: 'Random' }]);
    expect(SubsonicAPI.prototype.getAlbumList2).toHaveBeenCalledWith({ type: 'random', size: 20 });
  });
});

describe('searchAllAlbums', () => {
  it('returns albums on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.search3 = jest.fn().mockResolvedValue({
      searchResult3: { album: [{ id: 'a1' }, { id: 'a2' }] },
    });
    const { searchAllAlbums, getApi } = require('../subsonicService');
    getApi();
    const result = await searchAllAlbums();
    expect(result).toEqual([{ id: 'a1' }, { id: 'a2' }]);
  });

  it('returns empty when search result has no albums', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.search3 = jest.fn().mockResolvedValue({
      searchResult3: {},
    });
    const { searchAllAlbums, getApi } = require('../subsonicService');
    getApi();
    const result = await searchAllAlbums();
    expect(result).toEqual([]);
  });
});

describe('getAlbumListAlphabetical', () => {
  it('returns albums on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbumList2 = jest.fn().mockResolvedValue({
      albumList2: { album: [{ id: 'a1' }] },
    });
    const { getAlbumListAlphabetical, getApi } = require('../subsonicService');
    getApi();
    const result = await getAlbumListAlphabetical(500, 0);
    expect(result).toEqual([{ id: 'a1' }]);
    expect(SubsonicAPI.prototype.getAlbumList2).toHaveBeenCalledWith({
      type: 'alphabeticalByArtist',
      size: 500,
      offset: 0,
    });
  });
});

describe('getAllAlbumsAlphabetical', () => {
  it('paginates until a short page is returned', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    const page1 = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` }));
    const page2 = [{ id: 'a500' }, { id: 'a501' }];
    SubsonicAPI.prototype.getAlbumList2 = jest.fn()
      .mockResolvedValueOnce({ albumList2: { album: page1 } })
      .mockResolvedValueOnce({ albumList2: { album: page2 } });
    const { getAllAlbumsAlphabetical, getApi } = require('../subsonicService');
    getApi();
    const result = await getAllAlbumsAlphabetical();
    expect(result).toHaveLength(502);
    expect(SubsonicAPI.prototype.getAlbumList2).toHaveBeenCalledTimes(2);
  });

  it('returns single page when fewer than PAGE_SIZE results', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbumList2 = jest.fn().mockResolvedValue({
      albumList2: { album: [{ id: 'a1' }] },
    });
    const { getAllAlbumsAlphabetical, getApi } = require('../subsonicService');
    getApi();
    const result = await getAllAlbumsAlphabetical();
    expect(result).toEqual([{ id: 'a1' }]);
    expect(SubsonicAPI.prototype.getAlbumList2).toHaveBeenCalledTimes(1);
  });
});

describe('getArtist', () => {
  it('returns null when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getArtist } = require('../subsonicService');
    expect(await getArtist('ar1')).toBeNull();
  });

  it('returns artist on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getArtist = jest.fn().mockResolvedValue({
      artist: { id: 'ar1', name: 'Radiohead', album: [] },
    });
    const { getArtist, getApi } = require('../subsonicService');
    getApi();
    const result = await getArtist('ar1');
    expect(result).toEqual({ id: 'ar1', name: 'Radiohead', album: [] });
  });
});

describe('getArtistInfo2', () => {
  it('returns artist info on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getArtistInfo2 = jest.fn().mockResolvedValue({
      artistInfo2: { biography: 'Bio text', similarArtist: [] },
    });
    const { getArtistInfo2, getApi } = require('../subsonicService');
    getApi();
    const result = await getArtistInfo2('ar1');
    expect(result).toEqual({ biography: 'Bio text', similarArtist: [] });
  });

  it('returns null on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getArtistInfo2 = jest.fn().mockRejectedValue(new Error('unsupported'));
    const { getArtistInfo2, getApi } = require('../subsonicService');
    getApi();
    const result = await getArtistInfo2('ar1');
    expect(result).toBeNull();
  });
});

describe('getSimilarSongs', () => {
  it('returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getSimilarSongs } = require('../subsonicService');
    expect(await getSimilarSongs('s1')).toEqual([]);
  });

  it('returns songs on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getSimilarSongs = jest.fn().mockResolvedValue({
      similarSongs: { song: [{ id: 's2', title: 'Similar' }] },
    });
    const { getSimilarSongs, getApi } = require('../subsonicService');
    getApi();
    const result = await getSimilarSongs('s1');
    expect(result).toEqual([{ id: 's2', title: 'Similar' }]);
  });
});

describe('getSimilarSongs2', () => {
  it('returns empty when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getSimilarSongs2 } = require('../subsonicService');
    expect(await getSimilarSongs2('ar1')).toEqual([]);
  });

  it('returns songs on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getSimilarSongs2 = jest.fn().mockResolvedValue({
      similarSongs2: { song: [{ id: 's3', title: 'Similar2' }] },
    });
    const { getSimilarSongs2, getApi } = require('../subsonicService');
    getApi();
    const result = await getSimilarSongs2('ar1');
    expect(result).toEqual([{ id: 's3', title: 'Similar2' }]);
  });
});

describe('getPlaylist', () => {
  it('returns null when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getPlaylist } = require('../subsonicService');
    expect(await getPlaylist('p1')).toBeNull();
  });

  it('returns playlist on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getPlaylist = jest.fn().mockResolvedValue({
      playlist: { id: 'p1', name: 'My Playlist', entry: [] },
    });
    const { getPlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await getPlaylist('p1');
    expect(result).toEqual({ id: 'p1', name: 'My Playlist', entry: [] });
  });
});

describe('updatePlaylistOrder', () => {
  it('returns true on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createPlaylist = jest.fn().mockResolvedValue(undefined);
    const { updatePlaylistOrder, getApi } = require('../subsonicService');
    getApi();
    const result = await updatePlaylistOrder('p1', 'My Playlist', ['s1', 's2']);
    expect(result).toBe(true);
    expect(SubsonicAPI.prototype.createPlaylist).toHaveBeenCalledWith({
      playlistId: 'p1',
      name: 'My Playlist',
      songId: ['s1', 's2'],
    });
  });

  it('returns false on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createPlaylist = jest.fn().mockRejectedValue(new Error('fail'));
    const { updatePlaylistOrder, getApi } = require('../subsonicService');
    getApi();
    const result = await updatePlaylistOrder('p1', 'My Playlist', ['s1']);
    expect(result).toBe(false);
  });
});

describe('createNewPlaylist', () => {
  it('returns true on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createPlaylist = jest.fn().mockResolvedValue(undefined);
    const { createNewPlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await createNewPlaylist('New Playlist', ['s1']);
    expect(result).toBe(true);
    expect(SubsonicAPI.prototype.createPlaylist).toHaveBeenCalledWith({
      name: 'New Playlist',
      songId: ['s1'],
    });
  });

  it('returns false on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createPlaylist = jest.fn().mockRejectedValue(new Error('fail'));
    const { createNewPlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await createNewPlaylist('New Playlist', ['s1']);
    expect(result).toBe(false);
  });
});

describe('addToPlaylist', () => {
  it('returns true on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.updatePlaylist = jest.fn().mockResolvedValue(undefined);
    const { addToPlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await addToPlaylist('p1', ['s1', 's2']);
    expect(result).toBe(true);
    expect(SubsonicAPI.prototype.updatePlaylist).toHaveBeenCalledWith({
      playlistId: 'p1',
      songIdToAdd: ['s1', 's2'],
    });
  });

  it('returns false on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.updatePlaylist = jest.fn().mockRejectedValue(new Error('fail'));
    const { addToPlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await addToPlaylist('p1', ['s1']);
    expect(result).toBe(false);
  });
});

describe('removeFromPlaylist', () => {
  it('returns true on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.updatePlaylist = jest.fn().mockResolvedValue(undefined);
    const { removeFromPlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await removeFromPlaylist('p1', [0, 2]);
    expect(result).toBe(true);
    expect(SubsonicAPI.prototype.updatePlaylist).toHaveBeenCalledWith({
      playlistId: 'p1',
      songIndexToRemove: [0, 2],
    });
  });

  it('returns false on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.updatePlaylist = jest.fn().mockRejectedValue(new Error('fail'));
    const { removeFromPlaylist, getApi } = require('../subsonicService');
    getApi();
    const result = await removeFromPlaylist('p1', [0]);
    expect(result).toBe(false);
  });
});

describe('starAlbum / unstarAlbum', () => {
  it('starAlbum calls api.star with albumId', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.star = jest.fn().mockResolvedValue(undefined);
    const { starAlbum, getApi } = require('../subsonicService');
    getApi();
    await starAlbum('a1');
    expect(SubsonicAPI.prototype.star).toHaveBeenCalledWith({ albumId: 'a1' });
  });

  it('starAlbum does nothing when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.star = jest.fn();
    const { starAlbum } = require('../subsonicService');
    await starAlbum('a1');
    expect(SubsonicAPI.prototype.star).not.toHaveBeenCalled();
  });

  it('unstarAlbum calls api.unstar with albumId', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.unstar = jest.fn().mockResolvedValue(undefined);
    const { unstarAlbum, getApi } = require('../subsonicService');
    getApi();
    await unstarAlbum('a1');
    expect(SubsonicAPI.prototype.unstar).toHaveBeenCalledWith({ albumId: 'a1' });
  });

  it('unstarAlbum does nothing when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.unstar = jest.fn();
    const { unstarAlbum } = require('../subsonicService');
    await unstarAlbum('a1');
    expect(SubsonicAPI.prototype.unstar).not.toHaveBeenCalled();
  });
});

describe('starArtist / unstarArtist', () => {
  it('starArtist calls api.star with artistId', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.star = jest.fn().mockResolvedValue(undefined);
    const { starArtist, getApi } = require('../subsonicService');
    getApi();
    await starArtist('ar1');
    expect(SubsonicAPI.prototype.star).toHaveBeenCalledWith({ artistId: 'ar1' });
  });

  it('starArtist does nothing when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.star = jest.fn();
    const { starArtist } = require('../subsonicService');
    await starArtist('ar1');
    expect(SubsonicAPI.prototype.star).not.toHaveBeenCalled();
  });

  it('unstarArtist calls api.unstar with artistId', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.unstar = jest.fn().mockResolvedValue(undefined);
    const { unstarArtist, getApi } = require('../subsonicService');
    getApi();
    await unstarArtist('ar1');
    expect(SubsonicAPI.prototype.unstar).toHaveBeenCalledWith({ artistId: 'ar1' });
  });

  it('unstarArtist does nothing when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.unstar = jest.fn();
    const { unstarArtist } = require('../subsonicService');
    await unstarArtist('ar1');
    expect(SubsonicAPI.prototype.unstar).not.toHaveBeenCalled();
  });
});

describe('fetchServerInfo', () => {
  it('returns full server info for OpenSubsonic server', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.1',
      openSubsonic: true,
      type: 'navidrome',
      serverVersion: '0.52.5',
    });
    SubsonicAPI.prototype.getOpenSubsonicExtensions = jest.fn().mockResolvedValue({
      status: 'ok',
      openSubsonicExtensions: [
        { name: 'transcoding', versions: [1, 2] },
      ],
    });
    const { fetchServerInfo, getApi } = require('../subsonicService');
    getApi();
    const result = await fetchServerInfo();
    expect(result).not.toBeNull();
    expect(result.serverType).toBe('navidrome');
    expect(result.serverVersion).toBe('0.52.5');
    expect(result.apiVersion).toBe('1.16.1');
    expect(result.openSubsonic).toBe(true);
    expect(result.extensions).toEqual([{ name: 'transcoding', versions: [1, 2] }]);
  });

  it('handles extensions endpoint failure gracefully', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.1',
      openSubsonic: true,
      type: 'navidrome',
      serverVersion: '0.52.5',
    });
    SubsonicAPI.prototype.getOpenSubsonicExtensions = jest.fn().mockRejectedValue(new Error('unsupported'));
    const { fetchServerInfo, getApi } = require('../subsonicService');
    getApi();
    const result = await fetchServerInfo();
    expect(result).not.toBeNull();
    expect(result.openSubsonic).toBe(true);
    expect(result.extensions).toEqual([]);
  });

  it('returns null when ping fails', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({ status: 'failed' });
    const { fetchServerInfo, getApi } = require('../subsonicService');
    getApi();
    const result = await fetchServerInfo();
    expect(result).toBeNull();
  });

  it('returns null on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockRejectedValue(new Error('network'));
    const { fetchServerInfo, getApi } = require('../subsonicService');
    getApi();
    const result = await fetchServerInfo();
    expect(result).toBeNull();
  });
});

describe('fetchServerInfo user roles', () => {
  it('includes adminRole and shareRole from getUser', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.1',
      openSubsonic: true,
      type: 'navidrome',
      serverVersion: '0.52.5',
    });
    SubsonicAPI.prototype.getOpenSubsonicExtensions = jest.fn().mockResolvedValue({
      status: 'ok',
      openSubsonicExtensions: [],
    });
    SubsonicAPI.prototype.getUser = jest.fn().mockResolvedValue({
      status: 'ok',
      user: { adminRole: true, shareRole: false },
    });
    const { fetchServerInfo, getApi } = require('../subsonicService');
    getApi();
    const result = await fetchServerInfo();
    expect(result).not.toBeNull();
    expect(result.adminRole).toBe(true);
    expect(result.shareRole).toBe(false);
    expect(SubsonicAPI.prototype.getUser).toHaveBeenCalledWith({ username: 'user' });
  });

  it('returns null roles when getUser throws', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.1',
      openSubsonic: true,
      type: 'navidrome',
      serverVersion: '0.52.5',
    });
    SubsonicAPI.prototype.getOpenSubsonicExtensions = jest.fn().mockResolvedValue({
      status: 'ok',
      openSubsonicExtensions: [],
    });
    SubsonicAPI.prototype.getUser = jest.fn().mockRejectedValue(new Error('unsupported'));
    const { fetchServerInfo, getApi } = require('../subsonicService');
    getApi();
    const result = await fetchServerInfo();
    expect(result).not.toBeNull();
    expect(result.adminRole).toBeNull();
    expect(result.shareRole).toBeNull();
    expect(result.serverType).toBe('navidrome');
  });

  it('returns null roles for non-OpenSubsonic server without getUser', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.1',
    });
    SubsonicAPI.prototype.getUser = jest.fn().mockRejectedValue(new Error('not supported'));
    const { fetchServerInfo, getApi } = require('../subsonicService');
    getApi();
    const result = await fetchServerInfo();
    expect(result).not.toBeNull();
    expect(result.adminRole).toBeNull();
    expect(result.shareRole).toBeNull();
    expect(result.openSubsonic).toBe(false);
  });
});

describe('changePassword', () => {
  it('returns true on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.changePassword = jest.fn().mockResolvedValue({ status: 'ok' });
    const { changePassword, getApi } = require('../subsonicService');
    getApi();
    const result = await changePassword('user', 'newpass');
    expect(result).toBe(true);
    expect(SubsonicAPI.prototype.changePassword).toHaveBeenCalledWith({ username: 'user', password: 'newpass' });
  });

  it('returns false on API error', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.changePassword = jest.fn().mockResolvedValue({ status: 'failed' });
    const { changePassword, getApi } = require('../subsonicService');
    getApi();
    expect(await changePassword('user', 'newpass')).toBe(false);
  });

  it('returns false on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.changePassword = jest.fn().mockRejectedValue(new Error('not supported'));
    const { changePassword, getApi } = require('../subsonicService');
    getApi();
    expect(await changePassword('user', 'newpass')).toBe(false);
  });

  it('returns false when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { changePassword } = require('../subsonicService');
    expect(await changePassword('user', 'newpass')).toBe(false);
  });
});

describe('startScan', () => {
  it('returns scan status on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.startScan = jest.fn().mockResolvedValue({
      scanStatus: { scanning: true, count: 42 },
    });
    const { startScan, getApi } = require('../subsonicService');
    getApi();
    const result = await startScan();
    expect(result).toEqual({ scanning: true, count: 42, lastScan: null, folderCount: null });
    expect(SubsonicAPI.prototype.startScan).toHaveBeenCalledWith(undefined);
  });

  it('passes fullScan param', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.startScan = jest.fn().mockResolvedValue({
      scanStatus: { scanning: true, count: 0 },
    });
    const { startScan, getApi } = require('../subsonicService');
    getApi();
    await startScan(true);
    expect(SubsonicAPI.prototype.startScan).toHaveBeenCalledWith({ fullScan: true });
  });

  it('returns null when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { startScan } = require('../subsonicService');
    expect(await startScan()).toBeNull();
  });

  it('returns null on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.startScan = jest.fn().mockRejectedValue(new Error('fail'));
    const { startScan, getApi } = require('../subsonicService');
    getApi();
    expect(await startScan()).toBeNull();
  });
});

describe('getShares', () => {
  it('returns shares on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getShares = jest.fn().mockResolvedValue({
      status: 'ok',
      shares: { share: [{ id: 'sh1', url: 'https://example.com/share/sh1' }] },
    });
    const { getShares, getApi } = require('../subsonicService');
    getApi();
    const result = await getShares();
    expect(result).toEqual({ ok: true, shares: [{ id: 'sh1', url: 'https://example.com/share/sh1' }] });
  });

  it('returns error result when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getShares } = require('../subsonicService');
    const result = await getShares();
    expect(result).toEqual({ ok: false, reason: 'error', message: 'Not connected to a server.' });
  });

  it('returns not-available when server responds with fail status', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getShares = jest.fn().mockResolvedValue({
      status: 'failed',
      error: { code: 50, message: 'Permission denied.' },
    });
    const { getShares, getApi } = require('../subsonicService');
    getApi();
    const result = await getShares();
    expect(result).toEqual({ ok: false, reason: 'not-available', message: 'Permission denied.' });
  });

  it('returns empty shares when server has none', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getShares = jest.fn().mockResolvedValue({
      status: 'ok',
      shares: {},
    });
    const { getShares, getApi } = require('../subsonicService');
    getApi();
    const result = await getShares();
    expect(result).toEqual({ ok: true, shares: [] });
  });
});

describe('createShare', () => {
  it('returns share on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createShare = jest.fn().mockResolvedValue({
      shares: { share: [{ id: 'sh1', url: 'https://example.com/share/sh1' }] },
    });
    const { createShare, getApi } = require('../subsonicService');
    getApi();
    const result = await createShare('s1', 'desc', 1234);
    expect(result).toEqual({ id: 'sh1', url: 'https://example.com/share/sh1' });
  });

  it('returns null on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createShare = jest.fn().mockRejectedValue(new Error('fail'));
    const { createShare, getApi } = require('../subsonicService');
    getApi();
    const result = await createShare('s1');
    expect(result).toBeNull();
  });
});

describe('createShare with array of IDs', () => {
  it('passes array to library for multiple IDs', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createShare = jest.fn().mockResolvedValue({
      shares: { share: [{ id: 'sh2' }] },
    });
    const { createShare, getApi } = require('../subsonicService');
    getApi();
    const result = await createShare(['s1', 's2'], 'desc', 9999);
    expect(result).toEqual({ id: 'sh2' });
    expect(SubsonicAPI.prototype.createShare).toHaveBeenCalledWith(
      expect.objectContaining({ id: ['s1', 's2'] }),
    );
  });

  it('unwraps single-element array to string', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createShare = jest.fn().mockResolvedValue({
      shares: { share: [{ id: 'sh1' }] },
    });
    const { createShare, getApi } = require('../subsonicService');
    getApi();
    const result = await createShare(['s1'], 'desc');
    expect(result).toEqual({ id: 'sh1' });
    expect(SubsonicAPI.prototype.createShare).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
    );
  });

  it('returns null for empty array', async () => {
    const { createShare } = require('../subsonicService');
    const result = await createShare([]);
    expect(result).toBeNull();
  });

  it('returns null on exception for multiple IDs', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.createShare = jest.fn().mockRejectedValue(new Error('fail'));
    const { createShare, getApi } = require('../subsonicService');
    getApi();
    const result = await createShare(['s1', 's2']);
    expect(result).toBeNull();
  });
});

describe('updateShare', () => {
  it('returns true on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.updateShare = jest.fn().mockResolvedValue(undefined);
    const { updateShare, getApi } = require('../subsonicService');
    getApi();
    const result = await updateShare('sh1', 'new desc', 5000);
    expect(result).toBe(true);
  });

  it('returns false on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.updateShare = jest.fn().mockRejectedValue(new Error('fail'));
    const { updateShare, getApi } = require('../subsonicService');
    getApi();
    const result = await updateShare('sh1');
    expect(result).toBe(false);
  });
});

describe('deleteShare', () => {
  it('returns true on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.deleteShare = jest.fn().mockResolvedValue(undefined);
    const { deleteShare, getApi } = require('../subsonicService');
    getApi();
    const result = await deleteShare('sh1');
    expect(result).toBe(true);
  });

  it('returns false on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.deleteShare = jest.fn().mockRejectedValue(new Error('fail'));
    const { deleteShare, getApi } = require('../subsonicService');
    getApi();
    const result = await deleteShare('sh1');
    expect(result).toBe(false);
  });
});

describe('getRecentlyAddedAlbums (success path)', () => {
  it('returns albums from API response', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbumList2 = jest.fn().mockResolvedValue({
      albumList2: { album: [{ id: 'a1', name: 'New Album' }] },
    });
    const { getRecentlyAddedAlbums, getApi } = require('../subsonicService');
    getApi();
    const result = await getRecentlyAddedAlbums(10);
    expect(result).toEqual([{ id: 'a1', name: 'New Album' }]);
    expect(SubsonicAPI.prototype.getAlbumList2).toHaveBeenCalledWith({ type: 'newest', size: 10 });
  });

  it('returns empty array when albumList2 is missing', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getAlbumList2 = jest.fn().mockResolvedValue({});
    const { getRecentlyAddedAlbums, getApi } = require('../subsonicService');
    getApi();
    const result = await getRecentlyAddedAlbums();
    expect(result).toEqual([]);
  });
});

describe('getTopSongs (success and error paths)', () => {
  it('returns songs on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getTopSongs = jest.fn().mockResolvedValue({
      topSongs: { song: [{ id: 's1', title: 'Hit' }] },
    });
    const { getTopSongs, getApi } = require('../subsonicService');
    getApi();
    const result = await getTopSongs('Radiohead');
    expect(result).toEqual([{ id: 's1', title: 'Hit' }]);
  });

  it('returns empty array when topSongs is missing', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getTopSongs = jest.fn().mockResolvedValue({});
    const { getTopSongs, getApi } = require('../subsonicService');
    getApi();
    const result = await getTopSongs('Radiohead');
    expect(result).toEqual([]);
  });

  it('returns empty array on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getTopSongs = jest.fn().mockRejectedValue(new Error('fail'));
    const { getTopSongs, getApi } = require('../subsonicService');
    getApi();
    const result = await getTopSongs('Radiohead');
    expect(result).toEqual([]);
  });
});

describe('getSimilarSongs (catch path)', () => {
  it('returns empty array on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getSimilarSongs = jest.fn().mockRejectedValue(new Error('fail'));
    const { getSimilarSongs, getApi } = require('../subsonicService');
    getApi();
    const result = await getSimilarSongs('s1');
    expect(result).toEqual([]);
  });
});

describe('getSimilarSongs2 (catch path)', () => {
  it('returns empty array on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getSimilarSongs2 = jest.fn().mockRejectedValue(new Error('fail'));
    const { getSimilarSongs2, getApi } = require('../subsonicService');
    getApi();
    const result = await getSimilarSongs2('ar1');
    expect(result).toEqual([]);
  });
});

describe('getAllPlaylists (success path)', () => {
  it('returns playlists from API response', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getPlaylists = jest.fn().mockResolvedValue({
      playlists: { playlist: [{ id: 'p1', name: 'My Playlist' }] },
    });
    const { getAllPlaylists, getApi } = require('../subsonicService');
    getApi();
    const result = await getAllPlaylists();
    expect(result).toEqual([{ id: 'p1', name: 'My Playlist' }]);
  });

  it('returns empty array when playlists is missing', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getPlaylists = jest.fn().mockResolvedValue({});
    const { getAllPlaylists, getApi } = require('../subsonicService');
    getApi();
    const result = await getAllPlaylists();
    expect(result).toEqual([]);
  });
});

describe('getStarred2 (success path)', () => {
  it('returns starred items from API response', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getStarred2 = jest.fn().mockResolvedValue({
      starred2: {
        album: [{ id: 'a1' }],
        artist: [{ id: 'ar1' }],
        song: [{ id: 's1' }],
      },
    });
    const { getStarred2, getApi } = require('../subsonicService');
    getApi();
    const result = await getStarred2();
    expect(result).toEqual({
      albums: [{ id: 'a1' }],
      artists: [{ id: 'ar1' }],
      songs: [{ id: 's1' }],
    });
  });

  it('returns empty arrays when starred2 is missing', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getStarred2 = jest.fn().mockResolvedValue({});
    const { getStarred2, getApi } = require('../subsonicService');
    getApi();
    const result = await getStarred2();
    expect(result).toEqual({ albums: [], artists: [], songs: [] });
  });
});

describe('search3 (success path)', () => {
  it('returns search results from API response', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.search3 = jest.fn().mockResolvedValue({
      searchResult3: {
        album: [{ id: 'a1' }],
        artist: [{ id: 'ar1' }],
        song: [{ id: 's1' }],
      },
    });
    const { search3, getApi } = require('../subsonicService');
    getApi();
    const result = await search3('test query');
    expect(result).toEqual({
      albums: [{ id: 'a1' }],
      artists: [{ id: 'ar1' }],
      songs: [{ id: 's1' }],
    });
  });

  it('returns empty results for whitespace-only query', async () => {
    const { search3 } = require('../subsonicService');
    const result = await search3('   ');
    expect(result).toEqual({ albums: [], artists: [], songs: [] });
  });

  it('returns empty arrays when searchResult3 is missing', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.search3 = jest.fn().mockResolvedValue({});
    const { search3, getApi } = require('../subsonicService');
    getApi();
    const result = await search3('test');
    expect(result).toEqual({ albums: [], artists: [], songs: [] });
  });
});

describe('getScanStatus (success path)', () => {
  it('returns scan status from API response', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getScanStatus = jest.fn().mockResolvedValue({
      scanStatus: { scanning: false, count: 1234 },
      lastScan: 1700000000000,
      folderCount: 5,
    });
    const { getScanStatus, getApi } = require('../subsonicService');
    getApi();
    const result = await getScanStatus();
    expect(result).toEqual({
      scanning: false,
      count: 1234,
      lastScan: 1700000000000,
      folderCount: 5,
    });
  });

  it('defaults count to 0 and optional fields to null', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getScanStatus = jest.fn().mockResolvedValue({
      scanStatus: { scanning: true },
    });
    const { getScanStatus, getApi } = require('../subsonicService');
    getApi();
    const result = await getScanStatus();
    expect(result).toEqual({
      scanning: true,
      count: 0,
      lastScan: null,
      folderCount: null,
    });
  });

  it('returns null on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getScanStatus = jest.fn().mockRejectedValue(new Error('fail'));
    const { getScanStatus, getApi } = require('../subsonicService');
    getApi();
    const result = await getScanStatus();
    expect(result).toBeNull();
  });
});

describe('getShares (catch path)', () => {
  it('returns not-available with error message on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getShares = jest.fn().mockRejectedValue(new Error('Forbidden'));
    const { getShares, getApi } = require('../subsonicService');
    getApi();
    const result = await getShares();
    expect(result).toEqual({ ok: false, reason: 'not-available', message: 'Forbidden' });
  });

  it('returns not-available with default message on non-Error throw', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getShares = jest.fn().mockRejectedValue('unknown');
    const { getShares, getApi } = require('../subsonicService');
    getApi();
    const result = await getShares();
    expect(result).toEqual({ ok: false, reason: 'not-available', message: 'Sharing is not available on this server.' });
  });
});

describe('createShare with array (edge cases)', () => {
  it('returns null when not logged in for array input', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { createShare } = require('../subsonicService');
    const result = await createShare(['s1', 's2']);
    expect(result).toBeNull();
  });
});

describe('fetchServerInfo (non-OpenSubsonic server)', () => {
  it('returns info without extensions for standard Subsonic server', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.1',
    });
    const { fetchServerInfo, getApi } = require('../subsonicService');
    getApi();
    const result = await fetchServerInfo();
    expect(result).not.toBeNull();
    expect(result.openSubsonic).toBe(false);
    expect(result.serverType).toBeNull();
    expect(result.serverVersion).toBeNull();
    expect(result.extensions).toEqual([]);
  });
});

describe('getGenres', () => {
  it('returns null when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getGenres } = require('../subsonicService');
    expect(await getGenres()).toBeNull();
  });

  it('returns genres on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getGenres = jest.fn().mockResolvedValue({
      genres: { genre: [{ value: 'Rock', albumCount: 10, songCount: 100 }] },
    });
    const { getGenres, getApi } = require('../subsonicService');
    getApi();
    const result = await getGenres();
    expect(result).toEqual([{ value: 'Rock', albumCount: 10, songCount: 100 }]);
  });

  it('returns empty array when genres is missing', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getGenres = jest.fn().mockResolvedValue({});
    const { getGenres, getApi } = require('../subsonicService');
    getApi();
    const result = await getGenres();
    expect(result).toEqual([]);
  });

  it('returns null on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getGenres = jest.fn().mockRejectedValue(new Error('fail'));
    const { getGenres, getApi } = require('../subsonicService');
    getApi();
    const result = await getGenres();
    expect(result).toBeNull();
  });
});

describe('getSongsByGenre', () => {
  it('returns null when no API', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const { getSongsByGenre } = require('../subsonicService');
    expect(await getSongsByGenre('Rock')).toBeNull();
  });

  it('returns songs on success', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getSongsByGenre = jest.fn().mockResolvedValue({
      songsByGenre: { song: [{ id: 's1', title: 'Rock Song' }] },
    });
    const { getSongsByGenre, getApi } = require('../subsonicService');
    getApi();
    const result = await getSongsByGenre('Rock', 50, 0);
    expect(result).toEqual([{ id: 's1', title: 'Rock Song' }]);
    expect(SubsonicAPI.prototype.getSongsByGenre).toHaveBeenCalledWith({
      genre: 'Rock',
      count: 50,
      offset: 0,
    });
  });

  it('omits optional params when not provided', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getSongsByGenre = jest.fn().mockResolvedValue({
      songsByGenre: { song: [] },
    });
    const { getSongsByGenre, getApi } = require('../subsonicService');
    getApi();
    await getSongsByGenre('Jazz');
    expect(SubsonicAPI.prototype.getSongsByGenre).toHaveBeenCalledWith({
      genre: 'Jazz',
    });
  });

  it('returns empty array when songsByGenre is missing', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getSongsByGenre = jest.fn().mockResolvedValue({});
    const { getSongsByGenre, getApi } = require('../subsonicService');
    getApi();
    const result = await getSongsByGenre('Rock');
    expect(result).toEqual([]);
  });

  it('returns null on exception', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.getSongsByGenre = jest.fn().mockRejectedValue(new Error('fail'));
    const { getSongsByGenre, getApi } = require('../subsonicService');
    getApi();
    const result = await getSongsByGenre('Rock');
    expect(result).toBeNull();
  });
});

describe('login (edge cases)', () => {
  it('falls back to response.version when serverVersion is falsy', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'ok',
      version: '1.16.0',
      openSubsonic: true,
      serverVersion: undefined,
    });
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com', 'user', 'pass');
    expect(result).toEqual({ success: true, version: '1.16.0' });
  });

  it('returns Authentication failed when error has no message and non-40 code', async () => {
    const { default: SubsonicAPI } = require('subsonic-api');
    SubsonicAPI.prototype.ping = jest.fn().mockResolvedValue({
      status: 'failed',
      error: {},
    });
    const { login } = require('../subsonicService');
    const result = await login('https://music.example.com', 'user', 'pass');
    expect(result).toEqual({ success: false, error: 'Authentication failed' });
  });
});

// ==========================
// Legacy Auth URL Building
// ==========================

describe('legacy auth URL building', () => {
  beforeEach(async () => {
    clearApiCache();
    mockAuthStore.getState.mockReturnValue({
      isLoggedIn: true,
      serverUrl: 'https://nextcloud.example.com',
      username: 'ncuser',
      password: 'ncpass',
      legacyAuth: true,
      apiVersion: '1.16.1',
      rehydrated: true,
    } as any);
    await ensureCoverArtAuth();
  });

  it('getCoverArtUrl uses p param in legacy mode', () => {
    const url = getCoverArtUrl('al-1');
    expect(url).not.toBeNull();
    // "ncpass" → hex: 6e6370617373
    expect(url).toContain('p=enc%3A6e6370617373');
    expect(url).toContain('u=ncuser');
    expect(url).not.toContain('t=');
    expect(url).not.toContain('s=');
  });

  it('getStreamUrl uses p param in legacy mode', () => {
    const url = getStreamUrl('track-1');
    expect(url).not.toBeNull();
    expect(url).toContain('p=enc%3A6e6370617373');
    expect(url).toContain('u=ncuser');
    expect(url).not.toContain('t=');
    expect(url).not.toContain('s=');
  });

  it('getDownloadStreamUrl uses p param in legacy mode', () => {
    const url = getDownloadStreamUrl('track-1');
    expect(url).not.toBeNull();
    expect(url).toContain('p=enc%3A6e6370617373');
    expect(url).toContain('u=ncuser');
    expect(url).not.toContain('t=');
    expect(url).not.toContain('s=');
  });

  it('token mode still uses t+s (regression)', async () => {
    clearApiCache();
    mockAuthStore.getState.mockReturnValue({
      isLoggedIn: true,
      serverUrl: 'https://navidrome.example.com',
      username: 'user',
      password: 'pass',
      legacyAuth: false,
      apiVersion: '1.16',
      rehydrated: true,
    } as any);
    await ensureCoverArtAuth();

    const url = getCoverArtUrl('al-1');
    expect(url).not.toBeNull();
    expect(url).toContain('t=');
    expect(url).toContain('s=');
    expect(url).not.toContain('p=');
  });

  it('cache invalidates when legacyAuth changes', async () => {
    // Already in legacy mode from beforeEach
    const legacyUrl = getCoverArtUrl('al-1');
    expect(legacyUrl).toContain('p=enc');

    // Switch to token mode
    clearApiCache();
    mockAuthStore.getState.mockReturnValue({
      isLoggedIn: true,
      serverUrl: 'https://nextcloud.example.com',
      username: 'ncuser',
      password: 'ncpass',
      legacyAuth: false,
      apiVersion: '1.16.1',
      rehydrated: true,
    } as any);
    await ensureCoverArtAuth();

    const tokenUrl = getCoverArtUrl('al-1');
    expect(tokenUrl).toContain('t=');
    expect(tokenUrl).not.toContain('p=');
  });
});
