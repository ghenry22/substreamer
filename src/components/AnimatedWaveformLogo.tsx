import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
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
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { LOGO_ASPECT, LOGO_PATHS, LOGO_VIEWBOX } from '../constants/logo';

/**
 * Animated brand logo (XW mark). Pulses twice (swell, pause, swell) and then
 * calls `onComplete`; the whole sequence takes about 1.5 s.
 */

/** How far the logo swells at the peak of a pulse (1 = no change). */
const PULSE_PEAK = 1.08;

/** Duration (ms) for one up-or-down half of a pulse. */
const HALF_CYCLE = 200;

/** Pause (ms) between the first and second pulse. */
const PULSE_GAP_MS = 700;

/** Number of full double-pulse cycles before calling onComplete. */
const CYCLE_COUNT = 1;

const UP_EASING = Easing.out(Easing.sin);
const DOWN_EASING = Easing.in(Easing.sin);

type Props = {
  /** Overall size (dp) – the logo is this wide, centred in a square box. */
  size?: number;
  /** Logo colour. */
  color?: string;
  /** Called after all pulse cycles finish. */
  onComplete?: () => void;
  /**
   * Gates when the pulse sequence auto-starts on mount. When `false`,
   * the logo stays at rest until {@link WaveformHandle.start} is called
   * via ref. Defaults to `true` for standalone usage; the splash screen
   * passes `false` and triggers `start()` imperatively inside its
   * bootsplash `animate()` callback so the first pulse isn't consumed
   * while the component is still invisible.
   */
  autoStart?: boolean;
};

/** Imperative handle exposed via forwardRef for consumers that need to
 *  trigger the pulse sequence at a specific moment (e.g. the splash
 *  screen starts the animation when its bootsplash `animate()` fires). */
export type WaveformHandle = {
  start(): void;
};

const AnimatedWaveformLogo = forwardRef<WaveformHandle, Props>(function AnimatedWaveformLogo(
  { size = 130, color = '#FFFFFF', onComplete, autoStart = true },
  ref,
) {
  const scale = useSharedValue(1);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Stable JS-thread callback that reads the ref at call time.
  // Passed to runOnJS so the ref is never serialized into a worklet.
  const fireComplete = useCallback(() => {
    onCompleteRef.current?.();
  }, []);

  const startedRef = useRef(false);

  const runPulse = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const cycle = withSequence(
      // First pulse
      withTiming(PULSE_PEAK, { duration: HALF_CYCLE, easing: UP_EASING }),
      withTiming(1, { duration: HALF_CYCLE, easing: DOWN_EASING }),
      // Second pulse after a pause
      withDelay(PULSE_GAP_MS, withTiming(PULSE_PEAK, { duration: HALF_CYCLE, easing: UP_EASING })),
      withTiming(1, { duration: HALF_CYCLE, easing: DOWN_EASING }),
    );

    scale.value = withSequence(
      withRepeat(cycle, CYCLE_COUNT),
      withTiming(1, { duration: 0 }, (finished) => {
        if (finished) {
          runOnJS(fireComplete)();
        }
      }),
    ) as number;
  }, [fireComplete, scale]);

  useImperativeHandle(ref, () => ({ start: runPulse }), [runPulse]);

  useEffect(() => {
    if (autoStart) runPulse();
    return () => {
      cancelAnimation(scale);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View style={animStyle}>
        <Svg width={size} height={size / LOGO_ASPECT} viewBox={LOGO_VIEWBOX}>
          {LOGO_PATHS.map((d, i) => (
            <Path key={i} d={d} fill={color} />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
});

export default AnimatedWaveformLogo;

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
