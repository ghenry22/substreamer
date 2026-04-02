package com.doublesymmetry.kotlinaudio.models

enum class PlaybackEndedReason {
    PLAYED_UNTIL_END, PLAYER_STOPPED, SKIPPED_TO_NEXT, SKIPPED_TO_PREVIOUS, JUMPED_TO_INDEX,
    CLEARED, FAILED
}

/**
 * Bundles a [PlaybackEndedReason] with the track index and position captured
 * synchronously at the emission site, so downstream collectors don't need to
 * read (potentially stale) player state.
 */
data class PlaybackEndEvent(
    val reason: PlaybackEndedReason,
    val trackIndex: Int,
    val positionMs: Long
)