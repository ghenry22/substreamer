package com.doublesymmetry.kotlinaudio.utils

import kotlinx.coroutines.*
import java.time.Duration
import java.time.Instant

/**
 * Helper that allows you to wait for eventual resolution.
 * Does waiting and polling in [Dispatchers.Default] thread.
 * @param maxDuration the duration during which the command will be retried after it fails exceptionally
 * @param assertionDispatcher the dispatcher to use for the assertion block (Main by default)
 * @param assertionBlock the block of code to execute (run your assertions here)
 */
suspend fun eventually(
    maxDuration: Duration? = Duration.ofSeconds(if (isCIEnv) 4 else 2),
    assertionDispatcher: CoroutineDispatcher = Dispatchers.Main,
    assertionBlock: () -> Unit,
) {
    withContext(Dispatchers.Default) {
        eventuallyImpl(maxDuration) {
            withContext(assertionDispatcher) {
                assertionBlock()
            }
        }
    }
}

/**
 * @param maxDuration the duration during which the command will be retried after it fails exceptionally
 * @param command     the logic that fails exceptionally while its assertions are not successful
 */
private suspend fun eventuallyImpl(maxDuration: Duration?, command: suspend () -> Unit) {
    val start: Instant = Instant.now()
    val max: Instant = start.plus(maxDuration)
    var failed: Boolean
    do {
        try {
            command()
            failed = false
        } catch (t: Throwable) {
            failed = true
            if (Instant.now().isBefore(max)) {
                // Try again after a short nap
                try {
                    delay(200)
                } catch (ignored: InterruptedException) {}
            } else {
                // Max duration has exceeded, it took too long to become consistent
                throw t
            }
        }
    } while (failed)
}
