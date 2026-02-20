import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { imageCacheStore } from '../store/imageCacheStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { storageLimitStore } from '../store/storageLimitStore';
import {
  getFreeDiskSpace,
  getEffectiveBudget,
} from '../services/storageService';
import { formatBytes } from '../utils/formatters';

const BAR_HEIGHT = 14;
const BAR_RADIUS = 7;
const ANIMATE_MS = 400;

const IMAGE_COLOR = '#5AC8FA';
const MUSIC_COLOR_FALLBACK = '#1D9BF0';

export const StorageUsageBar = memo(function StorageUsageBar() {
  const { colors } = useTheme();

  const imageBytes = imageCacheStore((s) => s.totalBytes);
  const musicBytes = musicCacheStore((s) => s.totalBytes);
  const limitMode = storageLimitStore((s) => s.limitMode);
  const maxCacheSizeGB = storageLimitStore((s) => s.maxCacheSizeGB);

  const budget = getEffectiveBudget();
  const freeDisk = getFreeDiskSpace();

  const totalCapacity = Number.isFinite(budget)
    ? budget
    : imageBytes + musicBytes + freeDisk;

  const imageFrac = totalCapacity > 0 ? imageBytes / totalCapacity : 0;
  const musicFrac = totalCapacity > 0 ? musicBytes / totalCapacity : 0;
  const freeFrac = Math.max(0, 1 - imageFrac - musicFrac);

  const imageWidth = useSharedValue(imageFrac);
  const musicWidth = useSharedValue(musicFrac);
  const freeWidth = useSharedValue(freeFrac);

  useEffect(() => {
    imageWidth.value = withTiming(imageFrac, { duration: ANIMATE_MS });
    musicWidth.value = withTiming(musicFrac, { duration: ANIMATE_MS });
    freeWidth.value = withTiming(freeFrac, { duration: ANIMATE_MS });
  }, [imageFrac, musicFrac, freeFrac, imageWidth, musicWidth, freeWidth]);

  const imageStyle = useAnimatedStyle(() => ({
    flex: imageWidth.value,
  }));
  const musicStyle = useAnimatedStyle(() => ({
    flex: musicWidth.value,
  }));
  const freeStyle = useAnimatedStyle(() => ({
    flex: freeWidth.value,
  }));

  const musicColor = colors.primary || MUSIC_COLOR_FALLBACK;

  const freeBytes = Number.isFinite(budget)
    ? Math.max(0, budget - imageBytes - musicBytes)
    : freeDisk;

  const budgetLabel = useMemo(() => {
    if (limitMode === 'fixed' && maxCacheSizeGB > 0) {
      return `${maxCacheSizeGB} GB limit`;
    }
    return 'No limit';
  }, [limitMode, maxCacheSizeGB]);

  return (
    <View style={styles.container}>
      <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
        {imageFrac > 0 && (
          <Animated.View style={[styles.segment, { backgroundColor: IMAGE_COLOR }, imageStyle]} />
        )}
        {musicFrac > 0 && (
          <Animated.View style={[styles.segment, { backgroundColor: musicColor }, musicStyle]} />
        )}
        <Animated.View style={[styles.segment, { backgroundColor: colors.inputBg }, freeStyle]} />
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: IMAGE_COLOR }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            Images {formatBytes(imageBytes)}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: musicColor }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            Music {formatBytes(musicBytes)}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: colors.inputBg }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            Free {formatBytes(freeBytes)}
          </Text>
        </View>
      </View>

      <Text style={[styles.budgetText, { color: colors.label }]}>{budgetLabel}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  barTrack: {
    height: BAR_HEIGHT,
    borderRadius: BAR_RADIUS,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    fontWeight: '500',
  },
  budgetText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 10,
  },
});
