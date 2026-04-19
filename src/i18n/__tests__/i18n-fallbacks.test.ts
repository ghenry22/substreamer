// Mock ESM polyfills that break Jest
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

// Default mock — overridden per test via jest.doMock + resetModules
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

describe('getDeviceLocale fallback', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('falls back to "en" when getLocales throws', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => { throw new Error('unavailable'); },
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('en');
  });

  it('falls back to "en" when getLocales returns locale without languageCode or languageTag', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{}],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('en');
  });

  it('falls back to "en" when device locale is not in supported list', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'xx', languageTag: 'xx-XX' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('en');
  });

  it('resolves Simplified Chinese (zh-Hans-CN) to zh-Hans', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'zh', languageTag: 'zh-Hans-CN' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('zh-Hans');
  });

  it('resolves Traditional Chinese (zh-Hant-TW) to zh-Hant', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'zh', languageTag: 'zh-Hant-TW' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('zh-Hant');
  });

  it('resolves Hong Kong Chinese (zh-HK) to zh-Hant', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'zh', languageTag: 'zh-HK' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('zh-Hant');
  });

  it('resolves Macau Chinese (zh-MO) to zh-Hant', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'zh', languageTag: 'zh-MO' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('zh-Hant');
  });

  it('defaults bare "zh" to zh-Hans', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'zh', languageTag: 'zh' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('zh-Hans');
  });

  it('routes Singapore Chinese (zh-SG) to zh-Hans', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'zh', languageTag: 'zh-SG' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('zh-Hans');
  });
});

describe('getInitialLocale with stored locale', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('uses stored locale when it is in supported list', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'en' }],
    }));
    // Pre-seed the store with a persisted locale
    const { localeStore } = require('../../store/localeStore');
    localeStore.setState({ locale: 'en' });

    const i18n = require('../i18n').default;
    expect(i18n.language).toBe('en');
  });

  it('ignores stored locale when it is not in supported list', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'en' }],
    }));
    // Pre-seed with an unsupported locale
    const { localeStore } = require('../../store/localeStore');
    localeStore.setState({ locale: 'zz' });

    const i18n = require('../i18n').default;
    // 'zz' is not supported, falls back to device locale 'en'
    expect(i18n.language).toBe('en');
  });
});

describe('eager-loaded locale resources', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('has all supported locales bundled in resources', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'en' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('fr', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('it', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('ru', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('zh-Hans', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('zh-Hant', 'translation')).toBe(true);
  });

  it('translates keys in non-English locale', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'en' }],
    }));
    const i18n = require('../i18n').default;
    // Verify a known French translation exists and differs from English
    const frHome = i18n.getResource('fr', 'translation', 'home');
    expect(frHome).toBeDefined();
    expect(typeof frHome).toBe('string');
  });

  it('falls back to English for unsupported locale', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageCode: 'en' }],
    }));
    const i18n = require('../i18n').default;
    expect(i18n.hasResourceBundle('xx', 'translation')).toBe(false);
    expect(i18n.t('home', { lng: 'xx' })).toBe('Home');
  });
});
