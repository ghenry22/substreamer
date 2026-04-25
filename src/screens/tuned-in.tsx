import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { HeaderHeightContext } from '@react-navigation/elements';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { BottomSheet } from '../components/BottomSheet';
import { CachedImage } from '../components/CachedImage';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { SectionTitle } from '../components/SectionTitle';
import {
  DECADES,
  fetchCustomMix,
  fetchMixSongs,
  generateMixes,
  type MixDefinition,
} from '../services/tunedInService';
import { getOfflineSongsByGenre } from '../services/searchService';
import { playTrack } from '../services/playerService';
import { getAlbum, type Child } from '../services/subsonicService';
import { albumListsStore } from '../store/albumListsStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { connectivityStore } from '../store/connectivityStore';
import { favoritesStore } from '../store/favoritesStore';
import { genreStore } from '../store/genreStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { type ThemeColors } from '../constants/theme';
import { VIZ_PALETTE } from '../constants/vizColors';
import { selectionAsync } from '../utils/haptics';
import { minDelay } from '../utils/stringHelpers';

const MAX_SELECTED_GENRES = 3;
const MAX_BUILDER_GENRES = 30;
const JUMP_BACK_IN_SIZE = 150;
const JUMP_BACK_IN_IMAGE = 80;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isOnline(): boolean {
  const { offlineMode } = offlineModeStore.getState();
  if (offlineMode) return false;
  const { isServerReachable } = connectivityStore.getState();
  return isServerReachable;
}

function genreColor(genre: string): string {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = (hash * 31 + genre.charCodeAt(i)) | 0;
  }
  return VIZ_PALETTE[Math.abs(hash) % VIZ_PALETTE.length];
}

/* ------------------------------------------------------------------ */
/*  useMixCardPlayback — shared play/animation logic                   */
/* ------------------------------------------------------------------ */

function useMixCardPlayback(mix: MixDefinition, index: number) {
  const { t } = useTranslation();
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
      const songs = await fetchMixSongs(mix.fetchStrategy, layoutPreferencesStore.getState().listLength);
      if (songs.length === 0) {
        setError(t('noSongsFound'));
        return;
      }
      await playTrack(songs[0], songs);
    } catch {
      setError(t('failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [mix.fetchStrategy, loading]);

  return {
    loading,
    error,
    handlePress,
    handlePressIn,
    handlePressOut,
    animatedStyle,
    gradientAnimatedStyle,
  };
}

/* ------------------------------------------------------------------ */
/*  HeroMixCard                                                        */
/* ------------------------------------------------------------------ */

const HeroMixCard = memo(function HeroMixCard({
  mix,
  index,
}: {
  mix: MixDefinition;
  index: number;
}) {
  const { loading, error, handlePress, handlePressIn, handlePressOut, animatedStyle, gradientAnimatedStyle } =
    useMixCardPlayback(mix, index);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.heroOuter}
      >
        <Animated.View style={[styles.heroGradientWrapper, gradientAnimatedStyle]}>
          <LinearGradient
            colors={mix.gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          >
            {/* Decorative circles */}
            <View style={styles.heroDecoCircle1} />
            <View style={styles.heroDecoCircle2} />

            <View style={styles.heroRow}>
              <View style={styles.heroIcon}>
                <Ionicons name={mix.icon} size={22} color="#ffffffDD" />
              </View>
              <View style={styles.heroTextCol}>
                <Text style={styles.heroTitle} numberOfLines={1}>{mix.name}</Text>
                <Text style={styles.heroSubtitle} numberOfLines={2}>{error ?? mix.subtitle}</Text>
              </View>
              <View style={styles.heroPlayBtn}>
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="play" size={22} color="#fff" />
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
/*  MediumMixCard                                                      */
/* ------------------------------------------------------------------ */

const MediumMixCard = memo(function MediumMixCard({
  mix,
  index,
}: {
  mix: MixDefinition;
  index: number;
}) {
  const { loading, error, handlePress, handlePressIn, handlePressOut, animatedStyle, gradientAnimatedStyle } =
    useMixCardPlayback(mix, index);

  return (
    <Animated.View style={[styles.mediumFlex, animatedStyle]}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.mediumOuter}
      >
        <Animated.View style={[styles.mediumGradientWrapper, gradientAnimatedStyle]}>
          <LinearGradient
            colors={mix.gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.mediumGradient}
          >
            {/* Small play button top-right */}
            <View style={styles.mediumPlayCorner}>
              {loading ? (
                <ActivityIndicator size="small" color="#ffffffCC" />
              ) : (
                <View style={styles.mediumPlayBtn}>
                  <Ionicons name="play" size={14} color="#fff" />
                </View>
              )}
            </View>

            <View style={styles.mediumIcon}>
              <Ionicons name={mix.icon} size={18} color="#ffffffDD" />
            </View>
            <Text style={styles.mediumTitle} numberOfLines={1}>{mix.name}</Text>
            <Text style={styles.mediumSubtitle} numberOfLines={2}>{error ?? mix.subtitle}</Text>
          </LinearGradient>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

/* ------------------------------------------------------------------ */
/*  CompactMixCard                                                     */
/* ------------------------------------------------------------------ */

const CompactMixCard = memo(function CompactMixCard({
  mix,
  index,
}: {
  mix: MixDefinition;
  index: number;
}) {
  const { loading, error, handlePress, handlePressIn, handlePressOut, animatedStyle, gradientAnimatedStyle } =
    useMixCardPlayback(mix, index);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.compactOuter}
      >
        <Animated.View style={[styles.compactGradientWrapper, gradientAnimatedStyle]}>
          <LinearGradient
            colors={mix.gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.compactGradient}
          >
            <View style={styles.compactIcon}>
              <Ionicons name={mix.icon} size={18} color="#ffffffDD" />
            </View>
            <View style={styles.compactTextCol}>
              <Text style={styles.compactTitle} numberOfLines={1}>{mix.name}</Text>
              <Text style={styles.compactSubtitle} numberOfLines={1}>{error ?? mix.subtitle}</Text>
            </View>
            <View style={styles.compactAction}>
              {loading ? (
                <ActivityIndicator size="small" color="#ffffffCC" />
              ) : (
                <View style={styles.compactPlayBtn}>
                  <Ionicons name="play" size={16} color="#fff" />
                </View>
              )}
            </View>
          </LinearGradient>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

/* ------------------------------------------------------------------ */
/*  BuildMixButton                                                     */
/* ------------------------------------------------------------------ */

const BuildMixButton = memo(function BuildMixButton({
  colors,
  onPress,
}: {
  colors: ThemeColors;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  // Entrance animation
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

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.buildMixBtn,
          { borderColor: colors.border },
          pressed && { opacity: 0.7 },
        ]}
      >
        <LinearGradient
          colors={[colors.primary + '22', colors.primary + '11']}
          style={styles.buildMixIconSquare}
        >
          <Ionicons name="options-outline" size={22} color={colors.primary} />
        </LinearGradient>
        <View style={styles.buildMixTextCol}>
          <Text style={[styles.buildMixTitle, { color: colors.textPrimary }]}>{t('buildAMix')}</Text>
          <Text style={[styles.buildMixSubtitle, { color: colors.textSecondary }]}>
            {t('pickGenresDecadesMore')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </Pressable>
    </Animated.View>
  );
});

/* ------------------------------------------------------------------ */
/*  JumpBackInItem                                                     */
/* ------------------------------------------------------------------ */

const JumpBackInItem = memo(function JumpBackInItem({
  album,
  colors,
}: {
  album: { id: string; name?: string; coverArt?: string };
  colors: ThemeColors;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handlePress = useCallback(async () => {
    if (loading) return;
    selectionAsync();
    setLoading(true);
    try {
      const detail = await getAlbum(album.id);
      const songs = detail?.song;
      if (songs && songs.length > 0) {
        await playTrack(songs[0], songs);
      }
    } finally {
      setLoading(false);
    }
  }, [album.id, loading]);

  return (
    <Pressable onPress={handlePress} style={styles.jumpItem}>
      <CachedImage
        coverArtId={album.coverArt}
        size={JUMP_BACK_IN_SIZE}
        style={styles.jumpImage}
        resizeMode="cover"
      />
      {loading && (
        <View style={styles.jumpLoadingOverlay}>
          <ActivityIndicator size="small" color="#fff" />
        </View>
      )}
      <Text
        style={[styles.jumpTitle, { color: colors.textPrimary }]}
        numberOfLines={1}
      >
        {album.name ?? t('unknownAlbum')}
      </Text>
    </Pressable>
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
/*  GenreSearchResult                                                  */
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

/* ------------------------------------------------------------------ */
/*  BuildMixSheetContent                                               */
/* ------------------------------------------------------------------ */

const BuildMixSheetContent = memo(function BuildMixSheetContent({
  colors,
  availableGenres,
}: {
  colors: ThemeColors;
  availableGenres: string[];
}) {
  const { t } = useTranslation();
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
    if (loading) return;
    selectionAsync();
    setLoading(true);
    try {
      let songs: Child[];
      const ll = layoutPreferencesStore.getState().listLength;
      if (selectedGenres.length === 0) {
        // No selection — fully random "Mix It Up"
        const strategy = online
          ? { type: 'random' as const, size: ll }
          : { type: 'offline' as const };
        songs = await fetchMixSongs(strategy, ll);
      } else {
        const decade = DECADES[selectedDecadeIndex];
        songs = await fetchCustomMix(
          selectedGenres,
          decade.fromYear,
          decade.toYear,
          online,
          ll,
        );
      }
      if (songs.length > 0) {
        await playTrack(songs[0], songs);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedGenres, selectedDecadeIndex, loading, online]);

  return (
    <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
      {/* Genre chips */}
      <Text style={[styles.builderLabel, { color: colors.textSecondary }]}>
        {selectedGenres.length > 0 ? t('genresWithCount', { selected: selectedGenres.length, max: MAX_SELECTED_GENRES }) : t('genres')}
      </Text>

      {/* Genre search input */}
      <View style={[styles.searchInputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.textPrimary }]}
          placeholder={t('searchGenresPlaceholder')}
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
        {t('decade')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.decadeRow}
      >
        {DECADES.map((decade, i) => (
          <DecadePill
            key={decade.label}
            label={decade.label === 'Any' ? t('decadeAny') : decade.label}
            selected={selectedDecadeIndex === i}
            onPress={() => handleDecadePress(i)}
            colors={colors}
          />
        ))}
      </ScrollView>

      {/* Play button */}
      <Pressable
        onPress={handlePlay}
        disabled={loading}
        style={[
          styles.playMixButton,
          { backgroundColor: colors.primary },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name="play" size={18} color="#fff" />
            <Text style={styles.playMixButtonText}>{t('playMix')}</Text>
          </>
        )}
      </Pressable>

      <View style={styles.sheetBottomPad} />
    </ScrollView>
  );
});

/* ------------------------------------------------------------------ */
/*  TunedInScreen                                                      */
/* ------------------------------------------------------------------ */

export function TunedInScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const transitionComplete = useTransitionComplete();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const refreshControlKey = useRefreshControlKey();

  const aggregates = completedScrobbleStore((s) => s.aggregates);
  const completedScrobbles = completedScrobbleStore((s) => s.completedScrobbles);
  const starredSongs = favoritesStore((s) => s.songs);
  const online = !offlineModeStore((s) => s.offlineMode) && connectivityStore((s) => s.isServerReachable);
  const recentlyPlayed = albumListsStore((s) => s.recentlyPlayed);

  const serverGenres = genreStore((s) => s.genres);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Compute smart mixes — refreshKey forces re-roll of weighted random picks
  const mixes = useMemo(() => {
    void refreshKey;
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
      listLength: layoutPreferencesStore.getState().listLength,
    });
  }, [aggregates, completedScrobbles, starredSongs, online, refreshKey]);

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

  const hasBuilder = builderGenres.length > 0 || serverGenres.length > 0;

  const handleOpenSheet = useCallback(() => {
    selectionAsync();
    setSheetOpen(true);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const delay = minDelay();
    setRefreshKey((k) => k + 1);
    if (online) {
      await albumListsStore.getState().refreshRecentlyPlayed();
    }
    await delay;
    setRefreshing(false);
  }, [online]);

  // Split mixes into hero / medium / compact
  const heroMix = mixes[0] ?? null;
  const mediumMixes = mixes.slice(1, 3);
  const compactMixes = mixes.slice(3);

  const showJumpBackIn = online && recentlyPlayed.length > 0;

  if (!transitionComplete) {
    return (
      <GradientBackground style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
        <BottomChrome withSafeAreaPadding />
      </GradientBackground>
    );
  }

  return (
    <GradientBackground scrollable>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            key={refreshControlKey}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            progressViewOffset={headerHeight}
          />
        }
      >
        {/* For You section */}
        {mixes.length > 0 && (
          <View style={styles.section}>
            <SectionTitle title={t('forYou')} color={colors.textSecondary} />
            <View style={styles.mixList}>
              {/* Hero card */}
              {heroMix && <HeroMixCard mix={heroMix} index={0} />}

              {/* Medium cards side by side */}
              {mediumMixes.length > 0 && (
                <View style={styles.mediumRow}>
                  {mediumMixes.map((mix, i) => (
                    <MediumMixCard key={mix.id} mix={mix} index={i + 1} />
                  ))}
                </View>
              )}

              {/* Compact cards */}
              {compactMixes.map((mix, i) => (
                <CompactMixCard key={mix.id} mix={mix} index={i + 3} />
              ))}
            </View>
          </View>
        )}

        {/* Create section */}
        {hasBuilder && (
          <View style={styles.section}>
            <SectionTitle title={t('create')} color={colors.textSecondary} />
            <BuildMixButton colors={colors} onPress={handleOpenSheet} />
          </View>
        )}

        {/* Jump back in section */}
        {showJumpBackIn && (
          <View style={styles.section}>
            <SectionTitle title={t('jumpBackIn')} color={colors.textSecondary} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.jumpRow}
            >
              {recentlyPlayed.map((album) => (
                <JumpBackInItem key={album.id} album={album} colors={colors} />
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.footer} />
      </ScrollView>

      {/* Build a Mix bottom sheet */}
      <BottomSheet visible={sheetOpen} onClose={handleCloseSheet} maxHeight="75%">
        <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>{t('buildAMix')}</Text>
        <BuildMixSheetContent colors={colors} availableGenres={builderGenres} />
      </BottomSheet>
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
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

  /* Hero card */
  heroOuter: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  heroGradientWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  heroGradient: {
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 24,
    minHeight: 160,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroDecoCircle1: {
    position: 'absolute',
    top: -30,
    right: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroDecoCircle2: {
    position: 'absolute',
    bottom: -40,
    left: 20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTextCol: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  heroSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#ffffffBB',
    lineHeight: 18,
  },
  heroPlayBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Medium cards */
  mediumRow: {
    flexDirection: 'row',
    gap: 12,
  },
  mediumFlex: {
    flex: 1,
  },
  mediumOuter: {
    borderRadius: 12,
    overflow: 'hidden',
    flex: 1,
  },
  mediumGradientWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    flex: 1,
  },
  mediumGradient: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 18,
    minHeight: 140,
  },
  mediumPlayCorner: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  mediumPlayBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediumIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  mediumTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  mediumSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#ffffffBB',
    lineHeight: 15,
  },

  /* Compact cards */
  compactOuter: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  compactGradientWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  compactGradient: {
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  compactIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactTextCol: {
    flex: 1,
    gap: 4,
  },
  compactTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  compactSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#ffffffBB',
  },
  compactAction: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactPlayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Build a Mix button */
  buildMixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 14,
  },
  buildMixIconSquare: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buildMixTextCol: {
    flex: 1,
    gap: 4,
  },
  buildMixTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  buildMixSubtitle: {
    fontSize: 12,
  },

  /* Jump back in */
  jumpRow: {
    gap: 12,
  },
  jumpItem: {
    width: JUMP_BACK_IN_IMAGE,
    alignItems: 'center',
  },
  jumpImage: {
    width: JUMP_BACK_IN_IMAGE,
    height: JUMP_BACK_IN_IMAGE,
    borderRadius: 10,
  },
  jumpLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: 0,
    width: JUMP_BACK_IN_IMAGE,
    height: JUMP_BACK_IN_IMAGE,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  jumpTitle: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 6,
  },

  /* Sheet */
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetBottomPad: {
    height: 16,
  },

  /* Builder components (used inside sheet) */
  builderLabel: {
    fontSize: 12,
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
    fontSize: 16,
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
    fontSize: 16,
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
    borderRadius: 16,
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
    borderRadius: 16,
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
