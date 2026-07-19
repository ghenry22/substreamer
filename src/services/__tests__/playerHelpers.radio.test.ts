jest.mock('../subsonicService');
jest.mock('../musicCacheService', () => ({
  getLocalTrackUri: jest.fn().mockReturnValue(null),
}));
jest.mock('../imageCacheService', () => ({
  resolveCachedImageUri: jest.fn().mockResolvedValue(null),
}));
jest.mock('../imageCacheLogger', () => ({
  logImageCache: jest.fn(),
}));
jest.mock('../../hooks/useSongCoverArt', () => ({
  resolveSongCoverArt: jest.fn(() => null),
}));
jest.mock('../../store/musicCacheStore', () => ({
  musicCacheStore: { getState: jest.fn(() => ({ cachedSongs: {} })) },
}));
const mockOffline = { offlineMode: false };
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: { getState: jest.fn(() => mockOffline) },
}));
jest.mock('../../store/imageCacheDiagnosticsStore', () => ({
  imageCacheDiagnosticsStore: { getState: jest.fn(() => ({ enabled: false })) },
}));
jest.mock('../../store/playbackSettingsStore', () => ({
  playbackSettingsStore: {
    getState: jest.fn(() => ({ streamFormat: 'raw', maxBitRate: null })),
  },
}));

import { buildPlayableQueue, childToTrack } from '../playerHelpers';
import { getStreamUrl, type Child } from '../subsonicService';

const radioChild = {
  id: 'internet-radio:ir-1',
  isDir: false,
  title: 'Jazz FM',
  artist: 'Internet Radio',
  duration: 0,
  radioStreamUrl: 'https://stream.jazzfm.example/live',
} as Child;

beforeEach(() => {
  mockOffline.offlineMode = false;
  (getStreamUrl as jest.Mock).mockReturnValue('https://example.com/stream.mp3');
});

describe('childToTrack — internet radio', () => {
  it('uses the embedded stream URL instead of a server stream URL', () => {
    const track = childToTrack(radioChild);
    expect(track).toEqual({
      id: 'internet-radio:ir-1',
      url: 'https://stream.jazzfm.example/live',
      title: 'Jazz FM',
      artist: 'Internet Radio',
      duration: 0,
    });
    expect(getStreamUrl).not.toHaveBeenCalled();
  });

  it('passes the embedded station logo through as lock-screen artwork', () => {
    const withLogo = {
      ...radioChild,
      radioLogoUrl: 'https://jazzfm.example/favicon.ico',
    } as Child;
    expect(childToTrack(withLogo)?.artworkUrl).toBe('https://jazzfm.example/favicon.ico');
  });

  it('returns null for a radio child in offline mode', () => {
    mockOffline.offlineMode = true;
    expect(childToTrack(radioChild)).toBeNull();
  });

  it('still resolves regular songs through getStreamUrl', () => {
    const song = { id: 'song-1', isDir: false, title: 'Song' } as Child;
    const track = childToTrack(song);
    expect(track?.url).toBe('https://example.com/stream.mp3');
    expect(getStreamUrl).toHaveBeenCalledWith('song-1');
  });
});

describe('buildPlayableQueue — internet radio', () => {
  it('keeps radio children in the playable queue', async () => {
    const song = { id: 'song-1', isDir: false, title: 'Song' } as Child;
    const { rnTracks, filteredQueue } = await buildPlayableQueue([radioChild, song]);
    expect(rnTracks.map((t) => t.id)).toEqual(['internet-radio:ir-1', 'song-1']);
    expect(filteredQueue).toEqual([radioChild, song]);
  });

  it('drops only the radio child when offline (song has no local file either)', async () => {
    mockOffline.offlineMode = true;
    const { rnTracks } = await buildPlayableQueue([radioChild]);
    expect(rnTracks).toHaveLength(0);
  });
});
