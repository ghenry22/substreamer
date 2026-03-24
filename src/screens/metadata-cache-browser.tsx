import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { HeaderHeightContext } from '@react-navigation/elements';
import { memo, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { ThemedAlert } from '../components/ThemedAlert';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { albumDetailStore } from '../store/albumDetailStore';
import { artistDetailStore } from '../store/artistDetailStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistDetailStore } from '../store/playlistDetailStore';

const THUMB_SIZE = 50;

interface MetadataEntry {
  id: string;
  name: string;
  type: 'album' | 'artist' | 'playlist';
  coverArt?: string;
  retrievedAt: number;
}

type RowStatus = 'idle' | 'refreshing' | 'success' | 'error';

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildEntries(): MetadataEntry[] {
  const entries: MetadataEntry[] = [];

  const albums = albumDetailStore.getState().albums;
  for (const [id, entry] of Object.entries(albums)) {
    entries.push({
      id,
      name: entry.album.name,
      type: 'album',
      coverArt: entry.album.coverArt,
      retrievedAt: entry.retrievedAt,
    });
  }

  const artists = artistDetailStore.getState().artists;
  for (const [id, entry] of Object.entries(artists)) {
    entries.push({
      id,
      name: entry.artist.name,
      type: 'artist',
      coverArt: entry.artist.coverArt,
      retrievedAt: entry.retrievedAt,
    });
  }

  const playlists = playlistDetailStore.getState().playlists;
  for (const [id, entry] of Object.entries(playlists)) {
    entries.push({
      id,
      name: entry.playlist.name,
      type: 'playlist',
      coverArt: entry.playlist.coverArt,
      retrievedAt: entry.retrievedAt,
    });
  }

  // Sort by most recently retrieved first
  entries.sort((a, b) => b.retrievedAt - a.retrievedAt);
  return entries;
}

const TYPE_LABELS: Record<MetadataEntry['type'], string> = {
  album: 'Album',
  artist: 'Artist',
  playlist: 'Playlist',
};

/* ------------------------------------------------------------------ */
/*  Row component                                                      */
/* ------------------------------------------------------------------ */

const MetadataRow = memo(function MetadataRow({
  entry,
  colors,
  status,
  onRefresh,
  onDelete,
}: {
  entry: MetadataEntry;
  colors: ReturnType<typeof useTheme>['colors'];
  status: RowStatus;
  onRefresh: (entry: MetadataEntry) => void;
  onDelete: (entry: MetadataEntry) => void;
}) {
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const handleDelete = useCallback(() => {
    onDelete(entry);
  }, [entry, onDelete]);

  const handleRefreshAction = useCallback(() => {
    onRefresh(entry);
  }, [entry, onRefresh]);

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
          <CachedImage
            coverArtId={entry.coverArt}
            size={150}
            style={[
              styles.thumb,
              { backgroundColor: colors.border },
              entry.type === 'artist' && styles.thumbRound,
            ]}
            resizeMode="cover"
          />
          <View style={styles.info}>
            <Text
              style={[styles.name, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {entry.name}
            </Text>
            <Text style={[styles.typeLabel, { color: colors.textSecondary }]}>
              {TYPE_LABELS[entry.type]}
            </Text>
            <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>
              {formatDate(entry.retrievedAt)}
            </Text>
            {status === 'refreshing' && (
              <Text style={[styles.statusText, { color: colors.primary }]}>
                Refreshing…
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

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function MetadataCacheBrowserScreen() {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const [entries, setEntries] = useState<MetadataEntry[]>(() => buildEntries());
  const [filter, setFilter] = useState('');
  const listRef = useRef<FlashListRef<MetadataEntry>>(null);

  const handleFilterChange = useCallback((text: string) => {
    setFilter(text);
    if (text.length === 0) {
      setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 50);
    }
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMap, setStatusMap] = useState<Map<string, RowStatus>>(new Map());

  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (query.length === 0) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(query) ||
        e.type.toLowerCase().includes(query),
    );
  }, [entries, filter]);

  const setItemStatus = useCallback((id: string, s: RowStatus) => {
    setStatusMap((prev) => new Map(prev).set(id, s));
  }, []);

  const handlePullRefresh = useCallback(() => {
    setRefreshing(true);
    // Re-read from stores (synchronous)
    setEntries(buildEntries());
    setRefreshing(false);
  }, []);

  const handleRefresh = useCallback(
    (entry: MetadataEntry) => {
      setItemStatus(entry.id, 'refreshing');

      let fetchPromise: Promise<unknown>;
      if (entry.type === 'album') {
        fetchPromise = albumDetailStore.getState().fetchAlbum(entry.id);
      } else if (entry.type === 'artist') {
        fetchPromise = artistDetailStore.getState().fetchArtist(entry.id);
      } else {
        fetchPromise = playlistDetailStore.getState().fetchPlaylist(entry.id);
      }

      fetchPromise
        .then(() => {
          setEntries(buildEntries());
          setItemStatus(entry.id, 'success');
          setTimeout(() => setItemStatus(entry.id, 'idle'), 3000);
        })
        .catch(() => {
          setItemStatus(entry.id, 'error');
          setTimeout(() => setItemStatus(entry.id, 'idle'), 3000);
        });
    },
    [setItemStatus],
  );

  const handleDelete = useCallback(
    (entry: MetadataEntry) => {
      alert(
        'Delete Cached Metadata',
        `Remove cached data for "${entry.name}"?\n\nThis may affect offline access to your music.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              if (entry.type === 'album') {
                const { [entry.id]: _, ...rest } = albumDetailStore.getState().albums;
                albumDetailStore.setState({ albums: rest });
              } else if (entry.type === 'artist') {
                const { [entry.id]: _, ...rest } = artistDetailStore.getState().artists;
                artistDetailStore.setState({ artists: rest });
              } else {
                const { [entry.id]: _, ...rest } = playlistDetailStore.getState().playlists;
                playlistDetailStore.setState({ playlists: rest });
              }
              setEntries((prev) => prev.filter((e) => e.id !== entry.id));
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
    ({ item }: { item: MetadataEntry }) => (
      <MetadataRow
        entry={item}
        colors={colors}
        status={statusMapRef.current.get(item.id) ?? 'idle'}
        onRefresh={handleRefresh}
        onDelete={handleDelete}
      />
    ),
    [colors, handleRefresh, handleDelete],
  );

  const keyExtractor = useCallback(
    (item: MetadataEntry) => `${item.type}-${item.id}`,
    [],
  );

  const isFiltered = filter.trim().length > 0;
  const emptyMessage = isFiltered ? 'No matching items' : 'No cached metadata';
  const emptySubtitle = isFiltered ? undefined : 'Metadata is cached automatically as you browse';

  const listEmpty = useMemo(
    () => (
      <EmptyState icon="library-outline" title={emptyMessage} subtitle={emptySubtitle} />
    ),
    [emptyMessage, emptySubtitle],
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
          />
        </View>
      </View>
    ),
    [colors, filter, handleFilterChange],
  );

  return (
    <>
    <GradientBackground style={styles.container} scrollable>
      <FlashList
        ref={listRef}
        data={filteredEntries}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={statusMap}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handlePullRefresh}
            tintColor={colors.primary}
            progressViewOffset={headerHeight}
          />
        }
        contentContainerStyle={{
          paddingTop: headerHeight,
          paddingBottom: 32,
          ...(filteredEntries.length === 0 ? { flex: 1 } : undefined),
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
  thumbRound: {
    borderRadius: THUMB_SIZE / 2,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    gap: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  typeLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  dateLabel: {
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
});
