const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Config plugin that forces consistent JVM target compatibility (17) across
 * all Android subprojects.
 *
 * Some third-party libraries (e.g. react-native-image-colors) don't explicitly
 * set compileOptions / kotlinOptions for AGP >= 8, causing a mismatch between
 * Java (defaults to 17) and Kotlin 2.x (defaults to 21). This plugin adds a
 * subprojects block to the root build.gradle that normalises everything to 17.
 */
function withFixJvmTarget(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const buildGradlePath = path.join(
        config.modRequest.platformProjectRoot,
        "build.gradle"
      );
      let buildGradle = fs.readFileSync(buildGradlePath, "utf8");

      // Only patch if we haven't already
      if (buildGradle.includes("// [fix-jvm-target]")) {
        return config;
      }

      const snippet = `
// [fix-jvm-target] Force consistent JVM target across all subprojects
subprojects { sub ->
    sub.plugins.withId("com.android.library") {
        sub.android {
            compileOptions {
                sourceCompatibility JavaVersion.VERSION_17
                targetCompatibility JavaVersion.VERSION_17
            }
        }
        sub.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
            kotlinOptions {
                jvmTarget = "17"
            }
        }
    }
    sub.plugins.withId("com.android.application") {
        sub.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
            kotlinOptions {
                jvmTarget = "17"
            }
        }
    }
}
`;

      buildGradle += snippet;

      fs.writeFileSync(buildGradlePath, buildGradle, "utf8");

      return config;
    },
  ]);
}

module.exports = withFixJvmTarget;
