jest.mock('../../../store/persistence/kvStorage', () =>
  require('../../../store/persistence/__mocks__/kvStorage'),
);
jest.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: { primary: '#f60', textPrimary: '#fff', textSecondary: '#888', border: '#333' },
  }),
}));
const mockSetAutoplayEnabled = jest.fn();
jest.mock('../../../services/playerService', () => ({
  setAutoplayEnabled: (enabled: boolean) => mockSetAutoplayEnabled(enabled),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';

import { playbackSettingsStore } from '../../../store/playbackSettingsStore';
import { AutoplayCard } from '../AutoplayCard';
import { PlaybackModeCard } from '../PlaybackModeCard';

beforeEach(() => {
  mockSetAutoplayEnabled.mockClear();
  playbackSettingsStore.setState({
    autoplayEnabled: false,
    playbackMode: 'gapless',
    crossfadeDurationMs: 5000,
  });
});

it('explains autoplay and delegates queue effects to the player service', () => {
  render(<AutoplayCard />);
  expect(screen.getByText('Keep playing related music when your queue runs out.')).toBeTruthy();
  fireEvent(screen.getByTestId('autoplay-toggle'), 'valueChange', true);
  expect(mockSetAutoplayEnabled).toHaveBeenCalledWith(true);
});

it('places the autoplay toggle and hint inside the Playback Mode card', () => {
  render(<PlaybackModeCard />);

  expect(screen.getByText('Playback Mode')).toBeTruthy();
  expect(screen.getByLabelText('Autoplay')).toBeTruthy();
  expect(screen.getByText('Keep playing related music when your queue runs out.')).toBeTruthy();
});

it('keeps autoplay after the crossfade duration selector', () => {
  playbackSettingsStore.setState({ playbackMode: 'crossfade' });
  render(<PlaybackModeCard />);

  expect(screen.getByText('Crossfade duration')).toBeTruthy();
  expect(screen.getByLabelText('Autoplay')).toBeTruthy();
});
