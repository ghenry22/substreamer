import Ionicons from "@react-native-vector-icons/ionicons/static";
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { CachedImage } from '@/components/CachedImage';
import { MarqueeText } from '@/components/MarqueeText';
import WaveformLogo from '@/components/WaveformLogo';
import { useImagePalette } from '@/hooks/useImagePalette';
import { useTheme } from '@/hooks/useTheme';
import { skipToNext, togglePlayPause } from '@/services/playerService';
import { playbackSettingsStore } from '@/store/playbackSettingsStore';
import { playerStore } from '@/store/playerStore';

import { absoluteFill } from '@/utils/styles';
const MINI_PLAYER_HEIGHT = 56;
/** Matches the placeholder cover art background (rgb 150,150,150). */
const PLACEHOLDER_BG = '#969696';

export function PlayerPhoneMini() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const currentTrack = playerStore((s) => s.currentTrack);
  const songCoverArtId = currentTrack?.coverArt ?? undefined;
  const songAlbumId = currentTrack?.albumId;
  const playbackState = playerStore((s) => s.playbackState);
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const queueLoading = playerStore((s) => s.queueLoading);
  const currentTrackIndex = playerStore((s) => s.currentTrackIndex);
  const queue = playerStore((s) => s.queue);
  const repeatMode = playbackSettingsStore((s) => s.repeatMode);

  // Rendered synchronously from the store each re-render — same contract as
  // PlayerProgressBar so the two surfaces can never visually diverge.
  const progress = duration > 0 ? Math.max(0, Math.min(position / duration, 1)) : 0;

  const error = playerStore((s) => s.error);
  const isPlaying = playbackState === 'playing' || playbackState === 'buffering';
  const isBuffering = playbackState === 'buffering' || playbackState === 'loading';
  const canSkipNext =
    currentTrackIndex != null &&
    (currentTrackIndex < queue.length - 1 || repeatMode !== 'off');

  const handleSkipNext = useCallback(() => {
    if (canSkipNext) skipToNext();
  }, [canSkipNext]);

  const marqueeStyle = useMemo(
    () => [styles.title, { color: queueLoading ? colors.textSecondary : colors.textPrimary }],
    [queueLoading, colors.textSecondary, colors.textPrimary],
  );

  // --- Colour extraction (palette is theme-aware; primary is lightness-clamped
  // for safe icon contrast). ---
  const { primary, gradientOpacity } = useImagePalette(songCoverArtId, songAlbumId);

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

  // --- Full player navigation ---
  const router = useRouter();
  const openPlayer = useCallback(() => router.push('/player'), [router]);

  if (!currentTrack) return null;

  /** Append alpha hex to a colour string (supports #RGB, #RRGGBB). */
  const withAlpha = (hex: string, alpha: number) => {
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `${hex}${a}`;
  };

  // 2-stop vertical gradient: the extracted primary (the dominant/vibrant cover
  // colour, lightness-clamped) → theme background.
  const extractedTop = primary ?? colors.card;
  const topColor = queueLoading ? PLACEHOLDER_BG : extractedTop;
  const gradientColors: readonly [string, string, ...string[]] = [
    withAlpha(topColor, 0.65),
    withAlpha(colors.background, 0.65),
  ];
  const gradientLocations: readonly [number, number, ...number[]] = [0, 1];

  return (
    <View style={[styles.container, { backgroundColor: withAlpha(colors.card, 0.65) }]}>
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: colors.primary,
              opacity: 0.65,
              width: `${progress * 100}%`,
            },
          ]}
        />
      </View>

      {/* Gradient overlay */}
      <Animated.View style={[absoluteFill, gradientAnimatedStyle]} pointerEvents="none">
        <LinearGradient
          colors={gradientColors}
          locations={gradientLocations}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={absoluteFill}
        />
      </Animated.View>

      {/* Tappable area: cover art + track info */}
      <Pressable
        onPress={openPlayer}
        style={({ pressed }) => [styles.touchable, pressed && styles.pressed]}
      >
        {/* Cover art (or placeholder while loading) */}
        {queueLoading ? (
          <View style={[styles.cover, styles.coverPlaceholder, { backgroundColor: 'rgba(150,150,150,0.25)' }]}>
            <WaveformLogo size={16} color="rgba(150,150,150,1)" />
          </View>
        ) : (
          <CachedImage
            coverArtId={songCoverArtId}
            albumId={songAlbumId}
            size={300}
            style={styles.cover}
            resizeMode="cover"
          />
        )}

        {/* Track info */}
        <View style={styles.info}>
          <MarqueeText style={marqueeStyle}>
            {queueLoading ? t('loading') : currentTrack.title}
          </MarqueeText>
          {!queueLoading && (
            <Text style={[styles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
              {currentTrack.artist ?? t('unknownArtist')}
            </Text>
          )}
        </View>
      </Pressable>

      {/* Transport controls */}
      <View style={styles.controls}>
        {/* Play / Pause / Buffering */}
        <Pressable
          onPress={togglePlayPause}
          hitSlop={12}
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        >
          {(isBuffering || queueLoading) ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={28}
              color={error ? colors.red : colors.textPrimary}
            />
          )}
        </Pressable>

        {/* Skip to next */}
        <Pressable
          onPress={handleSkipNext}
          hitSlop={12}
          disabled={!canSkipNext}
          style={({ pressed }) => [styles.skipButton, pressed && canSkipNext && styles.pressed]}
        >
          <Ionicons
            name="play-forward"
            size={22}
            color={colors.textPrimary}
            style={!canSkipNext ? { opacity: 0.35 } : undefined}
          />
        </Pressable>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    zIndex: 1,
  },
  progressFill: {
    height: '100%',
  },
  touchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  info: {
    flex: 1,
    marginLeft: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  artist: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  playButton: {
    marginLeft: 8,
    padding: 4,
  },
  skipButton: {
    padding: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
