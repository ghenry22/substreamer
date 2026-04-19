import { act, renderHook } from '@testing-library/react-native';

const mockActivate = jest.fn(() => Promise.resolve());
const mockDeactivate = jest.fn(() => Promise.resolve());

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (...a: unknown[]) => (mockActivate as any)(...a),
  deactivateKeepAwake: (...a: unknown[]) => (mockDeactivate as any)(...a),
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('per-row persistence disabled in test');
  },
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import { syncStatusStore } from '../../store/syncStatusStore';
import { useLibrarySyncKeepAwake } from '../useLibrarySyncKeepAwake';

beforeEach(() => {
  jest.clearAllMocks();
  syncStatusStore.setState({ detailSyncPhase: 'idle' });
});

describe('useLibrarySyncKeepAwake', () => {
  it('activates keep-awake while a walk is syncing', () => {
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    renderHook(() => useLibrarySyncKeepAwake());
    expect(mockActivate).toHaveBeenCalledWith('library-sync');
  });

  it('deactivates when phase is idle', () => {
    syncStatusStore.setState({ detailSyncPhase: 'idle' });
    renderHook(() => useLibrarySyncKeepAwake());
    expect(mockDeactivate).toHaveBeenCalledWith('library-sync');
  });

  it('transitions activate/deactivate as phase flips', () => {
    const { rerender } = renderHook(() => useLibrarySyncKeepAwake());
    act(() => {
      syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    });
    rerender({});
    expect(mockActivate).toHaveBeenCalled();
    mockDeactivate.mockClear();
    act(() => {
      syncStatusStore.setState({ detailSyncPhase: 'idle' });
    });
    rerender({});
    expect(mockDeactivate).toHaveBeenCalled();
  });

  it('cleans up on unmount', () => {
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    const { unmount } = renderHook(() => useLibrarySyncKeepAwake());
    mockDeactivate.mockClear();
    unmount();
    expect(mockDeactivate).toHaveBeenCalledWith('library-sync');
  });

  it('swallows activate/deactivate errors (activity unavailable)', () => {
    mockActivate.mockImplementationOnce(() => Promise.reject(new Error('unavailable')));
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    expect(() => renderHook(() => useLibrarySyncKeepAwake())).not.toThrow();
  });
});
