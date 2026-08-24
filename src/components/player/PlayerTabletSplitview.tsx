import Ionicons from "@react-native-vector-icons/ionicons/static";
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from '@/components/GradientBackground';
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
import { SleepTimerCapsule } from '@/components/SleepTimerCapsule';
import { closeOpenRow } from '@/components/SwipeableRow';
import { type ThemeColors } from '@/constants/theme';
import { useCanSkip } from '@/hooks/useCanSkip';
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
import { type Child } from '@/services/subsonicService';
import { moreOptionsStore } from '@/store/moreOptionsStore';
import { playerStore } from '@/store/playerStore';
import { tabletLayoutStore } from '@/store/tabletLayoutStore';

const COVER_SIZE = 300;
const PADDING = 16;

export function PlayerTabletSplitview() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queueContentContainerStyle = useMemo(
    () => ({ paddingBottom: insets.bottom + 16 }),
    [insets.bottom],
  );
  const currentTrack = playerStore((s) => s.currentTrack);
  const currentTrackIndex = playerStore((s) => s.currentTrackIndex);
  const queue = playerStore((s) => s.queue);
  const queueOrigins = playerStore((s) => s.queueOrigins);
  const queueLoading = playerStore((s) => s.queueLoading);

  const {
    handleSeek,
    handleQueueItemPress,
    handleQueueItemLongPress,
    handleShareQueue,
    handleClearQueue,
  } = usePlayerActions({ source: 'player-tablet-splitview' });

  const handleExpand = useCallback(() => {
    tabletLayoutStore.getState().setPlayerExpanded(true);
  }, []);

  const {
    shuffling,
    handleShuffle,
    overlayStyle,
    spinStyle,
  } = useShuffleOverlay();

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
              {t('loading')}
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
        </View>
      )}

      {/* Scrollable queue list */}
      <View style={styles.queueList}>
        <FlashList
          data={queue}
          renderItem={renderQueueItem}
          keyExtractor={keyExtractor}
          ListFooterComponent={AutoplayQueueFooter}
          onScrollBeginDrag={closeOpenRow}
          drawDistance={200}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={queueContentContainerStyle}
        />
      </View>

      {/* Shuffle overlay */}
      <ShuffleOverlay
        visible={shuffling}
        overlayStyle={overlayStyle}
        spinStyle={spinStyle}
        colors={colors}
      />
    </GradientBackground>
  );
}

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
  const { t } = useTranslation();
  const songCoverArtId = useSongCoverArt(currentTrack);
  const { isPlaying, isBuffering } = usePlaybackState();
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const bufferedPosition = playerStore((s) => s.bufferedPosition);
  const error = playerStore((s) => s.error);
  const retrying = playerStore((s) => s.retrying);

  const { canSkipNext, canSkipPrevious } = useCanSkip();

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
              accessibilityLabel={t('expandPlayer')}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Ionicons name="expand-outline" size={22} color={colors.textPrimary} />
            </Pressable>
            <MoreOptionsButton
              onPress={() =>
                moreOptionsStore.getState().show({ type: 'song', item: currentTrack }, 'player-tablet-splitview')
              }
              color={colors.textPrimary}
            />
          </View>

          {/* Cover art */}
          <View style={styles.coverSection}>
            <View style={styles.coverWrap}>
              <CachedImage
                coverArtId={songCoverArtId}
                size={COVER_SIZE}
                style={styles.coverImage}
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
              <FavoriteButton trackId={currentTrack.id} size={20} style={styles.favoriteButton} />
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

            <View style={styles.transportControls}>
              <Pressable
                onPress={skipToPrevious}
                hitSlop={12}
                disabled={!canSkipPrevious}
                style={({ pressed }) => [pressed && styles.pressed, !canSkipPrevious && styles.disabled]}
              >
                <Ionicons name="play-back" size={24} color={canSkipPrevious ? colors.textPrimary : colors.textSecondary} />
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
                    size={24}
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
                <Ionicons name="play-forward" size={24} color={canSkipNext ? colors.textPrimary : colors.textSecondary} />
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
  sleepCapsuleOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 12,
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
    marginBottom: 8,
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
    width: 190,
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
    gap: 8,
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
});
