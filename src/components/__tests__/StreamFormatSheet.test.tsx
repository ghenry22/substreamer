jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Gesture: { Pan: () => ({ activeOffsetY: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) }) },
    GestureDetector: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (init: number) => ({ value: init }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withSpring: (val: number) => val,
    withTiming: (val: number, _config?: object, cb?: (finished: boolean) => void) => {
      if (cb) cb(true);
      return val;
    },
    runOnJS: (fn: Function) => fn,
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: (props: { name: string }) => (
      <Text testID={`icon-${props.name}`}>{props.name}</Text>
    ),
  };
});

import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { playbackSettingsStore } from '../../store/playbackSettingsStore';
import { streamFormatSheetStore } from '../../store/streamFormatSheetStore';

// Must import after mocks
const { StreamFormatSheet } = require('../StreamFormatSheet');

function resetStores() {
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
  streamFormatSheetStore.setState({ visible: true, target: 'stream' });
}

beforeEach(() => {
  resetStores();
  Platform.OS = 'android';
  jest.clearAllMocks();
});

describe('StreamFormatSheet', () => {
  describe('pick mode rendering', () => {
    it('renders the streaming title when target is stream', () => {
      streamFormatSheetStore.setState({ visible: true, target: 'stream' });
      const { getByText } = render(<StreamFormatSheet />);
      expect(getByText('Streaming format')).toBeTruthy();
    });

    it('renders the download title when target is download', () => {
      streamFormatSheetStore.setState({ visible: true, target: 'download' });
      const { getByText } = render(<StreamFormatSheet />);
      expect(getByText('Download format')).toBeTruthy();
    });

    it('renders all preset rows', () => {
      const { getByText } = render(<StreamFormatSheet />);
      expect(getByText('Original')).toBeTruthy();
      expect(getByText('MP3')).toBeTruthy();
      expect(getByText('MP3 (Replay Gain)')).toBeTruthy();
      expect(getByText('MP3 (Car mode)')).toBeTruthy();
      expect(getByText('AAC')).toBeTruthy();
      expect(getByText('M4A (AAC in MP4)')).toBeTruthy();
      expect(getByText('Opus')).toBeTruthy();
      expect(getByText('Opus (Replay Gain)')).toBeTruthy();
      expect(getByText('Opus (Car mode)')).toBeTruthy();
      expect(getByText('Ogg Vorbis')).toBeTruthy();
      expect(getByText('FLAC')).toBeTruthy();
    });

    it('renders the Add custom format row', () => {
      const { getByText } = render(<StreamFormatSheet />);
      expect(getByText('Add custom format…')).toBeTruthy();
    });

    it('shows checkmark on the active preset for stream target', () => {
      playbackSettingsStore.setState({ streamFormat: 'mp3' });
      const { getAllByTestId } = render(<StreamFormatSheet />);
      // At least one checkmark (active row)
      expect(getAllByTestId('icon-checkmark').length).toBeGreaterThan(0);
    });

    it('shows the custom subtitle when persisted value is not a preset', () => {
      playbackSettingsStore.setState({ streamFormat: 'opus_128_car' });
      const { getByText } = render(<StreamFormatSheet />);
      expect(getByText(/Custom — opus_128_car/)).toBeTruthy();
    });
  });

  describe('selecting a preset', () => {
    it('updates streamFormat and hides the sheet on Android', () => {
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('MP3'));
      expect(playbackSettingsStore.getState().streamFormat).toBe('mp3');
      expect(streamFormatSheetStore.getState().visible).toBe(false);
    });

    it('updates downloadFormat when target is download', () => {
      streamFormatSheetStore.setState({ visible: true, target: 'download' });
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('FLAC'));
      expect(playbackSettingsStore.getState().downloadFormat).toBe('flac');
      expect(streamFormatSheetStore.getState().visible).toBe(false);
    });

    it('preserves Original (raw) sentinel', () => {
      playbackSettingsStore.setState({ streamFormat: 'mp3' });
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Original'));
      expect(playbackSettingsStore.getState().streamFormat).toBe('raw');
    });
  });

  describe('iOS Opus warning', () => {
    let alertSpy: jest.SpyInstance;

    beforeEach(() => {
      Platform.OS = 'ios';
      alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    });

    afterEach(() => {
      alertSpy.mockRestore();
      Platform.OS = 'android';
    });

    it('shows the alert when selecting Opus from a non-Opus value', () => {
      playbackSettingsStore.setState({ streamFormat: 'mp3' });
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Opus'));
      expect(alertSpy).toHaveBeenCalled();
      // The format must NOT have changed yet — only the affirmative button commits.
      expect(playbackSettingsStore.getState().streamFormat).toBe('mp3');
    });

    it('commits the change when the affirmative button is pressed', () => {
      playbackSettingsStore.setState({ streamFormat: 'mp3' });
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Opus'));
      // Grab the buttons array passed to Alert.alert and trigger the affirmative one.
      const callArgs = alertSpy.mock.calls[0];
      const buttons = callArgs[2] as Array<{ text: string; style?: string; onPress?: () => void }>;
      const confirm = buttons.find((b) => b.text === 'Use Opus');
      expect(confirm).toBeDefined();
      act(() => {
        confirm?.onPress?.();
      });
      expect(playbackSettingsStore.getState().streamFormat).toBe('opus');
      expect(streamFormatSheetStore.getState().visible).toBe(false);
    });

    it('does not commit when the cancel button has no onPress and is not invoked', () => {
      playbackSettingsStore.setState({ streamFormat: 'mp3' });
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Opus'));
      // Cancel does NOT carry an onPress that commits.
      const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
      const cancel = buttons.find((b) => b.text === 'Cancel');
      cancel?.onPress?.();
      expect(playbackSettingsStore.getState().streamFormat).toBe('mp3');
    });

    it('does not show the alert when moving from one Opus variant to another', () => {
      playbackSettingsStore.setState({ streamFormat: 'opus' });
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Opus (Replay Gain)'));
      expect(alertSpy).not.toHaveBeenCalled();
      expect(playbackSettingsStore.getState().streamFormat).toBe('opus_rg');
    });

    it('does not show the alert when selecting a non-Opus preset', () => {
      playbackSettingsStore.setState({ streamFormat: 'mp3' });
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('AAC'));
      expect(alertSpy).not.toHaveBeenCalled();
      expect(playbackSettingsStore.getState().streamFormat).toBe('aac');
    });
  });

  describe('Android Opus selection', () => {
    it('commits Opus directly without an alert on Android', () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      playbackSettingsStore.setState({ streamFormat: 'mp3' });
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Opus'));
      expect(alertSpy).not.toHaveBeenCalled();
      expect(playbackSettingsStore.getState().streamFormat).toBe('opus');
      expect(streamFormatSheetStore.getState().visible).toBe(false);
      alertSpy.mockRestore();
    });
  });

  describe('create mode', () => {
    it('switches to create mode when Add custom format is pressed', () => {
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Add custom format…'));
      expect(getByText('Custom format')).toBeTruthy();
      expect(getByText('Save')).toBeTruthy();
    });

    it('back button returns to pick mode without committing', () => {
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Add custom format…'));
      fireEvent.press(getByText('Back'));
      expect(getByText('Add custom format…')).toBeTruthy();
      expect(playbackSettingsStore.getState().streamFormat).toBe('raw');
    });

    it('saving an empty input is a no-op', () => {
      const { getByText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Add custom format…'));
      fireEvent.press(getByText('Save'));
      // Sheet stays open and value unchanged
      expect(streamFormatSheetStore.getState().visible).toBe(true);
      expect(playbackSettingsStore.getState().streamFormat).toBe('raw');
    });

    it('saves a normalized custom value', () => {
      const { getByText, getByPlaceholderText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Add custom format…'));
      fireEvent.changeText(getByPlaceholderText('e.g. opus_128_car'), '  MP3_320  ');
      fireEvent.press(getByText('Save'));
      expect(playbackSettingsStore.getState().streamFormat).toBe('mp3_320');
      expect(streamFormatSheetStore.getState().visible).toBe(false);
    });

    it('prefills the input with the current custom value when re-entering', () => {
      playbackSettingsStore.setState({ streamFormat: 'opus_128_car' });
      const { getByText, getByDisplayValue } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Add custom format…'));
      expect(getByDisplayValue('opus_128_car')).toBeTruthy();
    });

    it('submitEditing on the input also saves', () => {
      const { getByText, getByPlaceholderText } = render(<StreamFormatSheet />);
      fireEvent.press(getByText('Add custom format…'));
      const input = getByPlaceholderText('e.g. opus_128_car');
      fireEvent.changeText(input, 'opus_192');
      fireEvent(input, 'submitEditing');
      expect(playbackSettingsStore.getState().streamFormat).toBe('opus_192');
    });
  });

  describe('pressed style branches', () => {
    it('exercises pressed branches on row Pressables', () => {
      const { UNSAFE_root } = render(<StreamFormatSheet />);
      const pressables = UNSAFE_root.findAll(
        (node: { props?: Record<string, unknown> }) =>
          typeof node.props?.onPress === 'function' &&
          typeof node.props?.style === 'function',
      );
      expect(pressables.length).toBeGreaterThan(0);
      // Just invoke the style function with pressed=true to cover the branch
      for (const p of pressables) {
        const result = p.props.style({ pressed: true });
        expect(result).toBeTruthy();
      }
    });
  });
});
