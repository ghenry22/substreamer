let mockNetInfoCallback: ((state: any) => void) | null = null;
let mockAppStateCallback: ((state: string) => void) | null = null;

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn((cb: (state: any) => void) => {
      mockNetInfoCallback = cb;
      return () => { mockNetInfoCallback = null; };
    }),
  },
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn((_type: string, cb: (state: string) => void) => {
      mockAppStateCallback = cb;
      return { remove: () => { mockAppStateCallback = null; } };
    }),
  },
}));

const mockStoreState = {
  isInternetReachable: true,
  isServerReachable: true,
  bannerState: 'hidden' as string,
  setInternetReachable: jest.fn((v: boolean) => { mockStoreState.isInternetReachable = v; }),
  setServerReachable: jest.fn((v: boolean) => { mockStoreState.isServerReachable = v; }),
  setBannerState: jest.fn((v: string) => { mockStoreState.bannerState = v; }),
};

jest.mock('../../store/connectivityStore', () => ({
  connectivityStore: {
    getState: jest.fn(() => mockStoreState),
  },
}));

jest.mock('../../store/authStore', () => ({
  authStore: { getState: jest.fn(() => ({ serverUrl: null })) },
}));

jest.mock('../../store/sslCertStore', () => ({
  sslCertStore: { getState: jest.fn(() => ({ trustedCerts: {} })) },
}));

jest.mock('../../store/certPromptStore', () => ({
  certPromptStore: { getState: jest.fn(() => ({ show: jest.fn(), hide: jest.fn() })) },
}));

jest.mock('../../../modules/expo-ssl-trust/src', () => ({
  isSSLError: jest.fn(() => false),
  getCertificateInfo: jest.fn(),
}));

const mockPing = jest.fn();
jest.mock('../subsonicService');

import { isSSLError } from '../../../modules/expo-ssl-trust/src';
import { getApiUnchecked } from '../subsonicService';
import { startMonitoring, stopMonitoring } from '../connectivityService';

const mockIsSSLError = isSSLError as jest.Mock;

const mockGetApi = getApiUnchecked as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  stopMonitoring();

  mockStoreState.isInternetReachable = true;
  mockStoreState.isServerReachable = true;
  mockStoreState.bannerState = 'hidden';
  mockStoreState.setInternetReachable.mockClear();
  mockStoreState.setServerReachable.mockClear();
  mockStoreState.setBannerState.mockClear();
  const NetInfo = require('@react-native-community/netinfo').default;
  NetInfo.addEventListener.mockClear();
  mockPing.mockReset();
  mockIsSSLError.mockReturnValue(false);
  mockGetApi.mockReturnValue({ ping: mockPing });
  mockNetInfoCallback = null;
  mockAppStateCallback = null;
});

afterEach(() => {
  stopMonitoring();
  jest.useRealTimers();
});

describe('startMonitoring', () => {
  it('subscribes to NetInfo and AppState', () => {
    startMonitoring();
    expect(mockNetInfoCallback).not.toBeNull();
    expect(mockAppStateCallback).not.toBeNull();
  });

  it('is idempotent on repeated calls', () => {
    startMonitoring();
    startMonitoring();
    const NetInfo = require('@react-native-community/netinfo').default;
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
  });
});

describe('stopMonitoring', () => {
  it('unsubscribes and resets store to healthy defaults', () => {
    startMonitoring();
    mockStoreState.setInternetReachable.mockClear();
    mockStoreState.setServerReachable.mockClear();
    mockStoreState.setBannerState.mockClear();

    stopMonitoring();

    expect(mockNetInfoCallback).toBeNull();
    expect(mockAppStateCallback).toBeNull();
    expect(mockStoreState.setInternetReachable).toHaveBeenCalledWith(true);
    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(true);
    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('hidden');
  });

  it('is safe to call when not monitoring', () => {
    expect(() => stopMonitoring()).not.toThrow();
  });
});

describe('ping cycle', () => {
  it('pings server when NetInfo fires', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();

    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockPing).toHaveBeenCalledTimes(1);
    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(true);
  });

  it('pings server when AppState becomes active', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();

    mockAppStateCallback!('active');
    await jest.advanceTimersByTimeAsync(100);

    expect(mockPing).toHaveBeenCalled();
  });

  it('marks server unreachable on ping failure', async () => {
    mockPing.mockRejectedValue(new Error('timeout'));
    startMonitoring();

    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(false);
  });

  it('marks server unreachable on non-ok ping status', async () => {
    mockPing.mockResolvedValue({ status: 'failed' });
    startMonitoring();

    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(false);
  });

  it('sets internet reachable from NetInfo state', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();
    mockNetInfoCallback!({ isInternetReachable: false });
    expect(mockStoreState.setInternetReachable).toHaveBeenCalledWith(false);
  });

  it('defaults internet reachable to true when NetInfo is null', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();
    mockNetInfoCallback!({ isInternetReachable: null });
    expect(mockStoreState.setInternetReachable).toHaveBeenCalledWith(true);
  });
});

describe('banner state transitions', () => {
  it('shows unreachable banner when server is down', async () => {
    mockPing.mockRejectedValue(new Error('timeout'));
    startMonitoring();

    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('unreachable');
  });

  it('shows reconnected banner when server comes back after being down', async () => {
    mockPing.mockRejectedValueOnce(new Error('timeout'));
    startMonitoring();
    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockStoreState.isServerReachable).toBe(false);
    mockStoreState.setBannerState.mockClear();

    mockPing.mockResolvedValueOnce({ status: 'ok' });
    await jest.advanceTimersByTimeAsync(6000);

    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('reconnected');
  });

  it('hides reconnected banner after 2.5s', async () => {
    mockPing.mockRejectedValueOnce(new Error('down'));
    startMonitoring();
    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockStoreState.isServerReachable).toBe(false);
    mockStoreState.setBannerState.mockClear();

    mockPing.mockResolvedValueOnce({ status: 'ok' });
    await jest.advanceTimersByTimeAsync(6000);
    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('reconnected');

    mockStoreState.setBannerState.mockClear();
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('hidden');
  });
});

describe('ping guard', () => {
  it('skips ping when no API is available', async () => {
    mockGetApi.mockReturnValue(null);
    startMonitoring();

    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockPing).not.toHaveBeenCalled();
  });
});

describe('SSL error detection', () => {
  it('shows ssl-error banner when ping fails with SSL error', async () => {
    mockPing.mockRejectedValue(new Error('javax.net.ssl.SSLHandshakeException'));
    mockIsSSLError.mockReturnValue(true);
    startMonitoring();

    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('ssl-error');
    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(false);
  });

  it('shows unreachable banner for non-SSL errors', async () => {
    mockPing.mockRejectedValue(new Error('Network timeout'));
    mockIsSSLError.mockReturnValue(false);
    startMonitoring();

    mockNetInfoCallback!({ isInternetReachable: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('unreachable');
  });
});
