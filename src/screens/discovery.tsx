import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { SectionTitle } from '../components/SectionTitle';
import {
  DECADES,
  fetchCustomMix,
  fetchMixSongs,
  generateMixes,
  type MixDefinition,
} from '../services/discoveryService';
import { getOfflineSongsByGenre } from '../services/searchService';
import { playTrack } from '../services/playerService';
import { type Child } from '../services/subsonicService';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { connectivityStore } from '../store/connectivityStore';
import { favoritesStore } from '../store/favoritesStore';
import { genreStore } from '../store/genreStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { type ThemeColors } from '../constants/theme';
import { selectionAsync } from '../utils/haptics';

const MAX_SELECTED_GENRES = 3;
const MAX_BUILDER_GENRES = 30;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isOnline(): boolean {
  const { offlineMode } = offlineModeStore.getState();
  if (offlineMode) return false;
  const { isServerReachable } = connectivityStore.getState();
  return isServerReachable;
}

const GENRE_PALETTE = [
  '#6366F1', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#3B82F6', '#84CC16',
];

function genreColor(genre: string): string {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = (hash * 31 + genre.charCodeAt(i)) | 0;
  }
  return GENRE_PALETTE[Math.abs(hash) % GENRE_PALETTE.length];
}

/* ------------------------------------------------------------------ */
/*  MixCard                                                            */
/* ------------------------------------------------------------------ */

const MixCard = memo(function MixCard({
  mix,
  index,
  colors,
}: {
  mix: MixDefinition;
  index: number;
  colors: ThemeColors;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Staggered entrance
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);
  useEffect(() => {
    opacity.value = withDelay(index * 80, withTiming(1, { duration: 400 }));
    translateY.value = withDelay(index * 80, withTiming(0, { duration: 400 }));
  }, [index, opacity, translateY]);

  // Press scale
  const scale = useSharedValue(1);
  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.97, { damping: 15, stiffness: 150 });
  }, [scale]);
  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 150 });
  }, [scale]);

  // Loading gradient pulse
  const gradientOpacity = useSharedValue(1);
  useEffect(() => {
    if (loading) {
      gradientOpacity.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 800 }),
          withTiming(1, { duration: 800 }),
        ),
        -1,
      );
    } else {
      gradientOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [loading, gradientOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

  const handlePress = useCallback(async () => {
    if (loading) return;
    setError(null);
    selectionAsync();
    setLoading(true);
    try {
      const songs = await fetchMixSongs(mix.fetchStrategy);
      if (songs.length === 0) {
        setError('No songs found');
        return;
      }
      await playTrack(songs[0], songs);
    } catch {
      setError('Failed to load');
    } finally {
      setLoading(false);
    }
  }, [mix.fetchStrategy, loading]);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.mixCardOuter}
      >
        <Animated.View style={[styles.mixCardGradientWrapper, gradientAnimatedStyle]}>
          <LinearGradient
            colors={mix.gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.mixCardGradient}
          >
            <View style={styles.mixCardContent}>
              <View style={styles.mixCardIcon}>
                <Ionicons name={mix.icon} size={28} color="#ffffffCC" />
              </View>
              <View style={styles.mixCardText}>
                <Text style={styles.mixCardName} numberOfLines={1}>
                  {mix.name}
                </Text>
                <Text style={styles.mixCardSubtitle} numberOfLines={2}>
                  {error ?? mix.subtitle}
                </Text>
              </View>
              <View style={styles.mixCardAction}>
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffffCC" />
                ) : (
                  <View style={styles.playButton}>
                    <Ionicons name="play" size={20} color="#fff" />
                  </View>
                )}
              </View>
            </View>
          </LinearGradient>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

/* ------------------------------------------------------------------ */
/*  GenreChip (builder)                                                */
/* ------------------------------------------------------------------ */

const BuilderGenreChip = memo(function BuilderGenreChip({
  genre,
  selected,
  onToggle,
  colors,
}: {
  genre: string;
  selected: boolean;
  onToggle: (genre: string) => void;
  colors: ThemeColors;
}) {
  const color = useMemo(() => genreColor(genre), [genre]);
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    selectionAsync();
    scale.value = withSequence(
      withSpring(1.1, { damping: 15, stiffness: 150 }),
      withSpring(1, { damping: 15, stiffness: 150 }),
    );
    onToggle(genre);
  }, [genre, onToggle, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={handlePress}
        style={[
          styles.builderChip,
          selected
            ? { backgroundColor: color, borderColor: color }
            : { backgroundColor: color + '1A', borderColor: color + '4D' },
        ]}
      >
        <Text
          style={[
            styles.builderChipText,
            { color: selected ? '#fff' : colors.textPrimary },
          ]}
          numberOfLines={1}
        >
          {genre}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

/* ------------------------------------------------------------------ */
/*  DecadePill                                                         */
/* ------------------------------------------------------------------ */

const DecadePill = memo(function DecadePill({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.decadePill,
        selected
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text
        style={[
          styles.decadePillText,
          { color: selected ? '#fff' : colors.textSecondary },
          selected && styles.decadePillTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
});

/* ------------------------------------------------------------------ */
/*  CustomMixBuilder                                                   */
/* ------------------------------------------------------------------ */

const GenreSearchResult = memo(function GenreSearchResult({
  genre,
  onSelect,
  colors,
}: {
  genre: string;
  onSelect: (genre: string) => void;
  colors: ThemeColors;
}) {
  const handlePress = useCallback(() => {
    onSelect(genre);
  }, [genre, onSelect]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.searchResult,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.border + '40' },
      ]}
    >
      <Text style={[styles.searchResultText, { color: colors.textPrimary }]} numberOfLines={1}>
        {genre}
      </Text>
      <Ionicons name="add-circle-outline" size={20} color={colors.textSecondary} />
    </Pressable>
  );
});

const CustomMixBuilder = memo(function CustomMixBuilder({
  colors,
  availableGenres,
}: {
  colors: ThemeColors;
  availableGenres: string[];
}) {
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedDecadeIndex, setSelectedDecadeIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [addedGenres, setAddedGenres] = useState<string[]>([]);
  const chipScrollRef = useRef<ScrollView>(null);
  const online = isOnline();

  const serverGenres = genreStore((s) => s.genres);

  // Merge added genres (from search) to the front of the chip list
  const displayGenres = useMemo(() => {
    const availableSet = new Set(availableGenres.map((g) => g.toLowerCase()));
    const extraGenres = addedGenres.filter((g) => !availableSet.has(g.toLowerCase()));
    return [...extraGenres, ...availableGenres];
  }, [availableGenres, addedGenres]);

  // Filter full server genre list for search
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) return [];

    const displaySet = new Set(displayGenres.map((g) => g.toLowerCase()));

    return serverGenres
      .filter((g) => {
        const name = g.value.toLowerCase();
        return name.includes(query) && !displaySet.has(name);
      })
      .slice(0, 8)
      .map((g) => g.value);
  }, [searchQuery, serverGenres, displayGenres]);

  const handleToggleGenre = useCallback((genre: string) => {
    setSelectedGenres((prev) => {
      if (prev.includes(genre)) return prev.filter((g) => g !== genre);
      if (prev.length >= MAX_SELECTED_GENRES) return prev;
      return [...prev, genre];
    });
  }, []);

  const handleSelectSearchResult = useCallback((genre: string) => {
    selectionAsync();
    setAddedGenres((prev) => [genre, ...prev.filter((g) => g !== genre)]);
    setSelectedGenres((prev) => {
      if (prev.includes(genre)) return prev;
      if (prev.length >= MAX_SELECTED_GENRES) return prev;
      return [genre, ...prev];
    });
    setSearchQuery('');
    chipScrollRef.current?.scrollTo({ x: 0, animated: true });
  }, []);

  const handleDecadePress = useCallback((index: number) => {
    selectionAsync();
    setSelectedDecadeIndex(index);
  }, []);

  const handlePlay = useCallback(async () => {
    if (selectedGenres.length === 0 || loading) return;
    selectionAsync();
    setLoading(true);
    try {
      const decade = DECADES[selectedDecadeIndex];
      const songs = await fetchCustomMix(
        selectedGenres,
        decade.fromYear,
        decade.toYear,
        online,
      );
      if (songs.length > 0) {
        await playTrack(songs[0], songs);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedGenres, selectedDecadeIndex, loading, online]);

  // Section entrance
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);
  useEffect(() => {
    opacity.value = withDelay(400, withTiming(1, { duration: 400 }));
    translateY.value = withDelay(400, withTiming(0, { duration: 400 }));
  }, [opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (availableGenres.length === 0 && serverGenres.length === 0) return null;

  return (
    <Animated.View style={animatedStyle}>
      <SectionTitle title="Build a Mix" color={colors.textSecondary} />
      <View style={[styles.builderCard, { backgroundColor: colors.card }]}>
        {/* Genre chips */}
        <Text style={[styles.builderLabel, { color: colors.textSecondary }]}>
          Genres {selectedGenres.length > 0 ? `(${selectedGenres.length}/${MAX_SELECTED_GENRES})` : ''}
        </Text>

        {/* Genre search input */}
        <View style={[styles.searchInputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search genres..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Search results dropdown */}
        {searchResults.length > 0 && (
          <View style={[styles.searchResultsList, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
            {searchResults.map((genre) => (
              <GenreSearchResult
                key={genre}
                genre={genre}
                onSelect={handleSelectSearchResult}
                colors={colors}
              />
            ))}
          </View>
        )}

        <ScrollView
          ref={chipScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.builderChipRow}
          style={styles.chipScrollView}
        >
          {displayGenres.map((genre) => (
            <BuilderGenreChip
              key={genre}
              genre={genre}
              selected={selectedGenres.includes(genre)}
              onToggle={handleToggleGenre}
              colors={colors}
            />
          ))}
        </ScrollView>

        {/* Decade selector */}
        <Text style={[styles.builderLabel, { color: colors.textSecondary, marginTop: 16 }]}>
          Decade
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.decadeRow}
        >
          {DECADES.map((decade, i) => (
            <DecadePill
              key={decade.label}
              label={decade.label}
              selected={selectedDecadeIndex === i}
              onPress={() => handleDecadePress(i)}
              colors={colors}
            />
          ))}
        </ScrollView>

        {/* Play button */}
        <Pressable
          onPress={handlePlay}
          disabled={selectedGenres.length === 0 || loading}
          style={[
            styles.playMixButton,
            {
              backgroundColor: selectedGenres.length > 0 ? colors.primary : colors.border,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="play" size={18} color="#fff" />
              <Text style={styles.playMixButtonText}>Play Mix</Text>
            </>
          )}
        </Pressable>
      </View>
    </Animated.View>
  );
});

/* ------------------------------------------------------------------ */
/*  DiscoveryScreen                                                    */
/* ------------------------------------------------------------------ */

export function DiscoveryScreen() {
  const { colors } = useTheme();
  const transitionComplete = useTransitionComplete();

  const aggregates = completedScrobbleStore((s) => s.aggregates);
  const completedScrobbles = completedScrobbleStore((s) => s.completedScrobbles);
  const starredSongs = favoritesStore((s) => s.songs);
  const online = !offlineModeStore((s) => s.offlineMode) && connectivityStore((s) => s.isServerReachable);

  const serverGenres = genreStore((s) => s.genres);

  // Compute smart mixes
  const mixes = useMemo(() => {
    const scrobbles = completedScrobbles.map((s) => ({
      time: s.time,
      song: s.song as { genre?: string; genres?: unknown[]; artist?: string; artistId?: string },
    }));

    return generateMixes({
      hourBuckets: aggregates.hourBuckets,
      genreCounts: aggregates.genreCounts,
      songCounts: aggregates.songCounts,
      artistCounts: aggregates.artistCounts,
      scrobbles,
      starredSongs,
      isOnline: online,
    });
  }, [aggregates, completedScrobbles, starredSongs, online]);

  // Available genres for the builder
  const builderGenres = useMemo(() => {
    const historyGenres = Object.entries(aggregates.genreCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([genre]) => genre);

    if (!online) {
      // Offline: only genres present in cached tracks
      const offlineGenres = new Set<string>();
      for (const genre of historyGenres) {
        const songs = getOfflineSongsByGenre(genre);
        if (songs.length > 0) offlineGenres.add(genre);
      }
      return Array.from(offlineGenres);
    }

    const existing = new Set(historyGenres.map((g) => g.toLowerCase()));
    const result = [...historyGenres];

    if (serverGenres.length > 0) {
      const sorted = [...serverGenres].sort(
        (a, b) => (b.songCount ?? 0) - (a.songCount ?? 0),
      );
      for (const g of sorted) {
        if (result.length >= MAX_BUILDER_GENRES) break;
        if (!existing.has(g.value.toLowerCase())) {
          existing.add(g.value.toLowerCase());
          result.push(g.value);
        }
      }
    }

    return result;
  }, [aggregates.genreCounts, serverGenres, online]);

  if (!transitionComplete) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* For You section */}
      {mixes.length > 0 && (
        <View style={styles.section}>
          <SectionTitle title="For You" color={colors.textSecondary} />
          <View style={styles.mixList}>
            {mixes.map((mix, index) => (
              <MixCard key={mix.id} mix={mix} index={index} colors={colors} />
            ))}
          </View>
        </View>
      )}

      {/* Build a Mix section */}
      <View style={styles.section}>
        <CustomMixBuilder colors={colors} availableGenres={builderGenres} />
      </View>

      <View style={styles.footer} />
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginBottom: 24,
  },
  mixList: {
    gap: 12,
  },
  mixCardOuter: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  mixCardGradientWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  mixCardGradient: {
    borderRadius: 16,
    padding: 20,
    minHeight: 120,
    justifyContent: 'center',
  },
  mixCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  mixCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mixCardText: {
    flex: 1,
    gap: 4,
  },
  mixCardName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  mixCardSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffffBB',
    lineHeight: 19,
  },
  mixCardAction: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  builderCard: {
    borderRadius: 12,
    padding: 16,
  },
  builderLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: 40,
    padding: 0,
  },
  searchResultsList: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  searchResult: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchResultText: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  chipScrollView: {
    marginTop: 2,
  },
  builderChipRow: {
    gap: 8,
  },
  builderChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  builderChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  decadeRow: {
    gap: 8,
  },
  decadePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  decadePillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  decadePillTextActive: {
    fontWeight: '700',
  },
  playMixButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
  },
  playMixButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  footer: {
    height: 40,
  },
});
