package com.doublesymmetry.trackplayer.service

import android.annotation.SuppressLint
import android.app.*
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.provider.Settings
import android.view.KeyEvent
import androidx.annotation.MainThread
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.common.MediaItem
import androidx.media3.common.Rating
import androidx.media3.common.util.BitmapLoader
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionResult
import com.doublesymmetry.kotlinaudio.event.PlayerEventHolder
import com.doublesymmetry.kotlinaudio.models.*
import com.doublesymmetry.kotlinaudio.players.QueuedAudioPlayer
import com.doublesymmetry.trackplayer.HeadlessJsMediaService
import com.doublesymmetry.trackplayer.diagnostics.RemoteControlDiagnosticLog
import com.doublesymmetry.trackplayer.extensions.NumberExt.Companion.toMilliseconds
import com.doublesymmetry.trackplayer.extensions.NumberExt.Companion.toSeconds
import com.doublesymmetry.trackplayer.extensions.asLibState
import com.doublesymmetry.trackplayer.extensions.find
import com.doublesymmetry.trackplayer.model.MetadataAdapter
import com.doublesymmetry.trackplayer.model.PlaybackMetadata
import com.doublesymmetry.trackplayer.model.Track
import com.doublesymmetry.trackplayer.model.TrackAudioItem
import com.doublesymmetry.trackplayer.module.MusicEvents
import com.doublesymmetry.trackplayer.module.MusicEvents.METADATA_PAYLOAD_KEY
import com.doublesymmetry.trackplayer.utils.BundleUtils
import com.doublesymmetry.trackplayer.utils.BundleUtils.setRating
import com.doublesymmetry.trackplayer.utils.CoilBitmapLoader
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.flow
import timber.log.Timber
import java.util.concurrent.TimeUnit
import kotlin.system.exitProcess

@OptIn(UnstableApi::class)
@MainThread
class MusicService : HeadlessJsMediaService() {
    private lateinit var player: QueuedAudioPlayer
    private val binder = MusicBinder()
    // CoroutineExceptionHandler ensures any uncaught throwable inside a coroutine on
    // this scope is logged rather than propagating to the global handler (which would
    // crash the media service). All long-running flows on this scope (sleep timer
    // monitor, progress update flow, sleep wake monitor) live for the lifetime of the
    // service and a single bad iteration must not take it down.
    private val coroutineExceptionHandler = CoroutineExceptionHandler { _, throwable ->
        Timber.e(throwable, "Uncaught coroutine exception in MusicService scope")
    }
    private val scope = MainScope() + coroutineExceptionHandler
    private lateinit var fakePlayer: ExoPlayer
    private lateinit var mediaSession: MediaLibrarySession
    private var progressUpdateJob: Job? = null
    private var hasEmittedBufferFull = false
    private var sessionCommands: SessionCommands? = null
    private var playerCommands: Player.Commands? = null
    private var customLayout: List<CommandButton> = listOf()
    private var lastWake: Long = 0
    var onStartCommandIntentValid: Boolean = true

    fun acquireWakeLock() {
        acquireWakeLockNow(this)
    }

    fun abandonWakeLock() {
        sWakeLock?.release()
    }

    fun getBitmapLoader(): BitmapLoader {
        return mediaSession.bitmapLoader
    }

    fun getCurrentBitmap(): ListenableFuture<Bitmap>? {
        return player.exoPlayer.currentMediaItem?.mediaMetadata?.let {
            mediaSession.bitmapLoader.loadBitmapFromMetadata(
                it
            )
        }
    }

    override fun onCreate() {
        // Wrap the entire body in try/catch. ExoPlayer.Builder, MediaLibrarySession.Builder
        // and CoilBitmapLoader all reach into AndroidX Media3, OkHttp and Coil — any of
        // which can throw NoClassDefFoundError / ClassNotFoundException on stripped OEM
        // ROMs (MIUI/HyperOS, FunTouchOS) where R8 has too-aggressively shrunk the APK,
        // or where the Play Store delivered a degraded split. An unhandled throw inside
        // a Service.onCreate() crashes the service host and ANR-loops the activity. The
        // catch swallows the failure, leaves fakePlayer/mediaSession uninitialized
        // (lateinit; later media calls will throw, but onDestroy already gates with
        // ::mediaSession.isInitialized), and still calls super.onCreate() so the Service
        // contract is satisfied and the React activity can still launch — the user sees
        // an app, not a black-screen ANR.
        try {
            Timber.plant(object : Timber.DebugTree() {
                override fun createStackElementTag(element: StackTraceElement): String? {
                    return "RNTP-${element.className}:${element.methodName}"
                }
            })
            fakePlayer = ExoPlayer.Builder(this).build()
            val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            } ?: Intent(Intent.ACTION_MAIN).apply {
                setPackage(packageName)
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            mediaSession = MediaLibrarySession.Builder(this, fakePlayer,
                InnerMediaSessionCallback()
            )
                .setId("TrackPlayer")
                .setBitmapLoader(CacheBitmapLoader(CoilBitmapLoader(this)))
                // https://github.com/androidx/media/issues/1218
                .setSessionActivity(
                    PendingIntent.getActivity(
                        this,
                        0,
                        openAppIntent,
                        getPendingIntentFlags()
                    )
                )
                .build()
        } catch (t: Throwable) {
            android.util.Log.e(
                "MusicService",
                "onCreate failed; service starting in degraded state: ${t.message}",
                t
            )
        }
        super.onCreate()
    }

    enum class AppKilledPlaybackBehavior(val string: String) {
        CONTINUE_PLAYBACK("continue-playback"),
        PAUSE_PLAYBACK("pause-playback"),
        STOP_PLAYBACK_AND_REMOVE_NOTIFICATION("stop-playback-and-remove-notification")
    }

    private var appKilledPlaybackBehavior =
        AppKilledPlaybackBehavior.STOP_PLAYBACK_AND_REMOVE_NOTIFICATION

    // Placeholder PlayerEventHolder returned from `event` when `player` has not
    // been initialized yet. PlayerEventHolder() is a no-arg constructor that just
    // creates SharedFlows — safe to instantiate eagerly.
    private val emptyEventHolder = PlayerEventHolder()

    // All property accessors below are guarded with `::player.isInitialized`.
    // The lateinit `player` is only assigned inside `setupPlayer()`, but external
    // MediaController callbacks (Android Auto, Wear, Assistant) can bind to the
    // service before `setupPlayer()` runs. Without these guards, an unguarded
    // access throws UninitializedPropertyAccessException and crashes the service.
    val tracks: List<Track>
        get() = if (::player.isInitialized) {
            player.items.map { (it as TrackAudioItem).track }
        } else {
            emptyList()
        }

    val currentTrack: Track?
        get() = if (::player.isInitialized) {
            (player.currentItem as TrackAudioItem?)?.track
        } else {
            null
        }

    val state: AudioPlayerState
        get() = if (::player.isInitialized) player.playerState else AudioPlayerState.IDLE

    var ratingType: Int
        get() = if (::player.isInitialized) player.ratingType else 0
        set(value) {
            if (::player.isInitialized) player.ratingType = value
        }

    val playbackError: PlaybackError?
        get() = if (::player.isInitialized) player.playbackError else null

    val event: PlayerEventHolder
        get() = if (::player.isInitialized) player.playerEventHolder else emptyEventHolder

    var playWhenReady: Boolean
        get() = if (::player.isInitialized) player.playWhenReady else false
        set(value) {
            if (::player.isInitialized) player.playWhenReady = value
        }

    // Sleep timer state
    private var sleepTimerEndTime: Long? = null
    private var sleepTimerOriginalVolume: Float? = null
    private var sleepTimerFading = false
    private var sleepTimerEndOfTrack = false
    private var sleepTimerJob: Job? = null

    private var latestOptions: Bundle? = null
    private var commandStarted = false

    // Track last processed media key event to prevent double-handling
    // when both onStartCommand and onMediaButtonEvent fire for the same press
    private var lastMediaKeyDownTime: Long = -1
    private var lastMediaKeyCode: Int = -1

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        onStartCommandIntentValid = intent != null
        val incomingKey = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            intent?.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
        else intent?.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
        Timber.d("onStartCommand: ${intent?.action}, ${intent?.`package`}")
        RemoteControlDiagnosticLog.log(
            this,
            "onStartCommand action=${intent?.action} pkg=${intent?.`package`} " +
                "keyCode=${incomingKey?.keyCode} keyAction=${incomingKey?.action}",
        )
        // Some OEMs (OnePlus OxygenOS < 15, Huawei HarmonyOS) route media button
        // intents here instead of through MediaSession.Callback.onMediaButtonEvent(),
        // even on Android 13+. Always attempt to handle them here — deduplication
        // in onMediaKeyEvent() prevents double-handling on standard devices.
        onMediaKeyEvent(intent)
        // Media3's MediaSessionService auto-starts the service when play() is called,
        // which re-invokes onStartCommand. Guard against re-registering the headless
        // JS task on subsequent calls.
        if (!commandStarted) {
            commandStarted = true
            super.onStartCommand(intent, flags, startId)
        }
        return START_STICKY
    }

    @MainThread
    fun setupPlayer(playerOptions: Bundle?) {
        if (this::player.isInitialized) {
            Timber.d("Player was initialized previously. Preventing reinitialization.")
            return
        }
        Timber.d("Setting up player")
        val options = PlayerOptions(
            audioContentType = when (playerOptions?.getString(ANDROID_AUDIO_CONTENT_TYPE)) {
                "music" -> C.AUDIO_CONTENT_TYPE_MUSIC
                "speech" -> C.AUDIO_CONTENT_TYPE_SPEECH
                "sonification" -> C.AUDIO_CONTENT_TYPE_SONIFICATION
                "movie" -> C.AUDIO_CONTENT_TYPE_MOVIE
                "unknown" -> C.AUDIO_CONTENT_TYPE_UNKNOWN
                else -> C.AUDIO_CONTENT_TYPE_MUSIC
            },
            bufferOptions = BufferOptions(
                playerOptions?.getDouble(MIN_BUFFER_KEY)?.toMilliseconds()?.toInt(),
                playerOptions?.getDouble(MAX_BUFFER_KEY)?.toMilliseconds()?.toInt(),
                playerOptions?.getDouble(PLAY_BUFFER_KEY)?.toMilliseconds()?.toInt(),
                playerOptions?.getDouble(BACK_BUFFER_KEY)?.toMilliseconds()?.toInt(),
            ),
            cacheSizeKb = playerOptions?.getDouble(MAX_CACHE_SIZE_KEY)?.toLong() ?: 0,
            handleAudioBecomingNoisy = playerOptions?.getBoolean(HANDLE_NOISY, true) ?: true,
            handleAudioFocus = playerOptions?.getBoolean(AUTO_HANDLE_INTERRUPTIONS) ?: true,
            interceptPlayerActionsTriggeredExternally = true,
            skipSilence = playerOptions?.getBoolean(SKIP_SILENCE) ?: false,
            wakeMode = playerOptions?.getInt(WAKE_MODE, 0) ?: 0
        )
        player = QueuedAudioPlayer(this@MusicService, options)
        fakePlayer.release()
        mediaSession.player = player.forwardingPlayer
        observeEvents()
    }

    @MainThread
    fun updateOptions(options: Bundle) {
        latestOptions = options
        val androidOptions = options.getBundle(ANDROID_OPTIONS_KEY)

        if (androidOptions?.containsKey(AUDIO_OFFLOAD_KEY) == true) {
            player.setAudioOffload(androidOptions.getBoolean(AUDIO_OFFLOAD_KEY))
        }
        if (androidOptions?.containsKey(SKIP_SILENCE) == true) {
            player.skipSilence = androidOptions.getBoolean(SKIP_SILENCE)
        }

        // Local fork: default to stopping playback when app is killed.
        // Upstream RNTP defaults to CONTINUE_PLAYBACK.
        appKilledPlaybackBehavior =
            AppKilledPlaybackBehavior::string.find(
                androidOptions?.getString(
                    APP_KILLED_PLAYBACK_BEHAVIOR_KEY
                )
            ) ?: AppKilledPlaybackBehavior.STOP_PLAYBACK_AND_REMOVE_NOTIFICATION

        player.alwaysPauseOnInterruption =
            androidOptions?.getBoolean(PAUSE_ON_INTERRUPTION_KEY) ?: false
        player.shuffleMode = androidOptions?.getBoolean(SHUFFLE_KEY) ?: false

        // setup progress update events if configured
        progressUpdateJob?.cancel()
        val updateInterval =
            BundleUtils.getDoubleOrNull(options, PROGRESS_UPDATE_EVENT_INTERVAL_KEY)
        if (updateInterval != null && updateInterval > 0) {
            progressUpdateJob = scope.launch {
                progressUpdateEventFlow(updateInterval).collect {
                    emit(
                        MusicEvents.PLAYBACK_PROGRESS_UPDATED,
                        it
                    )
                }
            }
        }
        // Defensive: JS may send out-of-range ints if the JS-side enum drifts from
        // the native one (version skew, corrupted SQLite, future enum additions).
        // Drop unknown values rather than IndexOutOfBoundsException-crashing the
        // entire updateOptions call (which would tear down the media session).
        val capabilities =
            options.getIntegerArrayList("capabilities")
                ?.mapNotNull { Capability.entries.getOrNull(it) }
                ?: emptyList()
        var notificationCapabilities = options.getIntegerArrayList("notificationCapabilities")
            ?.mapNotNull { Capability.entries.getOrNull(it) }
            ?: emptyList()
        if (notificationCapabilities.isEmpty()) notificationCapabilities = capabilities

        val playerCommandsBuilder = Player.Commands.Builder().addAll(
            // Required by DefaultMediaNotificationProvider to read title/artist/artwork
            Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
            Player.COMMAND_GET_TRACKS,
            Player.COMMAND_GET_TIMELINE,
            Player.COMMAND_GET_METADATA,
            Player.COMMAND_GET_AUDIO_ATTRIBUTES,
            Player.COMMAND_GET_VOLUME,
            Player.COMMAND_GET_DEVICE_VOLUME,
            Player.COMMAND_GET_TEXT,
            Player.COMMAND_SEEK_TO_MEDIA_ITEM,
            Player.COMMAND_SET_MEDIA_ITEM,
            Player.COMMAND_PREPARE,
            Player.COMMAND_RELEASE,
        )
        notificationCapabilities.forEach {
            when (it) {
                Capability.PLAY, Capability.PAUSE -> {
                    playerCommandsBuilder.add(Player.COMMAND_PLAY_PAUSE)
                }

                Capability.STOP -> {
                    playerCommandsBuilder.add(Player.COMMAND_STOP)
                }

                Capability.SEEK_TO -> {
                    playerCommandsBuilder.add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                }

                else -> {}
            }
        }
        customLayout = CustomCommandButton.entries
            .filter { notificationCapabilities.contains(it.capability) }
            .map { c -> c.commandButton }
        val sessionCommandsBuilder =
            MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
        customLayout.forEach { v ->
            v.sessionCommand?.let { sessionCommandsBuilder.add(it) }
        }

        sessionCommands = sessionCommandsBuilder.build()
        playerCommands = playerCommandsBuilder.build()

        // Capture controllerInfo into a local val so a controller disconnect between
        // reads can't NPE the second access.
        // https://github.com/androidx/media/blob/c35a9d62baec57118ea898e271ac66819399649b/demos/session_service/src/main/java/androidx/media3/demo/session/DemoMediaLibrarySessionCallback.kt#L107
        mediaSession.mediaNotificationControllerInfo?.let { controllerInfo ->
            mediaSession.setCustomLayout(controllerInfo, customLayout)
            playerCommands?.let { cmds ->
                mediaSession.setAvailableCommands(
                    controllerInfo,
                    sessionCommandsBuilder.build(),
                    cmds
                )
            }
        }
    }

    @MainThread
    private fun progressUpdateEventFlow(interval: Double) = flow {
        // Defensive: this flow is launched from updateOptions(), which can run before
        // setupPlayer() initializes the lateinit `player`. The first iteration would
        // otherwise UninitializedPropertyAccessException — wait it out instead.
        while (true) {
            if (::player.isInitialized
                && (player.isPlaying || player.playerState == AudioPlayerState.BUFFERING
                    || player.playerState == AudioPlayerState.LOADING)
            ) {
                val bundle = progressUpdateEvent()
                emit(bundle)
            }

            delay((interval * 1000).toLong())
        }
    }

    @MainThread
    private fun progressUpdateEvent(): Bundle {
        return Bundle().apply {
            putDouble(POSITION_KEY, player.position.toSeconds())
            putDouble(DURATION_KEY, player.duration.toSeconds())
            putDouble(BUFFERED_POSITION_KEY, player.bufferedPosition.toSeconds())
            putInt(TRACK_KEY, player.currentIndex)
        }
    }

    @MainThread
    fun add(track: Track) {
        add(listOf(track))
    }

    @MainThread
    fun add(tracks: List<Track>) {
        val items = tracks.map { it.toAudioItem() }
        player.add(items)
    }

    @MainThread
    fun add(tracks: List<Track>, atIndex: Int) {
        val items = tracks.map { it.toAudioItem() }
        player.add(items, atIndex)
    }

    @MainThread
    fun load(track: Track) {
        player.load(track.toAudioItem())
    }

    @MainThread
    fun move(fromIndex: Int, toIndex: Int) {
        player.move(fromIndex, toIndex);
    }

    @MainThread
    fun remove(index: Int) {
        remove(listOf(index))
    }

    @MainThread
    fun remove(indexes: List<Int>) {
        player.remove(indexes)
    }

    @MainThread
    fun clear() {
        clearSleepTimer()
        player.clear()
    }

    @MainThread
    fun play() {
        player.play()
    }

    @MainThread
    fun pause() {
        player.pause()
    }

    @MainThread
    fun stop() {
        player.stop()
    }

    @MainThread
    fun removeUpcomingTracks() {
        player.removeUpcomingItems()
    }

    @MainThread
    fun removePreviousTracks() {
        player.removePreviousItems()
    }

    @MainThread
    fun skip(index: Int) {
        player.jumpToItem(index)
    }

    @MainThread
    fun skipToNext() {
        player.next()
    }

    @MainThread
    fun skipToPrevious() {
        player.previous()
    }

    @MainThread
    fun seekTo(seconds: Float) {
        player.seek((seconds * 1000).toLong(), TimeUnit.MILLISECONDS)
    }

    @MainThread
    fun seekBy(offset: Float) {
        player.seekBy((offset.toLong()), TimeUnit.SECONDS)
    }

    @MainThread
    fun retry() {
        player.prepare()
    }

    @MainThread
    fun getCurrentTrackIndex(): Int = player.currentIndex

    @MainThread
    fun getRate(): Float = player.playbackSpeed

    @MainThread
    fun setRate(value: Float) {
        player.playbackSpeed = value
    }

    @MainThread
    fun getRepeatMode(): RepeatMode = player.repeatMode

    @MainThread
    fun setRepeatMode(value: RepeatMode) {
        player.repeatMode = value
    }

    @MainThread
    fun getVolume(): Float = player.volume

    @MainThread
    fun setVolume(value: Float) {
        player.volume = value
    }

    @MainThread
    fun getDurationInSeconds(): Double = player.duration.toSeconds()

    @MainThread
    fun getPositionInSeconds(): Double = player.position.toSeconds()

    @MainThread
    fun getBufferedPositionInSeconds(): Double = player.bufferedPosition.toSeconds()

    @MainThread
    fun getPlayerStateBundle(state: AudioPlayerState): Bundle {
        val bundle = Bundle()
        bundle.putString(STATE_KEY, state.asLibState.state)
        if (state == AudioPlayerState.ERROR) {
            bundle.putBundle(ERROR_KEY, getPlaybackErrorBundle())
        }
        return bundle
    }

    @MainThread
    fun updateMetadataForTrack(index: Int, bundle: Bundle) {
        tracks[index].let { currentTrack ->
            currentTrack.setMetadata(reactContext, bundle, 0)

            player.replaceItem(index, currentTrack.toAudioItem())
        }
    }

    @MainThread
    fun updateNowPlayingMetadata(bundle: Bundle) {
        updateMetadataForTrack(player.currentIndex, bundle)
    }

    private fun emitPlaybackTrackChangedEvents(
        previousIndex: Int?,
        currentIndex: Int,
        oldPosition: Double
    ) {
        val bundle = Bundle()
        bundle.putDouble("lastPosition", oldPosition)
        if (tracks.isNotEmpty() && currentIndex in tracks.indices) {
            bundle.putInt("index", currentIndex)
            bundle.putBundle("track", tracks[currentIndex].originalItem)
            if (previousIndex != null && previousIndex in tracks.indices) {
                bundle.putInt("lastIndex", previousIndex)
                bundle.putBundle("lastTrack", tracks[previousIndex].originalItem)
            }
        }
        emit(MusicEvents.PLAYBACK_ACTIVE_TRACK_CHANGED, bundle)
    }

    private fun emitQueueEndedEvent() {
        val bundle = Bundle()
        bundle.putInt(TRACK_KEY, player.currentIndex)
        bundle.putDouble(POSITION_KEY, player.position.toSeconds())
        emit(MusicEvents.PLAYBACK_QUEUE_ENDED, bundle)
    }

    @MainThread
    private fun observeEvents() {
        // Dedup flag: prevents PlaybackEndedWithReason from being emitted
        // twice for the same track (once from the playbackEnd flow and once
        // from the stateChange safety net).  Reset on every track transition.
        var hasEmittedPlaybackEnd = false

        scope.launch {
            var previousState: AudioPlayerState? = null
            event.stateChange.collect {
                emit(MusicEvents.PLAYBACK_STATE, getPlayerStateBundle(it))

                // Reset the dedup flag when a track begins playing.
                // For mid-queue transitions, audioItemTransition resets this.
                // For the last track (no audioItemTransition fires), this
                // PLAYING state is the only opportunity to clear the flag
                // so the ENDED safety net below can fire.
                if (it == AudioPlayerState.PLAYING) {
                    hasEmittedPlaybackEnd = false
                }

                if (it == AudioPlayerState.ENDED && player.nextItem == null) {
                    // Safety net: ExoPlayer does not fire onMediaItemTransition
                    // for the last track (androidx/media #1231), so no
                    // audioItemTransition event arrives. Emit PLAYBACK_ENDED_REASON
                    // here from the reliable stateChange path if the playbackEnd
                    // flow hasn't already delivered it.
                    if (!hasEmittedPlaybackEnd) {
                        hasEmittedPlaybackEnd = true
                        Bundle().apply {
                            putString("reason", PlaybackEndedReason.PLAYED_UNTIL_END.name)
                            putInt(TRACK_KEY, player.currentIndex)
                            putDouble(POSITION_KEY, player.position.toSeconds())
                            emit(MusicEvents.PLAYBACK_ENDED_REASON, this)
                        }
                    }
                    emitQueueEndedEvent()
                }

                // Detect stall: transition from PLAYING to BUFFERING means the buffer ran dry.
                // Suppress shortly after a seek — ExoPlayer transitions through BUFFERING on seek
                // and may briefly re-stall while filling the buffer at the new position.
                if (previousState == AudioPlayerState.PLAYING && it == AudioPlayerState.BUFFERING) {
                    val msSinceSeek = System.currentTimeMillis() - player.lastSeekTimeMs
                    if (player.lastSeekTimeMs == 0L || msSinceSeek > SEEK_STALL_SUPPRESSION_MS) {
                        Bundle().apply {
                            putInt(TRACK_KEY, player.currentIndex)
                            putDouble(POSITION_KEY, player.position.toSeconds())
                            emit(MusicEvents.PLAYBACK_STALLED, this)
                        }
                    }
                }

                // Buffer empty: any transition INTO BUFFERING from an active state.
                if (it == AudioPlayerState.BUFFERING && previousState?.isActive == true
                    && previousState != AudioPlayerState.BUFFERING) {
                    Bundle().apply {
                        putBoolean("isEmpty", true)
                        emit(MusicEvents.PLAYBACK_BUFFER_EMPTY, this)
                    }
                }

                // Buffer recovery: any transition OUT of BUFFERING to a ready/playing state.
                if (previousState == AudioPlayerState.BUFFERING &&
                    (it == AudioPlayerState.PLAYING || it == AudioPlayerState.READY)) {
                    Bundle().apply {
                        putBoolean("isEmpty", false)
                        emit(MusicEvents.PLAYBACK_BUFFER_EMPTY, this)
                    }
                }

                previousState = it
            }
        }

        scope.launch {
            event.audioItemTransition.collect {
                hasEmittedPlaybackEnd = false
                hasEmittedBufferFull = false

                // For auto-transitions (track naturally finished), emit
                // PLAYBACK_ENDED_REASON BEFORE PLAYBACK_ACTIVE_TRACK_CHANGED
                // using indices captured synchronously at the ExoPlayer callback.
                // Emitting both from this single collector guarantees ordering
                // (matches iOS: ended fires before track-changed).
                if (it is AudioItemTransitionReason.AUTO) {
                    hasEmittedPlaybackEnd = true
                    val endedIndex = it.previousIndex ?: player.previousIndex ?: player.currentIndex
                    Bundle().apply {
                        putString("reason", PlaybackEndedReason.PLAYED_UNTIL_END.name)
                        putInt(TRACK_KEY, endedIndex)
                        putDouble(POSITION_KEY, it.oldPosition.toSeconds())
                        emit(MusicEvents.PLAYBACK_ENDED_REASON, this)
                    }
                }

                if (it !is AudioItemTransitionReason.REPEAT) {
                    emitPlaybackTrackChangedEvents(
                        it.previousIndex ?: player.previousIndex,
                        it.currentIndex,
                        it.oldPosition.toSeconds()
                    )
                }
            }
        }

        scope.launch {
            event.bufferFull.collect { isFull ->
                if (isFull && !hasEmittedBufferFull) {
                    hasEmittedBufferFull = true
                    Bundle().apply {
                        putBoolean("isFull", true)
                        emit(MusicEvents.PLAYBACK_BUFFER_FULL, this)
                    }
                }
            }
        }

        scope.launch {
            event.onAudioFocusChanged.collect {
                Bundle().apply {
                    putBoolean(IS_FOCUS_LOSS_PERMANENT_KEY, it.isFocusLostPermanently)
                    putBoolean(IS_PAUSED_KEY, it.isPaused)
                    emit(MusicEvents.BUTTON_DUCK, this)
                }
            }
        }

        scope.launch {
            event.onPlayerActionTriggeredExternally.collect {
                when (it) {
                    is MediaSessionCallback.RATING -> {
                        Bundle().apply {
                            setRating(this, "rating", it.rating)
                            emit(MusicEvents.BUTTON_SET_RATING, this)
                        }
                    }

                    is MediaSessionCallback.SEEK -> {
                        Bundle().apply {
                            putDouble("position", it.positionMs.toSeconds())
                            emit(MusicEvents.BUTTON_SEEK_TO, this)
                        }
                    }

                    MediaSessionCallback.PLAY -> emit(MusicEvents.BUTTON_PLAY)
                    MediaSessionCallback.PAUSE -> emit(MusicEvents.BUTTON_PAUSE)
                    MediaSessionCallback.NEXT -> emit(MusicEvents.BUTTON_SKIP_NEXT)
                    MediaSessionCallback.PREVIOUS -> emit(MusicEvents.BUTTON_SKIP_PREVIOUS)
                    MediaSessionCallback.STOP -> emit(MusicEvents.BUTTON_STOP)
                    MediaSessionCallback.FORWARD -> {
                        Bundle().apply {
                            val interval = latestOptions?.getDouble(
                                FORWARD_JUMP_INTERVAL_KEY,
                                DEFAULT_JUMP_INTERVAL
                            ) ?: DEFAULT_JUMP_INTERVAL
                            putInt("interval", interval.toInt())
                            emit(MusicEvents.BUTTON_JUMP_FORWARD, this)
                        }
                    }

                    MediaSessionCallback.REWIND -> {
                        Bundle().apply {
                            val interval = latestOptions?.getDouble(
                                BACKWARD_JUMP_INTERVAL_KEY,
                                DEFAULT_JUMP_INTERVAL
                            ) ?: DEFAULT_JUMP_INTERVAL
                            putInt("interval", interval.toInt())
                            emit(MusicEvents.BUTTON_JUMP_BACKWARD, this)
                        }
                    }
                }
            }
        }

        scope.launch {
            event.onTimedMetadata.collect {
                val data = MetadataAdapter.fromMetadata(it)
                val bundle = Bundle().apply {
                    putParcelableArrayList(METADATA_PAYLOAD_KEY, ArrayList(data))
                }
                emit(MusicEvents.METADATA_TIMED_RECEIVED, bundle)

                // Coalesce all metadata formats into a single PLAYBACK_METADATA event.
                // Type-specific events could be added if consumers need to distinguish sources.
                val metadata = PlaybackMetadata.fromId3Metadata(it)
                    ?: PlaybackMetadata.fromIcy(it)
                    ?: PlaybackMetadata.fromVorbisComment(it)
                    ?: PlaybackMetadata.fromQuickTime(it)

                if (metadata != null) {
                    Bundle().apply {
                        putString("source", metadata.source)
                        putString("title", metadata.title)
                        putString("url", metadata.url)
                        putString("artist", metadata.artist)
                        putString("album", metadata.album)
                        putString("date", metadata.date)
                        putString("genre", metadata.genre)
                        emit(MusicEvents.PLAYBACK_METADATA, this)
                    }
                }
            }
        }

        scope.launch {
            event.onCommonMetadata.collect {
                val data = MetadataAdapter.fromMediaMetadata(it)
                val bundle = Bundle().apply {
                    putBundle(METADATA_PAYLOAD_KEY, data)
                }
                emit(MusicEvents.METADATA_COMMON_RECEIVED, bundle)
            }
        }

        scope.launch {
            event.playWhenReadyChange.collect {
                Bundle().apply {
                    putBoolean("playWhenReady", it.playWhenReady)
                    emit(MusicEvents.PLAYBACK_PLAY_WHEN_READY_CHANGED, this)
                }
            }
        }

        scope.launch {
            event.playbackError.collect {
                val bundle = getPlaybackErrorBundle()
                bundle.putDouble(POSITION_KEY, player.position.toSeconds())
                emit(MusicEvents.PLAYBACK_ERROR, bundle)
            }
        }

        scope.launch {
            event.positionChanged.collect {
                when (it) {
                    is PositionChangedReason.SEEK,
                    is PositionChangedReason.SEEK_FAILED -> {
                        // Only emit seek completed for user-initiated seeks.
                        // Skip/jump/load operations call exoPlayer.seekTo() internally,
                        // which fires DISCONTINUITY_REASON_SEEK, but those are not real seeks.
                        // lastSeekTimeMs is only set in BaseAudioPlayer.seek()/seekBy().
                        val msSinceSeek = System.currentTimeMillis() - player.lastSeekTimeMs
                        if (player.lastSeekTimeMs > 0 && msSinceSeek <= SEEK_EVENT_WINDOW_MS) {
                            Bundle().apply {
                                putDouble("position", it.newPosition.toSeconds())
                                putBoolean("didFinish", it is PositionChangedReason.SEEK)
                                emit(MusicEvents.PLAYBACK_SEEK_COMPLETED, this)
                            }
                        }
                    }
                    else -> {
                        Timber.d("Position changed: ${it::class.simpleName} from ${it.oldPosition} to ${it.newPosition}")
                    }
                }
            }
        }

        scope.launch {
            event.playbackEnd.collect { ev ->
                if (ev != null && !hasEmittedPlaybackEnd && ev.reason != PlaybackEndedReason.PLAYED_UNTIL_END) {
                    hasEmittedPlaybackEnd = true
                    Bundle().apply {
                        putString("reason", ev.reason.name)
                        putInt(TRACK_KEY, ev.trackIndex)
                        putDouble(POSITION_KEY, ev.positionMs.toSeconds())
                        emit(MusicEvents.PLAYBACK_ENDED_REASON, this)
                    }
                }
            }
        }
    }

    private fun getPlaybackErrorBundle(): Bundle {
        val bundle = Bundle()
        val error = playbackError
        if (error?.message != null) {
            bundle.putString("message", error.message)
        }
        if (error?.code != null) {
            bundle.putString("code", "android-" + error.code)
        }
        return bundle
    }

    @SuppressLint("VisibleForTests")
    @MainThread
    fun emit(event: String, data: Bundle? = null) {
        reactContext?.emitDeviceEvent(event, data?.let { Arguments.fromBundle(it) })
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
        return HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true)
    }

    @MainThread
    override fun onBind(intent: Intent?): IBinder? {
        val intentAction = intent?.action
        Timber.d("intentAction = $intentAction")
        return if (intentAction != null) {
            super.onBind(intent)
        } else {
            binder
        }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        val intentAction = intent?.action
        Timber.d("intentAction = $intentAction")
        return super.onUnbind(intent)
    }

    override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
        // Always request foreground start to prevent the notification from disappearing
        // unexpectedly on some devices.
        // See: https://github.com/androidx/media/issues/843#issuecomment-1860555950
        super.onUpdateNotification(session, true)
    }

    @MainThread
    override fun onTaskRemoved(rootIntent: Intent?) {
        onUnbind(rootIntent)
        Timber.d("isInitialized = ${::player.isInitialized}, appKilledPlaybackBehavior = $appKilledPlaybackBehavior")
        if (!::player.isInitialized) {
            mediaSession.release()
            return
        }

        when (appKilledPlaybackBehavior) {
            AppKilledPlaybackBehavior.PAUSE_PLAYBACK -> {
                Timber.d("Pausing playback - appKilledPlaybackBehavior = $appKilledPlaybackBehavior")
                player.pause()
            }
            AppKilledPlaybackBehavior.STOP_PLAYBACK_AND_REMOVE_NOTIFICATION -> {
                Timber.d("Killing service - appKilledPlaybackBehavior = $appKilledPlaybackBehavior")
                mediaSession.release()
                player.clear()
                player.stop()
                player.destroy()
                scope.cancel()
                stopForeground(STOP_FOREGROUND_REMOVE)
                // Because onStartCommand returns START_STICKY, Android schedules a
                // service restart after cleanup. exitProcess prevents the zombie restart.
                // See: https://github.com/androidx/media/issues/27#issuecomment-1456042326
                stopSelf()
                exitProcess(0)
            }

            else -> {}
        }
    }

    @SuppressLint("VisibleForTests")
    private fun selfWake(clientPackageName: String): Boolean {
        val reactActivity = reactContext?.currentActivity
        if (
            // When an external controller (e.g. Android Auto, system UI) connects while
            // the React activity is dead, we need to relaunch it so the JS bridge can
            // handle playback events. Requires SYSTEM_ALERT_WINDOW permission for
            // background activity starts.
            (reactActivity == null || reactActivity.isDestroyed)
            && Settings.canDrawOverlays(this)
        ) {
            val currentTime = System.currentTimeMillis()
            if (currentTime - lastWake < 100000) {
                return false
            }
            lastWake = currentTime
            // Defensive: getLaunchIntentForPackage returns null if the package has no
            // launcher activity (some OEM kiosk builds strip the launcher entry).
            // Bail rather than NPE the media service.
            val activityIntent = packageManager.getLaunchIntentForPackage(packageName)
                ?: return false
            activityIntent.data = Uri.parse("trackplayer://service-bound")
            activityIntent.action = Intent.ACTION_VIEW
            activityIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            var activityOptions = ActivityOptions.makeBasic()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                @Suppress("DEPRECATION")
                activityOptions = activityOptions.setPendingIntentBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                )
            }
            this.startActivity(activityIntent, activityOptions.toBundle())
            return true
        }
        return false
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession {
        Timber.d("${controllerInfo.packageName}")
        return mediaSession
    }

    @MainThread
    override fun onHeadlessJsTaskFinish(taskId: Int) {
        // Intentionally empty: the default implementation calls stopSelf(), which would
        // kill the media service. The service must stay alive for background playback.
    }

    // MARK: - Sleep Timer

    @MainThread
    fun setSleepTimer(seconds: Double) {
        // Cancel any existing timer
        sleepTimerJob?.cancel()
        if (sleepTimerFading) {
            sleepTimerOriginalVolume?.let { player.volume = it }
        }
        sleepTimerFading = false
        sleepTimerOriginalVolume = null

        if (seconds < 0) {
            // End of current track mode
            sleepTimerEndOfTrack = true
            sleepTimerEndTime = null
            startSleepTimerMonitor()
            emitSleepTimerChanged()
        } else {
            sleepTimerEndOfTrack = false
            sleepTimerEndTime = System.currentTimeMillis() + (seconds * 1000).toLong()
            startSleepTimerMonitor()
            emitSleepTimerChanged()
        }
    }

    @MainThread
    fun getSleepTimerInfo(): Bundle {
        return Bundle().apply {
            val endTime = sleepTimerEndTime
            if (sleepTimerEndOfTrack) {
                putString("endTime", null)
                putBoolean("endOfTrack", true)
                putBoolean("active", true)
            } else if (endTime != null) {
                putDouble("endTime", endTime / 1000.0)
                putBoolean("endOfTrack", false)
                putBoolean("active", true)
            } else {
                putString("endTime", null)
                putBoolean("endOfTrack", false)
                putBoolean("active", false)
            }
        }
    }

    @MainThread
    fun clearSleepTimer() {
        sleepTimerJob?.cancel()
        sleepTimerJob = null
        if (sleepTimerFading) {
            sleepTimerOriginalVolume?.let { player.volume = it }
        }
        sleepTimerEndTime = null
        sleepTimerEndOfTrack = false
        sleepTimerFading = false
        sleepTimerOriginalVolume = null
        emitSleepTimerChanged()
    }

    private fun startSleepTimerMonitor() {
        sleepTimerJob?.cancel()
        sleepTimerJob = scope.launch {
            while (isActive) {
                delay(1000)
                checkSleepTimer()
            }
        }
    }

    private fun checkSleepTimer() {
        if (!::player.isInitialized) return

        if (sleepTimerEndOfTrack) {
            // End of current track mode: check if remaining time <= 60s
            val duration = player.duration
            val position = player.position
            if (duration > 0 && position > 0) {
                val remainingMs = duration - position
                if (remainingMs <= 60_000) {
                    // Let the track finish naturally — don't pause, just clear the timer
                    // and wait for the track to end via queue-ended or track-changed events
                    sleepTimerJob?.cancel()
                    sleepTimerJob = null
                    sleepTimerEndOfTrack = false
                    sleepTimerEndTime = null

                    // Set up a watcher to pause after track naturally ends
                    scope.launch {
                        // Poll until track ends or position resets
                        while (isActive) {
                            delay(500)
                            val currentRemaining = player.duration - player.position
                            if (currentRemaining <= 500 || player.playerState == AudioPlayerState.ENDED) {
                                delay(500) // brief delay to let track finish cleanly
                                player.pause()
                                emit(MusicEvents.SLEEP_TIMER_COMPLETE, Bundle().apply {
                                    putBoolean("endOfTrack", true)
                                })
                                break
                            }
                        }
                    }
                    return
                }
            }
            return
        }

        val endTime = sleepTimerEndTime ?: return
        val now = System.currentTimeMillis()
        val remainingMs = endTime - now

        if (remainingMs <= 0) {
            // Timer expired — check if current track has < 60s remaining
            val duration = player.duration
            val position = player.position
            val trackRemainingMs = if (duration > 0 && position > 0) duration - position else Long.MAX_VALUE

            if (trackRemainingMs <= 60_000) {
                // Let the track finish naturally
                sleepTimerJob?.cancel()
                sleepTimerJob = null
                sleepTimerEndTime = null
                sleepTimerFading = false
                sleepTimerOriginalVolume?.let {
                    player.volume = it
                    sleepTimerOriginalVolume = null
                }

                scope.launch {
                    while (isActive) {
                        delay(500)
                        val currentRemaining = player.duration - player.position
                        if (currentRemaining <= 500 || player.playerState == AudioPlayerState.ENDED) {
                            delay(500)
                            player.pause()
                            emit(MusicEvents.SLEEP_TIMER_COMPLETE, Bundle().apply {
                                putBoolean("endOfTrack", false)
                            })
                            break
                        }
                    }
                }
                return
            }

            // Pause immediately
            player.pause()
            sleepTimerOriginalVolume?.let {
                player.volume = it
                sleepTimerOriginalVolume = null
            }
            sleepTimerEndTime = null
            sleepTimerFading = false
            sleepTimerJob?.cancel()
            sleepTimerJob = null
            emit(MusicEvents.SLEEP_TIMER_COMPLETE, Bundle().apply {
                putBoolean("endOfTrack", false)
            })
            return
        }

        // Volume fade: linearly reduce over last 30 seconds
        if (remainingMs <= 30_000) {
            if (!sleepTimerFading) {
                sleepTimerFading = true
                sleepTimerOriginalVolume = player.volume
            }
            val fraction = remainingMs.toFloat() / 30_000f
            player.volume = (sleepTimerOriginalVolume ?: 1f) * fraction
        }
    }

    private fun emitSleepTimerChanged() {
        emit(MusicEvents.SLEEP_TIMER_CHANGED, getSleepTimerInfo())
    }

    @MainThread
    override fun onDestroy() {
        // Always release the MediaLibrarySession, even if setupPlayer() never ran.
        // Media3 keeps a process-wide static map of live sessions keyed by ID
        // (SESSION_ID_TO_SESSION_MAP). If we don't release here, the next
        // onCreate() hits "Session ID must be unique. ID=TrackPlayer" at
        // MediaSession.<init>:782 — observed on Android 16 (SDK 36) where
        // tightened FGS lifecycle rules cause the system to recreate the
        // service before JS has had a chance to call setupPlayer().
        if (::mediaSession.isInitialized) {
            try {
                mediaSession.release()
            } catch (e: Throwable) {
                Timber.e(e, "Error releasing mediaSession")
            }
        }
        // fakePlayer is normally released inside setupPlayer() once the real
        // player is built. If we got destroyed before setupPlayer() ran, release
        // it here so we don't leak an ExoPlayer instance per service cycle.
        // ExoPlayer.release() is idempotent so a double-release is a no-op.
        if (::fakePlayer.isInitialized) {
            try {
                fakePlayer.release()
            } catch (e: Throwable) {
                Timber.e(e, "Error releasing fakePlayer")
            }
        }
        if (::player.isInitialized) {
            Timber.d("Destroying player")
            try {
                player.destroy()
            } catch (e: Throwable) {
                Timber.e(e, "Error destroying player")
            }
        }

        sleepTimerJob?.cancel()
        progressUpdateJob?.cancel()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    fun onMediaKeyEvent(intent: Intent?): Boolean? {
        val keyEvent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
        } else {
            intent?.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
        }

        if (keyEvent?.action == KeyEvent.ACTION_DOWN) {
            // Deduplicate: on well-behaved Android 13+ devices, media button
            // intents arrive at both onStartCommand and onMediaButtonEvent.
            // Skip if this exact press was already processed.
            if (keyEvent.downTime == lastMediaKeyDownTime &&
                keyEvent.keyCode == lastMediaKeyCode) {
                RemoteControlDiagnosticLog.log(
                    this,
                    "onMediaKeyEvent: deduped (keyCode=${keyEvent.keyCode})",
                )
                return true // already handled
            }
            lastMediaKeyDownTime = keyEvent.downTime
            lastMediaKeyCode = keyEvent.keyCode

            val resolved = when (keyEvent.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                    emit(MusicEvents.BUTTON_PLAY_PAUSE)
                    true
                }

                KeyEvent.KEYCODE_MEDIA_STOP -> {
                    emit(MusicEvents.BUTTON_STOP)
                    true
                }

                KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                    emit(MusicEvents.BUTTON_PAUSE)
                    true
                }

                KeyEvent.KEYCODE_MEDIA_PLAY -> {
                    emit(MusicEvents.BUTTON_PLAY)
                    true
                }

                KeyEvent.KEYCODE_MEDIA_NEXT -> {
                    emit(MusicEvents.BUTTON_SKIP_NEXT)
                    true
                }

                KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                    emit(MusicEvents.BUTTON_SKIP_PREVIOUS)
                    true
                }

                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD, KeyEvent.KEYCODE_MEDIA_STEP_FORWARD -> {
                    emit(MusicEvents.BUTTON_JUMP_FORWARD)
                    true
                }

                KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD, KeyEvent.KEYCODE_MEDIA_STEP_BACKWARD -> {
                    emit(MusicEvents.BUTTON_JUMP_BACKWARD)
                    true
                }

                else -> null
            }
            RemoteControlDiagnosticLog.log(
                this,
                "onMediaKeyEvent: keyCode=${keyEvent.keyCode} resolved=$resolved",
            )
            return resolved
        }
        return null
    }

    @MainThread
    inner class MusicBinder : Binder() {
        val service = this@MusicService
    }

    private inner class InnerMediaSessionCallback : MediaLibrarySession.Callback {
        // Only connection, playback-control, and media-button callbacks are implemented.
        // Browsing callbacks (onGetLibraryRoot, onGetChildren, etc.) are not yet needed
        // but should be added when full Android Auto library browsing support is built.

        override fun onDisconnected(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ) {
            emit(MusicEvents.CONNECTOR_DISCONNECTED, Bundle().apply {
                putString("package", controller.packageName)
            })
            super.onDisconnected(session, controller)
        }

        @OptIn(UnstableApi::class)
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ): MediaSession.ConnectionResult {
            Timber.d("${controller.packageName}")
            val isMediaNotificationController = session.isMediaNotificationController(controller)
            val isAutomotiveController = session.isAutomotiveController(controller)
            val isAutoCompanionController = session.isAutoCompanionController(controller)
            emit(MusicEvents.CONNECTOR_CONNECTED, Bundle().apply {
                putString("package", controller.packageName)
                putBoolean("isMediaNotificationController", isMediaNotificationController)
                putBoolean("isAutomotiveController", isAutomotiveController)
                putBoolean("isAutoCompanionController", isAutoCompanionController)
            })
            if (controller.packageName in arrayOf(
                    "com.android.systemui",
                    // https://github.com/googlesamples/android-media-controller
                    "com.example.android.mediacontroller",
                    // Android Auto
                    "com.google.android.projection.gearhead"
                )
            ) {
                // Try to relaunch the React activity so the JS bridge can handle events.
                // If that fails (no overlay permission or cooldown), fall back to starting
                // a headless JS task.
                if (!selfWake(controller.packageName)) {
                    onStartCommand(null, 0, 0)
                }
            }
            return if (
                isMediaNotificationController ||
                isAutomotiveController ||
                isAutoCompanionController
            ) {
                MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                    .setCustomLayout(customLayout)
                    .setAvailableSessionCommands(
                        sessionCommands
                            ?: MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
                    )
                    .setAvailablePlayerCommands(
                        playerCommands ?: MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
                    )
                    .build()
            } else {
                super.onConnect(session, controller)
            }
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            command: SessionCommand,
            args: Bundle
        ): ListenableFuture<SessionResult> {
            // System media controllers can deliver custom commands before the JS
            // layer has called setupPlayer(). Skip the action rather than crashing
            // on the lateinit `player`.
            if (::player.isInitialized) {
                player.forwardingPlayer.let {
                    when (command.customAction) {
                        CustomCommandButton.JUMP_BACKWARD.customAction -> { it.seekBack() }
                        CustomCommandButton.JUMP_FORWARD.customAction -> { it.seekForward() }
                        CustomCommandButton.NEXT.customAction -> { it.seekToNext() }
                        CustomCommandButton.PREVIOUS.customAction -> { it.seekToPrevious() }
                    }
                }
            }
            return super.onCustomCommand(session, controller, command, args)
        }


        override fun onMediaButtonEvent(
            session: MediaSession,
            controllerInfo: MediaSession.ControllerInfo,
            intent: Intent
        ): Boolean {
            val incomingKey = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
            else intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
            RemoteControlDiagnosticLog.log(
                this@MusicService,
                "onMediaButtonEvent action=${intent.action} controller=${controllerInfo.packageName} " +
                    "keyCode=${incomingKey?.keyCode} keyAction=${incomingKey?.action}",
            )
            return onMediaKeyEvent(intent) ?: super.onMediaButtonEvent(
                session,
                controllerInfo,
                intent
            )
        }

        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            isForPlayback: Boolean
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            emit(MusicEvents.PLAYBACK_RESUME, Bundle().apply {
                putString("package", controller.packageName)
                putBoolean("isForPlayback", isForPlayback)
            })
            return super.onPlaybackResumption(mediaSession, controller, isForPlayback)
        }

        override fun onSetRating(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            rating: Rating
        ): ListenableFuture<SessionResult> {
            Bundle().apply {
                setRating(this, "rating", rating)
                emit(MusicEvents.BUTTON_SET_RATING, this)
            }
            return super.onSetRating(session, controller, rating)
        }
    }

    private fun getPendingIntentFlags(): Int {
        return PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_CANCEL_CURRENT
    }

    companion object {
        const val STATE_KEY = "state"
        const val ERROR_KEY = "error"
        const val TRACK_KEY = "track"
        const val POSITION_KEY = "position"
        const val DURATION_KEY = "duration"
        const val BUFFERED_POSITION_KEY = "buffered"

        const val TASK_KEY = "TrackPlayer"

        const val MIN_BUFFER_KEY = "minBuffer"
        const val MAX_BUFFER_KEY = "maxBuffer"
        const val PLAY_BUFFER_KEY = "playBuffer"
        const val BACK_BUFFER_KEY = "backBuffer"

        const val FORWARD_JUMP_INTERVAL_KEY = "forwardJumpInterval"
        const val BACKWARD_JUMP_INTERVAL_KEY = "backwardJumpInterval"
        const val PROGRESS_UPDATE_EVENT_INTERVAL_KEY = "progressUpdateEventInterval"

        const val MAX_CACHE_SIZE_KEY = "maxCacheSize"

        const val ANDROID_OPTIONS_KEY = "android"

        const val APP_KILLED_PLAYBACK_BEHAVIOR_KEY = "appKilledPlaybackBehavior"
        const val AUDIO_OFFLOAD_KEY = "audioOffload"
        const val SHUFFLE_KEY = "shuffle"
        const val PAUSE_ON_INTERRUPTION_KEY = "alwaysPauseOnInterruption"
        const val AUTO_HANDLE_INTERRUPTIONS = "autoHandleInterruptions"
        const val ANDROID_AUDIO_CONTENT_TYPE = "androidAudioContentType"
        const val IS_FOCUS_LOSS_PERMANENT_KEY = "permanent"
        const val IS_PAUSED_KEY = "paused"

        const val HANDLE_NOISY = "androidHandleAudioBecomingNoisy"
        const val SKIP_SILENCE = "androidSkipSilence"
        const val WAKE_MODE = "androidWakeMode"

        const val DEFAULT_JUMP_INTERVAL = 15.0

        /** Window (ms) after a seek within which stall detection is suppressed. */
        const val SEEK_STALL_SUPPRESSION_MS = 100L
        /** Window (ms) after BaseAudioPlayer.seek()/seekBy() within which position
         *  discontinuity events are treated as user-initiated seeks. */
        const val SEEK_EVENT_WINDOW_MS = 100L
    }
}
