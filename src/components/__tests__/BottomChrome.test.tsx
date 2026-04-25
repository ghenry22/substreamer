jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

jest.mock('../MiniPlayer', () => {
  const { View } = require('react-native');
  return { MiniPlayer: () => <View testID="mini-player" /> };
});

jest.mock('../DownloadBanner', () => {
  const { View } = require('react-native');
  return {
    DownloadBanner: () => <View testID="download-banner" />,
    BANNER_HEIGHT: 44,
  };
});

jest.mock('../../hooks/useLayoutMode', () => ({
  useLayoutMode: jest.fn(() => 'compact'),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

import { useLayoutMode } from '../../hooks/useLayoutMode';
import { authStore } from '../../store/authStore';
import { musicCacheStore } from '../../store/musicCacheStore';
import { playerStore } from '../../store/playerStore';
import type { DownloadQueueItem } from '../../store/musicCacheStore';
import { BottomChrome } from '../BottomChrome';

const mockUseLayoutMode = useLayoutMode as jest.Mock;

const TRACK = {
  id: 't1',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  duration: 120,
} as unknown as NonNullable<ReturnType<typeof playerStore.getState>['currentTrack']>;

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

beforeEach(() => {
  mockUseLayoutMode.mockReturnValue('compact');
  authStore.setState({ isLoggedIn: true });
  playerStore.setState({ currentTrack: null });
  musicCacheStore.setState({ downloadQueue: [] });
});

describe('BottomChrome', () => {
  /* ---- visibility table ---- */

  it('compact + has-track + no-downloads → MiniPlayer only, banner unmounted', () => {
    playerStore.setState({ currentTrack: TRACK });
    const { getByTestId, queryByTestId } = render(<BottomChrome />);
    expect(getByTestId('mini-player')).toBeTruthy();
    // Banner is conditionally mounted only when hasDownloads — eliminates
    // the class of bugs where the banner's height-animation gets stuck.
    expect(queryByTestId('download-banner')).toBeNull();
  });

  it('compact + no-track + has-downloads → banner only, MiniPlayer absent', () => {
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading' })],
    });
    const { getByTestId, queryByTestId } = render(<BottomChrome />);
    expect(getByTestId('download-banner')).toBeTruthy();
    expect(queryByTestId('mini-player')).toBeNull();
  });

  it('compact + no-track + no-downloads → null', () => {
    const { toJSON } = render(<BottomChrome />);
    expect(toJSON()).toBeNull();
  });

  it('compact + has-track + has-downloads → both visible', () => {
    playerStore.setState({ currentTrack: TRACK });
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading' })],
    });
    const { getByTestId } = render(<BottomChrome />);
    expect(getByTestId('mini-player')).toBeTruthy();
    expect(getByTestId('download-banner')).toBeTruthy();
  });

  it('wide + no-downloads → null (regardless of track)', () => {
    mockUseLayoutMode.mockReturnValue('wide');
    playerStore.setState({ currentTrack: TRACK });
    const { toJSON } = render(<BottomChrome />);
    expect(toJSON()).toBeNull();
  });

  it('wide + has-downloads → banner only (no MiniPlayer on wide)', () => {
    mockUseLayoutMode.mockReturnValue('wide');
    playerStore.setState({ currentTrack: TRACK });
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'queued' })],
    });
    const { getByTestId, queryByTestId } = render(<BottomChrome />);
    expect(getByTestId('download-banner')).toBeTruthy();
    expect(queryByTestId('mini-player')).toBeNull();
  });

  it('logged-out → null (regardless of other state)', () => {
    authStore.setState({ isLoggedIn: false });
    playerStore.setState({ currentTrack: TRACK });
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'downloading' })],
    });
    const { toJSON } = render(<BottomChrome />);
    expect(toJSON()).toBeNull();
  });

  it('queue with only ghost (`complete`) status rows → treated as no downloads', () => {
    playerStore.setState({ currentTrack: null });
    musicCacheStore.setState({
      downloadQueue: [makeQueueItem({ status: 'complete' as DownloadQueueItem['status'] })],
    });
    const { toJSON } = render(<BottomChrome />);
    expect(toJSON()).toBeNull();
  });

  /* ---- safe-area prop ---- */

  it('withSafeAreaPadding=true → wrapper applies paddingBottom: insets.bottom', () => {
    playerStore.setState({ currentTrack: TRACK });
    const { UNSAFE_root } = render(<BottomChrome withSafeAreaPadding />);
    const padded = UNSAFE_root.findAll((n) => {
      const style = n.props.style;
      if (!style) return false;
      const list = Array.isArray(style) ? style.flat(Infinity) : [style];
      return list.some(
        (s: unknown) =>
          typeof s === 'object' && s !== null && (s as { paddingBottom?: number }).paddingBottom === 34,
      );
    });
    expect(padded.length).toBeGreaterThanOrEqual(1);
  });

  it('withSafeAreaPadding omitted (default false) → no paddingBottom applied', () => {
    playerStore.setState({ currentTrack: TRACK });
    const { UNSAFE_root } = render(<BottomChrome />);
    const padded = UNSAFE_root.findAll((n) => {
      const style = n.props.style;
      if (!style) return false;
      const list = Array.isArray(style) ? style.flat(Infinity) : [style];
      return list.some(
        (s: unknown) =>
          typeof s === 'object' && s !== null && (s as { paddingBottom?: number }).paddingBottom === 34,
      );
    });
    expect(padded.length).toBe(0);
  });
});
