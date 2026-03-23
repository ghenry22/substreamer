import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useNavigation } from 'expo-router';
import { HeaderHeightContext } from '@react-navigation/elements';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
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
  const thumbUri = entry.files[0]?.uri;
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const handleDelete = useCallback(() => {
    onDelete(entry.coverArtId);
  }, [entry.coverArtId, onDelete]);

  const handleRefreshAction = useCallback(() => {
    onRefresh(entry.coverArtId);
  }, [entry.coverArtId, onRefresh]);

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'trash-outline' as const, color: colors.red, label: 'Delete', onPress: handleDelete }],
    [colors.red, handleDelete],
  );

  const leftActions: SwipeAction[] = useMemo(
    () => offlineMode ? [] : [{ icon: 'refresh-outline' as const, color: colors.primary, label: 'Refresh', onPress: handleRefreshAction }],
    [offlineMode, colors.primary, handleRefreshAction],
  );

  return (
    <View style={styles.rowWrapper}>
      <SwipeableRow rightActions={rightActions} leftActions={leftActions} enableFullSwipeRight enableFullSwipeLeft={!offlineMode} borderRadius={12}>
        <View style={styles.row}>
          <Image
            source={{ uri: thumbUri }}
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
                Downloading…
              </Text>
            )}
            {status === 'success' && (
              <Text style={[styles.statusText, { color: '#00BA7C' }]}>
                Refreshed successfully
              </Text>
            )}
            {status === 'error' && (
              <Text style={[styles.statusText, { color: colors.red }]}>
                Refresh failed
              </Text>
            )}
          </View>
          {status === 'refreshing' && (
            <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
          )}
        </View>
      </SwipeableRow>
    </View>
  );
});

export function ImageCacheBrowserScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { alert, alertProps } = useThemedAlert();
  const transitionComplete = useTransitionComplete();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const [entries, setEntries] = useState<CachedImageEntry[]>([]);
  const [filter, setFilter] = useState('');
  const listRef = useRef<FlashListRef<CachedImageEntry>>(null);

  const handleClearAll = useCallback(() => {
    alert(
      'Clear Image Cache',
      'Delete all cached images? They will be re-downloaded as you browse.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await clearImageCache();
            setEntries([]);
          },
        },
      ],
    );
  }, [alert]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: entries.length > 0
        ? () => (
            <Pressable
              onPress={handleClearAll}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={[styles.clearButton, { color: colors.primary }]}>Clear</Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, entries.length, handleClearAll, colors.primary]);

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

  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (query.length === 0) return entries;
    return entries.filter(
      (e) =>
        e.coverArtId.toLowerCase().includes(query) ||
        e.files.some((f) => f.fileName.toLowerCase().includes(query)),
    );
  }, [entries, filter]);

  useEffect(() => {
    if (!transitionComplete) return;
    let cancelled = false;
    listCachedImagesAsync().then((result) => {
      if (!cancelled) {
        setEntries(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [transitionComplete]);

  const handlePullRefresh = useCallback(async () => {
    setRefreshing(true);
    const result = await listCachedImagesAsync();
    setEntries(result);
    setRefreshing(false);
  }, []);

  const setItemStatus = useCallback((id: string, s: RowStatus) => {
    setStatusMap((prev) => new Map(prev).set(id, s));
  }, []);

  const handleRefresh = useCallback(
    (coverArtId: string) => {
      setItemStatus(coverArtId, 'refreshing');
      refreshCachedImage(coverArtId)
        .then(() => listCachedImagesAsync())
        .then((result) => {
          setEntries(result);
          setItemStatus(coverArtId, 'success');
          // Clear the success badge after 3 seconds.
          setTimeout(() => setItemStatus(coverArtId, 'idle'), 3000);
        })
        .catch(() => {
          setItemStatus(coverArtId, 'error');
          setTimeout(() => setItemStatus(coverArtId, 'idle'), 3000);
        });
    },
    [setItemStatus],
  );

  const handleDelete = useCallback(
    (coverArtId: string) => {
      alert(
        'Delete Cached Image',
        'Remove all cached variants for this image?\n\nThis may affect offline access to your music.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              await deleteCachedImage(coverArtId);
              setEntries((prev) =>
                prev.filter((e) => e.coverArtId !== coverArtId),
              );
            },
          },
        ],
      );
    },
    [],
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
  const emptyMessage = isFiltered ? 'No matching images' : 'No cached images';
  const emptySubtitle = isFiltered ? undefined : 'Images are cached automatically as you browse';

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

  const listHeader = useMemo(
    () => (
      <View style={styles.filterContainer}>
        <View style={[styles.filterPill, { backgroundColor: colors.inputBg }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} style={styles.filterIcon} />
          <TextInput
            style={[styles.filterInput, { color: colors.textPrimary }]}
            placeholder="Filter..."
            placeholderTextColor={colors.textSecondary}
            value={filter}
            onChangeText={handleFilterChange}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            editable={!loading}
          />
        </View>
      </View>
    ),
    [colors, filter, handleFilterChange, loading],
  );

  return (
    <>
    <GradientBackground style={styles.container} scrollable>
      <FlashList
        ref={listRef}
        data={loading ? [] : filteredEntries}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={statusMap}
        refreshing={refreshing}
        onRefresh={loading ? undefined : handlePullRefresh}
        contentContainerStyle={{
          paddingTop: headerHeight,
          paddingBottom: 32,
          ...((loading || filteredEntries.length === 0) ? { flex: 1 } : undefined),
        }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
      />
    </GradientBackground>
    <ThemedAlert {...alertProps} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    height: 38,
    paddingHorizontal: 10,
  },
  filterIcon: {
    marginRight: 6,
  },
  filterInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
  },
  rowWrapper: {
    marginHorizontal: 16,
    marginBottom: 10,
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
    borderRadius: 6,
  },
  fileList: {
    flex: 1,
    marginLeft: 12,
    gap: 2,
  },
  coverArtId: {
    fontSize: 11,
    fontFamily: 'Courier',
    fontWeight: '600',
    marginBottom: 2,
  },
  fileName: {
    fontSize: 11,
    fontFamily: 'Courier',
  },
  sizeLabel: {
    fontWeight: '600',
    fontSize: 11,
  },
  spinner: {
    marginLeft: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  clearButton: {
    fontSize: 17,
    fontWeight: '400',
  },
});
