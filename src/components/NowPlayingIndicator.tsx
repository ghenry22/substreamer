/**
 * Animated EQ-bars indicator for the currently-playing track.
 *
 * Renders N vertical bars (default 4) that bounce between a low and a
 * high height on slightly-different periods, producing a classic "music
 * visualiser" look that signals "this is the active track" without
 * occluding the cover art behind it.
 *
 * Animation is paused when the host playerStore reports a non-playing
 * state — the bars freeze at their current height rather than vanishing,
 * so a paused track still reads as "the active one".
 *
 * It renders NOTHING while the app is backgrounded or the screen is not focused.
 * This is decoration, not data: with nothing on screen to read, frozen bars are
 * three views and three shared values kept alive for no one. Unmounting also
 * releases the Reanimated animations outright rather than parking them.
 *
 * Each bar's animation runs on the native (UI) thread via Reanimated, so
 * the indicator does not impact JS thread responsiveness when many rows
 * are mounted (e.g. scrolling an album with the active track on screen).
 */

import { useIsFocused } from "expo-router/react-navigation";
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { playerStore } from '../store/playerStore';
import { useAppActive } from '../hooks/useAppActive';

export interface NowPlayingIndicatorProps {
  /** Total width/height of the indicator container in dp. Bars and gaps
   *  scale down from this. Default 24 (matches the size of an icon). */
  size?: number;
  /** Color of the bars. Defaults to the bundled accent ramp via the
   *  caller — pass `colors.primary` from the host theme. */
  color: string;
  /** Number of bars. Spotify-style is 3; 4 also reads well. Default 3. */
  barCount?: number;
}

/**
 * Spotify-style keyframe sequence — five non-uniform stops over 2.2s
 * total. Each bar runs this same sequence but enters it at a different
 * phase (see PHASE_OFFSETS) so the three bars never sync up. The CSS
 * reference: `0%:1.0 → 10%:0.3 → 30%:1.0 → 60%:0.5 → 80%:0.75 → 100%:0.6`
 * with `animation: 2.2s ease infinite alternate`.
 *
 * Each entry: target value + the duration of the transition into it.
 * The 0% implicit `1.0` is the SharedValue's initial seed (see
 * `buildBarInitial`) and is what each bar lands on at the loop's
 * `alternate`-reverse return.
 */
interface Keyframe { value: number; duration: number }
const KEYFRAMES: Keyframe[] = [
  { value: 0.3,  duration: 220 }, //  0% → 10%
  { value: 1.0,  duration: 440 }, // 10% → 30%
  { value: 0.5,  duration: 660 }, // 30% → 60%
  { value: 0.75, duration: 440 }, // 60% → 80%
  { value: 0.6,  duration: 440 }, // 80% → 100%
];

/** Per-bar phase offset (index into KEYFRAMES). Picks distinct enough
 *  starting values that the bars look visually separate on the first
 *  frame. Indices chosen so bar 0 starts high, bar 1 dips low,
 *  bar 2 sits mid. */
const PHASE_OFFSETS = [0, 1, 3];

/** Frozen height when paused (between min and max so it reads neither
 *  flat nor fully extended). */
const BAR_PAUSED_FRACTION = 0.45;

/** Initial SharedValue seed for a bar with the given phase offset:
 *  the keyframe value that the bar is leaving as the sequence begins.
 *  Offset 0 maps to the implicit CSS 0% value (1.0). */
function buildBarInitial(offset: number): number {
  return offset === 0 ? 1.0 : KEYFRAMES[(offset - 1 + KEYFRAMES.length) % KEYFRAMES.length].value;
}

/** Keyframes rotated so the bar's animation begins from the keypoint
 *  immediately after its initial seed value. */
function rotateKeyframes(offset: number): Keyframe[] {
  return [...KEYFRAMES.slice(offset), ...KEYFRAMES.slice(0, offset)];
}

export const NowPlayingIndicator = memo(function NowPlayingIndicator({
  size = 24,
  color,
  barCount = 3,
}: NowPlayingIndicatorProps) {
  const isPlaying = playerStore((s) => s.playbackState === 'playing');
  // Only run the looping visualiser while foreground-active — an off-screen
  // `withRepeat(-1)` keeps the UI thread busy and overheats the device during
  // background playback. Backgrounded, the bars freeze at the paused height.
  const isActive = useAppActive();
  // Not focused means another screen is on top; the list underneath can stay mounted,
  // so without this the bars keep animating on the UI thread where nobody can see them.
  const isFocused = useIsFocused();
  const visible = isActive && isFocused;
  const shouldAnimate = isPlaying && visible;

  // Pre-create shared values for up to PHASE_OFFSETS.length bars. Each
  // bar's initial seed comes from `buildBarInitial` so the first frame
  // already shows distinct heights — no JS-side reset assignment that
  // could race the animation commit (the original cause of the
  // "frozen bars" bug).
  const sv0 = useSharedValue(buildBarInitial(PHASE_OFFSETS[0]));
  const sv1 = useSharedValue(buildBarInitial(PHASE_OFFSETS[1]));
  const sv2 = useSharedValue(buildBarInitial(PHASE_OFFSETS[2]));
  const allShared = [sv0, sv1, sv2];
  const shared = allShared.slice(0, Math.min(barCount, allShared.length));

  useEffect(() => {
    if (shouldAnimate) {
      shared.forEach((sv, i) => {
        const offset = PHASE_OFFSETS[i] ?? 0;
        const [k1, k2, k3, k4, k5] = rotateKeyframes(offset);
        // Linear easing per segment is intentional. CSS `ease` applied to
        // a multi-keyframe animation looks smooth because the bar's
        // *trajectory* changes at each keyframe but its *velocity*
        // doesn't drop to zero. Reanimated's withSequence builds a chain
        // where each segment runs independently — so per-segment
        // ease-in-out causes the bar to decelerate at every keyframe and
        // re-accelerate at the next, producing the "glitchy pause at
        // every step" feel. Linear keeps velocity constant within a
        // segment, and the keyframe values themselves do the visual
        // shaping (the durations vary 220/440/660/440/440 ms which
        // creates the organic feel).
        const step = (k: Keyframe) =>
          withTiming(k.value, {
            duration: k.duration,
            easing: Easing.linear,
          });
        // `withRepeat(seq, -1, true)` loops the chain indefinitely,
        // reversing each iteration — matches CSS
        // `animation-direction: alternate`. 5 explicit args because
        // KEYFRAMES is always length 5 (rotated, not resized).
        sv.value = withRepeat(
          withSequence(step(k1), step(k2), step(k3), step(k4), step(k5)),
          -1,
          true,
        );
      });
    } else {
      // Freeze at a mid-height so the indicator still reads as present
      // when playback is paused but the same track is loaded. Assigning
      // a new animation to sv.value automatically supersedes whatever
      // animation was in flight — no manual cancelAnimation needed.
      shared.forEach((sv) => {
        sv.value = withTiming(BAR_PAUSED_FRACTION, { duration: 200 });
      });
    }
    // Intentionally NO cleanup `cancelAnimation` here. Cancelling on every dep
    // change races the UI thread when isPlaying flips pause→play: the cancel can
    // land after the body's `sv.value = withRepeat(...)`, and since
    // cancelAnimation freezes the SV at its current value the bars stay stuck at
    // the paused mid-height. Reanimated replaces an SV's animation on a new
    // assignment, so the only cancel needed is on unmount — handled by the
    // separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAnimate, barCount]);

  // Unmount-only: stop any in-flight animations so they don't leak.
  useEffect(() => {
    return () => {
      [sv0, sv1, sv2].forEach((sv) => cancelAnimation(sv));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bail AFTER every hook, so hook order never changes between renders.
  if (!visible) return null;

  // Bar geometry: equal-width bars with equal gaps, totalling `size`.
  const gap = Math.max(1, Math.floor(size / (barCount * 4)));
  const barWidth = Math.max(2, Math.floor((size - gap * (barCount - 1)) / barCount));

  return (
    <View
      style={[styles.row, { width: size, height: size, gap }]}
      accessibilityLabel="now-playing-indicator"
      testID="now-playing-indicator"
    >
      {shared.map((sv, i) => (
        <AnimatedBar
          key={i}
          fraction={sv}
          width={barWidth}
          color={color}
          containerHeight={size}
        />
      ))}
    </View>
  );
});

interface AnimatedBarProps {
  fraction: ReturnType<typeof useSharedValue<number>>;
  width: number;
  color: string;
  containerHeight: number;
}

/** Internal: one bar of the visualiser. The bar is rendered at full
 *  container height and animated via `transform: scaleY` from the
 *  bottom edge. This keeps the animation entirely on the GPU/UI
 *  thread — no layout pass per frame, no re-measurement — which is
 *  the difference between this looking janky vs smooth on lower-end
 *  devices and when the host list is busy. */
const AnimatedBar = memo(function AnimatedBar({
  fraction,
  width,
  color,
  containerHeight,
}: AnimatedBarProps) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: fraction.value }],
  }));
  return (
    <Animated.View
      style={[
        styles.bar,
        {
          width,
          height: containerHeight,
          backgroundColor: color,
          borderRadius: Math.floor(width / 2),
          // Scale from the baseline up — matches CSS
          // `transform-origin: bottom`. Without this the bar would
          // scale from its centre and float in the middle of the row.
          transformOrigin: 'bottom',
        },
        style,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // Bars are full container height and scaleY'd from the bottom, so
    // we don't need flex-end alignment; centre is fine and the
    // transform handles the visual anchoring.
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    // Intentionally no minHeight — the bar's actual height is fixed at
    // the container height; scaleY does the visual work.
  },
});
