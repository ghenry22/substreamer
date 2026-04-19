import { act, render } from '@testing-library/react-native';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('per-row persistence disabled in test');
  },
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../services/imageCacheService', () => ({
  cacheAllSizes: jest.fn(),
  cacheEntityCoverArt: jest.fn(),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (init: number) => ({ value: init }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withSpring: (val: number) => val,
    withTiming: (val: number) => val,
    withDelay: (_ms: number, val: number) => val,
    Easing: { in: () => () => 0, out: () => () => 0, inOut: () => () => 0, cubic: () => 0 },
  };
});

import { LibrarySyncBanner } from '../LibrarySyncBanner';
import { albumDetailStore } from '../../store/albumDetailStore';
import { albumLibraryStore } from '../../store/albumLibraryStore';
import { syncStatusStore } from '../../store/syncStatusStore';

function setSyncState(patch: Partial<ReturnType<typeof syncStatusStore.getState>>) {
  syncStatusStore.setState(patch as any);
}

beforeEach(() => {
  setSyncState({
    detailSyncPhase: 'idle',
    detailSyncTotal: 0,
    detailSyncStartedAt: null,
    detailSyncError: null,
    bannerDismissedAt: null,
  });
  albumLibraryStore.setState({ albums: [] } as any);
  albumDetailStore.setState({ albums: {} } as any);
});

describe('LibrarySyncBanner', () => {
  it('renders null when phase is idle', () => {
    const { queryByText } = render(<LibrarySyncBanner />);
    // "null" in this harness means no pill label rendered
    expect(queryByText(/Syncing library/i)).toBeNull();
  });

  it('hides on tiny libraries below the display threshold', () => {
    setSyncState({ detailSyncPhase: 'syncing', detailSyncTotal: 10 });
    const { queryByText } = render(<LibrarySyncBanner />);
    expect(queryByText(/Syncing library/i)).toBeNull();
  });

  it('shows the progress label when syncing a meaningful-sized library', () => {
    setSyncState({ detailSyncPhase: 'syncing', detailSyncTotal: 500 });
    albumLibraryStore.setState({ albums: Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` })) } as any);
    const { getByText } = render(<LibrarySyncBanner />);
    expect(getByText(/Syncing library/i)).toBeTruthy();
  });

  it('shows the paused-offline variant with its own copy', () => {
    setSyncState({ detailSyncPhase: 'paused-offline', detailSyncTotal: 500 });
    const { getByText } = render(<LibrarySyncBanner />);
    expect(getByText(/paused/i)).toBeTruthy();
  });

  it('shows the error variant with tap-to-retry copy', () => {
    setSyncState({ detailSyncPhase: 'error', detailSyncTotal: 500 });
    const { getByText } = render(<LibrarySyncBanner />);
    expect(getByText(/retry/i)).toBeTruthy();
  });

  it('stays hidden once dismissed for the session', () => {
    setSyncState({ detailSyncPhase: 'syncing', detailSyncTotal: 500 });
    setSyncState({ bannerDismissedAt: Date.now() });
    const { queryByText } = render(<LibrarySyncBanner />);
    expect(queryByText(/Syncing library/i)).toBeNull();
  });

  it('reappears when phase returns to idle (resetting bannerDismissedAt via setDetailSyncPhase)', () => {
    setSyncState({ detailSyncPhase: 'syncing', detailSyncTotal: 500 });
    syncStatusStore.getState().setBannerDismissedAt(Date.now());
    // Transition to idle clears bannerDismissedAt as a side effect.
    act(() => {
      syncStatusStore.getState().setDetailSyncPhase('idle');
    });
    expect(syncStatusStore.getState().bannerDismissedAt).toBe(null);
  });
});
