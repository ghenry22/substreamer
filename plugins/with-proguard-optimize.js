const { withAppBuildGradle } = require("expo/config-plugins");

const LEGACY = 'getDefaultProguardFile("proguard-android.txt")';
const OPTIMIZING = 'getDefaultProguardFile("proguard-android-optimize.txt")';

/**
 * Config plugin that switches release builds to the OPTIMIZING default ProGuard config.
 *
 * Expo's prebuild template (as of the SDK this app is on) emits
 * `proguard-android.txt`, whose only difference from `proguard-android-optimize.txt` is
 * that it adds `-dontoptimize`. So R8 shrinks and obfuscates but runs no optimization
 * passes at all, which is what Play Console reports as "Optimization isn't enabled".
 *
 * There is no way to undo `-dontoptimize` from `proguard-rules.pro`: R8 maps it straight
 * to `disableOptimization()` and has no inverse directive, so the default file has to be
 * swapped. `expo-build-properties` exposes only `extraProguardRules`, not which default
 * file is used.
 *
 * Expo's own current bare-minimum template already uses the optimizing file, and
 * `proguard-android.txt` is rejected outright by AGP 9, so this is where upstream is
 * heading anyway.
 *
 * Note this is the only plugin here using `withAppBuildGradle` — the others use
 * `withDangerousMod` because they edit files config-plugins has no mod for. That is
 * deliberate, not an oversight: app/build.gradle has a first-class mod, and it runs after
 * every dangerous mod, so it reads the final file.
 */
function withProguardOptimize(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes(OPTIMIZING)) return config;

    // Fail loudly. Silently returning config unchanged would leave optimization off while
    // looking like the plugin had applied.
    if (!contents.includes(LEGACY)) {
      throw new Error(
        "[with-proguard-optimize] Could not find " +
          `${LEGACY} in app/build.gradle. The Expo template has changed — check whether ` +
          "it already uses the optimizing config, and update or remove this plugin."
      );
    }

    config.modResults.contents = contents.replace(LEGACY, OPTIMIZING);
    return config;
  });
}

module.exports = withProguardOptimize;
