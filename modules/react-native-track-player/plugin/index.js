const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin for react-native-track-player.
 *
 * Injects a local pod declaration for SwiftAudioEx into the generated Podfile
 * so that the forked SwiftAudioEx (bundled in this module) is used instead of
 * the version published to CocoaPods.
 *
 * This replaces the manual Podfile edit that was previously needed (and lost
 * on every `expo prebuild --clean` because ios/ is gitignored).
 */
function withLocalSwiftAudioEx(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let podfile = fs.readFileSync(podfilePath, "utf8");

      // Only patch if we haven't already
      if (podfile.includes("# [react-native-track-player] Local SwiftAudioEx")) {
        return config;
      }

      // Resolve the absolute path to the bundled SwiftAudioEx podspec
      const swiftAudioExPath = path.resolve(
        config.modRequest.projectRoot,
        "modules",
        "react-native-track-player",
        "SwiftAudioEx"
      );

      const snippet = [
        "",
        "  # [react-native-track-player] Local SwiftAudioEx override",
        `  pod 'SwiftAudioEx', :path => '${swiftAudioExPath}'`,
        "",
      ].join("\n");

      // Insert the local pod declaration right after the `target '...' do` line,
      // before any other pods are declared.
      podfile = podfile.replace(
        /(target\s+'[^']+'\s+do\n)/,
        `$1${snippet}`
      );

      fs.writeFileSync(podfilePath, podfile, "utf8");

      return config;
    },
  ]);
}

module.exports = withLocalSwiftAudioEx;
