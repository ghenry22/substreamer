import { Event, RepeatMode } from './constants';
import type { AddTrack, EventPayloadByEvent, NowPlayingMetadata, PlaybackState, PlayerOptions, Progress, ServiceHandler, Track, TrackMetadataBase, UpdateOptions } from './interfaces';
/**
 * Initializes the player with the specified options.
 *
 * @param options The options to initialize the player with.
 * @see https://rntp.dev/docs/api/functions/lifecycle
 */
export declare function setupPlayer(options?: PlayerOptions): Promise<void>;
/**
 * Register the playback service. The service will run as long as the player runs.
 */
export declare function registerPlaybackService(factory: () => ServiceHandler): void;
export declare function addEventListener<T extends Event>(event: T, listener: EventPayloadByEvent[T] extends never ? () => void : (event: EventPayloadByEvent[T]) => void): import("react-native").EmitterSubscription;
/**
 * Adds one or more tracks to the queue.
 *
 * @param tracks The tracks to add to the queue.
 * @param insertBeforeIndex (Optional) The index to insert the tracks before.
 * By default the tracks will be added to the end of the queue.
 */
export declare function add(tracks: AddTrack[], insertBeforeIndex?: number): Promise<number | void>;
/**
 * Adds a track to the queue.
 *
 * @param track The track to add to the queue.
 * @param insertBeforeIndex (Optional) The index to insert the track before.
 * By default the track will be added to the end of the queue.
 */
export declare function add(track: AddTrack, insertBeforeIndex?: number): Promise<number | void>;
/**
 * Replaces the current track or loads the track as the first in the queue.
 *
 * @param track The track to load.
 */
export declare function load(track: AddTrack): Promise<number | void>;
/**
 * Move a track within the queue.
 *
 * @param fromIndex The index of the track to be moved.
 * @param toIndex The index to move the track to. If the index is larger than
 * the size of the queue, then the track is moved to the end of the queue.
 */
export declare function move(fromIndex: number, toIndex: number): Promise<void>;
/**
 * Removes multiple tracks from the queue by their indexes.
 *
 * If the current track is removed, the next track will activated. If the
 * current track was the last track in the queue, the first track will be
 * activated.
 *
 * @param indexes The indexes of the tracks to be removed.
 */
export declare function remove(indexes: number[]): Promise<void>;
/**
 * Removes a track from the queue by its index.
 *
 * If the current track is removed, the next track will activated. If the
 * current track was the last track in the queue, the first track will be
 * activated.
 *
 * @param index The index of the track to be removed.
 */
export declare function remove(index: number): Promise<void>;
/**
 * Clears any upcoming tracks from the queue.
 */
export declare function removeUpcomingTracks(): Promise<void>;
/**
 * Skips to a track in the queue.
 *
 * @param index The index of the track to skip to.
 * @param initialPosition (Optional) The initial position to seek to in seconds.
 */
export declare function skip(index: number, initialPosition?: number): Promise<void>;
/**
 * Skips to the next track in the queue.
 *
 * @param initialPosition (Optional) The initial position to seek to in seconds.
 */
export declare function skipToNext(initialPosition?: number): Promise<void>;
/**
 * Skips to the previous track in the queue.
 *
 * @param initialPosition (Optional) The initial position to seek to in seconds.
 */
export declare function skipToPrevious(initialPosition?: number): Promise<void>;
/**
 * Updates the configuration for the components.
 *
 * @param options The options to update.
 * @see https://rntp.dev/docs/api/functions/player#updateoptionsoptions
 */
export declare function updateOptions(options?: UpdateOptions): Promise<void>;
/**
 * Updates the metadata of a track in the queue. If the current track is updated,
 * the notification and the Now Playing Center will be updated accordingly.
 *
 * @param trackIndex The index of the track whose metadata will be updated.
 * @param metadata The metadata to update.
 */
export declare function updateMetadataForTrack(trackIndex: number, metadata: TrackMetadataBase): Promise<void>;
/**
 * Updates the metadata content of the notification (Android) and the Now Playing Center (iOS)
 * without affecting the data stored for the current track.
 */
export declare function updateNowPlayingMetadata(metadata: NowPlayingMetadata): Promise<void>;
/**
 * Resets the player stopping the current track and clearing the queue.
 */
export declare function reset(): Promise<void>;
/**
 * Plays or resumes the current track.
 */
export declare function play(): Promise<void>;
/**
 * Pauses the current track.
 */
export declare function pause(): Promise<void>;
/**
 * Stops the current track.
 */
export declare function stop(): Promise<void>;
/**
 * Sets whether the player will play automatically when it is ready to do so.
 * This is the equivalent of calling `TrackPlayer.play()` when `playWhenReady = true`
 * or `TrackPlayer.pause()` when `playWhenReady = false`.
 */
export declare function setPlayWhenReady(playWhenReady: boolean): Promise<boolean>;
/**
 * Gets whether the player will play automatically when it is ready to do so.
 */
export declare function getPlayWhenReady(): Promise<boolean>;
/**
 * Seeks to a specified time position in the current track.
 *
 * @param position The position to seek to in seconds.
 */
export declare function seekTo(position: number): Promise<void>;
/**
 * Seeks by a relative time offset in the current track.
 *
 * @param offset The time offset to seek by in seconds.
 */
export declare function seekBy(offset: number): Promise<void>;
/**
 * Sets the volume of the player.
 *
 * @param volume The volume as a number between 0 and 1.
 */
export declare function setVolume(level: number): Promise<void>;
/**
 * Sets the playback rate.
 *
 * @param rate The playback rate to change to, where 0.5 would be half speed,
 * 1 would be regular speed, 2 would be double speed etc.
 */
export declare function setRate(rate: number): Promise<void>;
/**
 * Sets the queue.
 *
 * @param tracks The tracks to set as the queue.
 * @see https://rntp.dev/docs/api/constants/repeat-mode
 */
export declare function setQueue(tracks: Track[]): Promise<void>;
/**
 * Sets the queue repeat mode.
 *
 * @param repeatMode The repeat mode to set.
 * @see https://rntp.dev/docs/api/constants/repeat-mode
 */
export declare function setRepeatMode(mode: RepeatMode): Promise<RepeatMode>;
/**
 * Gets the volume of the player as a number between 0 and 1.
 */
export declare function getVolume(): Promise<number>;
/**
 * Gets the playback rate where 0.5 would be half speed, 1 would be
 * regular speed and 2 would be double speed etc.
 */
export declare function getRate(): Promise<number>;
/**
 * Gets a track object from the queue.
 *
 * @param index The index of the track.
 * @returns The track object or undefined if there isn't a track object at that
 * index.
 */
export declare function getTrack(index: number): Promise<Track | undefined>;
/**
 * Gets the whole queue.
 */
export declare function getQueue(): Promise<Track[]>;
/**
 * Gets the index of the active track in the queue or undefined if there is no
 * current track.
 */
export declare function getActiveTrackIndex(): Promise<number | undefined>;
/**
 * Gets the active track or undefined if there is no current track.
 */
export declare function getActiveTrack(): Promise<Track | undefined>;
/**
 * Gets information on the progress of the currently active track, including its
 * current playback position in seconds, buffered position in seconds and
 * duration in seconds.
 */
export declare function getProgress(): Promise<Progress>;
/**
 * Gets the playback state of the player.
 *
 * @see https://rntp.dev/docs/api/constants/state
 */
export declare function getPlaybackState(): Promise<PlaybackState>;
/**
 * Gets the queue repeat mode.
 *
 * @see https://rntp.dev/docs/api/constants/repeat-mode
 */
export declare function getRepeatMode(): Promise<RepeatMode>;
/**
 * Retries the current item when the playback state is `State.Error`.
 */
export declare function retry(): Promise<void>;
/**
 * acquires the wake lock of MusicService (android only.)
 */
export declare function acquireWakeLock(): Promise<void>;
/**
 * acquires the wake lock of MusicService (android only.)
 */
export declare function abandonWakeLock(): Promise<void>;
/**
 * get onStartCommandIntent is null or not (Android only.). this is used to identify
 * if musicservice is restarted or not.
 */
export declare function validateOnStartCommandIntent(): Promise<boolean>;
//# sourceMappingURL=trackPlayer.d.ts.map