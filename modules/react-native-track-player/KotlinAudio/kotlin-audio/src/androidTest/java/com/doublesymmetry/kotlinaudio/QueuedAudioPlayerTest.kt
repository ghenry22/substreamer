package com.doublesymmetry.kotlinaudio

import androidx.test.platform.app.InstrumentationRegistry
import com.doublesymmetry.kotlinaudio.models.AudioPlayerState
import com.doublesymmetry.kotlinaudio.models.CacheConfig
import com.doublesymmetry.kotlinaudio.models.RepeatMode.*
import com.doublesymmetry.kotlinaudio.players.QueuedAudioPlayer
import com.doublesymmetry.kotlinaudio.utils.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import java.time.Duration
import java.util.concurrent.TimeUnit


class QueuedAudioPlayerTest {
    private lateinit var testPlayer: QueuedAudioPlayer
    private lateinit var states: MutableList<String>

    val tracks = listOf(
        TestSound.short,
        TestSound.fiveSeconds,
        TestSound.fiveSeconds2
    )

    @AfterEach
    fun afterEach() {
        runBlocking(Dispatchers.Main) {
            testPlayer.clear()
        }
    }

    @BeforeEach
    fun setUp(testInfo: TestInfo) {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        testPlayer = QueuedAudioPlayer(
            appContext,
            cacheConfig = CacheConfig(
                maxCacheSize = (1024 * 50).toLong(),
                identifier = testInfo.displayName
            )
        )
        runBlocking(Dispatchers.Main) {
            testPlayer.volume = 0f
        }
        states = mutableListOf()
        testPlayer.event.stateChange.map {
            if (
                // Skipping buffering and ready since it depends on circumstances when and how often
                // buffering occurs.
                it != AudioPlayerState.BUFFERING &&
                it != AudioPlayerState.READY &&
                // Also make sure we aren't adding duplicate states (due to skipping those above)
                (states.size == 0 || states.last() != it.toString())
            ) {
                states.add(it.toString())
            }
        }.stateIn(
            CoroutineScope(Dispatchers.Default),
            SharingStarted.Eagerly,
            emptyList<AudioPlayerState>()
        )
        testPlayer.event.stateChange.waitUntil { it == AudioPlayerState.IDLE }
    }

    @Nested
    inner class CurrentItem {
        @Test
        fun thenReturnNull() = runBlocking(Dispatchers.Main) {
            assertNull(testPlayer.currentItem)
        }

        @Test
        fun givenAddedFirstTrack_thenEqualsFirstTrack() = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks[0])

            assertEquals(tracks[0], testPlayer.currentItem)
        }

        @Test
        fun givenAddedOneItemAndLoadingAnother_thenShouldHaveReplacedCurrentItem() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.load(tracks[1])

                assertEquals(tracks[1], testPlayer.currentItem)
            }

        @Test
        fun givenAddedTwoItemAndMovingFirstAboveSecond_thenShouldHaveMovedItem() =
            runBlocking(Dispatchers.Main) {
                val appContext = InstrumentationRegistry.getInstrumentation().targetContext
                val audioPlayer = QueuedAudioPlayer(appContext)

                audioPlayer.add(tracks[0])
                audioPlayer.add(tracks[1])
                assertEquals(tracks[0], audioPlayer.items[0])
                assertEquals(tracks[0], audioPlayer.currentItem)
                audioPlayer.move(0, 1)
                assertEquals(audioPlayer.currentItem, audioPlayer.items[1])
                assertNotEquals(audioPlayer.currentItem, audioPlayer.items[0])
            }


        @Test
        fun givenAddedMultipleItems_thenCurrentItemIsFirstAddedItem() = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks[0])
            testPlayer.add(tracks[1])

            assertEquals(tracks[0], testPlayer.currentItem)
        }
    }

    @Nested
    inner class NextItems {
        @Test
        fun thenBeEmpty() = runBlocking(Dispatchers.Main) {
            assertTrue(testPlayer.nextItems.isEmpty())
        }

        @Test
        fun givenAddedTwoItems_thenShouldContainOneItem() = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks[0])
            testPlayer.add(tracks[1])

            assertEquals(1, testPlayer.nextItems.size)
        }

        @Test
        fun givenAddedTwoItemsAndCallingNext_thenShouldContainZeroItems() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                testPlayer.next()

                assertEquals(0, testPlayer.nextItems.size)
            }

        @Test
        fun givenAddedTwoItemsAndCallingNextAndPrevious_thenShouldContainOneItem() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                testPlayer.next()
                testPlayer.previous()

                assertEquals(1, testPlayer.nextItems.size)
            }

        @Test
        fun givenAddedTwoItemsAndRemovingLastItem_thenShouldBeEmpty() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                testPlayer.remove(1)

                assertTrue(testPlayer.nextItems.isEmpty())
            }

        @Test
        fun givenAddedTwoItemsAndJumpingToLast_thenShouldBeEmpty() = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks[0])
            testPlayer.add(tracks[1])
            testPlayer.jumpToItem(1)

            assertTrue(testPlayer.nextItems.isEmpty())
        }

        @Test
        fun givenAddedTwoItemsAndRemovingUpcomingItems_thenShouldBeEmpty() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                assertEquals(testPlayer.currentItem?.audioUrl, tracks[0].audioUrl)
                testPlayer.removeUpcomingItems()
                assertEquals(testPlayer.nextItems.size, 0)
                assertEquals(testPlayer.items.size, 1)
                assertEquals(testPlayer.currentItem?.title, tracks[0].title)
            }

        @Test
        fun givenAddedTwoItemsAndJumpingToSecondRemovingUpcomingItems_thenShouldBeEmpty() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                testPlayer.jumpToItem(1)
                testPlayer.removeUpcomingItems()
                assertEquals(testPlayer.nextItems.size, 0)
                assertEquals(testPlayer.items.size, 2)
                assertEquals(testPlayer.currentItem?.title, tracks[1].title)
            }

        @Test
        fun givenAddedThreeItemsRemovingUpcomingItems_thenShouldBeEmpty() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                testPlayer.add(tracks[2])
                testPlayer.removeUpcomingItems()
                assertEquals(testPlayer.nextItems.size, 0)
                assertEquals(testPlayer.items.size, 1)
                assertEquals(testPlayer.currentItem?.title, tracks[0].title)
            }

        @Test
        fun givenAddedThreeItemsAndSkippingToSecondAndRemovingUpcomingItems_thenShouldBeEmpty() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                testPlayer.add(tracks[2])
                testPlayer.jumpToItem(1)
                testPlayer.removeUpcomingItems()
                assertEquals(testPlayer.nextItems.size, 0)
                assertEquals(testPlayer.items.size, 2)
                assertEquals(testPlayer.currentItem?.title, tracks[1].title)
            }

        @Test
        fun giveNoItems_thenShouldBeEmpty() = runBlocking(Dispatchers.Main) {
            testPlayer.add(emptyList())
            testPlayer.removeUpcomingItems()
            assertEquals(testPlayer.nextItems.size, 0)
        }

        @Test
        fun givenAddedTwoItemsAndStopping_thenShouldStillBeOne() = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks[0])
            testPlayer.add(tracks[1])
            testPlayer.stop()

            assertEquals(1, testPlayer.nextItems.size)
        }
    }

    @Nested
    inner class PreviousItems {
        @Test
        fun thenShouldBeEmpty() = runBlocking(Dispatchers.Main) {
            assertTrue(testPlayer.previousItems.isEmpty())
        }

        @Test
        fun givenAddedTwoItems_thenShouldBeEmpty() = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks[0])
            testPlayer.add(tracks[1])

            assertEquals(0, testPlayer.previousItems.size)
        }

        @Test
        fun givenAddedTwoItemsAndCallingNext_thenShouldHaveOneItem() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                testPlayer.next()

                assertEquals(1, testPlayer.previousItems.size)
            }

        @Test
        fun givenAddedTwoItemsSkippingToSecondItemAndSeekingToThreeSecondsAndCallingPrevious_thenShouldHaveOneItem() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[1])
                testPlayer.add(tracks[2])
                testPlayer.jumpToItem(1)
                testPlayer.seek(3000, TimeUnit.MILLISECONDS)
                testPlayer.play()
                eventually(Duration.ofSeconds(30), Dispatchers.Main, fun () {
                    assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    assertTrue(testPlayer.position > 3000)
                    assertEquals(1, testPlayer.previousItems.size)
                })
                testPlayer.previous()
                eventually(Duration.ofSeconds(30), Dispatchers.Main, fun () {
                    assertEquals(testPlayer.currentIndex, 0)
                    assertEquals(0, testPlayer.previousItems.size)
                })
            }

        @Test
        fun givenAddedTwoItemsAndRemovedPreviousItems_thenShouldBeEmpty() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                testPlayer.next()
                testPlayer.removePreviousItems()

                assertTrue(testPlayer.previousItems.isEmpty())
            }

        @Test
        fun givenAddedTwoItemsAndStoppingAfterJumpingToSecondItem_thenShouldStillBeOne() = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks[0])
            testPlayer.add(tracks[1])
            assertEquals(0, testPlayer.previousItems.size)

            testPlayer.jumpToItem(1)
            assertEquals(1, testPlayer.previousItems.size)

            testPlayer.stop()

            assertEquals(1, testPlayer.previousItems.size)
        }
    }

    @Nested
    inner class OnNext {
        @Test
        fun givenPlayerIsPlayingAndCallingNext_thenShouldGoToNextAndPlay() =
            runBlocking(Dispatchers.Main) {
                testPlayer.play()
                testPlayer.add(listOf(TestSound.short, TestSound.long))
                testPlayer.next()

                eventually(Duration.ofSeconds(30), Dispatchers.Main, fun () {
                    assertEquals(1, testPlayer.previousItems.size)
                    assertEquals(0, testPlayer.nextItems.size)
                    assertEquals(TestSound.long, testPlayer.currentItem)
                    assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                })
            }

        @Test
        fun givenPlayerIsPausedAndCallingNext_thenShouldGoToNextAndNotPlay() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(listOf(TestSound.short, TestSound.long))
                testPlayer.next()

                eventually(Duration.ofSeconds(30), Dispatchers.Main, fun () {
                    assertEquals(1, testPlayer.previousItems.size)
                    assertEquals(0, testPlayer.nextItems.size)
                    assertEquals(TestSound.long, testPlayer.currentItem)
                    assertEquals(AudioPlayerState.READY, testPlayer.playerState)
                })
            }
    }

    @Nested
    inner class OnPrevious {
        @Test
        fun givenPlayerIsPlayingAndCallingPrevious_thenShouldGoToPreviousAndPlay() =
            runBlocking(Dispatchers.Main) {
                var first = TestSound.fiveSeconds
                var second = TestSound.short
                testPlayer.play()
                testPlayer.add(listOf(first, second))
                assertEquals(first, testPlayer.currentItem)
                testPlayer.next()
                assertEquals(second, testPlayer.currentItem)
                testPlayer.previous()
                assertEquals(first, testPlayer.currentItem)
                testPlayer.seekAndWaitForNextTrackTransition(4.5.toLong(), TimeUnit.SECONDS)
                eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                    assertEquals(1, testPlayer.previousItems.size)
                    assertEquals(0, testPlayer.nextItems.size)
                    assertEquals(second, testPlayer.currentItem)
                    assertEquals(AudioPlayerState.ENDED, testPlayer.playerState)
                })
            }

        @Test
        fun givenPlayerIsPausedAndCallingPrevious_thenShouldGoToPreviousAndNotPlay() =
            runBlocking(Dispatchers.Main) {
                testPlayer.pause()
                testPlayer.add(listOf(TestSound.short, TestSound.long))
                testPlayer.next()
                assertEquals(TestSound.long, testPlayer.currentItem)
                testPlayer.previous()
                eventually(Duration.ofSeconds(30), Dispatchers.Main, fun () {
                    assertEquals(0, testPlayer.previousItems.size)
                    assertEquals(1, testPlayer.nextItems.size)
                    assertEquals(testPlayer.currentItem, TestSound.short)
                    assertEquals(AudioPlayerState.READY, testPlayer.playerState)
                })
            }
    }

    @Nested
    inner class RepeatMode {
        @Nested
        inner class Off {
            @Test
            fun givenAddedTwoItemsAndAllowingPlaybackToEnd_whenRepeatModeOff_thenShouldMoveToNextItemAndPlay() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.fiveSeconds2, TestSound.fiveSeconds))
                    testPlayer.playerOptions.repeatMode = OFF
                    testPlayer.seekAndWaitForNextTrackTransition(4.5.toLong(), TimeUnit.SECONDS)
                    testPlayer.play()

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.fiveSeconds, testPlayer.currentItem)
                        assertEquals(mutableListOf<String>("IDLE", "LOADING", "PLAYING", "LOADING", "PLAYING"), states);
                    })
                }

            // TODO: Fix known bug from: https://github.com/doublesymmetry/react-native-track-player/pull/1501
            @Test
            fun givenAddedTwoItemsAndAllowingPlaybackToEndTwice_whenRepeatModeOff_thenShouldStopPlayback() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.short, TestSound.short))
                    testPlayer.playerOptions.repeatMode = OFF
                    testPlayer.seekAndWaitForNextTrackTransition(0.0682.toLong(), TimeUnit.SECONDS)
                    testPlayer.seekAndWaitForNextTrackTransition(0.0682.toLong(), TimeUnit.SECONDS)

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.short, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.ENDED, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedTwoItemsAndCallingNext_whenRepeatModeOff_thenShouldMoveToNextItemAndPlay() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.short, TestSound.long))
                    testPlayer.playerOptions.repeatMode = OFF
                    testPlayer.nextAndWaitForNextTrackTransition()

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.long, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedTwoItemsAndCallingNextTwice_thenShouldDoNothingOnSecondNext() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.short, TestSound.fiveSeconds))
                    testPlayer.playerOptions.repeatMode = OFF
                    testPlayer.nextAndWaitForNextTrackTransition()
                    testPlayer.next()

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.fiveSeconds, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedOneItemAndAllowingPlaybackToEnd_thenShouldStopPlayback() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(TestSound.short)
                    testPlayer.playerOptions.repeatMode = OFF
                    testPlayer.seekAndWaitForNextTrackTransition(0.0682.toLong(), TimeUnit.SECONDS)

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.short, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.ENDED, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedOneItemAndCallingNext_thenShouldDoNothing() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.add(TestSound.fiveSeconds, true)
                    testPlayer.playerOptions.repeatMode = OFF
                    testPlayer.nextAndWaitForNextTrackTransition()

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.fiveSeconds, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }
        }

        @Nested
        inner class One {

            @Test
            fun givenAddedTwoItemsAndAllowingPlaybackToEnd_whenRepeatModeOne_thenShouldRestartCurrentItem() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.fiveSeconds, TestSound.fiveSeconds2))
                    testPlayer.playerOptions.repeatMode = ONE
                    testPlayer.seekAndWaitForNextTrackTransition(
                        4.toLong(),
                        TimeUnit.SECONDS
                    )
                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertEquals(1, testPlayer.nextItems.size)
                        assertEquals(0, testPlayer.currentIndex)
                        assertEquals(
                            mutableListOf<String>(
                                "IDLE",
                                "LOADING",
                                "PLAYING",
                                "LOADING",
                                "PLAYING"
                            ), states
                        );
                    })
                }

            @Test
            fun givenAddedTwoItemsAndCallingNext_whenRepeatModeOne_thenShouldMoveToNextItemAndPlay() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.short, TestSound.long))
                    testPlayer.playerOptions.repeatMode = ONE
                    testPlayer.nextAndWaitForNextTrackTransition()

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.long, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedOneItemAndAllowingPlaybackToEnd_whenRepeatModeOne_thenShouldRestartCurrentItem() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(TestSound.fiveSeconds)
                    testPlayer.playerOptions.repeatMode = ONE
                    testPlayer.seekAndWaitForNextTrackTransition(
                        4.5.toLong(),
                        TimeUnit.SECONDS
                    )

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertEquals(
                            mutableListOf<String>(
                                "IDLE",
                                "LOADING",
                                "PLAYING",
                                "LOADING",
                                "PLAYING"
                            ), states
                        );
                        assertEquals(0, testPlayer.nextItems.size)
                        assertEquals(0, testPlayer.currentIndex)
                    })
                }

            @Test
            fun givenAddedTwoItemsAllowingToPlayTillEnd_whenRepeatModeOne_thenShouldRestartFirstItem() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(TestSound.fiveSeconds)
                    testPlayer.add(TestSound.fiveSeconds2)
                    assertEquals(0, testPlayer.currentIndex)
                    testPlayer.playerOptions.repeatMode = ONE

                    launchWithTimeoutSync(this) {
                        testPlayer.event.stateChange
                            .waitUntil { it == AudioPlayerState.PLAYING }
                            .collect {
                                testPlayer.seek(4500, TimeUnit.MILLISECONDS)
                            }
                    }

                    launchWithTimeoutSync(this) {
                        testPlayer.event.stateChange
                            .waitUntil { it == AudioPlayerState.PLAYING }
                            .collect { testPlayer.stop() }
                    }

                    eventually(Duration.ofSeconds(10), Dispatchers.Main, fun() {
                        var expectedStates = mutableListOf<String>("IDLE", "LOADING", "PLAYING", "STOPPED")
                        assertEquals(expectedStates, states);
                    })
                    assertEquals(0, testPlayer.currentIndex)
                }

            @Test
            fun givenAddedTwoItemsAndCallingNext_whenRepeatModeOne_thenShouldBeAtSecondItem() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(TestSound.fiveSeconds)
                    testPlayer.add(TestSound.fiveSeconds2)
                    assertEquals(0, testPlayer.currentIndex)
                    testPlayer.playerOptions.repeatMode = ONE
                    testPlayer.nextAndWaitForNextTrackTransition()
                    assertEquals(1, testPlayer.currentIndex)
                }
        }

        @Nested
        inner class All {
            @Test
            fun givenAddedTwoItemsAndAllowingPlaybackToEnd_whenRepeatModeAll_thenShouldMoveToNextItemAndPlay() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.fiveSeconds, TestSound.long))
                    testPlayer.playerOptions.repeatMode = ALL
                    testPlayer.seekAndWaitForNextTrackTransition(
                        4.5.toLong(),
                        TimeUnit.SECONDS
                    )

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.long, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedTwoItemsAndAllowingPlaybackToEndTwice_whenRepeatModeAll_thenShouldMoveToFirstTrackAndPlay() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.long, TestSound.fiveSeconds))
                    testPlayer.playerOptions.repeatMode = ALL
                    testPlayer.nextAndWaitForNextTrackTransition()
                    testPlayer.seekAndWaitForNextTrackTransition(
                        4.5.toLong(),
                        TimeUnit.SECONDS
                    )

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                        assertEquals(1, testPlayer.nextItems.size)
                        assertEquals(TestSound.long, testPlayer.currentItem)
                    })
                }

            @Test
            fun givenAddedTwoItemsAndCallingNext_whenRepeatModeAll_thenShouldMoveToNextItemAndPlay() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.fiveSeconds, TestSound.fiveSeconds2))
                    testPlayer.playerOptions.repeatMode = ALL
                    testPlayer.nextAndWaitForNextTrackTransition()

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.nextItems.isEmpty())
                        assertEquals(TestSound.fiveSeconds2, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedTwoItemsAndCallingNextTwice_whenRepeatModeAll_thenShouldMoveToFirstTrackAndPlay() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(listOf(TestSound.fiveSeconds, TestSound.short))
                    testPlayer.playerOptions.repeatMode = ALL
                    testPlayer.nextAndWaitForNextTrackTransition()
                    testPlayer.nextAndWaitForNextTrackTransition()

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertEquals(1, testPlayer.nextItems.size)
                        assertEquals(TestSound.fiveSeconds, testPlayer.currentItem)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedOneItemAndAllowingPlaybackToEnd_whenRepeatModeAll_thenShouldRestartCurrentItem() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.playerOptions.repeatMode = ALL
                    testPlayer.add(TestSound.fiveSeconds)
                    testPlayer.seekAndWaitForNextTrackTransition(
                        4.5.toLong(),
                        TimeUnit.SECONDS
                    )

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.position < 4000 && testPlayer.position > 0)
                        assertEquals(0, testPlayer.nextItems.size)
                        assertEquals(0, testPlayer.currentIndex)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }

            @Test
            fun givenAddedOneItemAndCallingNext_whenRepeatModeAll_thenShouldRestartCurrentItem() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.play()
                    testPlayer.add(TestSound.fiveSeconds)
                    testPlayer.playerOptions.repeatMode = ALL
                    testPlayer.nextAndWaitForNextTrackTransition()

                    eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                        assertTrue(testPlayer.position > 0)
                        assertEquals(0, testPlayer.nextItems.size)
                        assertEquals(0, testPlayer.currentIndex)
                        assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                    })
                }
        }
    }

    @Nested
    inner class Add {

        @Test
        fun givenNoAddedItems_currentIndexIsZero() =
            runBlocking(Dispatchers.Main) {
                assertEquals(testPlayer.currentIndex, 0)
            }

        @Test
        fun givenAddedEmptyListOfItems_thenShouldBeEmpty() = runBlocking(Dispatchers.Main) {
            testPlayer.add(emptyList())
            assertEquals(0, testPlayer.items.size)
            assertEquals(0, testPlayer.currentIndex)
            assertEquals(null, testPlayer.currentItem)
        }

        @Test
        fun givenNoAddedItems_currentItemIsNull() =
            runBlocking(Dispatchers.Main) {
                assertNull(testPlayer.currentItem)
            }

        @Test
        fun givenAddedFirstItem_thenTheFirstAddedItemIsCurrent() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                    assertEquals(testPlayer.currentItem, tracks[0])
                assertEquals(testPlayer.currentIndex, 0)
            }

        @Test
        fun givenAddedSecondItem_thenTheFirstAddedItemIsCurrentAndTheSecondIsSecond() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(tracks[0])
                testPlayer.add(tracks[1])
                assertEquals(testPlayer.currentItem, tracks[0])
                assertEquals(testPlayer.currentIndex, 0)
                assertEquals(testPlayer.items[1], tracks[1])

            }

        @Nested
        inner class AtIndex {
            @Test
            fun givenAddedFirstItemAndAddedSecondAtIndexZero_thenSecondTrackIsFirstItem() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.add(tracks[0])
                    testPlayer.add(listOf(tracks[1]), 0)
                    assertEquals(tracks[0], testPlayer.currentItem)
                    assertEquals(1, testPlayer.currentIndex)
                    assertEquals(tracks[1], testPlayer.items[0])
                }

            @Test
            fun givenAddedFirstItemAndAddedTwoTracksAtIndexZero_thenSecondTrackIsFirstItem() =
                runBlocking(Dispatchers.Main) {
                    testPlayer.add(tracks[0])
                    testPlayer.add(listOf(tracks[1], tracks[2]), 0)
                    assertEquals(tracks[0], testPlayer.currentItem)
                    assertEquals(2, testPlayer.currentIndex)
                    assertEquals(tracks[1], testPlayer.items[0])
                    assertEquals(tracks[2], testPlayer.items[1])
                }
        }
    }

    @Nested
    inner class Load {
        @Test
        fun givenLoadedItemWithPlayWhenReady_thenThePlayerShouldStartPlaying() =
            runBlocking(Dispatchers.Main) {
                testPlayer.play()
                testPlayer.load(TestSound.fiveSeconds)
                eventually(Duration.ofSeconds(30), Dispatchers.Main, fun() {
                    assertEquals(AudioPlayerState.PLAYING, testPlayer.playerState)
                })
            }


        @Test
        fun givenLoadedItemWithoutAdding_thenItShouldAddAsFirst() = runBlocking(Dispatchers.Main) {
            testPlayer.load(TestSound.long)
            assertEquals(TestSound.long.audioUrl, testPlayer.currentItem?.audioUrl)
            assertEquals(testPlayer.currentIndex, 0)
            assertEquals(testPlayer.items.size, 1)
        }

        @Test
        fun givenAddedOneItemAndLoadingAnother_thenShouldHaveReplacedItem() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(TestSound.short)
                testPlayer.load(TestSound.long)

                assertEquals(TestSound.long.audioUrl, testPlayer.currentItem?.audioUrl)
            }

        @Test
        fun givenAddedTwoItemsAndJumpingToTheSecondLoadingAnother_thenShouldHaveReplacedSecondItem() =
            runBlocking(Dispatchers.Main) {
                testPlayer.add(TestSound.short)
                testPlayer.add(TestSound.fiveSeconds)
                testPlayer.jumpToItem(1)
                testPlayer.load(TestSound.long)

                assertEquals(testPlayer.currentItem?.audioUrl, TestSound.long.audioUrl)
                assertEquals(testPlayer.items[1].audioUrl, TestSound.long.audioUrl)
                assertEquals(testPlayer.currentIndex, 1)
            }
    }

    @Nested
    inner class Remove {

        @BeforeEach
        fun setUp(testInfo: TestInfo) = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks)
        }

        @Test
        fun givenAddedThreeItemsAndDeletingFirst_thenFirstItemShouldBeRemoved() =
            runBlocking(Dispatchers.Main) {
                testPlayer.remove(0)
                assertEquals(testPlayer.items.size, 2)
                assertEquals(testPlayer.items[0], tracks[1])
            }

        @Test
        fun givenAddedThreeItemsAndDeletingLast_thenFirstItemShouldBeRemoved() =
            runBlocking(Dispatchers.Main) {
                testPlayer.remove(2)
                assertEquals(2, testPlayer.items.size)
                assertEquals(testPlayer.items[0], tracks[0])
                assertEquals(testPlayer.items[1], tracks[1])
            }

        @Test
        fun givenAddedThreeItemsAndDeletingFirst_thenFirstItemShouldBeRemovedAndNextTrackBecomesCurrent() =
            runBlocking(Dispatchers.Main) {
                testPlayer.remove(0)
                assertEquals(2, testPlayer.items.size)
                assertEquals(0, testPlayer.currentIndex)
                assertEquals(testPlayer.currentItem, tracks[1])
            }

        @Test
        fun givenAddedThreeItemsAndJumpingToSecondAndDeletingSecond_thenSecondItemShouldBeRemovedAndNextTrackBecomesCurrent() =
            runBlocking(Dispatchers.Main) {
                testPlayer.jumpToItem(1)
                testPlayer.remove(1)
                assertEquals(2, testPlayer.items.size)
                assertEquals(1, testPlayer.currentIndex)
                assertEquals(tracks[2], testPlayer.currentItem)
            }

        @Test
        fun givenAddedThreeItemsAndJumpingToLastAndDeletingIt_thenLastTrackShouldBeRemovedAndFirstTrackBecomesCurrent() =
            runBlocking(Dispatchers.Main) {
                testPlayer.jumpToItem(2)
                testPlayer.remove(2)
                assertEquals(testPlayer.items.size, 2)
                assertEquals(0, testPlayer.currentIndex)
                assertEquals(tracks[0], testPlayer.currentItem)
            }

        @Test
        fun givenAddedThreeItemsAndRemovingWithIndexesInNonDescendingOrder_thenShouldDeleteCorrectItems() =
            runBlocking(Dispatchers.Main) {
                testPlayer.remove(listOf(0, 1))
                assertEquals(testPlayer.items.size, 1)
                assertEquals(tracks[2], testPlayer.items[0])
            }

        @Test
        fun givenAddedThreeItemsAndDeletingAll_thenShouldDeleteCorrectItems() =
            runBlocking(Dispatchers.Main) {
                testPlayer.remove(listOf(0, 1, 2))
                assertEquals(0, testPlayer.items.size)
                assertEquals(0, testPlayer.currentIndex)
                assertEquals(null, testPlayer.currentItem)
            }

        @Test
        fun givenAddedThreeItemsAndDeletingAll_thenPlayerStateShouldBecomeIDLE() =
            runBlocking(Dispatchers.Main) {
                testPlayer.remove(listOf(0, 1, 2))
                eventually(Duration.ofSeconds(30), Dispatchers.Main, fun () {
                    assertEquals(AudioPlayerState.IDLE, testPlayer.playerState)
                });
            }
    }

    @Nested
    inner class Move {

        @BeforeEach
        fun setUp(testInfo: TestInfo) = runBlocking(Dispatchers.Main) {
            testPlayer.add(tracks)
        }

        @Test
        fun givenAddedThreeItemsAndMovingFirstToSecond_thenFirstItemShouldBeAtSecondIndex() =
            runBlocking(Dispatchers.Main) {
                testPlayer.move(0, 1)
                assertEquals(testPlayer.items[0], tracks[1])
                assertEquals(testPlayer.items[1], tracks[0])
                assertEquals(testPlayer.currentItem, tracks[0])
                assertEquals(testPlayer.currentIndex, 1)
            }

        @Test
        fun givenAddedThreeItemsAndMovingSecondToFirst_thenSecnodItemShouldBeAtFirstIndex() =
            runBlocking(Dispatchers.Main) {
                testPlayer.move(1, 0)
                assertEquals(testPlayer.items[0], tracks[1])
                assertEquals(testPlayer.items[1], tracks[0])
                assertEquals(testPlayer.currentItem, tracks[0])
                assertEquals(testPlayer.currentIndex, 1)
            }

        @Test
        fun givenAddedThreeItemsAndMovingFirstToThird_thenFirstItemShouldBeAtThirdIndex() =
            runBlocking(Dispatchers.Main) {
                testPlayer.move(0, 2)
                assertEquals(testPlayer.items[0], tracks[1])
                assertEquals(testPlayer.items[1], tracks[2])
                assertEquals(testPlayer.items[2], tracks[0])
                assertEquals(testPlayer.currentItem, tracks[0])
                assertEquals(testPlayer.currentIndex, 2)
            }

        @Test
        fun givenAddedThreeItemsAndMovingFirstToIndexEqualToQueueSize_thenItemIsMovedToEndOfQueue() =
            runBlocking(Dispatchers.Main) {
                assertEquals(tracks[0], testPlayer.currentItem)
                testPlayer.move(0, testPlayer.items.size)
                assertEquals(3, testPlayer.items.size)
                assertEquals(tracks[1].title, testPlayer.items[0].title)
                assertEquals(tracks[2].title, testPlayer.items[1].title)
                assertEquals(tracks[0], testPlayer.items[2])
                assertEquals(tracks[0], testPlayer.currentItem)
            }

        @Test
        fun givenAddedThreeItemsAndMovingFirstToIndexGreaterThanQueueSize_thenItemIsMovedToEndOfQueue() =
            runBlocking(Dispatchers.Main) {
                assertEquals(tracks[0], testPlayer.currentItem)
                testPlayer.move(0, Int.MAX_VALUE)
                assertEquals(3, testPlayer.items.size)
                assertEquals(tracks[1].title, testPlayer.items[0].title)
                assertEquals(tracks[2].title, testPlayer.items[1].title)
                assertEquals(tracks[0], testPlayer.items[2])
                assertEquals(tracks[0], testPlayer.currentItem)
            }

        @Test
        fun givenAddedThreeItemsAndMovingFirstToNegativeIndex_thenShouldThrow() =
            runBlocking(Dispatchers.Main) {
                assertEquals(tracks[0], testPlayer.currentItem)
                var caughtError: IllegalArgumentException? = null;
                try {
                    testPlayer.move(0, -1)
                } catch (error: IllegalArgumentException) {
                    caughtError = error;
                }
                assertNotNull(caughtError)
            }
    }
}
