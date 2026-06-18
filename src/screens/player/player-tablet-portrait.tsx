import Ionicons from "@react-native-vector-icons/ionicons/static";
import MaterialCommunityIcons from "@react-native-vector-icons/material-design-icons/static";
import { Stack, useNavigation, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ArtistLink from '@/components/ArtistLink';
import { BookmarkButton } from '@/components/BookmarkButton';
import { CachedImage } from '@/components/CachedImage';
import { FavoriteButton } from '@/components/FavoriteButton';
import { EmptyState } from '@/components/EmptyState';
import { MarqueeText } from '@/components/MarqueeText';
import { MoreOptionsButton } from '@/components/MoreOptionsButton';
import { PlaybackRateButton } from '@/components/PlaybackRateButton';
import { PlayerProgressBar } from '@/components/PlayerProgressBar';
import { RepeatButton } from '@/components/RepeatButton';
import { ShuffleButton } from '@/components/ShuffleButton';
import { ShuffleOverlay } from '@/components/ShuffleOverlay';
import { SkipIntervalButton } from '@/components/SkipIntervalButton';
import { SleepTimerButton } from '@/components/SleepTimerButton';
import { SleepTimerCapsule } from '@/components/SleepTimerCapsule';
import { PlaybackSourceBadge } from '@/components/PlaybackSourceBadge';
import { PlayerModeContent, type PlayerMode } from '@/components/player/PlayerModeContent';
import { CastButton } from '@/components/RoutePicker';
import { type ThemeColors } from '@/constants/theme';
import { useCanSkip } from '@/hooks/useCanSkip';
import { useCoverGradient } from '@/hooks/useCoverGradient';
import { useSongCoverArt } from '@/hooks/useSongCoverArt';
import { usePlayerActions } from '@/hooks/usePlayerActions';
import { usePlaybackState } from '@/hooks/usePlaybackState';
import { useShuffleOverlay } from '@/hooks/useShuffleOverlay';
import { useTheme } from '@/hooks/useTheme';
import {
  clearQueue,
  retryPlayback,
  skipToNext,
  skipToPrevious,
  togglePlayPause,
} from '@/services/playerService';
import { moreOptionsStore } from '@/store/moreOptionsStore';
import { offlineModeStore } from '@/store/offlineModeStore';
import { playbackSettingsStore } from '@/store/playbackSettingsStore';
import { playerStore } from '@/store/playerStore';
import { mixHexColors } from '@/utils/colors';
import { absoluteFill } from '@/utils/styles';

const HERO_PADDING = 24;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = Platform.OS === 'ios' ? 44 : 56;
const COLUMN_GAP = 24;
const ART_MAX = 440;

/**
 * Tablet-portrait full-screen Now Playing. A fixed vertical split over a single
 * page-wide gradient: a large hero band (art + controls) up top, a centered
 * Queue/Info/Lyrics toggle in the middle, and the selected content filling the
 * bottom. Used by the /player route only on tablets in portrait (see
 * useIsTabletPortrait); phone + landscape are unchanged.
 */
export function PlayerTabletPortrait() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const router = useRouter();
  const { height: screenH, width: screenW } = useWindowDimensions();

  const currentTrack = playerStore((s) => s.currentTrack);
  const songCoverArtId = useSongCoverArt(currentTrack);
  const currentTrackIndex = playerStore((s) => s.currentTrackIndex);
  const queue = playerStore((s) => s.queue);
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const [mode, setMode] = useState<PlayerMode>('queue');

  // Info/Lyrics are hidden offline — fall back to the queue if they vanish.
  useEffect(() => {
    if (offlineMode && mode !== 'queue') setMode('queue');
  }, [offlineMode, mode]);

  const onClose = useCallback(() => router.back(), [router]);

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
  } = usePlayerActions({ source: 'player-tablet-portrait', onClearConfirmed });

  const {
    shuffling,
    handleShuffle,
    overlayStyle,
    spinStyle,
  } = useShuffleOverlay();

  // Auto-dismiss when the queue is externally cleared while this screen is open.
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
  );

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

  /* ---- Header: dismiss + more options ---- */
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
              moreOptionsStore.getState().show({ type: 'song', item: currentTrack }, 'player-tablet-portrait')
            }
            color={colors.textPrimary}
          />
        ) : null,
    });
  }, [currentTrack, navigation, onClose, colors.textPrimary]);

  const headerSpace = insets.top + HEADER_BAR_HEIGHT;

  // Prominent square art on the left of the band, capped so the right column
  // keeps room for the controls on narrower tablets.
  const artSize = Math.min(
    Math.round((screenW - 2 * HERO_PADDING - COLUMN_GAP) * 0.5),
    ART_MAX,
  );

  // Bottom content height — preserves the split roughly where the old sheet sat
  // (~44% of the screen), leaving the band centered in the space above.
  const bottomSectionHeight = Math.max(Math.round(screenH * 0.44), 320);

  const queueColors = useMemo(
    () => ({ ...colors, primary: mixHexColors(colors.primary, colors.textPrimary, 0.45) }),
    [colors],
  );

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
              onPress={() => moreOptionsStore.getState().show({ type: 'song', item: currentTrack }, 'player-tablet-portrait')}
            />
          </Stack.Toolbar>
        </>
      )}
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Single page-wide gradient background */}
        <View style={[absoluteFill, { backgroundColor: colors.background }]} />
        <Animated.View style={[absoluteFill, gradientAnimatedStyle]} pointerEvents="none">
          <LinearGradient colors={gradientColors} locations={gradientLocations} style={absoluteFill} />
        </Animated.View>

        <View style={[styles.content, { paddingTop: headerSpace, paddingBottom: insets.bottom }]}>
          {/* Top band: cover art (left) + info/progress/controls (right). */}
          <View style={styles.topSection}>
            <View style={styles.band}>
              <View style={[styles.heroImageWrap, { width: artSize, height: artSize }]}>
                <CachedImage
                  coverArtId={songCoverArtId}
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

              <View style={styles.bandContent}>
                <View style={styles.trackInfoRow}>
                  <View style={styles.trackInfoText}>
                    <MarqueeText style={[styles.trackTitle, { color: colors.textPrimary }]}>
                      {currentTrack.title}
                    </MarqueeText>
                    {currentTrack.artists && currentTrack.artists.length > 0 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {currentTrack.artists.map((artist, i, arr) => (
                          <Fragment key={artist.id}>
                            <ArtistLink
                              artistId={artist.id}
                              artistName={artist.name}
                              offline={offlineMode}
                            />
                            {i < arr.length - 1 && (
                              <Text style={[styles.trackArtist, { color: colors.textSecondary }]}>
                                {' · '}
                              </Text>
                            )}
                          </Fragment>
                        ))}
                      </View>
                    ) : currentTrack.artistId ? (
                      <ArtistLink
                        artistId={currentTrack.artistId}
                        artistName={currentTrack.artist ?? t('unknownArtist')}
                        offline={offlineMode}
                      />
                    ) : (
                      <Text style={[styles.trackArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                        {currentTrack.artist ?? t('unknownArtist')}
                      </Text>
                    )}
                    <CastButton />
                  </View>
                  <FavoriteButton trackId={currentTrack.id} style={styles.favoriteButton} />
                </View>

                <View style={styles.progressSection}>
                  <ProgressBar colors={colors} handleSeek={handleSeek} />
                </View>

                <PlaybackControls
                  colors={colors}
                  shuffling={shuffling}
                  handleShuffle={handleShuffle}
                  queueLength={queue.length}
                />
              </View>
            </View>
          </View>

          {/* Centered Queue / Info / Lyrics toggle, between the two sections */}
          <ModeToggle mode={mode} onSelect={setMode} colors={colors} offlineMode={offlineMode} />

          {/* Bottom content: queue / info / lyrics on the page gradient */}
          <View style={[styles.bottomSection, { height: bottomSectionHeight }]}>
            <PlayerModeContent
              mode={mode}
              currentTrack={currentTrack}
              queue={queue}
              currentTrackIndex={currentTrackIndex}
              colors={colors}
              queueColors={queueColors}
              onQueueItemPress={handleQueueItemPress}
              onQueueItemLongPress={handleQueueItemLongPress}
              onShareQueue={handleShareQueue}
              onClearQueue={handleClearQueue}
            />
          </View>
        </View>

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
/*  Centered Queue / Info / Lyrics toggle                              */
/* ------------------------------------------------------------------ */

const ModeToggle = memo(function ModeToggle({
  mode,
  onSelect,
  colors,
  offlineMode,
}: {
  mode: PlayerMode;
  onSelect: (mode: PlayerMode) => void;
  colors: ThemeColors;
  offlineMode: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.toggleRow} accessibilityRole="tablist">
      <Pressable
        onPress={() => onSelect('queue')}
        hitSlop={8}
        accessibilityRole="tab"
        accessibilityState={{ selected: mode === 'queue' }}
        accessibilityLabel={t('showQueue')}
        style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons
          name="playlist-music"
          size={22}
          color={mode === 'queue' ? colors.primary : colors.textSecondary}
        />
      </Pressable>
      {!offlineMode && (
        <Pressable
          onPress={() => onSelect('info')}
          hitSlop={8}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === 'info' }}
          accessibilityLabel={t('showAlbumInfo')}
          style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons
            name="information-outline"
            size={22}
            color={mode === 'info' ? colors.primary : colors.textSecondary}
          />
        </Pressable>
      )}
      {!offlineMode && (
        <Pressable
          onPress={() => onSelect('lyrics')}
          hitSlop={8}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === 'lyrics' }}
          accessibilityLabel={t('showLyrics')}
          style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons
            name="comment-quote-outline"
            size={22}
            color={mode === 'lyrics' ? colors.primary : colors.textSecondary}
          />
        </Pressable>
      )}
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Progress bar (subscribes to playback position)                     */
/* ------------------------------------------------------------------ */

const ProgressBar = memo(function ProgressBar({
  colors,
  handleSeek,
}: {
  colors: ThemeColors;
  handleSeek: (seconds: number) => void;
}) {
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const bufferedPosition = playerStore((s) => s.bufferedPosition);
  const { isBuffering } = usePlaybackState();
  const error = playerStore((s) => s.error);
  const retrying = playerStore((s) => s.retrying);

  return (
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
  );
});

/* ------------------------------------------------------------------ */
/*  Playback controls (two rows)                                       */
/* ------------------------------------------------------------------ */

const PlaybackControls = memo(function PlaybackControls({
  colors,
  shuffling,
  handleShuffle,
  queueLength,
}: {
  colors: ThemeColors;
  shuffling: boolean;
  handleShuffle: () => void;
  queueLength: number;
}) {
  const { isPlaying, isBuffering } = usePlaybackState();
  const showSkipInterval = playbackSettingsStore((s) => s.showSkipIntervalButtons);
  const showSleepTimer = playbackSettingsStore((s) => s.showSleepTimerButton);
  const { canSkipNext, canSkipPrevious } = useCanSkip();

  return (
    <>
      <View style={styles.controls}>
        <View style={styles.controlSideLeft}>
          <ShuffleButton
            onPress={handleShuffle}
            disabled={shuffling || queueLength < 2}
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
            <Ionicons
              name="play-back"
              size={32}
              color={canSkipPrevious ? colors.textPrimary : colors.textSecondary}
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
                size={34}
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
            <Ionicons
              name="play-forward"
              size={32}
              color={canSkipNext ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
        </View>

        <View style={styles.controlSideRight}>
          <RepeatButton />
        </View>
      </View>

      <View style={styles.secondaryControls}>
        <View style={[styles.controlSideLeft, styles.secondaryLeftInset]}>
          {showSleepTimer && <SleepTimerButton />}
        </View>
        <View style={[styles.secondaryCenter, styles.secondaryCenterRow]}>
          {showSkipInterval && <SkipIntervalButton direction="backward" size={32} />}
          <View style={styles.secondaryRateSlot}>
            <PlaybackRateButton />
          </View>
          {showSkipInterval && <SkipIntervalButton direction="forward" size={32} />}
        </View>
        <View style={styles.controlSideRight}>
          <BookmarkButton style={styles.favoriteButton} />
        </View>
      </View>
    </>
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
  topSection: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: HERO_PADDING,
  },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: COLUMN_GAP,
  },
  bandContent: {
    flex: 1,
    justifyContent: 'center',
  },
  heroImageWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
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
  sourceBadgeOverlay: {
    position: 'absolute',
    right: 12,
    bottom: 12,
  },
  trackInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  trackInfoText: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  trackArtist: {
    fontSize: 17,
    marginTop: 4,
  },
  favoriteButton: {
    paddingLeft: 12,
    paddingVertical: 4,
  },
  secondaryLeftInset: {
    paddingLeft: 4,
  },
  progressSection: {
    width: '100%',
    marginBottom: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    width: '100%',
    maxWidth: 420,
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
  transportControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: 248,
  },
  secondaryControls: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    marginTop: 20,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
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
  playPauseButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPausePressed: {
    opacity: 0.7,
  },
  playIcon: {
    marginLeft: 3,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
    paddingVertical: 12,
  },
  toggleButton: {
    padding: 4,
  },
  bottomSection: {
    width: '100%',
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});
