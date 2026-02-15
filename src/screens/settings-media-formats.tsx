import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
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

export function SettingsMediaFormatsScreen() {
  const { colors } = useTheme();
  const [bitrateOpen, setBitrateOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const maxBitRate = playbackSettingsStore((s) => s.maxBitRate);
  const streamFormat = playbackSettingsStore((s) => s.streamFormat);
  const estimateContentLength = playbackSettingsStore((s) => s.estimateContentLength);
  const setMaxBitRate = playbackSettingsStore((s) => s.setMaxBitRate);
  const setStreamFormat = playbackSettingsStore((s) => s.setStreamFormat);
  const setEstimateContentLength = playbackSettingsStore((s) => s.setEstimateContentLength);

  const isDefault = maxBitRate === null && streamFormat === 'raw' && !estimateContentLength;

  const handleResetDefaults = useCallback(() => {
    Alert.alert(
      'Reset to Defaults',
      'This will reset all media format settings to their default values. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setMaxBitRate(null);
            setStreamFormat('raw');
            setEstimateContentLength(false);
            setBitrateOpen(false);
            setFormatOpen(false);
          },
        },
      ],
    );
  }, [setMaxBitRate, setStreamFormat, setEstimateContentLength]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        container: { backgroundColor: colors.background },
        sectionTitle: { color: colors.label },
      }),
    [colors]
  );

  return (
    <ScrollView
      style={[styles.container, dynamicStyles.container]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Playback</Text>
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

      {!isDefault && (
        <Pressable
          onPress={handleResetDefaults}
          style={({ pressed }) => [
            styles.resetButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="refresh-outline" size={16} color={colors.primary} />
          <Text style={[styles.resetButtonText, { color: colors.primary }]}>
            Reset to defaults
          </Text>
        </Pressable>
      )}
    </ScrollView>
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
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
