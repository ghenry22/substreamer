import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { handleSslCertPrompt } from '../services/connectivityService';
import { connectivityStore, type BannerState } from '../store/connectivityStore';

const BANNER_HEIGHT = 36;
const INNER_HEIGHT = 28;
const SLIDE_DISTANCE = 14;
const EXPAND_MS = 300;
const COLLAPSE_MS = 280;
const CONTENT_FADE_IN_MS = 200;
const CONTENT_FADE_OUT_MS = 150;
const SWAP_MS = 180;

const EASING = Easing.out(Easing.cubic);
const SUCCESS = '#00BA7C';

interface ContentConfig {
  iconColor: string;
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
}

function getConfig(
  bannerState: BannerState,
  isInternetReachable: boolean,
  red: string,
): ContentConfig {
  if (bannerState === 'reconnected') {
    return { iconColor: SUCCESS, icon: 'checkmark-circle', message: 'Connected' };
  }
  if (bannerState === 'ssl-error') {
    return { iconColor: red, icon: 'shield-outline', message: 'Certificate changed' };
  }
  if (!isInternetReachable) {
    return { iconColor: red, icon: 'cloud-offline', message: 'No internet connection' };
  }
  return { iconColor: red, icon: 'cloud-offline', message: 'Server unreachable' };
}

export const ConnectivityBanner = memo(function ConnectivityBanner() {
  const { colors } = useTheme();
  const bannerState = connectivityStore((s) => s.bannerState);
  const isInternetReachable = connectivityStore((s) => s.isInternetReachable);
  const prev = useRef<BannerState>(bannerState);

  const height = useSharedValue(bannerState !== 'hidden' ? BANNER_HEIGHT : 0);
  const contentOpacity = useSharedValue(bannerState !== 'hidden' ? 1 : 0);
  const contentTranslateY = useSharedValue(0);

  const visible = bannerState !== 'hidden';
  const tappable = bannerState === 'ssl-error';

  const liveConfig = getConfig(bannerState, isInternetReachable, colors.red);
  const frozenConfig = useRef(liveConfig);
  if (visible) frozenConfig.current = liveConfig;
  const config = visible ? liveConfig : frozenConfig.current;

  const handlePress = useCallback(() => {
    if (tappable) handleSslCertPrompt();
  }, [tappable]);

  useEffect(() => {
    const wasVisible = prev.current !== 'hidden';
    const prevState = prev.current;
    prev.current = bannerState;

    if (visible && !wasVisible) {
      contentTranslateY.value = 0;
      height.value = withTiming(BANNER_HEIGHT, { duration: EXPAND_MS, easing: EASING });
      contentOpacity.value = withDelay(80, withTiming(1, { duration: CONTENT_FADE_IN_MS }));
    } else if (!visible && wasVisible) {
      contentOpacity.value = withTiming(0, { duration: CONTENT_FADE_OUT_MS });
      height.value = withDelay(60, withTiming(0, { duration: COLLAPSE_MS, easing: EASING }));
    } else if (visible && wasVisible && bannerState !== prevState) {
      contentOpacity.value = 0;
      contentTranslateY.value = SLIDE_DISTANCE;
      contentOpacity.value = withTiming(1, { duration: SWAP_MS });
      contentTranslateY.value = withTiming(0, { duration: SWAP_MS, easing: EASING });
    }
  }, [bannerState, visible, height, contentOpacity, contentTranslateY]);

  const wrapperStyle = useAnimatedStyle(() => ({
    height: height.value,
    overflow: 'hidden' as const,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  return (
    <Animated.View style={[{ backgroundColor: colors.background }, wrapperStyle]}>
      <Pressable
        style={({ pressed }) => [styles.pill, { backgroundColor: colors.inputBg }, tappable && pressed && styles.pressed]}
        onPress={handlePress}
        disabled={!tappable}
      >
        <Animated.View style={[styles.content, contentStyle]}>
          <Ionicons name={config.icon} size={14} color={config.iconColor} style={styles.icon} />
          <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>
            {config.message}
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
