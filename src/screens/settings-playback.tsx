import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { settingsStyles } from '../styles/settingsStyles';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { StreamFormatSheet } from '../components/StreamFormatSheet';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import { updateRemoteCapabilities } from '../services/playerService';
import {
  FORMAT_PRESETS,
  playbackSettingsStore,
  SKIP_INTERVALS,
  type ArtistPlayMode,
  type MaxBitRate,
  type RemoteControlMode,
  type SkipInterval,
  type StreamFormat,
} from '../store/playbackSettingsStore';
import { streamFormatSheetStore } from '../store/streamFormatSheetStore';

const BITRATE_OPTIONS: { value: MaxBitRate; labelKey: string }[] = [
  { value: 64, labelKey: 'bitrate64' },
  { value: 128, labelKey: 'bitrate128' },
  { value: 192, labelKey: 'bitrate192' },
  { value: 256, labelKey: 'bitrate256' },
  { value: 320, labelKey: 'bitrate320' },
  { value: null, labelKey: 'bitrateNoLimit' },
];

function formatLabelFor(value: StreamFormat, t: (key: string) => string): string {
  const preset = FORMAT_PRESETS.find((p) => p.value === value);
  return preset ? t(preset.labelKey) : value;
}

const INTERVAL_OPTIONS: { value: SkipInterval }[] =
  SKIP_INTERVALS.map((v) => ({ value: v }));

const REMOTE_OPTIONS: { value: RemoteControlMode; labelKey: string; subtitleKey: string }[] = [
  { value: 'skip-track', labelKey: 'remoteNextPreviousTrack', subtitleKey: 'remoteNextPreviousTrackSubtitle' },
  { value: 'skip-interval', labelKey: 'remoteSkipForwardBackward', subtitleKey: 'remoteSkipForwardBackwardSubtitle' },
];

const ARTIST_PLAY_MODE_OPTIONS: { value: ArtistPlayMode; labelKey: string }[] = [
  { value: 'topSongs', labelKey: 'topSongs' },
  { value: 'allSongs', labelKey: 'allSongs' },
];

export function SettingsPlaybackScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  const [bitrateOpen, setBitrateOpen] = useState(false);
  const [dlBitrateOpen, setDlBitrateOpen] = useState(false);
  const [backwardOpen, setBackwardOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);

  const maxBitRate = playbackSettingsStore((s) => s.maxBitRate);
  const streamFormat = playbackSettingsStore((s) => s.streamFormat);
  const estimateContentLength = playbackSettingsStore((s) => s.estimateContentLength);
  const downloadMaxBitRate = playbackSettingsStore((s) => s.downloadMaxBitRate);
  const downloadFormat = playbackSettingsStore((s) => s.downloadFormat);
  const setMaxBitRate = playbackSettingsStore((s) => s.setMaxBitRate);
  const setStreamFormat = playbackSettingsStore((s) => s.setStreamFormat);
  const setEstimateContentLength = playbackSettingsStore((s) => s.setEstimateContentLength);
  const setDownloadMaxBitRate = playbackSettingsStore((s) => s.setDownloadMaxBitRate);
  const setDownloadFormat = playbackSettingsStore((s) => s.setDownloadFormat);
  const showSkipIntervalButtons = playbackSettingsStore((s) => s.showSkipIntervalButtons);
  const showSleepTimerButton = playbackSettingsStore((s) => s.showSleepTimerButton);
  const skipBackwardInterval = playbackSettingsStore((s) => s.skipBackwardInterval);
  const skipForwardInterval = playbackSettingsStore((s) => s.skipForwardInterval);
  const remoteControlMode = playbackSettingsStore((s) => s.remoteControlMode);
  const artistPlayMode = playbackSettingsStore((s) => s.artistPlayMode);
  const setShowSkipIntervalButtons = playbackSettingsStore((s) => s.setShowSkipIntervalButtons);
  const setShowSleepTimerButton = playbackSettingsStore((s) => s.setShowSleepTimerButton);
  const setSkipBackwardInterval = playbackSettingsStore((s) => s.setSkipBackwardInterval);
  const setSkipForwardInterval = playbackSettingsStore((s) => s.setSkipForwardInterval);
  const setRemoteControlMode = playbackSettingsStore((s) => s.setRemoteControlMode);
  const setArtistPlayMode = playbackSettingsStore((s) => s.setArtistPlayMode);

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
    artistPlayMode === 'topSongs';

  const handleRemoteChange = useCallback(
    (mode: RemoteControlMode) => {
      setRemoteControlMode(mode);
      updateRemoteCapabilities(); /* apply immediately */
    },
    [setRemoteControlMode],
  );

  const handleResetDefaults = useCallback(() => {
    alert(
      t('resetToDefaults'),
      t('resetSoundPlaybackMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('reset'),
          style: 'destructive',
          onPress: () => {
            setMaxBitRate(null);
            setStreamFormat('raw');
            setEstimateContentLength(false);
            setDownloadMaxBitRate(320);
            setDownloadFormat('mp3');
            setShowSkipIntervalButtons(false);
            setShowSleepTimerButton(false);
            setSkipBackwardInterval(15);
            setSkipForwardInterval(30);
            setRemoteControlMode('skip-track');
            setArtistPlayMode('topSongs');
            updateRemoteCapabilities();
            setBitrateOpen(false);
            setDlBitrateOpen(false);
            setBackwardOpen(false);
            setForwardOpen(false);
          },
        },
      ],
    );
  }, [setMaxBitRate, setStreamFormat, setEstimateContentLength, setDownloadMaxBitRate, setDownloadFormat, setShowSkipIntervalButtons, setShowSleepTimerButton, setSkipBackwardInterval, setSkipForwardInterval, setRemoteControlMode, setArtistPlayMode]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sectionTitle: { color: colors.label },
      }),
    [colors],
  );

  return (
    <>
      <GradientBackground scrollable>
        <ScrollView
          style={settingsStyles.container}
          contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Streaming */}
          <View style={settingsStyles.section}>
            <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('streaming')}</Text>
            <View style={[settingsStyles.card, { backgroundColor: colors.card }]}>
              <Pressable
                onPress={() => setBitrateOpen((prev) => !prev)}
                style={({ pressed }) => [
                  styles.dropdownHeader,
                  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  pressed && settingsStyles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: colors.textPrimary }]}>{t('maxBitrate')}</Text>
                <View style={styles.dropdownRight}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    {t(BITRATE_OPTIONS.find((o) => o.value === maxBitRate)?.labelKey ?? 'bitrateNoLimit')}
                  </Text>
                  <Ionicons
                    name={bitrateOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </View>
              </Pressable>
              {bitrateOpen && (
                <View style={[styles.optionList, { borderTopColor: colors.border }]}>
                  {BITRATE_OPTIONS.map((opt) => {
                    const isActive = maxBitRate === opt.value;
                    return (
                      <Pressable
                        key={String(opt.value)}
                        onPress={() => {
                          setMaxBitRate(opt.value);
                          setBitrateOpen(false);
                        }}
                        style={({ pressed }) => [
                          styles.option,
                          { borderBottomColor: colors.border },
                          pressed && settingsStyles.pressed,
                        ]}
                      >
                        <Text style={[styles.label, { color: colors.textPrimary }]}>
                          {t(opt.labelKey)}
                        </Text>
                        {isActive && (
                          <Ionicons name="checkmark" size={20} color={colors.primary} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Pressable
                onPress={() => streamFormatSheetStore.getState().show('stream')}
                style={({ pressed }) => [
                  styles.dropdownHeader,
                  pressed && settingsStyles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: colors.textPrimary }]}>{t('format')}</Text>
                <View style={styles.dropdownRight}>
                  <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
                    {formatLabelFor(streamFormat, t)}
                  </Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </View>
              </Pressable>
            </View>
            <Text style={[styles.warningText, { color: colors.textSecondary }]}>
              {t('formatCompatibilityWarning')}
            </Text>
          </View>

          {/* Downloading */}
          <View style={settingsStyles.section}>
            <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('downloading')}</Text>
            <View style={[settingsStyles.card, { backgroundColor: colors.card }]}>
              <Pressable
                onPress={() => setDlBitrateOpen((prev) => !prev)}
                style={({ pressed }) => [
                  styles.dropdownHeader,
                  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  pressed && settingsStyles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: colors.textPrimary }]}>{t('maxBitrate')}</Text>
                <View style={styles.dropdownRight}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    {t(BITRATE_OPTIONS.find((o) => o.value === downloadMaxBitRate)?.labelKey ?? 'bitrateNoLimit')}
                  </Text>
                  <Ionicons
                    name={dlBitrateOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </View>
              </Pressable>
              {dlBitrateOpen && (
                <View style={[styles.optionList, { borderTopColor: colors.border }]}>
                  {BITRATE_OPTIONS.map((opt) => {
                    const isActive = downloadMaxBitRate === opt.value;
                    return (
                      <Pressable
                        key={String(opt.value)}
                        onPress={() => {
                          setDownloadMaxBitRate(opt.value);
                          setDlBitrateOpen(false);
                        }}
                        style={({ pressed }) => [
                          styles.option,
                          { borderBottomColor: colors.border },
                          pressed && settingsStyles.pressed,
                        ]}
                      >
                        <Text style={[styles.label, { color: colors.textPrimary }]}>
                          {t(opt.labelKey)}
                        </Text>
                        {isActive && (
                          <Ionicons name="checkmark" size={20} color={colors.primary} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Pressable
                onPress={() => streamFormatSheetStore.getState().show('download')}
                style={({ pressed }) => [
                  styles.dropdownHeader,
                  pressed && settingsStyles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: colors.textPrimary }]}>{t('format')}</Text>
                <View style={styles.dropdownRight}>
                  <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
                    {formatLabelFor(downloadFormat, t)}
                  </Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </View>
              </Pressable>
            </View>
            <Text style={[styles.warningText, { color: colors.textSecondary }]}>
              {t('formatCompatibilityWarning')}
            </Text>
          </View>

          {/* Player Controls */}
          <View style={settingsStyles.section}>
            <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('playerControls')}</Text>
            <View style={[settingsStyles.card, { backgroundColor: colors.card }]}>
              <View style={[styles.toggleRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <View style={styles.toggleTextWrap}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>
                    {t('showSkipIntervalButtons')}
                  </Text>
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    {t('showSkipIntervalButtonsHint')}
                  </Text>
                </View>
                <Switch
                  value={showSkipIntervalButtons}
                  onValueChange={setShowSkipIntervalButtons}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>
                    {t('showSleepTimerButton')}
                  </Text>
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    {t('showSleepTimerButtonHint')}
                  </Text>
                </View>
                <Switch
                  value={showSleepTimerButton}
                  onValueChange={setShowSleepTimerButton}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
            </View>
          </View>

          {/* Skip Intervals */}
          <View style={settingsStyles.section}>
            <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('skipIntervals')}</Text>
            <View style={[settingsStyles.card, { backgroundColor: colors.card }]}>
              {/* Skip backward dropdown */}
              <Pressable
                onPress={() => setBackwardOpen((prev) => !prev)}
                style={({ pressed }) => [
                  styles.dropdownHeader,
                  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  pressed && settingsStyles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: colors.textPrimary }]}>{t('skipBackward')}</Text>
                <View style={styles.dropdownRight}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    {t('secondsValue', { count: skipBackwardInterval })}
                  </Text>
                  <Ionicons
                    name={backwardOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </View>
              </Pressable>
              {backwardOpen && (
                <View style={[styles.optionList, { borderTopColor: colors.border }]}>
                  {INTERVAL_OPTIONS.map((opt) => {
                    const isActive = skipBackwardInterval === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => {
                          setSkipBackwardInterval(opt.value);
                          setBackwardOpen(false);
                          updateRemoteCapabilities();
                        }}
                        style={({ pressed }) => [
                          styles.option,
                          { borderBottomColor: colors.border },
                          pressed && settingsStyles.pressed,
                        ]}
                      >
                        <Text style={[styles.label, { color: colors.textPrimary }]}>
                          {t('secondsValue', { count: opt.value })}
                        </Text>
                        {isActive && (
                          <Ionicons name="checkmark" size={20} color={colors.primary} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Skip forward dropdown */}
              <Pressable
                onPress={() => setForwardOpen((prev) => !prev)}
                style={({ pressed }) => [
                  styles.dropdownHeader,
                  pressed && settingsStyles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: colors.textPrimary }]}>{t('skipForward')}</Text>
                <View style={styles.dropdownRight}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    {t('secondsValue', { count: skipForwardInterval })}
                  </Text>
                  <Ionicons
                    name={forwardOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </View>
              </Pressable>
              {forwardOpen && (
                <View style={[styles.optionList, { borderTopColor: colors.border }]}>
                  {INTERVAL_OPTIONS.map((opt) => {
                    const isActive = skipForwardInterval === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => {
                          setSkipForwardInterval(opt.value);
                          setForwardOpen(false);
                          updateRemoteCapabilities();
                        }}
                        style={({ pressed }) => [
                          styles.option,
                          { borderBottomColor: colors.border },
                          pressed && settingsStyles.pressed,
                        ]}
                      >
                        <Text style={[styles.label, { color: colors.textPrimary }]}>
                          {t('secondsValue', { count: opt.value })}
                        </Text>
                        {isActive && (
                          <Ionicons name="checkmark" size={20} color={colors.primary} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </View>

          {/* Remote Controls */}
          <View style={settingsStyles.section}>
            <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('remoteControls')}</Text>
            <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
              {t('remoteControlsHint')}
            </Text>
            <View style={[settingsStyles.card, { backgroundColor: colors.card }]}>
              {REMOTE_OPTIONS.map((opt, index) => {
                const isActive = remoteControlMode === opt.value;
                const isLast = index === REMOTE_OPTIONS.length - 1;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => handleRemoteChange(opt.value)}
                    style={({ pressed }) => [
                      styles.radioRow,
                      !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                      pressed && settingsStyles.pressed,
                    ]}
                  >
                    <View style={styles.radioTextWrap}>
                      <Text style={[styles.label, { color: colors.textPrimary }]}>
                        {t(opt.labelKey)}
                      </Text>
                      <Text style={[styles.radioSubtitle, { color: colors.textSecondary }]}>
                        {t(opt.subtitleKey)}
                      </Text>
                    </View>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Artist Play Mode */}
          <View style={settingsStyles.section}>
            <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('artistPlayMode')}</Text>
            <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
              {t('artistPlayModeDescription')}
            </Text>
            <View style={[settingsStyles.card, { backgroundColor: colors.card }]}>
              {ARTIST_PLAY_MODE_OPTIONS.map((opt, index) => {
                const isActive = artistPlayMode === opt.value;
                const isLast = index === ARTIST_PLAY_MODE_OPTIONS.length - 1;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setArtistPlayMode(opt.value)}
                    style={({ pressed }) => [
                      styles.radioRow,
                      !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                      pressed && settingsStyles.pressed,
                    ]}
                  >
                    <Text style={[styles.label, { color: colors.textPrimary }]}>
                      {t(opt.labelKey)}
                    </Text>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

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
      <ThemedAlert {...alertProps} />
      <StreamFormatSheet />
    </>
  );
}

const styles = StyleSheet.create({
  sectionHint: {
    fontSize: 12,
    marginBottom: 10,
    marginLeft: 4,
    lineHeight: 18,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 16,
  },
  dropdownRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleHint: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  radioTextWrap: {
    flex: 1,
  },
  radioSubtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
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
  warningText: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    marginHorizontal: 4,
  },
});
