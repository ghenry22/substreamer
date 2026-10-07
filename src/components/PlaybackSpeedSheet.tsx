/**
 * PlaybackSpeedSheet — bottom-sheet picker for playback speed + pitch
 * correction, opened from the player's PlaybackRateButton.
 *
 * Speed: a continuous slider from 0.5x to 2x in 0.1-step increments. The
 * current value is shown above the slider; dragging applies the rate
 * immediately so the user can hear the effect live.
 *
 * Pitch correction (None / Voice / Music): only effective at rate != 1x
 * (RNQP auto-bypasses at 1x). None follows the rate; Voice/Music preserve pitch.
 */

import { memo, useCallback } from 'react';
import Slider from '@react-native-community/slider';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from './BottomSheet';
import { useTheme } from '../hooks/useTheme';
import { applyPitchCorrection, applyPlaybackRate } from '../services/playerService';
import {
  PITCH_CORRECTION_MODES,
  playbackSettingsStore,
  type PitchCorrection,
  type PlaybackRate,
} from '../store/playbackSettingsStore';
import { selectionAsync } from '../utils/haptics';

const SPEED_MIN = 0.5;
const SPEED_MAX = 2;
const SPEED_STEP = 0.1;

/** Compact rate label: 1 → "1x", 1.5 → "1.5x". */
function formatRate(rate: number): string {
  // Avoid floating-point display noise (e.g. 0.9000000001x).
  const rounded = Math.round(rate * 10) / 10;
  return `${rounded}x`;
}

const PITCH_LABEL_KEYS: Record<PitchCorrection, string> = {
  none: 'pitchCorrectionNone',
  voice: 'pitchCorrectionVoice',
  music: 'pitchCorrectionMusic',
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

export const PlaybackSpeedSheet = memo(function PlaybackSpeedSheet({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const playbackRate = playbackSettingsStore((s) => s.playbackRate);
  const pitchCorrection = playbackSettingsStore((s) => s.pitchCorrection);

  const handleSliderChange = useCallback((value: number) => {
    const snapped = Math.round(value * 10) / 10 as PlaybackRate;
    void applyPlaybackRate(snapped);
  }, []);

  const handleSlidingComplete = useCallback((value: number) => {
    const snapped = Math.round(value * 10) / 10 as PlaybackRate;
    selectionAsync();
    void applyPlaybackRate(snapped);
  }, []);

  const handleSelectPitch = useCallback((mode: PitchCorrection) => {
    selectionAsync();
    void applyPitchCorrection(mode);
  }, []);

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="55%" scrollable={false}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('playbackSpeed')}</Text>

      <View style={styles.sliderRow}>
        <Text style={[styles.speedMin, { color: colors.textSecondary }]}>
          {formatRate(SPEED_MIN)}
        </Text>
        <Text style={[styles.speedCurrent, { color: colors.primary }]}>
          {formatRate(playbackRate)}
        </Text>
        <Text style={[styles.speedMax, { color: colors.textSecondary }]}>
          {formatRate(SPEED_MAX)}
        </Text>
      </View>

      <Slider
        style={styles.slider}
        minimumValue={SPEED_MIN}
        maximumValue={SPEED_MAX}
        step={SPEED_STEP}
        value={playbackRate}
        onValueChange={handleSliderChange}
        onSlidingComplete={handleSlidingComplete}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.primary}
        accessibilityLabel={t('playbackSpeedSlider')}
      />

      <Text style={[styles.sectionLabel, { color: colors.label }]}>
        {t('pitchCorrection')}
      </Text>
      <View style={styles.pitchRow}>
        {PITCH_CORRECTION_MODES.map((mode) => {
          const active = mode === pitchCorrection;
          return (
            <Pressable
              key={mode}
              onPress={() => handleSelectPitch(mode)}
              style={({ pressed }) => [
                styles.pill,
                { backgroundColor: active ? colors.primary : colors.inputBg },
                pressed && styles.pillPressed,
              ]}
            >
              <Text style={[styles.pillLabel, { color: active ? '#fff' : colors.textSecondary }]}>
                {t(PITCH_LABEL_KEYS[mode])}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', paddingHorizontal: 4, marginBottom: 14 },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  speedMin: { fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 36 },
  speedCurrent: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  speedMax: { fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 36, textAlign: 'right' },
  slider: { width: '100%', height: 40 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 4,
    marginTop: 24,
    marginBottom: 10,
  },
  pitchRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  pill: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPressed: { opacity: 0.7 },
  pillLabel: { fontSize: 14, fontWeight: '600' },
});
