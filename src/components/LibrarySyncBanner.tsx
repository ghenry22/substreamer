import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef } from 'react';
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

import {
  syncStatusStore,
  type DetailSyncPhase,
  type LibrarySyncPhase,
} from '../store/syncStatusStore';

import { useServerReachable } from '../hooks/useServerReachable';
import { recheckNow } from '../services/connectivityService';
import { PAUSED_AMBER } from './bannerColors';

import type { IoniconsName } from '../utils/iconNames';
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

/** Hide the banner entirely for tiny libraries where the walk finishes in seconds. */
const MIN_TOTAL_TO_SHOW = 50;

interface Variant {
  icon: IoniconsName;
  iconColor: string;
  label: string;
  tappable: boolean;
  /** What a tap does. Defaults to opening settings. */
  action?: 'settings' | 'retry';
}

function getVariant(
  phase: DetailSyncPhase,
  completed: number,
  total: number,
  finalizing: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Variant | null {
  if (phase === 'syncing') {
    // Fetch done but the in-memory index is still rebuilding → "Finalizing…".
    if (finalizing) {
      return { icon: 'sync', iconColor: ACCENT_BLUE, label: t('finalizingLibrary'), tappable: true };
    }
    // Progress = albums-whose-songs-we-have / total-albums. Banner shows % only.
    const pct = total > 0 ? Math.min(100, Math.floor((completed / total) * 100)) : 0;
    return {
      icon: 'sync',
      iconColor: ACCENT_BLUE,
      label: total > 0 ? `${t('syncingSongs')} ${pct}%` : t('syncingSongs'),
      tappable: true,
    };
  }
  if (phase === 'paused-offline') {
    return {
      icon: 'cloud-offline',
      iconColor: PAUSED_AMBER,
      label: t('syncPausedOffline'),
      tappable: true,
      action: 'retry',
    };
  }
  if (
    phase === 'paused-auth-error'
    || phase === 'paused-metered'
    || phase === 'paused-error'
    || phase === 'error'
  ) {
    return {
      icon: 'alert-circle',
      iconColor: ERROR_RED,
      label: t('syncErrorTap'),
      tappable: true,
    };
  }
  return null;
}

/**
 * Variant for the one-time blob→normalized migration. Banner shows the PERCENTAGE
 * only (the settings card carries the bar + counts). Top priority — it runs when the
 * sync is idle, so it won't overlap the sync variants in practice.
 */
function getMigrationVariant(
  phase: 'idle' | 'migrating',
  done: number,
  total: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Variant | null {
  if (phase !== 'migrating') return null;
  const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  return {
    icon: 'sync',
    iconColor: ACCENT_BLUE,
    label: `${t('upgradingLibrary')} ${pct}%`,
    tappable: false,
  };
}

/**
 * Variant for the album-LIST fetch, shown BEFORE the detail walk. The count is the
 * walk's cursor — albums PROCESSED — not a row count, so it keeps moving on a pass
 * that re-covers albums already stored. Suppressed below `MIN_TOTAL_TO_SHOW` so a
 * small library (one instant page) doesn't flash.
 *
 */
function getListVariant(
  phase: LibrarySyncPhase,
  count: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Variant | null {
  if (phase === 'fetching') {
    if (count < MIN_TOTAL_TO_SHOW) return null;
    return {
      icon: 'sync',
      iconColor: ACCENT_BLUE,
      label: `${t('syncingAlbums')} ${count}`,
      tappable: true,
    };
  }
  if (phase === 'paused-offline') {
    return {
      icon: 'cloud-offline',
      iconColor: PAUSED_AMBER,
      label: t('syncPausedOffline'),
      tappable: true,
      action: 'retry',
    };
  }
  if (phase === 'paused-error') {
    return {
      icon: 'alert-circle',
      iconColor: PAUSED_AMBER,
      label: t('syncPausedError'),
      tappable: true,
    };
  }
  return null;
}

export const LibrarySyncBanner = memo(function LibrarySyncBanner() {
  const { t } = useTranslation();
  const router = useRouter();
  const phase = syncStatusStore((s) => s.detailSyncPhase);
  const total = syncStatusStore((s) => s.detailSyncTotal);
  const completed = syncStatusStore((s) => s.detailSyncCompleted);
  const listPhase = syncStatusStore((s) => s.librarySyncPhase);
  const listCount = syncStatusStore((s) => s.librarySyncCursor);
  const migPhase = syncStatusStore((s) => s.normalizedMigrationPhase);
  const migDone = syncStatusStore((s) => s.normalizedMigrationDone);
  const migTotal = syncStatusStore((s) => s.normalizedMigrationTotal);
  const finalizing = syncStatusStore((s) => s.songSyncFinalizing);
  const bannerDismissedAt = syncStatusStore((s) => s.bannerDismissedAt);

  const suppressed = bannerDismissedAt != null;
  const tinyLibrary = total > 0 && total < MIN_TOTAL_TO_SHOW;
  // Priority: the one-time normalized migration (a distinct upgrade event) → the
  // album-LIST fetch (the detail walk is gated on it) → the detail walk itself.
  const migrationVariant = getMigrationVariant(migPhase, migDone, migTotal, t);
  const listVariant = getListVariant(listPhase, listCount, t);
  const variant =
    migrationVariant ?? listVariant ?? (tinyLibrary ? null : getVariant(phase, completed, total, finalizing, t));
  const visible = variant != null && !suppressed;

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

  // A retry is meaningless in offline mode — the offline toggle is the fix — so the
  // affordance is withheld there rather than offered and ignored.
  const { offlineMode } = useServerReachable();
  const isRetry = variant?.action === 'retry';
  const tappable = (variant?.tappable ?? false) && !(isRetry && offlineMode);

  const handlePress = useCallback(() => {
    if (!tappable) return;
    if (isRetry) {
      // Just re-ask. A ping that succeeds flips the connectivity store, and the
      // subscriber in `_layout` already resumes the sync, the image queue and the
      // metadata pass — calling them here would be a second, divergent resume path.
      void recheckNow();
      return;
    }
    router.push('/settings-library-data');
  }, [router, tappable, isRetry]);

  const handleDismiss = useCallback(() => {
    syncStatusStore.getState().setBannerDismissedAt(Date.now());
  }, []);

  if (!visible || !variant) return null;
  const renderVariant = variant;

  return (
    <Animated.View style={[styles.outer, containerStyle]}>
      <View style={styles.pillContainer}>
        <Pressable onPress={handlePress} disabled={!tappable}>
          <Animated.View style={[styles.capsule, capsuleStyle]}>
            <Ionicons name={renderVariant.icon} size={16} color={renderVariant.iconColor} />
            <Text style={styles.label} numberOfLines={1}>
              {renderVariant.label}
            </Text>
            <Pressable
              onPress={handleDismiss}
              hitSlop={8}
              style={styles.dismissHit}
              accessibilityLabel={t('dismiss')}
            >
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
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
    paddingLeft: 20,
    paddingRight: 12,
    gap: 12,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
  },
  label: {
    flexShrink: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  dismissHit: {
    padding: 4,
    borderRadius: 12,
  },
});
