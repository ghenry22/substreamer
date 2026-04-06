// Polyfill Intl.PluralRules for Hermes — MUST be imported before i18next.
// Use /polyfill-force to skip slow detection code on Android/Hermes.
import '@formatjs/intl-pluralrules/polyfill-force.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/fr.js';
import '@formatjs/intl-pluralrules/locale-data/de.js';
import '@formatjs/intl-pluralrules/locale-data/es.js';
import '@formatjs/intl-pluralrules/locale-data/it.js';

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

// Locale JSON imports — add new imports here when enabling a language
import en from './locales/en.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import es from './locales/es.json';
import it from './locales/it.json';

import { SUPPORTED_LOCALE_CODES } from './languages';
import { localeStore } from '../store/localeStore';

/** Registry mapping locale code to its translation bundle. */
const localeResources: Record<string, { translation: Record<string, string> }> = {
  en: { translation: en },
  fr: { translation: fr },
  de: { translation: de },
  es: { translation: es },
  it: { translation: it },
  // Add new entries here when enabling a language
};

function getDeviceLocale(): string {
  try {
    const locales = getLocales();
    return locales[0]?.languageCode ?? 'en';
  } catch {
    return 'en';
  }
}

function getInitialLocale(): string {
  const stored = localeStore.getState().locale;
  if (stored && SUPPORTED_LOCALE_CODES.includes(stored)) return stored;
  const device = getDeviceLocale();
  if (SUPPORTED_LOCALE_CODES.includes(device)) return device;
  return 'en';
}

i18next
  .use(initReactI18next)
  .init({
    lng: getInitialLocale(),
    fallbackLng: 'en',
    ns: ['translation'],
    defaultNS: 'translation',
    resources: localeResources,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18next;
