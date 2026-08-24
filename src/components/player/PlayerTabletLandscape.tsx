import Ionicons from "@react-native-vector-icons/ionicons/static";
import MaterialCommunityIcons from "@react-native-vector-icons/material-design-icons/static";
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumInfoContent } from '@/components/AlbumInfoContent';
import { LyricsContent } from '@/components/LyricsContent';
import { BookmarkButton } from '@/components/BookmarkButton';
import { CachedImage } from '@/components/CachedImage';
import { FavoriteButton } from '@/components/FavoriteButton';
import { MarqueeText } from '@/components/MarqueeText';
import { MoreOptionsButton } from '@/components/MoreOptionsButton';
import { PlaybackRateButton } from '@/components/PlaybackRateButton';
import { PlayerProgressBar } from '@/components/PlayerProgressBar';
import { QueueItemRow } from '@/components/QueueItemRow';
import { AutoplayQueueFooter } from '@/components/AutoplayQueueFooter';
import { RepeatButton } from '@/components/RepeatButton';
import { ShuffleButton } from '@/components/ShuffleButton';
import { ShuffleOverlay } from '@/components/ShuffleOverlay';
import { SkipIntervalButton } from '@/components/SkipIntervalButton';
import { SleepTimerButton } from '@/components/SleepTimerButton';
import { SleepTimerCapsule } from '@/components/SleepTimerCapsule';
import { closeOpenRow } from '@/components/SwipeableRow';
import { useCanSkip } from '@/hooks/useCanSkip';
import { useCoverGradient } from '@/hooks/useCoverGradient';
import { useSongCoverArt } from '@/hooks/useSongCoverArt';
import { mixHexColors } from '@/utils/colors';
import { isAutoplaySectionStart } from '@/utils/queueOrigins';
import { usePlayerActions } from '@/hooks/usePlayerActions';
import { usePlaybackState } from '@/hooks/usePlaybackState';
import { useShuffleOverlay } from '@/hooks/useShuffleOverlay';
import { useTheme } from '@/hooks/useTheme';
import {
  retryPlayback,
  skipToNext,
  skipToPrevious,
  togglePlayPause,
} from '@/services/playerService';
import { sanitizeBiographyText } from '@/utils/formatters';
import { type Child } from '@/services/subsonicService';
import { usePlayerAlbumInfo } from '@/hooks/usePlayerAlbumInfo';
import { usePlayerLyrics } from '@/hooks/usePlayerLyrics';
import { playbackSettingsStore } from '@/store/playbackSettingsStore';
import { moreOptionsStore } from '@/store/moreOptionsStore';
import { offlineModeStore } from '@/store/offlineModeStore';
import { playerStore } from '@/store/playerStore';
import { tabletLayoutStore } from '@/store/tabletLayoutStore';

import { absoluteFill } from '@/utils/styles';
const HERO_COVER_SIZE = 600;
const CONTENT_PADDING = 40;
const COLUMN_GAP = 32;

interface PlayerTabletLandscapeProps {
  expandProgress: SharedValue<number>;
}

export function PlayerTabletLandscape({
  expandProgress,
}: PlayerTabletLandscapeProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const currentTrack = playerStore((s) => s.currentTrack);
  const songCoverArtId = useSongCoverArt(currentTrack);
  const currentTrackIndex = playerStore((s) => s.currentTrackIndex);
  const queue = playerStore((s) => s.queue);
  const queueOrigins = playerStore((s) => s.queueOrigins);
  const { isPlaying, isBuffering } = usePlaybackState();
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const bufferedPosition = playerStore((s) => s.bufferedPosition);
  const error = playerStore((s) => s.error);
  const retrying = playerStore((s) => s.retrying);

  const showSkipInterval = playbackSettingsStore((s) => s.showSkipIntervalButtons);
  const showSleepTimer = playbackSettingsStore((s) => s.showSleepTimerButton);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  // This overlay is root-mounted and stays mounted (transparent, non-interactive)
  // while collapsed, so "the player is open" is the expanded flag, not the mount.
  const playerExpanded = tabletLayoutStore((s) => s.playerExpanded);
  const { canSkipNext, canSkipPrevious } = useCanSkip();

  // Own palette extraction for gradient background. Primary is already
  // lightness-clamped for the active theme so the previous manual
  // darkening call is no longer necessary — we just use the hook output.
  // Slightly-darkened theme background as the gradient's lower stop.
  const backgroundEnd = mixHexColors(colors.background, '#000000', 0.15);
  const { gradientColors, gradientLocations, gradientOpacity: extractedGradientOpacity } =
    useCoverGradient(songCoverArtId, backgroundEnd);

  // Right panel mode: queue (default), lyrics, or album info
  const [rightPanelMode, setRightPanelMode] = useState<'queue' | 'lyrics' | 'info'>('queue');

  // Album info — fetch only when the user is actually viewing the info panel.
  const albumId = currentTrack?.albumId ?? null;
  const {
    entry: albumInfoEntry,
    loading: albumInfoLoading,
    error: albumInfoError,
    refreshing: albumInfoRefreshing,
    handleRetry: handleRetryAlbumInfo,
    handleRefresh: handleRefreshAlbumInfo,
  } = usePlayerAlbumInfo(
    albumId,
    currentTrack?.artist,
    currentTrack?.album,
    { enabled: rightPanelMode === 'info' },
  );

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

  // Lyrics
  const trackId = currentTrack?.id ?? null;
  const {
    entry: lyricsEntry,
    loading: lyricsLoading,
    error: lyricsError,
    handleRetry: handleRetryLyrics,
  } = usePlayerLyrics(trackId, currentTrack?.artist, currentTrack?.title, playerExpanded);

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

  const {
    handleSeek,
    handleQueueItemPress,
    handleQueueItemLongPress,
    handleShareQueue,
    handleClearQueue,
  } = usePlayerActions({ source: 'player-tablet-landscape' });

  const {
    shuffling,
    handleShuffle,
    overlayStyle: shuffleOverlayStyle,
    spinStyle,
  } = useShuffleOverlay();

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
        startsAutoplaySection={isAutoplaySectionStart(queueOrigins, currentTrackIndex, index)}
        colors={queueColors}
        onPress={handleQueueItemPress}
        onLongPress={handleQueueItemLongPress}
      />
    ),
    [currentTrackIndex, queueOrigins, queueColors, handleQueueItemPress, handleQueueItemLongPress],
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
          style={[absoluteFill, gradientAnimatedStyle]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={gradientColors}
            locations={gradientLocations}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.6 }}
            style={absoluteFill}
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
              accessibilityLabel={t('collapsePlayer')}
              style={({ pressed }) => [styles.collapseButton, pressed && styles.pressed]}
            >
              <Ionicons name="contract-outline" size={22} color={colors.textPrimary} />
              <Text style={[styles.collapseText, { color: colors.textPrimary }]}>
                {t('nowPlaying')}
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
                      coverArtId={songCoverArtId}
                      size={HERO_COVER_SIZE}
                      style={styles.coverImage}
                      resizeMode="cover"
                    />
                    <View style={styles.sleepCapsuleOverlay} pointerEvents="box-none">
                      <SleepTimerCapsule />
                    </View>
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
                      moreOptionsStore.getState().show({ type: 'song', item: currentTrack }, 'player-tablet-landscape')
                    }
                    color={colors.textPrimary}
                  />
                  <FavoriteButton trackId={currentTrack.id} style={styles.favoriteButton} />
                </View>
                <Text
                  style={[styles.trackArtist, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {currentTrack.artist ?? t('unknownArtist')}
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
                  <ShuffleButton
                    onPress={handleShuffle}
                    disabled={shuffling || queue.length < 2}
                    size={28}
                  />
                </View>

                <View style={styles.transportControls}>
                  <Pressable
                    onPress={skipToPrevious}
                    hitSlop={12}
                    disabled={!canSkipPrevious}
                    style={({ pressed }) => [pressed && styles.pressed, !canSkipPrevious && styles.disabled]}
                  >
                    <Ionicons name="play-back" size={32} color={canSkipPrevious ? colors.textPrimary : colors.textSecondary} />
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
                    disabled={!canSkipNext}
                    style={({ pressed }) => [pressed && styles.pressed, !canSkipNext && styles.disabled]}
                  >
                    <Ionicons name="play-forward" size={32} color={canSkipNext ? colors.textPrimary : colors.textSecondary} />
                  </Pressable>
                </View>

                <View style={styles.controlSideRight}>
                  <RepeatButton />
                </View>
              </View>

              {/* Secondary controls row — sleep timer, then skip-interval
                  buttons under prev/next with the playback rate between them */}
              <View style={styles.secondaryControls}>
                <View style={[styles.controlSideLeft, styles.secondaryLeftInset]}>
                  {showSleepTimer && <SleepTimerButton />}
                </View>
                <View style={[styles.secondaryCenter, styles.secondaryCenterRow]}>
                  {showSkipInterval && (
                    <SkipIntervalButton direction="backward" size={32} />
                  )}
                  <View style={styles.secondaryRateSlot}>
                    <PlaybackRateButton />
                  </View>
                  {showSkipInterval && (
                    <SkipIntervalButton direction="forward" size={32} />
                  )}
                </View>
                <View style={styles.controlSideRight}>
                  <BookmarkButton style={styles.bookmarkButton} />
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
                      {t('queue')}
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
                        accessibilityLabel={t('shareQueue')}
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
                        accessibilityLabel={t('clearQueue')}
                        style={({ pressed }) => [
                          styles.queueActionButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.clearButtonText, { color: colors.textPrimary }]}>
                          {t('clear')}
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
                      ListFooterComponent={AutoplayQueueFooter}
                      onScrollBeginDrag={closeOpenRow}
                      drawDistance={200}
                      showsVerticalScrollIndicator={false}
                    />
                  </View>
                </>
              ) : rightPanelMode === 'info' ? (
                /* Album info panel — always shows track metadata; enriched with API data when available */
                (<AlbumInfoContent
                  track={currentTrack}
                  albumInfo={albumInfoEntry?.albumInfo ?? null}
                  overrideMbid={albumInfoEntry?.overrideMbid ?? null}
                  sanitizedNotes={sanitizedNotes}
                  notesAttributionUrl={notesAttributionUrl}
                  albumInfoLoading={albumInfoLoading}
                  albumInfoError={albumInfoError}
                  onRetry={handleRetryAlbumInfo}
                  refreshing={albumInfoRefreshing}
                  onRefresh={handleRefreshAlbumInfo}
                  colors={colors}
                />)
              ) : (
                /* Lyrics panel */
                (<View style={styles.lyricsContainer}>
                  <LyricsContent
                    key={trackId ?? 'no-track'}
                    trackId={trackId ?? undefined}
                    lyricsData={lyricsEntry}
                    lyricsLoading={lyricsLoading}
                    lyricsError={lyricsError}
                    onRetry={handleRetryLyrics}
                    durationSec={currentTrack?.duration ?? null}
                    colors={colors}
                  />
                </View>)
              )}

              {/* Bottom toggle: queue / info / lyrics — ordering matches the
                  portrait PlayerTabBar so muscle memory transfers. */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleButtons}>
                  <Pressable
                    onPress={() => setRightPanelMode('queue')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('showQueue')}
                    style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed]}
                  >
                    <MaterialCommunityIcons
                      name="playlist-music"
                      size={22}
                      color={rightPanelMode === 'queue' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                  {!offlineMode && (
                    <Pressable
                      onPress={() => setRightPanelMode('info')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('showAlbumInfo')}
                      style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed]}
                    >
                      <MaterialCommunityIcons
                        name="information-outline"
                        size={22}
                        color={rightPanelMode === 'info' ? colors.primary : colors.textSecondary}
                      />
                    </Pressable>
                  )}
                  {!offlineMode && (
                    <Pressable
                      onPress={() => setRightPanelMode('lyrics')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('showLyrics')}
                      style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed]}
                    >
                      <MaterialCommunityIcons
                        name="comment-quote-outline"
                        size={22}
                        color={rightPanelMode === 'lyrics' ? colors.primary : colors.textSecondary}
                      />
                    </Pressable>
                  )}
                </View>
              </View>
            </Animated.View>
          </View>
        </View>

        {/* Shuffle overlay */}
        <ShuffleOverlay
          visible={shuffling}
          overlayStyle={shuffleOverlayStyle}
          spinStyle={spinStyle}
          colors={colors}
        />
      </View>
    </Animated.View>
  );
}


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
  sleepCapsuleOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: 8,
  },
  secondaryControls: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    marginTop: 20,
    marginBottom: 8,
  },
  secondaryCenter: {
    width: 248,
  },
  secondaryCenterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  secondaryRateSlot: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
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

  favoriteButton: {
    padding: 4,
  },
  bookmarkButton: {
    paddingVertical: 4,
  },
  secondaryLeftInset: {
    paddingLeft: 4,
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
    fontSize: 12,
    fontWeight: '600',
  },
  queueList: {
    flex: 1,
  },

  /* --- Right column: lyrics panel --- */
  lyricsContainer: {
    flex: 1,
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

  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});
