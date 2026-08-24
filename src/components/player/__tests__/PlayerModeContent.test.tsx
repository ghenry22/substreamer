jest.mock('@/hooks/useSongCoverArt', () => ({ useSongCoverArt: () => 'cover' }));
jest.mock('@/hooks/useDownloadStatus', () => ({ useDownloadStatus: () => 'none' }));
jest.mock('@/hooks/useIsStarred', () => ({ useIsStarred: () => false }));
jest.mock('@/hooks/useRating', () => ({ useRating: () => 0 }));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { textPrimary: '#fff', textSecondary: '#aaa' } }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/hooks/usePlayerAlbumInfo', () => ({
  usePlayerAlbumInfo: () => ({
    entry: undefined,
    loading: false,
    error: null,
    refreshing: false,
    handleRetry: jest.fn(),
    handleRefresh: jest.fn(),
  }),
}));

jest.mock('@/hooks/usePlayerLyrics', () => ({
  usePlayerLyrics: () => ({
    entry: undefined,
    loading: false,
    error: null,
    handleRetry: jest.fn(),
  }),
}));

jest.mock('@/components/AlbumInfoContent', () => {
  const { Text } = require('react-native');
  return { AlbumInfoContent: () => <Text>Album information</Text> };
});

jest.mock('@/components/LyricsContent', () => {
  const { Text } = require('react-native');
  return { LyricsContent: () => <Text>Lyrics content</Text> };
});

jest.mock('@/components/CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: () => <View testID="cover" /> };
});

jest.mock('@/components/NowPlayingIndicator', () => {
  const { View } = require('react-native');
  return { NowPlayingIndicator: () => <View testID="now-playing-indicator" /> };
});

jest.mock('@/components/RowMetaLine', () => ({ RowMetaLine: () => null }));

jest.mock('@/components/SwipeableRow', () => {
  const { Pressable } = require('react-native');
  return {
    SwipeableRow: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
      <Pressable onPress={onPress}>{children}</Pressable>
    ),
    closeOpenRow: jest.fn(),
  };
});

jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    FlashList: ({ data, renderItem, ListFooterComponent }: {
      data: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
      ListFooterComponent?: React.ComponentType;
    }) => (
      <View testID="flash-list">
        {data.map((item, index) => (
          <View key={index} testID={`flash-item-${index}`}>
            {renderItem({ item, index })}
          </View>
        ))}
        {ListFooterComponent ? React.createElement(ListFooterComponent) : null}
      </View>
    ),
  };
});

import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';

import { PlayerModeContent, type PlayerModeContentProps } from '../PlayerModeContent';
import { playerStore } from '@/store/playerStore';

import type { ThemeColors } from '@/constants/theme';
import type { Child } from '@/services/subsonicService';

const colors = {
  background: '#000',
  card: '#111',
  textPrimary: '#fff',
  textSecondary: '#aaa',
  primary: '#f60',
  border: '#333',
  label: '#aaa',
  red: '#f00',
  inputBg: '#222',
} as ThemeColors;

const tracks = [
  { id: 'one', title: 'First Song', artist: 'Artist', duration: 100 },
  { id: 'two', title: 'Second Song', artist: 'Artist', duration: 100 },
  { id: 'three', title: 'Third Song', artist: 'Artist', duration: 100 },
] as Child[];

const baseProps = (): PlayerModeContentProps => ({
  mode: 'queue',
  currentTrack: tracks[1],
  queue: tracks,
  queueOrigins: ['manual', 'manual', 'autoplay'],
  currentTrackIndex: 1,
  colors,
  queueColors: colors,
  onQueueItemPress: jest.fn(),
  onQueueItemLongPress: jest.fn(),
  onShareQueue: jest.fn(),
  onClearQueue: jest.fn(),
});

beforeEach(() => {
  playerStore.setState({
    currentTrack: tracks[1],
    currentTrackIndex: 1,
    queue: tracks,
    queueOrigins: ['manual', 'manual', 'autoplay'],
    autoplayLoading: false,
  });
});

describe('PlayerModeContent', () => {
  it('places the autoplay heading immediately before the first upcoming autoplay row', () => {
    const view = render(<PlayerModeContent {...baseProps()} />);

    expect(view.getAllByText('Autoplay')).toHaveLength(1);
    expect(within(view.getByTestId('flash-item-1')).queryByText('Autoplay')).toBeNull();
    expect(within(view.getByTestId('flash-item-2')).getByText('Autoplay')).toBeTruthy();
    expect(within(view.getByTestId('flash-item-2')).getByText('Third Song')).toBeTruthy();
  });

  it('shows progress only while recommendations are loading', () => {
    playerStore.setState({ autoplayLoading: true });
    const view = render(<PlayerModeContent {...baseProps()} />);

    expect(view.getByText('Building your autoplay queue…')).toBeTruthy();
    act(() => playerStore.setState({ autoplayLoading: false }));
    expect(view.queryByText('Building your autoplay queue…')).toBeNull();
  });

  it('wires the queue actions and row selection', () => {
    const props = baseProps();
    const view = render(<PlayerModeContent {...props} />);

    fireEvent.press(view.getByLabelText('Share queue'));
    fireEvent.press(view.getByLabelText('Clear Queue'));
    fireEvent.press(view.getByText('Third Song'));

    expect(props.onShareQueue).toHaveBeenCalled();
    expect(props.onClearQueue).toHaveBeenCalled();
    expect(props.onQueueItemPress).toHaveBeenCalledWith(2);
  });

  it('omits queue actions when the queue is empty', () => {
    const view = render(<PlayerModeContent {...baseProps()} queue={[]} queueOrigins={[]} />);
    expect(view.queryByLabelText('Share queue')).toBeNull();
    expect(view.queryByLabelText('Clear Queue')).toBeNull();
  });

  it('renders album information and lyrics modes', () => {
    const view = render(<PlayerModeContent {...baseProps()} mode="info" />);
    expect(view.getByText('Album information')).toBeTruthy();

    view.rerender(<PlayerModeContent {...baseProps()} mode="lyrics" />);
    expect(view.getByText('Lyrics content')).toBeTruthy();
  });

  it('renders lyrics when the current track has no duration', () => {
    const currentTrack = { ...tracks[0], duration: undefined } as Child;
    const view = render(
      <PlayerModeContent {...baseProps()} mode="lyrics" currentTrack={currentTrack} />,
    );
    expect(view.getByText('Lyrics content')).toBeTruthy();
  });
});
