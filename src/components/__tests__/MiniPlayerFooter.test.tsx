jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

jest.mock('../MiniPlayer', () => {
  const { View } = require('react-native');
  return { MiniPlayer: () => <View testID="mini-player" /> };
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
import { playerStore } from '../../store/playerStore';
import { MiniPlayerFooter } from '../MiniPlayerFooter';

const mockUseLayoutMode = useLayoutMode as jest.Mock;

const TRACK = {
  id: 't1',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  duration: 120,
} as unknown as NonNullable<ReturnType<typeof playerStore.getState>['currentTrack']>;

beforeEach(() => {
  mockUseLayoutMode.mockReturnValue('compact');
  authStore.setState({ isLoggedIn: true });
  playerStore.setState({ currentTrack: TRACK });
});

describe('MiniPlayerFooter', () => {
  it('renders MiniPlayer when logged in, has track, and narrow mode', () => {
    const { getByTestId } = render(<MiniPlayerFooter />);
    expect(getByTestId('mini-player')).toBeTruthy();
  });

  it('renders null in wide mode', () => {
    mockUseLayoutMode.mockReturnValue('wide');
    const { queryByTestId } = render(<MiniPlayerFooter />);
    expect(queryByTestId('mini-player')).toBeNull();
  });

  it('renders null when logged out', () => {
    authStore.setState({ isLoggedIn: false });
    const { queryByTestId } = render(<MiniPlayerFooter />);
    expect(queryByTestId('mini-player')).toBeNull();
  });

  it('renders null when there is no current track', () => {
    playerStore.setState({ currentTrack: null });
    const { queryByTestId } = render(<MiniPlayerFooter />);
    expect(queryByTestId('mini-player')).toBeNull();
  });

  it('applies safe-area bottom inset as padding', () => {
    const { getByTestId, UNSAFE_root } = render(<MiniPlayerFooter />);
    expect(getByTestId('mini-player')).toBeTruthy();
    const wrapper = UNSAFE_root.findAll((n) => {
      const style = n.props.style;
      if (!style) return false;
      const list = Array.isArray(style) ? style.flat(Infinity) : [style];
      return list.some(
        (s: unknown) =>
          typeof s === 'object' && s !== null && (s as { paddingBottom?: number }).paddingBottom === 34,
      );
    });
    expect(wrapper.length).toBeGreaterThanOrEqual(1);
  });
});
