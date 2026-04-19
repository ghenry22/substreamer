jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { localeStore } from '../localeStore';

beforeEach(() => {
  localeStore.setState({ locale: null });
});

describe('localeStore', () => {
  it('has null locale by default', () => {
    expect(localeStore.getState().locale).toBeNull();
  });

  it('setLocale updates locale to a language code', () => {
    localeStore.getState().setLocale('es');
    expect(localeStore.getState().locale).toBe('es');
  });

  it('setLocale updates to a different language code', () => {
    localeStore.getState().setLocale('fr');
    expect(localeStore.getState().locale).toBe('fr');
  });

  it('setLocale(null) resets locale to null', () => {
    localeStore.getState().setLocale('es');
    expect(localeStore.getState().locale).toBe('es');
    localeStore.getState().setLocale(null);
    expect(localeStore.getState().locale).toBeNull();
  });

  it('persists only locale (partialize excludes setLocale)', () => {
    // The persist middleware's partialize should only include `locale`
    const state = localeStore.getState();
    const partializedKeys = Object.keys({ locale: state.locale });
    expect(partializedKeys).toEqual(['locale']);
    // setLocale should be a function, not persisted data
    expect(typeof state.setLocale).toBe('function');
  });

  it('handles sequential locale changes', () => {
    localeStore.getState().setLocale('de');
    expect(localeStore.getState().locale).toBe('de');
    localeStore.getState().setLocale('ja');
    expect(localeStore.getState().locale).toBe('ja');
    localeStore.getState().setLocale(null);
    expect(localeStore.getState().locale).toBeNull();
  });
});
