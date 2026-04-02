package com.doublesymmetry.kotlinaudio.players

import android.content.Context
import com.doublesymmetry.kotlinaudio.models.PlayerOptions

open class AudioPlayer(context: Context, playerConfig: PlayerOptions = PlayerOptions()): BaseAudioPlayer(context, playerConfig)