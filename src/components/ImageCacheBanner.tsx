/**
 * Pill-style notification banner for the persistent image-cache refresh
 * cycle. Shows progress while a cycle is running (or paused).
 *
 * Visual language matches `LibrarySyncBanner` / `StorageFullBanner` —
 * dark capsule centred below the header, rendered via the priority
 * ladder in `BannerStack`.
 */

import Ionicons from '@react-native-vector-icons/ionicons/static';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useServerReachable } from '../hooks/useServerReachable';
import { recheckNow } from '../services/connectivityService';
import { dismissImageCacheErrorBanner } from '../services/imageCacheService';
import { PAUSED_AMBER } from './bannerColors';
import { imageDownloadQueueStore } from '../store/imageDownloadQueueStore';

const CAPSULE_HEIGHT = 44;
const CAPSULE_BORDER_RADIUS = CAPSULE_HEIGHT / 2;
const BANNER_HEIGHT = CAPSULE_HEIGHT + 8;

const SPRING_CONFIG = { damping: 14, stiffness: 200, mass: 0.8 };
const EXPAND_MS = 300;
const COLLAPSE_MS = 280;
const SHRINK_MS = 300;
const SHRINK_EASING = Easing.in(Easing.cubic);
const LAYOUT_EASING = Easing.inOut(Easing.cubic);

const ACCENT_BLUE = '#1D9BF0';
const ERROR_RED = '#FF453A';

export const ImageCacheBanner = memo(function ImageCacheBanner() {
  const { t } = useTranslation();
  const cycleId = imageDownloadQueueStore((s) => s.cycleId);
  const cycleTotal = imageDownloadQueueStore((s) => s.cycleTotal);
  const cycleProcessed = imageDownloadQueueStore((s) => s.cycleProcessed);
  const cycleFailed = imageDownloadQueueStore((s) => s.cycleFailed);
  const isPaused = imageDownloadQueueStore((s) => s.isPaused);
  const phase = imageDownloadQueueStore((s) => s.phase);

  // The queue silently declines to run without a reachable server, so without this the
  // pill reports a count that cannot move.
  const { canReach, offlineMode } = useServerReachable();
  const stalled = !isPaused && !canReach;
  // Offline mode is a choice, so retrying is not the answer there — the offline toggle is.
  const canRetry = stalled && !offlineMode;

  const isError = phase === 'error';
  // 'dismissed' keeps the cycle alive (so retry still works) but hides the banner.
  const visible = cycleId !== null && cycleTotal > 0 && phase !== 'dismissed';

  const prevVisible = useRef(visible);

  const heightValue = useSharedValue(visible ? BANNER_HEIGHT : 0);
  const capsuleScale = useSharedValue(visible ? 1 : 0);
  const capsuleOpacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      heightValue.value = withTiming(BANNER_HEIGHT, { duration: EXPAND_MS, easing: LAYOUT_EASING });
      capsuleOpacity.value = withDelay(80, withTiming(1, { duration: 150 }));
      capsuleScale.value = withDelay(80, withSpring(1, SPRING_CONFIG));
    } else if (!visible && prevVisible.current) {
      capsuleScale.value = withTiming(0, { duration: SHRINK_MS, easing: SHRINK_EASING });
      capsuleOpacity.value = withTiming(0, { duration: SHRINK_MS - 50 });
      heightValue.value = withDelay(
        SHRINK_MS - 80,
        withTiming(0, { duration: COLLAPSE_MS, easing: LAYOUT_EASING }),
      );
    }
    prevVisible.current = visible;
  }, [visible, heightValue, capsuleScale, capsuleOpacity]);

  const containerStyle = useAnimatedStyle(() => ({
    height: heightValue.value,
  }));

  const capsuleStyle = useAnimatedStyle(() => ({
    opacity: capsuleOpacity.value,
    transform: [
      { scaleX: capsuleScale.value },
      { scaleY: capsuleScale.value },
    ],
  }));

  if (!visible) return null;

  const progressLabel = isPaused
    ? t('imageCacheBannerPausedLabel', 'Paused')
    : stalled
      ? (offlineMode
        ? t('imageCacheBannerPausedOffline', 'Covers paused — offline')
        : t('imageCacheBannerPausedNoConnection', 'Covers paused — no connection'))
      : t('imageCacheBannerRunningLabel', 'Refreshing covers');
  // No count while stalled: "0 / 11" alongside "paused" reads as progress that is not
  // happening, and the number cannot move until the connection is back.
  const countText = stalled ? '' : ` ${cycleProcessed} / ${cycleTotal}`;
  const errorLabel = t('imageCacheBannerErrorLabel', {
    count: cycleFailed,
    defaultValue: "{{count}} covers couldn't be refreshed",
  });

  return (
    <Animated.View style={[styles.outer, containerStyle]}>
      <View style={styles.pillContainer}>
        {/* In the error phase the whole pill is a tap-to-dismiss control. */}
        <Pressable
          testID="image-cache-banner-action"
          onPress={() => {
            if (isError) { dismissImageCacheErrorBanner(); return; }
            // `_layout`'s connectivity subscriber drains the queue once the ping lands.
            if (canRetry) { void recheckNow(); }
          }}
          disabled={!isError && !canRetry}
        >
          <Animated.View style={[styles.capsule, capsuleStyle]}>
            <Ionicons
              name={
                isError
                  ? 'alert-circle'
                  : isPaused
                    ? 'pause'
                    : stalled
                      ? 'cloud-offline'
                      : 'sync'
              }
              size={16}
              color={isError ? ERROR_RED : stalled ? PAUSED_AMBER : ACCENT_BLUE}
            />
            <Text style={styles.label} numberOfLines={1}>
              {isError ? errorLabel : `${progressLabel}${countText}`}
            </Text>
            {isError ? (
              <Ionicons name="close" size={15} color="rgba(255, 255, 255, 0.55)" />
            ) : canRetry ? (
              <Ionicons name="refresh" size={15} color={PAUSED_AMBER} />
            ) : null}
          </Animated.View>
        </Pressable>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  outer: {
    overflow: 'hidden',
  },
  pillContainer: {
    height: BANNER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsule: {
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: CAPSULE_BORDER_RADIUS,
    height: CAPSULE_HEIGHT,
    paddingHorizontal: 20,
    gap: 12,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
  },
  label: {
    flexShrink: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
