/**
 * Pill-style notification banner for the "refresh downloaded metadata" pass —
 * re-caching album/playlist detail + cover art for downloaded items so offline
 * views never lose their metadata. Driven by `downloadedMetadataRefreshStore`,
 * so it surfaces BOTH the proactive startup backfill and the
 * manual "Refresh downloads" settings button, anywhere in the app.
 *
 * Visual language matches `ImageCacheBanner` / `LibrarySyncBanner` — dark
 * capsule centred below the header, rendered via the priority ladder in
 * `BannerStack`. Simpler than the image-cache banner: no error/dismiss states. It does
 * carry the shared "paused until the server is reachable" state with a retry, so it never
 * reports a count that cannot move.
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
import { PAUSED_AMBER } from './bannerColors';
import { downloadedMetadataRefreshStore } from '../store/downloadedMetadataRefreshStore';

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

export const DownloadedMetadataBanner = memo(function DownloadedMetadataBanner() {
  const { t } = useTranslation();
  const active = downloadedMetadataRefreshStore((s) => s.active);
  const total = downloadedMetadataRefreshStore((s) => s.total);
  const done = downloadedMetadataRefreshStore((s) => s.done);

  const visible = active && total > 0;

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

  // Read with the other hooks, above the `visible` early return.
  const { canReach, offlineMode } = useServerReachable();
  const stalled = !canReach;
  const canRetry = stalled && !offlineMode;

  const containerStyle = useAnimatedStyle(() => ({
    height: heightValue.value,
  }));

  const capsuleStyle = useAnimatedStyle(() => ({
    opacity: capsuleOpacity.value,
    transform: [{ scaleX: capsuleScale.value }, { scaleY: capsuleScale.value }],
  }));

  if (!visible) return null;

  const label = stalled
    ? (offlineMode
      ? t('downloadedMetadataBannerPausedOffline', 'Downloads paused — offline')
      : t('downloadedMetadataBannerPausedNoConnection', 'Downloads paused — no connection'))
    : t('downloadedMetadataBannerLabel', 'Updating downloads');
  // See ImageCacheBanner: a count next to "paused" reads as progress that is not happening.
  const countText = stalled ? '' : ` ${done} / ${total}`;

  return (
    <Animated.View style={[styles.outer, containerStyle]}>
      <View style={styles.pillContainer}>
        <Pressable
          testID="downloaded-metadata-banner-action"
          onPress={() => {
            // `_layout`'s connectivity subscriber re-runs the pass once the ping lands.
            if (canRetry) void recheckNow();
          }}
          disabled={!canRetry}
        >
          <Animated.View style={[styles.capsule, capsuleStyle]}>
            <Ionicons
              name={stalled ? 'cloud-offline' : 'sync'}
              size={16}
              color={stalled ? PAUSED_AMBER : ACCENT_BLUE}
            />
            <Text style={styles.label} numberOfLines={1}>
              {`${label}${countText}`}
            </Text>
            {canRetry && <Ionicons name="refresh" size={15} color={PAUSED_AMBER} />}
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
