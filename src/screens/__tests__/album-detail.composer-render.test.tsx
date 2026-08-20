jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

/**
 * TrackRow itself proves present/absent/multi-composer rendering in isolation
 * (TrackRow.test.tsx). This proves the Album View screen actually wires it
 * through end to end: a compilation album's tracks each show their own composer,
 * never the album's Various Artists credit or a row's performer standing in for
 * a track with no composer.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import type { Child, AlbumWithSongsID3 } from '../../services/subsonicService';

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
jest.mock('../../hooks/useRating', () => ({ useRating: () => 0 }));
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
jest.mock('../../components/NowPlayingIndicator', () => {
  const { View } = require('react-native');
  return { NowPlayingIndicator: () => <View /> };
});
jest.mock('../../components/RowMetaLine', () => {
  const { View } = require('react-native');
  return { RowMetaLine: () => <View testID="row-meta" /> };
});
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
jest.mock('../../services/moreOptionsService', () => ({
  addSongToQueue: jest.fn(),
  toggleStar: jest.fn(),
}));
jest.mock('../../services/playerService', () => ({ playTrack: jest.fn() }));

jest.mock('../../store/persistence/db', () => ({ getDb: () => null }));
jest.mock('../../db/repository/details', () => ({ getAlbumDetail: jest.fn() }));
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: Object.assign(
    (sel: (s: { offlineMode: boolean }) => unknown) => sel({ offlineMode: false }),
    { getState: () => ({ offlineMode: false }) },
  ),
}));
jest.mock('../../store/addToPlaylistStore', () => ({
  addToPlaylistStore: { getState: () => ({ showSong: jest.fn() }) },
}));
jest.mock('../../store/moreOptionsStore', () => ({
  moreOptionsStore: { getState: () => ({ show: jest.fn() }) },
}));

const album = {
  id: 'a1',
  name: 'Classical Sampler',
  artist: 'Various Artists',
  song: [
    {
      id: 's1',
      title: 'Air on the G String',
      artist: 'Yo-Yo Ma',
      duration: 240,
      displayComposer: 'J.S. Bach',
    },
    {
      id: 's2',
      title: 'An die Musik',
      artist: 'Renée Fleming',
      duration: 200,
      displayComposer: 'W.A. Mozart',
    },
    {
      id: 's3',
      title: 'Untitled Study',
      artist: 'Studio Band',
      duration: 150,
    },
  ] as Child[],
} as unknown as AlbumWithSongsID3;

jest.mock('../../services/detailFetchService', () => ({
  fetchAlbumDetail: jest.fn(async () => album),
}));

import { AlbumDetailScreen } from '../album-detail';

describe('AlbumDetailScreen — composer rendering', () => {
  it('shows each compilation track\'s own composer, and no line for a track without one', async () => {
    const { getByText, queryAllByLabelText } = render(<AlbumDetailScreen />);

    await waitFor(() => expect(getByText('J.S. Bach')).toBeTruthy());
    expect(getByText('W.A. Mozart')).toBeTruthy();

    // Performer names still render on their own line — the composer line is additive,
    // never swapped in for a missing composer.
    expect(getByText('Yo-Yo Ma')).toBeTruthy();
    expect(getByText('Studio Band')).toBeTruthy();

    // Exactly two composer lines — s3 (no displayComposer) contributes none, and the
    // album's own "Various Artists" credit never stands in for a per-track composer.
    expect(queryAllByLabelText(/Composer:/)).toHaveLength(2);
  });
});
