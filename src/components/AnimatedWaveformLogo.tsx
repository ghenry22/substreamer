import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Bar height proportions – identical to WaveformLogo.tsx so the animated
 * version is a pixel-perfect stand-in for the static one.
 */
const BAR_HEIGHTS = [0.30, 0.55, 0.80, 0.50, 1.00, 0.45, 0.90, 0.60, 0.35];

const GAP_RATIO = 0.35;
const BAR_COUNT = BAR_HEIGHTS.length;

/** How much each bar stretches at the peak of a ripple (1 = no change). */
const RIPPLE_PEAK = 1.4;

/** Duration (ms) for one bar's up-then-down cycle. */
const BAR_CYCLE_MS = 400;
const HALF_CYCLE = BAR_CYCLE_MS / 2;

/** Stagger delay (ms) between consecutive bars in one sweep direction. */
const STAGGER_MS = 70;

/** Number of full left-right-left cycles before calling onComplete. */
const CYCLE_COUNT = 1;

const UP_EASING = Easing.out(Easing.sin);
const DOWN_EASING = Easing.in(Easing.sin);

type Props = {
  /** Overall size (dp) – the tallest bar will be this height. */
  size?: number;
  /** Bar colour. */
  color?: string;
  /** Called after all ripple cycles finish. */
  onComplete?: () => void;
};

/* ------------------------------------------------------------------ */
/*  Individual bar component                                           */
/* ------------------------------------------------------------------ */

const BarView = memo(function BarView({
  scale,
  barWidth,
  barHeight,
  pillRadius,
  color,
  marginLeft,
}: {
  scale: SharedValue<number>;
  barWidth: number;
  barHeight: number;
  pillRadius: number;
  color: string;
  marginLeft: number;
}) {
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: barWidth,
          height: barHeight,
          borderRadius: pillRadius,
          backgroundColor: color,
          marginLeft,
        },
        animStyle,
      ]}
    />
  );
});

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function AnimatedWaveformLogo({
  size = 130,
  color = '#FFFFFF',
  onComplete,
}: Props) {
  const barWidth = size / (BAR_COUNT + (BAR_COUNT - 1) * GAP_RATIO);
  const gap = barWidth * GAP_RATIO;
  const pillRadius = barWidth / 2;

  const s0 = useSharedValue(1);
  const s1 = useSharedValue(1);
  const s2 = useSharedValue(1);
  const s3 = useSharedValue(1);
  const s4 = useSharedValue(1);
  const s5 = useSharedValue(1);
  const s6 = useSharedValue(1);
  const s7 = useSharedValue(1);
  const s8 = useSharedValue(1);
  const scales = useMemo(() => [s0, s1, s2, s3, s4, s5, s6, s7, s8], [s0, s1, s2, s3, s4, s5, s6, s7, s8]);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Stable JS-thread callback that reads the ref at call time.
  // Passed to runOnJS so the ref is never serialized into a worklet.
  const fireComplete = useCallback(() => {
    onCompleteRef.current?.();
  }, []);

  useEffect(() => {
    const buildCycleForBar = (i: number) => {
      const fwdDelay = i * STAGGER_MS;
      const gapDelay = 2 * (BAR_COUNT - 1 - i) * STAGGER_MS;
      const endDelay = i * STAGGER_MS;

      const parts: ReturnType<typeof withTiming>[] = [];

      // Forward sweep
      const fwdUp = withTiming(RIPPLE_PEAK, { duration: HALF_CYCLE, easing: UP_EASING });
      parts.push(fwdDelay > 0 ? withDelay(fwdDelay, fwdUp) : fwdUp);
      parts.push(withTiming(1, { duration: HALF_CYCLE, easing: DOWN_EASING }));

      // Reverse sweep
      const revUp = withTiming(RIPPLE_PEAK, { duration: HALF_CYCLE, easing: UP_EASING });
      parts.push(gapDelay > 0 ? withDelay(gapDelay, revUp) : revUp);
      parts.push(withTiming(1, { duration: HALF_CYCLE, easing: DOWN_EASING }));

      // End-of-cycle alignment so all bars have equal cycle duration
      if (endDelay > 0) {
        parts.push(withDelay(endDelay, withTiming(1, { duration: 0 })));
      }

      return withSequence(...parts);
    };

    scales.forEach((scale, i) => {
      const cycle = buildCycleForBar(i);

      if (i === 0) {
        // Bar 0 finishes last in reverse sweep; fire onComplete after all cycles
        scale.value = withSequence(
          withRepeat(cycle, CYCLE_COUNT),
          withTiming(1, { duration: 0 }, (finished) => {
            if (finished) {
              runOnJS(fireComplete)();
            }
          }),
        ) as number;
      } else {
        scale.value = withRepeat(cycle, CYCLE_COUNT) as number;
      }
    });

    return () => {
      scales.forEach((s) => cancelAnimation(s));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.wrap}>
      {BAR_HEIGHTS.map((h, i) => (
        <BarView
          key={i}
          scale={scales[i]}
          barWidth={barWidth}
          barHeight={size * h}
          pillRadius={pillRadius}
          color={color}
          marginLeft={i === 0 ? 0 : gap}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
