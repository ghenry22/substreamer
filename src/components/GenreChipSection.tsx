import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { type ThemeColors } from '../constants/theme';
import { getOfflineSongsByGenre, getOfflineSongsAll } from '../services/searchService';
import { getRandomSongs, type Child } from '../services/subsonicService';
import { playTrack, skipToNext, skipToPrevious, togglePlayPause } from '../services/playerService';
import { shuffleArray } from '../utils/arrayHelpers';
import { connectivityStore } from '../store/connectivityStore';
import { genreStore } from '../store/genreStore';
import { playerStore } from '../store/playerStore';
import { searchStore } from '../store/searchStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { selectionAsync } from '../utils/haptics';
import { useImagePalette } from '../hooks/useImagePalette';
import { usePlaybackState } from '../hooks/usePlaybackState';
import { useTheme } from '../hooks/useTheme';
import { CachedImage } from './CachedImage';
import { FavoriteButton } from './FavoriteButton';
import { hexWithAlpha, readableOn } from '../utils/colors';
import { GenreCarousel, genreColor } from './GenreCarousel';
import { LightRaysBackground } from './LightRaysBackground';

const MAX_GENRES = 8;


function isOnline(): boolean {
  const { offlineMode } = offlineModeStore.getState();
  if (offlineMode) return false;
  const { isServerReachable } = connectivityStore.getState();
  return isServerReachable;
}

async function playGenre(genre: string): Promise<boolean> {
  const { listLength } = layoutPreferencesStore.getState();
  let songs: Child[] | null;

  if (isOnline()) {
    songs = await getRandomSongs(listLength, genre);
  } else {
    songs = getOfflineSongsByGenre(genre);
    if (songs) songs = shuffleArray(songs).slice(0, listLength);
  }

  if (!songs || songs.length === 0) return false;

  await playTrack(songs[0], songs);
  return true;
}

async function playRandomMix(): Promise<void> {
  const { listLength } = layoutPreferencesStore.getState();
  let songs: Child[] | null;
  if (isOnline()) {
    songs = await getRandomSongs(listLength);
  } else {
    songs = getOfflineSongsAll();
    if (songs) songs = shuffleArray(songs).slice(0, listLength);
  }
  if (songs && songs.length > 0) {
    await playTrack(songs[0], songs);
  }
}

interface GenreChipSectionProps {
  genreCounts: Record<string, number>;
  colors: ThemeColors;
}

export const GenreChipSection = memo(function GenreChipSection({
  genreCounts,
  colors,
}: GenreChipSectionProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { primaryColor } = useTheme();
  const serverGenres = genreStore((s) => s.genres);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const isServerReachable = connectivityStore((s) => s.isServerReachable);
  const online = !offlineMode && isServerReachable;
  const [mixLoading, setMixLoading] = useState(false);
  const currentTrack = playerStore((s) => s.currentTrack);
  const headerHeight = searchStore((s) => s.headerHeight);
  const { isPlaying, isBuffering } = usePlaybackState();
  const { primary: palettePrimary, secondary: paletteSecondary } = useImagePalette(
    currentTrack?.coverArt ?? undefined,
    currentTrack?.albumId,
  );

  const heroShift = useSharedValue(0);
  const heroShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: heroShift.value }],
  }));
  const handleSwipeSkip = useCallback((direction: 'next' | 'previous') => {
    selectionAsync();
    void (direction === 'next' ? skipToNext() : skipToPrevious()).catch(() => {});
  }, []);
  const hasTrack = currentTrack != null;
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(hasTrack)
        .activeOffsetX([-20, 20])
        .failOffsetY([-15, 15])
        .onUpdate((e) => {
          heroShift.value = e.translationX * 0.4;
        })
        .onEnd((e) => {
          if (e.translationX < -60) runOnJS(handleSwipeSkip)('next');
          else if (e.translationX > 60) runOnJS(handleSwipeSkip)('previous');
        })
        .onFinalize(() => {
          heroShift.value = withSpring(0, { damping: 18, stiffness: 180 });
        }),
    [hasTrack, heroShift, handleSwipeSkip],
  );

  const genres = useMemo(() => {
    // Start with listening history genres sorted by play count
    const historyGenres = Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([genre]) => genre);

    if (historyGenres.length >= MAX_GENRES) {
      return historyGenres.slice(0, MAX_GENRES);
    }

    // Backfill from server genres (sorted by songCount desc)
    const existing = new Set(historyGenres.map((g) => g.toLowerCase()));
    const result = [...historyGenres];

    if (serverGenres.length > 0) {
      const sorted = [...serverGenres].sort(
        (a, b) => (b.songCount ?? 0) - (a.songCount ?? 0)
      );
      for (const g of sorted) {
        if (result.length >= MAX_GENRES) break;
        if (!existing.has(g.value.toLowerCase())) {
          existing.add(g.value.toLowerCase());
          result.push(g.value);
        }
      }
    }

    return result;
  }, [genreCounts, serverGenres]);

  const handleTunedInPress = useCallback(() => {
    router.push('/tuned-in');
  }, [router]);

  const handleOpenPlayer = useCallback(() => {
    router.push('/player');
  }, [router]);

  const handlePlayAll = useCallback(async () => {
    if (mixLoading) return;
    selectionAsync();
    setMixLoading(true);
    try {
      await playRandomMix();
    } finally {
      setMixLoading(false);
    }
  }, [mixLoading]);

  const handleSelectGenre = useCallback(
    (genre: string | null) => (genre ? playGenre(genre) : playRandomMix()),
    [],
  );
  const handleSettleGenre = useCallback((genre: string | null) => {
    selectionAsync();
    void (genre ? playGenre(genre) : playRandomMix()).catch(() => {});
  }, []);

  const playBg = primaryColor ?? colors.textPrimary;
  const glow = useMemo(
    () => [
      currentTrack && palettePrimary ? palettePrimary : genreColor(genres[0] ?? 'a'),
      currentTrack && paletteSecondary ? paletteSecondary : genreColor(genres[1] ?? 'b'),
    ],
    [genres, currentTrack, palettePrimary, paletteSecondary],
  );

  return (
    <View style={styles.section}>
      {/* Re-keyed per colour pair so each new track cross-fades the glow. */}
      <Animated.View
        key={`${glow[0]}${glow[1]}`}
        entering={FadeIn.duration(700)}
        exiting={FadeOut.duration(700)}
        style={styles.glow}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[hexWithAlpha(glow[0], 0.6), hexWithAlpha(glow[1], 0.28), 'transparent']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {/* Above the cover-colour glow so the beams stay visible. */}
      <LightRaysBackground />
      <GestureDetector gesture={swipeGesture}>
      <Animated.View style={[styles.hero, { paddingTop: headerHeight }, heroShiftStyle]}>
        {currentTrack ? (
          <>
            <Text
              style={[styles.artistTitle, { color: colors.textPrimary }]}
              numberOfLines={2}
              adjustsFontSizeToFit
            >
              {currentTrack.artist || currentTrack.title}
            </Text>
            <Pressable onPress={handleOpenPlayer} accessibilityRole="button">
              <CachedImage
                coverArtId={currentTrack.coverArt ?? undefined}
                albumId={currentTrack.albumId}
                size={300}
                style={styles.cover}
                resizeMode="cover"
              />
            </Pressable>
            <View style={styles.controlRow}>
              <Pressable
                onPress={togglePlayPause}
                style={({ pressed }) => [styles.roundControl, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {isBuffering ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={26}
                    color={colors.textPrimary}
                  />
                )}
              </Pressable>
              <Pressable
                onPress={handleOpenPlayer}
                style={({ pressed }) => [styles.trackPill, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={[styles.trackPillText, { color: colors.textPrimary }]} numberOfLines={1}>
                  {currentTrack.title}
                </Text>
              </Pressable>
              <View style={styles.roundControl}>
                <FavoriteButton trackId={currentTrack.id} size={26} />
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.heroTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {t('homeHeroTitle')}
            </Text>
            <Pressable
              onPress={handlePlayAll}
              style={({ pressed }) => [styles.playButton, { backgroundColor: playBg }, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('randomMix')}
            >
              {mixLoading ? (
                <ActivityIndicator size="small" color={readableOn(playBg)} />
              ) : (
                <Ionicons name="play" size={34} color={readableOn(playBg)} style={styles.playGlyph} />
              )}
            </Pressable>
          </>
        )}
        {online && (
          <Pressable
            onPress={handleTunedInPress}
            hitSlop={8}
            style={({ pressed }) => [styles.tunedIn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('openTunedIn')}
          >
            <Text style={[styles.tunedInText, { color: colors.textSecondary }]}>{t('tunedIn')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
        )}
      </Animated.View>
      </GestureDetector>
      <GenreCarousel
        genres={genres}
        colors={colors}
        onSelect={handleSelectGenre}
        onSettle={handleSettleGenre}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    flex: 1,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '70%',
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  artistTitle: {
    alignSelf: 'stretch',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
    textAlign: 'center',
    lineHeight: 46,
  },
  cover: {
    width: 120,
    height: 120,
    borderRadius: 26,
    marginTop: 14,
  },
  controlRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  roundControl: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  trackPill: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  trackPillText: {
    fontSize: 16,
    fontWeight: '700',
  },
  heroTitle: {
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -1,
    textAlign: 'center',
  },
  tunedIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 16,
  },
  tunedInText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
  playButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  playGlyph: {
    marginLeft: 3,
  },
});
