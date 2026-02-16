/**
 * PlaybackRateButton – text-based toggle for playback speed.
 *
 * Displays the current rate (e.g. "1x") and cycles through
 * predefined speeds on each tap.  Uses textPrimary when at the
 * default 1x rate, and the primary accent colour when active.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { cyclePlaybackRate } from '../services/playerService';
import { playbackSettingsStore } from '../store/playbackSettingsStore';

/** Format rate into a compact label: 1 → "1x", 0.75 → ".75x", 1.25 → "1.25x". */
function formatRate(rate: number): string {
  if (Number.isInteger(rate)) return `${rate}x`;
  if (rate < 1) return `${rate.toString().replace('0.', '.')}x`;
  return `${rate}x`;
}

export const PlaybackRateButton = memo(function PlaybackRateButton() {
  const { colors } = useTheme();
  const playbackRate = playbackSettingsStore((s) => s.playbackRate);

  const handlePress = useCallback(() => {
    cyclePlaybackRate();
  }, []);

  const isDefault = playbackRate === 1;
  const labelColor = isDefault ? colors.textPrimary : colors.primary;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`Playback speed ${playbackRate}x. Tap to change.`}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[styles.label, { color: labelColor }]}
        allowFontScaling={false}
      >
        {formatRate(playbackRate)}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.6,
  },
});
