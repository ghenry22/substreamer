package com.doublesymmetry.kotlinaudio.models

/**
 * Use these events to track when and why an [AudioItem] transitions to another.
 * Examples of an audio transition include changes to [AudioItem] queue, an [AudioItem] on repeat, skipping an [AudioItem], or simply when the [AudioItem] has finished.
 */
/**
 * @param oldPosition Playback position (ms) of the track that was playing before the transition.
 * @param previousIndex Index of the previous media item, captured synchronously from ExoPlayer's
 *   `previousMediaItemIndex` inside the `onMediaItemTransition` callback. `null` when there is no
 *   previous item (e.g. first item loaded into an empty queue).
 * @param currentIndex Index of the new media item, captured synchronously from ExoPlayer's
 *   `currentMediaItemIndex` inside the callback.
 */
sealed class AudioItemTransitionReason(
    val oldPosition: Long,
    val previousIndex: Int?,
    val currentIndex: Int
) {
    /**
     * Playback has automatically transitioned to the next [AudioItem].
     *
     * This reason also indicates a transition caused by another player.
     */
    class AUTO(oldPosition: Long, previousIndex: Int?, currentIndex: Int)
        : AudioItemTransitionReason(oldPosition, previousIndex, currentIndex)

    /**
     * A seek to another [AudioItem] has occurred. Usually triggered when calling
     * [QueuedAudioPlayer.next][com.doublesymmetry.kotlinaudio.players.QueuedAudioPlayer.next]
     * or [QueuedAudioPlayer.previous][com.doublesymmetry.kotlinaudio.players.QueuedAudioPlayer.previous].
     */
    class SEEK_TO_ANOTHER_AUDIO_ITEM(oldPosition: Long, previousIndex: Int?, currentIndex: Int)
        : AudioItemTransitionReason(oldPosition, previousIndex, currentIndex)

    /**
     * The [AudioItem] has been repeated.
     */
    class REPEAT(oldPosition: Long, previousIndex: Int?, currentIndex: Int)
        : AudioItemTransitionReason(oldPosition, previousIndex, currentIndex)

    /**
     * The current [AudioItem] has changed because of a change in the queue. This can either be if
     * the [AudioItem] previously being played has been removed, or when the queue becomes non-empty
     * after being empty.
     */
    class QUEUE_CHANGED(oldPosition: Long, previousIndex: Int?, currentIndex: Int)
        : AudioItemTransitionReason(oldPosition, previousIndex, currentIndex)
}
