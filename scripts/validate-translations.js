#!/usr/bin/env node

/**
 * Validates all translation locale files against the English source.
 *
 * Checks:
 * 1. Missing keys — every en.json key must exist in each locale
 * 2. Extra keys — no locale should have keys absent from en.json
 * 3. Interpolation — {{placeholder}} names must match between en and each locale
 *
 * Plural-aware: languages that lack a "one" plural category (e.g. ja, zh, ko)
 * are not required to have _one suffixed keys — only the _other form is mandatory.
 */

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const enPath = path.join(localesDir, 'en.json');

// Languages that use only the "other" plural form (no grammatical singular).
// CLDR: Japanese, Chinese, Korean, Vietnamese, Thai, Indonesian, Malay, etc.
const NO_SINGULAR_LOCALES = new Set([
  'ja', 'zh', 'ko', 'vi', 'th', 'id', 'ms',
]);

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const enKeys = Object.keys(en);

function getPlaceholders(str) {
  const matches = str.match(/\{\{(\w+)\}\}/g) || [];
  return matches.map((m) => m.slice(2, -2)).sort();
}

let errorCount = 0;

const localeFiles = fs
  .readdirSync(localesDir)
  .filter((f) => f.endsWith('.json') && f !== 'en.json');

for (const file of localeFiles) {
  const code = file.replace('.json', '');
  const locale = JSON.parse(
    fs.readFileSync(path.join(localesDir, file), 'utf8'),
  );
  const localeKeys = new Set(Object.keys(locale));

  // --- Missing keys ---
  const missing = enKeys.filter((k) => {
    if (localeKeys.has(k)) return false;
    // Allow _one keys to be absent for languages without grammatical singular
    if (NO_SINGULAR_LOCALES.has(code) && k.endsWith('_one')) return false;
    return true;
  });

  if (missing.length > 0) {
    const preview = missing.slice(0, 5).join(', ');
    const suffix = missing.length > 5 ? `, ... (${missing.length} total)` : '';
    console.error(`[${code}] Missing keys: ${preview}${suffix}`);
    errorCount += missing.length;
  }

  // --- Extra keys ---
  const enKeySet = new Set(enKeys);
  const extra = Object.keys(locale).filter((k) => !enKeySet.has(k));

  if (extra.length > 0) {
    const preview = extra.slice(0, 5).join(', ');
    const suffix = extra.length > 5 ? `, ... (${extra.length} total)` : '';
    console.error(`[${code}] Extra keys: ${preview}${suffix}`);
    errorCount += extra.length;
  }

  // --- Interpolation consistency ---
  for (const key of enKeys) {
    if (!localeKeys.has(key)) continue;
    const enPlaceholders = getPlaceholders(en[key]);
    if (enPlaceholders.length === 0) continue;
    const localePlaceholders = getPlaceholders(locale[key]);
    if (JSON.stringify(enPlaceholders) !== JSON.stringify(localePlaceholders)) {
      console.error(
        `[${code}] Placeholder mismatch in "${key}": en={${enPlaceholders.join(',')}} ${code}={${localePlaceholders.join(',')}}`,
      );
      errorCount++;
    }
  }
}

if (errorCount > 0) {
  console.error(`\nValidation failed with ${errorCount} error(s).`);
  process.exit(1);
} else {
  console.log(
    `All ${localeFiles.length} translation file(s) validated successfully.`,
  );
}
