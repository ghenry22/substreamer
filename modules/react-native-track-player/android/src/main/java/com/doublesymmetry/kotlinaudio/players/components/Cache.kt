package com.doublesymmetry.kotlinaudio.players.components

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.DatabaseProvider
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

@UnstableApi
object Cache {
    @Volatile
    private var instance: SimpleCache? = null

    fun initCache(context: Context, sizeKb: Long): SimpleCache {
        // U6 Android sibling: removes the trailing `instance!!`. Capturing into
        // a local val makes the double-checked init explicit and gives the
        // Kotlin smart cast — no force-unwrap, no theoretical NPE if a race
        // were ever to slip past the @Volatile.
        instance?.let { return it }
        return synchronized(this) {
            instance?.let { return@synchronized it }
            val db: DatabaseProvider = StandaloneDatabaseProvider(context)
            val created = SimpleCache(
                File(context.cacheDir, "RNTP"),
                LeastRecentlyUsedCacheEvictor(
                    sizeKb * 1000 // kb to bytes
                ),
                db
            )
            instance = created
            created
        }
    }
}
