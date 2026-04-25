import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../hooks/useTheme';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { authStore } from '../store/authStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { playerStore } from '../store/playerStore';
import {
  playbackToastStore,
  type PlaybackToastStatus,
} from '../store/playbackToastStore';
import { BANNER_HEIGHT } from './DownloadBanner';

const CAPSULE_HEIGHT = 44;
const CAPSULE_BORDER_RADIUS = CAPSULE_HEIGHT / 2;

const SUCCESS_DISPLAY_MS = 1400;
const ERROR_DISPLAY_MS = 2200;
const BOTTOM_OFFSET = 24;
/** Keep in sync with MINI_PLAYER_HEIGHT in `MiniPlayer.tsx`. */
const MINI_PLAYER_HEIGHT = 56;

const SPRING_CONFIG = { damping: 14, stiffness: 200, mass: 0.8 };
const SHRINK_MS = 300;
const SHRINK_EASING = Easing.in(Easing.cubic);

export function PlaybackToast() {
  const { t } = useTranslation();
  const status = playbackToastStore((s) => s.status);
  const successLabel = playbackToastStore((s) => s.successLabel);
  const hide = playbackToastStore((s) => s.hide);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Lift the pill above the bottom chrome (DownloadBanner + MiniPlayer)
  // when either is rendered so they don't stack. The chrome lives in
  // `BottomChrome` (per-screen and inside the tabs `renderTabBar`); its
  // visibility rules must match this predicate so the offsets align.
  // Banner visibility is independent of MiniPlayer visibility — the banner
  // can be on screen with no track playing (downloads queued, queue
  // cleared while downloading, etc.), so it gets its own offset term.
  const isLoggedIn = authStore((s) => s.isLoggedIn);
  const hasCurrentTrack = playerStore((s) => s.currentTrack !== null);
  const isWide = useLayoutMode() === 'wide';
  const miniPlayerVisible = isLoggedIn && hasCurrentTrack && !isWide;
  const hasDownloads = musicCacheStore((s) =>
    s.downloadQueue.some(
      (q) => q.status === 'downloading' || q.status === 'queued' || q.status === 'error',
    ),
  );
  const bottomOffset =
    Math.max(insets.bottom, 16) +
    BOTTOM_OFFSET +
    (miniPlayerVisible ? MINI_PLAYER_HEIGHT : 0) +
    (hasDownloads ? BANNER_HEIGHT : 0);

  const capsuleScale = useSharedValue(0);
  const capsuleOpacity = useSharedValue(0);

  const loadingOpacity = useSharedValue(0);
  const resultOpacity = useSharedValue(0);
  const resultScale = useSharedValue(0.6);

  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStatus = useRef<PlaybackToastStatus>('idle');

  useEffect(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }

    if (status === 'loading') {
      resultOpacity.value = 0;
      resultScale.value = 0.6;

      capsuleOpacity.value = withTiming(1, { duration: 150 });
      capsuleScale.value = withSpring(1, SPRING_CONFIG);
      loadingOpacity.value = withTiming(1, { duration: 200 });
    } else if (status === 'success' || status === 'error') {
      // When the caller skipped the loading phase (e.g. flashSuccess), the
      // capsule is still hidden from its initial 0/0 state. Drive the
      // capsule's own entrance here so the pill animates in either way.
      const enteringFromIdle = prevStatus.current === 'idle';
      if (enteringFromIdle) {
        loadingOpacity.value = 0;
        capsuleOpacity.value = withTiming(1, { duration: 150 });
        capsuleScale.value = withSpring(1, SPRING_CONFIG);
      } else {
        loadingOpacity.value = withTiming(0, { duration: 150 });
      }

      resultOpacity.value = withTiming(1, { duration: 200 });
      resultScale.value = withSequence(
        withSpring(1.08, { damping: 10, stiffness: 300 }),
        withSpring(1, { damping: 14, stiffness: 200 }),
      );

      const displayMs = status === 'success' ? SUCCESS_DISPLAY_MS : ERROR_DISPLAY_MS;
      dismissTimer.current = setTimeout(() => {
        capsuleScale.value = withTiming(0, {
          duration: SHRINK_MS,
          easing: SHRINK_EASING,
        });
        capsuleOpacity.value = withTiming(0, { duration: SHRINK_MS - 50 }, (finished) => {
          if (finished) runOnJS(hide)();
        });
      }, displayMs);
    } else if (status === 'idle' && prevStatus.current !== 'idle') {
      capsuleScale.value = 0;
      capsuleOpacity.value = 0;
      loadingOpacity.value = 0;
      resultOpacity.value = 0;
      resultScale.value = 0.6;
    }

    prevStatus.current = status;

    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [
    status,
    hide,
    capsuleScale,
    capsuleOpacity,
    loadingOpacity,
    resultOpacity,
    resultScale,
  ]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: capsuleOpacity.value,
    transform: [
      { scaleX: capsuleScale.value },
      { scaleY: capsuleScale.value },
    ],
  }));

  const loadingStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
  }));

  const resultStyle = useAnimatedStyle(() => ({
    opacity: resultOpacity.value,
    transform: [{ scale: resultScale.value }],
  }));

  const label =
    status === 'success' && successLabel ? successLabel : getLabel(status, t);
  const icon = getIcon(status);

  return (
    <Animated.View
      style={[styles.wrapper, { bottom: bottomOffset }]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[styles.capsule, containerStyle]}
        pointerEvents="none"
      >
        <Animated.View style={[styles.iconSlot, loadingStyle]} pointerEvents="none">
          <ActivityIndicator size="small" color="#fff" />
        </Animated.View>

        <Animated.View style={[styles.iconSlot, styles.iconSlotAbsolute, resultStyle]} pointerEvents="none">
          {icon && (
            <Ionicons
              name={icon.name}
              size={20}
              color={icon.color(colors)}
            />
          )}
        </Animated.View>

        <Animated.Text style={styles.label} numberOfLines={1}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

function getLabel(status: PlaybackToastStatus, t: (key: string) => string): string {
  switch (status) {
    case 'loading':
      return t('startingPlayback');
    case 'success':
      return t('nowPlaying');
    case 'error':
      return t('playbackError');
    default:
      return '';
  }
}

function getIcon(status: PlaybackToastStatus) {
  switch (status) {
    case 'success':
      return {
        name: 'checkmark-circle' as const,
        color: (c: { primary: string }) => c.primary,
      };
    case 'error':
      return {
        name: 'close-circle' as const,
        color: (c: { red: string }) => c.red,
      };
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    top: undefined,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9998,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: CAPSULE_BORDER_RADIUS,
    height: CAPSULE_HEIGHT,
    paddingHorizontal: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  iconSlot: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconSlotAbsolute: {
    position: 'absolute',
    left: 20,
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
