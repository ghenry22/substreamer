/**
 * PlayerPanel — compact sidebar player for tablet wide layout.
 *
 * Shows cover art, track info, playback controls, progress bar, and
 * the play queue in a vertical layout sized for a ~1/3 screen panel.
 */

import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from './GradientBackground';
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
import { type ThemeColors } from '../constants/theme';
import { useIsStarred } from '../hooks/useIsStarred';
import { mixHexColors } from '../utils/colors';
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

const COVER_SIZE = 300;
const PADDING = 16;

export function PlayerPanel() {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const insets = useSafeAreaInsets();
  const currentTrack = playerStore((s) => s.currentTrack);
  const currentTrackIndex = playerStore((s) => s.currentTrackIndex);
  const queue = playerStore((s) => s.queue);
  const queueLoading = playerStore((s) => s.queueLoading);

  const handleSeek = useCallback((seconds: number) => {
    seekTo(seconds);
  }, []);

  const handleQueueItemPress = useCallback((index: number) => {
    skipToTrack(index);
  }, []);

  const handleQueueItemLongPress = useCallback((track: Child) => {
    moreOptionsStore.getState().show({ type: 'song', item: track }, 'playerpanel');
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

  const handleExpand = useCallback(() => {
    tabletLayoutStore.getState().setPlayerExpanded(true);
  }, []);

  // --- Shuffle overlay state ---
  const [shuffling, setShuffling] = useState(false);
  const overlayOpacity = useSharedValue(0);
  const spinAnim = useSharedValue(0);

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(spinAnim.value, [0, 1], [0, 360])}deg` }],
  }));

  const handleShuffle = useCallback(async () => {
    if (shuffling) return;
    setShuffling(true);
    spinAnim.value = 0;

    overlayOpacity.value = withTiming(1, { duration: 250 });
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
    overlayOpacity.value = withTiming(0, { duration: 300 }, (finished) => {
      if (finished) runOnJS(setShuffling)(false);
    });
  }, [shuffling, overlayOpacity, spinAnim]);

  // Muted primary for active queue item highlight
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

  if (!currentTrack) {
    // During queue replacement queueLoading is true while currentTrack is
    // momentarily null — show a loading placeholder so the SplitLayout
    // panel keeps its content instead of collapsing.
    if (queueLoading) {
      return (
        <GradientBackground style={{ flex: 1, paddingTop: insets.top }}>
          <View style={styles.loadingFallback}>
            <ActivityIndicator size="large" color={colors.textSecondary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading...
            </Text>
          </View>
        </GradientBackground>
      );
    }
    return null;
  }

  return (
    <GradientBackground style={{ paddingTop: insets.top }}>
      {/* Player controls */}
      <PanelHeader
          currentTrack={currentTrack}
          colors={colors}
          handleSeek={handleSeek}
          handleExpand={handleExpand}
      />

      {/* Fixed queue header */}
      {queue.length > 0 && (
        <View style={styles.queueSection}>
          <View style={styles.queueHeaderRow}>
            <Text style={[styles.queueHeader, { color: colors.textPrimary }]}>
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
        </View>
      )}

      {/* Scrollable queue list */}
      <View style={styles.queueList}>
        <FlashList
          data={queue}
          renderItem={renderQueueItem}
          keyExtractor={keyExtractor}
          onScrollBeginDrag={closeOpenRow}
          drawDistance={200}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      </View>

      {/* Shuffle overlay */}
      {shuffling && (
        <Animated.View
          style={[styles.shuffleOverlay, overlayAnimatedStyle]}
          pointerEvents="auto"
        >
          <View style={[styles.shuffleCard, { backgroundColor: colors.card }]}>
            <Animated.View style={spinStyle}>
              <Ionicons name="shuffle" size={32} color={colors.primary} />
            </Animated.View>
            <Text style={[styles.shuffleText, { color: colors.textPrimary }]}>
              Shuffling…
            </Text>
          </View>
        </Animated.View>
      )}
      <ThemedAlert {...alertProps} />
    </GradientBackground>
  );
}

/* ------------------------------------------------------------------ */
/*  Favorite button                                                    */
/* ------------------------------------------------------------------ */

const PanelFavoriteButton = memo(function PanelFavoriteButton({
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
        size={20}
        color={starred ? colors.red : colors.textSecondary}
      />
    </Pressable>
  );
});

/* ------------------------------------------------------------------ */
/*  Panel header: cover art, controls, queue heading                   */
/* ------------------------------------------------------------------ */

interface PanelHeaderProps {
  currentTrack: Child | null;
  colors: ThemeColors;
  handleSeek: (seconds: number) => void;
  handleExpand: () => void;
}

const PanelHeader = memo(function PanelHeader({
  currentTrack,
  colors,
  handleSeek,
  handleExpand,
}: PanelHeaderProps) {
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

  const marqueeStyle = useMemo(
    () => [styles.trackTitle, { color: colors.textPrimary }],
    [colors.textPrimary],
  );

  if (!currentTrack) return null;

  return (
    <View>
          {/* Panel toolbar */}
          <View style={styles.panelToolbar}>
            <Pressable
              onPress={handleExpand}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Expand player"
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Ionicons name="expand-outline" size={22} color={colors.textPrimary} />
            </Pressable>
            <MoreOptionsButton
              onPress={() =>
                moreOptionsStore.getState().show({ type: 'song', item: currentTrack }, 'playerpanel')
              }
              color={colors.textPrimary}
            />
          </View>

          {/* Cover art */}
          <View style={styles.coverSection}>
            <View style={styles.coverWrap}>
              <CachedImage
                coverArtId={currentTrack.coverArt}
                size={COVER_SIZE}
                style={styles.coverImage}
                resizeMode="cover"
              />
            </View>
          </View>

          {/* Track info */}
          <View style={styles.trackInfo}>
            <View style={styles.trackInfoRow}>
              <View style={styles.trackInfoText}>
                <MarqueeText style={marqueeStyle}>
                  {currentTrack.title}
                </MarqueeText>
                <Text
                  style={[styles.trackArtist, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {currentTrack.artist ?? 'Unknown Artist'}
                </Text>
              </View>
              <PanelFavoriteButton trackId={currentTrack.id} colors={colors} />
            </View>
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

          {/* Playback controls */}
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
                <Ionicons name="play-back" size={24} color={colors.textPrimary} />
              </Pressable>

              {showSkipInterval && (
                <SkipIntervalButton direction="backward" size={22} />
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
                    size={24}
                    color={colors.background}
                    style={!isPlaying ? styles.playIcon : undefined}
                  />
                )}
              </Pressable>

              {showSkipInterval && (
                <SkipIntervalButton direction="forward" size={22} />
              )}

              <Pressable
                onPress={skipToNext}
                hitSlop={12}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Ionicons name="play-forward" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.controlSideRight}>
              <RepeatButton />
            </View>
          </View>

    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 14,
    marginTop: 12,
  },
  queueList: {
    flex: 1,
  },
  panelToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: PADDING,
    paddingTop: 8,
    paddingBottom: 4,
  },
  coverSection: {
    paddingHorizontal: PADDING,
    paddingBottom: 16,
    alignItems: 'center',
  },
  coverWrap: {
    width: 240,
    height: 240,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  trackInfo: {
    paddingHorizontal: PADDING,
    marginBottom: 8,
  },
  trackInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackInfoText: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  trackArtist: {
    fontSize: 13,
    marginTop: 2,
  },
  favoriteButton: {
    paddingLeft: 8,
    paddingVertical: 4,
  },
  progressSection: {
    paddingHorizontal: PADDING,
    marginBottom: 4,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: PADDING,
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
    gap: 20,
  },
  transportControlsWide: {
    gap: 14,
  },
  playPauseButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPausePressed: {
    opacity: 0.7,
  },
  playIcon: {
    marginLeft: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
  queueSection: {
    paddingHorizontal: PADDING,
    paddingTop: 4,
  },
  queueHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  queueHeader: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
});
