jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

/**
 * Album View must pass `showComposer` on every TrackRow it renders — queue,
 * playlist, and search rows that reuse TrackRow must not. Only the prop handoff
 * is under test, so the screen's chrome (lists, navigation, artwork, data
 * fetching) is stubbed down to the point where `renderItem` runs.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import type { Child, AlbumWithSongsID3 } from '../../services/subsonicService';
import type { TrackRowProps } from '../../components/TrackRow';

const mockTrackRowProps: TrackRowProps[] = [];
jest.mock('../../components/TrackRow', () => ({
  TrackRow: (props: TrackRowProps) => {
    mockTrackRowProps.push(props);
    return null;
  },
}));

jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  return {
    FlashList: ({
      data,
      renderItem,
      ListHeaderComponent,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
    }) => (
      <View>
        {ListHeaderComponent}
        {data.map((item, index) => (
          <View key={index}>{renderItem({ item, index })}</View>
        ))}
      </View>
    ),
  };
});

jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const Toolbar = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Toolbar.Button = () => null;
  Toolbar.View = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  return {
    Stack: { Toolbar },
    useLocalSearchParams: () => ({ id: 'a1' }),
    useNavigation: () => ({ setOptions: jest.fn() }),
    useRouter: () => ({ push: jest.fn() }),
  };
});

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      card: '#111',
      textPrimary: '#fff',
      textSecondary: '#888',
      label: '#fff',
      border: '#333',
      inputBg: '#222',
      primary: '#1D9BF0',
      red: '#e91429',
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/useTransitionComplete', () => ({ useTransitionComplete: () => true }));
jest.mock('../../hooks/useDownloadStatus', () => ({ useDownloadStatus: () => 'none' }));
jest.mock('../../hooks/useIsStarred', () => ({ useIsStarred: () => false }));
jest.mock('../../hooks/useLayoutMode', () => ({ useLayoutMode: () => 'compact' }));
jest.mock('../../hooks/useRefreshControlKey', () => ({ useRefreshControlKey: () => 0 }));
jest.mock('../../hooks/useSongCoverArt', () => ({
  useSongCoverArt: () => undefined,
  resolveEntityCoverArt: () => undefined,
}));

jest.mock('../../components/CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: () => <View /> };
});
jest.mock('../../components/MarqueeText', () => {
  const { Text } = require('react-native');
  return { MarqueeText: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text> };
});
jest.mock('../../components/DetailScreenBackground', () => ({ DetailScreenBackground: () => null }));
jest.mock('../../components/BottomChrome', () => ({ BottomChrome: () => null }));
jest.mock('../../components/DownloadButton', () => ({ DownloadButton: () => null }));
jest.mock('../../components/MoreOptionsButton', () => ({ MoreOptionsButton: () => null }));
jest.mock('../../components/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('../../components/DetailHeroButtons', () => ({
  PlayAllButton: () => null,
  ShufflePlayButton: () => null,
}));
jest.mock('../../components/SwipeableRow', () => {
  const { View } = require('react-native');
  return {
    SwipeableRow: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    closeOpenRow: jest.fn(),
  };
});

jest.mock('../../services/musicCacheService', () => ({
  enqueueAlbumDownload: jest.fn(),
}));
jest.mock('../../services/imageCacheService', () => ({
  refreshCoverArt: jest.fn(),
}));
jest.mock('../../services/moreOptionsService', () => ({ toggleStar: jest.fn() }));
jest.mock('../../services/playerService', () => ({ playTrack: jest.fn() }));

jest.mock('../../store/persistence/db', () => ({ getDb: () => null }));
jest.mock('../../db/repository/details', () => ({ getAlbumDetail: jest.fn() }));
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: Object.assign(
    (sel: (s: { offlineMode: boolean }) => unknown) => sel({ offlineMode: false }),
    { getState: () => ({ offlineMode: false }) },
  ),
}));
jest.mock('../../store/moreOptionsStore', () => ({
  moreOptionsStore: { getState: () => ({ show: jest.fn() }) },
}));

const album = {
  id: 'a1',
  name: 'Test Album',
  artist: 'Test Artist',
  song: [
    { id: 's1', title: 'First', artist: 'A', duration: 180 },
    { id: 's2', title: 'Second', artist: 'B', duration: 180 },
  ] as Child[],
} as unknown as AlbumWithSongsID3;

jest.mock('../../services/detailFetchService', () => ({
  fetchAlbumDetail: jest.fn(async () => album),
}));

import { AlbumDetailScreen } from '../album-detail';

beforeEach(() => {
  mockTrackRowProps.length = 0;
});

describe('AlbumDetailScreen — showComposer prop handoff', () => {
  it('passes showComposer on every row', async () => {
    render(<AlbumDetailScreen />);

    await waitFor(() => expect(mockTrackRowProps.length).toBeGreaterThanOrEqual(2));

    const ids = mockTrackRowProps.map((p) => p.track.id);
    expect(ids).toEqual(expect.arrayContaining(['s1', 's2']));
    for (const props of mockTrackRowProps) {
      expect(props.showComposer).toBe(true);
    }
  });
});
