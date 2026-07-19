const mockGetInternetRadioStations = jest.fn();

jest.mock('subsonic-api', () => ({
  __esModule: true,
  default: class MockSubsonicAPI {
    getInternetRadioStations = mockGetInternetRadioStations;
  },
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
  FORMAT_PRESETS: [],
}));
jest.mock('../serverCapabilityService', () => ({
  supports: jest.fn(),
}));

import { authStore } from '../../store/authStore';
import {
  RADIO_ID_PREFIX,
  clearApiCache,
  getInternetRadioStations,
  isRadioChild,
  radioStationToChild,
  type Child,
  type InternetRadioStation,
} from '../subsonicService';

const mockAuthStore = authStore as jest.Mocked<typeof authStore>;

const station: InternetRadioStation = {
  id: 'ir-1',
  name: 'Jazz FM',
  streamUrl: 'https://stream.jazzfm.example/live',
  homePageUrl: 'https://jazzfm.example',
};

beforeEach(() => {
  clearApiCache();
  mockGetInternetRadioStations.mockReset();
  mockAuthStore.getState.mockReturnValue({
    isLoggedIn: true,
    serverUrl: 'https://music.example.com',
    username: 'user',
    password: 'pass',
    legacyAuth: false,
  } as any);
});

describe('getInternetRadioStations', () => {
  it('returns stations from the server response', async () => {
    mockGetInternetRadioStations.mockResolvedValue({
      internetRadioStations: { internetRadioStation: [station] },
    });
    const stations = await getInternetRadioStations();
    expect(stations).toEqual([station]);
  });

  it('returns [] when the server has no stations', async () => {
    mockGetInternetRadioStations.mockResolvedValue({ internetRadioStations: {} });
    const stations = await getInternetRadioStations();
    expect(stations).toEqual([]);
  });

  it('returns [] when the envelope is missing entirely', async () => {
    mockGetInternetRadioStations.mockResolvedValue({});
    const stations = await getInternetRadioStations();
    expect(stations).toEqual([]);
  });

  it('returns null when the request throws', async () => {
    mockGetInternetRadioStations.mockRejectedValue(new Error('network'));
    const stations = await getInternetRadioStations();
    expect(stations).toBeNull();
  });

  it('returns null when not logged in', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const stations = await getInternetRadioStations();
    expect(stations).toBeNull();
    expect(mockGetInternetRadioStations).not.toHaveBeenCalled();
  });
});

describe('radioStationToChild', () => {
  it('builds a prefixed Child carrying the stream URL', () => {
    const child = radioStationToChild(station);
    expect(child.id).toBe(`${RADIO_ID_PREFIX}ir-1`);
    expect(child.title).toBe('Jazz FM');
    expect(child.isDir).toBe(false);
    expect(child.duration).toBe(0);
    expect(child.radioStreamUrl).toBe('https://stream.jazzfm.example/live');
  });
});

describe('isRadioChild', () => {
  it('recognises a synthesized radio Child', () => {
    expect(isRadioChild(radioStationToChild(station))).toBe(true);
  });

  it('rejects a regular server song', () => {
    const song = { id: 'song-1', title: 'Song', isDir: false } as Child;
    expect(isRadioChild(song)).toBe(false);
  });

  it('rejects a prefixed id without a stream URL', () => {
    const impostor = {
      id: `${RADIO_ID_PREFIX}ir-2`,
      title: 'X',
      isDir: false,
    } as Child;
    expect(isRadioChild(impostor)).toBe(false);
  });
});
