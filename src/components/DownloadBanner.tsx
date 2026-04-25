/**
 * Persistent download progress banner rendered above the MiniPlayer.
 *
 * Visible when there are items queued or downloading. Shows the
 * currently active item's name and track-count progress with a
 * slim progress bar. Tapping navigates to the download queue screen.
 * Animates in/out with a height + opacity transition.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { musicCacheStore } from '../store/musicCacheStore';
import { computeQueueItemProgress } from '../store/persistence/cachedItemHelpers';

/**
 * Rendered height of the banner when fully expanded. Exported so other
 * chrome (PlaybackToast) can offset itself above the banner without
 * duplicating the literal.
 */
export const BANNER_HEIGHT = 44;
const EXPAND_MS = 300;
const COLLAPSE_MS = 280;
const COLLAPSE_DELAY_MS = 60;
const CONTENT_FADE_IN_MS = 200;
const CONTENT_FADE_OUT_MS = 150;

export function DownloadBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();

  const activeItem = musicCacheStore((s) =>
    s.downloadQueue.find((q) => q.status === 'downloading'),
  );
  const cachedItems = musicCacheStore((s) => s.cachedItems);
  // Count only rows the download-queue screen actually renders
  // (`download-queue.tsx` filters to downloading/queued/error). Any row in
  // another status — e.g. a stuck `complete` row left over from a v1
  // migration or a race — must not keep this banner visible, because the
  // user has no UI affordance to resolve it otherwise.
  const queueCount = musicCacheStore((s) =>
    s.downloadQueue.reduce(
      (n, q) =>
        q.status === 'downloading' || q.status === 'queued' || q.status === 'error'
          ? n + 1
          : n,
      0,
    ),
  );
  const visible = queueCount > 0;

  // Always start collapsed and let the visibility effect run the entrance
  // animation on the first false → true transition. This guarantees the
  // slide-in plays whether the queue is non-empty at app launch or fills
  // up after the banner remounts (e.g. when the bottom-chrome wrapper
  // unmounts because both the play queue and the download queue cleared,
  // then the user kicks off a fresh download).
  const prevVisible = useRef(false);
  const heightValue = useSharedValue(0);
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      heightValue.value = withTiming(BANNER_HEIGHT, {
        duration: EXPAND_MS,
        easing: Easing.inOut(Easing.cubic),
      });
      contentOpacity.value = withDelay(80, withTiming(1, { duration: CONTENT_FADE_IN_MS }));
    } else if (!visible && prevVisible.current) {
      contentOpacity.value = withTiming(0, { duration: CONTENT_FADE_OUT_MS });
      heightValue.value = withDelay(
        COLLAPSE_DELAY_MS,
        withTiming(0, { duration: COLLAPSE_MS, easing: Easing.inOut(Easing.cubic) }),
      );
    }
    prevVisible.current = visible;
  }, [visible, heightValue, contentOpacity]);

  const containerStyle = useAnimatedStyle(() => ({
    height: heightValue.value,
  }));

  const contentAnimStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const handlePress = useCallback(() => {
    router.push('/download-queue');
  }, [router]);

  const { displayCompleted, displayTotal } = useMemo(() => {
    if (!activeItem) return { displayCompleted: 0, displayTotal: 0 };
    const p = computeQueueItemProgress(activeItem, cachedItems);
    return { displayCompleted: p.completed, displayTotal: p.total };
  }, [activeItem, cachedItems]);

  const progress = displayTotal === 0 ? 0 : displayCompleted / displayTotal;

  const label = activeItem
    ? activeItem.name
    : t('itemQueued', { count: queueCount });

  const trackText = activeItem ? `${displayCompleted}/${displayTotal}` : '';

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.card }, containerStyle]}>
      <Animated.View style={[styles.inner, contentAnimStyle]}>
        <Pressable
          onPress={handlePress}
          style={({ pressed }) => [styles.content, pressed && styles.pressed]}
        >
          <Ionicons
            name="arrow-down-circle"
            size={20}
            color={colors.primary}
            style={styles.icon}
          />
          <Text style={[styles.label, { color: colors.textPrimary }]} numberOfLines={1}>
            {label}
          </Text>
          {trackText ? (
            <Text style={[styles.trackCount, { color: colors.textSecondary }]}>
              {trackText}
            </Text>
          ) : null}
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  pressed: {
    opacity: 0.6,
  },
  icon: {
    marginRight: 8,
  },
  label: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  trackCount: {
    fontSize: 12,
    marginRight: 6,
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  progressFill: {
    height: '100%',
  },
});
