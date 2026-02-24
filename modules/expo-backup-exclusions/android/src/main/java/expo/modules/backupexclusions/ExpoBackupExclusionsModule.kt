package expo.modules.backupexclusions

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

/**
 * Android backup exclusion is handled at build time via fullBackupContent and
 * dataExtractionRules XML. This module exists so the app can call excludeFromBackup()
 * on both platforms; on Android it is a no-op.
 */
class ExpoBackupExclusionsModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ExpoBackupExclusions")

        AsyncFunction("excludeFromBackup") { promise: Promise ->
            // No-op on Android; backup exclusions are configured via XML at build time
            promise.resolve(null)
        }
    }
}
