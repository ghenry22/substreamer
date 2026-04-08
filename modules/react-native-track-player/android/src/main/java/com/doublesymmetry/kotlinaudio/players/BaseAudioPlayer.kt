package com.doublesymmetry.kotlinaudio.players

import android.content.Context
import android.media.AudioAttributes as NativeAudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import androidx.annotation.CallSuper
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Metadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Player.Listener
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.legacy.RatingCompat
import com.doublesymmetry.kotlinaudio.event.PlayerEventHolder
import com.doublesymmetry.kotlinaudio.models.AudioItem
import com.doublesymmetry.kotlinaudio.models.AudioItemTransitionReason
import com.doublesymmetry.kotlinaudio.models.AudioPlayerState
import com.doublesymmetry.kotlinaudio.models.MediaSessionCallback
import com.doublesymmetry.kotlinaudio.models.PlayWhenReadyChangeData
import com.doublesymmetry.kotlinaudio.models.PlaybackEndEvent
import com.doublesymmetry.kotlinaudio.models.PlaybackEndedReason
import com.doublesymmetry.kotlinaudio.models.PlaybackError
import com.doublesymmetry.kotlinaudio.models.PlayerOptions
import com.doublesymmetry.kotlinaudio.models.PositionChangedReason
import com.doublesymmetry.kotlinaudio.models.setWakeMode
import com.doublesymmetry.kotlinaudio.players.components.Cache
import com.doublesymmetry.kotlinaudio.players.components.MediaFactory
import com.doublesymmetry.kotlinaudio.players.components.setupBuffer
import timber.log.Timber
import java.util.Locale
import java.util.concurrent.TimeUnit

abstract class BaseAudioPlayer internal constructor(
    private val context: Context,
    val options: PlayerOptions = PlayerOptions()
) {

    val exoPlayer: ExoPlayer
    val forwardingPlayer: InnerForwardingPlayer
    val player: Player
        get() {
            return options.interceptPlayerActionsTriggeredExternally
                .takeIf { it }
                ?.let { forwardingPlayer }
                ?: exoPlayer
        }
    private var playerListener = InnerPlayerListener()
    private var cache: SimpleCache? = null
    val playerEventHolder = PlayerEventHolder()

    private var wasDucking = false
    private val focusManager: FocusManager = FocusManager()

    var alwaysPauseOnInterruption: Boolean
        get() = options.alwaysPauseOnInterruption
        set(v) { options.alwaysPauseOnInterruption = v }

    open val currentItem: AudioItem?
        get() = exoPlayer.currentMediaItem?.let { AudioItem.fromMediaItem(it) }

    var playbackError: PlaybackError? = null
    /** Monotonic timestamp (ms) of the most recent seek request. Zero if no seek has occurred. */
    var lastSeekTimeMs: Long = 0
        private set
    var playerState: AudioPlayerState = AudioPlayerState.IDLE
        private set(value) {
            if (value != field) {
                field = value
                playerEventHolder.updateAudioPlayerState(value)
                if (!options.handleAudioFocus) {
                    when (value) {
                        AudioPlayerState.IDLE,
                        AudioPlayerState.ERROR -> focusManager.abandonAudioFocusIfHeld()
                        AudioPlayerState.READY -> focusManager.requestAudioFocus()
                        else -> {}
                    }
                }
            }
        }

    var playWhenReady: Boolean
        get() = exoPlayer.playWhenReady
        set(value) {
            exoPlayer.playWhenReady = value
        }

    val duration: Long
        get() {
            return if (exoPlayer.duration == C.TIME_UNSET) {
                currentItem?.duration ?: 0
            } else {
                exoPlayer.duration
            }
        }

    val isCurrentMediaItemLive: Boolean
        get() = exoPlayer.isCurrentMediaItemLive

    private var oldPosition = 0L

    val position: Long
        get() {
            return if (exoPlayer.currentPosition == C.INDEX_UNSET.toLong()) 0
            else exoPlayer.currentPosition
        }

    val bufferedPosition: Long
        get() {
            return if (exoPlayer.bufferedPosition == C.INDEX_UNSET.toLong()) 0
            else exoPlayer.bufferedPosition
        }

    private var volumeMultiplier = 1f
        private set(value) {
            field = value
            volume = volume
        }

    var volume: Float
        get() = exoPlayer.volume
        set(value) {
            exoPlayer.volume = value * volumeMultiplier
        }

    var playbackSpeed: Float
        get() = exoPlayer.playbackParameters.speed
        set(value) {
            exoPlayer.setPlaybackSpeed(value)
        }

    val isPlaying
        get() = exoPlayer.isPlaying

    var ratingType: Int = RatingCompat.RATING_NONE

    fun setAudioOffload(offload: Boolean = true) {
        val audioOffloadPreferences =
            TrackSelectionParameters.AudioOffloadPreferences.Builder()
                .setAudioOffloadMode(
                    if (offload) TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_ENABLED
                    else TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED)
                .setIsGaplessSupportRequired(true)
                .setIsSpeedChangeSupportRequired(true)
                .build()
        exoPlayer.trackSelectionParameters =
            exoPlayer.trackSelectionParameters
                .buildUpon()
                .setAudioOffloadPreferences(audioOffloadPreferences)
                .build()
    }

    init {
        if (options.cacheSizeKb > 0) {
            cache = Cache.initCache(context, options.cacheSizeKb)
        }
        playerEventHolder.updateAudioPlayerState(AudioPlayerState.IDLE)

        val renderer = DefaultRenderersFactory(context)
        renderer.setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
        exoPlayer = ExoPlayer
            .Builder(context)
            .setRenderersFactory(renderer)
            .setHandleAudioBecomingNoisy(options.handleAudioBecomingNoisy)
            .setMediaSourceFactory(MediaFactory(context, cache))
            .setWakeMode(setWakeMode(options.wakeMode))
            .apply {
                setLoadControl(setupBuffer(options.bufferOptions))
            }
            .setSkipSilenceEnabled(options.skipSilence)
            .setName("kotlin-audio-player")
            .build()

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(options.audioContentType)
            .build()
        exoPlayer.setAudioAttributes(audioAttributes, options.handleAudioFocus)
        forwardingPlayer = InnerForwardingPlayer(exoPlayer)
        player.addListener(playerListener)
    }

    /**
     * Will replace the current item with a new one and load it into the player.
     * @param item The [AudioItem] to replace the current one.
     * @param playWhenReady Whether playback starts automatically.
     */
    open fun load(item: AudioItem, playWhenReady: Boolean = true) {
        exoPlayer.playWhenReady = playWhenReady
        load(item)
    }

    /**
     * Will replace the current item with a new one and load it into the player.
     * @param item The [AudioItem] to replace the current one.
     */
    open fun load(item: AudioItem) {
        exoPlayer.addMediaItem(item.toMediaItem())
        exoPlayer.prepare()
    }

    fun togglePlaying() {
        if (exoPlayer.isPlaying) {
            pause()
        } else {
            play()
        }
    }

    var skipSilence: Boolean
        get() = exoPlayer.skipSilenceEnabled
        set(value) {
            exoPlayer.skipSilenceEnabled = value
        }

    fun play() {
        exoPlayer.play()
        if (currentItem != null) {
            exoPlayer.prepare()
        }
    }

    fun prepare() {
        if (currentItem != null) {
            exoPlayer.prepare()
        }
    }

    fun pause() {
        exoPlayer.pause()
    }

    /**
     * Stops playback, without clearing the active item. Calling this method will cause the playback
     * state to transition to AudioPlayerState.IDLE and the player will release the loaded media and
     * resources required for playback.
     */
    @CallSuper
    open fun stop() {
        val wasActive = playerState.isActive
        val trackIndex = exoPlayer.currentMediaItemIndex
        val positionMs = exoPlayer.currentPosition
        playerState = AudioPlayerState.STOPPED
        exoPlayer.playWhenReady = false
        exoPlayer.stop()
        if (wasActive) {
            playerEventHolder.updatePlaybackEnd(PlaybackEndEvent(
                PlaybackEndedReason.PLAYER_STOPPED, trackIndex, positionMs
            ))
        }
    }

    @CallSuper
    open fun clear() {
        val wasActive = playerState.isActive
        val trackIndex = exoPlayer.currentMediaItemIndex
        val positionMs = exoPlayer.currentPosition
        exoPlayer.clearMediaItems()
        if (wasActive) {
            playerEventHolder.updatePlaybackEnd(PlaybackEndEvent(
                PlaybackEndedReason.CLEARED, trackIndex, positionMs
            ))
        }
    }

    /**
     * Pause playback whenever an item plays to its end.
     */
    fun setPauseAtEndOfItem(pause: Boolean) {
        exoPlayer.pauseAtEndOfMediaItems = pause
    }

    /**
     * Stops and destroys the player. Only call this when you are finished using the player, otherwise use [pause].
     */
    @CallSuper
    open fun destroy() {
        focusManager.abandonAudioFocusIfHeld()
        stop()
        player.removeListener(playerListener)
        exoPlayer.release()
        cache?.release()
        cache = null
    }

    open fun seek(duration: Long, unit: TimeUnit) {
        val positionMs = TimeUnit.MILLISECONDS.convert(duration, unit)
        lastSeekTimeMs = System.currentTimeMillis()
        exoPlayer.seekTo(positionMs)
    }

    open fun seekBy(offset: Long, unit: TimeUnit) {
        val positionMs = exoPlayer.currentPosition + TimeUnit.MILLISECONDS.convert(offset, unit)
        lastSeekTimeMs = System.currentTimeMillis()
        exoPlayer.seekTo(positionMs)
    }

    @UnstableApi
    inner class InnerPlayerListener : Listener {

        /**
         * Called when there is metadata associated with the current playback time.
         */
        override fun onMetadata(metadata: Metadata) {
            playerEventHolder.updateOnTimedMetadata(metadata)
        }

        override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) {
            playerEventHolder.updateOnCommonMetadata(mediaMetadata)
        }

        /**
         * A position discontinuity occurs when the playing period changes, the playback position
         * jumps within the period currently being played, or when the playing period has been
         * skipped or removed.
         */
        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int
        ) {
            this@BaseAudioPlayer.oldPosition = oldPosition.positionMs

            when (reason) {
                Player.DISCONTINUITY_REASON_AUTO_TRANSITION -> playerEventHolder.updatePositionChangedReason(
                    PositionChangedReason.AUTO(oldPosition.positionMs, newPosition.positionMs)
                )
                Player.DISCONTINUITY_REASON_SEEK -> playerEventHolder.updatePositionChangedReason(
                    PositionChangedReason.SEEK(oldPosition.positionMs, newPosition.positionMs)
                )
                Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT -> playerEventHolder.updatePositionChangedReason(
                    PositionChangedReason.SEEK_FAILED(
                        oldPosition.positionMs,
                        newPosition.positionMs
                    )
                )
                Player.DISCONTINUITY_REASON_REMOVE -> playerEventHolder.updatePositionChangedReason(
                    PositionChangedReason.QUEUE_CHANGED(
                        oldPosition.positionMs,
                        newPosition.positionMs
                    )
                )
                Player.DISCONTINUITY_REASON_SKIP -> playerEventHolder.updatePositionChangedReason(
                    PositionChangedReason.SKIPPED_PERIOD(
                        oldPosition.positionMs,
                        newPosition.positionMs
                    )
                )
                Player.DISCONTINUITY_REASON_INTERNAL -> playerEventHolder.updatePositionChangedReason(
                    PositionChangedReason.UNKNOWN(oldPosition.positionMs, newPosition.positionMs)
                )

                Player.DISCONTINUITY_REASON_SILENCE_SKIP -> playerEventHolder.updatePositionChangedReason(
                    PositionChangedReason.UNKNOWN(oldPosition.positionMs, newPosition.positionMs)
                )
            }
        }

        /**
         * Called when playback transitions to a media item or starts repeating a media item
         * according to the current repeat mode. Note that this callback is also called when the
         * playlist becomes non-empty or empty as a consequence of a playlist change.
         */
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // Capture indices synchronously — ExoPlayer guarantees state is
            // already updated when this callback fires. Reading these after an
            // async hop (e.g. in a SharedFlow collector) would risk stale data.
            val prevIdx = if (exoPlayer.previousMediaItemIndex == C.INDEX_UNSET) null
                          else exoPlayer.previousMediaItemIndex
            val curIdx = exoPlayer.currentMediaItemIndex
            when (reason) {
                Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> {
                    playerEventHolder.updatePlaybackEnd(PlaybackEndEvent(
                        PlaybackEndedReason.PLAYED_UNTIL_END,
                        prevIdx ?: curIdx,
                        oldPosition
                    ))
                    playerEventHolder.updateAudioItemTransition(
                        AudioItemTransitionReason.AUTO(oldPosition, prevIdx, curIdx)
                    )
                }
                Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED ->
                    playerEventHolder.updateAudioItemTransition(
                        AudioItemTransitionReason.QUEUE_CHANGED(oldPosition, prevIdx, curIdx)
                    )
                Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT ->
                    playerEventHolder.updateAudioItemTransition(
                        AudioItemTransitionReason.REPEAT(oldPosition, prevIdx, curIdx)
                    )
                Player.MEDIA_ITEM_TRANSITION_REASON_SEEK ->
                    playerEventHolder.updateAudioItemTransition(
                        AudioItemTransitionReason.SEEK_TO_ANOTHER_AUDIO_ITEM(oldPosition, prevIdx, curIdx)
                    )
            }
        }

        /**
         * Called when the value returned from Player.getPlayWhenReady() changes.
         */
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            val pausedBecauseReachedEnd = reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM
            playerEventHolder.updatePlayWhenReadyChange(PlayWhenReadyChangeData(playWhenReady, pausedBecauseReachedEnd))
        }

        /**
         * The generic onEvents callback provides access to the Player object and specifies the set
         * of events that occurred together. It’s always called after the callbacks that correspond
         * to the individual events.
         */
        override fun onEvents(player: Player, events: Player.Events) {
            // Process events in the order ExoPlayer reported them. Setting playerState
            // fires a stateChange emission, so ordering matters for downstream listeners.
            for (i in 0 until events.size()) {
                when (events[i]) {
                    Player.EVENT_PLAYBACK_STATE_CHANGED -> {
                        val state = when (player.playbackState) {
                            Player.STATE_BUFFERING -> AudioPlayerState.BUFFERING
                            Player.STATE_READY -> AudioPlayerState.READY
                            Player.STATE_IDLE ->
                                // Avoid transitioning to idle from error or stopped
                                if (
                                    playerState == AudioPlayerState.ERROR ||
                                    playerState == AudioPlayerState.STOPPED
                                )
                                    null
                                else
                                    AudioPlayerState.IDLE
                            Player.STATE_ENDED ->
                                if (player.mediaItemCount > 0) {
                                    playerEventHolder.updatePlaybackEnd(PlaybackEndEvent(
                                        PlaybackEndedReason.PLAYED_UNTIL_END,
                                        player.currentMediaItemIndex,
                                        player.currentPosition
                                    ))
                                    AudioPlayerState.ENDED
                                }
                                else AudioPlayerState.IDLE
                            else -> null // noop
                        }
                        if (state != null && state != playerState) {
                            playerState = state
                        }
                    }
                    Player.EVENT_MEDIA_ITEM_TRANSITION -> {
                        playbackError = null
                        if (currentItem != null) {
                            playerState = AudioPlayerState.LOADING
                            if (isPlaying) {
                                playerState = AudioPlayerState.READY
                                playerState = AudioPlayerState.PLAYING
                            }
                        }
                    }
                    Player.EVENT_PLAY_WHEN_READY_CHANGED -> {
                        if (!player.playWhenReady && playerState != AudioPlayerState.STOPPED) {
                            playerState = AudioPlayerState.PAUSED
                        }
                    }
                    Player.EVENT_IS_PLAYING_CHANGED -> {
                        if (player.isPlaying) {
                            playerState = AudioPlayerState.PLAYING
                        }
                    }
                    Player.EVENT_IS_LOADING_CHANGED -> {
                        if (!player.isLoading && duration > 0 && bufferedPosition >= duration) {
                            playerEventHolder.updateBufferFull(true)
                        }
                    }
                }
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            val trackIndex = exoPlayer.currentMediaItemIndex
            val positionMs = exoPlayer.currentPosition
            val _playbackError = PlaybackError(
                error.errorCodeName
                    .replace("ERROR_CODE_", "")
                    .lowercase(Locale.getDefault())
                    .replace("_", "-"),
                error.message
            )
            playerEventHolder.updatePlaybackError(_playbackError)
            playerEventHolder.updatePlaybackEnd(PlaybackEndEvent(
                PlaybackEndedReason.FAILED, trackIndex, positionMs
            ))
            playbackError = _playbackError
            playerState = AudioPlayerState.ERROR
        }
    }

    /**
     * Intercepts player commands from external controllers (Android Auto, system UI,
     * notification) and routes them as events to the JS layer via [PlayerEventHolder],
     * rather than letting them mutate the ExoPlayer queue directly.
     *
     * Queue-mutation methods (setMediaItems, addMediaItems) are intentionally no-ops
     * to prevent external controllers from replacing the RNTP-managed queue.
     */
    @UnstableApi
    inner class InnerForwardingPlayer(player: ExoPlayer): ForwardingPlayer(player) {
        override fun setMediaItems(mediaItems: MutableList<MediaItem>, resetPosition: Boolean) {
            return
        }

        override fun addMediaItems(mediaItems: MutableList<MediaItem>) {
            return
        }

        override fun addMediaItems(index: Int, mediaItems: MutableList<MediaItem>) {
            return
        }

        override fun setMediaItems(
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long
        ) {
            return
        }

        override fun setMediaItems(mediaItems: MutableList<MediaItem>) {
            return
        }

        override fun play() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.PLAY)
        }

        override fun pause() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.PAUSE)
        }

        override fun seekToNext() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.NEXT)
        }

        override fun seekToNextMediaItem() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.NEXT)
        }

        override fun seekToPrevious() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.PREVIOUS)
        }

        override fun seekToPreviousMediaItem() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.PREVIOUS)
        }

        override fun seekForward() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.FORWARD)
        }

        override fun seekBack() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.REWIND)
        }

        override fun stop() {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(MediaSessionCallback.STOP)
        }

        override fun seekTo(mediaItemIndex: Int, positionMs: Long) {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(
                MediaSessionCallback.SEEK(
                    positionMs
                )
            )
        }

        override fun seekTo(positionMs: Long) {
            playerEventHolder.updateOnPlayerActionTriggeredExternally(
                MediaSessionCallback.SEEK(
                    positionMs
                )
            )
        }
    }

    inner class FocusManager {
        private var hasAudioFocus = false
        private var focusRequest: AudioFocusRequest? = null

        fun requestAudioFocus() {
            if (hasAudioFocus) return
            val manager = ContextCompat.getSystemService(context, AudioManager::class.java) ?: return

            val attrs = NativeAudioAttributes.Builder()
                .setUsage(NativeAudioAttributes.USAGE_MEDIA)
                .setContentType(NativeAudioAttributes.CONTENT_TYPE_MUSIC)
                .build()

            // U6 Android sibling: build the request into a local val so the
            // subsequent requestAudioFocus() call can use it without a `!!`.
            // Storing on the field afterwards keeps abandonAudioFocusIfHeld() working.
            val newFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setWillPauseWhenDucked(options.alwaysPauseOnInterruption)
                .setOnAudioFocusChangeListener { focusChange ->
                    Timber.d("Audio focus changed")
                    val isPermanent = focusChange == AudioManager.AUDIOFOCUS_LOSS
                    val isPaused = when (focusChange) {
                        AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> true
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> options.alwaysPauseOnInterruption
                        else -> false
                    }
                    if (!options.handleAudioFocus) {
                        if (isPermanent) focusManager.abandonAudioFocusIfHeld()

                        val isDucking = focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
                                && !options.alwaysPauseOnInterruption
                        if (isDucking) {
                            volumeMultiplier = 0.5f
                            wasDucking = true
                        } else if (wasDucking) {
                            volumeMultiplier = 1f
                            wasDucking = false
                        }
                    }
                    playerEventHolder.updateOnAudioFocusChanged(isPaused, isPermanent)
                }
                .build()
            focusRequest = newFocusRequest

            val result = manager.requestAudioFocus(newFocusRequest)
            hasAudioFocus = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
        }

        fun abandonAudioFocusIfHeld() {
            if (!hasAudioFocus) return
            val manager = ContextCompat.getSystemService(context, AudioManager::class.java) ?: return
            val result = focusRequest?.let { manager.abandonAudioFocusRequest(it) }
                ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
            hasAudioFocus = (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
        }
    }
}
