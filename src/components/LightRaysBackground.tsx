import { memo, useEffect, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { useTheme } from '../hooks/useTheme';
import { hexWithAlpha } from '../utils/colors';

/** Where the light originates, as fractions of the screen: behind the cover and title. */
const SOURCE_X = 0.5;
const SOURCE_Y = 0.3;

interface RaySpec {
  /** Degrees from straight down; positive swings clockwise. */
  angle: number;
  /** Width at the far end, as a fraction of screen width. */
  width: number;
  /** Length as a fraction of screen height. */
  length: number;
  /** Opacity range the ray drifts between. */
  opacity: [number, number];
  /** Rotation drift in degrees either side of `angle`. */
  sway: number;
  duration: number;
  /** Starting phase 0..1 so rays never move in lockstep. */
  phase: number;
  color: string;
}

const RAYS: RaySpec[] = [
  { angle: -82, width: 0.34, length: 0.7, opacity: [0.10, 0.68], sway: 5, duration: 13000, phase: 0.1, color: '#BDEFFF' },
  { angle: -58, width: 0.22, length: 0.95, opacity: [0.24, 0.85], sway: 4, duration: 10500, phase: 0.6, color: '#FFFFFF' },
  { angle: -37, width: 0.3, length: 0.85, opacity: [0.08, 0.71], sway: 6, duration: 15000, phase: 0.3, color: '#9FE6F2' },
  { angle: -18, width: 0.16, length: 1.0, opacity: [0.30, 0.94], sway: 3, duration: 9000, phase: 0.85, color: '#E6FAFF' },
  { angle: 4, width: 0.26, length: 1.0, opacity: [0.20, 0.85], sway: 4, duration: 12000, phase: 0.45, color: '#FFFFFF' },
  { angle: 24, width: 0.18, length: 0.9, opacity: [0.28, 0.88], sway: 4, duration: 9800, phase: 0.2, color: '#B5F0F5' },
  { angle: 44, width: 0.32, length: 0.8, opacity: [0.06, 0.68], sway: 6, duration: 14500, phase: 0.75, color: '#D4F6FF' },
  { angle: 63, width: 0.2, length: 0.95, opacity: [0.20, 0.78], sway: 4, duration: 11200, phase: 0.5, color: '#FFFFFF' },
  { angle: 86, width: 0.36, length: 0.7, opacity: [0.08, 0.61], sway: 5, duration: 16000, phase: 0.95, color: '#A6E9F7' },
  { angle: 168, width: 0.24, length: 0.3, opacity: [0.06, 0.51], sway: 6, duration: 12500, phase: 0.35, color: '#CFF5FF' },
  { angle: -164, width: 0.2, length: 0.3, opacity: [0.06, 0.48], sway: 5, duration: 13500, phase: 0.65, color: '#FFFFFF' },
];

interface BlobSpec {
  x: number;
  y: number;
  size: number;
  color: string;
  drift: number;
  duration: number;
  phase: number;
}

const BLOBS: BlobSpec[] = [
  { x: 0.2, y: 0.34, size: 0.8, color: '#4FD6E8', drift: 0.1, duration: 17000, phase: 0.2 },
  { x: 0.82, y: 0.26, size: 0.7, color: '#7FE3F0', drift: 0.08, duration: 14000, phase: 0.7 },
  { x: 0.5, y: 0.5, size: 0.9, color: '#2FB7CC', drift: 0.07, duration: 19000, phase: 0.5 },
];

/** Slow 0..1..0 oscillation that keeps running regardless of re-renders. */
function useOscillation(duration: number, phase: number) {
  const progress = useSharedValue(phase);
  useEffect(() => {
    progress.value = phase;
    progress.value = withRepeat(
      withTiming(phase < 0.5 ? 1 : 0, { duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [progress, duration, phase]);
  return progress;
}

const Ray = memo(function Ray({
  spec,
  sx,
  sy,
  screenWidth,
  screenHeight,
}: {
  spec: RaySpec;
  sx: number;
  sy: number;
  screenWidth: number;
  screenHeight: number;
}) {
  const progress = useOscillation(spec.duration, spec.phase);
  const rayWidth = screenWidth * spec.width;
  const rayLength = screenHeight * spec.length;
  const id = `ray-${spec.color.slice(1)}`;
  const mid = rayWidth / 2;

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: spec.opacity[0] + (spec.opacity[1] - spec.opacity[0]) * p,
      transform: [
        { rotate: `${spec.angle + spec.sway * (p * 2 - 1)}deg` },
        { scaleX: 0.85 + 0.3 * p },
      ],
    };
  });

  return (
    <Animated.View
      renderToHardwareTextureAndroid
      style={[
        {
          position: 'absolute',
          left: sx - rayWidth / 2,
          top: sy,
          width: rayWidth,
          height: rayLength,
          transformOrigin: 'center top',
        },
        style,
      ]}
    >
      <Svg width={rayWidth} height={rayLength}>
        <Defs>
          <SvgLinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={spec.color} stopOpacity="0.95" />
            <Stop offset="0.3" stopColor={spec.color} stopOpacity="0.4" />
            <Stop offset="1" stopColor={spec.color} stopOpacity="0" />
          </SvgLinearGradient>
        </Defs>
        {/* A broad faint wedge with a narrower, brighter core gives the beam soft edges. */}
        <Path d={`M${mid - 3} 0 L${mid + 3} 0 L${rayWidth} ${rayLength} L0 ${rayLength} Z`} fill={`url(#${id})`} fillOpacity={0.45} />
        <Path
          d={`M${mid - 2} 0 L${mid + 2} 0 L${mid + rayWidth * 0.22} ${rayLength} L${mid - rayWidth * 0.22} ${rayLength} Z`}
          fill={`url(#${id})`}
        />
      </Svg>
    </Animated.View>
  );
});

const Blob = memo(function Blob({
  spec,
  screenWidth,
  screenHeight,
}: {
  spec: BlobSpec;
  screenWidth: number;
  screenHeight: number;
}) {
  const progress = useOscillation(spec.duration, spec.phase);
  const size = screenWidth * spec.size;
  const id = `blob-${spec.color.slice(1)}`;

  const style = useAnimatedStyle(() => {
    const p = progress.value * 2 - 1;
    return {
      opacity: 0.35 + 0.15 * progress.value,
      transform: [
        { translateX: p * screenWidth * spec.drift },
        { translateY: -p * screenWidth * spec.drift * 0.6 },
      ],
    };
  });

  return (
    <Animated.View
      renderToHardwareTextureAndroid
      style={[
        {
          position: 'absolute',
          left: screenWidth * spec.x - size / 2,
          top: screenHeight * spec.y - size / 2,
          width: size,
          height: size,
        },
        style,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={spec.color} stopOpacity="0.55" />
            <Stop offset="0.6" stopColor={spec.color} stopOpacity="0.15" />
            <Stop offset="1" stopColor={spec.color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Path
          d={`M0 ${size / 2} a${size / 2} ${size / 2} 0 1 0 ${size} 0 a${size / 2} ${size / 2} 0 1 0 -${size} 0 Z`}
          fill={`url(#${id})`}
        />
      </Svg>
    </Animated.View>
  );
});

/**
 * Slowly moving beams of white-cyan light fanning out from a source behind the cover.
 * Everything is vector gradients; the animation runs on the UI thread and is not
 * keyed to track changes, so it keeps flowing when the song switches.
 */
export const LightRaysBackground = memo(function LightRaysBackground() {
  const { theme, colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const sx = width * SOURCE_X;
  const sy = height * SOURCE_Y;

  const pulse = useOscillation(6500, 0.3);
  const coreSize = width * 1.7;
  const coreStyle = useAnimatedStyle(() => ({
    opacity: 0.75 + 0.25 * pulse.value,
    transform: [{ scale: 0.94 + 0.12 * pulse.value }],
  }));

  const fadeColors = useMemo(
    () => [hexWithAlpha(colors.background, 0), hexWithAlpha(colors.background, 0.9), colors.background] as const,
    [colors.background],
  );

  if (theme !== 'dark') return null;

  return (
    <View style={styles.root} pointerEvents="none">
      <LinearGradient
        colors={['rgba(120,220,245,0.45)', 'rgba(60,170,200,0.2)', 'rgba(0,0,0,0)']}
        locations={[0, 0.5, 1]}
        style={[styles.sky, { height: height * 0.6 }]}
      />
      {BLOBS.map((spec) => (
        <Blob key={spec.color} spec={spec} screenWidth={width} screenHeight={height} />
      ))}
      {RAYS.map((spec) => (
        <Ray
          key={spec.angle}
          spec={spec}
          sx={sx}
          sy={sy}
          screenWidth={width}
          screenHeight={height}
        />
      ))}
      <Animated.View
        renderToHardwareTextureAndroid
        style={[
          {
            position: 'absolute',
            left: sx - coreSize / 2,
            top: sy - coreSize / 2,
            width: coreSize,
            height: coreSize,
          },
          coreStyle,
        ]}
      >
        <Svg width={coreSize} height={coreSize}>
          <Defs>
            <RadialGradient id="core-light" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
              <Stop offset="0.15" stopColor="#F2FCFF" stopOpacity="0.8" />
              <Stop offset="0.4" stopColor="#8FE1F0" stopOpacity="0.4" />
              <Stop offset="0.7" stopColor="#3AB9D0" stopOpacity="0.08" />
              <Stop offset="1" stopColor="#3AB9D0" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Path
            d={`M0 ${coreSize / 2} a${coreSize / 2} ${coreSize / 2} 0 1 0 ${coreSize} 0 a${coreSize / 2} ${coreSize / 2} 0 1 0 -${coreSize} 0 Z`}
            fill="url(#core-light)"
          />
        </Svg>
      </Animated.View>
      {/* The lower part of the screen dissolves into near-black so controls stay legible. */}
      <LinearGradient
        colors={fadeColors}
        locations={[0, 0.55, 1]}
        style={[styles.fade, { top: height * 0.42 }]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  sky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
