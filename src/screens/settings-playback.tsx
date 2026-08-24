import Ionicons from '@react-native-vector-icons/ionicons/static';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useCallback, useContext } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomChrome } from '../components/BottomChrome';
import { GradientBackground } from '../components/GradientBackground';
import { BackgroundPlaybackCard } from '../components/settings/BackgroundPlaybackCard';
import { DownloadingCard } from '../components/settings/DownloadingCard';
import { EqualizerCard } from '../components/settings/EqualizerCard';
import { LookaheadCacheCard } from '../components/settings/LookaheadCacheCard';
import { PlaybackModeCard } from '../components/settings/PlaybackModeCard';
import { PlayerControlsCard } from '../components/settings/PlayerControlsCard';
import { RemoteControlsCard } from '../components/settings/RemoteControlsCard';
import { ReplayGainCard } from '../components/settings/ReplayGainCard';
import { SkipIntervalsCard } from '../components/settings/SkipIntervalsCard';
import { StreamingCard } from '../components/settings/StreamingCard';
import { StreamFormatSheet } from '../components/StreamFormatSheet';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import {
  applyLookaheadCacheConfig,
  applyPlaybackMode,
  applyReplayGain,
  setAutoplayEnabled,
  updateRemoteCapabilities,
} from '../services/playerService';
import { playbackSettingsStore } from '../store/playbackSettingsStore';
import { settingsStyles } from '../styles/settingsStyles';

export function SettingsPlaybackScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { confirm } = useThemedAlert();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  // Subscribe to enough state to derive `isDefault` — used to show/hide the
  // reset button. Individual cards own the setters for their respective
  // fields; reset has to clear them all in one go.
  const maxBitRate = playbackSettingsStore((s) => s.maxBitRate);
  const streamFormat = playbackSettingsStore((s) => s.streamFormat);
  const estimateContentLength = playbackSettingsStore((s) => s.estimateContentLength);
  const downloadMaxBitRate = playbackSettingsStore((s) => s.downloadMaxBitRate);
  const downloadFormat = playbackSettingsStore((s) => s.downloadFormat);
  const showSkipIntervalButtons = playbackSettingsStore((s) => s.showSkipIntervalButtons);
  const showSleepTimerButton = playbackSettingsStore((s) => s.showSleepTimerButton);
  const skipBackwardInterval = playbackSettingsStore((s) => s.skipBackwardInterval);
  const skipForwardInterval = playbackSettingsStore((s) => s.skipForwardInterval);
  const remoteControlMode = playbackSettingsStore((s) => s.remoteControlMode);
  const lookaheadEnabled = playbackSettingsStore((s) => s.lookaheadEnabled);
  const lookaheadCount = playbackSettingsStore((s) => s.lookaheadCount);
  const playbackMode = playbackSettingsStore((s) => s.playbackMode);
  const crossfadeDurationMs = playbackSettingsStore((s) => s.crossfadeDurationMs);
  const replayGainMode = playbackSettingsStore((s) => s.replayGainMode);
  const autoplayEnabled = playbackSettingsStore((s) => s.autoplayEnabled);

  const isDefault =
    maxBitRate === null &&
    streamFormat === 'raw' &&
    !estimateContentLength &&
    downloadMaxBitRate === 320 &&
    downloadFormat === 'mp3' &&
    !showSkipIntervalButtons &&
    !showSleepTimerButton &&
    skipBackwardInterval === 15 &&
    skipForwardInterval === 30 &&
    remoteControlMode === 'skip-track' &&
    lookaheadEnabled &&
    lookaheadCount === 3 &&
    playbackMode === 'gapless' &&
    crossfadeDurationMs === 5000 &&
    replayGainMode === 'off' &&
    !autoplayEnabled;

  const handleResetDefaults = useCallback(() => {
    confirm({
      title: t('resetToDefaults'),
      message: t('resetSoundPlaybackMessage'),
      confirmLabel: t('reset'),
      destructive: true,
      onConfirm: () => {
        const s = playbackSettingsStore.getState();
        s.setMaxBitRate(null);
        s.setStreamFormat('raw');
        s.setEstimateContentLength(false);
        s.setDownloadMaxBitRate(320);
        s.setDownloadFormat('mp3');
        s.setShowSkipIntervalButtons(false);
        s.setShowSleepTimerButton(false);
        s.setSkipBackwardInterval(15);
        s.setSkipForwardInterval(30);
        s.setRemoteControlMode('skip-track');
        s.setLookaheadEnabled(true);
        s.setLookaheadCount(3);
        s.setPlaybackMode('gapless');
        s.setCrossfadeDurationMs(5000);
        s.setReplayGainMode('off');
        void setAutoplayEnabled(false);
        updateRemoteCapabilities();
        void applyLookaheadCacheConfig();
        void applyPlaybackMode();
        void applyReplayGain();
      },
    });
  }, [confirm, t]);

  return (
    <>
      <GradientBackground scrollable>
        <ScrollView
          style={settingsStyles.container}
          contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          <StreamingCard />
          <DownloadingCard />
          <EqualizerCard />
          <ReplayGainCard />
          <PlaybackModeCard />
          <LookaheadCacheCard />
          <PlayerControlsCard />
          <SkipIntervalsCard />
          <RemoteControlsCard />
          {/* Battery-optimization exemption — affects background playback, so it
              lives here under Sound & Playback (Android-only; renders null on iOS). */}
          <BackgroundPlaybackCard />

          {!isDefault && (
            <Pressable
              onPress={handleResetDefaults}
              style={({ pressed }) => [
                styles.resetButton,
                { borderColor: colors.border },
                pressed && settingsStyles.pressed,
              ]}
            >
              <Ionicons name="refresh-outline" size={16} color={colors.textPrimary} />
              <Text style={[styles.resetButtonText, { color: colors.textPrimary }]}>
                {t('resetToDefaults')}
              </Text>
            </Pressable>
          )}
        </ScrollView>
        <BottomChrome withSafeAreaPadding />
      </GradientBackground>
      <StreamFormatSheet />
    </>
  );
}

const styles = StyleSheet.create({
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
