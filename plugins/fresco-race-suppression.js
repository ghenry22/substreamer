const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Config plugin that installs a narrow uncaught-exception handler in
 * MainApplication.onCreate to suppress a known Fresco race:
 *
 *   java.lang.IllegalStateException
 *     at com.facebook.common.internal.Preconditions.checkState
 *     at PipelineDraweeController.getImageInfo:366
 *     at AbstractDraweeController.reportSuccess
 *     at AbstractDraweeController.onNewResultInternal
 *     at AbstractDraweeController$2.onNewResultImpl
 *     at BaseDataSubscriber.onNewResult
 *     at AbstractDataSource$1.run
 *     at Handler.handleCallback
 *
 * Race: an Image view is recycled (fast FlashList scroll) while its decode
 * is in flight; the success callback queued on the main Handler fires
 * after the CloseableReference<CloseableImage> has been released, and
 * Fresco's checkState(isValid(image)) fails. No upstream fix — tracked
 * at facebook/fresco#2826 and related reports.
 *
 * The handler below catches ONLY IllegalStateException whose stack trace
 * touches Fresco's drawee controller classes. Everything else — NPEs,
 * OOMs, real bugs — propagates to the default handler and crashes the
 * app as normal. Suppression leaves the offending image as a placeholder
 * while the rest of the UI keeps working (next scroll/render retries).
 *
 * Logs via `Log.w("Substreamer", ...)` so suppressed races are visible
 * in logcat for monitoring.
 */
function withFrescoRaceSuppression(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const androidRoot = config.modRequest.platformProjectRoot;
      const javaRoot = path.join(androidRoot, "app", "src", "main", "java");

      // Walk the java tree to find MainApplication.kt — package path may
      // vary across builds (follows the app id).
      let mainAppPath = null;
      function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === "MainApplication.kt") mainAppPath = full;
        }
      }
      walk(javaRoot);

      if (!mainAppPath) {
        console.warn(
          "[fresco-race-suppression] MainApplication.kt not found; skipping."
        );
        return config;
      }

      let contents = fs.readFileSync(mainAppPath, "utf8");
      const MARKER = "// [fresco-race-suppression]";

      if (contents.includes(MARKER)) return config;

      // Add android.util.Log import if missing.
      if (!/^import android\.util\.Log\s*$/m.test(contents)) {
        contents = contents.replace(
          /(^import android\.content\.res\.Configuration\s*$)/m,
          "$1\nimport android.util.Log"
        );
      }

      // Inject handler immediately after `super.onCreate()` so it's the
      // first thing registered. The default handler is captured before
      // replacement so real crashes still propagate.
      const HANDLER_SNIPPET = `
    ${MARKER} Swallow a known Fresco race where fast FlashList recycling
    // releases a CloseableReference before its decode-success callback
    // fires on the main Handler. Only IllegalStateException whose stack
    // touches Fresco's drawee controllers is suppressed — every other
    // throwable propagates to the default handler.
    run {
      val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
        val isFrescoRace = throwable is IllegalStateException &&
          throwable.stackTrace.any {
            it.className.contains("PipelineDraweeController") ||
            it.className.contains("AbstractDraweeController")
          }
        if (isFrescoRace) {
          Log.w("Substreamer", "Suppressed Fresco lifecycle race on thread " + thread.name, throwable)
          return@setDefaultUncaughtExceptionHandler
        }
        defaultHandler?.uncaughtException(thread, throwable)
      }
    }
`;

      contents = contents.replace(
        /(override fun onCreate\(\) \{\s*\n\s*super\.onCreate\(\)\n)/,
        `$1${HANDLER_SNIPPET}`
      );

      fs.writeFileSync(mainAppPath, contents, "utf8");
      return config;
    },
  ]);
}

module.exports = withFrescoRaceSuppression;
