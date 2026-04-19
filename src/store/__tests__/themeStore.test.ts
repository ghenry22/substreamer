jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { themeStore } from '../themeStore';

beforeEach(() => {
  themeStore.setState({
    themePreference: 'system',
    primaryColor: null,
  });
});

describe('themeStore', () => {
  it('setThemePreference to dark', () => {
    themeStore.getState().setThemePreference('dark');
    expect(themeStore.getState().themePreference).toBe('dark');
  });

  it('setThemePreference to light', () => {
    themeStore.getState().setThemePreference('light');
    expect(themeStore.getState().themePreference).toBe('light');
  });

  it('setPrimaryColor sets color', () => {
    themeStore.getState().setPrimaryColor('#FF0000');
    expect(themeStore.getState().primaryColor).toBe('#FF0000');
  });

  it('setPrimaryColor to null resets', () => {
    themeStore.getState().setPrimaryColor('#FF0000');
    themeStore.getState().setPrimaryColor(null);
    expect(themeStore.getState().primaryColor).toBeNull();
  });
});
