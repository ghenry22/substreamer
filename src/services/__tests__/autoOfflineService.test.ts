// `persistence/db.ts` imports `expo-sqlite` at module load; stub it so the
// import doesn't hit the native bridge during tests.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

let mockNetInfoCallback: ((state: any) => void) | null = null;

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn((cb: (state: any) => void) => {
      mockNetInfoCallback = cb;
      return () => { mockNetInfoCallback = null; };
    }),
    fetch: jest.fn(),
    refresh: jest.fn(),
  },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
}));

let mockAppStateCallback: ((state: string) => void) | null = null;
const mockAppStateRemove = jest.fn();

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn((event: string, cb: (state: string) => void) => {
      if (event === 'change') mockAppStateCallback = cb;
      return { remove: mockAppStateRemove };
    }),
  },
  Linking: {
    openURL: jest.fn(),
    openSettings: jest.fn(),
  },
  Platform: { OS: 'ios' },
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

import { autoOfflineStore } from '../../store/autoOfflineStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import {
  startAutoOffline,
  stopAutoOffline,
  getCurrentSSID,
  getCurrentSSIDWithRetry,
  requestLocationPermission,
  checkLocationPermission,
  openAppSettings,
} from '../autoOfflineService';

const mockAddEventListener = NetInfo.addEventListener as jest.Mock;
const mockFetch = NetInfo.fetch as jest.Mock;
const mockRefresh = (NetInfo as any).refresh as jest.Mock;
const mockRequestForeground = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockGetForeground = Location.getForegroundPermissionsAsync as jest.Mock;
const mockOpenURL = Linking.openURL as jest.Mock;
const mockLinkingOpenSettings = Linking.openSettings as jest.Mock;
const mockSetOffline = jest.spyOn(offlineModeStore.getState(), 'setOfflineMode');

let consoleLogSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

beforeEach(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  stopAutoOffline();
  autoOfflineStore.setState({
    enabled: false,
    mode: 'wifi-only',
    homeSSIDs: [],
    locationPermissionGranted: false,
  });
  offlineModeStore.setState({ offlineMode: false });
  mockSetOffline.mockClear();
  mockFetch.mockReset();
  mockRefresh.mockReset();
  // Default: resolve with a neutral state so startAutoOffline() doesn't throw
  mockRefresh.mockResolvedValue({ type: 'wifi', details: {} });
  mockAddEventListener.mockClear();
  mockAddEventListener.mockImplementation((cb: (state: any) => void) => {
    mockNetInfoCallback = cb;
    return () => { mockNetInfoCallback = null; };
  });
  mockRequestForeground.mockReset();
  mockGetForeground.mockReset();
  mockOpenURL.mockClear();
  mockLinkingOpenSettings.mockClear();
  mockNetInfoCallback = null;
  mockAppStateCallback = null;
  mockAppStateRemove.mockClear();
});

afterEach(() => {
  stopAutoOffline();
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe('startAutoOffline', () => {
  it('does nothing when not enabled', () => {
    autoOfflineStore.setState({ enabled: false });
    startAutoOffline();
    expect(mockNetInfoCallback).toBeNull();
    expect(mockAppStateCallback).toBeNull();
  });

  it('subscribes to NetInfo and AppState when enabled', () => {
    autoOfflineStore.setState({ enabled: true });
    startAutoOffline();
    expect(mockNetInfoCallback).not.toBeNull();
    expect(mockAppStateCallback).not.toBeNull();
  });

  it('is idempotent on repeated calls', () => {
    autoOfflineStore.setState({ enabled: true });
    startAutoOffline();
    mockAddEventListener.mockClear();
    startAutoOffline();
    expect(mockAddEventListener).not.toHaveBeenCalled();
  });

  it('calls NetInfo.refresh() immediately for cold start evaluation', async () => {
    mockRefresh.mockResolvedValue({ type: 'wifi', details: {} });
    autoOfflineStore.setState({ enabled: true, mode: 'wifi-only' });
    startAutoOffline();

    expect(mockRefresh).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSetOffline).toHaveBeenCalledWith(false);
  });

  it('retries the cold-start refresh once after 500ms when the first result is "unknown" (U19)', async () => {
    jest.useFakeTimers();
    try {
      mockRefresh
        .mockResolvedValueOnce({ type: 'unknown', details: null })
        .mockResolvedValueOnce({ type: 'wifi', details: {} });
      autoOfflineStore.setState({ enabled: true, mode: 'wifi-only' });
      startAutoOffline();

      // First refresh fires immediately and resolves with the stale 'unknown' state.
      await Promise.resolve();
      await Promise.resolve();
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockSetOffline).not.toHaveBeenCalled();

      // After 500ms the retry fires; second refresh resolves with the real wifi state.
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockRefresh).toHaveBeenCalledTimes(2);
      expect(mockSetOffline).toHaveBeenCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries the cold-start refresh once after 500ms when the first result is "none" (U19)', async () => {
    jest.useFakeTimers();
    try {
      mockRefresh
        .mockResolvedValueOnce({ type: 'none', details: null })
        .mockResolvedValueOnce({ type: 'wifi', details: {} });
      autoOfflineStore.setState({ enabled: true, mode: 'wifi-only' });
      startAutoOffline();

      await Promise.resolve();
      await Promise.resolve();
      expect(mockRefresh).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockRefresh).toHaveBeenCalledTimes(2);
      expect(mockSetOffline).toHaveBeenCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('stopAutoOffline', () => {
  it('unsubscribes NetInfo, AppState, and store', () => {
    autoOfflineStore.setState({ enabled: true });
    startAutoOffline();
    expect(mockNetInfoCallback).not.toBeNull();
    expect(mockAppStateCallback).not.toBeNull();
    stopAutoOffline();
    expect(mockNetInfoCallback).toBeNull();
    expect(mockAppStateRemove).toHaveBeenCalled();
  });

  it('is safe to call when not monitoring', () => {
    expect(() => stopAutoOffline()).not.toThrow();
  });
});

describe('wifi-only mode', () => {
  beforeEach(() => {
    autoOfflineStore.setState({ enabled: true, mode: 'wifi-only' });
    startAutoOffline();
  });

  it('goes online on wifi', () => {
    mockNetInfoCallback!({ type: 'wifi', details: {} });
    expect(mockSetOffline).toHaveBeenCalledWith(false);
  });

  it('goes online on ethernet', () => {
    mockNetInfoCallback!({ type: 'ethernet', details: {} });
    expect(mockSetOffline).toHaveBeenCalledWith(false);
  });

  it('goes offline on cellular', () => {
    mockNetInfoCallback!({ type: 'cellular', details: {} });
    expect(mockSetOffline).toHaveBeenCalledWith(true);
  });

  it('goes offline when disconnected', () => {
    mockNetInfoCallback!({ type: 'none', details: null });
    expect(mockSetOffline).toHaveBeenCalledWith(true);
  });
});

describe('home-wifi mode', () => {
  it('goes online when SSID matches', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['MyHomeWiFi'] });
    startAutoOffline();
    mockNetInfoCallback!({ type: 'wifi', details: { ssid: 'MyHomeWiFi' } });
    expect(mockSetOffline).toHaveBeenCalledWith(false);
  });

  it('goes offline when SSID does not match', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['MyHomeWiFi'] });
    startAutoOffline();
    mockNetInfoCallback!({ type: 'wifi', details: { ssid: 'CoffeeShop' } });
    expect(mockSetOffline).toHaveBeenCalledWith(true);
  });

  it('goes offline when not on wifi', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['MyHomeWiFi'] });
    startAutoOffline();
    mockNetInfoCallback!({ type: 'cellular', details: {} });
    expect(mockSetOffline).toHaveBeenCalledWith(true);
  });

  it('skips toggle when SSID is null (permission denied)', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['MyHomeWiFi'] });
    startAutoOffline();
    mockNetInfoCallback!({ type: 'wifi', details: { ssid: null } });
    expect(mockSetOffline).not.toHaveBeenCalled();
  });

  it('skips toggle when details has no ssid property', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['MyHomeWiFi'] });
    startAutoOffline();
    mockNetInfoCallback!({ type: 'wifi', details: {} });
    expect(mockSetOffline).not.toHaveBeenCalled();
  });

  it('skips toggle when details is null', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['MyHomeWiFi'] });
    startAutoOffline();
    mockNetInfoCallback!({ type: 'wifi', details: null });
    expect(mockSetOffline).not.toHaveBeenCalled();
  });

  it('skips toggle when homeSSIDs is empty', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: [] });
    startAutoOffline();
    mockNetInfoCallback!({ type: 'wifi', details: { ssid: 'SomeNetwork' } });
    expect(mockSetOffline).not.toHaveBeenCalled();
  });

  it('matches any SSID in a multi-entry list', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['NetA', 'NetB', 'NetC'] });
    startAutoOffline();
    mockNetInfoCallback!({ type: 'wifi', details: { ssid: 'NetB' } });
    expect(mockSetOffline).toHaveBeenCalledWith(false);
  });
});

describe('store subscription – settings changes', () => {
  it('unsubscribes NetInfo when disabled via store', () => {
    autoOfflineStore.setState({ enabled: true });
    startAutoOffline();
    expect(mockNetInfoCallback).not.toBeNull();

    autoOfflineStore.getState().setEnabled(false);
    expect(mockNetInfoCallback).toBeNull();
  });

  it('restarts listener on mode change', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'wifi-only' });
    startAutoOffline();

    // Trigger a mode change and verify re-subscription happened
    const callsBefore = mockAddEventListener.mock.calls.length;
    autoOfflineStore.getState().setMode('home-wifi');

    expect(mockAddEventListener.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(mockNetInfoCallback).not.toBeNull();
  });

  it('restarts listener on re-enable', () => {
    autoOfflineStore.setState({ enabled: true });
    startAutoOffline();
    autoOfflineStore.getState().setEnabled(false);
    expect(mockNetInfoCallback).toBeNull();

    autoOfflineStore.getState().setEnabled(true);
    expect(mockNetInfoCallback).not.toBeNull();
  });

  it('re-evaluates via fetch when SSIDs change in home-wifi mode', async () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['Old'] });
    startAutoOffline();
    mockFetch.mockResolvedValue({ type: 'wifi', details: { ssid: 'NewHome' } });

    autoOfflineStore.getState().addSSID('NewHome');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    expect(mockSetOffline).toHaveBeenCalledWith(false);
  });

  it('does not re-evaluate via fetch when SSIDs change in wifi-only mode', () => {
    autoOfflineStore.setState({ enabled: true, mode: 'wifi-only', homeSSIDs: ['Old'] });
    startAutoOffline();

    autoOfflineStore.getState().addSSID('NewHome');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('foreground re-evaluation', () => {
  it('triggers NetInfo.refresh and re-evaluates in wifi-only mode on active', async () => {
    autoOfflineStore.setState({ enabled: true, mode: 'wifi-only' });
    startAutoOffline();
    mockSetOffline.mockClear();
    mockRefresh.mockResolvedValue({ type: 'cellular', details: {} });

    mockAppStateCallback!('active');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRefresh).toHaveBeenCalled();
    expect(mockSetOffline).toHaveBeenCalledWith(true);
  });

  it('triggers re-evaluation with SSID matching in home-wifi mode on active', async () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['HomeNet'] });
    startAutoOffline();
    mockSetOffline.mockClear();
    mockRefresh.mockResolvedValue({ type: 'wifi', details: { ssid: 'HomeNet' } });

    mockAppStateCallback!('active');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetOffline).toHaveBeenCalledWith(false);
  });

  it('sets offline when foreground SSID does not match home networks', async () => {
    autoOfflineStore.setState({ enabled: true, mode: 'home-wifi', homeSSIDs: ['HomeNet'] });
    startAutoOffline();
    mockSetOffline.mockClear();
    mockRefresh.mockResolvedValue({ type: 'wifi', details: { ssid: 'CoffeeShop' } });

    mockAppStateCallback!('active');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetOffline).toHaveBeenCalledWith(true);
  });

  it('does not trigger refresh on background state change', async () => {
    autoOfflineStore.setState({ enabled: true, mode: 'wifi-only' });
    startAutoOffline();
    await new Promise((r) => setTimeout(r, 0));
    mockRefresh.mockClear();

    mockAppStateCallback!('background');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('cleans up AppState listener on stopAutoOffline', () => {
    autoOfflineStore.setState({ enabled: true });
    startAutoOffline();
    expect(mockAppStateCallback).not.toBeNull();

    stopAutoOffline();
    expect(mockAppStateRemove).toHaveBeenCalled();
  });
});

describe('getCurrentSSID', () => {
  it('returns SSID when on wifi', async () => {
    mockRefresh.mockResolvedValue({ type: 'wifi', details: { ssid: 'TestNet' } });
    expect(await getCurrentSSID()).toBe('TestNet');
  });

  it('returns null when not on wifi', async () => {
    mockRefresh.mockResolvedValue({ type: 'cellular', details: {} });
    expect(await getCurrentSSID()).toBeNull();
  });

  it('returns null when ssid is null', async () => {
    mockRefresh.mockResolvedValue({ type: 'wifi', details: { ssid: null } });
    expect(await getCurrentSSID()).toBeNull();
  });

  it('returns null when details has no ssid property', async () => {
    mockRefresh.mockResolvedValue({ type: 'wifi', details: {} });
    expect(await getCurrentSSID()).toBeNull();
  });

  it('returns null when refresh throws', async () => {
    mockRefresh.mockRejectedValue(new Error('NetInfo error'));
    expect(await getCurrentSSID()).toBeNull();
  });

  it('uses NetInfo.refresh instead of fetch', async () => {
    mockRefresh.mockResolvedValue({ type: 'wifi', details: { ssid: 'Test' } });
    await getCurrentSSID();
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('getCurrentSSIDWithRetry', () => {
  it('returns SSID on first try', async () => {
    mockRefresh.mockResolvedValue({ type: 'wifi', details: { ssid: 'HomeNet' } });
    expect(await getCurrentSSIDWithRetry()).toBe('HomeNet');
    // Only one call to getCurrentSSID (which calls refresh) + no extra refresh for wifi check
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('returns SSID after retry when first attempt has null SSID', async () => {
    mockRefresh
      .mockResolvedValueOnce({ type: 'wifi', details: { ssid: null } }) // getCurrentSSID attempt 1
      .mockResolvedValueOnce({ type: 'wifi', details: { ssid: null } }) // wifi type check attempt 1
      .mockResolvedValueOnce({ type: 'wifi', details: { ssid: 'HomeNet' } }); // getCurrentSSID attempt 2
    expect(await getCurrentSSIDWithRetry()).toBe('HomeNet');
  });

  it('returns null after all retries exhausted', async () => {
    mockRefresh.mockResolvedValue({ type: 'wifi', details: { ssid: null } });
    expect(await getCurrentSSIDWithRetry()).toBeNull();
  });

  it('returns null immediately when not on wifi', async () => {
    mockRefresh.mockResolvedValue({ type: 'cellular', details: {} });
    expect(await getCurrentSSIDWithRetry()).toBeNull();
    // getCurrentSSID returns null (not wifi), then wifi check also returns cellular → early exit
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('returns null when refresh throws', async () => {
    mockRefresh.mockRejectedValue(new Error('NetInfo error'));
    expect(await getCurrentSSIDWithRetry()).toBeNull();
  });
});

describe('requestLocationPermission', () => {
  it('returns true and updates store when granted', async () => {
    mockRequestForeground.mockResolvedValue({ status: 'granted' });
    expect(await requestLocationPermission()).toBe(true);
    expect(autoOfflineStore.getState().locationPermissionGranted).toBe(true);
  });

  it('returns false and updates store when denied', async () => {
    mockRequestForeground.mockResolvedValue({ status: 'denied' });
    expect(await requestLocationPermission()).toBe(false);
    expect(autoOfflineStore.getState().locationPermissionGranted).toBe(false);
  });

  it('returns false when permission request throws', async () => {
    mockRequestForeground.mockRejectedValue(new Error('Permission error'));
    expect(await requestLocationPermission()).toBe(false);
  });
});

describe('checkLocationPermission', () => {
  it('returns true and updates store when granted', async () => {
    mockGetForeground.mockResolvedValue({ status: 'granted' });
    expect(await checkLocationPermission()).toBe(true);
    expect(autoOfflineStore.getState().locationPermissionGranted).toBe(true);
  });

  it('returns false and updates store when denied', async () => {
    mockGetForeground.mockResolvedValue({ status: 'denied' });
    expect(await checkLocationPermission()).toBe(false);
    expect(autoOfflineStore.getState().locationPermissionGranted).toBe(false);
  });

  it('returns false when check throws', async () => {
    mockGetForeground.mockRejectedValue(new Error('Check error'));
    expect(await checkLocationPermission()).toBe(false);
  });
});

describe('openAppSettings', () => {
  it('opens app-settings URL on iOS', () => {
    (Platform as any).OS = 'ios';
    openAppSettings();
    expect(mockOpenURL).toHaveBeenCalledWith('app-settings:');
    expect(mockLinkingOpenSettings).not.toHaveBeenCalled();
  });

  it('calls Linking.openSettings on Android', () => {
    (Platform as any).OS = 'android';
    openAppSettings();
    expect(mockLinkingOpenSettings).toHaveBeenCalled();
    (Platform as any).OS = 'ios';
  });
});
