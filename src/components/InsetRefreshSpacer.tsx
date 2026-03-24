import { memo, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

const PULL_THRESHOLD = 60;

export const InsetRefreshSpacer = memo(function InsetRefreshSpacer({
  height,
  refreshing,
  scrollY,
  color,
}: {
  height: number;
  refreshing: boolean;
  scrollY: SharedValue<number>;
  color: string;
}) {
  const isRefreshing = useSharedValue(refreshing);
  useEffect(() => {
    isRefreshing.value = refreshing;
  }, [refreshing, isRefreshing]);

  const animatedStyle = useAnimatedStyle(() => {
    if (isRefreshing.value) {
      return { opacity: 1, transform: [{ scale: 1 }] };
    }
    const pull = Math.max(0, -scrollY.value);
    const progress = Math.min(pull / PULL_THRESHOLD, 1);
    return {
      opacity: interpolate(progress, [0, 0.3, 1], [0, 0.4, 1]),
      transform: [{ scale: interpolate(progress, [0, 1], [0.4, 1]) }],
    };
  });

  return (
    <View style={[styles.container, { height }]}>
      <Animated.View style={animatedStyle}>
        <ActivityIndicator color={color} />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 12,
  },
});
