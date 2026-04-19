import { renderHook } from '@testing-library/react-native';

const mockScheduleNotification = jest.fn(() => Promise.resolve('notif-1'));
const mockDismissNotification = jest.fn(() => Promise.resolve());
const mockRequestPermissions = jest.fn(() => Promise.resolve({ granted: true }));
const mockSetNotificationChannelAsync = jest.fn(() => Promise.resolve());

jest.mock('expo-notifications', () => ({
  __esModule: true,
  setNotificationChannelAsync: (...a: unknown[]) => (mockSetNotificationChannelAsync as any)(...a),
  scheduleNotificationAsync: (...a: unknown[]) => (mockScheduleNotification as any)(...a),
  dismissNotificationAsync: (...a: unknown[]) => (mockDismissNotification as any)(...a),
  requestPermissionsAsync: (...a: unknown[]) => (mockRequestPermissions as any)(...a),
  AndroidImportance: { LOW: 2 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

let appStateListener: ((state: string) => void) | null = null;
const mockAppStateAdd = jest.fn((_event: string, cb: (state: string) => void) => {
  appStateListener = cb;
  return { remove: () => { appStateListener = null; } };
});

jest.mock('react-native', () => ({
  AppState: { addEventListener: (...a: any[]) => (mockAppStateAdd as any)(...a) },
  Platform: { OS: 'android' },
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('per-row persistence disabled in test');
  },
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import { syncStatusStore } from '../../store/syncStatusStore';
import { useLibrarySyncBackgroundNotification } from '../useLibrarySyncBackgroundNotification';

beforeEach(() => {
  jest.clearAllMocks();
  appStateListener = null;
  syncStatusStore.setState({ detailSyncPhase: 'idle' });
});

describe('useLibrarySyncBackgroundNotification', () => {
  it('posts a notification when backgrounded during an active sync', async () => {
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    renderHook(() => useLibrarySyncBackgroundNotification());
    await appStateListener!('background');
    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(mockScheduleNotification).toHaveBeenCalled();
  });

  it('does nothing when backgrounded while idle', async () => {
    renderHook(() => useLibrarySyncBackgroundNotification());
    await appStateListener!('background');
    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it('dismisses the notification when returning to active', async () => {
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    renderHook(() => useLibrarySyncBackgroundNotification());
    await appStateListener!('background');
    await appStateListener!('active');
    expect(mockDismissNotification).toHaveBeenCalledWith('notif-1');
  });

  it('skips scheduling when permissions are denied', async () => {
    mockRequestPermissions.mockResolvedValueOnce({ granted: false });
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    renderHook(() => useLibrarySyncBackgroundNotification());
    await appStateListener!('background');
    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it('tears down the AppState listener on unmount', () => {
    const { unmount } = renderHook(() => useLibrarySyncBackgroundNotification());
    expect(appStateListener).not.toBeNull();
    unmount();
    expect(appStateListener).toBeNull();
  });
});
