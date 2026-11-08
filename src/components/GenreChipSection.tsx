import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { memo, useCallback, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
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
import { VIZ_PALETTE } from '../constants/vizColors';
import { useImagePalette } from '../hooks/useImagePalette';
import { usePlaybackState } from '../hooks/usePlaybackState';
import { useTheme } from '../hooks/useTheme';
import { CachedImage } from './CachedImage';
import { FavoriteButton } from './FavoriteButton';
import { hexWithAlpha, mixHexColors, readableOn } from '../utils/colors';

const MAX_GENRES = 8;


/** Deterministic color for a genre name (stable across re-renders/sessions). */
function genreColor(genre: string): string {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = (hash * 31 + genre.charCodeAt(i)) | 0;
  }
  return VIZ_PALETTE[Math.abs(hash) % VIZ_PALETTE.length];
}

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

const SHUFFLE_KEY = '__shuffle__';
const ICON_TILE = 76;
const ICON_GLYPH = 44;
const TAB_BAR_BASE_HEIGHT = 56;
const SPREAD = 0.78;
const RIM = 1.5;

type IconName = ComponentProps<typeof Ionicons>['name'];

interface GenreStyle {
  icon: IconName;
  color: string;
}

const GENRE_STYLE_RULES: [RegExp, GenreStyle][] = [
  [/rap|hip|trap|drill|grime/, { icon: 'mic', color: '#F5A524' }],
  [/rock|punk|grunge|metal|hardcore/, { icon: 'musical-notes', color: '#34D058' }],
  [/electro|techno|house|dance|edm|trance|dub|synth/, { icon: 'headset', color: '#2EA8FF' }],
  [/jazz|blues|swing|soul|funk/, { icon: 'stats-chart', color: '#A23DFF' }],
  [/pop|r&b|rnb|disco/, { icon: 'sparkles', color: '#B65CFF' }],
  [/classic|orchestra|opera|piano/, { icon: 'musical-note', color: '#E8C26A' }],
  [/folk|country|acoustic|bluegrass/, { icon: 'leaf', color: '#7BC043' }],
  [/ambient|chill|lofi|lo-fi|downtempo|sleep/, { icon: 'moon', color: '#6C8CFF' }],
  [/reggae|ska|tropical|latin|salsa/, { icon: 'sunny', color: '#FF8A3D' }],
  [/indie|alternative|shoegaze|dream/, { icon: 'planet', color: '#FF5C9A' }],
  [/soundtrack|score|film|game/, { icon: 'film', color: '#4DD0C8' }],
];
const FALLBACK_ICONS: IconName[] = ['disc', 'radio', 'rocket', 'diamond', 'star', 'earth', 'flame'];

/** Icon and neon colour for a genre: keyword match first, otherwise a stable pick. */
function genreStyle(genre: string): GenreStyle {
  const g = genre.toLowerCase();
  for (const [re, style] of GENRE_STYLE_RULES) {
    if (re.test(g)) return style;
  }
  let hash = 0;
  for (let i = 0; i < g.length; i++) hash = (hash * 31 + g.charCodeAt(i)) | 0;
  return {
    icon: FALLBACK_ICONS[Math.abs(hash) % FALLBACK_ICONS.length],
    color: genreColor(genre),
  };
}

interface FanCardProps {
  index: number;
  scrollX: SharedValue<number>;
  itemSize: number;
  width: number;
  height: number;
  /** null renders the shuffle-everything card. */
  genre: string | null;
  colors: ThemeColors;
}

const FanCard = memo(function FanCard({
  index,
  scrollX,
  itemSize,
  width,
  height,
  genre,
  colors,
}: FanCardProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const { icon, color: tint } = useMemo<GenreStyle>(() => {
    const base = genre ? genreStyle(genre) : { icon: 'shuffle' as IconName, color: '#E6E6E6' };
    // Pull the neon accents towards grey so the cards read as calm glass.
    return { icon: base.icon, color: mixHexColors(base.color, '#707070', 0.3) };
  }, [genre]);

  const glowColor = useMemo(() => mixHexColors(tint, '#FFFFFF', 0.4), [tint]);

  const animatedStyle = useAnimatedStyle(() => {
    const d = (scrollX.value - index * itemSize) / itemSize;
    const input = [-2, -1, 0, 1, 2];
    return {
      zIndex: 10 - Math.round(Math.abs(d)),
      opacity: interpolate(d, input, [0.5, 0.78, 1, 0.78, 0.5], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(d, input, [48, 22, 0, 22, 48], Extrapolation.CLAMP) },
        { rotate: `${interpolate(d, input, [-6, -3, 0, 3, 6], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(d, input, [0.8, 0.9, 1, 0.9, 0.8], Extrapolation.CLAMP) },
      ],
    };
  });

  const handlePress = useCallback(async () => {
    if (loading) return;
    selectionAsync();
    setLoading(true);
    try {
      if (genre) await playGenre(genre);
      else await playRandomMix();
    } finally {
      setLoading(false);
    }
  }, [genre, loading]);

  return (
    <Animated.View
      style={[
        { width, height, marginHorizontal: (itemSize - width) / 2, transformOrigin: 'center bottom' },
        animatedStyle,
      ]}
    >
      <Pressable onPress={handlePress} style={styles.card}>
        {/* Rim: a bright edge that fades out towards the bottom. */}
        <LinearGradient
          colors={[hexWithAlpha(tint, 0.7), hexWithAlpha(tint, 0.25), hexWithAlpha(tint, 0)]}
          locations={[0, 0.45, 0.85]}
          style={[styles.arch, { borderTopLeftRadius: width / 2, borderTopRightRadius: width / 2 }]}
        />
        {/* Body: dark glass with a coloured tint near the top. */}
        <View
          style={[
            styles.archBody,
            {
              top: RIM,
              left: RIM,
              right: RIM,
              borderTopLeftRadius: width / 2 - RIM,
              borderTopRightRadius: width / 2 - RIM,
            },
          ]}
        >
          <LinearGradient
            colors={[colors.background, colors.background, hexWithAlpha(colors.background, 0)]}
            locations={[0, 0.4, 0.85]}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[hexWithAlpha(tint, 0.32), hexWithAlpha(tint, 0.08), hexWithAlpha(tint, 0)]}
            locations={[0, 0.45, 0.85]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View
          style={[
            styles.iconTile,
            { backgroundColor: hexWithAlpha(tint, 0.3), borderColor: 'rgba(255,255,255,0.3)' },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']}
            style={StyleSheet.absoluteFill}
          />
          {loading ? (
            <ActivityIndicator size="large" color={glowColor} />
          ) : (
            <Ionicons
              name={icon}
              size={ICON_GLYPH}
              color={glowColor}
              style={{
                textShadowColor: hexWithAlpha(tint, 0.6),
                textShadowRadius: 10,
                textShadowOffset: { width: 0, height: 0 },
              }}
            />
          )}
        </View>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]} numberOfLines={2}>
          {genre ?? t('randomMix')}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

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
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarHeight = TAB_BAR_BASE_HEIGHT + insets.bottom;
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
  const scrollX = useSharedValue(0);

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

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const cardWidth = Math.min(Math.round(screenWidth * 0.44), 210);
  const cardHeight = Math.round(cardWidth * 1.4);
  // Neighbouring cards overlap: the layout pitch equals the snap interval, so the
  // card the fan rests on is always the one centred on screen.
  const itemSize = Math.round(cardWidth * SPREAD);
  const sidePad = (screenWidth - cardWidth) / 2 - (itemSize - cardWidth) / 2;
  const playBg = primaryColor ?? colors.textPrimary;
  const items = useMemo<(string | null)[]>(() => [null, ...genres], [genres]);

  const settledIndex = useRef(0);
  const handleSettle = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / itemSize);
      if (i === settledIndex.current || i < 0 || i >= items.length) return;
      settledIndex.current = i;
      selectionAsync();
      const genre = items[i];
      void (genre ? playGenre(genre) : playRandomMix()).catch(() => {});
    },
    [itemSize, items],
  );
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
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={itemSize}
        decelerationRate="fast"
        onScroll={onScroll}
        onMomentumScrollEnd={handleSettle}
        scrollEventThrottle={16}
        style={[
          styles.fan,
          { height: cardHeight + ICON_TILE * 0.6, marginBottom: tabBarHeight - 28 },
        ]}
        contentContainerStyle={{ paddingHorizontal: sidePad, paddingTop: ICON_TILE * 0.6 }}
      >
        {items.map((genre, index) => (
          <FanCard
            key={genre ?? SHUFFLE_KEY}
            index={index}
            scrollX={scrollX}
            itemSize={itemSize}
            width={cardWidth}
            height={cardHeight}
            genre={genre}
            colors={colors}
          />
        ))}
      </Animated.ScrollView>
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
  fan: {
    alignSelf: 'stretch',
    flexGrow: 0,
  },
  card: {
    flex: 1,
    alignItems: 'center',
  },
  arch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  archBody: {
    position: 'absolute',
    bottom: 0,
    overflow: 'hidden',
  },
  iconTile: {
    width: ICON_TILE,
    height: ICON_TILE,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -ICON_TILE * 0.55,
    transform: [{ rotate: '-6deg' }],
  },
  cardTitle: {
    marginTop: 10,
    paddingHorizontal: 14,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
});
