/**
 * Image-cache diagnostic logger.
 *
 * Mirrors the playbackService.ts pattern: a single `logImageCache(message)`
 * helper that's a no-op unless `image-cache-diagnostics-enabled` exists in
 * `Paths.document`. The user-facing toggle lives in Settings → Logging →
 * Image Cache Diagnostics.
 *
 * Differences from the audio/remote-control loggers:
 *   - No native counterpart, so rotation happens here. When the active log
 *     reaches `MAX_LOG_BYTES`, it's renamed to `*.old.log` and a fresh log
 *     is started. Cap is small (~512KB) — the diagnostic value is in the
 *     last few minutes of activity, not historical depth.
 *   - Writes are serialised through a single promise chain so concurrent
 *     CachedImage mounts/errors don't clobber each other.
 */

import { File, Paths } from 'expo-file-system';

/** Filename of the empty file that gates diagnostic logging. Created and
 *  deleted by `imageCacheDiagnosticsStore.setEnabled()`. */
export const IMAGE_CACHE_DIAG_FLAG_FILE = 'image-cache-diagnostics-enabled';
/** Active log file written by {@link logImageCache}. Inspectable + shareable
 *  via Settings → Logging → Image Cache Diagnostics. */
export const IMAGE_CACHE_DIAG_LOG_FILE = 'image-cache-diagnostics.log';
/** Rotated log retained from the previous {@link MAX_LOG_BYTES}-cap rotation. */
export const IMAGE_CACHE_DIAG_OLD_LOG_FILE = 'image-cache-diagnostics.old.log';
const MAX_LOG_BYTES = 512 * 1024;

let writeQueue: Promise<void> = Promise.resolve();

export function logImageCache(message: string): void {
  writeQueue = writeQueue.then(async () => {
    try {
      const flagFile = new File(Paths.document, IMAGE_CACHE_DIAG_FLAG_FILE);
      if (!flagFile.exists) return;
      const logFile = new File(Paths.document, IMAGE_CACHE_DIAG_LOG_FILE);
      const line = `[${new Date().toISOString()}] ${message}\n`;
      let existing = logFile.exists ? await logFile.text() : '';
      if (existing.length + line.length > MAX_LOG_BYTES) {
        const oldLog = new File(Paths.document, IMAGE_CACHE_DIAG_OLD_LOG_FILE);
        if (oldLog.exists) {
          try { oldLog.delete(); } catch { /* best-effort */ }
        }
        try {
          logFile.write(existing);
          logFile.move(oldLog);
        } catch { /* best-effort: rotation failure just clears existing */ }
        existing = '';
      }
      logFile.write(existing + line);
    } catch { /* best-effort: disk full or permission denied is non-critical */ }
  });
}
