/**
 * Smoke + offset tests for `PlaybackToast`. Covers the four bottom-offset
 * permutations across the {miniPlayer × banner} matrix to keep the toast
 * sitting above whatever bottom chrome is currently on screen.
 */

jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

import React from 'react';
import { render } from '@testing-library/react-native';

import { authStore } from '../../store/authStore';
import { musicCacheStore } from '../../store/musicCacheStore';
import { playerStore } from '../../store/playerStore';
import { playbackToastStore } from '../../store/playbackToastStore';
import type { DownloadQueueItem } from '../../store/musicCacheStore';

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#1D9BF0',
      red: '#E0245E',
      textPrimary: '#fff',
    },
  }),
}));

let mockLayoutMode: 'wide' | 'compact' = 'compact';
jest.mock('../../hooks/useLayoutMode', () => ({
  useLayoutMode: () => mockLayoutMode,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: { name: string }) => <Text>{props.name}</Text> };
});

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    default: { View, Text },
    Easing: {
      out: (e: unknown) => e,
      in: (e: unknown) => e,
      inOut: (e: unknown) => e,
      cubic: (t: number) => t,
    },
    runOnJS: (fn: () => void) => fn,
    useSharedValue: (init: number) => {
      const ref = React.useRef({ value: init });
      return ref.current;
    },
    useAnimatedStyle: (fn: () => object) => fn(),
    withSequence: (...vals: unknown[]) => vals[vals.length - 1],
    withSpring: (val: number) => val,
    withTiming: (val: number, _config?: unknown, cb?: (finished: boolean) => void) => {
      if (cb) cb(true);
      return val;
    },
  };
});

const { PlaybackToast } = require('../PlaybackToast');

const BOTTOM_OFFSET = 24;
const MINI_PLAYER_HEIGHT = 56;
const BANNER_HEIGHT = 44;
const SAFE_AREA_BOTTOM = 34;

function makeQueueItem(overrides: Partial<DownloadQueueItem> = {}): DownloadQueueItem {
  return {
    queueId: 'q1',
    itemId: 'a1',
    type: 'album',
    name: 'Album',
    status: 'queued',
    totalSongs: 9,
    completedSongs: 0,
    addedAt: 0,
    queuePosition: 1,
    songsJson: '[]',
    ...overrides,
  };
}

function readBottomOffset(node: import('react-test-renderer').ReactTestRendererJSON): number {
  // RN flattens style arrays with later entries winning. The wrapper's
  // base style includes `bottom: 0` from `absoluteFillObject`; the inline
  // `{ bottom: bottomOffset }` is appended after to override it.
  const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
  let last: number | undefined;
  for (const s of styles) {
    if (s && typeof s === 'object' && 'bottom' in s) {
      last = (s as { bottom: number }).bottom;
    }
  }
  if (last === undefined) {
    throw new Error('no bottom found in PlaybackToast wrapper styles');
  }
  return last;
}

function renderToast() {
  // The pill is invisible at idle (capsuleOpacity=0), but its wrapper
  // always renders and carries the bottomOffset on `style.bottom` —
  // exactly what we want to assert on.
  const tree = render(<PlaybackToast />);
  const root = tree.toJSON() as import('react-test-renderer').ReactTestRendererJSON;
  return readBottomOffset(root);
}

beforeEach(() => {
  authStore.setState({ isLoggedIn: true });
  playerStore.setState({ currentTrack: null });
  musicCacheStore.setState({ downloadQueue: [] });
  playbackToastStore.setState({ status: 'idle' });
  mockLayoutMode = 'compact';
});

describe('PlaybackToast bottom offset', () => {
  it('no chrome (no track, no downloads): safe-area + base offset only', () => {
    expect(renderToast()).toBe(SAFE_AREA_BOTTOM + BOTTOM_OFFSET);
  });

  it('MiniPlayer only (track playing, no downloads): adds MiniPlayer height', () => {
    playerStore.setState({ currentTrack: { id: 't1' } as any });
    expect(renderToast()).toBe(SAFE_AREA_BOTTOM + BOTTOM_OFFSET + MINI_PLAYER_HEIGHT);
  });

  it('banner only (no track, downloads queued): adds banner height', () => {
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading' })],
    });
    expect(renderToast()).toBe(SAFE_AREA_BOTTOM + BOTTOM_OFFSET + BANNER_HEIGHT);
  });

  it('both visible: adds banner + MiniPlayer heights', () => {
    playerStore.setState({ currentTrack: { id: 't1' } as any });
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading' })],
    });
    expect(renderToast()).toBe(
      SAFE_AREA_BOTTOM + BOTTOM_OFFSET + MINI_PLAYER_HEIGHT + BANNER_HEIGHT,
    );
  });

  it('wide layout: MiniPlayer is hidden so its height is NOT added', () => {
    mockLayoutMode = 'wide';
    playerStore.setState({ currentTrack: { id: 't1' } as any });
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading' })],
    });
    // Banner still on, MiniPlayer suppressed by isWide.
    expect(renderToast()).toBe(SAFE_AREA_BOTTOM + BOTTOM_OFFSET + BANNER_HEIGHT);
  });

  it('logged out: MiniPlayer is hidden so its height is NOT added', () => {
    authStore.setState({ isLoggedIn: false });
    playerStore.setState({ currentTrack: { id: 't1' } as any });
    expect(renderToast()).toBe(SAFE_AREA_BOTTOM + BOTTOM_OFFSET);
  });

  it('queue with only error rows still counts as has-downloads', () => {
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'error', error: 'x' })],
    });
    expect(renderToast()).toBe(SAFE_AREA_BOTTOM + BOTTOM_OFFSET + BANNER_HEIGHT);
  });

  it('queue with only complete-status (ghost) rows does NOT bump offset', () => {
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'complete' as DownloadQueueItem['status'] })],
    });
    expect(renderToast()).toBe(SAFE_AREA_BOTTOM + BOTTOM_OFFSET);
  });
});

describe('PlaybackToast status transitions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the loading label when status flips to loading', () => {
    const { rerender, getByText } = render(<PlaybackToast />);
    playbackToastStore.setState({ status: 'loading' });
    rerender(<PlaybackToast />);
    expect(getByText('Starting playback…')).toBeTruthy();
  });

  it('renders success state with default nowPlaying label and the success icon', () => {
    const { rerender, getByText } = render(<PlaybackToast />);
    playbackToastStore.setState({ status: 'success', successLabel: null });
    rerender(<PlaybackToast />);
    expect(getByText('Now Playing')).toBeTruthy();
    expect(getByText('checkmark-circle')).toBeTruthy();
  });

  it('renders success state with a custom successLabel when provided', () => {
    const { rerender, getByText } = render(<PlaybackToast />);
    playbackToastStore.setState({ status: 'success', successLabel: 'Saved' });
    rerender(<PlaybackToast />);
    expect(getByText('Saved')).toBeTruthy();
  });

  it('renders the error label and icon when status flips to error', () => {
    const { rerender, getByText } = render(<PlaybackToast />);
    playbackToastStore.setState({ status: 'error' });
    rerender(<PlaybackToast />);
    expect(getByText('Playback Error')).toBeTruthy();
    expect(getByText('close-circle')).toBeTruthy();
  });

  it('skips loading entrance when transitioning loading → success', () => {
    const { rerender, getByText } = render(<PlaybackToast />);
    playbackToastStore.setState({ status: 'loading' });
    rerender(<PlaybackToast />);
    playbackToastStore.setState({ status: 'success', successLabel: null });
    rerender(<PlaybackToast />);
    expect(getByText('Now Playing')).toBeTruthy();
  });

  it('returns to idle clears state without crashing', () => {
    const { rerender } = render(<PlaybackToast />);
    playbackToastStore.setState({ status: 'success', successLabel: 'Hi' });
    rerender(<PlaybackToast />);
    playbackToastStore.setState({ status: 'idle', successLabel: null });
    expect(() => rerender(<PlaybackToast />)).not.toThrow();
  });
});
