import Ionicons from "@react-native-vector-icons/ionicons/static";
import { LinearGradient } from 'expo-linear-gradient';
import { HeaderHeightContext } from "expo-router/react-navigation";
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
  useWindowDimensions,
} from 'react-native';
import type { ScrollViewInstance, StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
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
  SELECTABLE_DECADES,
  fetchMixSongs,
  generateMixes,
  type MixDefinition,
} from '../services/tunedInService';
import { getOfflineGenresPresent } from '../services/searchService';
import { playTrack } from '../services/playerService';
import { getAlbum } from '../services/subsonicService';
import { albumListsStore } from '../store/albumListsStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { loadScrobblesSince } from '../store/persistence/scrobbleAggregates';
import { connectivityStore } from '../store/connectivityStore';
import { randomStarredSong } from '../db/repository/favorites';
import { getDb } from '../store/persistence/db';
import { favoritesStore } from '../store/favoritesStore';
import { genreStore } from '../store/genreStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { getGridColumns } from '../hooks/useGridColumns';
import { MAX_SELECTED_GENRES, useMixBuilder, type MixBuilder } from '../hooks/useMixBuilder';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { type ThemeColors } from '../constants/theme';
import { VIZ_PALETTE } from '../constants/vizColors';
import { selectionAsync } from '../utils/haptics';
import { minDelay } from '../utils/stringHelpers';

import { absoluteFill } from '../utils/styles';
const MAX_BUILDER_GENRES = 30;
const JUMP_BACK_IN_SIZE = 150;
const JUMP_BACK_IN_IMAGE = 80;
/** Tablet Jump Back In artwork — matches the home screen's album cover width. */
const JUMP_BACK_IN_TABLET_IMAGE = 150;

/* Tablet "For You" bento grid. Phone keeps the hero / medium-row / compact-list
   stack; tablets (min dimension >= 600) re-flow mixes into a responsive grid so
   cards stop stretching into thin full-width bars. */
const SCREEN_H_PADDING = 16;
const BENTO_GAP = 12;
const BENTO_TILE_H = 150;
const TABLET_MIN_DIMENSION = 600;
/** Embedded builder goes two-column above this content width; single below. */
const BUILDER_TWO_COL_MIN_WIDTH = 700;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

  // `entering`, not a shared value at 0 driven by a mount-only effect: that shape leaves
  // the view invisible whenever the animation does not fire, and its deps never change so
  // nothing re-runs it. Same defect fixed in StatCard.

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
    transform: [{ scale: scale.value }],
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

/**
 * Entrance for a mix card. A separate view from the card's own animated style on
 * purpose: Reanimated warns that a layout animation may overwrite a `transform` set on
 * the same component, and every card's style carries the press-scale transform.
 *
 * Declarative `entering`, never a shared value starting at 0 driven by a mount-only
 * effect — that shape leaves the card invisible whenever the animation does not fire,
 * with no dep change to re-run it. Same defect fixed in StatCard.
 */
function MixCardEntrance({
  index,
  style,
  children,
}: {
  index: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <Animated.View entering={FadeInDown.delay(index * 80).duration(400)} style={style}>
      {children}
    </Animated.View>
  );
}

const HeroMixCard = memo(function HeroMixCard({
  mix,
  index,
  fillHeight = false,
}: {
  mix: MixDefinition;
  index: number;
  /** Fill a fixed-height grid cell (tablet bento) instead of using minHeight. */
  fillHeight?: boolean;
}) {
  const { loading, error, handlePress, handlePressIn, handlePressOut, animatedStyle, gradientAnimatedStyle } =
    useMixCardPlayback(mix, index);

  return (
    <MixCardEntrance index={index} style={fillHeight ? styles.fillFlex : undefined}>
    <Animated.View style={[animatedStyle, fillHeight && styles.fillFlex]}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[styles.heroOuter, fillHeight && styles.fillFlex]}
      >
        <Animated.View style={[styles.heroGradientWrapper, fillHeight && styles.fillFlex, gradientAnimatedStyle]}>
          <LinearGradient
            colors={mix.gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroGradient, fillHeight && styles.fillFlex]}
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
    </MixCardEntrance>
  );
});

/* ------------------------------------------------------------------ */
/*  MediumMixCard                                                      */
/* ------------------------------------------------------------------ */

export const MediumMixCard = memo(function MediumMixCard({
  mix,
  index,
  fillHeight = false,
}: {
  mix: MixDefinition;
  index: number;
  /** Fill a fixed-height grid cell (tablet bento) instead of using minHeight. */
  fillHeight?: boolean;
}) {
  const { loading, error, handlePress, handlePressIn, handlePressOut, animatedStyle, gradientAnimatedStyle } =
    useMixCardPlayback(mix, index);

  return (
    <MixCardEntrance index={index} style={styles.mediumFlex}>
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
            style={[styles.mediumGradient, fillHeight && styles.fillFlex]}
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
    </MixCardEntrance>
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
    <MixCardEntrance index={index}>
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
    </MixCardEntrance>
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
  // `entering`, not a shared value at 0 driven by a mount-only effect: that shape leaves
  // the view invisible whenever the animation does not fire, and its deps never change so
  // nothing re-runs it. Same defect fixed in StatCard.
  return (
    <Animated.View entering={FadeInDown.delay(400).duration(400)}>
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
  size = JUMP_BACK_IN_IMAGE,
}: {
  album: { id: string; name?: string; coverArt?: string };
  colors: ThemeColors;
  /** Artwork edge length. Phone uses the compact default; the tablet grid
      passes a larger value for a more visual layout. */
  size?: number;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  // Fetch a sharper variant for the larger tablet tiles.
  const coverFetchSize = size > 120 ? 300 : JUMP_BACK_IN_SIZE;

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
    <Pressable onPress={handlePress} style={[styles.jumpItem, { width: size }]}>
      <CachedImage
        coverArtId={album.coverArt}
        size={coverFetchSize}
        style={[styles.jumpImage, { width: size, height: size }]}
        resizeMode="cover"
      />
      {loading && (
        <View style={[styles.jumpLoadingOverlay, { width: size, height: size }]}>
          <ActivityIndicator size="small" color="#fff" />
        </View>
      )}
      <Text
        style={[styles.jumpTitle, { color: colors.textPrimary }, size > 120 && styles.jumpTitleLarge]}
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
/*  Build-a-Mix presentation (shared logic in useMixBuilder)           */
/* ------------------------------------------------------------------ */

/** Genre search input — identical in the sheet and the panel. */
const GenreSearchField = memo(function GenreSearchField({
  colors,
  value,
  onChange,
}: {
  colors: ThemeColors;
  value: string;
  onChange: (q: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.searchInputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
      <Ionicons name="search" size={16} color={colors.textSecondary} />
      <TextInput
        style={[styles.searchInput, { color: colors.textPrimary }]}
        placeholder={t('searchGenresPlaceholder')}
        placeholderTextColor={colors.textSecondary}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')} hitSlop={8}>
          <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );
});

/** Genre search-results dropdown (renders nothing when empty). */
const GenreSearchResults = memo(function GenreSearchResults({
  colors,
  results,
  onSelect,
}: {
  colors: ThemeColors;
  results: string[];
  onSelect: (genre: string) => void;
}) {
  if (results.length === 0) return null;
  return (
    <View style={[styles.searchResultsList, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
      {results.map((genre) => (
        <GenreSearchResult key={genre} genre={genre} onSelect={onSelect} colors={colors} />
      ))}
    </View>
  );
});

/** Primary "Play Mix" action button. */
const PlayMixButton = memo(function PlayMixButton({
  colors,
  loading,
  onPress,
}: {
  colors: ThemeColors;
  loading: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={[styles.playMixButton, { backgroundColor: colors.primary }]}
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
  );
});

/* Shared chip / pill renderers so the sheet and panel build identical controls
   from the shared builder state. */
function renderGenreChips(builder: MixBuilder, colors: ThemeColors) {
  return builder.displayGenres.map((genre) => (
    <BuilderGenreChip
      key={genre}
      genre={genre}
      selected={builder.selectedGenres.includes(genre)}
      onToggle={builder.toggleGenre}
      colors={colors}
    />
  ));
}

function renderDecadePills(
  builder: MixBuilder,
  colors: ThemeColors,
  t: (key: string) => string,
) {
  return SELECTABLE_DECADES.map((decade) => (
    <DecadePill
      key={decade.label}
      label={decade.i18nKey ? t(decade.i18nKey) : decade.label}
      selected={builder.selectedDecades.includes(decade.label)}
      onPress={() => builder.toggleDecade(decade.label)}
      colors={colors}
    />
  ));
}

/** "Genres" heading + selected-count, sized small (sheet) or large (panel). */
const GenresHeading = memo(function GenresHeading({
  builder,
  colors,
  large = false,
}: {
  builder: MixBuilder;
  colors: ThemeColors;
  large?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Text
      style={[
        large ? styles.builderLabelLarge : styles.builderLabel,
        { color: large ? colors.textPrimary : colors.textSecondary },
      ]}
    >
      {builder.selectedGenres.length > 0
        ? t('genresWithCount', { selected: builder.selectedGenres.length, max: MAX_SELECTED_GENRES })
        : t('genres')}
    </Text>
  );
});

/* ------------------------------------------------------------------ */
/*  MixBuilderSheet — phone (bottom sheet) presentation                */
/* ------------------------------------------------------------------ */

const MixBuilderSheet = memo(function MixBuilderSheet({
  colors,
  availableGenres,
}: {
  colors: ThemeColors;
  availableGenres: string[];
}) {
  const { t } = useTranslation();
  const builder = useMixBuilder(availableGenres);
  const chipScrollRef = useRef<ScrollViewInstance>(null);

  const onSelectResult = useCallback(
    (genre: string) => {
      builder.selectSearchResult(genre);
      chipScrollRef.current?.scrollTo({ x: 0, animated: true });
    },
    [builder],
  );

  return (
    <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
      <GenresHeading builder={builder} colors={colors} />
      <GenreSearchField colors={colors} value={builder.searchQuery} onChange={builder.setSearchQuery} />
      <GenreSearchResults colors={colors} results={builder.searchResults} onSelect={onSelectResult} />
      <ScrollView
        ref={chipScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.builderChipRow}
        style={styles.chipScrollView}
      >
        {renderGenreChips(builder, colors)}
      </ScrollView>

      <Text style={[styles.builderLabel, { color: colors.textSecondary, marginTop: 16 }]}>
        {t('decade')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.decadeRow}>
        {renderDecadePills(builder, colors, t)}
      </ScrollView>

      {builder.error ? (
        <Text style={[styles.builderError, { color: colors.red }]}>{builder.error}</Text>
      ) : null}
      <PlayMixButton colors={colors} loading={builder.loading} onPress={builder.play} />
      <View style={styles.sheetBottomPad} />
    </ScrollView>
  );
});

/* ------------------------------------------------------------------ */
/*  MixBuilderPanel — embedded tablet presentation                     */
/* ------------------------------------------------------------------ */

const MixBuilderPanel = memo(function MixBuilderPanel({
  colors,
  availableGenres,
}: {
  colors: ThemeColors;
  availableGenres: string[];
}) {
  const { t } = useTranslation();
  const builder = useMixBuilder(availableGenres);
  const { width } = useWindowDimensions();
  // Genres | Decades side-by-side once there's room; stacked below that.
  const twoColumn = width - SCREEN_H_PADDING * 2 >= BUILDER_TWO_COL_MIN_WIDTH;

  const genresSection = (
    <>
      <GenresHeading builder={builder} colors={colors} large />
      <GenreSearchField colors={colors} value={builder.searchQuery} onChange={builder.setSearchQuery} />
      <GenreSearchResults colors={colors} results={builder.searchResults} onSelect={builder.selectSearchResult} />
      <View style={styles.builderChipCloud}>{renderGenreChips(builder, colors)}</View>
    </>
  );

  const decadesSection = (
    <>
      <Text
        style={[
          styles.builderLabelLarge,
          { color: colors.textPrimary },
          // Separate from the genre cloud when stacked; aligned at top in columns.
          !twoColumn && styles.builderLabelStacked,
        ]}
      >
        {t('decade')}
      </Text>
      <View style={styles.decadeCloud}>{renderDecadePills(builder, colors, t)}</View>
    </>
  );

  return (
    <View>
      {twoColumn ? (
        <View style={styles.builderColumns}>
          <View style={styles.builderColGenres}>{genresSection}</View>
          <View style={styles.builderColDecades}>{decadesSection}</View>
        </View>
      ) : (
        <>
          {genresSection}
          {decadesSection}
        </>
      )}
      {builder.error ? (
        <Text style={[styles.builderError, { color: colors.red }]}>{builder.error}</Text>
      ) : null}
      <PlayMixButton colors={colors} loading={builder.loading} onPress={builder.play} />
    </View>
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
  const { width, height: screenHeight } = useWindowDimensions();

  // Tablet "For You" bento: responsive columns with the lead mix spanning 2.
  const isTablet = Math.min(width, screenHeight) >= TABLET_MIN_DIMENSION;
  const bentoColumns = getGridColumns(width);
  const bentoCellW = Math.floor(
    (width - SCREEN_H_PADDING * 2 - (bentoColumns - 1) * BENTO_GAP) / bentoColumns,
  );
  const bentoHeroW = bentoCellW * 2 + BENTO_GAP;

  const aggregates = completedScrobbleStore((s) => s.aggregates);
  const favoritesVersion = favoritesStore((s) => s.version);
  const online = !offlineModeStore((s) => s.offlineMode) && connectivityStore((s) => s.isServerReachable);
  const recentlyPlayed = albumListsStore((s) => s.recentlyPlayed);

  const serverGenres = genreStore((s) => s.genres);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Smart mixes MUST be computed off the render path: `generateMixes` is an O(n) pass
  // over the whole scrobble history (10k+), and a synchronous `useMemo` runs before the
  // `!transitionComplete` early return below, landing the work on the exact frame the
  // navigation transition needs. Gate on `transitionComplete`, then defer one tick with
  // `setTimeout(0)` — not rAF, which can stall on Fabric. `refreshKey` re-rolls the picks.
  const [mixes, setMixes] = useState<ReturnType<typeof generateMixes>>([]);
  // True once the deferred mix compute has run at least once. Gating the screen
  // on this (not just `transitionComplete`) prevents a flash where "Jump back in"
  // (available immediately) renders at the top for a frame before "For You" is
  // computed and pops in above it. Stays true across refreshes.
  const [mixesReady, setMixesReady] = useState(false);
  useEffect(() => {
    if (!transitionComplete) return;
    let alive = true;
    // A BOUNDED recent slice (last 30 days) from SQL feeds the time-window mixes
    // (Heavy Rotation 7d, time-of-day) — never the full history. All-time patterns
    // still come from the SQL aggregates above.
    const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    const handle = setTimeout(async () => {
      const recent = await loadScrobblesSince(Date.now() - RECENT_WINDOW_MS);
      if (!alive) return;
      const db = getDb();
      const favoritesSeed = db ? await randomStarredSong(db) : null;
      if (!alive) return;
      const scrobbles = recent.map((s) => ({
        time: s.time,
        song: s.song as { genre?: string; genres?: unknown[]; artist?: string; artistId?: string },
      }));
      setMixes(
        generateMixes({
          hourBuckets: aggregates.hourBuckets,
          genreCounts: aggregates.genreCounts,
          songStats: aggregates.songStats,
          artistCounts: aggregates.artistCounts,
          scrobbles,
          favoritesSeed,
          isOnline: online,
          listLength: layoutPreferencesStore.getState().listLength,
        }),
      );
      setMixesReady(true);
    }, 0);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [transitionComplete, aggregates, favoritesVersion, online, refreshKey]);

  // Available genres for the builder
  const builderGenres = useMemo(() => {
    const historyGenres = Object.entries(aggregates.genreCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([genre]) => genre);

    if (!online) {
      // Offline: keep only history genres present in cached tracks. Single
      // pass over the library (parses each song envelope once) instead of
      // re-walking it per candidate genre.
      const present = getOfflineGenresPresent();
      return historyGenres.filter((g) => present.has(g.toLowerCase()));
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

  // Hold the spinner until the deferred mix compute has run, so the content
  // appears as one frame (For You animating in, Jump back in already placed)
  // rather than flashing Jump back in first.
  if (!transitionComplete || !mixesReady) {
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
            <SectionTitle title={t('forYou')} color={colors.textPrimary} large />
            {isTablet ? (
              /* Tablet: responsive bento — lead mix spans 2 cells, the rest are
                 equal gradient tiles, so cards fill the width instead of
                 stretching into thin full-width bars. */
              <View style={styles.bentoGrid}>
                {mixes.map((mix, i) => (
                  <View
                    key={mix.id}
                    style={{ width: i === 0 ? bentoHeroW : bentoCellW, height: BENTO_TILE_H }}
                  >
                    {i === 0 ? (
                      <HeroMixCard mix={mix} index={i} fillHeight />
                    ) : (
                      <MediumMixCard mix={mix} index={i} fillHeight />
                    )}
                  </View>
                ))}
              </View>
            ) : (
              /* Phone: hero / medium-row / compact-list stack. */
              <View style={styles.mixList}>
                {heroMix && <HeroMixCard mix={heroMix} index={0} />}

                {mediumMixes.length > 0 && (
                  <View style={styles.mediumRow}>
                    {mediumMixes.map((mix, i) => (
                      <MediumMixCard key={mix.id} mix={mix} index={i + 1} />
                    ))}
                  </View>
                )}

                {compactMixes.map((mix, i) => (
                  <CompactMixCard key={mix.id} mix={mix} index={i + 3} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Create section — embedded builder on tablet, sheet trigger on phone */}
        {hasBuilder && (
          <View style={styles.section}>
            <SectionTitle title={t('create')} color={colors.textPrimary} large />
            {isTablet ? (
              <MixBuilderPanel colors={colors} availableGenres={builderGenres} />
            ) : (
              <BuildMixButton colors={colors} onPress={handleOpenSheet} />
            )}
          </View>
        )}

        {/* Jump back in section */}
        {showJumpBackIn && (
          <View style={styles.section}>
            <SectionTitle title={t('jumpBackIn')} color={colors.textPrimary} large />
            {isTablet ? (
              /* Tablet: a grid of larger artwork at the home-screen cover size. */
              <View style={styles.jumpGrid}>
                {recentlyPlayed.map((album) => (
                  <JumpBackInItem
                    key={album.id}
                    album={album}
                    colors={colors}
                    size={JUMP_BACK_IN_TABLET_IMAGE}
                  />
                ))}
              </View>
            ) : (
              /* Phone: compact horizontal scroller. */
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.jumpRow}
              >
                {recentlyPlayed.map((album) => (
                  <JumpBackInItem key={album.id} album={album} colors={colors} />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        <View style={styles.footer} />
      </ScrollView>

      {/* Build a Mix bottom sheet */}
      <BottomSheet visible={sheetOpen} onClose={handleCloseSheet} maxHeight="75%">
        <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>{t('buildAMix')}</Text>
        <MixBuilderSheet colors={colors} availableGenres={builderGenres} />
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
    marginBottom: 36,
  },
  mixList: {
    gap: 12,
  },
  /* Tablet bento grid — equal-gap wrap; lead tile spans 2 cells (see render). */
  bentoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: BENTO_GAP,
    alignItems: 'flex-start',
  },
  /** Fills a fixed-height bento cell instead of relying on the card's minHeight. */
  fillFlex: {
    flex: 1,
  },
  /* Embedded (tablet) builder layout */
  builderColumns: {
    flexDirection: 'row',
    gap: 28,
  },
  builderColGenres: {
    flex: 3,
  },
  builderColDecades: {
    flex: 2,
  },
  builderLabelLarge: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  builderLabelStacked: {
    marginTop: 20,
  },
  builderChipCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  decadeCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
    ...absoluteFill,
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
  jumpTitleLarge: {
    fontSize: 14,
    marginTop: 8,
  },
  /* Tablet: larger artwork laid out as a grid, aligned to the For You columns. */
  jumpGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: BENTO_GAP,
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
  builderError: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 16,
  },
  footer: {
    height: 40,
  },
});
