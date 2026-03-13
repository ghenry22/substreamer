import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import {
  SwipeableRow,
  closeOpenRow,
  type SwipeAction,
} from '../components/SwipeableRow';
import { useTheme } from '../hooks/useTheme';
import { ThemedAlert } from '../components/ThemedAlert';
import { useThemedAlert } from '../hooks/useThemedAlert';
import {
  deleteCachedItem,
  redownloadItem,
  redownloadTrack,
} from '../services/musicCacheService';
import { offlineModeStore } from '../store/offlineModeStore';
import {
  musicCacheStore,
  type CachedMusicItem,
  type CachedTrack,
} from '../store/musicCacheStore';
import { formatBytes } from '../utils/formatters';

/* ------------------------------------------------------------------ */
/*  Track Row (inside expanded item)                                   */
/* ------------------------------------------------------------------ */

const TrackFileRow = memo(function TrackFileRow({
  track,
  itemId,
  colors,
}: {
  track: CachedTrack;
  itemId: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const [busy, setBusy] = useState(false);
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const handleRedownload = useCallback(async () => {
    setBusy(true);
    try {
      await redownloadTrack(itemId, track.id);
    } finally {
      setBusy(false);
    }
  }, [itemId, track.id]);

  return (
    <View style={[styles.trackRow, { borderBottomColor: colors.border }]}>
      <View style={styles.trackInfo}>
        <Text style={[styles.trackTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={[styles.trackMeta, { color: colors.textSecondary }]}>
          {track.artist} · {formatBytes(track.bytes)}
        </Text>
      </View>
      {!offlineMode && (
        busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Pressable
            onPress={handleRedownload}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Ionicons name="refresh" size={18} color={colors.primary} />
          </Pressable>
        )
      )}
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Item Row                                                           */
/* ------------------------------------------------------------------ */

const CacheRow = memo(function CacheRow({
  item,
  colors,
  expanded,
  onToggle,
  onDelete,
  onRedownload,
}: {
  item: CachedMusicItem;
  colors: ReturnType<typeof useTheme>['colors'];
  expanded: boolean;
  onToggle: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onRedownload: (itemId: string) => void;
}) {
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const trackLabel = item.tracks.length === 1
    ? '1 track'
    : `${item.tracks.length} tracks`;

  const handleDelete = useCallback(() => {
    onDelete(item.itemId);
  }, [item.itemId, onDelete]);

  const handleToggle = useCallback(() => {
    onToggle(item.itemId);
  }, [item.itemId, onToggle]);

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'trash-outline', color: colors.red, label: 'Delete', onPress: handleDelete, removesRow: true }],
    [colors.red, handleDelete],
  );

  return (
    <SwipeableRow rightActions={rightActions} enableFullSwipeRight onPress={handleToggle}>
      <View style={[styles.rowContainer, { borderBottomColor: colors.border }]}>
        <View style={styles.row}>
          <CachedImage
            coverArtId={item.coverArtId}
            size={300}
            style={[styles.thumb, { backgroundColor: colors.border }]}
            resizeMode="cover"
          />
          <View style={styles.rowContent}>
            <Text style={[styles.rowTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
            {item.artist && (
              <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.artist}
              </Text>
            )}
            <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
              {item.type === 'album' ? 'Album' : 'Playlist'} · {trackLabel} · {formatBytes(item.totalBytes)}
            </Text>
          </View>
          {!offlineMode && (
            <Pressable
              onPress={() => onRedownload(item.itemId)}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Ionicons name="refresh" size={20} color={colors.primary} />
            </Pressable>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textSecondary}
            style={styles.chevron}
          />
        </View>

        {expanded && (
          <View style={[styles.trackList, { backgroundColor: colors.background }]}>
            {item.tracks.map((track) => (
              <TrackFileRow
                key={track.id}
                track={track}
                itemId={item.itemId}
                colors={colors}
              />
            ))}
          </View>
        )}
      </View>
    </SwipeableRow>
  );
});

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function MusicCacheBrowserScreen() {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const cachedItems = musicCacheStore((s) => s.cachedItems);
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const entries = useMemo(() => {
    const all = Object.values(cachedItems);
    all.sort((a, b) => b.downloadedAt - a.downloadedAt);
    const query = filter.trim().toLowerCase();
    if (query.length === 0) return all;
    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(query) ||
        (e.artist?.toLowerCase().includes(query) ?? false),
    );
  }, [cachedItems, filter]);

  const handleToggle = useCallback((itemId: string) => {
    setExpandedId((prev) => (prev === itemId ? null : itemId));
  }, []);

  const handleDelete = useCallback((itemId: string) => {
    const item = musicCacheStore.getState().cachedItems[itemId];
    if (!item) return;
    alert(
      'Remove Download',
      `Delete "${item.name}" and free ${formatBytes(item.totalBytes)}?\n\nThis may affect offline access to your music.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setExpandedId((prev) => (prev === itemId ? null : prev));
            deleteCachedItem(itemId);
          },
        },
      ],
    );
  }, []);

  const handleRedownload = useCallback((itemId: string) => {
    const item = musicCacheStore.getState().cachedItems[itemId];
    if (!item) return;
    alert(
      'Redownload',
      `Redownload all tracks in "${item.name}" with current quality settings?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Redownload',
          onPress: () => {
            setExpandedId((prev) => (prev === itemId ? null : prev));
            redownloadItem(itemId);
          },
        },
      ],
    );
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: CachedMusicItem }) => (
      <CacheRow
        item={item}
        colors={colors}
        expanded={expandedId === item.itemId}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onRedownload={handleRedownload}
      />
    ),
    [colors, expandedId, handleToggle, handleDelete, handleRedownload],
  );

  const keyExtractor = useCallback(
    (item: CachedMusicItem) => item.itemId,
    [],
  );

  const isFiltered = filter.trim().length > 0;
  const emptyMessage = isFiltered ? 'No matching downloads' : 'No downloaded music';
  const emptySubtitle = isFiltered ? undefined : 'Download albums or playlists for offline listening';

  const listEmpty = useMemo(
    () => (
      <EmptyState icon="musical-notes-outline" title={emptyMessage} subtitle={emptySubtitle} />
    ),
    [emptyMessage, emptySubtitle],
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
          onChangeText={setFilter}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
    ),
    [colors, filter],
  );

  return (
    <>
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {listHeader}
      <FlashList
        data={entries}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={expandedId}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={entries.length === 0 ? styles.emptyListContent : undefined}
        onScrollBeginDrag={closeOpenRow}
      />
    </View>
    <ThemedAlert {...alertProps} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

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
  emptyListContent: {
    flex: 1,
  },
  rowContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  thumb: {
    width: 56,
    height: 56,
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
  rowMeta: {
    fontSize: 11,
    marginTop: 3,
  },
  chevron: {
    marginLeft: 8,
  },
  trackList: {
    paddingLeft: 84,
    paddingRight: 16,
    paddingBottom: 8,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  trackMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.6,
  },
});
