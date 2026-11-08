import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { type ThemeColors } from '../constants/theme';
import { VIZ_PALETTE } from '../constants/vizColors';
import { selectionAsync } from '../utils/haptics';
import { GenreGlyph, type GlyphName } from './GenreGlyph';

const ICON_GLYPH = 60;
const ICON_OVERLAP = 0.6;
const TAB_BAR_BASE_HEIGHT = 56;
/** Layout pitch as a fraction of card width; below 1 so neighbours overlap. */
const SPREAD = 0.62;
const RIM = 1.5;
/** Cycling needs enough cards to fill the screen on both sides. */
const MIN_CYCLIC = 3;
const REPEATS = 3;

/** Deterministic color for a genre name (stable across re-renders/sessions). */
export function genreColor(genre: string): string {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = (hash * 31 + genre.charCodeAt(i)) | 0;
  }
  return VIZ_PALETTE[Math.abs(hash) % VIZ_PALETTE.length];
}

interface GenreStyle {
  icon: GlyphName;
  color: string;
}

const GENRE_STYLE_RULES: [RegExp, GenreStyle][] = [
  [/rap|hip|trap|drill|grime/, { icon: 'crown', color: '#F5A524' }],
  [/rock|punk|grunge|metal|hardcore/, { icon: 'note', color: '#34D058' }],
  [/electro|techno|house|dance|edm|trance|dub|synth/, { icon: 'headphones', color: '#2EA8FF' }],
  [/jazz|blues|swing|soul|funk/, { icon: 'equalizer', color: '#A23DFF' }],
  [/pop|r&b|rnb|disco/, { icon: 'sparkle', color: '#B65CFF' }],
  [/folk|country|acoustic|bluegrass/, { icon: 'leaf', color: '#7BC043' }],
  [/ambient|chill|lofi|lo-fi|downtempo|sleep/, { icon: 'moon', color: '#6C8CFF' }],
  [/soundtrack|score|film|game|classic|orchestra|opera|piano/, { icon: 'disc', color: '#4DD0C8' }],
];
const FALLBACK_ICONS: GlyphName[] = ['disc', 'mic', 'moon', 'leaf', 'headphones', 'note'];

/** Glyph and colour for a genre: keyword match first, otherwise a stable pick. */
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

interface CardProps {
  index: number;
  scrollX: SharedValue<number>;
  itemSize: number;
  width: number;
  height: number;
  /** null renders the shuffle-everything card. */
  genre: string | null;
  colors: ThemeColors;
  onSelect: (genre: string | null) => Promise<unknown> | void;
}

const Card = memo(function Card({
  index,
  scrollX,
  itemSize,
  width,
  height,
  genre,
  colors,
  onSelect,
}: CardProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const { icon, color: tint } = useMemo<GenreStyle>(
    () => (genre ? genreStyle(genre) : { icon: 'shuffle', color: '#E6E6E6' }),
    [genre],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const d = (scrollX.value - index * itemSize) / itemSize;
    const input = [-2, -1, 0, 1, 2];
    return {
      zIndex: 10 - Math.round(Math.abs(d)),
      opacity: interpolate(d, input, [0.5, 0.85, 1, 0.85, 0.5], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(d, input, [34, 14, 0, 14, 34], Extrapolation.CLAMP) },
        { rotate: `${interpolate(d, input, [-7, -3.5, 0, 3.5, 7], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(d, input, [0.72, 0.87, 1, 0.87, 0.72], Extrapolation.CLAMP) },
      ],
    };
  });

  const handlePress = useCallback(async () => {
    if (loading) return;
    selectionAsync();
    setLoading(true);
    try {
      await onSelect(genre);
    } finally {
      setLoading(false);
    }
  }, [genre, loading, onSelect]);

  const id = tint.slice(1);
  // A wide dome: the top is a full half-ellipse spanning the card, so the card reads
  // as a rounded hemisphere stretched downwards rather than a door-like arch.
  const rx = width / 2 - RIM / 2;
  const ry = Math.min(width * 0.46, height * 0.6);
  const left = RIM / 2;
  const right = width - RIM / 2;
  const outline = `M${left} ${height} V${ry} A${rx} ${ry} 0 0 1 ${right} ${ry} V${height}`;

  return (
    <Animated.View
      style={[
        { width, height, marginHorizontal: (itemSize - width) / 2, transformOrigin: 'center bottom' },
        animatedStyle,
      ]}
    >
      <Pressable onPress={handlePress} style={styles.card}>
        <Svg
          width={width}
          height={height}
          style={styles.svg}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={tint} stopOpacity="0.4" />
              <Stop offset="0.5" stopColor={tint} stopOpacity="0.12" />
              <Stop offset="1" stopColor={tint} stopOpacity="0" />
            </LinearGradient>
            <LinearGradient id={`rim-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={tint} stopOpacity="0.95" />
              <Stop offset="0.55" stopColor={tint} stopOpacity="0.35" />
              <Stop offset="0.95" stopColor={tint} stopOpacity="0" />
            </LinearGradient>
            <LinearGradient id="body-dark" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.background} stopOpacity="1" />
              <Stop offset="0.45" stopColor={colors.background} stopOpacity="1" />
              <Stop offset="1" stopColor={colors.background} stopOpacity="0" />
            </LinearGradient>
            <RadialGradient id={`top-${id}`} cx="50%" cy="0%" rx="75%" ry="85%">
              <Stop offset="0" stopColor={tint} stopOpacity="0.7" />
              <Stop offset="0.6" stopColor={tint} stopOpacity="0.18" />
              <Stop offset="1" stopColor={tint} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Path d={`${outline} Z`} fill="url(#body-dark)" />
          <Path d={`${outline} Z`} fill={`url(#fill-${id})`} />
          <Path d={`${outline} Z`} fill={`url(#top-${id})`} />
          <Path d={outline} fill="none" stroke={`url(#rim-${id})`} strokeWidth={RIM} />
        </Svg>
        <View style={styles.iconWrap}>
          {loading ? (
            <ActivityIndicator size="large" color={tint} />
          ) : (
            <GenreGlyph name={icon} color={tint} size={ICON_GLYPH} />
          )}
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
          {genre ?? t('randomMix')}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

interface GenreCarouselProps {
  genres: string[];
  colors: ThemeColors;
  /** Called when a card is tapped. */
  onSelect: (genre: string | null) => Promise<unknown> | void;
  /** Called when the carousel comes to rest on a different card. */
  onSettle: (genre: string | null) => void;
}

/** Fan-style, endlessly cycling genre picker. `null` stands for the shuffle-everything card. */
export const GenreCarousel = memo(function GenreCarousel({
  genres,
  colors,
  onSelect,
  onSettle,
}: GenreCarouselProps) {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarHeight = TAB_BAR_BASE_HEIGHT + insets.bottom;
  const scrollRef = useRef<Animated.ScrollView>(null);

  const items = useMemo<(string | null)[]>(() => [null, ...genres], [genres]);
  const count = items.length;
  const cyclic = count >= MIN_CYCLIC;
  const repeats = cyclic ? REPEATS : 1;
  const cards = useMemo(
    () => Array.from({ length: count * repeats }, (_, i) => items[i % count]),
    [items, count, repeats],
  );

  const cardWidth = Math.min(Math.round(screenWidth * 0.5), 240);
  const cardHeight = Math.round(cardWidth * 0.95);
  // The layout pitch equals the snap interval, so the card the fan rests on is
  // always the one centred on screen.
  const itemSize = Math.round(cardWidth * SPREAD);
  const sidePad = (screenWidth - cardWidth) / 2 - (itemSize - cardWidth) / 2;
  const startIndex = cyclic ? count : 0;

  const scrollX = useSharedValue(startIndex * itemSize);
  const settledLogical = useRef(0);

  useEffect(() => {
    settledLogical.current = 0;
    scrollX.value = startIndex * itemSize;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: startIndex * itemSize, animated: false });
    }, 0);
    return () => clearTimeout(timer);
  }, [startIndex, itemSize, scrollX]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const handleSettle = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const raw = Math.round(e.nativeEvent.contentOffset.x / itemSize);
      if (raw < 0 || raw >= cards.length) return;
      const logical = raw % count;
      // Identical cards repeat every `count` slots, so hopping back to the middle
      // copy is invisible and keeps the scroll endless.
      if (cyclic && (raw < count || raw >= count * 2)) {
        scrollRef.current?.scrollTo({ x: (count + logical) * itemSize, animated: false });
      }
      if (logical === settledLogical.current) return;
      settledLogical.current = logical;
      onSettle(items[logical]);
    },
    [itemSize, cards.length, count, cyclic, items, onSettle],
  );

  return (
    <Animated.ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={itemSize}
      decelerationRate="fast"
      onScroll={onScroll}
      onMomentumScrollEnd={handleSettle}
      scrollEventThrottle={16}
      style={[
        styles.fan,
        { height: cardHeight + ICON_GLYPH * ICON_OVERLAP, marginBottom: tabBarHeight - 28 },
      ]}
      contentContainerStyle={{ paddingHorizontal: sidePad, paddingTop: ICON_GLYPH * ICON_OVERLAP }}
    >
      {cards.map((genre, index) => (
        <Card
          key={`${genre ?? '__shuffle__'}-${Math.floor(index / count)}`}
          index={index}
          scrollX={scrollX}
          itemSize={itemSize}
          width={cardWidth}
          height={cardHeight}
          genre={genre}
          colors={colors}
          onSelect={onSelect}
        />
      ))}
    </Animated.ScrollView>
  );
});

const styles = StyleSheet.create({
  fan: {
    alignSelf: 'stretch',
    flexGrow: 0,
  },
  card: {
    flex: 1,
    alignItems: 'center',
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  iconWrap: {
    width: ICON_GLYPH,
    height: ICON_GLYPH,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -ICON_GLYPH * ICON_OVERLAP,
  },
  title: {
    marginTop: 6,
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
});
