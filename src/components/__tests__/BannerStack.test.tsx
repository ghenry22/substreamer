import { render } from '@testing-library/react-native';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('per-row persistence disabled in test');
  },
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

jest.mock('../ConnectivityBanner', () => ({
  ConnectivityBanner: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'banner-connectivity' }, 'connectivity');
  },
}));

jest.mock('../StorageFullBanner', () => ({
  StorageFullBanner: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'banner-storage' }, 'storage');
  },
}));

jest.mock('../LibrarySyncBanner', () => ({
  LibrarySyncBanner: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'banner-library-sync' }, 'library-sync');
  },
}));

import { BannerStack } from '../BannerStack';
import { connectivityStore } from '../../store/connectivityStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import { storageLimitStore } from '../../store/storageLimitStore';
import { syncStatusStore } from '../../store/syncStatusStore';

function resetAll() {
  connectivityStore.setState({ bannerState: 'hidden' } as any);
  offlineModeStore.setState({ offlineMode: false } as any);
  storageLimitStore.setState({ isStorageFull: false } as any);
  syncStatusStore.setState({ detailSyncPhase: 'idle' });
}

beforeEach(resetAll);

describe('BannerStack — priority selection', () => {
  it('renders nothing when every banner is inactive', () => {
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-connectivity')).toBeNull();
    expect(queryByTestId('banner-storage')).toBeNull();
    expect(queryByTestId('banner-library-sync')).toBeNull();
  });

  it('shows connectivity banner when bannerState !== hidden and not offline', () => {
    connectivityStore.setState({ bannerState: 'unreachable' } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-connectivity')).not.toBeNull();
  });

  it('suppresses connectivity banner when offline mode is on', () => {
    connectivityStore.setState({ bannerState: 'unreachable' } as any);
    offlineModeStore.setState({ offlineMode: true } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-connectivity')).toBeNull();
  });

  it('shows storage banner when storage is full and connectivity is hidden', () => {
    storageLimitStore.setState({ isStorageFull: true } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-storage')).not.toBeNull();
    expect(queryByTestId('banner-connectivity')).toBeNull();
  });

  it('connectivity banner wins over storage banner when both are active', () => {
    connectivityStore.setState({ bannerState: 'ssl-error' } as any);
    storageLimitStore.setState({ isStorageFull: true } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-connectivity')).not.toBeNull();
    expect(queryByTestId('banner-storage')).toBeNull();
  });

  it('shows library-sync banner when sync is active and nothing higher is', () => {
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-library-sync')).not.toBeNull();
  });

  it('storage full suppresses library-sync banner', () => {
    storageLimitStore.setState({ isStorageFull: true } as any);
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-storage')).not.toBeNull();
    expect(queryByTestId('banner-library-sync')).toBeNull();
  });

  it('paused sync state still counts as "not idle" and shows the library-sync banner', () => {
    syncStatusStore.setState({ detailSyncPhase: 'paused-offline' });
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-library-sync')).not.toBeNull();
  });

  it('offline mode does not suppress library-sync banner (only connectivity)', () => {
    offlineModeStore.setState({ offlineMode: true } as any);
    syncStatusStore.setState({ detailSyncPhase: 'paused-offline' });
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-library-sync')).not.toBeNull();
  });

  it.each<'error' | 'paused-auth-error' | 'paused-metered'>([
    'error',
    'paused-auth-error',
    'paused-metered',
  ])('sync error variant (%s) renders when no higher-priority banner is active', (phase) => {
    syncStatusStore.setState({ detailSyncPhase: phase });
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-library-sync')).not.toBeNull();
  });

  it('sync error variant suppressed by storage-full (storage ranks above)', () => {
    storageLimitStore.setState({ isStorageFull: true } as any);
    syncStatusStore.setState({ detailSyncPhase: 'paused-auth-error' });
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-storage')).not.toBeNull();
    expect(queryByTestId('banner-library-sync')).toBeNull();
  });
});
