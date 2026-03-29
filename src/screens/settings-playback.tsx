import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { GradientBackground } from '../components/GradientBackground';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import { updateRemoteCapabilities } from '../services/playerService';
import {
  playbackSettingsStore,
  SKIP_INTERVALS,
  type RemoteControlMode,
  type SkipInterval,
} from '../store/playbackSettingsStore';

const INTERVAL_OPTIONS: { value: SkipInterval; label: string }[] =
  SKIP_INTERVALS.map((v) => ({ value: v, label: `${v} seconds` }));

const REMOTE_OPTIONS: { value: RemoteControlMode; label: string; subtitle: string }[] = [
  { value: 'skip-track', label: 'Next / Previous Track', subtitle: 'Skip to the next or previous track' },
  { value: 'skip-interval', label: 'Skip Forward / Backward', subtitle: 'Jump forward or backward by the intervals set above' },
];

export function SettingsPlaybackScreen() {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  const [backwardOpen, setBackwardOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);

  const showSkipIntervalButtons = playbackSettingsStore((s) => s.showSkipIntervalButtons);
  const skipBackwardInterval = playbackSettingsStore((s) => s.skipBackwardInterval);
  const skipForwardInterval = playbackSettingsStore((s) => s.skipForwardInterval);
  const remoteControlMode = playbackSettingsStore((s) => s.remoteControlMode);
  const setShowSkipIntervalButtons = playbackSettingsStore((s) => s.setShowSkipIntervalButtons);
  const setSkipBackwardInterval = playbackSettingsStore((s) => s.setSkipBackwardInterval);
  const setSkipForwardInterval = playbackSettingsStore((s) => s.setSkipForwardInterval);
  const setRemoteControlMode = playbackSettingsStore((s) => s.setRemoteControlMode);

  const isDefault =
    !showSkipIntervalButtons &&
    skipBackwardInterval === 15 &&
    skipForwardInterval === 30 &&
    remoteControlMode === 'skip-track';

  const handleRemoteChange = useCallback(
    (mode: RemoteControlMode) => {
      setRemoteControlMode(mode);
      updateRemoteCapabilities(); /* apply immediately */
    },
    [setRemoteControlMode],
  );

  const handleResetDefaults = useCallback(() => {
    alert(
      'Reset to Defaults',
      'This will reset all playback settings to their default values. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setShowSkipIntervalButtons(false);
            setSkipBackwardInterval(15);
            setSkipForwardInterval(30);
            setRemoteControlMode('skip-track');
            updateRemoteCapabilities();
            setBackwardOpen(false);
            setForwardOpen(false);
          },
        },
      ],
    );
  }, [setShowSkipIntervalButtons, setSkipBackwardInterval, setSkipForwardInterval, setRemoteControlMode]);

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
          style={styles.container}
          contentContainerStyle={[styles.content, { paddingTop: headerHeight + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Player Controls */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Player Controls</Text>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
                <View style={styles.toggleTextWrap}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>
                    Show skip interval buttons
                  </Text>
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    Adds forward and backward skip buttons to the player for seeking within a track.
                  </Text>
                </View>
                <Switch
                  value={showSkipIntervalButtons}
                  onValueChange={setShowSkipIntervalButtons}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
            </View>
          </View>

          {/* Skip Intervals */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Skip Intervals</Text>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              {/* Skip backward dropdown */}
              <Pressable
                onPress={() => setBackwardOpen((prev) => !prev)}
                style={({ pressed }) => [
                  styles.dropdownHeader,
                  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: colors.textPrimary }]}>Skip backward</Text>
                <View style={styles.dropdownRight}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    {skipBackwardInterval}s
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

              {/* Skip forward dropdown */}
              <Pressable
                onPress={() => setForwardOpen((prev) => !prev)}
                style={({ pressed }) => [
                  styles.dropdownHeader,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: colors.textPrimary }]}>Skip forward</Text>
                <View style={styles.dropdownRight}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    {skipForwardInterval}s
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

          {/* Remote Controls */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Remote Controls</Text>
            <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
              Choose which controls appear on the lock screen and Control Center.
            </Text>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
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
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.radioTextWrap}>
                      <Text style={[styles.label, { color: colors.textPrimary }]}>
                        {opt.label}
                      </Text>
                      <Text style={[styles.radioSubtitle, { color: colors.textSecondary }]}>
                        {opt.subtitle}
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
      </GradientBackground>
      <ThemedAlert {...alertProps} />
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
  sectionHint: {
    fontSize: 13,
    marginBottom: 10,
    marginLeft: 4,
    lineHeight: 18,
  },
  card: {
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
