package com.doublesymmetry.kotlinaudio.event

import androidx.annotation.OptIn
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Metadata
import androidx.media3.common.util.UnstableApi
import com.doublesymmetry.kotlinaudio.models.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Holds all player event flows. Events are emitted synchronously via [tryEmit]
 * with sufficient buffer capacity (extraBufferCapacity = 64), preserving the
 * ordering of ExoPlayer callbacks without coroutine hops.
 */
class PlayerEventHolder {

    private val _stateChange = MutableSharedFlow<AudioPlayerState>(replay = 1, extraBufferCapacity = 64)
    val stateChange = _stateChange.asSharedFlow()

    private val _playbackEnd = MutableSharedFlow<PlaybackEndEvent>(replay = 1, extraBufferCapacity = 64)
    val playbackEnd = _playbackEnd.asSharedFlow()

    private val _playbackError = MutableSharedFlow<PlaybackError>(replay = 1, extraBufferCapacity = 64)
    val playbackError = _playbackError.asSharedFlow()

    private val _playWhenReadyChange = MutableSharedFlow<PlayWhenReadyChangeData>(replay = 1, extraBufferCapacity = 64)
    /**
     * Use these events to track when [com.doublesymmetry.kotlinaudio.players.BaseAudioPlayer.playWhenReady]
     * changes.
     */
    val playWhenReadyChange = _playWhenReadyChange.asSharedFlow()

    private val _audioItemTransition = MutableSharedFlow<AudioItemTransitionReason>(replay = 1, extraBufferCapacity = 64)

    /**
     * Use these events to track when and why an [AudioItem] transitions to another.
     *
     * Examples of an audio transition include changes to [AudioItem] queue, an [AudioItem] on repeat, skipping an [AudioItem], or simply when the [AudioItem] has finished.
     */
    val audioItemTransition = _audioItemTransition.asSharedFlow()

    private val _positionChanged = MutableSharedFlow<PositionChangedReason>(replay = 1, extraBufferCapacity = 64)
    val positionChanged = _positionChanged.asSharedFlow()

    private val _onAudioFocusChanged = MutableSharedFlow<FocusChangeData>(replay = 1, extraBufferCapacity = 64)
    val onAudioFocusChanged = _onAudioFocusChanged.asSharedFlow()

    private val _onCommonMetadata = MutableSharedFlow<MediaMetadata>(replay = 1, extraBufferCapacity = 64)
    val onCommonMetadata = _onCommonMetadata.asSharedFlow()

    private val _onTimedMetadata = MutableSharedFlow<Metadata>(replay = 1, extraBufferCapacity = 64)
    val onTimedMetadata = _onTimedMetadata.asSharedFlow()

    private val _bufferFull = MutableSharedFlow<Boolean>(replay = 1, extraBufferCapacity = 64)
    /** Emitted when the entire track has been buffered (true) or reset on track change (false). */
    val bufferFull = _bufferFull.asSharedFlow()

    // No replay for button presses — don't replay old actions to new subscribers.
    private val _onPlayerActionTriggeredExternally = MutableSharedFlow<MediaSessionCallback>(extraBufferCapacity = 64)

    /**
     * Use these events to track whenever a player action has been triggered from an outside source.
     *
     * The sources can be: media buttons on headphones, Android Wear, Android Auto, Google Assistant, media notification, etc.
     *
     * For this observable to send events, set [interceptPlayerActionsTriggeredExternally][com.doublesymmetry.kotlinaudio.models.PlayerOptions.interceptPlayerActionsTriggeredExternally] to true.
    */
    val onPlayerActionTriggeredExternally = _onPlayerActionTriggeredExternally.asSharedFlow()

    internal fun updateAudioPlayerState(state: AudioPlayerState) {
        _stateChange.tryEmit(state)
    }

    internal fun updatePlaybackEnd(event: PlaybackEndEvent) {
        _playbackEnd.tryEmit(event)
    }

    internal fun updatePlayWhenReadyChange(playWhenReadyChange: PlayWhenReadyChangeData) {
        _playWhenReadyChange.tryEmit(playWhenReadyChange)
    }

    internal fun updateAudioItemTransition(reason: AudioItemTransitionReason) {
        _audioItemTransition.tryEmit(reason)
    }

    internal fun updatePositionChangedReason(reason: PositionChangedReason) {
        _positionChanged.tryEmit(reason)
    }

    internal fun updateOnAudioFocusChanged(isPaused: Boolean, isPermanent: Boolean) {
        _onAudioFocusChanged.tryEmit(FocusChangeData(isPaused, isPermanent))
    }

    internal fun updateOnCommonMetadata(metadata: MediaMetadata) {
        _onCommonMetadata.tryEmit(metadata)
    }

    @OptIn(UnstableApi::class)
    internal fun updateOnTimedMetadata(metadata: Metadata) {
        _onTimedMetadata.tryEmit(metadata)
    }

    internal fun updatePlaybackError(error: PlaybackError) {
        _playbackError.tryEmit(error)
    }

    internal fun updateBufferFull(isFull: Boolean) {
        _bufferFull.tryEmit(isFull)
    }

    internal fun updateOnPlayerActionTriggeredExternally(callback: MediaSessionCallback) {
        _onPlayerActionTriggeredExternally.tryEmit(callback)
    }
}
