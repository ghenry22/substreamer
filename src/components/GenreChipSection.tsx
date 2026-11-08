import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
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
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { type ThemeColors } from '../constants/theme';
import { getOfflineSongsByGenre, getOfflineSongsAll } from '../services/searchService';
import { getRandomSongs, type Child } from '../services/subsonicService';
import { playTrack } from '../services/playerService';
import { shuffleArray } from '../utils/arrayHelpers';
import { connectivityStore } from '../store/connectivityStore';
import { genreStore } from '../store/genreStore';
import { playerStore } from '../store/playerStore';
import { searchStore } from '../store/searchStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { selectionAsync } from '../utils/haptics';
import { VIZ_PALETTE } from '../constants/vizColors';
import { useTheme } from '../hooks/useTheme';
import { hexWithAlpha, readableOn } from '../utils/colors';

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
const CARD_GAP = 2;
const ICON_TILE = 76;

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const GENRE_ICON_RULES: [RegExp, IconName][] = [
  [/rap|hip|trap|drill|grime/, 'mic'],
  [/metal|hardcore|grind/, 'skull'],
  [/rock|punk|grunge/, 'flash'],
  [/electro|techno|house|dance|edm|trance|dub|synth/, 'pulse'],
  [/r&b|rnb|soul|funk|disco/, 'heart'],
  [/jazz|blues|swing/, 'cafe'],
  [/classic|orchestra|opera|piano/, 'musical-notes'],
  [/folk|country|acoustic|bluegrass/, 'leaf'],
  [/ambient|chill|lofi|lo-fi|downtempo|sleep/, 'moon'],
  [/reggae|ska|tropical|latin|salsa/, 'sunny'],
  [/indie|alternative|shoegaze|dream/, 'planet'],
  [/pop|k-pop|j-pop/, 'sparkles'],
  [/soundtrack|score|film|game/, 'film'],
];
const FALLBACK_ICONS: IconName[] = ['disc', 'headset', 'radio', 'rocket', 'diamond', 'star', 'earth', 'flame'];

/** Icon for a genre: keyword match first, otherwise a stable pick from a fallback set. */
function genreIcon(genre: string): IconName {
  const g = genre.toLowerCase();
  for (const [re, icon] of GENRE_ICON_RULES) {
    if (re.test(g)) return icon;
  }
  let hash = 0;
  for (let i = 0; i < g.length; i++) hash = (hash * 31 + g.charCodeAt(i)) | 0;
  return FALLBACK_ICONS[Math.abs(hash) % FALLBACK_ICONS.length];
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
  const tint = useMemo(() => (genre ? genreColor(genre) : '#8A8A8A'), [genre]);
  const icon = useMemo<IconName>(() => (genre ? genreIcon(genre) : 'shuffle'), [genre]);

  const animatedStyle = useAnimatedStyle(() => {
    const d = (scrollX.value - index * itemSize) / itemSize;
    const input = [-2, -1, 0, 1, 2];
    return {
      transform: [
        { translateY: interpolate(d, input, [70, 30, 0, 30, 70], Extrapolation.CLAMP) },
        { rotate: `${interpolate(d, input, [-14, -7, 0, 7, 14], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(d, input, [0.88, 0.94, 1, 0.94, 0.88], Extrapolation.CLAMP) },
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
        { width, height, marginHorizontal: CARD_GAP / 2, transformOrigin: 'center bottom' },
        animatedStyle,
      ]}
    >
      <Pressable onPress={handlePress} style={styles.card}>
        <LinearGradient
          colors={[hexWithAlpha(tint, 0.9), hexWithAlpha(tint, 0.4), hexWithAlpha(tint, 0)]}
          locations={[0, 0.5, 1]}
          style={[
            styles.arch,
            { borderTopLeftRadius: width / 2, borderTopRightRadius: width / 2 },
          ]}
        />
        <View
          style={[
            styles.iconTile,
            { backgroundColor: hexWithAlpha(tint, 0.55), borderColor: 'rgba(255,255,255,0.35)' },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name={icon} size={38} color="#FFFFFF" />
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
  const serverGenres = genreStore((s) => s.genres);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const isServerReachable = connectivityStore((s) => s.isServerReachable);
  const online = !offlineMode && isServerReachable;
  const [mixLoading, setMixLoading] = useState(false);
  const currentTrack = playerStore((s) => s.currentTrack);
  const headerHeight = searchStore((s) => s.headerHeight);
  const scrollX = useSharedValue(0);

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

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const cardWidth = Math.min(Math.round(screenWidth * 0.42), 200);
  const cardHeight = Math.round(cardWidth * 1.5);
  const itemSize = cardWidth + CARD_GAP;
  const sidePad = (screenWidth - cardWidth) / 2 - CARD_GAP / 2;
  const playBg = primaryColor ?? colors.textPrimary;
  const items = useMemo<(string | null)[]>(() => [null, ...genres], [genres]);
  const glow = useMemo(
    () => [genreColor(genres[0] ?? 'a'), genreColor(genres[1] ?? 'b')],
    [genres],
  );

  return (
    <View style={styles.section}>
      <LinearGradient
        colors={[hexWithAlpha(glow[0], 0.5), hexWithAlpha(glow[1], 0.22), 'transparent']}
        locations={[0, 0.45, 1]}
        style={styles.glow}
        pointerEvents="none"
      />
      <View style={[styles.hero, { paddingTop: headerHeight }]}>
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
        {currentTrack && (
          <Pressable
            onPress={handleOpenPlayer}
            style={({ pressed }) => [
              styles.nowPlaying,
              { backgroundColor: 'rgba(255,255,255,0.12)' },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={[styles.nowPlayingText, { color: colors.textPrimary }]} numberOfLines={2}>
              {currentTrack.artist ? `${currentTrack.artist} — ${currentTrack.title}` : currentTrack.title}
            </Text>
          </Pressable>
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
      </View>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={itemSize}
        decelerationRate="fast"
        onScroll={onScroll}
        onMomentumScrollEnd={handleSettle}
        scrollEventThrottle={16}
        style={[styles.fan, { height: cardHeight + ICON_TILE }]}
        contentContainerStyle={{ paddingHorizontal: sidePad, paddingTop: ICON_TILE / 2 }}
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
  nowPlaying: {
    alignSelf: 'stretch',
    marginTop: 22,
    marginHorizontal: 8,
    borderRadius: 32,
    paddingVertical: 14,
    paddingHorizontal: 22,
  },
  nowPlayingText: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
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
  iconTile: {
    width: ICON_TILE,
    height: ICON_TILE,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -ICON_TILE / 2,
    transform: [{ rotate: '-6deg' }],
  },
  cardTitle: {
    marginTop: 14,
    paddingHorizontal: 12,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
});
