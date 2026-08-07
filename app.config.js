/**
 * Dynamic Expo config — extends `app.json` with values that can't live in
 * static JSON. Currently used only to inject `android.extraProguardRules`
 * from `plugins/proguard-rules.pro` (Phase 8 of
 * `plans/2026-05-22-audit-remediation-roadmap.md`).
 *
 * Everything else stays in `app.json`. Expo's resolution: this function
 * receives the parsed `app.json` in `context.config` and we patch the
 * `expo-build-properties` plugin's android config.
 */
const fs = require('fs');
const path = require('path');

const PROGUARD_RULES_PATH = path.join(__dirname, 'plugins', 'proguard-rules.pro');
const isLocalIosDevelopment = process.env.SUBSTREAMER_LOCAL_IOS === '1';
const isIosPrPreview = process.env.SUBSTREAMER_IOS_PR_PREVIEW === '1';
const isIosSideStore = process.env.SUBSTREAMER_IOS_SIDESTORE === '1';
const isRestrictedIosBuild =
  isLocalIosDevelopment || isIosPrPreview || isIosSideStore;

module.exports = ({ config }) => {
  const extraProguardRules = fs.readFileSync(PROGUARD_RULES_PATH, 'utf8');

  const plugins = (config.plugins ?? [])
    .filter(
      (entry) =>
        !isRestrictedIosBuild || entry !== './plugins/with-carplay-appearance-fix',
    )
    .map((entry) => {
      if (!Array.isArray(entry)) return entry;

      const [name, options] = entry;
      if (name === 'expo-build-properties') {
        return [
          name,
          {
            ...options,
            android: {
              ...(options?.android ?? {}),
              extraProguardRules,
            },
          },
        ];
      }

      if (isRestrictedIosBuild && name === 'react-native-queue-player') {
        return [
          name,
          {
            ...options,
            carplay: false,
            siri: false,
          },
        ];
      }

      return entry;
    });

  if (!isRestrictedIosBuild) return { ...config, plugins };

  const bundleIdentifier = process.env.SUBSTREAMER_IOS_BUNDLE_IDENTIFIER;
  if (!bundleIdentifier) {
    throw new Error(
      'SUBSTREAMER_IOS_BUNDLE_IDENTIFIER is required for restricted iOS builds',
    );
  }

  const entitlements = { ...(config.ios?.entitlements ?? {}) };
  delete entitlements['com.apple.developer.networking.wifi-info'];
  delete entitlements['com.apple.developer.carplay-audio'];

  const displayName = process.env.SUBSTREAMER_IOS_DISPLAY_NAME;
  const version = process.env.SUBSTREAMER_IOS_VERSION;
  const buildNumber = process.env.SUBSTREAMER_IOS_BUILD_NUMBER;

  return {
    ...config,
    ...(version ? { version } : {}),
    ios: {
      ...config.ios,
      bundleIdentifier,
      ...(buildNumber ? { buildNumber } : {}),
      entitlements,
      infoPlist: {
        ...(config.ios?.infoPlist ?? {}),
        ...(displayName ? { CFBundleDisplayName: displayName } : {}),
      },
    },
    plugins,
  };
};
