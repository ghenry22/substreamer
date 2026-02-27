const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Config plugin that silences the Xcode warning:
 *   "Run script build phase '[CP-User] [Hermes] Replace Hermes for the right
 *   configuration, if needed' will be run during every build because it does
 *   not specify any outputs."
 *
 * Why this exists:
 *   The hermes-engine CocoaPod includes shell script build phases that swap
 *   in the correct Hermes binary (debug vs release). These phases declare no
 *   output files, which causes Xcode to surface a yellow warning on every
 *   build. The warning is cosmetic — the build succeeds regardless — but it
 *   adds noise to the build log and can mask real warnings.
 *
 * What it does:
 *   During `expo prebuild`, this plugin patches the generated Podfile's
 *   post_install block. It iterates the hermes-engine target's build phases
 *   and sets `always_out_of_date = "1"` on each shell script phase. This
 *   tells Xcode the phase is intentionally input/output-less and suppresses
 *   the warning.
 *
 * Impact:
 *   - Build-time only; no effect on the runtime Hermes engine or app behaviour.
 *   - The patch is idempotent — it checks for the sentinel string before
 *     writing, so running prebuild multiple times is safe.
 *   - If a future React Native or hermes-engine update fixes the missing
 *     outputs upstream, this plugin becomes a no-op and can be removed.
 */
function withSilenceHermesWarning(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let podfile = fs.readFileSync(podfilePath, "utf8");

      const snippet = `
    # Silence warning about Hermes script phase missing output dependencies
    installer.pods_project.targets.each do |target|
      if target.name == 'hermes-engine'
        target.build_phases.each do |phase|
          if phase.is_a?(Xcodeproj::Project::Object::PBXShellScriptBuildPhase)
            phase.always_out_of_date = "1"
          end
        end
      end
    end`;

      // Only patch if we haven't already
      if (!podfile.includes("always_out_of_date")) {
        // Insert the snippet right before the closing `end` of post_install
        podfile = podfile.replace(
          /^(\s*react_native_post_install\(.*?\))\s*\n(\s*end\s*\n\s*end)/ms,
          `$1\n${snippet}\n$2`
        );
        fs.writeFileSync(podfilePath, podfile, "utf8");
      }

      return config;
    },
  ]);
}

module.exports = withSilenceHermesWarning;
