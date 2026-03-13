import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DraggableFlatList, {
  ScaleDecorator,
  ShadowDecorator,
  type DragEndParams,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { CachedImage } from '../components/CachedImage';
import { ThemedAlert } from '../components/ThemedAlert';
import { EmptyState } from '../components/EmptyState';
import { closeOpenRow, SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { getDownloadSpeed, getActiveDownloadCount } from '../services/downloadSpeedTracker';
import { cancelDownload, clearDownloadQueue, forceRecoverDownloadsAsync, retryDownload } from '../services/musicCacheService';
import {
  musicCacheStore,
  type DownloadQueueItem,
} from '../store/musicCacheStore';
import { formatSpeed } from '../utils/formatters';

const ANIMATE_MS = 400;
const SPEED_POLL_MS = 1000;

/* ------------------------------------------------------------------ */
/*  Stats Card                                                         */
/* ------------------------------------------------------------------ */

const DownloadStatsCard = memo(function DownloadStatsCard({
  colors,
  queuedCount,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  queuedCount: number;
}) {
  const [speed, setSpeed] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const maxConcurrent = musicCacheStore((s) => s.maxConcurrentDownloads);

  useEffect(() => {
    const update = () => {
      setSpeed(getDownloadSpeed());
      setActiveCount(getActiveDownloadCount());
    };
    update();
    const id = setInterval(update, SPEED_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const iconBg = colors.primary + '18';

  return (
    <View style={[styles.statsCard, { backgroundColor: colors.card }]}>
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
            <Ionicons name="cloud-download-outline" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.statValue, { color: colors.textPrimary }]}>
            {formatSpeed(speed)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
            speed
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statBlock}>
          <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
            <Ionicons name="flash-outline" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.statValue, { color: colors.textPrimary }]}>
            {activeCount} / {maxConcurrent}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
            threads
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statBlock}>
          <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
            <Ionicons name="albums-outline" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.statValue, { color: colors.textPrimary }]}>
            {queuedCount}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
            in queue
          </Text>
        </View>
      </View>
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Queue Row                                                          */
/* ------------------------------------------------------------------ */

const QueueRow = memo(function QueueRow({
  item,
  colors,
  drag,
  onRemove,
  onRetry,
}: {
  item: DownloadQueueItem;
  colors: ReturnType<typeof useTheme>['colors'];
  drag?: () => void;
  onRemove: (queueId: string) => void;
  onRetry: (queueId: string) => void;
}) {
  const isDownloading = item.status === 'downloading';
  const isQueued = item.status === 'queued';
  const isError = item.status === 'error';

  const progress = item.totalTracks > 0
    ? item.completedTracks / item.totalTracks
    : 0;

  const fillFrac = useSharedValue(progress);
  const freeFrac = useSharedValue(1 - progress);

  useEffect(() => {
    fillFrac.value = withTiming(progress, { duration: ANIMATE_MS });
    freeFrac.value = withTiming(1 - progress, { duration: ANIMATE_MS });
  }, [progress, fillFrac, freeFrac]);

  const fillStyle = useAnimatedStyle(() => ({ flex: fillFrac.value }));
  const freeStyle = useAnimatedStyle(() => ({ flex: freeFrac.value }));

  const handleRemove = useCallback(() => {
    onRemove(item.queueId);
  }, [item.queueId, onRemove]);

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'trash-outline', color: colors.red, label: 'Remove', onPress: handleRemove, removesRow: true }],
    [colors.red, handleRemove],
  );

  return (
    <ScaleDecorator activeScale={1.03}>
      <ShadowDecorator>
        <SwipeableRow rightActions={rightActions} enableFullSwipeRight>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={styles.thumbWrap}>
              <CachedImage
                coverArtId={item.coverArtId}
                size={300}
                style={[styles.thumb, { backgroundColor: colors.border }]}
                resizeMode="cover"
              />
              {isDownloading && (
                <View style={styles.spinnerOverlay}>
                  <ActivityIndicator size="small" color={colors.primary} style={{ opacity: 1 }} />
                </View>
              )}
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {item.name}
              </Text>
              {item.artist && (
                <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.artist}
                </Text>
              )}

              {isDownloading && (
                <View style={styles.progressSection}>
                  <Text style={[styles.progressText, { color: colors.textSecondary }]}>
                    {item.completedTracks} of {item.totalTracks} tracks
                  </Text>
                  <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                    {progress > 0 && (
                      <Animated.View
                        style={[styles.progressSegment, { backgroundColor: colors.primary }, fillStyle]}
                      />
                    )}
                    <Animated.View
                      style={[styles.progressSegment, { backgroundColor: colors.inputBg }, freeStyle]}
                    />
                  </View>
                </View>
              )}

              {isQueued && (
                <Text style={[styles.statusText, { color: colors.textSecondary }]}>
                  {item.totalTracks} {item.totalTracks === 1 ? 'track' : 'tracks'} · Queued
                </Text>
              )}

              {isError && (
                <Text style={[styles.statusText, { color: colors.red }]}>
                  {item.error ?? 'Download failed'}
                </Text>
              )}
            </View>

            {isQueued && drag && (
              <Pressable onPressIn={drag} hitSlop={8} style={styles.dragHandle}>
                <Ionicons name="reorder-three" size={28} color={colors.textSecondary} />
              </Pressable>
            )}

            {isError && (
              <Pressable
                onPress={() => onRetry(item.queueId)}
                hitSlop={8}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                <Ionicons name="refresh" size={20} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </SwipeableRow>
      </ShadowDecorator>
    </ScaleDecorator>
  );
});

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function DownloadQueueScreen() {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const navigation = useNavigation();
  const downloadQueue = musicCacheStore((s) => s.downloadQueue);

  /* ---- Sorted display list: downloading → queued → error ---- */

  const sortedQueue = useMemo(() => {
    const downloading: DownloadQueueItem[] = [];
    const queued: DownloadQueueItem[] = [];
    const errored: DownloadQueueItem[] = [];
    for (const item of downloadQueue) {
      if (item.status === 'downloading') downloading.push(item);
      else if (item.status === 'queued') queued.push(item);
      else if (item.status === 'error') errored.push(item);
    }
    return [...downloading, ...queued, ...errored];
  }, [downloadQueue]);

  /* ---- Header buttons ---- */

  const handleClearAll = useCallback(() => {
    alert(
      'Clear Download Queue',
      'This will cancel all downloads and remove partially downloaded files. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearDownloadQueue(),
        },
      ],
    );
  }, []);

  const handleRecover = useCallback(() => {
    forceRecoverDownloadsAsync();
  }, []);

  useEffect(() => {
    if (downloadQueue.length === 0) {
      navigation.setOptions({ headerRight: undefined });
      return;
    }
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          <Pressable
            onPress={handleRecover}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Ionicons name="refresh" size={22} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            onPress={handleClearAll}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={[styles.clearText, { color: colors.textPrimary }]}>Clear</Text>
          </Pressable>
        </View>
      ),
    });
  }, [downloadQueue.length, navigation, handleClearAll, handleRecover, colors.textPrimary]);

  /* ---- Handlers ---- */

  const handleRetry = useCallback((queueId: string) => {
    retryDownload(queueId);
  }, []);

  const handleRemove = useCallback((queueId: string) => {
    const item = musicCacheStore.getState().downloadQueue.find(
      (q) => q.queueId === queueId,
    );
    if (!item) return;

    if (item.status === 'downloading') {
      alert('Cancel Download', `Cancel the download of "${item.name}"?`, [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Download',
          style: 'destructive',
          onPress: () => cancelDownload(queueId),
        },
      ]);
    } else {
      cancelDownload(queueId);
    }
  }, []);

  /* ---- Drag reorder ---- */

  const handleDragEnd = useCallback(({ data }: DragEndParams<DownloadQueueItem>) => {
    const newQueued = data.filter((q) => q.status === 'queued');
    const storeQueue = musicCacheStore.getState().downloadQueue;
    const storeQueued = storeQueue.filter((q) => q.status === 'queued');

    // Check if queued item order actually changed
    const changed = newQueued.some((q, i) => q.queueId !== storeQueued[i]?.queueId);
    if (!changed) return;

    // Apply the new queued order to the store by sequential reorders
    for (let i = 0; i < newQueued.length; i++) {
      const currentQueue = musicCacheStore.getState().downloadQueue;
      const fromIdx = currentQueue.findIndex((q) => q.queueId === newQueued[i].queueId);
      const targetIdx = currentQueue.findIndex((q) => q.queueId === storeQueued[0]?.queueId);

      // Find the correct target position: after downloading items, in order
      const downloadingCount = currentQueue.filter((q) => q.status === 'downloading').length;
      const desiredIdx = downloadingCount + i;

      if (fromIdx >= 0 && fromIdx !== desiredIdx) {
        musicCacheStore.getState().reorderQueue(fromIdx, desiredIdx);
      }
    }
  }, []);

  /* ---- Render ---- */

  const renderItem = useCallback(
    ({ item, drag }: RenderItemParams<DownloadQueueItem>) => (
      <QueueRow
        item={item}
        colors={colors}
        drag={item.status === 'queued' ? drag : undefined}
        onRemove={handleRemove}
        onRetry={handleRetry}
      />
    ),
    [colors, handleRemove, handleRetry],
  );

  const keyExtractor = useCallback(
    (item: DownloadQueueItem) => item.queueId,
    [],
  );

  const listEmpty = useMemo(
    () => (
      <EmptyState icon="cloud-download-outline" title="No downloads in queue" subtitle="Downloads you start will be tracked here" />
    ),
    [],
  );

  const queuedCount = useMemo(
    () => downloadQueue.filter((q) => q.status === 'downloading' || q.status === 'queued').length,
    [downloadQueue],
  );

  const listHeader = useMemo(
    () =>
      downloadQueue.length > 0 ? (
        <DownloadStatsCard colors={colors} queuedCount={queuedCount} />
      ) : null,
    [downloadQueue.length, colors, queuedCount],
  );

  const contentStyle = useMemo(
    () => ({
      flexGrow: 1 as const,
      backgroundColor: colors.background,
    }),
    [colors.background],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <DraggableFlatList
        data={sortedQueue}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onDragEnd={handleDragEnd}
        onScrollBeginDrag={closeOpenRow}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        containerStyle={styles.container}
        contentContainerStyle={contentStyle}
      />
      <ThemedAlert {...alertProps} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statsCard: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 2,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 48,
    opacity: 0.6,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumbWrap: {
    width: 56,
    height: 56,
    borderRadius: 6,
    overflow: 'hidden',
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 6,
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  rowContent: {
    flex: 1,
    marginLeft: 12,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  progressSection: {
    marginTop: 6,
  },
  progressText: {
    fontSize: 11,
    marginBottom: 4,
  },
  progressBar: {
    height: 10,
    borderRadius: 5,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressSegment: {
    height: '100%',
  },
  statusText: {
    fontSize: 12,
    marginTop: 4,
  },
  dragHandle: {
    width: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    marginLeft: 12,
    padding: 4,
  },
  clearText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});
