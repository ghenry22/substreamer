// Mock ESM polyfills that break Jest
jest.mock('@formatjs/intl-getcanonicallocales/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-locale/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-pluralrules/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/en.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/fr.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/de.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/es.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/it.js', () => {});
jest.mock('@formatjs/intl-numberformat/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/en.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/fr.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/de.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/es.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/it.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/add-all-tz.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/en.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/fr.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/de.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/es.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/it.js', () => {});

// Mock expo-localization
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

// Mock kvStorage for the localeStore persistence layer
jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import i18n from '../i18n';

describe('i18n', () => {
  it('is initialized after import', () => {
    expect(i18n.isInitialized).toBe(true);
  });

  it('has language set to "en" by default', () => {
    expect(i18n.language).toBe('en');
  });

  it('has "en" as the fallback language', () => {
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });

  it('loads English translations (spot check keys)', () => {
    expect(i18n.t('home')).toBe('Home');
    expect(i18n.t('library')).toBe('Library');
    expect(i18n.t('settings')).toBe('Settings');
    expect(i18n.t('search')).toBe('Search');
    expect(i18n.t('favorites')).toBe('Favorites');
  });

  it('returns expected English text for known keys', () => {
    expect(i18n.t('logIn')).toBe('Log in');
    expect(i18n.t('offlineMode')).toBe('Offline Mode');
    expect(i18n.t('language')).toBe('Language');
    expect(i18n.t('deviceDefault')).toBe('Device default');
  });

  it('handles interpolation', () => {
    const result = i18n.t('versionText', { version: '1.0', build: '42' });
    expect(result).toBe('Version 1.0 (42)');
  });

  it('handles interpolation with other keys', () => {
    const result = i18n.t('removeNetworkMessage', { ssid: 'MyWiFi' });
    expect(result).toBe('Remove "MyWiFi" from your home networks?');
  });

  it('handles plurals - singular', () => {
    const result = i18n.t('songCount', { count: 1 });
    expect(result).toBe('1 song');
  });

  it('handles plurals - plural', () => {
    const result = i18n.t('songCount', { count: 5 });
    expect(result).toBe('5 songs');
  });

  it('handles plurals - zero uses plural form', () => {
    const result = i18n.t('songCount', { count: 0 });
    expect(result).toBe('0 songs');
  });

  it('handles other plural keys', () => {
    expect(i18n.t('albumCount', { count: 1 })).toBe('1 album');
    expect(i18n.t('albumCount', { count: 3 })).toBe('3 albums');
  });

  it('returns the key itself for missing keys', () => {
    const missingKey = 'this.key.does.not.exist';
    const result = i18n.t(missingKey);
    expect(result).toBe(missingKey);
  });

  it('returns the key for another missing key', () => {
    const result = i18n.t('completelyFakeKey');
    expect(result).toBe('completelyFakeKey');
  });

  it('does not escape values (escapeValue is false)', () => {
    const result = i18n.t('removeNetworkMessage', { ssid: '<script>alert("xss")</script>' });
    expect(result).toContain('<script>');
  });

  it('uses "translation" as the default namespace', () => {
    expect(i18n.options.defaultNS).toBe('translation');
  });

  it('backend loader returns undefined for languages without a loader', async () => {
    // Triggering the resourcesToBackend callback by loading a language
    // that has no entry in localeImports — the callback returns undefined
    // and i18next falls back to English. Use loadLanguages to force the
    // backend to attempt loading.
    await i18n.loadLanguages('fr');
    expect(i18n.t('home')).toBe('Home');
  });
});
