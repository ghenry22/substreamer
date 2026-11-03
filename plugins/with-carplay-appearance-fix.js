const { withAppDelegate } = require("expo/config-plugins");

/**
 * Config plugin — fix a React Native crash while CarPlay is connected.
 *
 * React Native's `RCTDevMenu showOnShake` iterates `UIApplication.connectedScenes`
 * with the loop variable typed `UIWindowScene *` but never checks the actual class,
 * then sends `-windows` to each scene. A CarPlay scene (`CPTemplateApplicationScene`)
 * is a UIScene *sibling* of `UIWindowScene` and does not respond to `-windows`, so
 * shaking a Debug build while CarPlay is connected aborts with
 * `-[CPTemplateApplicationScene windows]: unrecognized selector`.
 *
 * React Native core ships as a PREBUILT binary on this SDK (`React-Core-prebuilt`,
 * on both local and EAS since `ios.buildReactNativeFromSource` is unset), so a
 * patch-package fix to the RN source is never compiled in. Instead we add a tiny
 * category to `CPTemplateApplicationScene` — compiled into the app target, so it
 * takes effect regardless of RN being prebuilt — that makes the CarPlay scene
 * safely answer `-windows` with an empty array. Real phone window scenes are
 * unaffected.
 *
 * Same workaround other SDKs use for this exact selector (Intercom, Intune).
 * Idempotent; injects into the Swift AppDelegate at prebuild.
 */
const MARKER = "with-carplay-appearance-fix";

const EXTENSION = `
// ${MARKER} (plugins/with-carplay-appearance-fix.js) — see that file for why.
// A CarPlay scene (CPTemplateApplicationScene) is a UIScene sibling of
// UIWindowScene and has no -windows; RN's RCTDevMenu showOnShake sends it
// -windows and crashes with an unrecognized selector. Answer safely with [].
extension CPTemplateApplicationScene {
  @objc var windows: [UIWindow] { [] }
}
`;

module.exports = function withCarPlayAppearanceFix(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") {
      throw new Error(
        `[${MARKER}] expected a Swift AppDelegate but got '${config.modResults.language}'`
      );
    }
    let contents = config.modResults.contents;
    if (!contents.includes(MARKER)) {
      // CarPlay must be imported for the CPTemplateApplicationScene type.
      if (!/^\s*import CarPlay\s*$/m.test(contents)) {
        contents = `import CarPlay\n${contents}`;
      }
      config.modResults.contents = `${contents}${EXTENSION}`;
    }
    return config;
  });
};
