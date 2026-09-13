#!/usr/bin/env node

/**
 * Validates plugins/proguard-rules.pro for the presence of keep rules that
 * are load-bearing for our release build. The rules below have known
 * release-only crash modes if dropped — drift protection beats finding out
 * via a crashing APK.
 *
 * Wired into CI via `package.json` `scripts.validate:proguard` and the
 * tests workflow alongside `validate-translations.js`.
 */

const fs = require('fs');
const path = require('path');

const RULES_PATH = path.join(__dirname, '..', 'plugins', 'proguard-rules.pro');

const REQUIRED = [
  {
    name: 'line-number attributes',
    pattern: /^-keepattributes\s+SourceFile,LineNumberTable/m,
    why: 'R8 optimization inlines frames; without these a Play crash has no line numbers',
  },
  {
    name: 'expo.modules keep',
    pattern: /^-keep\s+class\s+expo\.modules\.\*\*\s+\{\s*\*;\s*\}/m,
    why: 'Expo module reflection paths',
  },
  {
    name: 'androidx.media3 keep',
    pattern: /^-keep\s+class\s+androidx\.media3\.\*\*\s+\{\s*\*;\s*\}/m,
    why: 'Media3 / ExoPlayer — release-only playback crashes if stripped',
  },
  {
    name: 'okhttp3 keep',
    pattern: /^-keep\s+class\s+okhttp3\.\*\*\s+\{\s*\*;\s*\}/m,
    why: 'RN networking + Media3 DataSource',
  },
  {
    name: 'okio keep',
    pattern: /^-keep\s+class\s+okio\.\*\*\s+\{\s*\*;\s*\}/m,
    why: 'OkHttp dependency',
  },
  {
    name: 'OkHttpClientProvider keep',
    pattern: /^-keep\s+class\s+com\.facebook\.react\.modules\.network\.OkHttpClientProvider\s+\{\s*\*;\s*\}/m,
    why: 'expo-ssl-trust reflective access via Class.forName',
  },
  {
    name: 'OkHttpClientFactory keep',
    pattern: /^-keep\s+class\s+com\.facebook\.react\.modules\.network\.OkHttpClientFactory\s+\{\s*\*;\s*\}/m,
    why: 'expo-ssl-trust custom client factory wiring',
  },
  {
    name: 'com.facebook.hermes keep',
    pattern: /^-keep\s+class\s+com\.facebook\.hermes\.\*\*\s+\{\s*\*;\s*\}/m,
    why: 'JSI bridge init',
  },
  {
    name: 'X509TrustManager implementations keep',
    pattern: /^-keep\s+class\s+\*\s+implements\s+javax\.net\.ssl\.X509TrustManager\s+\{\s*\*;\s*\}/m,
    why: 'expo-ssl-trust custom TrustManager',
  },
  {
    name: 'HostnameVerifier implementations keep',
    pattern: /^-keep\s+class\s+\*\s+implements\s+javax\.net\.ssl\.HostnameVerifier\s+\{\s*\*;\s*\}/m,
    why: 'expo-ssl-trust custom HostnameVerifier',
  },
];

function main() {
  if (!fs.existsSync(RULES_PATH)) {
    console.error(`[validate-proguard-rules] missing file: ${RULES_PATH}`);
    process.exit(1);
  }
  const content = fs.readFileSync(RULES_PATH, 'utf8');

  const missing = REQUIRED.filter((r) => !r.pattern.test(content));
  if (missing.length === 0) {
    console.log(`[validate-proguard-rules] OK (${REQUIRED.length} required keep rules present)`);
    return;
  }

  console.error('[validate-proguard-rules] missing required keep rules:');
  for (const { name, why } of missing) {
    console.error(`  - ${name}  (${why})`);
  }
  console.error(`\nEdit plugins/proguard-rules.pro to restore them.`);
  process.exit(1);
}

main();
