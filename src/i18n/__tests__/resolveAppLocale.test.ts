// Mock ESM polyfills that break Jest — i18n.ts transitively loads formatjs.
jest.mock('@formatjs/intl-getcanonicallocales/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-locale/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-pluralrules/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/en.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/fr.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/de.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/es.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/it.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/ru.js', () => {});
jest.mock('@formatjs/intl-pluralrules/locale-data/zh.js', () => {});
jest.mock('@formatjs/intl-numberformat/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/en.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/fr.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/de.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/es.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/it.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/ru.js', () => {});
jest.mock('@formatjs/intl-numberformat/locale-data/zh.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/polyfill-force.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/add-all-tz.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/en.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/fr.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/de.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/es.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/it.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/ru.js', () => {});
jest.mock('@formatjs/intl-datetimeformat/locale-data/zh.js', () => {});
jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { resolveAppLocale } from '../i18n';

describe('resolveAppLocale', () => {
  it('returns null for nullish input', () => {
    expect(resolveAppLocale(null)).toBe(null);
    expect(resolveAppLocale(undefined)).toBe(null);
    expect(resolveAppLocale('')).toBe(null);
  });

  it('returns the 2-letter code for non-Chinese locales', () => {
    expect(resolveAppLocale('en-US')).toBe('en');
    expect(resolveAppLocale('fr-FR')).toBe('fr');
    expect(resolveAppLocale('de-AT')).toBe('de');
    expect(resolveAppLocale('ru-RU')).toBe('ru');
    expect(resolveAppLocale('ja-JP')).toBe('ja');
  });

  it('returns the 2-letter code for bare language tags', () => {
    expect(resolveAppLocale('en')).toBe('en');
    expect(resolveAppLocale('es')).toBe('es');
  });

  it('lowercases the language subtag', () => {
    expect(resolveAppLocale('EN-US')).toBe('en');
    expect(resolveAppLocale('FR')).toBe('fr');
  });

  describe('Chinese variants', () => {
    it('routes Hans script to zh-Hans', () => {
      expect(resolveAppLocale('zh-Hans')).toBe('zh-Hans');
      expect(resolveAppLocale('zh-Hans-CN')).toBe('zh-Hans');
      expect(resolveAppLocale('zh-Hans-SG')).toBe('zh-Hans');
    });

    it('routes Hant script to zh-Hant', () => {
      expect(resolveAppLocale('zh-Hant')).toBe('zh-Hant');
      expect(resolveAppLocale('zh-Hant-TW')).toBe('zh-Hant');
      expect(resolveAppLocale('zh-Hant-HK')).toBe('zh-Hant');
    });

    it('routes TW/HK/MO regions to zh-Hant when no script is present', () => {
      expect(resolveAppLocale('zh-TW')).toBe('zh-Hant');
      expect(resolveAppLocale('zh-HK')).toBe('zh-Hant');
      expect(resolveAppLocale('zh-MO')).toBe('zh-Hant');
    });

    it('defaults bare zh to zh-Hans', () => {
      expect(resolveAppLocale('zh')).toBe('zh-Hans');
    });

    it('defaults other zh regions (e.g. SG, CN) to zh-Hans', () => {
      expect(resolveAppLocale('zh-CN')).toBe('zh-Hans');
      expect(resolveAppLocale('zh-SG')).toBe('zh-Hans');
    });
  });
});
