/**
 * RNTP headless playback service.
 *
 * Registered via TrackPlayer.registerPlaybackService() in index.js.
 * Handles remote control events from lock screen, notification centre,
 * headphones, etc.
 *
 * Diagnostic logging mirrors the native Android logger
 * (RemoteControlDiagnosticLog.kt) — both write to the same on-disk file when
 * `remote-control-diagnostics-enabled` exists in `Paths.document`. The
 * user-facing UI lives in Settings → Logging → Remote Control Diagnostics.
 */

import { File, Paths } from 'expo-file-system';
import TrackPlayer, { Event } from 'react-native-track-player';

const FLAG_FILE = 'remote-control-diagnostics-enabled';
const LOG_FILE = 'remote-control-diagnostics.log';

// Serialise writes through a single promise chain so concurrent events don't
// clobber each other. Best-effort — rotation is handled by the native logger
// when its 512 KB cap is reached; the JS side just appends.
let writeQueue: Promise<void> = Promise.resolve();

function logDiagnostic(message: string): void {
  writeQueue = writeQueue.then(async () => {
    try {
      const flagFile = new File(Paths.document, FLAG_FILE);
      if (!flagFile.exists) return;
      const logFile = new File(Paths.document, LOG_FILE);
      const line = `[${new Date().toISOString()}] JS ${message}\n`;
      const existing = logFile.exists ? await logFile.text() : '';
      logFile.write(existing + line);
    } catch { /* best-effort: disk full or permission denied is non-critical */ }
  });
}

module.exports = async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    logDiagnostic('Event.RemotePlay');
    TrackPlayer.play();
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    logDiagnostic('Event.RemotePause');
    TrackPlayer.pause();
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    logDiagnostic('Event.RemoteStop');
    TrackPlayer.stop();
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    logDiagnostic('Event.RemoteNext');
    TrackPlayer.skipToNext();
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    logDiagnostic('Event.RemotePrevious');
    TrackPlayer.skipToPrevious();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => {
    logDiagnostic(`Event.RemoteSeek position=${e.position}`);
    TrackPlayer.seekTo(e.position);
  });
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (e) => {
    logDiagnostic(`Event.RemoteJumpForward interval=${e.interval}`);
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(position + e.interval);
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (e) => {
    logDiagnostic(`Event.RemoteJumpBackward interval=${e.interval}`);
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, position - e.interval));
  });
};
