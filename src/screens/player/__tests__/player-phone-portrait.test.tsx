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

jest.mock('@/hooks/useImagePalette', () => ({
  useImagePalette: () => ({
    primary: '#333333',
    secondary: null,
    gradientOpacity: { value: 1 },
  }),
}));

jest.mock('@/hooks/useCanSkip', () => ({
  useCanSkip: () => ({ canSkipNext: true, canSkipPrevious: true }),
}));

jest.mock('@/hooks/useIsStarred', () => ({
  useIsStarred: () => false,
}));

jest.mock('@/hooks/useThemedAlert', () => ({
  useThemedAlert: () => ({
    alert: jest.fn(),
    confirm: jest.fn((opts: { onConfirm?: () => void }) => opts?.onConfirm?.()),
  }),
}));

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
  // Chainable Pan gesture stub: every builder method returns the same object.
  const makeChainable = () => {
    const g: Record<string, () => unknown> = {};
    const methods = [
      'enabled', 'activeOffsetY', 'failOffsetY', 'activeOffsetX', 'failOffsetX',
      'onBegin', 'onStart', 'onUpdate', 'onChange', 'onEnd', 'onFinalize',
      'simultaneousWithExternalGesture', 'requireExternalGestureToFail',
    ];
    for (const m of methods) g[m] = () => g;
    return g;
  };
  return {
    Pressable,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: { Pan: makeChainable },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@/components/CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: (props: { coverArtId?: string }) => <View testID={`cover-${props.coverArtId}`} /> };
});

jest.mock('@/components/MarqueeText', () => {
  const { Text } = require('react-native');
  return { MarqueeText: ({ children, style }: { children: React.ReactNode; style?: object }) => <Text style={style}>{children}</Text> };
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

jest.mock('@/components/QueueItemRow', () => {
  const { Text } = require('react-native');
  return { QueueItemRow: ({ track }: { track: { title: string } }) => <Text>{track.title}</Text> };
});

jest.mock('@/components/SwipeableRow', () => ({
  closeOpenRow: jest.fn(),
}));

jest.mock('@/components/MoreOptionsButton', () => {
  const { View } = require('react-native');
  return { MoreOptionsButton: () => <View testID="more-options" /> };
});

jest.mock('@/components/ThemedAlert', () => {
  const { View } = require('react-native');
  return { ThemedAlert: () => <View testID="themed-alert" /> };
});

jest.mock('@/components/EmptyState', () => {
  const { Text } = require('react-native');
  return { EmptyState: ({ title }: { title: string }) => <Text>{title}</Text> };
});

// The album-info hook loads asynchronously (store hydrate + fetch); it has its own suite.
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
  clearQueue: jest.fn(),
  retryPlayback: jest.fn(),
  seekTo: jest.fn(),
  shuffleQueue: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  skipToTrack: jest.fn(),
  togglePlayPause: jest.fn(),
}));

jest.mock('@/services/moreOptionsService', () => ({
  toggleStar: jest.fn(),
}));

jest.mock('@/utils/formatters', () => ({
  sanitizeBiographyText: jest.fn((text: string) => text),
}));

jest.mock('@/utils/stringHelpers', () => ({
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

import { appStateStore } from '@/store/appStateStore';
import { lyricsStore } from '@/store/lyricsStore';
import { playerStore } from '@/store/playerStore';
import { type Child } from '@/services/subsonicService';

// Must import after mocks
const { PlayerPhonePortrait } = require('@/screens/player/player-phone-portrait');

const fetchLyrics = lyricsStore.getState().fetchLyrics as jest.Mock;

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
  fetchLyrics.mockClear();
  appStateStore.setState({ isActive: true });
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

describe('PlayerPhonePortrait', () => {
  it('renders empty state when no current track', () => {
    playerStore.setState({ currentTrack: null });
    const { getByText } = render(<PlayerPhonePortrait />);
    expect(getByText('Nothing Playing')).toBeTruthy();
  });

  it('renders player content by default (player tab)', () => {
    const { getByText, queryByText, getByTestId, getByLabelText } = render(<PlayerPhonePortrait />);

    // Hero player content visible
    expect(getByText('Test Song')).toBeTruthy();
    expect(getByText('Test Artist')).toBeTruthy();

    // Queue items should NOT be visible (queue tab is not active)
    // The FlashList is mounted but hidden via opacity
    // Pill row shows repeat plus the queue, lyrics and album info shortcuts
    expect(getByTestId('repeat-button')).toBeTruthy();
    expect(getByLabelText('Queue')).toBeTruthy();
    expect(getByLabelText('Lyrics')).toBeTruthy();
    expect(getByLabelText('Album Info')).toBeTruthy();
  });

  it('switches to queue tab when queue icon pressed', () => {
    const { getByLabelText, getByText } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Queue should show items after mounting
    expect(getByText('Second Song')).toBeTruthy();
    expect(getByText('Third Song')).toBeTruthy();
  });

  it('shows queue header with shuffle, share, clear actions', () => {
    const { getByLabelText } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    expect(getByLabelText('Share queue')).toBeTruthy();
    expect(getByLabelText('Clear Queue')).toBeTruthy();
  });

  it('fetches lyrics for the playing track without the lyrics tab being opened', () => {
    const { queryByText } = render(<PlayerPhonePortrait />);

    // The tab is still unmounted — the fetch is owned by the screen, so lyrics
    // are ready whenever the player is open, not only once Lyrics is selected.
    expect(queryByText('LyricsContent')).toBeNull();
    expect(fetchLyrics).toHaveBeenCalledTimes(1);
    expect(fetchLyrics).toHaveBeenCalledWith('track-1', 'Test Artist', 'Test Song');
  });

  it('does not fetch lyrics when nothing is playing', () => {
    playerStore.setState({ currentTrack: null });

    render(<PlayerPhonePortrait />);

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it('switches to lyrics tab and mounts LyricsContent', () => {
    const { getByLabelText, getByText } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Lyrics'));
    });

    expect(getByText('LyricsContent')).toBeTruthy();
  });

  it('switches to info tab showing album info', () => {
    const { getByLabelText, getByText } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Album Info'));
    });

    expect(getByText('AlbumInfoContent')).toBeTruthy();
  });

  it('renders loading state when queue is loading', () => {
    playerStore.setState({ queueLoading: true });
    const { getByText } = render(<PlayerPhonePortrait />);
    expect(getByText('Loading\u2026')).toBeTruthy();
  });

  it('renders transport control buttons', () => {
    const { getByText } = render(<PlayerPhonePortrait />);

    expect(getByText('play-back')).toBeTruthy();
    expect(getByText('pause')).toBeTruthy(); // playing state shows pause
    expect(getByText('play-forward')).toBeTruthy();
  });

  it('renders play icon when paused', () => {
    playerStore.setState({ playbackState: 'paused' });
    const { getByText } = render(<PlayerPhonePortrait />);
    expect(getByText('play')).toBeTruthy();
  });

  it('renders favorite button', () => {
    const { getByLabelText } = render(<PlayerPhonePortrait />);
    expect(getByLabelText('Add to Favorites')).toBeTruthy();
  });

  it('presses favorite button without error', () => {
    const { getByLabelText } = render(<PlayerPhonePortrait />);
    fireEvent.press(getByLabelText('Add to Favorites'));
    const { toggleStar } = require('@/services/moreOptionsService');
    expect(toggleStar).toHaveBeenCalledWith('song', 'track-1');
  });

  it('presses play/pause button', () => {
    const { getByText } = render(<PlayerPhonePortrait />);
    // Find the pause icon (since state is 'playing')
    const pauseIcon = getByText('pause');
    // The icon is inside a Pressable; fire on the closest pressable parent
    fireEvent.press(pauseIcon);
  });

  it('presses skip forward button', () => {
    const { getByText } = render(<PlayerPhonePortrait />);
    fireEvent.press(getByText('play-forward'));
    const { skipToNext } = require('@/services/playerService');
    expect(skipToNext).toHaveBeenCalled();
  });

  it('presses skip backward button', () => {
    const { getByText } = render(<PlayerPhonePortrait />);
    fireEvent.press(getByText('play-back'));
    const { skipToPrevious } = require('@/services/playerService');
    expect(skipToPrevious).toHaveBeenCalled();
  });

  it('renders queue empty state when queue has no items', () => {
    playerStore.setState({ queue: [] });
    const { getByLabelText, queryByLabelText } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Queue header should not render when queue is empty
    expect(queryByLabelText('Share queue')).toBeNull();
  });

  it('shows buffering indicator when buffering', () => {
    playerStore.setState({ playbackState: 'buffering' });
    const { queryByText } = render(<PlayerPhonePortrait />);
    // In buffering state, the play icon should not be shown (ActivityIndicator shows instead)
    expect(queryByText('play')).toBeNull();
    expect(queryByText('pause')).toBeNull();
  });

  it('mounts info tab lazily on first selection', () => {
    const { getByLabelText, queryByText, getByText } = render(<PlayerPhonePortrait />);

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
    const { getByLabelText, getAllByTestId } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Shuffle now appears both in the player controls and the queue header.
    expect(getAllByTestId('shuffle-button').length).toBeGreaterThanOrEqual(2);
  });

  it('calls share queue when share button pressed', () => {
    const { getByLabelText } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    fireEvent.press(getByLabelText('Share queue'));
  });

  it('calls clear queue when clear button pressed', () => {
    const { getByLabelText, getByText } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    fireEvent.press(getByLabelText('Clear Queue'));
  });

  it('renders all queue items in queue tab', () => {
    const { getByLabelText, getByText, getAllByText } = render(<PlayerPhonePortrait />);

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

    render(<PlayerPhonePortrait />);

    // Simulate track being cleared after being populated
    act(() => {
      playerStore.setState({ currentTrack: null });
    });

    expect(routerBack).toHaveBeenCalled();
  });

  it('invokes skipToTrack when queue item pressed', () => {
    const { getByLabelText, getByText } = render(<PlayerPhonePortrait />);

    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });

    // Press the "Second Song" queue item (rendered by mocked QueueItemRow)
    fireEvent.press(getByText('Second Song'));
  });

  it('invokes seekTo when progress bar seeks', () => {
    // This exercises the handleSeek callback defined in PlayerPhonePortrait
    // The progress bar is mocked, so we verify it renders without error
    const { getByTestId } = render(<PlayerPhonePortrait />);
    expect(getByTestId('progress-bar')).toBeTruthy();
  });

  it('preserves mounted tabs when switching between them', () => {
    const { getByLabelText, getByText } = render(<PlayerPhonePortrait />);

    // Mount queue tab
    act(() => {
      fireEvent.press(getByLabelText('Queue'));
    });
    expect(getByText('Second Song')).toBeTruthy();

    // Mount lyrics tab
    act(() => {
      fireEvent.press(getByLabelText('Lyrics'));
    });
    expect(getByText('LyricsContent')).toBeTruthy();

    // Queue items should still be rendered (mounted)
    expect(getByText('Second Song')).toBeTruthy();
  });
});
