/**
 * PlaybackRateButton – text label showing the current playback speed.
 *
 * Displays the current rate (e.g. "1x") and opens the PlaybackSpeedSheet
 * picker on tap. Uses textPrimary at the default 1x rate, and the primary
 * accent colour when sped up / slowed.
 */

import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PlaybackSpeedSheet } from './PlaybackSpeedSheet';
import { useTheme } from '../hooks/useTheme';
import { isRadioId } from '../services/subsonicService';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { playerStore } from '../store/playerStore';

/** Format rate into a compact label: 1 → "1x", 0.75 → ".75x", 1.25 → "1.25x". */
function formatRate(rate: number): string {
  if (Number.isInteger(rate)) return `${rate}x`;
  if (rate < 1) return `${rate.toString().replace('0.', '.')}x`;
  return `${rate}x`;
}

export const PlaybackRateButton = memo(function PlaybackRateButton() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const playbackRate = playbackSettingsStore((s) => s.playbackRate);
  const isRadio = playerStore((s) => (s.currentTrack ? isRadioId(s.currentTrack.id) : false));
  const [sheetVisible, setSheetVisible] = useState(false);

  const handlePress = useCallback(() => {
    setSheetVisible(true);
  }, []);

  const isDefault = playbackRate === 1;
  const labelColor = isDefault ? colors.textPrimary : colors.primary;

  // Playback speed is meaningless on a live stream.
  if (isRadio) return null;

  return (
    <>
      <Pressable
        onPress={handlePress}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('playbackSpeedLabel', { rate: playbackRate })}
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

      <PlaybackSpeedSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </>
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
