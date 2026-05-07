package com.ghenry22.substream2.auto

import androidx.media3.common.MediaItem
import androidx.media3.session.LibraryResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.SettableFuture
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SubstreamerAutoModule : Module() {

    companion object {
        var moduleInstance: SubstreamerAutoModule? = null
        // We use SettableFuture to hold the connection open while TS fetches data
        val pendingRequests = mutableMapOf<String, SettableFuture<LibraryResult<ImmutableList<MediaItem>>>>()

        fun requestDataFromTS(parentId: String, future: SettableFuture<LibraryResult<ImmutableList<MediaItem>>>) {
            pendingRequests[parentId] = future
            moduleInstance?.sendEvent("onCarRequestedData", mapOf("parentId" to parentId))
        }
    }

    override fun definition() = ModuleDefinition {
        Name("SubstreamerAuto")
        Events("onCarRequestedData")

        OnCreate {
            moduleInstance = this@SubstreamerAutoModule
        }

        AsyncFunction("provideChildrenData") { parentId: String, jsonData: String ->
            val future = pendingRequests.remove(parentId)
            
            if (future != null) {
                try {
                    val items = mutableListOf<MediaItem>()
                    // TODO: Parse the 'jsonData' string into Media3 MediaItems here
                    
                    // Fulfill the future to send data to the car
                    future.set(LibraryResult.ofItemList(items, null))
                } catch (e: Exception) {
                    future.setException(e)
                }
            }
        }
    }
}