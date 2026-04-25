jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import React from 'react';
import { act, render, fireEvent } from '@testing-library/react-native';

import { musicCacheStore } from '../../store/musicCacheStore';
import type { DownloadQueueItem } from '../../store/musicCacheStore';

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      card: '#111',
      textPrimary: '#fff',
      textSecondary: '#888',
      border: '#333',
      primary: '#1D9BF0',
    },
  }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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
    default: {
      View,
      Text,
    },
    // useSharedValue must persist its object across renders so that
    // post-effect mutations (heightValue.value = 44) survive into the
    // next render's useAnimatedStyle read. The trivial `() => ({ value })`
    // version returned a fresh object every render, which made entrance
    // animations untestable.
    useSharedValue: (init: number) => {
      const ref = React.useRef({ value: init });
      return ref.current;
    },
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (val: number) => val,
    withDelay: (_: number, val: number) => val,
    withSpring: (val: number) => val,
    Easing: {
      out: (e: unknown) => e,
      in: (e: unknown) => e,
      inOut: (e: unknown) => e,
      cubic: (t: number) => t,
    },
  };
});

// Must import after mocks
const { DownloadBanner } = require('../DownloadBanner');

function makeQueueItem(overrides: Partial<DownloadQueueItem> = {}): DownloadQueueItem {
  return {
    queueId: 'q1',
    itemId: 'a1',
    type: 'album',
    name: 'Kind of Blue',
    status: 'queued',
    totalSongs: 9,
    completedSongs: 0,
    addedAt: 0,
    queuePosition: 1,
    songsJson: '[]',
    ...overrides,
  };
}

beforeEach(() => {
  musicCacheStore.setState({ downloadQueue: [] });
  mockPush.mockClear();
});

describe('DownloadBanner', () => {
  it('has collapsed height when queue is empty', () => {
    const { toJSON } = render(<DownloadBanner />);
    const root = toJSON() as import('react-test-renderer').ReactTestRendererJSON;
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 0 })]),
    );
  });

  it('expands to BANNER_HEIGHT when queue has items', () => {
    // The banner always mounts collapsed and runs the entrance animation
    // via the visibility effect. With the reanimated mock, withTiming
    // resolves synchronously on the shared value, but the rendered JSX
    // captures the style at first render (height 0). A rerender flushes
    // the post-effect value into the JSX.
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading', completedSongs: 3 })],
    });
    const { toJSON, rerender } = render(<DownloadBanner />);
    rerender(<DownloadBanner />);
    const root = toJSON() as import('react-test-renderer').ReactTestRendererJSON;
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 44 })]),
    );
  });

  it('shows active downloading item name and track progress', () => {
    musicCacheStore.setState({
      downloadQueue: [
        makeQueueItem({
          status: 'downloading',
          name: 'Kind of Blue',
          completedSongs: 3,
          totalSongs: 9,
        }),
      ],
    });
    const { getByText } = render(<DownloadBanner />);
    expect(getByText('Kind of Blue')).toBeTruthy();
    expect(getByText('3/9')).toBeTruthy();
  });

  it('shows queued count when no item is actively downloading', () => {
    musicCacheStore.setState({
      downloadQueue: [
        makeQueueItem({ queueId: 'q1', status: 'queued' }),
        makeQueueItem({ queueId: 'q2', status: 'queued' }),
      ],
    });
    const { getByText } = render(<DownloadBanner />);
    // react-i18next t() with missing translation returns the key,
    // so we assert on the key (the test-utils setup file loads en.json
    // which contains the full translation).
    expect(getByText(/queued/i)).toBeTruthy();
  });

  it('navigates to download queue on press', () => {
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading' })],
    });
    const { getByText } = render(<DownloadBanner />);
    fireEvent.press(getByText('Kind of Blue'));
    expect(mockPush).toHaveBeenCalledWith('/download-queue');
  });

  it('transitions from hidden to visible when queue gains items', () => {
    const { rerender, getByText } = render(<DownloadBanner />);

    act(() =>
      musicCacheStore.setState({
        downloadQueue: [makeQueueItem({ status: 'downloading' })],
      }),
    );
    rerender(<DownloadBanner />);
    expect(getByText('Kind of Blue')).toBeTruthy();
  });

  it('transitions from visible to hidden when queue empties', () => {
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading' })],
    });
    const { rerender, toJSON } = render(<DownloadBanner />);

    act(() => musicCacheStore.setState({ downloadQueue: [] }));
    rerender(<DownloadBanner />);

    const root = toJSON() as import('react-test-renderer').ReactTestRendererJSON;
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 0 })]),
    );
  });

  it('stays hidden when queue contains only rows with unknown statuses', () => {
    // A row in an unexpected status (e.g. a stuck `complete` survivor
    // from a v1 migration, or any drift) must NOT keep the banner
    // visible — the download-queue screen filters such rows out, so
    // there's no UI affordance for the user to resolve it otherwise.
    musicCacheStore.setState({
      downloadQueue: [
        makeQueueItem({ status: 'complete' as DownloadQueueItem['status'] }),
      ],
    });
    const { toJSON } = render(<DownloadBanner />);
    const root = toJSON() as import('react-test-renderer').ReactTestRendererJSON;
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 0 })]),
    );
  });

  it('stays visible when queue has an error row with no in-flight transfer', () => {
    musicCacheStore.setState({
      downloadQueue: [
        makeQueueItem({ status: 'error', error: 'network' }),
      ],
    });
    const { toJSON, rerender } = render(<DownloadBanner />);
    rerender(<DownloadBanner />);
    const root = toJSON() as import('react-test-renderer').ReactTestRendererJSON;
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 44 })]),
    );
  });

  it('renders zero progress when active item has zero totalSongs', () => {
    musicCacheStore.setState({
      downloadQueue: [
        makeQueueItem({
          status: 'downloading',
          completedSongs: 0,
          totalSongs: 0,
        }),
      ],
    });
    // Render should not throw on divide-by-zero.
    const { getByText } = render(<DownloadBanner />);
    expect(getByText('Kind of Blue')).toBeTruthy();
  });
});
