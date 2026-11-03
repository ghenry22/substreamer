import Ionicons from "@react-native-vector-icons/ionicons/static";
import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTranslation } from 'react-i18next';

import { handleSslCertPrompt, recheckNow } from '../services/connectivityService';
import { switchToServer } from '../services/failoverService';
import { connectivityStore, type BannerState, type FailoverPrompt } from '../store/connectivityStore';
import { offlineModeStore } from '../store/offlineModeStore';

import type { IoniconsName } from '../utils/iconNames';
const CAPSULE_HEIGHT = 44;
const CAPSULE_BORDER_RADIUS = CAPSULE_HEIGHT / 2;
const BANNER_HEIGHT = CAPSULE_HEIGHT + 8;
const SLIDE_DISTANCE = 14;
const SWAP_MS = 180;

const SPRING_CONFIG = { damping: 14, stiffness: 200, mass: 0.8 };
const EXPAND_MS = 300;
const COLLAPSE_MS = 280;
const SHRINK_MS = 300;
const SHRINK_EASING = Easing.in(Easing.cubic);
const LAYOUT_EASING = Easing.inOut(Easing.cubic);

const SUCCESS = '#00BA7C';
const ERROR_RED = '#FF453A';

interface ContentConfig {
  iconColor: string;
  icon: IoniconsName;
  messageKey: string;
  tappable: boolean;
  /** Dead-end state whose only useful action is asking the server again now. */
  retry?: boolean;
}

function getConfig(
  bannerState: BannerState,
  hasConnection: boolean,
  failoverPrompt: FailoverPrompt | null,
): ContentConfig {
  if (bannerState === 'reconnected') {
    return { iconColor: SUCCESS, icon: 'checkmark-circle', messageKey: 'connected', tappable: false };
  }
  if (bannerState === 'ssl-error') {
    return { iconColor: ERROR_RED, icon: 'shield-outline', messageKey: 'certificateChanged', tappable: true };
  }
  if (!hasConnection) {
    // No network at all — a server switch is pointless, so don't offer one.
    return { iconColor: ERROR_RED, icon: 'cloud-offline', messageKey: 'noInternetConnection', tappable: true, retry: true };
  }
  // Active server unreachable (network is up). Drive the message off the
  // failover prompt set by failoverService.evaluateServerDownPrompt.
  if (failoverPrompt === 'secondary') {
    return { iconColor: ERROR_RED, icon: 'cloud-offline', messageKey: 'failoverOfferSecondary', tappable: true };
  }
  if (failoverPrompt === 'primary') {
    return { iconColor: ERROR_RED, icon: 'cloud-offline', messageKey: 'failoverOfferPrimary', tappable: true };
  }
  if (failoverPrompt === 'both-down') {
    return { iconColor: ERROR_RED, icon: 'cloud-offline', messageKey: 'serversBothUnavailable', tappable: true, retry: true };
  }
  return { iconColor: ERROR_RED, icon: 'cloud-offline', messageKey: 'serverUnreachable', tappable: true, retry: true };
}

export const ConnectivityBanner = memo(function ConnectivityBanner() {
  const { t } = useTranslation();
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const rawBannerState = connectivityStore((s) => s.bannerState);
  const hasConnection = connectivityStore((s) => s.hasConnection);
  const failoverPrompt = connectivityStore((s) => s.failoverPrompt);
  const bannerState: BannerState = offlineMode ? 'hidden' : rawBannerState;
  const prev = useRef<BannerState>(bannerState);

  const visible = bannerState !== 'hidden';

  const heightValue = useSharedValue(visible ? BANNER_HEIGHT : 0);
  const capsuleScale = useSharedValue(visible ? 1 : 0);
  const capsuleOpacity = useSharedValue(visible ? 1 : 0);
  const contentOpacity = useSharedValue(visible ? 1 : 0);
  const contentTranslateY = useSharedValue(0);

  const liveConfig = getConfig(bannerState, hasConnection, failoverPrompt);
  const frozenConfig = useRef(liveConfig);
  if (visible) frozenConfig.current = liveConfig;
  const config = visible ? liveConfig : frozenConfig.current;
  const tappable = config.tappable;

  const handlePress = useCallback(() => {
    if (bannerState === 'ssl-error') {
      handleSslCertPrompt();
      return;
    }
    // Failover offer: tap the unreachable banner to switch to the other server.
    if (
      bannerState === 'unreachable'
      && (failoverPrompt === 'primary' || failoverPrompt === 'secondary')
    ) {
      void switchToServer(failoverPrompt);
      connectivityStore.getState().clearFailoverPrompt();
      return;
    }
    // Dead-end states: the only useful action is to ask again now.
    if (config.retry === true) void recheckNow();
  }, [bannerState, failoverPrompt, config.retry]);

  useEffect(() => {
    const wasVisible = prev.current !== 'hidden';
    const prevState = prev.current;
    prev.current = bannerState;

    if (visible && !wasVisible) {
      // Expand space, then spring the pill in
      heightValue.value = withTiming(BANNER_HEIGHT, { duration: EXPAND_MS, easing: LAYOUT_EASING });
      contentTranslateY.value = 0;
      contentOpacity.value = withTiming(1, { duration: 200 });
      capsuleOpacity.value = withDelay(80, withTiming(1, { duration: 150 }));
      capsuleScale.value = withDelay(80, withSpring(1, SPRING_CONFIG));
    } else if (!visible && wasVisible) {
      // Shrink pill out, then collapse space
      contentOpacity.value = withTiming(0, { duration: 150 });
      capsuleScale.value = withTiming(0, { duration: SHRINK_MS, easing: SHRINK_EASING });
      capsuleOpacity.value = withTiming(0, { duration: SHRINK_MS - 50 });
      heightValue.value = withDelay(
        SHRINK_MS - 80,
        withTiming(0, { duration: COLLAPSE_MS, easing: LAYOUT_EASING }),
      );
    } else if (visible && wasVisible && bannerState !== prevState) {
      // Content swap within the pill
      contentOpacity.value = 0;
      contentTranslateY.value = SLIDE_DISTANCE;
      contentOpacity.value = withTiming(1, { duration: SWAP_MS });
      contentTranslateY.value = withTiming(0, { duration: SWAP_MS, easing: Easing.out(Easing.cubic) });
    }
  }, [bannerState, visible, heightValue, capsuleScale, capsuleOpacity, contentOpacity, contentTranslateY]);

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

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  return (
    <Animated.View style={[styles.outer, containerStyle]}>
      <View style={styles.pillContainer}>
        <Pressable onPress={handlePress} disabled={!tappable}>
          <Animated.View style={[styles.capsule, capsuleStyle]}>
            <Animated.View style={[styles.contentRow, contentStyle]}>
              <Ionicons name={config.icon} size={16} color={config.iconColor} />
              <Animated.Text style={styles.label} numberOfLines={1}>
                {t(config.messageKey)}
              </Animated.Text>
              {/* Make the action discoverable, and say which one it is: a refresh for
                  the dead-end states that only re-ask, a chevron for the ones that
                  navigate or switch server. */}
              {tappable ? (
                <Ionicons
                  name={config.retry === true ? 'refresh' : 'chevron-forward'}
                  size={15}
                  color="rgba(255, 255, 255, 0.55)"
                />
              ) : null}
            </Animated.View>
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
  contentRow: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    flexShrink: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
