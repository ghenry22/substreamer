jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

const mockRowState = { starred: false, downloadStatus: 'none' };
jest.mock('../../hooks/useIsStarred', () => ({
  useIsStarred: () => mockRowState.starred,
}));
jest.mock('../../hooks/useDownloadStatus', () => ({
  useDownloadStatus: () => mockRowState.downloadStatus,
}));
jest.mock('../../hooks/useRating', () => ({ useRating: () => 0 }));
jest.mock('../../hooks/useSongCoverArt', () => ({ useSongCoverArt: () => 'cover' }));
jest.mock('../CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: () => <View testID="cover" /> };
});
jest.mock('../NowPlayingIndicator', () => {
  const { View } = require('react-native');
  return { NowPlayingIndicator: () => <View testID="now-playing" /> };
});
jest.mock('../RowMetaLine', () => ({ RowMetaLine: () => null }));
jest.mock('../SwipeableRow', () => {
  const { Pressable } = require('react-native');
  return {
    SwipeableRow: ({ children, onPress, onLongPress }: {
      children: React.ReactNode;
      onPress: () => void;
      onLongPress?: () => void;
    }) => <Pressable onPress={onPress} onLongPress={onLongPress}>{children}</Pressable>,
  };
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { QueueItemRow } from '../QueueItemRow';
import { offlineModeStore } from '../../store/offlineModeStore';

import type { Child } from '../../services/subsonicService';

const colors = {
  textPrimary: '#fff', textSecondary: '#aaa', primary: '#f60', border: '#333', red: '#f00',
};

beforeEach(() => {
  mockRowState.starred = false;
  mockRowState.downloadStatus = 'none';
  offlineModeStore.setState({ offlineMode: false });
});

it('renders an offline inactive row with missing optional metadata', () => {
  offlineModeStore.setState({ offlineMode: true });
  const onPress = jest.fn();
  const view = render(
    <QueueItemRow
      track={{ id: 'one', title: 'Untitled Artist' } as Child}
      index={2}
      isActive={false}
      colors={colors}
      onPress={onPress}
    />,
  );

  fireEvent.press(view.getByText('Untitled Artist'));
  expect(onPress).toHaveBeenCalledWith(2);
  expect(view.queryByText('Autoplay')).toBeNull();
  expect(view.queryByTestId('now-playing')).toBeNull();
});

it.each(['complete', 'partial'] as const)(
  'renders active starred rows with %s download status', (downloadStatus) => {
    mockRowState.starred = true;
    mockRowState.downloadStatus = downloadStatus;
    const onLongPress = jest.fn();
    const track = { id: 'one', title: 'Song', artist: 'Artist', duration: 90 } as Child;
    const view = render(
      <QueueItemRow
        track={track}
        index={0}
        isActive
        startsAutoplaySection
        colors={colors}
        onPress={jest.fn()}
        onLongPress={onLongPress}
      />,
    );

    fireEvent(view.getByText('Song'), 'longPress');
    expect(onLongPress).toHaveBeenCalledWith(track);
    expect(view.getByText('Autoplay')).toBeTruthy();
    expect(view.getByTestId('now-playing')).toBeTruthy();
  },
);
