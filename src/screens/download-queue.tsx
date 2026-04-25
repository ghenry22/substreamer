import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useNavigation } from 'expo-router';
import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { ThemedAlert } from '../components/ThemedAlert';
import { closeOpenRow, SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { getDownloadSpeed, getActiveDownloadCount } from '../services/downloadSpeedTracker';
import { cancelDownload, clearDownloadQueue, forceRecoverDownloadsAsync, retryDownload } from '../services/musicCacheService';
import {
  musicCacheStore,
  type DownloadQueueItem,
} from '../store/musicCacheStore';
import { computeQueueItemProgress } from '../store/persistence/cachedItemHelpers';
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
  const { t } = useTranslation();
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
            {t('speed')}
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
            {t('threads')}
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
            {t('inQueue')}
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
  onRemove,
  onRetry,
}: {
  item: DownloadQueueItem;
  colors: ReturnType<typeof useTheme>['colors'];
  onRemove: (queueId: string) => void;
  onRetry: (queueId: string) => void;
}) {
  const { t } = useTranslation();
  const drag = useReorderableDrag();
  const isDownloading = item.status === 'downloading';
  const isQueued = item.status === 'queued';
  const isError = item.status === 'error';

  const cachedItems = musicCacheStore((s) => s.cachedItems);
  const { completed: displayCompleted, total: displayTotal } =
    computeQueueItemProgress(item, cachedItems);

  const progress = displayTotal > 0 ? displayCompleted / displayTotal : 0;

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
    () => [{ icon: 'trash-outline', color: colors.red, label: t('remove'), onPress: handleRemove, removesRow: true }],
    [colors.red, handleRemove, t],
  );

  return (
    <View style={styles.rowWrapper}>
      <SwipeableRow rightActions={rightActions} enableFullSwipeRight borderRadius={12}>
        <View style={styles.row}>
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
                  {t('downloadProgress', { completed: displayCompleted, total: displayTotal })}
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
                {t('trackWithCount', { count: item.totalSongs })} · {t('queued')}
              </Text>
            )}

            {isError && (
              <Text style={[styles.statusText, { color: colors.red }]}>
                {item.error ?? t('downloadFailed')}
              </Text>
            )}
          </View>

          {isQueued && (
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
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function DownloadQueueScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { alert, alertProps } = useThemedAlert();
  const navigation = useNavigation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
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
      t('clearDownloadQueue'),
      t('clearDownloadQueueMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clear'),
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
            <Text style={[styles.clearText, { color: colors.textPrimary }]}>{t('clear')}</Text>
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
      alert(t('cancelDownload'), t('cancelDownloadMessage', { name: item.name }), [
        { text: t('keep'), style: 'cancel' },
        {
          text: t('cancelDownload'),
          style: 'destructive',
          onPress: () => cancelDownload(queueId),
        },
      ]);
    } else {
      cancelDownload(queueId);
    }
  }, []);

  /* ---- Drag reorder ---- */

  const handleReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      // `from` and `to` are indices into the displayed sortedQueue, which is partitioned
      // [downloading..., queued..., error...]. The drag handle is only rendered for queued
      // rows, so `from` is always within the queued region. Clamp `to` to the queued region
      // so users can't drop into the downloading or error sections.
      const dragged = sortedQueue[from];
      if (!dragged || dragged.status !== 'queued') return;

      const downloadingCount = sortedQueue.filter((q) => q.status === 'downloading').length;
      const queuedCount = sortedQueue.filter((q) => q.status === 'queued').length;
      const queuedStart = downloadingCount;
      const queuedEnd = downloadingCount + queuedCount - 1;
      const clampedTo = Math.max(queuedStart, Math.min(to, queuedEnd));
      if (from === clampedTo) return;

      const target = sortedQueue[clampedTo];
      if (!target) return;

      // Translate display indices to store indices via queueId — the store array is not
      // guaranteed to be in the same partitioned order as the displayed list.
      const storeQueue = musicCacheStore.getState().downloadQueue;
      const fromInStore = storeQueue.findIndex((q) => q.queueId === dragged.queueId);
      const toInStore = storeQueue.findIndex((q) => q.queueId === target.queueId);
      if (fromInStore < 0 || toInStore < 0 || fromInStore === toInStore) return;

      musicCacheStore.getState().reorderQueue(fromInStore, toInStore);
    },
    [sortedQueue],
  );

  /* ---- Render ---- */

  const renderItem = useCallback(
    ({ item }: { item: DownloadQueueItem }) => (
      <QueueRow
        item={item}
        colors={colors}
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
      <EmptyState icon="cloud-download-outline" title={t('noDownloadsInQueue')} subtitle={t('noDownloadsInQueueSubtitle')} />
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
      paddingTop: headerHeight,
      paddingBottom: insets.bottom + 32,
    }),
    [headerHeight, insets.bottom],
  );

  return (
    <GradientBackground style={styles.container} scrollable>
      <ReorderableList
        data={sortedQueue}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onReorder={handleReorder}
        onScrollBeginDrag={closeOpenRow}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        style={styles.container}
        contentContainerStyle={contentStyle}
      />
      <ThemedAlert {...alertProps} />
    </GradientBackground>
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
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
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
    fontSize: 12,
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
  rowWrapper: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
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
    fontSize: 16,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  progressSection: {
    marginTop: 6,
  },
  progressText: {
    fontSize: 12,
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
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});
