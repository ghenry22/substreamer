jest.mock('@/store/persistence/kvStorage', () =>
  require('@/store/persistence/__mocks__/kvStorage'),
);

const mockBack = jest.fn();
const mockSetOptions = jest.fn();
jest.mock('expo-router', () => ({
  Stack: {
    Toolbar: Object.assign(
      ({ children }: { children: React.ReactNode }) => <>{children}</>,
      { Button: () => null },
    ),
  },
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: ({ children }: { children?: React.ReactNode }) => <View>{children}</View> };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useAnimatedStyle: (fn: () => object) => fn(),
  };
});

jest.mock('react-native-gesture-handler', () => {
  const { Pressable } = require('react-native');
  return { Pressable };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 20, left: 0 }),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000', card: '#111', textPrimary: '#fff', textSecondary: '#aaa',
      primary: '#f60', border: '#333', label: '#aaa', red: '#f00', inputBg: '#222',
    },
  }),
}));
jest.mock('@/hooks/useSongCoverArt', () => ({ useSongCoverArt: () => 'cover' }));
jest.mock('@/hooks/useCoverGradient', () => ({
  useCoverGradient: () => ({
    gradientColors: ['#111', '#000'],
    gradientLocations: [0, 1],
    gradientOpacity: { value: 1 },
  }),
}));

const mockPlaybackState = { isPlaying: true, isBuffering: false };
jest.mock('@/hooks/usePlaybackState', () => ({ usePlaybackState: () => mockPlaybackState }));
const mockSkipState = { canSkipNext: true, canSkipPrevious: true };
jest.mock('@/hooks/useCanSkip', () => ({ useCanSkip: () => mockSkipState }));

const mockPlayerActions = {
  handleSeek: jest.fn(),
  handleQueueItemPress: jest.fn(),
  handleQueueItemLongPress: jest.fn(),
  handleShareQueue: jest.fn(),
  handleClearQueue: jest.fn(),
};
jest.mock('@/hooks/usePlayerActions', () => ({ usePlayerActions: () => mockPlayerActions }));
jest.mock('@/hooks/useShuffleOverlay', () => ({
  useShuffleOverlay: () => ({
    shuffling: false,
    handleShuffle: jest.fn(),
    overlayStyle: {},
    spinStyle: {},
  }),
}));

jest.mock('@/components/player/PlayerModeContent', () => {
  const { Text } = require('react-native');
  return {
    PlayerModeContent: ({ mode, queueOrigins }: { mode: string; queueOrigins: string[] }) => (
      <Text testID="mode-content">{`${mode}:${queueOrigins.join(',')}`}</Text>
    ),
  };
});

jest.mock('@/components/BookmarkButton', () => {
  const { View } = require('react-native');
  return { BookmarkButton: () => <View testID="bookmark" /> };
});
jest.mock('@/components/CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: () => <View testID="cover" /> };
});
jest.mock('@/components/FavoriteButton', () => {
  const { View } = require('react-native');
  return { FavoriteButton: () => <View testID="favorite" /> };
});
jest.mock('@/components/MoreOptionsButton', () => {
  const { View } = require('react-native');
  return { MoreOptionsButton: () => <View testID="more-options" /> };
});
jest.mock('@/components/PlaybackRateButton', () => {
  const { View } = require('react-native');
  return { PlaybackRateButton: () => <View testID="rate" /> };
});
jest.mock('@/components/PlaybackSourceBadge', () => {
  const { View } = require('react-native');
  return { PlaybackSourceBadge: () => <View testID="source" /> };
});
jest.mock('@/components/RepeatButton', () => {
  const { View } = require('react-native');
  return { RepeatButton: () => <View testID="repeat" /> };
});
jest.mock('@/components/RoutePicker', () => {
  const { View } = require('react-native');
  return { CastButton: () => <View testID="cast" /> };
});
jest.mock('@/components/ShuffleButton', () => {
  const { View } = require('react-native');
  return { ShuffleButton: () => <View testID="shuffle" /> };
});
jest.mock('@/components/ShuffleOverlay', () => {
  const { View } = require('react-native');
  return { ShuffleOverlay: () => <View testID="shuffle-overlay" /> };
});
jest.mock('@/components/SkipIntervalButton', () => ({
  SkipIntervalButton: ({ direction }: { direction: string }) => {
    const { View } = require('react-native');
    return <View testID={`skip-${direction}`} />;
  },
}));
jest.mock('@/components/SleepTimerButton', () => {
  const { View } = require('react-native');
  return { SleepTimerButton: () => <View testID="sleep-button" /> };
});
jest.mock('@/components/SleepTimerCapsule', () => {
  const { View } = require('react-native');
  return { SleepTimerCapsule: () => <View testID="sleep-capsule" /> };
});
jest.mock('@/components/PlayerProgressBar', () => {
  const { View } = require('react-native');
  return { PlayerProgressBar: () => <View testID="progress" /> };
});
jest.mock('@/components/MarqueeText', () => {
  const { Text } = require('react-native');
  return { MarqueeText: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text> };
});
jest.mock('@/components/EmptyState', () => {
  const { Text } = require('react-native');
  return { EmptyState: ({ title }: { title: string }) => <Text>{title}</Text> };
});

jest.mock('@/services/playerService', () => ({
  clearQueue: jest.fn(),
  retryPlayback: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  togglePlayPause: jest.fn(),
}));

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { PlayerTabletPortrait } from '@/screens/player/player-tablet-portrait';
import { offlineModeStore } from '@/store/offlineModeStore';
import { playbackSettingsStore } from '@/store/playbackSettingsStore';
import { playerStore } from '@/store/playerStore';

import type { Child } from '@/services/subsonicService';

const track = {
  id: 'one', title: 'First Song', artist: 'Artist', album: 'Album', duration: 120,
} as Child;
const queue = [track, { ...track, id: 'two', title: 'Second Song' } as Child];

beforeEach(() => {
  jest.clearAllMocks();
  mockPlaybackState.isPlaying = true;
  mockPlaybackState.isBuffering = false;
  mockSkipState.canSkipNext = true;
  mockSkipState.canSkipPrevious = true;
  offlineModeStore.setState({ offlineMode: false });
  playbackSettingsStore.setState({
    showSkipIntervalButtons: false,
    showSleepTimerButton: false,
  });
  playerStore.setState({
    currentTrack: track,
    currentTrackIndex: 0,
    queue,
    queueOrigins: ['manual', 'autoplay'],
    position: 10,
    duration: 120,
    bufferedPosition: 20,
    error: null,
    retrying: false,
  });
});

describe('PlayerTabletPortrait', () => {
  it('passes queue origins to its tablet portrait queue content', () => {
    const view = render(<PlayerTabletPortrait />);
    expect(view.getByTestId('mode-content').props.children).toBe('queue:manual,autoplay');
    expect(view.getByText('First Song')).toBeTruthy();
    expect(view.getByText('Artist')).toBeTruthy();
  });

  it('switches between queue, info, and lyrics while online', () => {
    const view = render(<PlayerTabletPortrait />);
    fireEvent.press(view.getByLabelText('Show album info'));
    expect(view.getByTestId('mode-content').props.children).toBe('info:manual,autoplay');
    fireEvent.press(view.getByLabelText('Show lyrics'));
    expect(view.getByTestId('mode-content').props.children).toBe('lyrics:manual,autoplay');
    fireEvent.press(view.getByLabelText('Show queue'));
    expect(view.getByTestId('mode-content').props.children).toBe('queue:manual,autoplay');
  });

  it('returns to queue and hides online-only modes when offline', () => {
    const view = render(<PlayerTabletPortrait />);
    fireEvent.press(view.getByLabelText('Show lyrics'));
    act(() => offlineModeStore.setState({ offlineMode: true }));

    expect(view.getByTestId('mode-content').props.children).toBe('queue:manual,autoplay');
    expect(view.queryByLabelText('Show album info')).toBeNull();
    expect(view.queryByLabelText('Show lyrics')).toBeNull();
  });

  it('renders an empty state and dismisses after a populated queue is cleared', () => {
    const view = render(<PlayerTabletPortrait />);
    act(() => playerStore.setState({ currentTrack: null }));
    expect(view.getByText('Nothing Playing')).toBeTruthy();
    expect(mockBack).toHaveBeenCalled();
  });

  it('renders the initial empty state without dismissing', () => {
    playerStore.setState({ currentTrack: null });
    const view = render(<PlayerTabletPortrait />);
    expect(view.getByText('Nothing Playing')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('renders optional controls and the buffering state', () => {
    playbackSettingsStore.setState({
      showSkipIntervalButtons: true,
      showSleepTimerButton: true,
    });
    mockPlaybackState.isBuffering = true;
    const view = render(<PlayerTabletPortrait />);
    expect(view.getByTestId('sleep-button')).toBeTruthy();
    expect(view.getByTestId('skip-backward')).toBeTruthy();
    expect(view.getByTestId('skip-forward')).toBeTruthy();
    expect(view.queryByText('pause')).toBeNull();
  });

  it('renders paused playback, missing artist copy, and disabled skips', () => {
    mockPlaybackState.isPlaying = false;
    mockSkipState.canSkipNext = false;
    mockSkipState.canSkipPrevious = false;
    playerStore.setState({ currentTrack: { ...track, artist: undefined } as Child });
    const view = render(<PlayerTabletPortrait />);
    expect(view.getByText('Unknown Artist')).toBeTruthy();
    expect(view.getByText('play')).toBeTruthy();
  });
});
