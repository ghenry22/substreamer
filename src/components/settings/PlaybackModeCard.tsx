import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../hooks/useTheme';
import { settingsStyles } from '../../styles/settingsStyles';
import {
  playbackSettingsStore,
  CROSSFADE_DURATIONS_MS,
  PLAYBACK_MODES,
  type CrossfadeDurationMs,
  type PlaybackModeSetting,
} from '../../store/playbackSettingsStore';
import { applyPlaybackMode } from '../../services/playerService';
import { DropdownRow, type DropdownOption } from './DropdownRow';
import { AutoplayCard } from './AutoplayCard';
import { SettingsSectionTitle } from './SettingsSectionTitle';

/**
 * Track-transition mode: gapless (default) vs crossfade. Both are explicit
 * named options; the crossfade-duration selector is only shown for crossfade.
 */
export function PlaybackModeCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const mode = playbackSettingsStore((s) => s.playbackMode);
  const durationMs = playbackSettingsStore((s) => s.crossfadeDurationMs);
  const setMode = playbackSettingsStore((s) => s.setPlaybackMode);
  const setDuration = playbackSettingsStore((s) => s.setCrossfadeDurationMs);

  const isCrossfade = mode === 'crossfade';

  const modeOptions: DropdownOption<PlaybackModeSetting>[] = useMemo(
    () =>
      PLAYBACK_MODES.map((m) => ({
        value: m,
        label: m === 'crossfade' ? t('playbackModeCrossfade') : t('playbackModeGapless'),
      })),
    [t],
  );

  const durationOptions: DropdownOption<CrossfadeDurationMs>[] = useMemo(
    () => CROSSFADE_DURATIONS_MS.map((ms) => ({ value: ms, label: t('secondsValue', { count: ms / 1000 }) })),
    [t],
  );

  const handleModeChange = useCallback(
    (value: PlaybackModeSetting) => {
      setMode(value);
      void applyPlaybackMode();
    },
    [setMode],
  );

  const handleDurationChange = useCallback(
    (value: CrossfadeDurationMs) => {
      setDuration(value);
      void applyPlaybackMode();
    },
    [setDuration],
  );

  return (
    <View style={settingsStyles.section}>
      <SettingsSectionTitle>{t('playbackMode')}</SettingsSectionTitle>
      <View style={[settingsStyles.card, { backgroundColor: colors.card }]}>
        <DropdownRow
          label={t('playbackModeLabel')}
          value={mode}
          options={modeOptions}
          onChange={handleModeChange}
          isLast={false}
        />
        {isCrossfade && (
          <DropdownRow
            label={t('crossfadeDuration')}
            value={durationMs}
            options={durationOptions}
            onChange={handleDurationChange}
            isLast={false}
          />
        )}
        <AutoplayCard />
      </View>
    </View>
  );
}
