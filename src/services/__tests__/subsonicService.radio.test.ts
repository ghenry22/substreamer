const mockGetInternetRadioStations = jest.fn();
const mockCreateInternetRadioStation = jest.fn();
const mockUpdateInternetRadioStation = jest.fn();
const mockDeleteInternetRadioStation = jest.fn();

jest.mock('subsonic-api', () => ({
  __esModule: true,
  default: class MockSubsonicAPI {
    getInternetRadioStations = mockGetInternetRadioStations;
    createInternetRadioStation = mockCreateInternetRadioStation;
    updateInternetRadioStation = mockUpdateInternetRadioStation;
    deleteInternetRadioStation = mockDeleteInternetRadioStation;
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
  createRadioStation,
  deleteRadioStation,
  getInternetRadioStations,
  isRadioChild,
  isRadioId,
  radioStationIdFromChildId,
  radioStationToChild,
  stationLogoUrl,
  updateRadioStation,
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
  mockCreateInternetRadioStation.mockReset();
  mockUpdateInternetRadioStation.mockReset();
  mockDeleteInternetRadioStation.mockReset();
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

describe('isRadioId / radioStationIdFromChildId', () => {
  it('recognises prefixed radio ids', () => {
    expect(isRadioId(`${RADIO_ID_PREFIX}ir-1`)).toBe(true);
    expect(isRadioId('song-1')).toBe(false);
  });

  it('round-trips the station id through the child id', () => {
    expect(radioStationIdFromChildId(`${RADIO_ID_PREFIX}ir-1`)).toBe('ir-1');
  });
});

describe('stationLogoUrl', () => {
  it('derives the favicon from the home page host', () => {
    expect(stationLogoUrl(station)).toBe('https://jazzfm.example/favicon.ico');
  });

  it('falls back to the stream host without a home page', () => {
    expect(stationLogoUrl({ ...station, homePageUrl: undefined })).toBe(
      'https://stream.jazzfm.example/favicon.ico',
    );
  });

  it('returns null for an unparsable URL', () => {
    expect(
      stationLogoUrl({ ...station, homePageUrl: 'not a url', streamUrl: 'also bad' }),
    ).toBeNull();
  });

  it('embeds the logo in the synthesized child', () => {
    expect(radioStationToChild(station).radioLogoUrl).toBe(
      'https://jazzfm.example/favicon.ico',
    );
  });
});

describe('radio station CRUD', () => {
  it('create returns ok on success', async () => {
    mockCreateInternetRadioStation.mockResolvedValue({});
    const result = await createRadioStation({ name: 'X', streamUrl: 'https://x/s' });
    expect(result).toEqual({ ok: true });
    expect(mockCreateInternetRadioStation).toHaveBeenCalledWith({
      name: 'X',
      streamUrl: 'https://x/s',
    });
  });

  it('update returns ok on success', async () => {
    mockUpdateInternetRadioStation.mockResolvedValue({});
    const result = await updateRadioStation({ id: 'ir-1', name: 'X', streamUrl: 'https://x/s' });
    expect(result).toEqual({ ok: true });
  });

  it('delete returns ok on success', async () => {
    mockDeleteInternetRadioStation.mockResolvedValue({});
    const result = await deleteRadioStation('ir-1');
    expect(result).toEqual({ ok: true });
    expect(mockDeleteInternetRadioStation).toHaveBeenCalledWith({ id: 'ir-1' });
  });

  it('surfaces the server error message on failure', async () => {
    mockCreateInternetRadioStation.mockRejectedValue(new Error('Only admins can do that'));
    const result = await createRadioStation({ name: 'X', streamUrl: 'https://x/s' });
    expect(result).toEqual({ ok: false, error: 'Only admins can do that' });
  });

  it('falls back to a translated message for opaque failures', async () => {
    mockUpdateInternetRadioStation.mockRejectedValue('boom');
    const result = await updateRadioStation({ id: 'ir-1', name: 'X', streamUrl: 'https://x/s' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.error).toBe('string');
  });

  it('fails without an API session', async () => {
    mockAuthStore.getState.mockReturnValue({ isLoggedIn: false } as any);
    const result = await deleteRadioStation('ir-1');
    expect(result.ok).toBe(false);
    expect(mockDeleteInternetRadioStation).not.toHaveBeenCalled();
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
