/**
 * RNTP headless playback service.
 *
 * Registered via TrackPlayer.registerPlaybackService() in index.js.
 * Handles remote control events from lock screen, notification centre,
 * headphones, etc.
 */

import TrackPlayer, { Event } from 'react-native-track-player';

module.exports = async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => TrackPlayer.seekTo(e.position));
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (e) => {
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(position + e.interval);
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (e) => {
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, position - e.interval));
  });
};
