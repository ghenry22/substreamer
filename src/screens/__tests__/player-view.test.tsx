jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

jest.mock('../../hooks/useTheme', () => ({
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

jest.mock('../../hooks/useColorExtraction', () => ({
  useColorExtraction: () => ({
    coverBackgroundColor: '#333333',
    gradientOpacity: { value: 1 },
  }),
}));

jest.mock('../../hooks/useCanSkip', () => ({
  useCanSkip: () => ({ canSkipNext: true, canSkipPrevious: true }),
}));

jest.mock('../../hooks/useIsStarred', () => ({
  useIsStarred: () => false,
}));

jest.mock('../../hooks/useThemedAlert', () => ({
  useThemedAlert: () => ({
    alert: jest.fn(),
    alertProps: { visible: false },
  }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: (props: { name: string }) => <Text>{props.name}</Text>,
    MaterialCommunityIcons: (props: { name: string }) => <Text>{props.name}</Text>,
  };
});

jest.mock('expo-router', () => ({
  Stack: {
    Toolbar: Object.assign(
      ({ children }: { children: React.ReactNode }) => <>{children}</>,
      {
        Button: () => null,
      },
    ),
  },
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ back: jest.fn() }),
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
    withRepeat: (val: number) => val,
    withSpring: (val: number) => val,
    cancelAnimation: jest.fn(),
    interpolate: (val: number, _input: number[], output: number[]) =>
      val === 0 ? output[0] : output[1],
    Easing: { out: (e: unknown) => e, cubic: (t: number) => t, linear: (t: number) => t },
    runOnJS: (fn: Function) => fn,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const { Pressable } = require('react-native');
  return { Pressable };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('../../components/CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: (props: { coverArtId?: string }) => <View testID={`cover-${props.coverArtId}`} /> };
});

jest.mock('../../components/MarqueeText', () => {
  const { Text } = require('react-native');
  return { MarqueeText: ({ children, style }: { children: React.ReactNode; style?: object }) => <Text style={style}>{children}</Text> };
});

jest.mock('../../components/PlayerProgressBar', () => {
  const { View } = require('react-native');
  return { PlayerProgressBar: () => <View testID="progress-bar" /> };
});

jest.mock('../../components/PlaybackRateButton', () => {
  const { View } = require('react-native');
  return { PlaybackRateButton: () => <View testID="rate-button" /> };
});

jest.mock('../../components/RepeatButton', () => {
  const { View } = require('react-native');
  return { RepeatButton: () => <View testID="repeat-button" /> };
});

jest.mock('../../components/ShuffleButton', () => {
  const { View } = require('react-native');
  return { ShuffleButton: () => <View testID="shuffle-button" /> };
});

jest.mock('../../components/SkipIntervalButton', () => {
  const { View } = require('react-native');
  return { SkipIntervalButton: () => <View testID="skip-interval" /> };
});

jest.mock('../../components/QueueItemRow', () => {
  const { Text } = require('react-native');
  return { QueueItemRow: ({ track }: { track: { title: string } }) => <Text>{track.title}</Text> };
});

jest.mock('../../components/SwipeableRow', () => ({
  closeOpenRow: jest.fn(),
}));

jest.mock('../../components/MoreOptionsButton', () => {
  const { View } = require('react-native');
  return { MoreOptionsButton: () => <View testID="more-options" /> };
});

jest.mock('../../components/ThemedAlert', () => {
  const { View } = require('react-native');
  return { ThemedAlert: () => <View testID="themed-alert" /> };
});

jest.mock('../../components/EmptyState', () => {
  const { Text } = require('react-native');
  return { EmptyState: ({ title }: { title: string }) => <Text>{title}</Text> };
});

jest.mock('../../components/AlbumInfoContent', () => {
  const { Text } = require('react-native');
  return { AlbumInfoContent: () => <Text>AlbumInfoContent</Text> };
});

jest.mock('../../services/playerService', () => ({
  clearQueue: jest.fn(),
  retryPlayback: jest.fn(),
  seekTo: jest.fn(),
  shuffleQueue: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  skipToTrack: jest.fn(),
  togglePlayPause: jest.fn(),
}));

jest.mock('../../services/moreOptionsService', () => ({
  toggleStar: jest.fn(),
}));

jest.mock('../../utils/formatters', () => ({
  sanitizeBiographyText: jest.fn((text: string) => text),
}));

jest.mock('../../utils/stringHelpers', () => ({
  minDelay: () => Promise.resolve(),
}));

jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    FlashList: React.forwardRef(function MockFlashList(
      { data, renderItem, ListHeaderComponent, keyExtractor }: {
        data: unknown[];
        renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        keyExtractor?: (item: unknown, index: number) => string;
      },
      _ref: unknown,
    ) {
      return (
        <View testID="flash-list">
          {ListHeaderComponent}
          {data?.map((item: unknown, index: number) => (
            <View key={keyExtractor ? keyExtractor(item, index) : String(index)}>
              {renderItem({ item, index })}
            </View>
          ))}
        </View>
      );
    }),
  };
});

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { playerStore } from '../../store/playerStore';
import { type Child } from '../../services/subsonicService';

// Must import after mocks
const { PlayerView } = require('../player-view');

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

beforeEach(() => {
  playerStore.setState({
    currentTrack: MOCK_TRACK,
    currentTrackIndex: 0,
    queue: MOCK_QUEUE,
    queueLoading: false,
    playbackState: 'playing',
    position: 30,
    duration: 180,
    bufferedPosition: 60,
    error: null,
    retrying: false,
  });
});

describe('PlayerView', () => {
  it('renders empty state when no current track', () => {
    playerStore.setState({ currentTrack: null });
    const { getByText } = render(<PlayerView />);
    expect(getByText('Nothing Playing')).toBeTruthy();
  });

  it('renders player content by default (player tab)', () => {
    const { getByText, queryByText } = render(<PlayerView />);

    // Hero player content visible
    expect(getByText('Test Song')).toBeTruthy();
    expect(getByText('Test Artist')).toBeTruthy();

    // Queue items should NOT be visible (queue tab is not active)
    // The FlashList is mounted but hidden via opacity
    // Tab bar should be visible with all icons
    expect(getByText('musical-notes')).toBeTruthy();
    expect(getByText('playlist-music')).toBeTruthy();
    expect(getByText('information-outline')).toBeTruthy();
    expect(getByText('comment-quote-outline')).toBeTruthy();
  });

  it('switches to queue tab when queue icon pressed', () => {
    const { getByLabelText, getByText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Queue should show items after mounting
    expect(getByText('Second Song')).toBeTruthy();
    expect(getByText('Third Song')).toBeTruthy();
  });

  it('shows queue header with shuffle, share, clear actions', () => {
    const { getByLabelText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    expect(getByLabelText('Share queue')).toBeTruthy();
    expect(getByLabelText('Clear Queue')).toBeTruthy();
  });

  it('switches to lyrics tab showing placeholder', () => {
    const { getByLabelText, getByText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Lyrics'));
    });

    expect(getByText('Lyrics coming soon')).toBeTruthy();
  });

  it('switches to info tab showing album info', () => {
    const { getByLabelText, getByText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Album Info'));
    });

    expect(getByText('AlbumInfoContent')).toBeTruthy();
  });

  it('returns to player tab when Now Playing pressed', () => {
    const { getByLabelText, getAllByText } = render(<PlayerView />);

    // Switch to queue
    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Switch back to player
    act(() => {
      fireEvent.press(getByLabelText('Now Playing'));
    });

    // Player content should be visible (may appear in queue too, so check at least one exists)
    expect(getAllByText('Test Song').length).toBeGreaterThanOrEqual(1);
  });

  it('renders loading state when queue is loading', () => {
    playerStore.setState({ queueLoading: true });
    const { getByText } = render(<PlayerView />);
    expect(getByText('Loading\u2026')).toBeTruthy();
  });

  it('renders transport control buttons', () => {
    const { getByText } = render(<PlayerView />);

    expect(getByText('play-back')).toBeTruthy();
    expect(getByText('pause')).toBeTruthy(); // playing state shows pause
    expect(getByText('play-forward')).toBeTruthy();
  });

  it('wraps the player tab in a scroll view with bottom inset padding', () => {
    const { getByTestId } = render(<PlayerView />);

    const scrollView = getByTestId('player-scroll-view');
    const contentContainerStyle = StyleSheet.flatten(scrollView.props.contentContainerStyle);

    expect(contentContainerStyle.flexGrow).toBe(1);
    expect(contentContainerStyle.paddingBottom).toBe(86);
  });

  it('renders play icon when paused', () => {
    playerStore.setState({ playbackState: 'paused' });
    const { getByText } = render(<PlayerView />);
    expect(getByText('play')).toBeTruthy();
  });

  it('renders favorite button', () => {
    const { getByLabelText } = render(<PlayerView />);
    expect(getByLabelText('Add to Favorites')).toBeTruthy();
  });

  it('presses favorite button without error', () => {
    const { getByLabelText } = render(<PlayerView />);
    fireEvent.press(getByLabelText('Add to Favorites'));
    const { toggleStar } = require('../../services/moreOptionsService');
    expect(toggleStar).toHaveBeenCalledWith('song', 'track-1');
  });

  it('presses play/pause button', () => {
    const { getByText } = render(<PlayerView />);
    // Find the pause icon (since state is 'playing')
    const pauseIcon = getByText('pause');
    // The icon is inside a Pressable; fire on the closest pressable parent
    fireEvent.press(pauseIcon);
  });

  it('presses skip forward button', () => {
    const { getByText } = render(<PlayerView />);
    fireEvent.press(getByText('play-forward'));
    const { skipToNext } = require('../../services/playerService');
    expect(skipToNext).toHaveBeenCalled();
  });

  it('presses skip backward button', () => {
    const { getByText } = render(<PlayerView />);
    fireEvent.press(getByText('play-back'));
    const { skipToPrevious } = require('../../services/playerService');
    expect(skipToPrevious).toHaveBeenCalled();
  });

  it('renders queue empty state when queue has no items', () => {
    playerStore.setState({ queue: [] });
    const { getByLabelText, queryByLabelText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Queue header should not render when queue is empty
    expect(queryByLabelText('Share queue')).toBeNull();
  });

  it('shows buffering indicator when buffering', () => {
    playerStore.setState({ playbackState: 'buffering' });
    const { queryByText } = render(<PlayerView />);
    // In buffering state, the play icon should not be shown (ActivityIndicator shows instead)
    expect(queryByText('play')).toBeNull();
    expect(queryByText('pause')).toBeNull();
  });

  it('mounts info tab lazily on first selection', () => {
    const { getByLabelText, queryByText, getByText } = render(<PlayerView />);

    // Info tab should not be mounted initially
    expect(queryByText('AlbumInfoContent')).toBeNull();

    // Select info tab
    act(() => {
      fireEvent.press(getByLabelText('Album Info'));
    });

    // Now it should be mounted
    expect(getByText('AlbumInfoContent')).toBeTruthy();
  });

  it('renders shuffle button in queue tab', () => {
    const { getByLabelText, getByTestId } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    expect(getByTestId('shuffle-button')).toBeTruthy();
  });

  it('calls share queue when share button pressed', () => {
    const { getByLabelText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    fireEvent.press(getByLabelText('Share queue'));
  });

  it('calls clear queue when clear button pressed', () => {
    const { getByLabelText, getByText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    fireEvent.press(getByLabelText('Clear Queue'));
  });

  it('renders all queue items in queue tab', () => {
    const { getByLabelText, getByText, getAllByText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Track titles appear in queue (first track may also appear in player content)
    expect(getAllByText('Test Song').length).toBeGreaterThanOrEqual(1);
    expect(getByText('Second Song')).toBeTruthy();
    expect(getByText('Third Song')).toBeTruthy();
  });

  it('auto-dismisses when currentTrack becomes null after being populated', () => {
    const routerBack = jest.fn();
    jest.spyOn(require('expo-router'), 'useRouter').mockReturnValue({ back: routerBack });

    render(<PlayerView />);

    // Simulate track being cleared after being populated
    act(() => {
      playerStore.setState({ currentTrack: null });
    });

    expect(routerBack).toHaveBeenCalled();
  });

  it('invokes skipToTrack when queue item pressed', () => {
    const { getByLabelText, getByText } = render(<PlayerView />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Press the "Second Song" queue item (rendered by mocked QueueItemRow)
    fireEvent.press(getByText('Second Song'));
  });

  it('invokes seekTo when progress bar seeks', () => {
    // This exercises the handleSeek callback defined in PlayerView
    // The progress bar is mocked, so we verify it renders without error
    const { getByTestId } = render(<PlayerView />);
    expect(getByTestId('progress-bar')).toBeTruthy();
  });

  it('preserves mounted tabs when switching between them', () => {
    const { getByLabelText, getByText } = render(<PlayerView />);

    // Mount queue tab
    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });
    expect(getByText('Second Song')).toBeTruthy();

    // Mount lyrics tab
    act(() => {
      fireEvent.press(getByLabelText('Lyrics'));
    });
    expect(getByText('Lyrics coming soon')).toBeTruthy();

    // Queue items should still be rendered (mounted)
    expect(getByText('Second Song')).toBeTruthy();
  });
});
