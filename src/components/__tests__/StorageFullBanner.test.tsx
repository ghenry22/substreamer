jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import React from 'react';
import { act, render, fireEvent } from '@testing-library/react-native';

import { storageLimitStore } from '../../store/storageLimitStore';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: { name: string }) => <Text>{props.name}</Text> };
});

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
const { StorageFullBanner } = require('../StorageFullBanner');

beforeEach(() => {
  storageLimitStore.setState({ isStorageFull: false });
  mockPush.mockClear();
});

describe('StorageFullBanner', () => {
  it('has collapsed height when storage is not full', () => {
    const { toJSON } = render(<StorageFullBanner />);
    const root = toJSON() as import('react-test-renderer').ReactTestRendererJSON;
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 0 })]),
    );
  });

  it('shows "Storage limit reached" when storage is full', () => {
    storageLimitStore.setState({ isStorageFull: true });
    const { getByText } = render(<StorageFullBanner />);
    expect(getByText('Storage limit reached')).toBeTruthy();
  });

  it('shows alert-circle icon when storage is full', () => {
    storageLimitStore.setState({ isStorageFull: true });
    const { getByText } = render(<StorageFullBanner />);
    expect(getByText('alert-circle')).toBeTruthy();
  });

  it('navigates to settings-storage on press', () => {
    storageLimitStore.setState({ isStorageFull: true });
    const { getByText } = render(<StorageFullBanner />);
    fireEvent.press(getByText('Storage limit reached'));
    expect(mockPush).toHaveBeenCalledWith('/settings-storage');
  });

  it('renders with capsule pill styling when visible', () => {
    storageLimitStore.setState({ isStorageFull: true });
    const { toJSON } = render(<StorageFullBanner />);
    const root = toJSON() as any;
    // Root wrapper has expanded height
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 52 })]),
    );
  });

  it('transitions from hidden to visible when storage becomes full', () => {
    const { rerender, getByText } = render(<StorageFullBanner />);

    // Storage fills up — banner expands and shows
    act(() => storageLimitStore.setState({ isStorageFull: true }));
    rerender(<StorageFullBanner />);
    expect(getByText('Storage limit reached')).toBeTruthy();
  });
});
