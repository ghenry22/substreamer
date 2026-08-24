jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return { HeaderHeightContext: React.createContext(10) };
});

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ colors: { border: '#333', textPrimary: '#fff' } }),
}));

const mockConfirm = jest.fn();
jest.mock('../../hooks/useThemedAlert', () => ({
  useThemedAlert: () => ({ confirm: mockConfirm }),
}));

const mockApplyLookaheadCacheConfig = jest.fn();
const mockApplyPlaybackMode = jest.fn();
const mockApplyReplayGain = jest.fn();
const mockSetAutoplayEnabled = jest.fn();
const mockUpdateRemoteCapabilities = jest.fn();
jest.mock('../../services/playerService', () => ({
  applyLookaheadCacheConfig: (...args: unknown[]) => mockApplyLookaheadCacheConfig(...args),
  applyPlaybackMode: (...args: unknown[]) => mockApplyPlaybackMode(...args),
  applyReplayGain: (...args: unknown[]) => mockApplyReplayGain(...args),
  setAutoplayEnabled: (...args: unknown[]) => mockSetAutoplayEnabled(...args),
  updateRemoteCapabilities: (...args: unknown[]) => mockUpdateRemoteCapabilities(...args),
}));

jest.mock('../../components/GradientBackground', () => {
  const { View } = require('react-native');
  return { GradientBackground: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('../../components/BottomChrome', () => {
  const { View } = require('react-native');
  return { BottomChrome: () => <View testID="bottom-chrome" /> };
});
jest.mock('../../components/StreamFormatSheet', () => {
  const { View } = require('react-native');
  return { StreamFormatSheet: () => <View testID="stream-format-sheet" /> };
});

jest.mock('../../components/settings/BackgroundPlaybackCard', () => ({ BackgroundPlaybackCard: () => null }));
jest.mock('../../components/settings/DownloadingCard', () => ({ DownloadingCard: () => null }));
jest.mock('../../components/settings/EqualizerCard', () => ({ EqualizerCard: () => null }));
jest.mock('../../components/settings/LookaheadCacheCard', () => ({ LookaheadCacheCard: () => null }));
jest.mock('../../components/settings/PlaybackModeCard', () => ({ PlaybackModeCard: () => null }));
jest.mock('../../components/settings/PlayerControlsCard', () => ({ PlayerControlsCard: () => null }));
jest.mock('../../components/settings/RemoteControlsCard', () => ({ RemoteControlsCard: () => null }));
jest.mock('../../components/settings/ReplayGainCard', () => ({ ReplayGainCard: () => null }));
jest.mock('../../components/settings/SkipIntervalsCard', () => ({ SkipIntervalsCard: () => null }));
jest.mock('../../components/settings/StreamingCard', () => ({ StreamingCard: () => null }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SettingsPlaybackScreen } from '../settings-playback';
import { playbackSettingsStore } from '../../store/playbackSettingsStore';

const defaults = {
  maxBitRate: null,
  streamFormat: 'raw',
  estimateContentLength: false,
  downloadMaxBitRate: 320,
  downloadFormat: 'mp3',
  showSkipIntervalButtons: false,
  showSleepTimerButton: false,
  skipBackwardInterval: 15,
  skipForwardInterval: 30,
  remoteControlMode: 'skip-track',
  lookaheadEnabled: true,
  lookaheadCount: 3,
  playbackMode: 'gapless',
  crossfadeDurationMs: 5000,
  replayGainMode: 'off',
  autoplayEnabled: false,
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  playbackSettingsStore.setState(defaults);
  mockConfirm.mockImplementation(({ onConfirm }: { onConfirm: () => void }) => onConfirm());
});

it('hides reset while every playback setting is at its default', () => {
  const view = render(<SettingsPlaybackScreen />);
  expect(view.queryByText('Reset to Defaults')).toBeNull();
  expect(view.getByTestId('stream-format-sheet')).toBeTruthy();
});

it.each([
  ['maxBitRate', 128],
  ['streamFormat', 'mp3'],
  ['estimateContentLength', true],
  ['downloadMaxBitRate', 128],
  ['downloadFormat', 'raw'],
  ['showSkipIntervalButtons', true],
  ['showSleepTimerButton', true],
  ['skipBackwardInterval', 30],
  ['skipForwardInterval', 15],
  ['remoteControlMode', 'skip-interval'],
  ['lookaheadEnabled', false],
  ['lookaheadCount', 5],
  ['playbackMode', 'crossfade'],
  ['crossfadeDurationMs', 3000],
  ['replayGainMode', 'track'],
  ['autoplayEnabled', true],
] as const)('shows reset when %s differs from its default', (key, value) => {
  playbackSettingsStore.setState({ [key]: value });
  const view = render(<SettingsPlaybackScreen />);
  expect(view.getByText('Reset to Defaults')).toBeTruthy();
});

it('resets autoplay with the other playback settings and reapplies native configuration', () => {
  playbackSettingsStore.setState({ autoplayEnabled: true, playbackMode: 'crossfade' });
  const view = render(<SettingsPlaybackScreen />);

  fireEvent.press(view.getByText('Reset to Defaults'));

  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Reset to Defaults',
    destructive: true,
  }));
  expect(mockSetAutoplayEnabled).toHaveBeenCalledWith(false);
  expect(mockUpdateRemoteCapabilities).toHaveBeenCalled();
  expect(mockApplyLookaheadCacheConfig).toHaveBeenCalled();
  expect(mockApplyPlaybackMode).toHaveBeenCalled();
  expect(mockApplyReplayGain).toHaveBeenCalled();
});
