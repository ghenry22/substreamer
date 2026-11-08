import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
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
const CARD_GAP = 14;

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
  const tint = useMemo(() => (genre ? genreColor(genre) : '#6B6B6B'), [genre]);

  const animatedStyle = useAnimatedStyle(() => {
    const d = (scrollX.value - index * itemSize) / itemSize;
    const input = [-2, -1, 0, 1, 2];
    return {
      transform: [
        { translateY: interpolate(d, input, [64, 22, 0, 22, 64], Extrapolation.CLAMP) },
        { rotate: `${interpolate(d, input, [-26, -13, 0, 13, 26], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(d, input, [0.84, 0.93, 1, 0.93, 0.84], Extrapolation.CLAMP) },
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
      style={[{ width, height, marginHorizontal: CARD_GAP / 2, transformOrigin: 'center bottom' }, animatedStyle]}
    >
      <Pressable onPress={handlePress} style={[styles.card, { borderTopLeftRadius: width / 2, borderTopRightRadius: width / 2 }]}>
        <LinearGradient
          colors={[hexWithAlpha(tint, 0.85), hexWithAlpha(tint, 0.25), colors.card]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.cardIcon}>
          {genre ? (
            <Ionicons name="musical-notes" size={44} color="rgba(255,255,255,0.9)" />
          ) : (
            <Ionicons name="shuffle" size={52} color="rgba(255,255,255,0.9)" />
          )}
        </View>
        <View style={styles.cardFooter}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]} numberOfLines={2}>
            {genre ?? t('mixItUp')}
          </Text>
          {loading ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Ionicons name="play" size={16} color={colors.textPrimary} />
          )}
        </View>
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

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const cardWidth = Math.min(Math.round(screenWidth * 0.5), 220);
  const cardHeight = Math.round(cardWidth * 1.45);
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
      <View style={styles.hero}>
        <Text style={[styles.heroTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {t('homeHeroTitle')}
        </Text>
        <Pressable
          onPress={handlePlayAll}
          style={({ pressed }) => [styles.playButton, { backgroundColor: playBg }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('mixItUp')}
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
        scrollEventThrottle={16}
        style={[styles.fan, { height: cardHeight + 72 }]}
        contentContainerStyle={{ paddingHorizontal: sidePad, paddingTop: 8 }}
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
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cardIcon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 14,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
});
