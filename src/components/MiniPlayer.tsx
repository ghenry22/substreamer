/**
 * MiniPlayer – sits above the tab bar and displays the currently
 * playing track with cover art, title/artist, and a play/pause button.
 *
 * The background is a horizontal gradient from the extracted cover
 * art colour (left) to the theme background (right).
 */

import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { CachedImage } from './CachedImage';
import { MarqueeText } from './MarqueeText';
import WaveformLogo from './WaveformLogo';
import { useCachedCoverArt } from '../hooks/useCachedCoverArt';
import { useTheme } from '../hooks/useTheme';
import { togglePlayPause } from '../services/playerService';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { playerStore } from '../store/playerStore';
import { getProminentColor, type ExtractedColors } from '../utils/colors';

const COVER_SIZE = 50;
const MINI_PLAYER_HEIGHT = 56;
/** Matches the placeholder cover art background (rgb 150,150,150). */
const PLACEHOLDER_BG = '#969696';

export function MiniPlayer() {
  const { colors } = useTheme();
  const currentTrack = playerStore((s) => s.currentTrack);
  const playbackState = playerStore((s) => s.playbackState);
  const position = playerStore((s) => s.position);
  const duration = playerStore((s) => s.duration);
  const queueLoading = playerStore((s) => s.queueLoading);
  const marqueeScrolling = layoutPreferencesStore((s) => s.marqueeScrolling);

  const progress = duration > 0 ? position / duration : 0;
  const progressAnim = useSharedValue(0);

  useEffect(() => {
    progressAnim.value = withTiming(progress, { duration: 300 });
  }, [progress, progressAnim]);

  const error = playerStore((s) => s.error);
  const isPlaying = playbackState === 'playing' || playbackState === 'buffering';
  const isBuffering = playbackState === 'buffering' || playbackState === 'loading';

  const marqueeStyle = useMemo(
    () => [styles.title, { color: queueLoading ? colors.textSecondary : colors.textPrimary }],
    [queueLoading, colors.textSecondary, colors.textPrimary],
  );

  // --- Colour extraction ---
  const cachedUri = useCachedCoverArt(currentTrack?.coverArt, 50);
  const [bgColor, setBgColor] = useState<string | null>(null);
  const gradientOpacity = useSharedValue(0);

  useEffect(() => {
    if (!currentTrack?.coverArt) {
      setBgColor(null);
      return;
    }
    if (Constants.appOwnership === 'expo') {
      setBgColor(null);
      return;
    }
    const uri = cachedUri;
    if (!uri) {
      setBgColor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getColors } = await import('react-native-image-colors');
        const result = await getColors(uri, {
          fallback: colors.background,
          quality: 'low',
        });
        if (cancelled) return;
        const prominent = getProminentColor(result as ExtractedColors);
        setBgColor(prominent ?? null);
      } catch {
        if (!cancelled) setBgColor(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.coverArt, cachedUri, colors.background]);

  useEffect(() => {
    if (bgColor) {
      gradientOpacity.value = 0;
      gradientOpacity.value = withTiming(1, { duration: 400 });
    } else {
      gradientOpacity.value = withTiming(0, { duration: 300 });
    }
  }, [bgColor, gradientOpacity]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${interpolate(progressAnim.value, [0, 1], [0, 100], Extrapolation.CLAMP)}%`,
  }));

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

  // --- Full player navigation ---
  const router = useRouter();
  const openPlayer = useCallback(() => router.push('/player'), [router]);

  if (!currentTrack) return null;

  const gradientStart = queueLoading ? PLACEHOLDER_BG : (bgColor ?? colors.card);
  const gradientEnd = colors.background;

  /** Append alpha hex to a colour string (supports #RGB, #RRGGBB). */
  const withAlpha = (hex: string, alpha: number) => {
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `${hex}${a}`;
  };

  return (
    <View style={[styles.container, { backgroundColor: withAlpha(colors.card, 0.65) }]}>
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            { backgroundColor: colors.primary, opacity: 0.65 },
            progressStyle,
          ]}
        />
      </View>

      {/* Gradient overlay */}
      <Animated.View style={[StyleSheet.absoluteFillObject, gradientAnimatedStyle]} pointerEvents="none">
        <LinearGradient
          colors={[withAlpha(gradientStart, 0.65), withAlpha(gradientEnd, 0.65)]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
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
            coverArtId={currentTrack.coverArt}
            size={300}
            style={styles.cover}
            resizeMode="cover"
          />
        )}

        {/* Track info */}
        <View style={styles.info}>
          {marqueeScrolling ? (
            <MarqueeText style={marqueeStyle}>
              {queueLoading ? 'Loading...' : currentTrack.title}
            </MarqueeText>
          ) : (
            <Text style={[styles.title, { color: queueLoading ? colors.textSecondary : colors.textPrimary }]} numberOfLines={1}>
              {queueLoading ? 'Loading...' : currentTrack.title}
            </Text>
          )}
          {!queueLoading && (
            <Text style={[styles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
              {currentTrack.artist ?? 'Unknown Artist'}
            </Text>
          )}
        </View>
      </Pressable>

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
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  info: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  artist: {
    fontSize: 12,
    marginTop: 1,
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    marginLeft: 8,
    padding: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
