jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#ff6600',
      textPrimary: '#ffffff',
      textSecondary: '#888888',
      label: '#aaaaaa',
      border: '#333333',
      red: '#ff0000',
      background: '#000000',
      card: '#1e1e1e',
      inputBg: '#2a2a2a',
    },
  }),
}));

const mockAlert = jest.fn();
jest.mock('../../hooks/useThemedAlert', () => ({
  useThemedAlert: () => ({
    alert: mockAlert,
    alertProps: { visible: false },
  }),
}));

jest.mock('../../components/ThemedAlert', () => {
  const { View } = require('react-native');
  return { ThemedAlert: () => <View testID="themed-alert" /> };
});

jest.mock('../../components/GradientBackground', () => {
  const { View } = require('react-native');
  return { GradientBackground: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});

jest.mock('../../components/StreamFormatSheet', () => {
  const { View } = require('react-native');
  return { StreamFormatSheet: () => <View testID="stream-format-sheet" /> };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: (props: { name: string }) => (
      <Text testID={`icon-${props.name}`}>{props.name}</Text>
    ),
  };
});

jest.mock('@react-navigation/elements', () => {
  const React = require('react');
  return {
    HeaderHeightContext: React.createContext(0),
  };
});

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { playbackSettingsStore } from '../../store/playbackSettingsStore';
import { streamFormatSheetStore } from '../../store/streamFormatSheetStore';

const { SettingsAudioQualityScreen } = require('../settings-audio-quality');

beforeEach(() => {
  playbackSettingsStore.setState({
    maxBitRate: null,
    streamFormat: 'raw',
    estimateContentLength: false,
    repeatMode: 'off',
    playbackRate: 1,
    downloadMaxBitRate: 320,
    downloadFormat: 'mp3',
    showSkipIntervalButtons: false,
    showSleepTimerButton: false,
    skipBackwardInterval: 15,
    skipForwardInterval: 30,
    remoteControlMode: 'skip-track',
  });
  streamFormatSheetStore.setState({ visible: false, target: 'stream' });
  mockAlert.mockReset();
});

describe('SettingsAudioQualityScreen', () => {
  it('renders the streaming and downloading sections', () => {
    const { getByText } = render(<SettingsAudioQualityScreen />);
    expect(getByText('Streaming')).toBeTruthy();
    expect(getByText('Downloading')).toBeTruthy();
  });

  it('renders the format compatibility warning under each section', () => {
    const { getAllByText } = render(<SettingsAudioQualityScreen />);
    const warnings = getAllByText(/MP3 and Original work on virtually any server/);
    expect(warnings.length).toBe(2);
  });

  it('shows the current streaming format label (preset)', () => {
    playbackSettingsStore.setState({ streamFormat: 'mp3' });
    const { getAllByText } = render(<SettingsAudioQualityScreen />);
    // 'MP3' appears in both streaming (mp3 here) and download (mp3 default) rows.
    expect(getAllByText('MP3').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the raw custom value when format is not in presets', () => {
    playbackSettingsStore.setState({ streamFormat: 'opus_128_car' });
    const { getByText } = render(<SettingsAudioQualityScreen />);
    expect(getByText('opus_128_car')).toBeTruthy();
  });

  it('opens the sheet for the streaming target when the streaming format row is pressed', () => {
    const { getAllByText } = render(<SettingsAudioQualityScreen />);
    const formatRows = getAllByText('Format');
    // First Format row is the streaming section (declared first in JSX).
    fireEvent.press(formatRows[0]);
    expect(streamFormatSheetStore.getState().visible).toBe(true);
    expect(streamFormatSheetStore.getState().target).toBe('stream');
  });

  it('opens the sheet for the download target when the download format row is pressed', () => {
    const { getAllByText } = render(<SettingsAudioQualityScreen />);
    const formatRows = getAllByText('Format');
    fireEvent.press(formatRows[1]);
    expect(streamFormatSheetStore.getState().visible).toBe(true);
    expect(streamFormatSheetStore.getState().target).toBe('download');
  });

  it('mounts the StreamFormatSheet at the bottom of the tree', () => {
    const { getByTestId } = render(<SettingsAudioQualityScreen />);
    expect(getByTestId('stream-format-sheet')).toBeTruthy();
  });

  it('hides the reset button when settings are at their defaults', () => {
    const { queryByText } = render(<SettingsAudioQualityScreen />);
    expect(queryByText('Reset to Defaults')).toBeNull();
  });

  it('shows the reset button when settings differ from defaults', () => {
    playbackSettingsStore.setState({ streamFormat: 'mp3' });
    const { getByText } = render(<SettingsAudioQualityScreen />);
    expect(getByText('Reset to Defaults')).toBeTruthy();
  });

  describe('streaming bitrate dropdown', () => {
    it('opens the dropdown and selects a bitrate value', () => {
      const { getAllByText, getByText } = render(<SettingsAudioQualityScreen />);
      // Open by tapping the Max bitrate row (first occurrence is streaming).
      fireEvent.press(getAllByText('Max bitrate')[0]);
      // Now the option list is visible — pick 192 kbps.
      fireEvent.press(getByText('192 kbps'));
      expect(playbackSettingsStore.getState().maxBitRate).toBe(192);
    });

    it('toggles the dropdown closed when re-tapped', () => {
      const { getAllByText, queryAllByText } = render(<SettingsAudioQualityScreen />);
      const headers = getAllByText('Max bitrate');
      fireEvent.press(headers[0]);
      // Option visible now
      expect(queryAllByText('192 kbps').length).toBeGreaterThan(0);
      fireEvent.press(getAllByText('Max bitrate')[0]);
      expect(queryAllByText('192 kbps').length).toBe(0);
    });
  });

  describe('download bitrate dropdown', () => {
    it('opens the dropdown and selects a bitrate value', () => {
      const { getAllByText, getByText } = render(<SettingsAudioQualityScreen />);
      // Second 'Max bitrate' is the download row.
      fireEvent.press(getAllByText('Max bitrate')[1]);
      fireEvent.press(getByText('128 kbps'));
      expect(playbackSettingsStore.getState().downloadMaxBitRate).toBe(128);
    });
  });

  describe('reset to defaults', () => {
    it('opens an alert with cancel + reset buttons when reset is pressed', () => {
      playbackSettingsStore.setState({ streamFormat: 'mp3', downloadMaxBitRate: 64 });
      const { getByText } = render(<SettingsAudioQualityScreen />);
      fireEvent.press(getByText('Reset to Defaults'));
      expect(mockAlert).toHaveBeenCalled();
      const buttons = mockAlert.mock.calls[0][2] as Array<{ text: string; style?: string; onPress?: () => void }>;
      expect(buttons.find((b) => b.text === 'Cancel')).toBeDefined();
      expect(buttons.find((b) => b.text === 'Reset')).toBeDefined();
    });

    it('exercises pressed style branches on all interactive Pressables', () => {
      // Open both bitrate dropdowns and force a non-default state so the
      // reset button is rendered as well.
      playbackSettingsStore.setState({ streamFormat: 'mp3' });
      const { getAllByText, UNSAFE_root } = render(<SettingsAudioQualityScreen />);
      fireEvent.press(getAllByText('Max bitrate')[0]);
      fireEvent.press(getAllByText('Max bitrate')[1]);
      const pressables = UNSAFE_root.findAll(
        (node: { props?: Record<string, unknown> }) =>
          typeof node.props?.onPress === 'function' &&
          typeof node.props?.style === 'function',
      );
      expect(pressables.length).toBeGreaterThan(0);
      for (const p of pressables) {
        const result = p.props.style({ pressed: true });
        expect(result).toBeTruthy();
      }
    });

    it('restores all defaults when the destructive button is pressed', () => {
      playbackSettingsStore.setState({
        streamFormat: 'opus',
        maxBitRate: 192,
        downloadFormat: 'flac',
        downloadMaxBitRate: 64,
      });
      const { getByText } = render(<SettingsAudioQualityScreen />);
      fireEvent.press(getByText('Reset to Defaults'));
      const buttons = mockAlert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
      const reset = buttons.find((b) => b.text === 'Reset');
      act(() => {
        reset?.onPress?.();
      });
      const state = playbackSettingsStore.getState();
      expect(state.streamFormat).toBe('raw');
      expect(state.maxBitRate).toBeNull();
      expect(state.downloadFormat).toBe('mp3');
      expect(state.downloadMaxBitRate).toBe(320);
    });
  });
});
