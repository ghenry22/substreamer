"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.abandonWakeLock = abandonWakeLock;
exports.acquireWakeLock = acquireWakeLock;
exports.add = add;
exports.addEventListener = addEventListener;
exports.getActiveTrack = getActiveTrack;
exports.getActiveTrackIndex = getActiveTrackIndex;
exports.getPlayWhenReady = getPlayWhenReady;
exports.getPlaybackState = getPlaybackState;
exports.getProgress = getProgress;
exports.getQueue = getQueue;
exports.getRate = getRate;
exports.getRepeatMode = getRepeatMode;
exports.getTrack = getTrack;
exports.getVolume = getVolume;
exports.load = load;
exports.move = move;
exports.pause = pause;
exports.play = play;
exports.registerPlaybackService = registerPlaybackService;
exports.remove = remove;
exports.removeUpcomingTracks = removeUpcomingTracks;
exports.reset = reset;
exports.retry = retry;
exports.seekBy = seekBy;
exports.seekTo = seekTo;
exports.setPlayWhenReady = setPlayWhenReady;
exports.setQueue = setQueue;
exports.setRate = setRate;
exports.setRepeatMode = setRepeatMode;
exports.setVolume = setVolume;
exports.setupPlayer = setupPlayer;
exports.skip = skip;
exports.skipToNext = skipToNext;
exports.skipToPrevious = skipToPrevious;
exports.stop = stop;
exports.updateMetadataForTrack = updateMetadataForTrack;
exports.updateNowPlayingMetadata = updateNowPlayingMetadata;
exports.updateOptions = updateOptions;
exports.validateOnStartCommandIntent = validateOnStartCommandIntent;
var _reactNative = require("react-native");
var _NativeTrackPlayer = _interopRequireDefault(require("./NativeTrackPlayer"));
var _resolveAssetSource = _interopRequireDefault(require("./resolveAssetSource"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const isAndroid = _reactNative.Platform.OS === 'android';
const emitter = new _reactNative.NativeEventEmitter(_NativeTrackPlayer.default);

// MARK: - Helpers

function resolveImportedAssetOrPath(pathOrAsset) {
  return pathOrAsset === undefined ? undefined : typeof pathOrAsset === 'string' ? pathOrAsset : resolveImportedAsset(pathOrAsset);
}
function resolveImportedAsset(id) {
  return id ? (0, _resolveAssetSource.default)(id) ?? undefined : undefined;
}
function resolveTrackAssets(track) {
  return {
    ...track,
    url: resolveImportedAssetOrPath(track.url),
    artwork: resolveImportedAssetOrPath(track.artwork)
  };
}

// MARK: - General API

/**
 * Initializes the player with the specified options.
 *
 * @param options The options to initialize the player with.
 * @see https://rntp.dev/docs/api/functions/lifecycle
 */
async function setupPlayer(options = {}) {
  return _NativeTrackPlayer.default.setupPlayer(options);
}

/**
 * Register the playback service. The service will run as long as the player runs.
 */
function registerPlaybackService(factory) {
  if (isAndroid) {
    // Registers the headless task
    _reactNative.AppRegistry.registerHeadlessTask('TrackPlayer', factory);
  } else if (_reactNative.Platform.OS === 'web') {
    factory()();
  } else {
    // Initializes and runs the service in the next tick
    setImmediate(factory());
  }
}
function addEventListener(event, listener) {
  return emitter.addListener(event, listener);
}

// MARK: - Queue API

/**
 * Adds one or more tracks to the queue.
 *
 * @param tracks The tracks to add to the queue.
 * @param insertBeforeIndex (Optional) The index to insert the tracks before.
 * By default the tracks will be added to the end of the queue.
 */

/**
 * Adds a track to the queue.
 *
 * @param track The track to add to the queue.
 * @param insertBeforeIndex (Optional) The index to insert the track before.
 * By default the track will be added to the end of the queue.
 */

async function add(tracks, insertBeforeIndex = -1) {
  const addTracks = Array.isArray(tracks) ? tracks : [tracks];
  return addTracks.length < 1 ? undefined : _NativeTrackPlayer.default.add(addTracks.map(resolveTrackAssets), insertBeforeIndex);
}

/**
 * Replaces the current track or loads the track as the first in the queue.
 *
 * @param track The track to load.
 */
async function load(track) {
  return _NativeTrackPlayer.default.load(resolveTrackAssets(track));
}

/**
 * Move a track within the queue.
 *
 * @param fromIndex The index of the track to be moved.
 * @param toIndex The index to move the track to. If the index is larger than
 * the size of the queue, then the track is moved to the end of the queue.
 */
async function move(fromIndex, toIndex) {
  return _NativeTrackPlayer.default.move(fromIndex, toIndex);
}

/**
 * Removes multiple tracks from the queue by their indexes.
 *
 * If the current track is removed, the next track will activated. If the
 * current track was the last track in the queue, the first track will be
 * activated.
 *
 * @param indexes The indexes of the tracks to be removed.
 */

/**
 * Removes a track from the queue by its index.
 *
 * If the current track is removed, the next track will activated. If the
 * current track was the last track in the queue, the first track will be
 * activated.
 *
 * @param index The index of the track to be removed.
 */

async function remove(indexOrIndexes) {
  return _NativeTrackPlayer.default.remove(Array.isArray(indexOrIndexes) ? indexOrIndexes : [indexOrIndexes]);
}

/**
 * Clears any upcoming tracks from the queue.
 */
async function removeUpcomingTracks() {
  return _NativeTrackPlayer.default.removeUpcomingTracks();
}

/**
 * Skips to a track in the queue.
 *
 * @param index The index of the track to skip to.
 * @param initialPosition (Optional) The initial position to seek to in seconds.
 */
async function skip(index, initialPosition = -1) {
  return _NativeTrackPlayer.default.skip(index, initialPosition);
}

/**
 * Skips to the next track in the queue.
 *
 * @param initialPosition (Optional) The initial position to seek to in seconds.
 */
async function skipToNext(initialPosition = -1) {
  return _NativeTrackPlayer.default.skipToNext(initialPosition);
}

/**
 * Skips to the previous track in the queue.
 *
 * @param initialPosition (Optional) The initial position to seek to in seconds.
 */
async function skipToPrevious(initialPosition = -1) {
  return _NativeTrackPlayer.default.skipToPrevious(initialPosition);
}

// MARK: - Control Center / Notifications API

/**
 * Updates the configuration for the components.
 *
 * @param options The options to update.
 * @see https://rntp.dev/docs/api/functions/player#updateoptionsoptions
 */
async function updateOptions(options = {}) {
  return _NativeTrackPlayer.default.updateOptions({
    ...options,
    android: {
      ...options.android
    }
  });
}

/**
 * Updates the metadata of a track in the queue. If the current track is updated,
 * the notification and the Now Playing Center will be updated accordingly.
 *
 * @param trackIndex The index of the track whose metadata will be updated.
 * @param metadata The metadata to update.
 */
async function updateMetadataForTrack(trackIndex, metadata) {
  return _NativeTrackPlayer.default.updateMetadataForTrack(trackIndex, {
    ...metadata,
    artwork: resolveImportedAssetOrPath(metadata.artwork)
  });
}

/**
 * Updates the metadata content of the notification (Android) and the Now Playing Center (iOS)
 * without affecting the data stored for the current track.
 */
function updateNowPlayingMetadata(metadata) {
  return _NativeTrackPlayer.default.updateNowPlayingMetadata({
    ...metadata,
    artwork: resolveImportedAssetOrPath(metadata.artwork)
  });
}

// MARK: - Player API

/**
 * Resets the player stopping the current track and clearing the queue.
 */
async function reset() {
  return _NativeTrackPlayer.default.reset();
}

/**
 * Plays or resumes the current track.
 */
async function play() {
  return _NativeTrackPlayer.default.play();
}

/**
 * Pauses the current track.
 */
async function pause() {
  return _NativeTrackPlayer.default.pause();
}

/**
 * Stops the current track.
 */
async function stop() {
  return _NativeTrackPlayer.default.stop();
}

/**
 * Sets whether the player will play automatically when it is ready to do so.
 * This is the equivalent of calling `TrackPlayer.play()` when `playWhenReady = true`
 * or `TrackPlayer.pause()` when `playWhenReady = false`.
 */
async function setPlayWhenReady(playWhenReady) {
  return _NativeTrackPlayer.default.setPlayWhenReady(playWhenReady);
}

/**
 * Gets whether the player will play automatically when it is ready to do so.
 */
async function getPlayWhenReady() {
  return _NativeTrackPlayer.default.getPlayWhenReady();
}

/**
 * Seeks to a specified time position in the current track.
 *
 * @param position The position to seek to in seconds.
 */
async function seekTo(position) {
  return _NativeTrackPlayer.default.seekTo(position);
}

/**
 * Seeks by a relative time offset in the current track.
 *
 * @param offset The time offset to seek by in seconds.
 */
async function seekBy(offset) {
  return _NativeTrackPlayer.default.seekBy(offset);
}

/**
 * Sets the volume of the player.
 *
 * @param volume The volume as a number between 0 and 1.
 */
async function setVolume(level) {
  return _NativeTrackPlayer.default.setVolume(level);
}

/**
 * Sets the playback rate.
 *
 * @param rate The playback rate to change to, where 0.5 would be half speed,
 * 1 would be regular speed, 2 would be double speed etc.
 */
async function setRate(rate) {
  return _NativeTrackPlayer.default.setRate(rate);
}

/**
 * Sets the queue.
 *
 * @param tracks The tracks to set as the queue.
 * @see https://rntp.dev/docs/api/constants/repeat-mode
 */
async function setQueue(tracks) {
  return _NativeTrackPlayer.default.setQueue(tracks);
}

/**
 * Sets the queue repeat mode.
 *
 * @param repeatMode The repeat mode to set.
 * @see https://rntp.dev/docs/api/constants/repeat-mode
 */
async function setRepeatMode(mode) {
  return _NativeTrackPlayer.default.setRepeatMode(mode);
}

// MARK: - Getters

/**
 * Gets the volume of the player as a number between 0 and 1.
 */
async function getVolume() {
  return _NativeTrackPlayer.default.getVolume();
}

/**
 * Gets the playback rate where 0.5 would be half speed, 1 would be
 * regular speed and 2 would be double speed etc.
 */
async function getRate() {
  return _NativeTrackPlayer.default.getRate();
}

/**
 * Gets a track object from the queue.
 *
 * @param index The index of the track.
 * @returns The track object or undefined if there isn't a track object at that
 * index.
 */
async function getTrack(index) {
  return _NativeTrackPlayer.default.getTrack(index);
}

/**
 * Gets the whole queue.
 */
async function getQueue() {
  return _NativeTrackPlayer.default.getQueue();
}

/**
 * Gets the index of the active track in the queue or undefined if there is no
 * current track.
 */
async function getActiveTrackIndex() {
  return (await _NativeTrackPlayer.default.getActiveTrackIndex()) ?? undefined;
}

/**
 * Gets the active track or undefined if there is no current track.
 */
async function getActiveTrack() {
  return (await _NativeTrackPlayer.default.getActiveTrack()) ?? undefined;
}

/**
 * Gets information on the progress of the currently active track, including its
 * current playback position in seconds, buffered position in seconds and
 * duration in seconds.
 */
async function getProgress() {
  return await _NativeTrackPlayer.default.getProgress();
}

/**
 * Gets the playback state of the player.
 *
 * @see https://rntp.dev/docs/api/constants/state
 */
async function getPlaybackState() {
  return await _NativeTrackPlayer.default.getPlaybackState();
}

/**
 * Gets the queue repeat mode.
 *
 * @see https://rntp.dev/docs/api/constants/repeat-mode
 */
async function getRepeatMode() {
  return _NativeTrackPlayer.default.getRepeatMode();
}

/**
 * Retries the current item when the playback state is `State.Error`.
 */
async function retry() {
  return _NativeTrackPlayer.default.retry();
}

/**
 * acquires the wake lock of MusicService (android only.)
 */
async function acquireWakeLock() {
  if (!isAndroid) return;
  _NativeTrackPlayer.default.acquireWakeLock();
}

/**
 * acquires the wake lock of MusicService (android only.)
 */
async function abandonWakeLock() {
  if (!isAndroid) return;
  _NativeTrackPlayer.default.abandonWakeLock();
}

/**
 * get onStartCommandIntent is null or not (Android only.). this is used to identify
 * if musicservice is restarted or not.
 */
async function validateOnStartCommandIntent() {
  if (!isAndroid) return true;
  return _NativeTrackPlayer.default.validateOnStartCommandIntent();
}
//# sourceMappingURL=trackPlayer.js.map