import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { HeaderHeightContext } from '@react-navigation/elements';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { SegmentControl, type Segment } from '../components/SegmentControl';
import { settingsStyles } from '../styles/settingsStyles';
import { SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { useTheme } from '../hooks/useTheme';
import { ThemedAlert } from '../components/ThemedAlert';
import { useThemedAlert } from '../hooks/useThemedAlert';
import {
  clearImageCache,
  deleteCachedImage,
  listCachedImagesAsync,
  refreshCachedImage,
  type CachedImageEntry,
} from '../services/imageCacheService';
import { offlineModeStore } from '../store/offlineModeStore';

const THUMB_SIZE = 50;

type RowStatus = 'idle' | 'refreshing' | 'success' | 'error';

const CacheRow = memo(function CacheRow({
  entry,
  colors,
  status,
  onRefresh,
  onDelete,
}: {
  entry: CachedImageEntry;
  colors: ReturnType<typeof useTheme>['colors'];
  status: RowStatus;
  onRefresh: (coverArtId: string) => void;
  onDelete: (coverArtId: string) => void;
}) {
  const { t } = useTranslation();
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const handleDelete = useCallback(() => {
    onDelete(entry.coverArtId);
  }, [entry.coverArtId, onDelete]);

  const handleRefreshAction = useCallback(() => {
    onRefresh(entry.coverArtId);
  }, [entry.coverArtId, onRefresh]);

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'trash-outline' as const, color: colors.red, label: t('delete'), onPress: handleDelete }],
    [colors.red, handleDelete, t],
  );

  const leftActions: SwipeAction[] = useMemo(
    () => offlineMode ? [] : [{ icon: 'refresh-outline' as const, color: colors.primary, label: t('refresh'), onPress: handleRefreshAction }],
    [offlineMode, colors.primary, handleRefreshAction, t],
  );

  return (
    <SwipeableRow rightActions={rightActions} leftActions={leftActions} enableFullSwipeRight enableFullSwipeLeft={!offlineMode} rowGap={10} borderRadius={12}>
      <View style={styles.row}>
        <CachedImage
          coverArtId={entry.coverArtId}
          size={THUMB_SIZE}
          style={[styles.thumb, { backgroundColor: colors.border }]}
          resizeMode="cover"
        />
        <View style={styles.fileList}>
          <Text
            style={[styles.coverArtId, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {entry.coverArtId}
          </Text>
          {!entry.complete && (
            <Pressable
              onPress={handleRefreshAction}
              hitSlop={4}
              style={({ pressed }) => [
                styles.repairBadge,
                { backgroundColor: colors.red + '22', borderColor: colors.red },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="warning" size={12} color={colors.red} />
              <Text style={[styles.repairBadgeText, { color: colors.red }]}>
                {t('incompleteTapToRepair')}
              </Text>
            </Pressable>
          )}
          {entry.files.map((f) => (
            <Text
              key={f.fileName}
              style={[styles.fileName, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              <Text style={[styles.sizeLabel, { color: colors.textPrimary }]}>
                {f.size}px{' '}
              </Text>
              {f.fileName}
            </Text>
          ))}
          {status === 'refreshing' && (
            <Text style={[styles.statusText, { color: colors.primary }]}>
              {t('downloadingEllipsis')}
            </Text>
          )}
          {status === 'success' && (
            <Text style={[styles.statusText, { color: colors.green }]}>
              {t('refreshedSuccessfully')}
            </Text>
          )}
          {status === 'error' && (
            <Text style={[styles.statusText, { color: colors.red }]}>
              {t('refreshFailed')}
            </Text>
          )}
        </View>
        {status === 'refreshing' && (
          <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
        )}
      </View>
    </SwipeableRow>
  );
});

export function ImageCacheBrowserScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { alert, alertProps } = useThemedAlert();
  const transitionComplete = useTransitionComplete();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const refreshControlKey = useRefreshControlKey();
  // Route param `filter=incomplete` (passed from the settings-storage
  // warning row) preselects the incomplete segment on mount. Default to
  // `complete` — it's the expected state for the vast majority of covers
  // and makes "incomplete" a meaningful quick-toggle.
  const params = useLocalSearchParams<{ filter?: string }>();
  type BrowserSegment = 'complete' | 'incomplete';
  const initialStatusFilter: BrowserSegment =
    params.filter === 'incomplete' ? 'incomplete' : 'complete';
  const [statusFilter, setStatusFilter] = useState<BrowserSegment>(initialStatusFilter);
  // `allEntries` holds the complete list exactly once; status-filter switches
  // are a pure in-memory filter against it so the UI stays responsive even on
  // libraries with thousands of covers.
  const [allEntries, setAllEntries] = useState<CachedImageEntry[]>([]);
  const [filter, setFilter] = useState('');
  const listRef = useRef<FlashListRef<CachedImageEntry>>(null);

  const handleClearAll = useCallback(() => {
    alert(
      t('clearImageCache'),
      t('clearImageCacheConfirmMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clearAll'),
          style: 'destructive',
          onPress: async () => {
            await clearImageCache();
            setAllEntries([]);
          },
        },
      ],
    );
  }, [alert, t]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: allEntries.length > 0
        ? () => (
            <Pressable
              onPress={handleClearAll}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={[styles.clearButton, { color: colors.textPrimary }]}>{t('clear')}</Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, allEntries.length, handleClearAll, colors.textPrimary]);

  const handleFilterChange = useCallback((text: string) => {
    setFilter(text);
    if (text.length === 0) {
      setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 50);
    }
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusMap, setStatusMap] = useState<Map<string, RowStatus>>(new Map());

  // Derived list: status-filter switches are instant (no SQL, no re-render
  // of the whole service layer), text-filter runs against the narrowed set.
  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const statusFiltered = allEntries.filter((e) =>
      statusFilter === 'complete' ? e.complete : !e.complete,
    );
    if (query.length === 0) return statusFiltered;
    return statusFiltered.filter(
      (e) =>
        e.coverArtId.toLowerCase().includes(query) ||
        e.files.some((f) => f.fileName.toLowerCase().includes(query)),
    );
  }, [allEntries, filter, statusFilter]);

  useEffect(() => {
    if (!transitionComplete) return;
    let cancelled = false;
    // Fetch the full list once — 'all' returns every row, and the
    // complete/incomplete filter is applied in JS above. This keeps
    // segment-toggles responsive even at tens of thousands of rows.
    listCachedImagesAsync('all').then((result) => {
      if (!cancelled) {
        setAllEntries(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [transitionComplete]);

  const handlePullRefresh = useCallback(async () => {
    setRefreshing(true);
    const result = await listCachedImagesAsync('all');
    setAllEntries(result);
    setRefreshing(false);
  }, []);

  const setItemStatus = useCallback((id: string, s: RowStatus) => {
    setStatusMap((prev) => new Map(prev).set(id, s));
  }, []);

  const handleRefresh = useCallback(
    (coverArtId: string) => {
      setItemStatus(coverArtId, 'refreshing');
      refreshCachedImage(coverArtId)
        .then(() => listCachedImagesAsync('all'))
        .then((result) => {
          setAllEntries(result);
          setItemStatus(coverArtId, 'success');
          setTimeout(() => setItemStatus(coverArtId, 'idle'), 3000);
        })
        .catch((err: unknown) => {
          // Surface the underlying reason so support can trace why a
          // row stays stuck. The row circuit-breaker in imageCacheService
          // will purge 404s and 3× failures; anything surviving to here
          // is a genuine transient problem the user can retry.
          // eslint-disable-next-line no-console
          console.warn(
            `[image-cache-browser] refresh failed for ${coverArtId}:`,
            err,
          );
          setItemStatus(coverArtId, 'error');
          setTimeout(() => setItemStatus(coverArtId, 'idle'), 3000);
        });
    },
    [setItemStatus],
  );

  const handleDelete = useCallback(
    (coverArtId: string) => {
      alert(
        t('deleteCachedImage'),
        t('deleteCachedImageMessage'),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('delete'),
            style: 'destructive',
            onPress: async () => {
              await deleteCachedImage(coverArtId);
              setAllEntries((prev) =>
                prev.filter((e) => e.coverArtId !== coverArtId),
              );
            },
          },
        ],
      );
    },
    [alert, t],
  );

  const statusMapRef = useRef(statusMap);
  statusMapRef.current = statusMap;

  const renderItem = useCallback(
    ({ item }: { item: CachedImageEntry }) => (
      <CacheRow
        entry={item}
        colors={colors}
        status={statusMapRef.current.get(item.coverArtId) ?? 'idle'}
        onRefresh={handleRefresh}
        onDelete={handleDelete}
      />
    ),
    [colors, handleRefresh, handleDelete],
  );

  const keyExtractor = useCallback(
    (item: CachedImageEntry) => item.coverArtId,
    [],
  );

  const isFiltered = filter.trim().length > 0;
  const emptyMessage = isFiltered ? t('noMatchingImages') : t('noCachedImages');
  const emptySubtitle = isFiltered ? undefined : t('imagesCachedAutomatically');

  const listEmpty = useMemo(
    () =>
      loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <EmptyState icon="images-outline" title={emptyMessage} subtitle={emptySubtitle} />
      ),
    [loading, emptyMessage, emptySubtitle, colors.primary],
  );

  const filterSegments: ReadonlyArray<Segment<BrowserSegment>> = useMemo(
    () => [
      { key: 'complete', label: t('filterComplete') },
      { key: 'incomplete', label: t('filterIncomplete') },
    ],
    [t],
  );

  const [chromeHeight, setChromeHeight] = useState(0);
  const contentInsetTop = headerHeight + chromeHeight;

  const listContentContainerStyle = useMemo(
    () => ({
      paddingTop: contentInsetTop,
      paddingHorizontal: 16,
      paddingBottom: 32,
      ...((loading || filteredEntries.length === 0) ? { flex: 1 } : undefined),
    }),
    [contentInsetTop, loading, filteredEntries.length],
  );

  return (
    <>
    <GradientBackground style={settingsStyles.container} scrollable>
      <View style={styles.listWrap}>
        <FlashList
          ref={listRef}
          data={loading ? [] : filteredEntries}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={statusMap}
          refreshControl={
            loading ? undefined : (
              <RefreshControl
                key={refreshControlKey}
                refreshing={refreshing}
                onRefresh={handlePullRefresh}
                tintColor={colors.primary}
                progressViewOffset={contentInsetTop}
              />
            )
          }
          contentContainerStyle={listContentContainerStyle}
          ListEmptyComponent={listEmpty}
        />
      </View>
      <View
        style={[styles.chromeOverlay, { top: headerHeight }]}
        onLayout={(e) => setChromeHeight(e.nativeEvent.layout.height)}
      >
        <View style={[settingsStyles.filterPill, { backgroundColor: colors.inputBg }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} style={settingsStyles.filterIcon} />
          <TextInput
            style={[settingsStyles.filterInput, { color: colors.textPrimary }]}
            placeholder={t('filterPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={filter}
            onChangeText={handleFilterChange}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            editable={!loading}
          />
        </View>
        <SegmentControl
          segments={filterSegments}
          selected={statusFilter}
          onSelect={setStatusFilter}
        />
      </View>
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
    <ThemedAlert {...alertProps} />
    </>
  );
}

const styles = StyleSheet.create({
  listWrap: {
    flex: 1,
  },
  chromeOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    zIndex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
  },
  fileList: {
    flex: 1,
    marginLeft: 12,
    gap: 4,
  },
  coverArtId: {
    fontSize: 12,
    fontFamily: 'Courier',
    fontWeight: '600',
    marginBottom: 2,
  },
  fileName: {
    fontSize: 12,
    fontFamily: 'Courier',
  },
  sizeLabel: {
    fontWeight: '600',
    fontSize: 12,
  },
  spinner: {
    marginLeft: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  clearButton: {
    fontSize: 16,
    fontWeight: '400',
  },
  repairBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  repairBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
