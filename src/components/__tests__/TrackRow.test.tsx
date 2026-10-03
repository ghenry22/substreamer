jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      card: '#111',
      textPrimary: '#fff',
      textSecondary: '#888',
      border: '#333',
      primary: '#1D9BF0',
      red: '#e91429',
      orange: '#FF9500',
    },
  }),
}));

let mockDownloadStatus: 'none' | 'queued' | 'downloading' | 'partial' | 'complete' = 'none';
let mockStarred = false;
let mockRating = 0;

jest.mock('../../hooks/useDownloadStatus', () => ({
  useDownloadStatus: () => mockDownloadStatus,
}));
jest.mock('../../hooks/useIsStarred', () => ({ useIsStarred: () => mockStarred }));
jest.mock('../../hooks/useRating', () => ({ useRating: () => mockRating }));

jest.mock('../../services/moreOptionsService', () => ({
  addSongToQueue: jest.fn(),
  toggleStar: jest.fn(),
}));

jest.mock('../../services/playerService', () => ({
  playTrack: jest.fn(),
}));

jest.mock('../CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: () => <View /> };
});

jest.mock('../NowPlayingIndicator', () => {
  const { View } = require('react-native');
  return {
    NowPlayingIndicator: () => <View testID="now-playing-indicator" />,
  };
});

jest.mock('../RowMetaLine', () => {
  const { View } = require('react-native');
  return { RowMetaLine: () => <View testID="row-meta" /> };
});

// SwipeableRow mock that respects the new `disabled` prop. When disabled,
// the central press surface is rendered as a plain View (no onPress to
// dispatch) and swipe-action buttons are NOT rendered — production also
// gates the gesture handler off via `enabled={!disabled}` on the
// underlying ReanimatedSwipeable, so this mock matches that behaviour
// at the level a unit test can observe.
jest.mock('../SwipeableRow', () => {
  const { View, Pressable, Text } = require('react-native');
  return {
    SwipeableRow: ({
      children,
      leftActions,
      rightActions,
      onLongPress,
      onPress,
      disabled,
    }: {
      children: React.ReactNode;
      leftActions?: { label: string; onPress: () => void }[];
      rightActions?: { label: string; onPress: () => void }[];
      onLongPress?: () => void;
      onPress?: () => void;
      disabled?: boolean;
    }) => (
      <View testID={disabled ? 'swipe-row-disabled' : 'swipe-row'}>
        {children}
        {disabled ? (
          <View>
            <Text>swipe-row-press</Text>
          </View>
        ) : (
          <Pressable onPress={onPress} onLongPress={onLongPress}>
            <Text>swipe-row-press</Text>
          </Pressable>
        )}
        {!disabled &&
          leftActions?.map((a, i: number) => (
            <Pressable key={`l-${i}`} onPress={a.onPress}>
              <Text>{`left-${a.label}`}</Text>
            </Pressable>
          ))}
        {!disabled &&
          rightActions?.map((a, i: number) => (
            <Pressable key={`r-${i}`} onPress={a.onPress}>
              <Text>{`right-${a.label}`}</Text>
            </Pressable>
          ))}
      </View>
    ),
  };
});

let mockOfflineMode = false;
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: Object.assign(
    (sel: (s: { offlineMode: boolean }) => unknown) => sel({ offlineMode: mockOfflineMode }),
    { getState: () => ({ offlineMode: mockOfflineMode }) },
  ),
}));

jest.mock('../../store/addToPlaylistStore', () => ({
  addToPlaylistStore: {
    getState: () => ({ showSong: jest.fn() }),
  },
}));
const mockShowMoreOptions = jest.fn();
jest.mock('../../store/moreOptionsStore', () => ({
  moreOptionsStore: {
    getState: () => ({ show: mockShowMoreOptions }),
  },
}));

import { TrackRow } from '../TrackRow';
import type { Child } from '../../services/subsonicService';

const colors = {
  background: '#000',
  card: '#111',
  textPrimary: '#fff',
  textSecondary: '#888',
  border: '#333',
  primary: '#1D9BF0',
  red: '#e91429',
  orange: '#FF9500',
} as unknown as Parameters<typeof TrackRow>[0]['colors'];

const track: Child = {
  id: 's1',
  title: 'Test Track',
  artist: 'Test Artist',
  duration: 180,
} as unknown as Child;

beforeEach(() => {
  mockDownloadStatus = 'none';
  mockOfflineMode = false;
  mockStarred = false;
  mockRating = 0;
  mockShowMoreOptions.mockClear();
});

describe('TrackRow — offline-unplayable disabled state', () => {
  it('online + not downloaded: row is interactive, onPress fires on tap', () => {
    mockOfflineMode = false;
    mockDownloadStatus = 'none';
    const onPress = jest.fn();
    const { getByText, queryByTestId } = render(
      <TrackRow track={track} colors={colors} onPress={onPress} />,
    );

    expect(queryByTestId('swipe-row')).toBeTruthy();
    expect(queryByTestId('swipe-row-disabled')).toBeNull();

    fireEvent.press(getByText('swipe-row-press'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('online + complete: row is interactive', () => {
    mockOfflineMode = false;
    mockDownloadStatus = 'complete';
    const onPress = jest.fn();
    const { getByText, queryByTestId } = render(
      <TrackRow track={track} colors={colors} onPress={onPress} />,
    );

    expect(queryByTestId('swipe-row')).toBeTruthy();
    fireEvent.press(getByText('swipe-row-press'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('offline + complete: row stays interactive (cached track plays fine)', () => {
    mockOfflineMode = true;
    mockDownloadStatus = 'complete';
    const onPress = jest.fn();
    const { getByText, queryByTestId } = render(
      <TrackRow track={track} colors={colors} onPress={onPress} />,
    );

    expect(queryByTestId('swipe-row')).toBeTruthy();
    expect(queryByTestId('swipe-row-disabled')).toBeNull();
    fireEvent.press(getByText('swipe-row-press'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('offline + not downloaded: row is disabled (no Pressable, onPress unreachable)', () => {
    mockOfflineMode = true;
    mockDownloadStatus = 'none';
    const onPress = jest.fn();
    const { queryByTestId, UNSAFE_queryAllByType } = render(
      <TrackRow track={track} colors={colors} onPress={onPress} />,
    );

    expect(queryByTestId('swipe-row-disabled')).toBeTruthy();
    expect(queryByTestId('swipe-row')).toBeNull();

    // The mock SwipeableRow renders no Pressable when disabled — asserting
    // its absence proves the user can't tap to trigger onPress. The
    // production SwipeableRow gates the gesture handler off via
    // `enabled={!disabled}` and the Pressable via `disabled={disabled}`,
    // so the user-facing behaviour is the same: no callback fires.
    const Pressable = require('react-native').Pressable;
    expect(UNSAFE_queryAllByType(Pressable)).toHaveLength(0);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('offline + queued: row is disabled (download not yet complete)', () => {
    mockOfflineMode = true;
    mockDownloadStatus = 'queued';
    const onPress = jest.fn();
    const { queryByTestId } = render(
      <TrackRow track={track} colors={colors} onPress={onPress} />,
    );
    expect(queryByTestId('swipe-row-disabled')).toBeTruthy();
  });

  it('offline + downloading: row is disabled (download in flight)', () => {
    mockOfflineMode = true;
    mockDownloadStatus = 'downloading';
    const onPress = jest.fn();
    const { queryByTestId } = render(
      <TrackRow track={track} colors={colors} onPress={onPress} />,
    );
    expect(queryByTestId('swipe-row-disabled')).toBeTruthy();
  });

  it('offline + not downloaded: swipe-right add-to-queue is suppressed', () => {
    mockOfflineMode = true;
    mockDownloadStatus = 'none';
    const { queryByText } = render(
      <TrackRow track={track} colors={colors} onPress={jest.fn()} />,
    );
    // Swipe-right action labels start with 'right-'; they must not render
    // when the row is disabled.
    expect(queryByText(/^right-/)).toBeNull();
  });

  it('online + not downloaded: swipe-right add-to-queue still works', () => {
    mockOfflineMode = false;
    mockDownloadStatus = 'none';
    const { addSongToQueue } = require('../../services/moreOptionsService');
    const { getByText } = render(
      <TrackRow track={track} colors={colors} onPress={jest.fn()} />,
    );
    fireEvent.press(getByText(/^right-/));
    expect(addSongToQueue).toHaveBeenCalledWith(track);
  });

  it('offline + not downloaded: View carries accessibilityState disabled', () => {
    mockOfflineMode = true;
    mockDownloadStatus = 'none';
    const { UNSAFE_getAllByType } = render(
      <TrackRow track={track} colors={colors} onPress={jest.fn()} />,
    );
    // The inner trackRow View is the one with accessibilityState set.
    const View = require('react-native').View;
    const views = UNSAFE_getAllByType(View);
    const disabledView = views.find(
      (v: { props: { accessibilityState?: { disabled?: boolean } } }) =>
        v.props.accessibilityState?.disabled === true,
    );
    expect(disabledView).toBeTruthy();
  });

  it('online + not downloaded: View has no accessibilityState', () => {
    mockOfflineMode = false;
    mockDownloadStatus = 'none';
    const { UNSAFE_getAllByType } = render(
      <TrackRow track={track} colors={colors} onPress={jest.fn()} />,
    );
    const View = require('react-native').View;
    const views = UNSAFE_getAllByType(View);
    const disabledView = views.find(
      (v: { props: { accessibilityState?: { disabled?: boolean } } }) =>
        v.props.accessibilityState?.disabled === true,
    );
    expect(disabledView).toBeUndefined();
  });
});

describe('TrackRow — composer subtitle line', () => {
  it('showComposer true + displayComposer set: composer text renders', () => {
    const trackWithComposer = { ...track, displayComposer: 'J.S. Bach' } as Child;
    const { getByText } = render(
      <TrackRow track={trackWithComposer} colors={colors} onPress={jest.fn()} showComposer />,
    );
    expect(getByText('J.S. Bach')).toBeTruthy();
  });

  it('showComposer true + no displayComposer: no composer text, artist not shown in its place', () => {
    const { queryByText, getAllByText } = render(
      <TrackRow track={track} colors={colors} onPress={jest.fn()} showComposer />,
    );
    // Artist line still renders once (its normal slot); it must not also
    // appear a second time standing in for the missing composer line.
    expect(getAllByText('Test Artist')).toHaveLength(1);
    expect(queryByText(/Bach/)).toBeNull();
  });

  it('showComposer false + displayComposer set: no composer text (other screens unaffected)', () => {
    const trackWithComposer = { ...track, displayComposer: 'J.S. Bach' } as Child;
    const { queryByText } = render(
      <TrackRow track={trackWithComposer} colors={colors} onPress={jest.fn()} />,
    );
    expect(queryByText('J.S. Bach')).toBeNull();
  });

  it('renders a multi-composer string verbatim', () => {
    const trackWithComposers = { ...track, displayComposer: 'Bach, Handel' } as Child;
    const { getByText } = render(
      <TrackRow track={trackWithComposers} colors={colors} onPress={jest.fn()} showComposer />,
    );
    expect(getByText('Bach, Handel')).toBeTruthy();
  });

  it('composer Text truncates to one line', () => {
    const trackWithComposer = { ...track, displayComposer: 'J.S. Bach' } as Child;
    const { getByText } = render(
      <TrackRow track={trackWithComposer} colors={colors} onPress={jest.fn()} showComposer />,
    );
    expect(getByText('J.S. Bach').props.numberOfLines).toBe(1);
  });

  it('composer Text exposes an accessibility label containing the localized "Composer"', () => {
    const trackWithComposer = { ...track, displayComposer: 'J.S. Bach' } as Child;
    const { getByText } = render(
      <TrackRow track={trackWithComposer} colors={colors} onPress={jest.fn()} showComposer />,
    );
    expect(getByText('J.S. Bach').props.accessibilityLabel).toContain('Composer');
  });
});

describe('TrackRow — optionsSource passthrough', () => {
  it('forwards optionsSource to moreOptionsStore.show on long press', () => {
    const { getByText } = render(
      <TrackRow
        track={track}
        colors={colors}
        onPress={jest.fn()}
        optionsSource="playlist-detail"
      />,
    );

    fireEvent(getByText('swipe-row-press'), 'longPress');
    expect(mockShowMoreOptions).toHaveBeenCalledTimes(1);
    expect(mockShowMoreOptions).toHaveBeenCalledWith(
      { type: 'song', item: track },
      'playlist-detail',
    );
  });

  it('passes undefined when no optionsSource is given, so the store default applies', () => {
    const { getByText } = render(
      <TrackRow track={track} colors={colors} onPress={jest.fn()} />,
    );

    fireEvent(getByText('swipe-row-press'), 'longPress');
    expect(mockShowMoreOptions).toHaveBeenCalledTimes(1);
    // No source at all — the store's own `= 'default'` parameter default applies.
    // Asserted on the arg rather than the call shape so `show(entity)` and
    // `show(entity, undefined)` both count; a leaked source does not.
    expect(mockShowMoreOptions.mock.calls[0][0]).toEqual({ type: 'song', item: track });
    expect(mockShowMoreOptions.mock.calls[0][1]).toBeUndefined();
  });
});
