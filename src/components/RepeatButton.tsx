/**
 * RepeatButton – three-state toggle for repeat mode.
 *
 * Cycles through: off → repeat all → repeat one → off.
 * Uses textPrimary when off, and the primary accent colour when
 * active.  A small "1" badge distinguishes repeat-one from repeat-all.
 */

import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { cycleRepeatMode } from '../services/playerService';
import {
  playbackSettingsStore,
  type RepeatModeSetting,
} from '../store/playbackSettingsStore';

const ICON_SIZE = 28;

export const RepeatButton = memo(function RepeatButton() {
  const { colors } = useTheme();
  const repeatMode = playbackSettingsStore((s) => s.repeatMode);

  const handlePress = useCallback(() => {
    cycleRepeatMode();
  }, []);

  const iconColor = repeatMode === 'off' ? colors.textPrimary : colors.primary;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={getAccessibilityLabel(repeatMode)}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="repeat" size={ICON_SIZE} color={iconColor} />
        {repeatMode === 'one' && (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text
              style={[styles.badgeText, { color: colors.background }]}
              allowFontScaling={false}
            >
              1
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

function getAccessibilityLabel(mode: RepeatModeSetting): string {
  switch (mode) {
    case 'off':
      return 'Repeat off. Tap to repeat queue.';
    case 'all':
      return 'Repeat queue. Tap to repeat current track.';
    case 'one':
      return 'Repeat current track. Tap to turn off repeat.';
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -5,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 14,
  },
  pressed: {
    opacity: 0.6,
  },
});
