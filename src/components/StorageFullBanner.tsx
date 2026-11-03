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

import { storageLimitStore } from '../store/storageLimitStore';

const CAPSULE_HEIGHT = 44;
const CAPSULE_BORDER_RADIUS = CAPSULE_HEIGHT / 2;
const BANNER_HEIGHT = CAPSULE_HEIGHT + 8;

const SPRING_CONFIG = { damping: 14, stiffness: 200, mass: 0.8 };
const EXPAND_MS = 300;
const COLLAPSE_MS = 280;
const SHRINK_MS = 300;
const SHRINK_EASING = Easing.in(Easing.cubic);
const LAYOUT_EASING = Easing.inOut(Easing.cubic);
const ERROR_RED = '#FF453A';

export const StorageFullBanner = memo(function StorageFullBanner() {
  const { t } = useTranslation();
  const router = useRouter();
  const isStorageFull = storageLimitStore((s) => s.isStorageFull);
  const prevVisible = useRef(isStorageFull);

  const heightValue = useSharedValue(isStorageFull ? BANNER_HEIGHT : 0);
  const capsuleScale = useSharedValue(isStorageFull ? 1 : 0);
  const capsuleOpacity = useSharedValue(isStorageFull ? 1 : 0);

  useEffect(() => {
    if (isStorageFull && !prevVisible.current) {
      // Expand space, then spring the pill in
      heightValue.value = withTiming(BANNER_HEIGHT, { duration: EXPAND_MS, easing: LAYOUT_EASING });
      capsuleOpacity.value = withDelay(80, withTiming(1, { duration: 150 }));
      capsuleScale.value = withDelay(80, withSpring(1, SPRING_CONFIG));
    } else if (!isStorageFull && prevVisible.current) {
      // Shrink pill out, then collapse space
      capsuleScale.value = withTiming(0, { duration: SHRINK_MS, easing: SHRINK_EASING });
      capsuleOpacity.value = withTiming(0, { duration: SHRINK_MS - 50 });
      heightValue.value = withDelay(
        SHRINK_MS - 80,
        withTiming(0, { duration: COLLAPSE_MS, easing: LAYOUT_EASING }),
      );
    }
    prevVisible.current = isStorageFull;
  }, [isStorageFull, heightValue, capsuleScale, capsuleOpacity]);

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

  const handlePress = useCallback(() => {
    router.push('/settings-storage');
  }, [router]);

  return (
    <Animated.View style={[styles.outer, containerStyle]}>
      <View style={styles.pillContainer}>
        <Pressable onPress={handlePress}>
          <Animated.View style={[styles.capsule, capsuleStyle]}>
            <Ionicons name="alert-circle" size={16} color={ERROR_RED} />
            <Text style={styles.label} numberOfLines={1}>
              {t('storageLimitReached')}
            </Text>
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
