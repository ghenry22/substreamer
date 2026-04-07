import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { GradientBackground } from '../components/GradientBackground';
import { StreamFormatSheet } from '../components/StreamFormatSheet';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import {
  FORMAT_PRESETS,
  playbackSettingsStore,
  type MaxBitRate,
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

export function SettingsAudioQualityScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const [bitrateOpen, setBitrateOpen] = useState(false);
  const [dlBitrateOpen, setDlBitrateOpen] = useState(false);
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

  const isStreamingDefault = maxBitRate === null && streamFormat === 'raw' && !estimateContentLength;
  const isDownloadDefault = downloadMaxBitRate === 320 && downloadFormat === 'mp3';
  const isDefault = isStreamingDefault && isDownloadDefault;

  const handleResetDefaults = useCallback(() => {
    alert(
      t('resetToDefaults'),
      t('resetAudioQualityMessage'),
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
            setBitrateOpen(false);
            setDlBitrateOpen(false);
          },
        },
      ],
    );
  }, [setMaxBitRate, setStreamFormat, setEstimateContentLength, setDownloadMaxBitRate, setDownloadFormat]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sectionTitle: { color: colors.label },
      }),
    [colors]
  );

  return (
    <>
    <GradientBackground scrollable>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: headerHeight + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>{t('streaming')}</Text>
        <View style={[styles.dropdown, { backgroundColor: colors.card }]}>
          {/* Max bitrate dropdown */}
          <Pressable
            onPress={() => setBitrateOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.dropdownHeader,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && styles.pressed,
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
                      pressed && styles.pressed,
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

          {/* Format picker — opens BottomSheet */}
          <Pressable
            onPress={() => streamFormatSheetStore.getState().show('stream')}
            style={({ pressed }) => [
              styles.dropdownHeader,
              pressed && styles.pressed,
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

          {/* Estimate content length toggle — hidden from UI; default is
              platform-dependent (see playbackSettingsStore). */}
        </View>
        <Text style={[styles.warningText, { color: colors.textSecondary }]}>
          {t('formatCompatibilityWarning')}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>{t('downloading')}</Text>
        <View style={[styles.dropdown, { backgroundColor: colors.card }]}>
          {/* Download max bitrate dropdown */}
          <Pressable
            onPress={() => setDlBitrateOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.dropdownHeader,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && styles.pressed,
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
                      pressed && styles.pressed,
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

          {/* Download format picker — opens BottomSheet */}
          <Pressable
            onPress={() => streamFormatSheetStore.getState().show('download')}
            style={({ pressed }) => [
              styles.dropdownHeader,
              pressed && styles.pressed,
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

      {!isDefault && (
        <Pressable
          onPress={handleResetDefaults}
          style={({ pressed }) => [
            styles.resetButton,
            { borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="refresh-outline" size={16} color={colors.textPrimary} />
          <Text style={[styles.resetButtonText, { color: colors.textPrimary }]}>
            {t('resetToDefaults')}
          </Text>
        </Pressable>
      )}
    </ScrollView>
    </GradientBackground>
    <ThemedAlert {...alertProps} />
    <StreamFormatSheet />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  dropdown: {
    borderRadius: 12,
    overflow: 'hidden',
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
    gap: 6,
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
  pressed: {
    opacity: 0.8,
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
    fontSize: 15,
    fontWeight: '600',
  },
  warningText: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    marginHorizontal: 4,
  },
});
