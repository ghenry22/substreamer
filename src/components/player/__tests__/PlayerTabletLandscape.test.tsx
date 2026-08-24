/**
 * The landscape player is root-mounted (`app/_layout.tsx`) and stays mounted
 * while collapsed, so its lyrics fetch is gated on `tabletLayoutStore
 * .playerExpanded` rather than on the mount. Plan step 5.3.
 */
jest.mock('@/store/persistence/kvStorage', () => require('@/store/persistence/__mocks__/kvStorage'));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'dark',
    colors: {
      background: '#000000',
      card: '#1e1e1e',
      textPrimary: '#ffffff',
      textSecondary: '#888888',
      primary: '#ff6600',
      border: '#333333',
      label: '#aaaaaa',
      red: '#ff0000',
      inputBg: '#222222',
    },
  }),
}));

const mockCanSkipState = { canSkipNext: true, canSkipPrevious: true };
jest.mock('@/hooks/useCanSkip', () => ({ useCanSkip: () => mockCanSkipState }));

jest.mock('@/hooks/useCoverGradient', () => ({
  useCoverGradient: () => ({
    gradientColors: ['#111111', '#000000'],
    gradientLocations: [0, 1],
    gradientOpacity: { value: 1 },
  }),
}));

jest.mock('@/hooks/useSongCoverArt', () => ({
  useSongCoverArt: () => 'cover-1',
}));

jest.mock('@/hooks/useDownloadStatus', () => ({ useDownloadStatus: () => 'none' }));
jest.mock('@/hooks/useIsStarred', () => ({ useIsStarred: () => false }));
jest.mock('@/hooks/useRating', () => ({ useRating: () => 0 }));

const mockPlaybackState = { isPlaying: true, isBuffering: false };
jest.mock('@/hooks/usePlaybackState', () => ({ usePlaybackState: () => mockPlaybackState }));

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => ({
    handleSeek: jest.fn(),
    handleQueueItemPress: jest.fn(),
    handleQueueItemLongPress: jest.fn(),
    handleShareQueue: jest.fn(),
    handleClearQueue: jest.fn(),
  }),
}));

const mockShuffleState = { shuffling: false };
jest.mock('@/hooks/useShuffleOverlay', () => ({
  useShuffleOverlay: () => ({
    shuffling: mockShuffleState.shuffling,
    handleShuffle: jest.fn(),
    overlayStyle: {},
    spinStyle: {},
  }),
}));

// Album info has its own gate (`rightPanelMode === 'info'`) and its own store —
// stubbed so this suite only exercises the lyrics gate.
const mockAlbumInfoState = {
  entry: undefined as undefined | {
    albumInfo: { notes?: string };
    enrichedNotes?: string;
    enrichedNotesUrl?: string;
    overrideMbid?: string;
  },
};
jest.mock('@/hooks/usePlayerAlbumInfo', () => ({
  usePlayerAlbumInfo: () => ({
    entry: mockAlbumInfoState.entry,
    loading: false,
    error: null,
    refreshing: false,
    handleRetry: jest.fn(),
    handleRefresh: jest.fn(),
  }),
}));

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props: object) => <View {...props} /> };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (init: number) => ({ value: init }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (val: number) => val,
    withSpring: (val: number) => val,
    cancelAnimation: jest.fn(),
    interpolate: (val: number, _input: number[], output: number[]) =>
      val === 0 ? output[0] : output[1],
    Extrapolation: { CLAMP: 'clamp' },
    Easing: { out: (e: unknown) => e, cubic: (t: number) => t, inOut: (e: unknown) => e },
    runOnJS: (fn: Function) => fn,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@/components/CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: () => <View testID="cover" /> };
});

jest.mock('@/components/GradientBackground', () => {
  const { View } = require('react-native');
  return { GradientBackground: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});

jest.mock('@/components/MarqueeText', () => {
  const { Text } = require('react-native');
  return { MarqueeText: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text> };
});

jest.mock('@/components/BookmarkButton', () => {
  const { View } = require('react-native');
  return { BookmarkButton: () => <View testID="bookmark-button" /> };
});

jest.mock('@/components/FavoriteButton', () => {
  const { View } = require('react-native');
  return { FavoriteButton: () => <View testID="favorite-button" /> };
});

jest.mock('@/components/MoreOptionsButton', () => {
  const { View } = require('react-native');
  return { MoreOptionsButton: () => <View testID="more-options" /> };
});

jest.mock('@/components/PlaybackRateButton', () => {
  const { View } = require('react-native');
  return { PlaybackRateButton: () => <View testID="rate-button" /> };
});

jest.mock('@/components/PlayerProgressBar', () => {
  const { View } = require('react-native');
  return { PlayerProgressBar: () => <View testID="progress-bar" /> };
});

jest.mock('@/components/RepeatButton', () => {
  const { View } = require('react-native');
  return { RepeatButton: () => <View testID="repeat-button" /> };
});

jest.mock('@/components/ShuffleButton', () => {
  const { View } = require('react-native');
  return { ShuffleButton: () => <View testID="shuffle-button" /> };
});

jest.mock('@/components/ShuffleOverlay', () => {
  const { View } = require('react-native');
  return { ShuffleOverlay: () => <View testID="shuffle-overlay" /> };
});

jest.mock('@/components/SkipIntervalButton', () => {
  const { View } = require('react-native');
  return { SkipIntervalButton: () => <View testID="skip-interval" /> };
});

jest.mock('@/components/SleepTimerButton', () => {
  const { View } = require('react-native');
  return { SleepTimerButton: () => <View testID="sleep-timer-button" /> };
});

jest.mock('@/components/SleepTimerCapsule', () => {
  const { View } = require('react-native');
  return { SleepTimerCapsule: () => <View testID="sleep-timer-capsule" /> };
});

jest.mock('@/components/SwipeableRow', () => {
  const { Pressable } = require('react-native');
  return {
    SwipeableRow: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
      <Pressable onPress={onPress}>{children}</Pressable>
    ),
    closeOpenRow: jest.fn(),
  };
});

jest.mock('@/components/NowPlayingIndicator', () => {
  const { View } = require('react-native');
  return { NowPlayingIndicator: () => <View testID="now-playing-indicator" /> };
});

jest.mock('@/components/RowMetaLine', () => ({ RowMetaLine: () => null }));

jest.mock('@/components/AlbumInfoContent', () => {
  const { Text } = require('react-native');
  return { AlbumInfoContent: () => <Text>AlbumInfoContent</Text> };
});

jest.mock('@/components/LyricsContent', () => {
  const { Text } = require('react-native');
  return { LyricsContent: () => <Text>LyricsContent</Text> };
});

jest.mock('@/store/lyricsStore', () => {
  const fetchLyrics = jest.fn();
  const state = {
    entries: {},
    loading: {},
    errors: {},
    fetchLyrics,
    clearLyrics: jest.fn(),
  };
  const store = (selector: (s: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  store.setState = jest.fn();
  return { lyricsStore: store };
});

jest.mock('@/services/playerService', () => ({
  retryPlayback: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  togglePlayPause: jest.fn(),
}));

jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    FlashList: React.forwardRef(function MockFlashList(
      { data, renderItem, ListFooterComponent, keyExtractor }: {
        data: unknown[];
        renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
        ListFooterComponent?: React.ComponentType;
        keyExtractor?: (item: unknown, index: number) => string;
      },
      _ref: unknown,
    ) {
      return (
        <View testID="flash-list">
          {data?.map((item: unknown, index: number) => (
            <View
              key={keyExtractor ? keyExtractor(item, index) : String(index)}
              testID={`flash-item-${index}`}
            >
              {renderItem({ item, index })}
            </View>
          ))}
          {ListFooterComponent ? React.createElement(ListFooterComponent) : null}
        </View>
      );
    }),
  };
});

import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { type SharedValue } from 'react-native-reanimated';

import { PlayerTabletLandscape } from '@/components/player/PlayerTabletLandscape';
import { PlayerTabletSplitview } from '@/components/player/PlayerTabletSplitview';
import { appStateStore } from '@/store/appStateStore';
import { lyricsStore } from '@/store/lyricsStore';
import { offlineModeStore } from '@/store/offlineModeStore';
import { playbackSettingsStore } from '@/store/playbackSettingsStore';
import { playerStore } from '@/store/playerStore';
import { tabletLayoutStore } from '@/store/tabletLayoutStore';
import { type Child } from '@/services/subsonicService';

const MOCK_TRACK: Child = {
  id: 'track-1',
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  albumId: 'album-1',
  coverArt: 'cover-1',
  isDir: false,
  parent: '',
} as Child;

const MOCK_QUEUE: Child[] = [
  MOCK_TRACK,
  { ...MOCK_TRACK, id: 'track-2', title: 'Second Song' } as Child,
  { ...MOCK_TRACK, id: 'track-3', title: 'Third Song' } as Child,
];

const expandProgress = { value: 0 } as SharedValue<number>;

const fetchLyrics = lyricsStore.getState().fetchLyrics as jest.Mock;

beforeEach(() => {
  expandProgress.value = 0;
  mockCanSkipState.canSkipNext = true;
  mockCanSkipState.canSkipPrevious = true;
  mockPlaybackState.isPlaying = true;
  mockPlaybackState.isBuffering = false;
  mockShuffleState.shuffling = false;
  mockAlbumInfoState.entry = undefined;
  fetchLyrics.mockClear();
  appStateStore.setState({ isActive: true });
  offlineModeStore.setState({ offlineMode: false });
  playbackSettingsStore.setState({
    showSkipIntervalButtons: false,
    showSleepTimerButton: false,
  });
  tabletLayoutStore.setState({ playerExpanded: false });
  playerStore.setState({
    currentTrack: MOCK_TRACK,
    currentTrackIndex: 0,
    queue: [MOCK_TRACK],
    queueOrigins: ['manual'],
    queueLoading: false,
    autoplayLoading: false,
    playbackState: 'playing',
    position: 30,
    duration: 180,
    bufferedPosition: 60,
    error: null,
    retrying: false,
  });
});

describe('PlayerTabletLandscape lyrics gate', () => {
  it('renders nothing without a current track', () => {
    playerStore.setState({ currentTrack: null });
    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);
    expect(view.toJSON()).toBeNull();
  });

  it('does not fetch lyrics while collapsed, even as tracks change', () => {
    render(<PlayerTabletLandscape expandProgress={expandProgress} />);

    expect(fetchLyrics).not.toHaveBeenCalled();

    act(() => {
      playerStore.setState({ currentTrack: { ...MOCK_TRACK, id: 'track-2' } as Child });
    });

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it('fetches the in-progress track when the player is expanded', () => {
    render(<PlayerTabletLandscape expandProgress={expandProgress} />);
    expect(fetchLyrics).not.toHaveBeenCalled();

    act(() => {
      tabletLayoutStore.getState().setPlayerExpanded(true);
    });

    expect(fetchLyrics).toHaveBeenCalledTimes(1);
    expect(fetchLyrics).toHaveBeenCalledWith('track-1', 'Test Artist', 'Test Song');
  });

  it('fetches on mount when the player is already expanded', () => {
    tabletLayoutStore.setState({ playerExpanded: true });

    render(<PlayerTabletLandscape expandProgress={expandProgress} />);

    expect(fetchLyrics).toHaveBeenCalledTimes(1);
    expect(fetchLyrics).toHaveBeenCalledWith('track-1', 'Test Artist', 'Test Song');
  });

  it('does not fetch while expanded but backgrounded', () => {
    appStateStore.setState({ isActive: false });
    tabletLayoutStore.setState({ playerExpanded: true });

    render(<PlayerTabletLandscape expandProgress={expandProgress} />);

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it('places one autoplay heading immediately before the first upcoming autoplay row', () => {
    expandProgress.value = 1;
    tabletLayoutStore.setState({ playerExpanded: true });
    playerStore.setState({
      currentTrack: MOCK_QUEUE[1],
      currentTrackIndex: 1,
      queue: MOCK_QUEUE,
      queueOrigins: ['manual', 'manual', 'autoplay'],
    });

    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);

    expect(view.getAllByText('Autoplay')).toHaveLength(1);
    expect(within(view.getByTestId('flash-item-1')).queryByText('Autoplay')).toBeNull();
    expect(within(view.getByTestId('flash-item-2')).getByText('Autoplay')).toBeTruthy();
    expect(within(view.getByTestId('flash-item-2')).getByText('Third Song')).toBeTruthy();
  });

  it('shows autoplay progress only while recommendations are loading', () => {
    expandProgress.value = 1;
    tabletLayoutStore.setState({ playerExpanded: true });
    playerStore.setState({ autoplayLoading: true });
    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);

    expect(view.getByText('Building your autoplay queue…')).toBeTruthy();
    expect(view.getByLabelText('Building your autoplay queue…')).toBeTruthy();

    act(() => playerStore.setState({ autoplayLoading: false }));
    expect(view.queryByText('Building your autoplay queue…')).toBeNull();
  });

  it('renders metadata, optional controls, and measured cover art', () => {
    playbackSettingsStore.setState({
      showSkipIntervalButtons: true,
      showSleepTimerButton: true,
    });
    playerStore.setState({
      currentTrack: {
        ...MOCK_TRACK,
        suffix: 'flac',
        bitRate: 900,
        year: 2024,
      } as Child,
      queue: MOCK_QUEUE,
    });
    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);
    const layoutHost = view.UNSAFE_getAllByType(require('react-native').View)
      .find((node) => typeof node.props.onLayout === 'function');

    act(() => layoutHost?.props.onLayout({ nativeEvent: { layout: { width: 300, height: 250 } } }));

    expect(view.getByText('FLAC · 900 kbps')).toBeTruthy();
    expect(view.getByText('Test Album · 2024')).toBeTruthy();
    expect(view.getByTestId('sleep-timer-button')).toBeTruthy();
    expect(view.getAllByTestId('skip-interval')).toHaveLength(2);
    expect(view.getAllByTestId('cover').length).toBeGreaterThan(0);
  });

  it('hides online-only panel controls offline', () => {
    offlineModeStore.setState({ offlineMode: true });
    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);
    expect(view.queryByLabelText('Show album info')).toBeNull();
    expect(view.queryByLabelText('Show lyrics')).toBeNull();
  });

  it('switches between queue, album information, and lyrics panels', () => {
    expandProgress.value = 1;
    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);
    fireEvent.press(view.getByLabelText('Show album info'));
    expect(view.getByText('AlbumInfoContent')).toBeTruthy();
    fireEvent.press(view.getByLabelText('Show lyrics'));
    expect(view.getByText('LyricsContent')).toBeTruthy();
    fireEvent.press(view.getByLabelText('Show queue'));
    expect(view.getByText('Queue')).toBeTruthy();
  });

  it('renders paused playback with unavailable skips and missing metadata', () => {
    mockPlaybackState.isPlaying = false;
    mockCanSkipState.canSkipNext = false;
    mockCanSkipState.canSkipPrevious = false;
    playerStore.setState({
      currentTrack: { ...MOCK_TRACK, artist: undefined, album: undefined } as Child,
      queue: [MOCK_TRACK],
    });
    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);
    expect(view.getByText('Unknown Artist')).toBeTruthy();
    expect(view.getByText('play')).toBeTruthy();
  });

  it('renders buffering instead of a play or pause icon', () => {
    mockPlaybackState.isBuffering = true;
    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);
    expect(view.queryByText('play')).toBeNull();
    expect(view.queryByText('pause')).toBeNull();
  });

  it.each(['<p>Biography</p>', '   '])(
    'normalizes supplied album notes without affecting the queue for %p', (notes) => {
      mockAlbumInfoState.entry = { albumInfo: { notes } };
      const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);
      expect(view.getByText('Queue')).toBeTruthy();
    },
  );

  it('renders while a shuffle is already in progress', () => {
    mockShuffleState.shuffling = true;
    const view = render(<PlayerTabletLandscape expandProgress={expandProgress} />);
    expect(view.getAllByTestId('shuffle-button').length).toBeGreaterThan(0);
  });
});

describe('PlayerTabletSplitview autoplay queue', () => {
  it('renders loading while a replacement queue has no current track', () => {
    playerStore.setState({ currentTrack: null, queueLoading: true });
    const view = render(<PlayerTabletSplitview />);
    expect(view.getByText('Loading…')).toBeTruthy();
  });

  it('renders nothing when idle without a current track', () => {
    playerStore.setState({ currentTrack: null, queueLoading: false });
    const view = render(<PlayerTabletSplitview />);
    expect(view.toJSON()).toBeNull();
  });

  it('places one autoplay heading immediately before the first upcoming autoplay row', () => {
    playerStore.setState({
      currentTrack: MOCK_QUEUE[1],
      currentTrackIndex: 1,
      queue: MOCK_QUEUE,
      queueOrigins: ['manual', 'manual', 'autoplay'],
    });

    const view = render(<PlayerTabletSplitview />);

    expect(view.getAllByText('Autoplay')).toHaveLength(1);
    expect(within(view.getByTestId('flash-item-1')).queryByText('Autoplay')).toBeNull();
    expect(within(view.getByTestId('flash-item-2')).getByText('Autoplay')).toBeTruthy();
    expect(within(view.getByTestId('flash-item-2')).getByText('Third Song')).toBeTruthy();
  });

  it('shows autoplay progress only while recommendations are loading', () => {
    playerStore.setState({ autoplayLoading: true });
    const view = render(<PlayerTabletSplitview />);

    expect(view.getByText('Building your autoplay queue…')).toBeTruthy();
    expect(view.getByLabelText('Building your autoplay queue…')).toBeTruthy();

    act(() => playerStore.setState({ autoplayLoading: false }));
    expect(view.queryByText('Building your autoplay queue…')).toBeNull();
  });

  it('omits queue actions when the queue is empty', () => {
    playerStore.setState({ queue: [], queueOrigins: [] });
    const view = render(<PlayerTabletSplitview />);
    expect(view.queryByLabelText('Share queue')).toBeNull();
    expect(view.queryByLabelText('Clear Queue')).toBeNull();
  });

  it('renders paused playback with unavailable skips and missing artist', () => {
    mockPlaybackState.isPlaying = false;
    mockCanSkipState.canSkipNext = false;
    mockCanSkipState.canSkipPrevious = false;
    playerStore.setState({ currentTrack: { ...MOCK_TRACK, artist: undefined } as Child });
    const view = render(<PlayerTabletSplitview />);
    expect(view.getByText('Unknown Artist')).toBeTruthy();
    expect(view.getByText('play')).toBeTruthy();
  });

  it('renders buffering instead of a play or pause icon', () => {
    mockPlaybackState.isBuffering = true;
    const view = render(<PlayerTabletSplitview />);
    expect(view.queryByText('play')).toBeNull();
    expect(view.queryByText('pause')).toBeNull();
  });
});
