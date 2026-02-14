package com.doublesymmetry.kotlinaudio.utils

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

var isCIEnv = (System.getenv("CI") ?: "false") == "true"

/**
 * Launches a flow, executes block with a timeout and waits completion.
 */
suspend fun launchWithTimeoutSync(
    coroutineScope: CoroutineScope,
    timeout: Long = 1000,
    block: suspend CoroutineScope.() -> Unit
) {
    return coroutineScope.launch {
        withTimeout(timeout) {
            block()
        }
    }.join()
}

/**
 * Returns a flow that contains the first element that satisfies the given [predicate].
 */
fun <T> Flow<T>.waitUntil(predicate: suspend (T) -> Boolean): Flow<T> = transformWhile { value ->
    if (predicate(value)) {
        emit(value)
    }

    !predicate(value)
}
