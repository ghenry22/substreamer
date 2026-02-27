import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EmptyState } from '../components/EmptyState';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { useTheme } from '../hooks/useTheme';
import {
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
  const busy = status === 'refreshing';
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Image
        source={{ uri: thumbUri }}
        style={[styles.thumb, { backgroundColor: colors.border }]}
        resizeMode="cover"
      />
      <View style={styles.fileList}>
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
      <View style={styles.actions}>
        {!offlineMode && (
          busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Pressable
              onPress={() => onRefresh(entry.coverArtId)}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Ionicons name="refresh-outline" size={20} color={colors.primary} />
            </Pressable>
          )
        )}
        <Pressable
          onPress={() => onDelete(entry.coverArtId)}
          disabled={busy}
          hitSlop={8}
          style={({ pressed }) => [
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          <Ionicons name="trash-outline" size={20} color={colors.red} />
        </Pressable>
      </View>
    </View>
  );
});

export function ImageCacheBrowserScreen() {
  const { colors } = useTheme();
  const transitionComplete = useTransitionComplete();
  const [entries, setEntries] = useState<CachedImageEntry[]>([]);
  const [filter, setFilter] = useState('');
  const listRef = useRef<FlashListRef<CachedImageEntry>>(null);

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
      Alert.alert(
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
      <View style={[styles.filterContainer, { borderBottomColor: colors.border }]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
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
    ),
    [colors, filter, handleFilterChange, loading],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {listHeader}
      <FlashList
        ref={listRef}
        data={loading ? [] : filteredEntries}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={statusMap}
        refreshing={refreshing}
        onRefresh={loading ? undefined : handlePullRefresh}
        contentContainerStyle={
          (loading || filteredEntries.length === 0) ? styles.emptyContainer : undefined
        }
        ListEmptyComponent={listEmpty}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 6,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  fileName: {
    fontSize: 11,
    fontFamily: 'Courier',
  },
  sizeLabel: {
    fontWeight: '600',
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
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
  disabled: {
    opacity: 0.3,
  },
});
