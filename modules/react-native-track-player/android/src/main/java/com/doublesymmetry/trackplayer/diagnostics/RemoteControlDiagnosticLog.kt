package com.doublesymmetry.trackplayer.diagnostics

import android.content.Context
import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors

/**
 * Thread-safe, auto-rotating file logger for Android remote-control / media-button
 * diagnostics. Mirrors the Swift `AudioDiagnosticLog` pattern used on iOS for
 * playback diagnostics.
 *
 * Writes to `<filesDir>/remote-control-diagnostics.log`, inspectable via the
 * "Remote Control Diagnostics" section of Settings → Logging in the app.
 *
 * Logging is disabled by default. To enable, the JS layer creates the flag file
 * `<filesDir>/remote-control-diagnostics-enabled` via `remoteControlDiagnosticsStore`.
 * Every `log()` call checks the flag's existence — when absent, the call is a
 * fast no-op (no file I/O, no executor scheduling).
 *
 * Rotation: when the active log exceeds 512 KB, it is moved to
 * `remote-control-diagnostics.old.log` (any prior `.old.log` is deleted) and a
 * fresh log file is started. The user-facing UI displays only the active log
 * size; the rotated copy is shipped alongside it via `expo-sharing`.
 */
object RemoteControlDiagnosticLog {
    private const val FLAG_FILE = "remote-control-diagnostics-enabled"
    private const val LOG_FILE = "remote-control-diagnostics.log"
    private const val OLD_LOG_FILE = "remote-control-diagnostics.old.log"
    private const val MAX_SIZE: Long = 512 * 1024

    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "RemoteControlDiagnosticLog").apply { isDaemon = true }
    }
    private val formatter: DateTimeFormatter =
        DateTimeFormatter.ISO_INSTANT.withZone(ZoneOffset.UTC)

    fun log(context: Context, message: String) {
        val docs = context.filesDir ?: return
        val flagFile = File(docs, FLAG_FILE)
        if (!flagFile.exists()) return
        val line = "[${formatter.format(Instant.now())}] $message\n"
        executor.execute {
            try {
                val logFile = File(docs, LOG_FILE)
                if (logFile.exists() && logFile.length() > MAX_SIZE) {
                    val old = File(docs, OLD_LOG_FILE)
                    if (old.exists()) old.delete()
                    logFile.renameTo(old)
                }
                logFile.appendText(line)
            } catch (_: Exception) {
                // best-effort: disk full / permission denied is non-critical
            }
        }
    }
}
