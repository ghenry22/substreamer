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
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { settingsStyles } from '../styles/settingsStyles';
import { SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { ThemedAlert } from '../components/ThemedAlert';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
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
  return d.toLocaleDateString(i18next.language, {
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

const TYPE_LABEL_KEYS: Record<MetadataEntry['type'], string> = {
  album: 'album',
  artist: 'artist',
  playlist: 'playlist',
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
  const { t } = useTranslation();
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const handleDelete = useCallback(() => {
    onDelete(entry);
  }, [entry, onDelete]);

  const handleRefreshAction = useCallback(() => {
    onRefresh(entry);
  }, [entry, onRefresh]);

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
            {t(TYPE_LABEL_KEYS[entry.type])}
          </Text>
          <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>
            {formatDate(entry.retrievedAt)}
          </Text>
          {status === 'refreshing' && (
            <Text style={[styles.statusText, { color: colors.primary }]}>
              {t('refreshingEllipsis')}
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

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function MetadataCacheBrowserScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { alert, alertProps } = useThemedAlert();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const refreshControlKey = useRefreshControlKey();
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
        t('deleteCachedMetadata'),
        t('deleteCachedMetadataMessage', { name: entry.name }),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('delete'),
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
  const emptyMessage = isFiltered ? t('noMatchingItems') : t('noCachedMetadata');
  const emptySubtitle = isFiltered ? undefined : t('metadataCachedAutomatically');

  const listEmpty = useMemo(
    () => (
      <EmptyState icon="library-outline" title={emptyMessage} subtitle={emptySubtitle} />
    ),
    [emptyMessage, emptySubtitle],
  );

  const listHeader = useMemo(
    () => (
      <View style={settingsStyles.filterContainer}>
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
          />
        </View>
      </View>
    ),
    [colors, filter, handleFilterChange],
  );

  const listContentContainerStyle = useMemo(
    () => ({
      paddingTop: headerHeight,
      paddingHorizontal: 16,
      paddingBottom: 32,
      ...(filteredEntries.length === 0 ? { flex: 1 } : undefined),
    }),
    [headerHeight, filteredEntries.length],
  );

  return (
    <>
    <GradientBackground style={settingsStyles.container} scrollable>
      <FlashList
        ref={listRef}
        data={filteredEntries}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={statusMap}
        refreshControl={
          <RefreshControl
            key={refreshControlKey}
            refreshing={refreshing}
            onRefresh={handlePullRefresh}
            tintColor={colors.primary}
            progressViewOffset={headerHeight}
          />
        }
        contentContainerStyle={listContentContainerStyle}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
      />
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
    <ThemedAlert {...alertProps} />
    </>
  );
}

const styles = StyleSheet.create({
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
  thumbRound: {
    borderRadius: THUMB_SIZE / 2,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    gap: 4,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
  },
  typeLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  dateLabel: {
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
});
