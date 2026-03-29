/**
 * ExpandedPlayerView — full-screen immersive player for tablet landscape.
 *
 * Apple Music iPad-inspired layout:
 * - Left column (~45%): large cover art, track info, progress bar, transport controls
 * - Right column (~55%): queue list or lyrics placeholder with toggle
 * - Extracted-color gradient background
 * - Animated entrance/exit driven by `expandProgress` (0 = hidden, 1 = fully expanded)
 */

import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CachedImage } from './CachedImage';
import { MarqueeText } from './MarqueeText';
import { MoreOptionsButton } from './MoreOptionsButton';
import { PlaybackRateButton } from './PlaybackRateButton';
import { PlayerProgressBar } from './PlayerProgressBar';
import { QueueItemRow } from './QueueItemRow';
import { RepeatButton } from './RepeatButton';
import { ShuffleButton } from './ShuffleButton';
import { SkipIntervalButton } from './SkipIntervalButton';
import { ThemedAlert } from './ThemedAlert';
import { closeOpenRow } from './SwipeableRow';
import { useColorExtraction } from '../hooks/useColorExtraction';
import { mixHexColors } from '../utils/colors';
import { useIsStarred } from '../hooks/useIsStarred';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { toggleStar } from '../services/moreOptionsService';
import {
  clearQueue,
  retryPlayback,
  seekTo,
  shuffleQueue,
  skipToNext,
  skipToPrevious,
  skipToTrack,
  togglePlayPause,
} from '../services/playerService';
import { type Child } from '../services/subsonicService';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { createShareStore } from '../store/createShareStore';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playerStore } from '../store/playerStore';
import { tabletLayoutStore } from '../store/tabletLayoutStore';

const HERO_COVER_SIZE = 600;
const CONTENT_PADDING = 40;
const COLUMN_GAP = 32;

interface ExpandedPlayerViewProps {
  expandProgress: SharedValue<number>;
}

export function ExpandedPlayerView({
  expandProgress,
}: ExpandedPlayerViewProps) {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const insets = useSafeAreaInsets();
  const currentTrack = playerStore((s) => s.currentTrack);
  const currentTrackIndex = playerStore((s) => s.currentTrackIndex);
  const queue = playerStore((s) => s.queue);
  const playbackState = playerStore((s) => s.playbackState);
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const bufferedPosition = playerStore((s) => s.bufferedPosition);
  const error = playerStore((s) => s.error);
  const retrying = playerStore((s) => s.retrying);

  const showSkipInterval = playbackSettingsStore((s) => s.showSkipIntervalButtons);

  const isPlaying =
    playbackState === 'playing' || playbackState === 'buffering';
  const isBuffering =
    playbackState === 'buffering' || playbackState === 'loading';

  // Own color extraction for gradient background
  const { coverBackgroundColor, gradientOpacity: extractedGradientOpacity } =
    useColorExtraction(currentTrack?.coverArt, colors.background);

  // Darken the extracted color for a richer, moodier full-screen background
  const gradientStart = coverBackgroundColor
    ? mixHexColors(coverBackgroundColor, '#000000', 0.4)
    : colors.background;
  const gradientEnd = mixHexColors(colors.background, '#000000', 0.15);

  // Right panel mode: queue (default) or lyrics placeholder
  const [rightPanelMode, setRightPanelMode] = useState<'queue' | 'lyrics'>('queue');

  // Measure the art area so cover art fills available height
  const [artMaxSize, setArtMaxSize] = useState(0);
  const handleArtAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArtMaxSize(Math.floor(Math.min(width, height)));
  }, []);

  // --- Animated styles driven by expandProgress ---

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expandProgress.value, [0, 0.4], [0, 1], Extrapolation.CLAMP),
    pointerEvents: expandProgress.value > 0.05 ? 'auto' as const : 'none' as const,
  }));

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expandProgress.value, [0, 0.5], [0, 1], Extrapolation.CLAMP)
      * extractedGradientOpacity.value,
  }));

  const coverStyle = useAnimatedStyle(() => ({
    transform: [{
      scale: interpolate(expandProgress.value, [0.1, 1], [0.85, 1], Extrapolation.CLAMP),
    }],
    opacity: interpolate(expandProgress.value, [0.1, 0.5], [0, 1], Extrapolation.CLAMP),
  }));

  const toolbarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expandProgress.value, [0.3, 0.7], [0, 1], Extrapolation.CLAMP),
    transform: [{
      translateY: interpolate(expandProgress.value, [0.3, 0.7], [-15, 0], Extrapolation.CLAMP),
    }],
  }));

  const leftColumnStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expandProgress.value, [0.2, 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [{
      translateY: interpolate(expandProgress.value, [0.2, 0.6], [20, 0], Extrapolation.CLAMP),
    }],
  }));

  const rightColumnStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expandProgress.value, [0.35, 0.8], [0, 1], Extrapolation.CLAMP),
    transform: [{
      translateX: interpolate(expandProgress.value, [0.35, 0.8], [30, 0], Extrapolation.CLAMP),
    }],
  }));

  // --- Callbacks ---

  const handleCollapse = useCallback(() => {
    tabletLayoutStore.getState().setPlayerExpanded(false);
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    seekTo(seconds);
  }, []);

  const handleQueueItemPress = useCallback((index: number) => {
    skipToTrack(index);
  }, []);

  const handleQueueItemLongPress = useCallback((track: Child) => {
    moreOptionsStore.getState().show({ type: 'song', item: track }, 'playerexpanded');
  }, []);

  const handleClearQueue = useCallback(() => {
    alert(
      'Clear Queue',
      'This will stop playback and clear the queue.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearQueue },
      ],
    );
  }, []);

  const handleShareQueue = useCallback(() => {
    const ids = queue.map((t) => t.id);
    if (ids.length > 0) {
      createShareStore.getState().showQueue(ids);
    }
  }, [queue]);

  // --- Shuffle overlay ---
  const [shuffling, setShuffling] = useState(false);
  const shuffleOverlayOpacity = useSharedValue(0);
  const spinAnim = useSharedValue(0);

  const shuffleOverlayStyle = useAnimatedStyle(() => ({
    opacity: shuffleOverlayOpacity.value,
  }));

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(spinAnim.value, [0, 1], [0, 360])}deg` }],
  }));

  const handleShuffle = useCallback(async () => {
    if (shuffling) return;
    setShuffling(true);
    spinAnim.value = 0;

    shuffleOverlayOpacity.value = withTiming(1, { duration: 250 });
    spinAnim.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.linear }),
      -1,
    );

    const MIN_DISPLAY = 2000;
    await Promise.all([
      shuffleQueue(),
      new Promise<void>((r) => setTimeout(r, MIN_DISPLAY)),
    ]);

    cancelAnimation(spinAnim);
    shuffleOverlayOpacity.value = withTiming(0, { duration: 300 }, (finished) => {
      if (finished) runOnJS(setShuffling)(false);
    });
  }, [shuffling, shuffleOverlayOpacity, spinAnim]);

  // --- Queue rendering ---

  // Muted primary for active queue item — less jarring against the coloured background
  const queueColors = useMemo(() => ({
    ...colors,
    primary: mixHexColors(colors.primary, colors.textPrimary, 0.45),
  }), [colors]);

  const renderQueueItem = useCallback(
    ({ item, index }: { item: Child; index: number }) => (
      <QueueItemRow
        track={item}
        index={index}
        isActive={index === currentTrackIndex}
        colors={queueColors}
        onPress={handleQueueItemPress}
        onLongPress={handleQueueItemLongPress}
      />
    ),
    [currentTrackIndex, queueColors, handleQueueItemPress, handleQueueItemLongPress],
  );

  const keyExtractor = useCallback(
    (item: Child, index: number) => `${item.id}-${index}`,
    [],
  );

  if (!currentTrack) return null;

  // Build quality label from track metadata
  const qualityParts: string[] = [];
  if (currentTrack.suffix) qualityParts.push(currentTrack.suffix.toUpperCase());
  if (currentTrack.bitRate) qualityParts.push(`${currentTrack.bitRate} kbps`);
  const qualityLabel = qualityParts.join(' \u00b7 ') || null;

  // Album line: "Album Name · 2024"
  const albumParts: string[] = [];
  if (currentTrack.album) albumParts.push(currentTrack.album);
  if (currentTrack.year) albumParts.push(String(currentTrack.year));
  const albumLine = albumParts.join(' \u00b7 ') || null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, overlayStyle]}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Gradient background — emanates from the left (art side) */}
        <Animated.View
          style={[StyleSheet.absoluteFillObject, gradientAnimatedStyle]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={[gradientStart, gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.6 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        {/* Content */}
        <View style={[styles.content, {
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 16,
        }]}>
          {/* Toolbar */}
          <Animated.View style={[styles.toolbar, toolbarStyle]}>
            <Pressable
              onPress={handleCollapse}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Collapse player"
              style={({ pressed }) => [styles.collapseButton, pressed && styles.pressed]}
            >
              <Ionicons name="contract-outline" size={22} color={colors.textPrimary} />
              <Text style={[styles.collapseText, { color: colors.textPrimary }]}>
                Now Playing
              </Text>
            </Pressable>
          </Animated.View>

          {/* Two-column layout */}
          <View style={styles.columnsContainer}>
            {/* Left column — art + controls */}
            <Animated.View style={[styles.leftColumn, leftColumnStyle]}>
              {/* Art area — flex: 1 so cover fills available height */}
              <View style={styles.artArea} onLayout={handleArtAreaLayout}>
                {artMaxSize > 0 && (
                  <Animated.View
                    style={[
                      styles.coverWrap,
                      {
                        width: artMaxSize,
                        height: artMaxSize,
                      },
                      coverStyle,
                    ]}
                  >
                    <CachedImage
                      coverArtId={currentTrack.coverArt}
                      size={HERO_COVER_SIZE}
                      style={styles.coverImage}
                      resizeMode="cover"
                    />
                  </Animated.View>
                )}
              </View>

              {/* Track info */}
              <View style={styles.trackInfo}>
                <View style={styles.trackTitleRow}>
                  <View style={styles.trackTitleText}>
                    <MarqueeText style={[styles.trackTitle, { color: colors.textPrimary }]}>
                      {currentTrack.title}
                    </MarqueeText>
                  </View>
                  <MoreOptionsButton
                    onPress={() =>
                      moreOptionsStore.getState().show({ type: 'song', item: currentTrack }, 'playerexpanded')
                    }
                    color={colors.textPrimary}
                  />
                  <ExpandedFavoriteButton trackId={currentTrack.id} colors={colors} />
                </View>
                <Text
                  style={[styles.trackArtist, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {currentTrack.artist ?? 'Unknown Artist'}
                </Text>
                {albumLine && (
                  <Text
                    style={[styles.albumLine, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {albumLine}
                  </Text>
                )}
              </View>

              {/* Progress bar */}
              <View style={styles.progressSection}>
                <PlayerProgressBar
                  position={position}
                  duration={duration}
                  bufferedPosition={bufferedPosition}
                  colors={colors}
                  onSeek={handleSeek}
                  isBuffering={isBuffering}
                  error={error}
                  retrying={retrying}
                  onRetry={retryPlayback}
                />
              </View>

              {/* Transport controls */}
              <View style={styles.controls}>
                <View style={styles.controlSideLeft}>
                  <PlaybackRateButton />
                </View>

                <View style={[styles.transportControls, showSkipInterval && styles.transportControlsWide]}>
                  <Pressable
                    onPress={skipToPrevious}
                    hitSlop={12}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <Ionicons name="play-back" size={32} color={colors.textPrimary} />
                  </Pressable>

                  {showSkipInterval && (
                    <SkipIntervalButton direction="backward" size={32} />
                  )}

                  <Pressable
                    onPress={togglePlayPause}
                    style={({ pressed }) => [
                      styles.playPauseButton,
                      { backgroundColor: colors.textPrimary },
                      pressed && styles.playPausePressed,
                    ]}
                  >
                    {isBuffering ? (
                      <ActivityIndicator size="small" color={colors.background} />
                    ) : (
                      <Ionicons
                        name={isPlaying ? 'pause' : 'play'}
                        size={32}
                        color={colors.background}
                        style={!isPlaying ? styles.playIcon : undefined}
                      />
                    )}
                  </Pressable>

                  {showSkipInterval && (
                    <SkipIntervalButton direction="forward" size={32} />
                  )}

                  <Pressable
                    onPress={skipToNext}
                    hitSlop={12}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <Ionicons name="play-forward" size={32} color={colors.textPrimary} />
                  </Pressable>
                </View>

                <View style={styles.controlSideRight}>
                  <RepeatButton />
                </View>
              </View>

              {/* Quality badge */}
              {qualityLabel && (
                <Text style={[styles.qualityBadge, { color: colors.textSecondary }]}>
                  {qualityLabel}
                </Text>
              )}
            </Animated.View>

            {/* Right column — queue or lyrics */}
            <Animated.View style={[styles.rightColumn, rightColumnStyle]}>
              {rightPanelMode === 'queue' ? (
                <>
                  {/* Queue header */}
                  <View style={styles.queueHeaderRow}>
                    <Text style={[styles.queueHeaderText, { color: colors.textPrimary }]}>
                      Queue
                    </Text>
                    <View style={styles.queueActions}>
                      <ShuffleButton
                        onPress={handleShuffle}
                        disabled={shuffling || queue.length < 2}
                      />
                      <Pressable
                        onPress={handleShareQueue}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Share queue"
                        style={({ pressed }) => [
                          styles.queueActionButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons name="share-outline" size={18} color={colors.textPrimary} />
                      </Pressable>
                      <Pressable
                        onPress={handleClearQueue}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Clear queue"
                        style={({ pressed }) => [
                          styles.queueActionButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.clearButtonText, { color: colors.textPrimary }]}>
                          Clear
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Queue list */}
                  <View style={styles.queueList}>
                    <FlashList
                      data={queue}
                      renderItem={renderQueueItem}
                      keyExtractor={keyExtractor}
                      onScrollBeginDrag={closeOpenRow}
                      drawDistance={200}
                      showsVerticalScrollIndicator={false}
                    />
                  </View>
                </>
              ) : (
                /* Lyrics placeholder */
                <View style={styles.lyricsPlaceholder}>
                  <Ionicons name="musical-notes-outline" size={48} color={colors.textSecondary} />
                  <Text style={[styles.lyricsPlaceholderText, { color: colors.textSecondary }]}>
                    Lyrics coming soon
                  </Text>
                </View>
              )}

              {/* Bottom toggle: lyrics / queue */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleButtons}>
                  <Pressable
                    onPress={() => setRightPanelMode('lyrics')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Show lyrics"
                    style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed]}
                  >
                    <Ionicons
                      name="text"
                      size={22}
                      color={rightPanelMode === 'lyrics' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => setRightPanelMode('queue')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Show queue"
                    style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed]}
                  >
                    <Ionicons
                      name="list"
                      size={22}
                      color={rightPanelMode === 'queue' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          </View>
        </View>

        {/* Shuffle overlay */}
        {shuffling && (
          <Animated.View
            style={[styles.shuffleOverlay, shuffleOverlayStyle]}
            pointerEvents="auto"
          >
            <View style={[styles.shuffleCard, { backgroundColor: colors.card }]}>
              <Animated.View style={spinStyle}>
                <Ionicons name="shuffle" size={32} color={colors.primary} />
              </Animated.View>
              <Text style={[styles.shuffleText, { color: colors.textPrimary }]}>
                Shuffling\u2026
              </Text>
            </View>
          </Animated.View>
        )}
        <ThemedAlert {...alertProps} />
      </View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/*  Favorite button                                                    */
/* ------------------------------------------------------------------ */

const ExpandedFavoriteButton = memo(function ExpandedFavoriteButton({
  trackId,
  colors,
}: {
  trackId: string;
  colors: { red: string; textSecondary: string };
}) {
  const starred = useIsStarred('song', trackId);
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const handleToggle = useCallback(() => {
    toggleStar('song', trackId);
  }, [trackId]);

  return (
    <Pressable
      onPress={handleToggle}
      disabled={offlineMode}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={starred ? 'Remove from favorites' : 'Add to favorites'}
      style={({ pressed }) => [
        styles.favoriteButton,
        pressed && !offlineMode && styles.pressed,
        offlineMode && styles.disabled,
      ]}
    >
      <Ionicons
        name={starred ? 'heart' : 'heart-outline'}
        size={24}
        color={starred ? colors.red : colors.textSecondary}
      />
    </Pressable>
  );
});

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: CONTENT_PADDING,
    height: 48,
  },
  collapseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collapseText: {
    fontSize: 16,
    fontWeight: '600',
  },

  /* --- Two-column layout --- */
  columnsContainer: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: CONTENT_PADDING,
    gap: COLUMN_GAP,
  },
  leftColumn: {
    flex: 45,
  },
  rightColumn: {
    flex: 55,
  },

  /* --- Left column: art --- */
  artArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 14,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },

  /* --- Left column: track info --- */
  trackInfo: {
    marginTop: 20,
    marginBottom: 12,
  },
  trackTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  trackTitleText: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  trackArtist: {
    fontSize: 18,
    marginTop: 4,
  },
  albumLine: {
    fontSize: 14,
    marginTop: 4,
    opacity: 0.6,
  },

  /* --- Left column: progress --- */
  progressSection: {
    marginBottom: 16,
  },

  /* --- Left column: transport controls --- */
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  controlSideLeft: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  controlSideRight: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  transportControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
  },
  transportControlsWide: {
    gap: 20,
  },
  playPauseButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPausePressed: {
    opacity: 0.7,
  },
  playIcon: {
    marginLeft: 3,
  },

  favoriteButton: {
    padding: 4,
  },
  qualityBadge: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.5,
    letterSpacing: 0.3,
  },

  /* --- Right column: queue --- */
  queueHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
  },
  queueHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  queueActionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  clearButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  queueList: {
    flex: 1,
  },

  /* --- Right column: lyrics placeholder --- */
  lyricsPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  lyricsPlaceholderText: {
    fontSize: 16,
    fontWeight: '500',
  },

  /* --- Right column: toggle buttons --- */
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingVertical: 8,
  },
  toggleButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  toggleButton: {
    padding: 4,
  },

  /* --- Shuffle overlay --- */
  shuffleOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  shuffleCard: {
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
  },
  shuffleText: {
    fontSize: 16,
    fontWeight: '600',
  },

  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});
