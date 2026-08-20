const { withMainApplication } = require('expo/config-plugins');

/**
 * Disable React Native 0.86's Android feature flag
 * `overrideBySynchronousMountPropsAtMountingAndroid` (which DEFAULTS TO TRUE).
 *
 * When on, `SurfaceMountingManager.updateProps` merges direct-manipulation
 * "synchronous mount props" (how Reanimated / Native Animated push `transform`
 * and `opacity` under Fabric) onto React's incoming props and `assert()`s that
 * the incoming `transform` is an Array and `opacity` is a Number. A Reanimated-
 * animated view whose props arrive with a mismatched type mid-mount trips that
 * assert → `java.lang.AssertionError: Assertion failed` in
 * `SurfaceMountingManager.overridePropsReadableMap`, killing the app.
 *
 * REPRODUCED 2026-08-20 with this plugin removed: play a track, let it finish, and
 * the app dies on the transition to the next one — the now-playing indicator
 * (`transform: scaleY`, Reanimated) unmounts from the finished row and mounts on the
 * new one while React commits props to it. The opacity banners are the same hazard.
 * This is RN's merge asserting, not bad types on our side: the animated style passes
 * `transform` as a proper array. Fixing one component would leave every other
 * Reanimated transform/opacity animation in the app exposed, which is why this is a
 * global flag override rather than a component change.
 *
 * We can't patch RN source (it ships prebuilt here → source patches are inert),
 * but a runtime feature-flag override works on the prebuilt binary.
 *
 * WHERE it goes is load-bearing, and the two obvious placements are both wrong —
 * both were tried, both crashed on launch:
 *
 *   - Before `super.onCreate()`: `ReactNativeFeatureFlags.override` reaches native
 *     (`ReactNativeFeatureFlagsCxxInterop.<clinit>` → `SoLoader.loadLibrary`), and RN has
 *     not initialised SoLoader yet → `IllegalStateException: SoLoader.init() not yet called`.
 *   - Anywhere before `loadReactNative()`: that call runs
 *     `DefaultNewArchitectureEntryPoint.load()`, which overrides the flags ITSELF. A second
 *     override then dies with `RuntimeException: Feature flags cannot be overridden more
 *     than once`.
 *
 * So it goes AFTER `loadReactNative()`, using `dangerouslyForceOverride` — the API RN
 * provides for exactly this, replacing an override that is already in place. The provider
 * extends `ReactNativeNewArchitectureFeatureFlagsDefaults` (the same base RN's entry point
 * uses) so the new-architecture flags it just set are preserved rather than reset to
 * library defaults; only our one flag differs. This is still well before anything reads
 * the flag, which happens at mount time once an Activity creates a surface.
 *
 * Trade-off: we lose a minor anti-flicker optimisation (an animated view could
 * briefly show its pre-animation value when a React commit lands mid-animation)
 * in exchange for not crashing. Revisit if a later RN fixes the assert.
 */

const IMPORT_MARKER = 'ReactNativeNewArchitectureFeatureFlagsDefaults';
const IMPORTS =
  'import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags\n' +
  'import com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlagsDefaults\n';

const METHOD_MARKER = 'overrideBySynchronousMountPropsAtMountingAndroid';
const OVERRIDE_BLOCK =
  '    // Disable RN 0.86 synchronous-mount-props override (default-on) — its\n' +
  '    // updateProps merge asserts transform is Array / opacity is Number and\n' +
  '    // crashes when a Reanimated-animated view gets a mismatched props update\n' +
  '    // mid-mount (reproduced on track transition; see the config plugin).\n' +
  '    //\n' +
  '    // Must come AFTER loadReactNative(): that initialises SoLoader (the override\n' +
  '    // reaches native) and applies RNs own flag override, which may only happen once.\n' +
  '    // dangerouslyForceOverride replaces it; extending the new-architecture defaults\n' +
  '    // keeps the flags RN just set instead of resetting them to library defaults.\n' +
  '    ReactNativeFeatureFlags.dangerouslyForceOverride(\n' +
  '        object : ReactNativeNewArchitectureFeatureFlagsDefaults() {\n' +
  '          override fun overrideBySynchronousMountPropsAtMountingAndroid(): Boolean = false\n' +
  '        }\n' +
  '    )\n';

const LOAD_CALL = /(\n\s*loadReactNative\(this\)\n)/;

function withDisableSyncMountPropsOverride(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (cfg.modResults.language !== 'kt') {
      // Expo SDK 57 / RN 0.86 generates Kotlin MainApplication; bail loudly if not.
      // eslint-disable-next-line no-console
      console.warn(
        '[with-disable-sync-mount-props-override] MainApplication is not Kotlin; skipping.',
      );
      return cfg;
    }

    // 1. Imports (idempotent) — after the package declaration.
    if (!contents.includes(IMPORT_MARKER)) {
      contents = contents.replace(/^(package .+\n)/m, `$1\n${IMPORTS}`);
    }

    // 2. Override immediately after loadReactNative() (idempotent).
    if (!contents.includes(METHOD_MARKER)) {
      const before = contents;
      contents = contents.replace(LOAD_CALL, `$1${OVERRIDE_BLOCK}`);
      if (contents === before) {
        // Failing loudly matters: silently skipping leaves the assert crash in place, and
        // it only reproduces on a track transition, so it would not be obvious.
        throw new Error(
          '[with-disable-sync-mount-props-override] could not find loadReactNative(this) ' +
            'in MainApplication.onCreate. The Expo template has changed — re-check where ' +
            'the feature-flag override has to go before updating this marker.',
        );
      }
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = withDisableSyncMountPropsOverride;
