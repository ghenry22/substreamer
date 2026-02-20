/**
 * Animated banner shown when the storage limit is reached.
 *
 * Styled and positioned identically to ConnectivityBanner -- a pill
 * that expands/collapses below the header.  Tapping it navigates to
 * the Storage & Data settings screen.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { storageLimitStore } from '../store/storageLimitStore';

const BANNER_HEIGHT = 36;
const INNER_HEIGHT = 28;
const EXPAND_MS = 300;
const COLLAPSE_MS = 280;
const CONTENT_FADE_IN_MS = 200;
const CONTENT_FADE_OUT_MS = 150;
const EASING = Easing.out(Easing.cubic);

export const StorageFullBanner = memo(function StorageFullBanner() {
  const { colors } = useTheme();
  const router = useRouter();
  const isStorageFull = storageLimitStore((s) => s.isStorageFull);

  const height = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const prevVisible = useRef(false);

  useEffect(() => {
    if (isStorageFull && !prevVisible.current) {
      height.value = withTiming(BANNER_HEIGHT, { duration: EXPAND_MS, easing: EASING });
      contentOpacity.value = withDelay(80, withTiming(1, { duration: CONTENT_FADE_IN_MS }));
    } else if (!isStorageFull && prevVisible.current) {
      contentOpacity.value = withTiming(0, { duration: CONTENT_FADE_OUT_MS });
      height.value = withDelay(60, withTiming(0, { duration: COLLAPSE_MS, easing: EASING }));
    }
    prevVisible.current = isStorageFull;
  }, [isStorageFull, height, contentOpacity]);

  const wrapperStyle = useAnimatedStyle(() => ({
    height: height.value,
    overflow: 'hidden' as const,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const handlePress = useCallback(() => {
    router.push('/settings-storage');
  }, [router]);

  return (
    <Animated.View style={[{ backgroundColor: colors.background }, wrapperStyle]}>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [styles.pill, { backgroundColor: colors.inputBg }, pressed && styles.pressed]}
      >
        <Animated.View style={[styles.content, contentStyle]}>
          <Ionicons name="alert-circle" size={14} color={colors.red} style={styles.icon} />
          <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>
            Storage limit reached
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  pill: {
    height: INNER_HEIGHT,
    marginHorizontal: 16,
    borderRadius: 8,
    overflow: 'hidden',
  },
  content: {
    height: INNER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: 6,
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.8,
  },
});
