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
  hasConnection: true,
  isServerReachable: true,
  bannerState: 'hidden' as string,
  setHasConnection: jest.fn((v: boolean) => { mockStoreState.hasConnection = v; }),
  setServerReachable: jest.fn((v: boolean) => { mockStoreState.isServerReachable = v; }),
  setBannerState: jest.fn((v: string) => { mockStoreState.bannerState = v; }),
  clearFailoverPrompt: jest.fn(),
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

// Hook set via setServerDownHook — the service-under-test invokes this
// instead of importing failoverService directly. Tests register their
// own spy before each scenario.
const mockServerDownHook = jest.fn(async () => {});

import { isSSLError } from '../../../modules/expo-ssl-trust/src';
import { getApiUnchecked } from '../subsonicService';
import {
  awaitFirstPing,
  setServerDownHook,
  setServerUpHook,
  startMonitoring,
  stopMonitoring,
} from '../connectivityService';

const mockIsSSLError = isSSLError as jest.Mock;

const mockGetApi = getApiUnchecked as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  stopMonitoring();

  mockStoreState.hasConnection = true;
  mockStoreState.isServerReachable = true;
  mockStoreState.bannerState = 'hidden';
  mockStoreState.setHasConnection.mockClear();
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
    mockStoreState.setHasConnection.mockClear();
    mockStoreState.setServerReachable.mockClear();
    mockStoreState.setBannerState.mockClear();

    stopMonitoring();

    expect(mockNetInfoCallback).toBeNull();
    expect(mockAppStateCallback).toBeNull();
    expect(mockStoreState.setHasConnection).toHaveBeenCalledWith(true);
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

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockPing).toHaveBeenCalledTimes(1);
    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(true);
  });

  it('calls the server-up hook after a successful ping, once reachable is recorded', async () => {
    const order: string[] = [];
    mockStoreState.setServerReachable.mockImplementation((v: boolean) => {
      mockStoreState.isServerReachable = v;
      order.push(`reachable:${v}`);
    });
    const hook = jest.fn(() => { order.push('hook'); });
    setServerUpHook(hook);
    mockPing.mockResolvedValue({ status: 'ok' });
    try {
      startMonitoring();
      mockNetInfoCallback!({ isConnected: true });
      await jest.advanceTimersByTimeAsync(100);

      expect(order).toEqual(['reachable:true', 'hook']);
    } finally {
      setServerUpHook(null);
      mockStoreState.setServerReachable.mockImplementation((v: boolean) => {
        mockStoreState.isServerReachable = v;
      });
    }
  });

  it('does not call the server-up hook after a failed ping', async () => {
    const hook = jest.fn();
    setServerUpHook(hook);
    mockPing.mockRejectedValue(new Error('timeout'));
    try {
      startMonitoring();
      mockNetInfoCallback!({ isConnected: true });
      await jest.advanceTimersByTimeAsync(100);

      expect(hook).not.toHaveBeenCalled();
    } finally {
      setServerUpHook(null);
    }
  });

  it('a ping still in flight when monitoring stops does not restart the heartbeat', async () => {
    let answer: (v: { status: string }) => void = () => undefined;
    mockPing.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    startMonitoring();
    mockNetInfoCallback!({ isConnected: true, type: 'wifi' });
    await jest.advanceTimersByTimeAsync(0);
    expect(mockPing).toHaveBeenCalledTimes(1);

    stopMonitoring();
    mockStoreState.setServerReachable.mockClear();
    answer({ status: 'failed' });
    await jest.advanceTimersByTimeAsync(120_000);

    // No result recorded, and nothing pinging after logout or in offline mode.
    expect(mockStoreState.setServerReachable).not.toHaveBeenCalled();
    expect(mockPing).toHaveBeenCalledTimes(1);
  });

  it('pings server when AppState becomes active', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();

    mockAppStateCallback!('active');
    await jest.advanceTimersByTimeAsync(100);

    expect(mockPing).toHaveBeenCalled();
  });

  it('marks server unreachable after FAILURE_THRESHOLD consecutive ping failures', async () => {
    mockPing.mockRejectedValue(new Error('timeout'));
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);

    // First failure: debounced — banner not yet flipped.
    expect(mockStoreState.setServerReachable).not.toHaveBeenCalledWith(false);

    // Wait for the next ping at the fast-path interval (5s) and let it
    // resolve. Second consecutive failure trips the threshold.
    await jest.advanceTimersByTimeAsync(6000);

    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(false);
  });

  it('marks server unreachable after 2 consecutive non-ok ping statuses', async () => {
    mockPing.mockResolvedValue({ status: 'failed' });
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    expect(mockStoreState.setServerReachable).not.toHaveBeenCalledWith(false);

    await jest.advanceTimersByTimeAsync(6000);
    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(false);
  });

  it('does NOT mark unreachable on a single failed ping (debounce protects against transient blips)', async () => {
    mockPing
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ status: 'ok' });
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    // First failure shouldn't surface anything
    expect(mockStoreState.setServerReachable).not.toHaveBeenCalledWith(false);
    expect(mockStoreState.setBannerState).not.toHaveBeenCalledWith('unreachable');

    // Next ping succeeds → failure count resets, no banner ever shown
    await jest.advanceTimersByTimeAsync(6000);
    expect(mockStoreState.setBannerState).not.toHaveBeenCalledWith('unreachable');
  });

  it('sets connection state from NetInfo isConnected', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();
    mockNetInfoCallback!({ isConnected: false });
    expect(mockStoreState.setHasConnection).toHaveBeenCalledWith(false);
  });

  it('defaults connection to true when isConnected is null', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();
    mockNetInfoCallback!({ isConnected: null });
    expect(mockStoreState.setHasConnection).toHaveBeenCalledWith(true);
  });
});

describe('banner state transitions', () => {
  it('shows unreachable banner after the debounce threshold trips', async () => {
    mockPing.mockRejectedValue(new Error('timeout'));
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    // First failure: silent (debounce).
    expect(mockStoreState.setBannerState).not.toHaveBeenCalledWith('unreachable');

    // Second failure trips the threshold.
    await jest.advanceTimersByTimeAsync(6000);
    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('unreachable');
  });

  it('shows reconnected banner when server comes back after being down', async () => {
    mockPing.mockRejectedValue(new Error('timeout'));
    startMonitoring();
    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    // Trip the debounce: need 2 failures
    await jest.advanceTimersByTimeAsync(6000);

    expect(mockStoreState.isServerReachable).toBe(false);
    mockStoreState.setBannerState.mockClear();

    mockPing.mockResolvedValue({ status: 'ok' });
    await jest.advanceTimersByTimeAsync(6000);

    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('reconnected');
  });

  it('hides reconnected banner after 2.5s', async () => {
    mockPing.mockRejectedValue(new Error('down'));
    startMonitoring();
    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    // Trip the debounce
    await jest.advanceTimersByTimeAsync(6000);

    expect(mockStoreState.isServerReachable).toBe(false);
    mockStoreState.setBannerState.mockClear();

    mockPing.mockResolvedValue({ status: 'ok' });
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

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockPing).not.toHaveBeenCalled();
  });
});

describe('SSL error detection', () => {
  it('shows ssl-error banner when ping fails with SSL error', async () => {
    mockPing.mockRejectedValue(new Error('javax.net.ssl.SSLHandshakeException'));
    mockIsSSLError.mockReturnValue(true);
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);

    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('ssl-error');
    expect(mockStoreState.setServerReachable).toHaveBeenCalledWith(false);
  });

  it('shows unreachable banner for non-SSL errors after the debounce threshold', async () => {
    mockPing.mockRejectedValue(new Error('Network timeout'));
    mockIsSSLError.mockReturnValue(false);
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    // First failure: silent
    expect(mockStoreState.setBannerState).not.toHaveBeenCalledWith('unreachable');

    // Second failure trips the threshold
    await jest.advanceTimersByTimeAsync(6000);
    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('unreachable');
  });
});

describe('awaitFirstPing', () => {
  it('resolves immediately when monitoring has not been started', async () => {
    // No startMonitoring() call → unsubscribeNetInfo is null. The function
    // resolves so callers can proceed to check store state and bail.
    await expect(awaitFirstPing()).resolves.toBeUndefined();
  });

  it('pends until the first ping result is processed', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();

    let resolved = false;
    const promise = awaitFirstPing().then(() => { resolved = true; });

    // Promise is still pending — the first ping has not run.
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Trigger the ping cycle via NetInfo and let it complete.
    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);

    await promise;
    expect(resolved).toBe(true);
  });

  it('resolves immediately for callers that arrive after the first ping completed', async () => {
    mockPing.mockResolvedValue({ status: 'ok' });
    startMonitoring();
    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);

    // First ping has completed — subsequent awaitFirstPing() resolves
    // without waiting.
    await expect(awaitFirstPing()).resolves.toBeUndefined();
  });

  it('drains pending waiters when monitoring stops without a ping result', async () => {
    // Don't fire NetInfo so the ping never runs. Pending waiters must
    // unblock when stopMonitoring() is called (e.g. user toggles into
    // offline mode mid-await) so they can re-check store state and bail.
    startMonitoring();
    let resolved = false;
    const promise = awaitFirstPing().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    stopMonitoring();
    await promise;
    expect(resolved).toBe(true);
  });

  it('resolves after an SSL error is processed', async () => {
    mockPing.mockRejectedValue(new Error('SSLHandshakeException'));
    mockIsSSLError.mockReturnValue(true);
    startMonitoring();

    let resolved = false;
    const promise = awaitFirstPing().then(() => { resolved = true; });
    expect(resolved).toBe(false);

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);

    await promise;
    expect(resolved).toBe(true);
  });
});

describe('failover wiring (registered hooks)', () => {
  beforeEach(() => {
    mockServerDownHook.mockClear();
    setServerDownHook(mockServerDownHook);
  });

  afterEach(() => {
    setServerDownHook(null);
  });

  it('invokes server-down hook when ping threshold trips', async () => {
    mockPing.mockRejectedValue(new Error('timeout'));
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    // First failure: still debounced.
    expect(mockServerDownHook).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(6000);
    expect(mockServerDownHook).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke server-down hook on a single failure', async () => {
    mockPing
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ status: 'ok' });
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(6000);

    expect(mockServerDownHook).not.toHaveBeenCalled();
  });

  it('is a no-op when no hook is registered (failover service not initialised)', async () => {
    setServerDownHook(null);
    mockPing.mockRejectedValue(new Error('timeout'));
    startMonitoring();

    mockNetInfoCallback!({ isConnected: true });
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(6000);

    // Threshold trips and unreachable banner fires, but no exception
    // bubbles up from the absent hook.
    expect(mockStoreState.setBannerState).toHaveBeenCalledWith('unreachable');
  });
});
