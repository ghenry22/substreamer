jest.mock('../../../store/persistence/kvStorage', () =>
  require('../../../store/persistence/__mocks__/kvStorage'),
);

import { fireEvent, render, screen } from '@testing-library/react-native';

import { kvStorage } from '../../../store/persistence';
import { searchSettingsStore } from '../../../store/searchSettingsStore';
import { ServerSearchCard } from '../ServerSearchCard';

it('defaults to off and persists an opt-in from the switch', async () => {
  render(<ServerSearchCard />);
  const label = 'Include server search results';
  expect(screen.getByLabelText(label)).toHaveProp('accessibilityState', { checked: false });

  fireEvent(screen.getByLabelText(label), 'valueChange', true);

  expect(screen.getByLabelText(label)).toHaveProp('accessibilityState', { checked: true });
  const options = searchSettingsStore.persist.getOptions();
  const saved = await kvStorage.getItem(options.name!);
  expect(saved && JSON.parse(saved).state).toEqual({ alwaysSearchServer: true });
});
