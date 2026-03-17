import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { type ThemeColors } from '../constants/theme';
import { getOfflineSongsByGenre } from '../services/searchService';
import { getRandomSongs, type Child } from '../services/subsonicService';
import { playTrack } from '../services/playerService';
import { connectivityStore } from '../store/connectivityStore';
import { genreStore } from '../store/genreStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { selectionAsync } from '../utils/haptics';

const MAX_GENRE_CHIPS = 8;

const GENRE_PALETTE = [
  '#6366F1', // indigo
  '#F59E0B', // amber
  '#10B981', // emerald
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#3B82F6', // blue
  '#84CC16', // lime
];

/** Deterministic color for a genre name (stable across re-renders/sessions). */
function genreColor(genre: string): string {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = (hash * 31 + genre.charCodeAt(i)) | 0;
  }
  return GENRE_PALETTE[Math.abs(hash) % GENRE_PALETTE.length];
}

/** Fisher-Yates shuffle (in-place, returns same array). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isOnline(): boolean {
  const { offlineMode } = offlineModeStore.getState();
  if (offlineMode) return false;
  const { isServerReachable } = connectivityStore.getState();
  return isServerReachable;
}

async function playGenre(genre: string): Promise<boolean> {
  let songs: Child[] | null;

  if (isOnline()) {
    songs = await getRandomSongs(20, genre);
  } else {
    songs = getOfflineSongsByGenre(genre);
    if (songs) shuffle(songs);
  }

  if (!songs || songs.length === 0) return false;

  await playTrack(songs[0], songs);
  return true;
}

interface GenreChipProps {
  genre: string;
  index: number;
  colors: ThemeColors;
}

const GenreChip = memo(function GenreChip({ genre, index, colors }: GenreChipProps) {
  const [loading, setLoading] = useState(false);
  const color = useMemo(() => genreColor(genre), [genre]);

  // Staggered entrance
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);
  useEffect(() => {
    opacity.value = withDelay(index * 60, withTiming(1, { duration: 350 }));
    translateY.value = withDelay(index * 60, withTiming(0, { duration: 350 }));
  }, [index, opacity, translateY]);

  // Press scale
  const scale = useSharedValue(1);
  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 150 });
  }, [scale]);
  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 150 });
  }, [scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const handlePress = useCallback(async () => {
    if (loading) return;
    selectionAsync();
    setLoading(true);
    try {
      await playGenre(genre);
    } finally {
      setLoading(false);
    }
  }, [genre, loading]);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.chip,
          {
            backgroundColor: color + '1A',
            borderColor: color + '4D',
          },
        ]}
      >
        {loading && (
          <ActivityIndicator size={12} color={color} />
        )}
        <Text
          style={[styles.chipText, { color: colors.textPrimary }]}
          numberOfLines={1}
        >
          {genre}
        </Text>
        <Ionicons name="play" size={12} color={color} />
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
  const router = useRouter();
  const serverGenres = genreStore((s) => s.genres);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const isServerReachable = connectivityStore((s) => s.isServerReachable);
  const online = !offlineMode && isServerReachable;

  const genres = useMemo(() => {
    // Start with listening history genres sorted by play count
    const historyGenres = Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([genre]) => genre);

    if (historyGenres.length >= MAX_GENRE_CHIPS) {
      return historyGenres.slice(0, MAX_GENRE_CHIPS);
    }

    // Backfill from server genres (sorted by songCount desc)
    const existing = new Set(historyGenres.map((g) => g.toLowerCase()));
    const result = [...historyGenres];

    if (serverGenres.length > 0) {
      const sorted = [...serverGenres].sort(
        (a, b) => (b.songCount ?? 0) - (a.songCount ?? 0)
      );
      for (const g of sorted) {
        if (result.length >= MAX_GENRE_CHIPS) break;
        if (!existing.has(g.value.toLowerCase())) {
          existing.add(g.value.toLowerCase());
          result.push(g.value);
        }
      }
    }

    return result;
  }, [genreCounts, serverGenres]);

  const handleDiscoveryPress = useCallback(() => {
    router.push('/discovery');
  }, [router]);

  if (genres.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        {online ? (
          <Pressable
            onPress={handleDiscoveryPress}
            style={({ pressed }) => [{ flex: 1 }, pressed && styles.headerPressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open Discovery Mix"
          >
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              Discovery
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.title, { color: colors.textPrimary, flex: 1 }]}>
            Discovery
          </Text>
        )}
        {online && (
          <Pressable
            onPress={handleDiscoveryPress}
            style={({ pressed }) => [styles.chevronButton, pressed && styles.headerPressed]}
            hitSlop={8}
          >
            <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {genres.map((genre, index) => (
          <GenreChip
            key={genre}
            genre={genre}
            index={index}
            colors={colors}
          />
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerPressed: {
    opacity: 0.6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  chevronButton: {
    padding: 4,
  },
  chipRow: {
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 21,
    borderWidth: 1,
    gap: 8,
    maxWidth: 200,
  },
  chipText: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
});
