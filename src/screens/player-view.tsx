/**
 * PlayerView – full-screen "Now Playing" view.
 *
 * Slides up from the MiniPlayer and displays hero cover art with a
 * gradient background extracted from the artwork, playback controls,
 * a seekable progress bar, and tabbed access to queue, album info,
 * and lyrics.
 */

import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AlbumInfoContent } from '../components/AlbumInfoContent';
import { LyricsContent } from '../components/LyricsContent';
import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { MarqueeText } from '../components/MarqueeText';
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { PlaybackRateButton } from '../components/PlaybackRateButton';
import { PlayerProgressBar } from '../components/PlayerProgressBar';
import { PlayerTabBar, PLAYER_TAB_BAR_HEIGHT, type PlayerTab } from '../components/PlayerTabBar';
import { RepeatButton } from '../components/RepeatButton';
import { ShuffleButton } from '../components/ShuffleButton';
import { SkipIntervalButton } from '../components/SkipIntervalButton';
import { SleepTimerButton } from '../components/SleepTimerButton';
import { SleepTimerCapsule } from '../components/SleepTimerCapsule';
import { QueueItemRow } from '../components/QueueItemRow';
import { closeOpenRow } from '../components/SwipeableRow';
import { type ThemeColors } from '../constants/theme';
import { useCanSkip } from '../hooks/useCanSkip';
import { useImagePalette } from '../hooks/useImagePalette';
import { useIsStarred } from '../hooks/useIsStarred';
import { useTheme } from '../hooks/useTheme';
import { ThemedAlert } from '../components/ThemedAlert';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { toggleStar } from '../services/moreOptionsService';
import { offlineModeStore } from '../store/offlineModeStore';
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
import { sanitizeBiographyText } from '../utils/formatters';
import { minDelay } from '../utils/stringHelpers';
import { type Child } from '../services/subsonicService';
import { albumInfoStore } from '../store/albumInfoStore';
import { lyricsStore } from '../store/lyricsStore';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { createShareStore } from '../store/createShareStore';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { playerStore } from '../store/playerStore';
import { mixHexColors } from '../utils/colors';


const HERO_PADDING = 32;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = Platform.OS === 'ios' ? 44 : 56;

const TAB_FADE_DURATION = 300;
const TAB_FADE_EASING = Easing.out(Easing.cubic);
const TAB_SLIDE_DISTANCE = 12;

/** Static content inset for the queue list — module-scope so FlashList isn't
 *  handed a fresh object on every parent re-render. */
const QUEUE_CONTENT_CONTAINER_STYLE = { paddingBottom: 12 } as const;

export function PlayerView() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { alert, alertProps } = useThemedAlert();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const router = useRouter();
  const currentTrack = playerStore((s) => s.currentTrack);
  const currentTrackIndex = playerStore((s) => s.currentTrackIndex);
  const queue = playerStore((s) => s.queue);
  const queueLoading = playerStore((s) => s.queueLoading);

  const onClose = useCallback(() => router.back(), [router]);

  // Auto-dismiss when the queue is externally cleared (e.g. offline mode
  // removes all non-downloaded tracks while this screen is open).
  const [wasPopulated, setWasPopulated] = useState(false);
  useEffect(() => {
    if (currentTrack) {
      setWasPopulated(true);
    } else if (wasPopulated) {
      onClose();
    }
  }, [currentTrack, wasPopulated, onClose]);

  const { primary, secondary, gradientOpacity } = useImagePalette(currentTrack?.coverArt);

  // 2-stop gradient: extracted secondary (prefer) → theme background. We
  // drop the more-vibrant `primary` from the render here because on small
  // phone screens it reads as too busy over the hero — `secondary` (the
  // most-common hue distinct from primary) is calmer. `primary` still
  // extracts and is available in the hook for future tablet/landscape
  // layouts that have more room for the richer bi-tone.
  const gradientTopColor = secondary ?? primary ?? colors.background;
  const gradientColors: readonly [string, string, ...string[]] = [gradientTopColor, colors.background];
  const gradientLocations: readonly [number, number, ...number[]] = [0, 0.6];

  const offlineMode = offlineModeStore((s) => s.offlineMode);

  /* ---- Tab state ---- */
  const [activeTab, setActiveTab] = useState<PlayerTab>('player');
  const [mountedTabs, setMountedTabs] = useState<Set<PlayerTab>>(() => new Set(['player']));



  // Ensure tab is mounted when selected
  useEffect(() => {
    if (!mountedTabs.has(activeTab)) {
      setMountedTabs((prev) => new Set(prev).add(activeTab));
    }
  }, [activeTab, mountedTabs]);

  /* ---- Tab crossfade animation ---- */
  const playerOpacity = useSharedValue(1);
  const queueOpacity = useSharedValue(0);
  const infoOpacity = useSharedValue(0);
  const lyricsOpacity = useSharedValue(0);

  const opacityMap = useMemo(() => ({
    player: playerOpacity,
    queue: queueOpacity,
    info: infoOpacity,
    lyrics: lyricsOpacity,
  }), [playerOpacity, queueOpacity, infoOpacity, lyricsOpacity]);

  useEffect(() => {
    const config = { duration: TAB_FADE_DURATION, easing: TAB_FADE_EASING };
    for (const [tab, opacity] of Object.entries(opacityMap)) {
      opacity.value = withTiming(tab === activeTab ? 1 : 0, config);
    }
  }, [activeTab, opacityMap]);

  // Track which tabs should be visible in the compositor. The active tab
  // is always visible; other tabs remain visible during their fade-out and
  // are hidden with `display: 'none'` once the fade completes. Without
  // this, the last-declared panel (Lyrics) keeps bleeding through whatever
  // tab is active — opacity alone doesn't remove a view from compositing.
  const [visibleTabs, setVisibleTabs] = useState<Set<PlayerTab>>(
    () => new Set([activeTab]),
  );
  useEffect(() => {
    setVisibleTabs((prev) => {
      if (prev.has(activeTab) && prev.size === 1) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
    const timer = setTimeout(() => {
      setVisibleTabs(new Set([activeTab]));
    }, TAB_FADE_DURATION + 50);
    return () => clearTimeout(timer);
  }, [activeTab]);

  const playerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: playerOpacity.value,
    transform: [{ translateY: interpolate(playerOpacity.value, [0, 1], [TAB_SLIDE_DISTANCE, 0]) }],
  }));
  const queueAnimatedStyle = useAnimatedStyle(() => ({
    opacity: queueOpacity.value,
    transform: [{ translateY: interpolate(queueOpacity.value, [0, 1], [TAB_SLIDE_DISTANCE, 0]) }],
  }));
  const infoAnimatedStyle = useAnimatedStyle(() => ({
    opacity: infoOpacity.value,
    transform: [{ translateY: interpolate(infoOpacity.value, [0, 1], [TAB_SLIDE_DISTANCE, 0]) }],
  }));
  const lyricsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: lyricsOpacity.value,
    transform: [{ translateY: interpolate(lyricsOpacity.value, [0, 1], [TAB_SLIDE_DISTANCE, 0]) }],
  }));

  /* ---- Header: dismiss button + more options ---- */
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    navigation.setOptions({
      headerLeft: () => (
        <GHPressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [{ opacity: 1 }, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-down" size={28} color={colors.textPrimary} />
        </GHPressable>
      ),
      headerRight: () =>
        currentTrack ? (
          <MoreOptionsButton
            onPress={() =>
              moreOptionsStore.getState().show({ type: 'song', item: currentTrack }, 'player')
            }
            color={colors.textPrimary}
          />
        ) : null,
    });
  }, [currentTrack, navigation, onClose, colors.textPrimary]);

  const handleSeek = useCallback((seconds: number) => {
    seekTo(seconds);
  }, []);

  const handleQueueItemPress = useCallback((index: number) => {
    skipToTrack(index);
  }, []);

  const handleQueueItemLongPress = useCallback((track: Child) => {
    moreOptionsStore.getState().show({ type: 'song', item: track }, 'player');
  }, []);

  const handleClearQueue = useCallback(() => {
    alert(
      t('clearQueue'),
      t('clearQueueMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clear'),
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
  const overlayOpacity = useSharedValue(0);
  const spinAnim = useSharedValue(0);

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

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

  const handleShareQueue = useCallback(() => {
    const ids = queue.map((t) => t.id);
    if (ids.length > 0) {
      createShareStore.getState().showQueue(ids);
    }
  }, [queue]);

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

  const queueListHeader = useMemo(
    () => (
      <QueueHeader
        colors={colors}
        handleClearQueue={handleClearQueue}
        handleShuffle={handleShuffle}
        handleShareQueue={handleShareQueue}
        shuffling={shuffling}
        queueLength={queue.length}
      />
    ),
    [colors, handleClearQueue, handleShuffle, handleShareQueue, shuffling, queue.length],
  );

  const headerTopPadding = Platform.OS === 'ios'
    ? insets.top + HEADER_BAR_HEIGHT
    : insets.top + HEADER_BAR_HEIGHT;
  const playerTabContentBottomPadding = PLAYER_TAB_BAR_HEIGHT + Math.max(insets.bottom, 16);

  if (!currentTrack) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="musical-notes-outline"
          title={t('nothingPlaying')}
          subtitle={t('nothingPlayingSubtitle')}
        />
      </View>
    );
  }

  return (
    <>
      {Platform.OS === 'ios' && (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="chevron.down" onPress={onClose} />
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon="ellipsis"
              onPress={() => moreOptionsStore.getState().show({ type: 'song', item: currentTrack! }, 'player')}
              hidden={!currentTrack}
            />
          </Stack.Toolbar>
        </>
      )}
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Gradient background */}
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.background }]} />
        <Animated.View
          style={[StyleSheet.absoluteFillObject, gradientAnimatedStyle]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={gradientColors}
            locations={gradientLocations}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        {/* Content area with tab switching */}
        <View style={styles.contentArea}>
          {/* Player tab — vertically centered across full area */}
          <Animated.View
            style={[
              styles.tabPanel,
              Platform.OS === 'android' && { top: headerTopPadding },
              !visibleTabs.has('player') && styles.hiddenTab,
              playerAnimatedStyle,
            ]}
            pointerEvents={activeTab === 'player' ? 'auto' : 'none'}
          >
            <ScrollView
              testID="player-scroll-view"
              style={styles.playerScrollView}
              contentContainerStyle={[
                styles.playerScrollContent,
                { paddingBottom: playerTabContentBottomPadding },
              ]}
              showsVerticalScrollIndicator={false}
              contentInsetAdjustmentBehavior="never"
            >
              <PlayerContent
                currentTrack={currentTrack}
                colors={colors}
                queueLoading={queueLoading}
                handleSeek={handleSeek}
              />
            </ScrollView>
          </Animated.View>

          {/* Queue tab — below header */}
          <Animated.View
            style={[
              styles.tabPanel,
              { top: headerTopPadding },
              !visibleTabs.has('queue') && styles.hiddenTab,
              queueAnimatedStyle,
            ]}
            pointerEvents={activeTab === 'queue' ? 'auto' : 'none'}
          >
            {mountedTabs.has('queue') && (
              <FlashList
                data={queue}
                renderItem={renderQueueItem}
                keyExtractor={keyExtractor}
                ListHeaderComponent={queueListHeader}
                onScrollBeginDrag={closeOpenRow}
                drawDistance={200}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={QUEUE_CONTENT_CONTAINER_STYLE}
              />
            )}
          </Animated.View>

          {/* Album Info tab — below header */}
          <Animated.View
            style={[
              styles.tabPanel,
              { top: headerTopPadding },
              !visibleTabs.has('info') && styles.hiddenTab,
              infoAnimatedStyle,
            ]}
            pointerEvents={activeTab === 'info' ? 'auto' : 'none'}
          >
            {mountedTabs.has('info') && (
              <AlbumInfoTab currentTrack={currentTrack} colors={colors} />
            )}
          </Animated.View>

          {/* Lyrics tab — below header */}
          <Animated.View
            style={[
              styles.tabPanel,
              { top: headerTopPadding },
              !visibleTabs.has('lyrics') && styles.hiddenTab,
              lyricsAnimatedStyle,
            ]}
            pointerEvents={activeTab === 'lyrics' ? 'auto' : 'none'}
          >
            {mountedTabs.has('lyrics') && currentTrack && (
              <LyricsTab currentTrack={currentTrack} colors={colors} />
            )}
          </Animated.View>
        </View>

        {/* Tab bar */}
        <View style={{ paddingBottom: insets.bottom }}>
          <PlayerTabBar activeTab={activeTab} onSelect={setActiveTab} colors={colors} offlineMode={offlineMode} />
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
                {t('shuffling')}
              </Text>
            </View>
          </Animated.View>
        )}
      </View>
      <ThemedAlert {...alertProps} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Favorite button                                                    */
/* ------------------------------------------------------------------ */

const FavoriteButton = memo(function FavoriteButton({
  trackId,
  colors,
}: {
  trackId: string;
  colors: { red: string; textSecondary: string };
}) {
  const { t } = useTranslation();
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
      accessibilityLabel={starred ? t('removeFromFavorites') : t('addToFavorites')}
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
/*  Player content (hero, controls) — "Player" tab                     */
/* ------------------------------------------------------------------ */

interface PlayerContentProps {
  currentTrack: Child;
  colors: ThemeColors;
  queueLoading: boolean;
  handleSeek: (seconds: number) => void;
}

const PlayerContent = memo(function PlayerContent({
  currentTrack,
  colors,
  queueLoading,
  handleSeek,
}: PlayerContentProps) {
  const { t } = useTranslation();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const playbackState = playerStore((s) => s.playbackState);
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const bufferedPosition = playerStore((s) => s.bufferedPosition);
  const error = playerStore((s) => s.error);
  const retrying = playerStore((s) => s.retrying);

  const showSkipInterval = playbackSettingsStore((s) => s.showSkipIntervalButtons);
  const showSleepTimer = playbackSettingsStore((s) => s.showSleepTimerButton);
  const { canSkipNext, canSkipPrevious } = useCanSkip();

  // On small screens (Pixel 2 ≈ 731dp tall), shrink the hero to leave room
  // for a secondary controls row. On larger screens heroSize equals the
  // natural width so the layout is unchanged.
  const heroSize = useMemo(() => {
    const naturalWidth = Math.min(windowWidth - 2 * HERO_PADDING, 464 - 2 * HERO_PADDING);
    // Non-hero vertical space: header, safe areas, tab bar, track info,
    // progress, controls, secondary row, hero padding, spacer breathing room.
    const reserved = insets.top + HEADER_BAR_HEIGHT + insets.bottom + 342;
    const maxHero = windowHeight - reserved;
    return Math.max(Math.min(naturalWidth, maxHero), 120);
  }, [windowHeight, windowWidth, insets.top, insets.bottom]);

  const isPlaying =
    playbackState === 'playing' || playbackState === 'buffering';
  const isBuffering =
    playbackState === 'buffering' || playbackState === 'loading';

  const marqueeStyle = useMemo(
    () => [styles.trackTitle, { color: colors.textPrimary }],
    [colors.textPrimary],
  );

  if (queueLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          {t('loading')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.playerContentContainer}>
      {/* On iOS the panel extends behind the transparent header,
          so use a fixed spacer to clear it. On Android the panel is
          already offset via top: headerTopPadding. */}
      {Platform.OS === 'ios' && <View style={{ height: insets.top + HEADER_BAR_HEIGHT }} />}
      {/* Hero cover art */}
      <View style={styles.hero}>
        <View style={[styles.heroImageWrap, { width: heroSize, height: heroSize }]}>
          <CachedImage
            coverArtId={currentTrack.coverArt}
            size={HERO_COVER_SIZE}
            style={styles.heroImage}
            resizeMode="cover"
          />
          <View style={styles.sleepCapsuleOverlay} pointerEvents="box-none">
            <SleepTimerCapsule />
          </View>
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
              {currentTrack.artist ?? t('unknownArtist')}
            </Text>
          </View>
          <FavoriteButton trackId={currentTrack.id} colors={colors} />
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
        {/* Playback rate toggle */}
        <View style={styles.controlSideLeft}>
          <PlaybackRateButton />
        </View>

        {/* Transport controls */}
        <View style={styles.transportControls}>
          <Pressable
            onPress={skipToPrevious}
            hitSlop={12}
            disabled={!canSkipPrevious}
            style={({ pressed }) => [pressed && styles.pressed, !canSkipPrevious && styles.disabled]}
          >
            <Ionicons
              name="play-back"
              size={32}
              color={canSkipPrevious ? colors.textPrimary : colors.textSecondary}
            />
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
            disabled={!canSkipNext}
            style={({ pressed }) => [pressed && styles.pressed, !canSkipNext && styles.disabled]}
          >
            <Ionicons
              name="play-forward"
              size={32}
              color={canSkipNext ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
        </View>

        {/* Repeat toggle */}
        <View style={styles.controlSideRight}>
          <RepeatButton />
        </View>
      </View>

      {/* Secondary controls row — mirrors primary controls layout */}
      <View style={styles.secondaryControls}>
        <View style={styles.controlSideLeft}>
          {showSleepTimer && <SleepTimerButton />}
        </View>
        <View style={styles.secondaryCenter} />
        <View style={styles.controlSideRight} />
      </View>

      <View style={styles.playerSpacer} />
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Queue header (shuffle, share, clear)                               */
/* ------------------------------------------------------------------ */

interface QueueHeaderProps {
  colors: ThemeColors;
  handleClearQueue: () => void;
  handleShuffle: () => void;
  handleShareQueue: () => void;
  shuffling: boolean;
  queueLength: number;
}

const QueueHeader = memo(function QueueHeader({
  colors,
  handleClearQueue,
  handleShuffle,
  handleShareQueue,
  shuffling,
  queueLength,
}: QueueHeaderProps) {
  const { t } = useTranslation();
  if (queueLength === 0) return null;

  return (
    <View style={styles.queueSection}>
      <View style={styles.queueHeaderRow}>
        <Text style={[styles.queueHeaderText, { color: colors.textPrimary }]}>
          {t('queue')}
        </Text>
        <View style={styles.queueActions}>
          <ShuffleButton
            onPress={handleShuffle}
            disabled={shuffling || queueLength < 2}
          />
          <Pressable
            onPress={handleShareQueue}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('shareQueue')}
            style={({ pressed }) => [
              styles.queueActionButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            onPress={handleClearQueue}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('clearQueue')}
            style={({ pressed }) => [
              styles.queueActionButton,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[styles.clearButtonText, { color: colors.textPrimary }]}
            >
              {t('clear')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Album info tab                                                     */
/* ------------------------------------------------------------------ */

const AlbumInfoTab = memo(function AlbumInfoTab({
  currentTrack,
  colors,
}: {
  currentTrack: Child;
  colors: ThemeColors;
}) {
  const albumId = currentTrack.albumId ?? null;
  const albumInfoEntry = albumInfoStore((s) => albumId ? s.entries[albumId] : undefined);
  const albumInfoLoading = albumInfoStore((s) => albumId ? (s.loading[albumId] ?? false) : false);
  const albumInfoError = albumInfoStore((s) => albumId ? (s.errors[albumId] ?? null) : null);
  const fetchAttemptedRef = useRef<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!albumId || albumInfoEntry || albumInfoLoading) return;
    if (fetchAttemptedRef.current === albumId) return;
    fetchAttemptedRef.current = albumId;
    albumInfoStore.getState().fetchAlbumInfo(
      albumId,
      currentTrack.artist ?? undefined,
      currentTrack.album ?? undefined,
    );
  }, [albumId, albumInfoEntry, albumInfoLoading, currentTrack.artist, currentTrack.album]);

  // Reset fetch guard when album changes
  useEffect(() => {
    fetchAttemptedRef.current = null;
  }, [albumId]);

  const sanitizedNotes = useMemo(() => {
    // Prefer server notes, fall back to Wikipedia-enriched notes
    const serverNotes = albumInfoEntry?.albumInfo.notes;
    if (serverNotes) {
      const sanitized = sanitizeBiographyText(serverNotes);
      if (sanitized) return sanitized;
    }
    return albumInfoEntry?.enrichedNotes ?? null;
  }, [albumInfoEntry?.albumInfo.notes, albumInfoEntry?.enrichedNotes]);

  const notesAttributionUrl = albumInfoEntry?.enrichedNotesUrl ?? null;

  const handleRefresh = useCallback(async () => {
    if (!albumId) return;
    setRefreshing(true);
    const delay = minDelay();
    // Clear existing entry so a fresh fetch is triggered
    const { [albumId]: _, ...rest } = albumInfoStore.getState().entries;
    albumInfoStore.setState({ entries: rest });
    fetchAttemptedRef.current = null;
    await albumInfoStore.getState().fetchAlbumInfo(
      albumId,
      currentTrack.artist ?? undefined,
      currentTrack.album ?? undefined,
    );
    await delay;
    setRefreshing(false);
  }, [albumId, currentTrack.artist, currentTrack.album]);

  const handleRetry = useCallback(() => {
    if (!albumId) return;
    fetchAttemptedRef.current = null;
    albumInfoStore.getState().fetchAlbumInfo(
      albumId,
      currentTrack.artist ?? undefined,
      currentTrack.album ?? undefined,
    );
  }, [albumId, currentTrack.artist, currentTrack.album]);

  return (
    <View style={styles.albumInfoContainer}>
      <AlbumInfoContent
        track={currentTrack}
        albumInfo={albumInfoEntry?.albumInfo ?? null}
        overrideMbid={albumInfoEntry?.overrideMbid ?? null}
        sanitizedNotes={sanitizedNotes}
        notesAttributionUrl={notesAttributionUrl}
        albumInfoLoading={albumInfoLoading}
        albumInfoError={albumInfoError}
        onRetry={handleRetry}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        colors={colors}
      />
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Lyrics tab                                                         */
/* ------------------------------------------------------------------ */

const LyricsTab = memo(function LyricsTab({
  currentTrack,
  colors,
}: {
  currentTrack: Child;
  colors: ThemeColors;
}) {
  const trackId = currentTrack.id;
  const lyricsEntry = lyricsStore((s) => s.entries[trackId]);
  const lyricsLoading = lyricsStore((s) => s.loading[trackId] ?? false);
  const lyricsError = lyricsStore((s) => s.errors[trackId] ?? null);
  const fetchAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (lyricsEntry || lyricsLoading) return;
    if (fetchAttemptedRef.current === trackId) return;
    fetchAttemptedRef.current = trackId;
    lyricsStore.getState().fetchLyrics(
      trackId,
      currentTrack.artist ?? undefined,
      currentTrack.title ?? undefined,
    );
  }, [trackId, lyricsEntry, lyricsLoading, currentTrack.artist, currentTrack.title]);

  useEffect(() => {
    fetchAttemptedRef.current = null;
  }, [trackId]);

  const handleRetry = useCallback(() => {
    fetchAttemptedRef.current = null;
    lyricsStore.getState().fetchLyrics(
      trackId,
      currentTrack.artist ?? undefined,
      currentTrack.title ?? undefined,
    );
  }, [trackId, currentTrack.artist, currentTrack.title]);

  return (
    <View style={styles.lyricsContainer}>
      <LyricsContent
        key={trackId}
        trackId={trackId}
        lyricsData={lyricsEntry}
        lyricsLoading={lyricsLoading}
        lyricsError={lyricsError}
        onRetry={handleRetry}
        durationSec={currentTrack.duration ?? null}
        colors={colors}
      />
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
  contentArea: {
    flex: 1,
  },
  tabPanel: {
    ...StyleSheet.absoluteFillObject,
  },
  hiddenTab: {
    display: 'none',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    marginTop: 16,
  },
  playerContentContainer: {
    flexGrow: 1,
  },
  playerScrollView: {
    flex: 1,
  },
  playerScrollContent: {
    flexGrow: 1,
  },
  playerSpacer: {
    flex: 1,
  },
  hero: {
    width: '100%',
    maxWidth: 464,
    alignSelf: 'center',
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
  sleepCapsuleOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackInfo: {
    paddingHorizontal: HERO_PADDING,
    maxWidth: 464,
    width: '100%',
    alignSelf: 'center',
    marginBottom: 16,
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
    fontSize: 22,
    fontWeight: '700',
  },
  trackArtist: {
    fontSize: 16,
    marginTop: 4,
  },
  favoriteButton: {
    paddingLeft: 12,
    paddingVertical: 4,
  },
  progressSection: {
    paddingHorizontal: HERO_PADDING,
    maxWidth: 464,
    width: '100%',
    alignSelf: 'center',
    marginBottom: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: HERO_PADDING,
    maxWidth: 464,
    width: '100%',
    alignSelf: 'center',
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
  secondaryCenter: {
    width: 248,
  },
  secondaryControls: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: HERO_PADDING,
    maxWidth: 464,
    width: '100%',
    alignSelf: 'center',
  },
  transportControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: 248,
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
  disabled: {
    opacity: 0.4,
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
  queueHeaderText: {
    fontSize: 12,
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
  albumInfoContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  lyricsContainer: {
    flex: 1,
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
