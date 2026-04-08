/**
 * SkipIntervalButton – skip forward or backward by a configurable interval.
 *
 * Reads the interval from playbackSettingsStore and calls skipByInterval()
 * on press. Uses a custom SVG icon matching the industry standard (Apple
 * Podcasts, Spotify, Material Design): an open circular arrow arc with the
 * interval number centered inside.
 *
 * Forward = clockwise arc, backward = counter-clockwise (mirrored via scaleX).
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { skipByInterval } from '../services/playerService';
import { playbackSettingsStore } from '../store/playbackSettingsStore';

interface SkipIntervalButtonProps {
  direction: 'forward' | 'backward';
  size?: number;
}

/**
 * SVG arc path from angle `start` to angle `end` (degrees, 0 = top/12-o'clock,
 * clockwise positive) on a circle at (cx, cy) with radius r.
 */
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
  const sx = cx + r * Math.cos(toRad(startDeg));
  const sy = cy + r * Math.sin(toRad(startDeg));
  const ex = cx + r * Math.cos(toRad(endDeg));
  const ey = cy + r * Math.sin(toRad(endDeg));
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep > 0 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

/**
 * Arrowhead triangle path at the end of an arc. Points tangent to the circle
 * in the direction of motion.
 */
function describeArrow(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
  arrowLen: number,
  arrowWidth: number,
  clockwise: boolean,
): string {
  const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
  // Point on the circle where the arrowhead sits
  const px = cx + r * Math.cos(toRad(angleDeg));
  const py = cy + r * Math.sin(toRad(angleDeg));
  // Tangent direction (perpendicular to radius)
  const tangent = toRad(angleDeg) + (clockwise ? Math.PI / 2 : -Math.PI / 2);
  // Tip of arrow extends along tangent
  const tipX = px + arrowLen * Math.cos(tangent);
  const tipY = py + arrowLen * Math.sin(tangent);
  // Two base corners perpendicular to tangent
  const perpX = arrowWidth * Math.cos(tangent + Math.PI / 2);
  const perpY = arrowWidth * Math.sin(tangent + Math.PI / 2);
  return [
    `M ${tipX.toFixed(2)} ${tipY.toFixed(2)}`,
    `L ${(px + perpX).toFixed(2)} ${(py + perpY).toFixed(2)}`,
    `L ${(px - perpX).toFixed(2)} ${(py - perpY).toFixed(2)}`,
    'Z',
  ].join(' ');
}

// Pre-computed paths for the forward icon (24x24 viewBox).
// Circle centered at (12, 13), radius 8.
// Arc from 38° to 322° clockwise (284° sweep), wider gap at top for arrowhead clarity.
// Larger arrowhead at the start (38°) pointing clockwise.
const CX = 12;
const CY = 13;
const R = 8;
const ARC_START = 38;
const ARC_END = 322;

const FORWARD_ARC = describeArc(CX, CY, R, ARC_START, ARC_END);
const FORWARD_ARROW = describeArrow(CX, CY, R, ARC_END, 6, 3, true);

export const SkipIntervalButton = memo(function SkipIntervalButton({
  direction,
  size = 24,
}: SkipIntervalButtonProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const interval = playbackSettingsStore((s) =>
    direction === 'forward' ? s.skipForwardInterval : s.skipBackwardInterval,
  );

  // U21: react-native-svg#2878 — iOS Fabric topSvgLayout race during
  // navigation transitions. Defer SVG mount until the player transition
  // animation finishes; the placeholder reserves the same footprint so
  // the surrounding controls don't shift on mount.
  const transitionComplete = useTransitionComplete();

  const handlePress = useCallback(() => {
    skipByInterval(direction === 'forward' ? interval : -interval);
  }, [direction, interval]);

  const label =
    direction === 'forward'
      ? t('skipForwardLabel', { interval })
      : t('skipBackwardLabel', { interval });

  // Backward icon is the forward icon mirrored horizontally
  const mirror = direction === 'backward';

  // Font size: smaller for 2-digit numbers to fit inside the arc
  const fontSize = interval >= 10 ? 7.5 : 9;

  if (!transitionComplete) {
    return (
      <Pressable
        onPress={handlePress}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      >
        <View style={{ width: size, height: size }} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <G transform={mirror ? 'translate(24, 0) scale(-1, 1)' : undefined}>
          {/* Arc stroke */}
          <Path
            d={FORWARD_ARC}
            fill="none"
            stroke={colors.textPrimary}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          {/* Arrowhead */}
          <Path
            d={FORWARD_ARROW}
            fill={colors.textPrimary}
            stroke="none"
          />
        </G>
        {/* Number — always upright (outside the mirror group) */}
        <SvgText
          x="12"
          y={CY + 1}
          textAnchor="middle"
          alignmentBaseline="central"
          fontSize={fontSize}
          fontWeight="700"
          fill={colors.textPrimary}
        >
          {interval}
        </SvgText>
      </Svg>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
