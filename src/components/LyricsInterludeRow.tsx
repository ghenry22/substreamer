import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

interface LyricsInterludeRowProps {
  /** The line index this interlude follows — active when `activeIndex === pairIndex`. */
  pairIndex: number;
  activeIndex: SharedValue<number>;
  /** Start time of the line this interlude follows (ms, with offset applied). */
  fromMs: number;
  /** Start time of the next line (ms, with offset applied). */
  toMs: number;
  extrapolatedMs: SharedValue<number>;
  textColor: string;
}

const SPRING = { damping: 18, stiffness: 140, mass: 0.8 } as const;
const DOT_COUNT = 3;

/**
 * "Breathing dots" shown during instrumental gaps > 5 s between lyric lines.
 * Three dots fade in as the gap progresses (thirds), giving a visual read of
 * how much of the interlude remains.
 */
export const LyricsInterludeRow = memo(function LyricsInterludeRow({
  pairIndex,
  activeIndex,
  fromMs,
  toMs,
  extrapolatedMs,
  textColor,
}: LyricsInterludeRowProps) {
  const isActive = useDerivedValue(
    () => (activeIndex.value === pairIndex ? 1 : 0),
    [pairIndex],
  );

  const progress = useDerivedValue(() => {
    if (activeIndex.value !== pairIndex) return 0;
    const span = toMs - fromMs;
    if (span <= 0) return 0;
    const p = (extrapolatedMs.value - fromMs) / span;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }, [pairIndex, fromMs, toMs]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: withSpring(isActive.value, SPRING),
  }));

  return (
    <Animated.View style={[styles.row, containerStyle]}>
      {Array.from({ length: DOT_COUNT }).map((_, i) => (
        <Dot key={i} index={i} progress={progress} color={textColor} />
      ))}
    </Animated.View>
  );
});

interface DotProps {
  index: number;
  progress: SharedValue<number>;
  color: string;
}

const Dot = memo(function Dot({ index, progress, color }: DotProps) {
  const dotStyle = useAnimatedStyle(() => {
    const threshold = index / DOT_COUNT;
    const range = 1 / DOT_COUNT;
    const local = (progress.value - threshold) / range;
    const clamped = local < 0 ? 0 : local > 1 ? 1 : local;
    return {
      opacity: withSpring(0.25 + 0.75 * clamped, SPRING),
      transform: [{ scale: withSpring(0.7 + 0.3 * clamped, SPRING) }],
    };
  });
  return (
    <Animated.View
      style={[styles.dot, { backgroundColor: color }, dotStyle]}
    />
  );
});

const styles = StyleSheet.create({
  row: {
    height: 28,
    marginVertical: 6,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

