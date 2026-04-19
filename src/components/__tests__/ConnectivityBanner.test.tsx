jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import React from 'react';
import { act, render } from '@testing-library/react-native';

import { connectivityStore } from '../../store/connectivityStore';
import { offlineModeStore } from '../../store/offlineModeStore';

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      inputBg: '#111',
      textSecondary: '#888',
      red: '#ff0000',
    },
  }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: { name: string }) => <Text>{props.name}</Text> };
});

jest.mock('../../services/connectivityService', () => ({
  handleSslCertPrompt: jest.fn(),
}));

jest.mock('react-native-reanimated', () => {
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    default: {
      View,
      Text,
    },
    useSharedValue: (init: number) => ({ value: init }),
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
const { ConnectivityBanner } = require('../ConnectivityBanner');

beforeEach(() => {
  connectivityStore.setState({
    bannerState: 'hidden',
    isInternetReachable: true,
    isServerReachable: true,
  });
  offlineModeStore.setState({ offlineMode: false });
});

describe('ConnectivityBanner', () => {
  it('does not flash old content during hide animation', () => {
    // Start with reconnected state (green "Connected")
    connectivityStore.setState({ bannerState: 'reconnected' });
    const { rerender, queryByText } = render(<ConnectivityBanner />);
    expect(queryByText('Connected')).toBeTruthy();

    // Transition to hidden — should still show "Connected", not "Server unreachable"
    act(() => connectivityStore.setState({ bannerState: 'hidden' }));
    rerender(<ConnectivityBanner />);

    expect(queryByText('Connected')).toBeTruthy();
    expect(queryByText('Server unreachable')).toBeNull();
    expect(queryByText('No internet connection')).toBeNull();
  });

  it('shows "Server unreachable" when unreachable with internet', () => {
    connectivityStore.setState({
      bannerState: 'unreachable',
      isInternetReachable: true,
    });
    const { getByText } = render(<ConnectivityBanner />);
    expect(getByText('Server unreachable')).toBeTruthy();
  });

  it('shows "Connected" when reconnected', () => {
    connectivityStore.setState({ bannerState: 'reconnected' });
    const { getByText } = render(<ConnectivityBanner />);
    expect(getByText('Connected')).toBeTruthy();
  });

  it('shows "No internet connection" when internet is unreachable', () => {
    connectivityStore.setState({
      bannerState: 'unreachable',
      isInternetReachable: false,
    });
    const { getByText } = render(<ConnectivityBanner />);
    expect(getByText('No internet connection')).toBeTruthy();
  });

  it('shows "Certificate changed" when ssl-error', () => {
    connectivityStore.setState({ bannerState: 'ssl-error' });
    const { getByText } = render(<ConnectivityBanner />);
    expect(getByText('Certificate changed')).toBeTruthy();
  });

  it('has collapsed height when offline mode suppresses banner', () => {
    offlineModeStore.setState({ offlineMode: true });
    connectivityStore.setState({
      bannerState: 'unreachable',
      isInternetReachable: false,
    });
    const { toJSON } = render(<ConnectivityBanner />);
    const root = toJSON() as import('react-test-renderer').ReactTestRendererJSON;
    // Wrapper height should be 0 — banner is suppressed in offline mode
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 0 })]),
    );
  });
});
