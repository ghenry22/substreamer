import Ionicons from "@react-native-vector-icons/ionicons/static";
import { FlashList } from '@shopify/flash-list';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AlbumInfoContent } from '@/components/AlbumInfoContent';
import { LyricsContent } from '@/components/LyricsContent';
import { CachedImage } from '@/components/CachedImage';
import { FavoriteButton } from '@/components/FavoriteButton';
import { LightRaysBackground } from '@/components/LightRaysBackground';
import { EmptyState } from '@/components/EmptyState';
import { MarqueeText } from '@/components/MarqueeText';
import { MoreOptionsButton } from '@/components/MoreOptionsButton';
import { PlayerProgressBar } from '@/components/PlayerProgressBar';
import { type PlayerTab } from '@/components/PlayerTabBar';
import { RepeatButton } from '@/components/RepeatButton';
import { ShuffleButton } from '@/components/ShuffleButton';
import { ShuffleOverlay } from '@/components/ShuffleOverlay';
import { SleepTimerCapsule } from '@/components/SleepTimerCapsule';
import { PlaybackSourceBadge } from '@/components/PlaybackSourceBadge';
import { QueueItemRow } from '@/components/QueueItemRow';
import { closeOpenRow } from '@/components/SwipeableRow';
import { type ThemeColors } from '@/constants/theme';
import { useCanSkip } from '@/hooks/useCanSkip';
import { useCoverGradient } from '@/hooks/useCoverGradient';
import { usePlayerActions } from '@/hooks/usePlayerActions';
import { usePlaybackState } from '@/hooks/usePlaybackState';
import { useShuffleOverlay } from '@/hooks/useShuffleOverlay';
import { getPlayerSize } from '@/hooks/playerSize';
import { useTheme } from '@/hooks/useTheme';
import {
  clearQueue,
  retryPlayback,
  skipToNext,
  skipToPrevious,
  togglePlayPause,
} from '@/services/playerService';
import { sanitizeBiographyText } from '@/utils/formatters';
import { type Child } from '@/services/subsonicService';
import { usePlayerAlbumInfo } from '@/hooks/usePlayerAlbumInfo';
import { usePlayerLyrics, type PlayerLyricsResult } from '@/hooks/usePlayerLyrics';
import { moreOptionsStore } from '@/store/moreOptionsStore';
import { playerStore } from '@/store/playerStore';
import { mixHexColors, readableOn } from '@/utils/colors';


import { absoluteFill } from '@/utils/styles';
const HERO_PADDING = 32;
/** Side margin of the cover art; smaller than HERO_PADDING so the cover is larger. */
const HERO_COVER_PADDING = 16;
const HERO_COVER_MAX_WIDTH = 520;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = Platform.OS === 'ios' ? 44 : 56;

const TAB_FADE_DURATION = 300;
const TAB_FADE_EASING = Easing.out(Easing.cubic);
const TAB_SLIDE_DISTANCE = 12;

/** Static content inset for the queue list — module-scope so FlashList isn't
 *  handed a fresh object on every parent re-render. */
const QUEUE_CONTENT_CONTAINER_STYLE = { paddingBottom: 12 } as const;

export function PlayerPhonePortrait() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const router = useRouter();
  const currentTrack = playerStore((s) => s.currentTrack);
  const songCoverArtId = currentTrack?.coverArt ?? undefined;
  const songAlbumId = currentTrack?.albumId;
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

  const { gradientColors, gradientLocations, gradientOpacity } = useCoverGradient(
    songCoverArtId,
    colors.background,
    songAlbumId,
  );

  // Lyrics are fetched at the screen, not inside the lazily-mounted Lyrics tab,
  // so they load whenever the player is open rather than only once it is selected.
  const {
    entry: lyricsEntry,
    loading: lyricsLoading,
    error: lyricsError,
    handleRetry: handleRetryLyrics,
  } = usePlayerLyrics(
    currentTrack?.id ?? null,
    currentTrack?.artist,
    currentTrack?.title,
    true,
  );

  /* ---- Tab state ---- */
  const [activeTab, setActiveTab] = useState<PlayerTab>('player');
  const [mountedTabs, setMountedTabs] = useState<Set<PlayerTab>>(() => new Set(['player']));

  // From any secondary tab, back returns to the player; from the player it dismisses.
  const handleBack = useCallback(() => {
    if (activeTab !== 'player') setActiveTab('player');
    else onClose();
  }, [activeTab, onClose]);
  const handleOpenQueue = useCallback(() => setActiveTab('queue'), []);
  const handleOpenLyrics = useCallback(() => setActiveTab('lyrics'), []);
  const handleOpenInfo = useCallback(() => setActiveTab('info'), []);



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

  /* ---- Header: dismiss / back button ---- */
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    navigation.setOptions({
      headerLeft: () => (
        <GHPressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [{ opacity: 1 }, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-down" size={28} color={colors.textPrimary} />
        </GHPressable>
      ),
    });
  }, [navigation, handleBack, colors.textPrimary]);

  const onClearConfirmed = useCallback(() => {
    onClose();
    setTimeout(() => clearQueue(), 350);
  }, [onClose]);

  const {
    handleSeek,
    handleQueueItemPress,
    handleQueueItemLongPress,
    handleShareQueue,
    handleClearQueue,
  } = usePlayerActions({ source: 'player-phone-portrait', onClearConfirmed });

  const {
    shuffling,
    handleShuffle,
    overlayStyle,
    spinStyle,
  } = useShuffleOverlay();

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

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
            <Stack.Toolbar.Button icon="chevron.down" onPress={handleBack} />
          </Stack.Toolbar>
        </>
      )}
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Gradient background */}
        <View style={[absoluteFill, { backgroundColor: colors.background }]} />
        <Animated.View
          style={[absoluteFill, gradientAnimatedStyle]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={gradientColors}
            locations={gradientLocations}
            style={absoluteFill}
          />
        </Animated.View>
        <LightRaysBackground />

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
            <PlayerContent
              currentTrack={currentTrack}
              colors={colors}
              queueLoading={queueLoading}
              handleSeek={handleSeek}
              handleShuffle={handleShuffle}
              shuffling={shuffling}
              onOpenQueue={handleOpenQueue}
              onOpenLyrics={handleOpenLyrics}
              onOpenInfo={handleOpenInfo}
            />
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
              <LyricsTab
                currentTrack={currentTrack}
                colors={colors}
                entry={lyricsEntry}
                loading={lyricsLoading}
                error={lyricsError}
                handleRetry={handleRetryLyrics}
              />
            )}
          </Animated.View>
        </View>

        <View style={{ paddingBottom: insets.bottom }} />

        {/* Shuffle overlay */}
        <ShuffleOverlay
          visible={shuffling}
          overlayStyle={overlayStyle}
          spinStyle={spinStyle}
          colors={colors}
        />
      </View>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Player content (hero, controls) — "Player" tab                     */
/* ------------------------------------------------------------------ */

interface PlayerContentProps {
  currentTrack: Child;
  colors: ThemeColors;
  queueLoading: boolean;
  handleSeek: (seconds: number) => void;
  handleShuffle: () => void;
  shuffling: boolean;
  onOpenQueue: () => void;
  onOpenLyrics: () => void;
  onOpenInfo: () => void;
}

const PlayerContent = memo(function PlayerContent({
  currentTrack,
  colors,
  queueLoading,
  handleSeek,
  handleShuffle,
  shuffling,
  onOpenQueue,
  onOpenLyrics,
  onOpenInfo,
}: PlayerContentProps) {
  const { t } = useTranslation();
  const { primaryColor } = useTheme();
  const playAccent = primaryColor ?? colors.textPrimary;
  const songCoverArtId = currentTrack?.coverArt ?? undefined;
  const songAlbumId = currentTrack?.albumId;
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { isPlaying, isBuffering } = usePlaybackState();
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const bufferedPosition = playerStore((s) => s.bufferedPosition);
  const error = playerStore((s) => s.error);
  const retrying = playerStore((s) => s.retrying);
  const queueLength = playerStore((s) => s.queue.length);

  const { canSkipNext, canSkipPrevious } = useCanSkip();

  // Content-height budget (window minus header + top/bottom safe-area insets)
  // and the portrait width drive the responsive tier: smaller art/controls/
  // fonts on short OR narrow screens, and the secondary controls row is dropped
  // on the smallest tier so the essential transport controls always stay above
  // the nav bar AND fit horizontally (800×480 is narrow in portrait).
  const availableHeight = windowHeight - insets.top - insets.bottom - HEADER_BAR_HEIGHT;
  const m = useMemo(
    () => getPlayerSize(availableHeight, windowWidth),
    [availableHeight, windowWidth],
  );

  // Clamp the centre transport cluster to the actual width so the shuffle/repeat
  // side controls keep room and never overflow off-screen. Each side needs at
  // least its icon plus a little breathing space.
  const transportWidth = useMemo(() => {
    const sideMin = m.sideIcon + 8;
    const maxCenter = windowWidth - 2 * HERO_PADDING - 2 * sideMin;
    return Math.max(120, Math.min(m.transportWidth, maxCenter));
  }, [windowWidth, m.sideIcon, m.transportWidth]);

  // Shrink the hero to leave room for the controls; never below the tier floor.
  // Extra gap between the cover and the title on tiers that have room for it.
  const coverGap = m.showSecondaryRow ? 16 : 0;
  const heroSize = useMemo(() => {
    const naturalWidth = Math.min(windowWidth - 2 * HERO_COVER_PADDING, HERO_COVER_MAX_WIDTH);
    const reserved = insets.top + HEADER_BAR_HEIGHT + insets.bottom + m.reserved + coverGap;
    const maxHero = windowHeight - reserved;
    const fitted = Math.max(Math.min(naturalWidth, maxHero), m.heroFloor);
    return Math.round(fitted);
  }, [windowHeight, windowWidth, insets.top, insets.bottom, m.reserved, m.heroFloor, coverGap]);

  const marqueeStyle = useMemo(
    () => [styles.trackTitle, { color: colors.textPrimary, fontSize: m.titleFont }],
    [colors.textPrimary, m.titleFont],
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
      <View style={[styles.hero, { paddingBottom: m.heroPadBottom + coverGap }]}>
        <View style={[styles.heroImageWrap, { width: heroSize, height: heroSize }]}>
          <CachedImage
            coverArtId={songCoverArtId}
            albumId={songAlbumId}
            size={HERO_COVER_SIZE}
            style={styles.heroImage}
            resizeMode="cover"
          />
          <View style={styles.sleepCapsuleOverlay} pointerEvents="box-none">
            <SleepTimerCapsule />
          </View>
          <View style={styles.sourceBadgeOverlay} pointerEvents="none">
            <PlaybackSourceBadge />
          </View>
        </View>
      </View>

      {/* Track info */}
      <View style={[styles.trackInfo, { marginBottom: m.infoMarginBottom }]}>
        <View style={styles.trackInfoRow}>
          <View style={styles.trackInfoText}>
            <MarqueeText style={marqueeStyle}>
              {currentTrack.title}
            </MarqueeText>
            <Text
              style={[styles.trackArtist, { color: colors.textSecondary, fontSize: m.artistFont }]}
              numberOfLines={1}
            >
              {currentTrack.artist ?? t('unknownArtist')}
            </Text>
          </View>
          <MoreOptionsButton
            onPress={() =>
              moreOptionsStore.getState().show({ type: 'song', item: currentTrack }, 'player-phone-portrait')
            }
            color={colors.textPrimary}
          />
        </View>
      </View>

      {/* Progress bar */}
      <View style={[styles.progressSection, { marginBottom: m.progressMarginBottom }]}>
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

      {/* Three equal flex spacers (above the primary row, between the rows,
          and below the secondary row) evenly distribute the controls in the
          space under the progress bar — this centers the primary row between
          the progress bar and the secondary row. */}
      <View style={styles.playerSpacer} />

      {/* Playback controls */}
      <View style={[styles.controls, { paddingVertical: m.controlsPadV }]}>
        {/* Shuffle toggle */}
        <View style={styles.controlSideLeft}>
          <ShuffleButton
            onPress={handleShuffle}
            disabled={shuffling || queueLength < 2}
            size={m.sideIcon}
          />
        </View>

        {/* Transport controls */}
        <View style={[styles.transportControls, { width: transportWidth }]}>
          <Pressable
            onPress={skipToPrevious}
            hitSlop={12}
            disabled={!canSkipPrevious}
            style={({ pressed }) => [pressed && styles.pressed, !canSkipPrevious && styles.disabled]}
          >
            <Ionicons
              name="play-back"
              size={m.transportIcon}
              color={canSkipPrevious ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>

          <Pressable
            onPress={togglePlayPause}
            style={({ pressed }) => [
              styles.playPauseButton,
              { width: m.playButton, height: m.playButton, borderRadius: m.playButton / 2, backgroundColor: playAccent },
              pressed && styles.playPausePressed,
            ]}
          >
            {isBuffering ? (
              <ActivityIndicator size="small" color={readableOn(playAccent)} />
            ) : (
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={m.playIcon}
                color={readableOn(playAccent)}
                style={!isPlaying ? styles.playIcon : undefined}
              />
            )}
          </Pressable>

          <Pressable
            onPress={skipToNext}
            hitSlop={12}
            disabled={!canSkipNext}
            style={({ pressed }) => [pressed && styles.pressed, !canSkipNext && styles.disabled]}
          >
            <Ionicons
              name="play-forward"
              size={m.transportIcon}
              color={canSkipNext ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
        </View>

        {/* Favorite toggle */}
        <View style={styles.controlSideRight}>
          <FavoriteButton trackId={currentTrack.id} style={styles.favoriteButton} />
        </View>
      </View>

      {/* Pill row: repeat, queue, lyrics, album info. Dropped on the smallest tier. */}
      {m.showSecondaryRow && (
        <>
          <View style={styles.playerSpacer} />
          <View style={styles.pillRow}>
            <View style={[styles.pill, { backgroundColor: colors.card }]}>
              <RepeatButton size={24} />
            </View>
            <Pressable
              onPress={onOpenQueue}
              accessibilityRole="button"
              accessibilityLabel={t('queue')}
              style={({ pressed }) => [styles.pill, { backgroundColor: colors.card }, pressed && styles.pressed]}
            >
              <Ionicons name="list" size={24} color={colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={onOpenLyrics}
              accessibilityRole="button"
              accessibilityLabel={t('lyrics')}
              style={({ pressed }) => [styles.pill, { backgroundColor: colors.card }, pressed && styles.pressed]}
            >
              <Ionicons name="text" size={22} color={colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={onOpenInfo}
              accessibilityRole="button"
              accessibilityLabel={t('albumInfo')}
              style={({ pressed }) => [styles.pill, { backgroundColor: colors.card }, pressed && styles.pressed]}
            >
              <Ionicons name="information-circle-outline" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>
        </>
      )}

      <View style={m.showSecondaryRow ? styles.pillBottomGap : styles.playerSpacer} />
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
  const {
    entry: albumInfoEntry,
    loading: albumInfoLoading,
    error: albumInfoError,
    refreshing,
    handleRetry,
    handleRefresh,
  } = usePlayerAlbumInfo(albumId, currentTrack.artist, currentTrack.album);

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

/** Pure presenter — the fetch it displays is owned by `PlayerPhonePortrait`. */
const LyricsTab = memo(function LyricsTab({
  currentTrack,
  colors,
  entry,
  loading,
  error,
  handleRetry,
}: PlayerLyricsResult & {
  currentTrack: Child;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.lyricsContainer}>
      <LyricsContent
        key={currentTrack.id}
        trackId={currentTrack.id}
        lyricsData={entry}
        lyricsLoading={loading}
        lyricsError={error}
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
    ...absoluteFill,
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
    flex: 1,
  },
  playerSpacer: {
    flex: 1,
  },
  hero: {
    width: '100%',
    maxWidth: HERO_COVER_MAX_WIDTH + 2 * HERO_COVER_PADDING,
    alignSelf: 'center',
    paddingHorizontal: HERO_COVER_PADDING,
    paddingTop: 8,
    paddingBottom: 24,
    alignItems: 'center',
  },
  heroImageWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
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
  sourceBadgeOverlay: {
    position: 'absolute',
    right: 12,
    bottom: 12,
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
  pillBottomGap: {
    height: 20,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: HERO_PADDING,
    maxWidth: 464,
    width: '100%',
    alignSelf: 'center',
  },
  pill: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    // width is set inline (tier-scaled + clamped to the screen width) so the
    // shuffle/repeat side controls always keep room — see playerSize.
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
});
