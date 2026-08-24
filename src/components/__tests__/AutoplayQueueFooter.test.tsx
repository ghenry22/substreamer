jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ colors: { textPrimary: '#fff', textSecondary: '#999' } }),
}));

import { render } from '@testing-library/react-native';

import { playerStore } from '../../store/playerStore';
import { AutoplayQueueFooter } from '../AutoplayQueueFooter';

beforeEach(() => {
  playerStore.setState({ autoplayLoading: false, currentTrackIndex: null, queueOrigins: [] });
});

it('stays hidden when autoplay is idle', () => {
  expect(render(<AutoplayQueueFooter />).queryByText('Finding related music…')).toBeNull();
});

it('shows an accessible loading status and heading', () => {
  playerStore.setState({ autoplayLoading: true });
  const view = render(<AutoplayQueueFooter />);
  expect(view.getByRole('header')).toHaveTextContent('Autoplay');
  expect(
    view.getByLabelText('Building your autoplay queue…').props.accessibilityLiveRegion,
  ).toBe('polite');
});

it('does not repeat an existing upcoming autoplay heading', () => {
  playerStore.setState({
    autoplayLoading: true,
    currentTrackIndex: 0,
    queueOrigins: ['manual', 'autoplay'],
  });
  expect(render(<AutoplayQueueFooter />).queryByRole('header')).toBeNull();
});
