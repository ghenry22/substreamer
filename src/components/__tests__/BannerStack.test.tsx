import { render } from '@testing-library/react-native';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('per-row persistence disabled in test');
  },
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

// Override isDbHealthy to return true by default so existing priority-ladder
// tests aren't suppressed by the (priority-1) PersistenceDegradedBanner. The
// persistence-degraded scenario gets its own focused test below.
let mockDbHealthy = true;
jest.mock('../../store/persistence', () => {
  const actual = jest.requireActual('../../store/persistence');
  return {
    ...actual,
    isDbHealthy: () => mockDbHealthy,
  };
});

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

jest.mock('../PersistenceDegradedBanner', () => ({
  PersistenceDegradedBanner: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'banner-persistence-degraded' }, 'persistence-degraded');
  },
}));

jest.mock('../ImageCacheBanner', () => ({
  ImageCacheBanner: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'banner-image-cache' }, 'image-cache');
  },
}));

jest.mock('../DownloadedMetadataBanner', () => ({
  DownloadedMetadataBanner: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'banner-downloaded-metadata' }, 'downloaded-metadata');
  },
}));

import { BannerStack } from '../BannerStack';
import { connectivityStore } from '../../store/connectivityStore';
import { downloadedMetadataRefreshStore } from '../../store/downloadedMetadataRefreshStore';
import { imageDownloadQueueStore } from '../../store/imageDownloadQueueStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import { storageLimitStore } from '../../store/storageLimitStore';
import { syncStatusStore } from '../../store/syncStatusStore';

function resetAll() {
  mockDbHealthy = true;
  connectivityStore.setState({ bannerState: 'hidden' } as any);
  offlineModeStore.setState({ offlineMode: false } as any);
  storageLimitStore.setState({ isStorageFull: false } as any);
  syncStatusStore.setState({ detailSyncPhase: 'idle' });
  imageDownloadQueueStore.setState({ cycleId: null, cycleTotal: 0, cycleProcessed: 0 } as any);
  downloadedMetadataRefreshStore.setState({ active: false, total: 0, done: 0 } as any);
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

  it('persistence-degraded banner takes priority over every other banner', () => {
    mockDbHealthy = false;
    connectivityStore.setState({ bannerState: 'ssl-error' } as any);
    storageLimitStore.setState({ isStorageFull: true } as any);
    syncStatusStore.setState({ detailSyncPhase: 'error' });
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-persistence-degraded')).not.toBeNull();
    expect(queryByTestId('banner-connectivity')).toBeNull();
    expect(queryByTestId('banner-storage')).toBeNull();
    expect(queryByTestId('banner-library-sync')).toBeNull();
  });

  it('hides persistence-degraded banner when dbHealthy is true', () => {
    mockDbHealthy = true;
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-persistence-degraded')).toBeNull();
  });

  it('shows image-cache banner when an image-queue cycle is active and no higher-priority banner is active', () => {
    imageDownloadQueueStore.setState({ cycleId: 'cyc-1', cycleTotal: 100, cycleProcessed: 25 } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-image-cache')).not.toBeNull();
  });

  it('does not show image-cache banner when cycle total is 0', () => {
    imageDownloadQueueStore.setState({ cycleId: 'cyc-1', cycleTotal: 0, cycleProcessed: 0 } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-image-cache')).toBeNull();
  });

  it('does not show image-cache banner when no cycle is active', () => {
    imageDownloadQueueStore.setState({ cycleId: null, cycleTotal: 0, cycleProcessed: 0 } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-image-cache')).toBeNull();
  });

  it('library-sync progress suppresses image-cache banner (lower priority)', () => {
    syncStatusStore.setState({ detailSyncPhase: 'syncing' });
    imageDownloadQueueStore.setState({ cycleId: 'cyc-1', cycleTotal: 100, cycleProcessed: 25 } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-library-sync')).not.toBeNull();
    expect(queryByTestId('banner-image-cache')).toBeNull();
  });

  it('shows downloaded-metadata banner when a refresh is active and nothing higher is', () => {
    downloadedMetadataRefreshStore.setState({ active: true, total: 20, done: 5 } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-downloaded-metadata')).not.toBeNull();
  });

  it('does not show downloaded-metadata banner when total is 0', () => {
    downloadedMetadataRefreshStore.setState({ active: true, total: 0, done: 0 } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-downloaded-metadata')).toBeNull();
  });

  it('image-cache refresh suppresses downloaded-metadata banner (lower priority)', () => {
    imageDownloadQueueStore.setState({ cycleId: 'cyc-1', cycleTotal: 100, cycleProcessed: 25 } as any);
    downloadedMetadataRefreshStore.setState({ active: true, total: 20, done: 5 } as any);
    const { queryByTestId } = render(<BannerStack />);
    expect(queryByTestId('banner-image-cache')).not.toBeNull();
    expect(queryByTestId('banner-downloaded-metadata')).toBeNull();
  });
});
