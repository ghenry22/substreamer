/**
 * PlayerView – full-screen "Now Playing" view.
 *
 * Slides up from the MiniPlayer and displays hero cover art with a
 * gradient background extracted from the artwork, playback controls,
 * a seekable progress bar, and the playback queue.
 */

import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CachedImage } from '../components/CachedImage';
import { MarqueeText } from '../components/MarqueeText';
import { PlaybackRateButton } from '../components/PlaybackRateButton';
import { PlayerProgressBar } from '../components/PlayerProgressBar';
import { RepeatButton } from '../components/RepeatButton';
import { ShuffleButton } from '../components/ShuffleButton';
import { QueueItemRow } from '../components/QueueItemRow';
import { closeOpenRow } from '../components/SwipeableRow';
import { useColorExtraction } from '../hooks/useColorExtraction';
import { useTheme } from '../hooks/useTheme';
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
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { playerStore } from '../store/playerStore';


const HERO_PADDING = 32;
const HERO_COVER_SIZE = 600;

export interface PlayerViewProps {
  /** Called to dismiss the player view. */
  onClose: () => void;
}

export function PlayerView({ onClose }: PlayerViewProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const currentTrack = playerStore((s) => s.currentTrack);
  const currentTrackIndex = playerStore((s) => s.currentTrackIndex);
  const playbackState = playerStore((s) => s.playbackState);
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const bufferedPosition = playerStore((s) => s.bufferedPosition);
  const queue = playerStore((s) => s.queue);
  const error = playerStore((s) => s.error);
  const retrying = playerStore((s) => s.retrying);
  const queueLoading = playerStore((s) => s.queueLoading);
  const marqueeScrolling = layoutPreferencesStore((s) => s.marqueeScrolling);

  const isPlaying =
    playbackState === 'playing' || playbackState === 'buffering';
  const isBuffering =
    playbackState === 'buffering' || playbackState === 'loading';

  const { coverBackgroundColor, gradientOpacity } = useColorExtraction(
    currentTrack?.coverArt,
    colors.background,
  );

  const gradientStart = coverBackgroundColor ?? colors.background;
  const gradientEnd = colors.background;

  const handleSeek = useCallback((seconds: number) => {
    seekTo(seconds);
  }, []);

  const handleQueueItemPress = useCallback((index: number) => {
    skipToTrack(index);
  }, []);

  const handleClearQueue = useCallback(() => {
    Alert.alert(
      'Clear Queue',
      'This will stop playback and clear the queue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            onClose();
            setTimeout(() => {
              clearQueue();
            }, 350);
          },
        },
      ],
    );
  }, [onClose]);

  // --- Shuffle overlay state ---
  const [shuffling, setShuffling] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  const handleShuffle = useCallback(async () => {
    if (shuffling) return;
    setShuffling(true);
    spinAnim.setValue(0);

    // Fade in overlay + start spinning icon
    Animated.timing(overlayOpacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    ).start();

    // Run shuffle + enforce minimum display time in parallel
    const MIN_DISPLAY = 1200;
    await Promise.all([
      shuffleQueue(),
      new Promise<void>((r) => setTimeout(r, MIN_DISPLAY)),
    ]);

    // Stop spin, fade out overlay
    spinAnim.stopAnimation();
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setShuffling(false));
  }, [shuffling, overlayOpacity, spinAnim]);

  const renderQueueItem = useCallback(
    ({ item, index }: { item: Child; index: number }) => (
      <QueueItemRow
        track={item}
        index={index}
        isActive={index === currentTrackIndex}
        colors={colors}
        onPress={handleQueueItemPress}
      />
    ),
    [currentTrackIndex, colors, handleQueueItemPress],
  );

  const keyExtractor = useCallback(
    (item: Child, index: number) => `${item.id}-${index}`,
    [],
  );

  const listHeader = useMemo(
    () => (
      <PlayerListHeader
        currentTrack={currentTrack}
        colors={colors}
        insets={insets}
        onClose={onClose}
        queueLoading={queueLoading}
        marqueeScrolling={marqueeScrolling}
        position={position}
        duration={duration}
        bufferedPosition={bufferedPosition}
        isBuffering={isBuffering}
        isPlaying={isPlaying}
        error={error}
        retrying={retrying}
        handleSeek={handleSeek}
        handleClearQueue={handleClearQueue}
        handleShuffle={handleShuffle}
        shuffling={shuffling}
        queueLength={queue.length}
      />
    ),
    [
      currentTrack,
      colors,
      insets,
      onClose,
      queueLoading,
      marqueeScrolling,
      position,
      duration,
      bufferedPosition,
      isBuffering,
      isPlaying,
      error,
      retrying,
      handleSeek,
      handleClearQueue,
      handleShuffle,
      shuffling,
      queue.length,
    ],
  );

  if (!currentTrack) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Gradient background */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.background }]} />
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { opacity: gradientOpacity }]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[gradientStart, gradientEnd]}
          locations={[0, 0.6]}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      <FlashList
        data={queue}
        renderItem={renderQueueItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        estimatedItemSize={60}
        onScrollBeginDrag={closeOpenRow}
        drawDistance={200}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      />

      {/* Shuffle overlay */}
      {shuffling && (
        <Animated.View
          style={[styles.shuffleOverlay, { opacity: overlayOpacity }]}
          pointerEvents="auto"
        >
          <View style={[styles.shuffleCard, { backgroundColor: colors.card }]}>
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: spinAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              }}
            >
              <Ionicons name="shuffle" size={32} color={colors.primary} />
            </Animated.View>
            <Text style={[styles.shuffleText, { color: colors.textPrimary }]}>
              Shuffling…
            </Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  List header (hero, controls, queue heading)                        */
/* ------------------------------------------------------------------ */

interface PlayerListHeaderProps {
  currentTrack: Child | null;
  colors: {
    textPrimary: string;
    textSecondary: string;
    primary: string;
    background: string;
    border: string;
  };
  insets: { top: number; bottom: number };
  onClose: () => void;
  queueLoading: boolean;
  marqueeScrolling: boolean;
  position: number;
  duration: number;
  bufferedPosition: number;
  isBuffering: boolean;
  isPlaying: boolean;
  error: string | null;
  retrying: boolean;
  handleSeek: (seconds: number) => void;
  handleClearQueue: () => void;
  handleShuffle: () => void;
  shuffling: boolean;
  queueLength: number;
}

const PlayerListHeader = memo(function PlayerListHeader({
  currentTrack,
  colors,
  insets,
  onClose,
  queueLoading,
  marqueeScrolling,
  position,
  duration,
  bufferedPosition,
  isBuffering,
  isPlaying,
  error,
  retrying,
  handleSeek,
  handleClearQueue,
  handleShuffle,
  shuffling,
  queueLength,
}: PlayerListHeaderProps) {
  if (!currentTrack) return null;

  return (
    <View style={{ paddingTop: insets.top }}>
      {/* Header bar */}
      <View style={styles.header}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [
            styles.closeButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name="chevron-down"
            size={28}
            color={colors.textPrimary}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textSecondary }]}>
          Now Playing
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {queueLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading...
          </Text>
        </View>
      ) : (
        <>
          {/* Hero cover art */}
          <View style={styles.hero}>
            <View style={styles.heroImageWrap}>
              <CachedImage
                coverArtId={currentTrack.coverArt}
                size={HERO_COVER_SIZE}
                style={styles.heroImage}
                resizeMode="cover"
              />
            </View>
          </View>

          {/* Track info */}
          <View style={styles.trackInfo}>
            {marqueeScrolling ? (
              <MarqueeText
                style={[styles.trackTitle, { color: colors.textPrimary }]}
              >
                {currentTrack.title}
              </MarqueeText>
            ) : (
              <Text
                style={[styles.trackTitle, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {currentTrack.title}
              </Text>
            )}
            <Text
              style={[styles.trackArtist, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {currentTrack.artist ?? 'Unknown Artist'}
            </Text>
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
            {/* Playback rate toggle */}
            <View style={styles.controlSideLeft}>
              <PlaybackRateButton />
            </View>

            {/* Transport controls */}
            <View style={styles.transportControls}>
              <Pressable
                onPress={skipToPrevious}
                hitSlop={12}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Ionicons
                  name="play-back"
                  size={32}
                  color={colors.textPrimary}
                />
              </Pressable>

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

              <Pressable
                onPress={skipToNext}
                hitSlop={12}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Ionicons
                  name="play-forward"
                  size={32}
                  color={colors.textPrimary}
                />
              </Pressable>
            </View>

            {/* Repeat toggle */}
            <View style={styles.controlSideRight}>
              <RepeatButton />
            </View>
          </View>

          {/* Queue section header */}
          {queueLength > 0 && (
            <View style={styles.queueSection}>
              <View style={styles.queueHeaderRow}>
                <Text
                  style={[styles.queueHeader, { color: colors.textSecondary }]}
                >
                  Queue
                </Text>
                <View style={styles.queueActions}>
                  <ShuffleButton
                    onPress={handleShuffle}
                    disabled={shuffling || queueLength < 2}
                  />
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
                    <Text
                      style={[
                        styles.clearButtonText,
                        { color: colors.textPrimary },
                      ]}
                    >
                      Clear
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        </>
      )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 48,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerSpacer: {
    width: 36,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 120,
  },
  loadingText: {
    fontSize: 16,
    marginTop: 16,
  },
  hero: {
    width: '100%',
    paddingHorizontal: HERO_PADDING,
    paddingTop: 8,
    paddingBottom: 24,
    alignItems: 'center',
  },
  heroImageWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
    // Shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  trackInfo: {
    paddingHorizontal: HERO_PADDING,
    marginBottom: 16,
  },
  trackTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  trackArtist: {
    fontSize: 16,
    marginTop: 4,
  },
  progressSection: {
    paddingHorizontal: HERO_PADDING,
    marginBottom: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: HERO_PADDING,
    marginBottom: 32,
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
    gap: 28,
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
  pressed: {
    opacity: 0.6,
  },
  queueSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  queueHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  queueHeader: {
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
    fontSize: 14,
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
