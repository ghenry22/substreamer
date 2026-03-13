import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import {
  playbackSettingsStore,
  type MaxBitRate,
  type StreamFormat,
} from '../store/playbackSettingsStore';

const BITRATE_OPTIONS: { value: MaxBitRate; label: string }[] = [
  { value: 64, label: '64 kbps' },
  { value: 128, label: '128 kbps' },
  { value: 256, label: '256 kbps' },
  { value: 320, label: '320 kbps' },
  { value: null, label: 'No limit' },
];

const FORMAT_OPTIONS: { value: StreamFormat; label: string }[] = [
  { value: 'raw', label: 'Original' },
  { value: 'mp3', label: 'MP3' },
];

export function SettingsAudioQualityScreen() {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const [bitrateOpen, setBitrateOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [dlBitrateOpen, setDlBitrateOpen] = useState(false);
  const [dlFormatOpen, setDlFormatOpen] = useState(false);
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
      'Reset to Defaults',
      'This will reset all audio quality settings to their default values. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setMaxBitRate(null);
            setStreamFormat('raw');
            setEstimateContentLength(false);
            setDownloadMaxBitRate(320);
            setDownloadFormat('mp3');
            setBitrateOpen(false);
            setFormatOpen(false);
            setDlBitrateOpen(false);
            setDlFormatOpen(false);
          },
        },
      ],
    );
  }, [setMaxBitRate, setStreamFormat, setEstimateContentLength, setDownloadMaxBitRate, setDownloadFormat]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        container: { backgroundColor: colors.background },
        sectionTitle: { color: colors.label },
      }),
    [colors]
  );

  return (
    <>
    <ScrollView
      style={[styles.container, dynamicStyles.container]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Streaming</Text>
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
            <Text style={[styles.label, { color: colors.textPrimary }]}>Max bitrate</Text>
            <View style={styles.dropdownRight}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {BITRATE_OPTIONS.find((o) => o.value === maxBitRate)?.label ?? 'No limit'}
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
                      {opt.label}
                    </Text>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Format dropdown */}
          <Pressable
            onPress={() => setFormatOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.dropdownHeader,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, { color: colors.textPrimary }]}>Format</Text>
            <View style={styles.dropdownRight}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {FORMAT_OPTIONS.find((o) => o.value === streamFormat)?.label ?? 'Original'}
              </Text>
              <Ionicons
                name={formatOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textSecondary}
              />
            </View>
          </Pressable>
          {formatOpen && (
            <View style={[styles.optionList, { borderTopColor: colors.border }]}>
              {FORMAT_OPTIONS.map((opt) => {
                const isActive = streamFormat === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setStreamFormat(opt.value);
                      setFormatOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      { borderBottomColor: colors.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.label, { color: colors.textPrimary }]}>
                      {opt.label}
                    </Text>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Estimate content length toggle */}
          <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                Estimate content length
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                Enables the server to set the Content-Length header, which may improve compatibility with some players and casting devices.
              </Text>
            </View>
            <Switch
              value={estimateContentLength}
              onValueChange={setEstimateContentLength}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Downloading</Text>
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
            <Text style={[styles.label, { color: colors.textPrimary }]}>Max bitrate</Text>
            <View style={styles.dropdownRight}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {BITRATE_OPTIONS.find((o) => o.value === downloadMaxBitRate)?.label ?? 'No limit'}
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
                      {opt.label}
                    </Text>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Download format dropdown */}
          <Pressable
            onPress={() => setDlFormatOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.dropdownHeader,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, { color: colors.textPrimary }]}>Format</Text>
            <View style={styles.dropdownRight}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {FORMAT_OPTIONS.find((o) => o.value === downloadFormat)?.label ?? 'Original'}
              </Text>
              <Ionicons
                name={dlFormatOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textSecondary}
              />
            </View>
          </Pressable>
          {dlFormatOpen && (
            <View style={[styles.optionList, { borderTopColor: colors.border }]}>
              {FORMAT_OPTIONS.map((opt) => {
                const isActive = downloadFormat === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setDownloadFormat(opt.value);
                      setDlFormatOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      { borderBottomColor: colors.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.label, { color: colors.textPrimary }]}>
                      {opt.label}
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
            Reset to defaults
          </Text>
        </Pressable>
      )}
    </ScrollView>
    <ThemedAlert {...alertProps} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
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
});
