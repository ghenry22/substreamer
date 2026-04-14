import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useNavigation } from 'expo-router';
import { HeaderHeightContext } from '@react-navigation/elements';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { settingsStyles } from '../styles/settingsStyles';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import {
  SwipeableRow,
  closeOpenRow,
  type SwipeAction,
} from '../components/SwipeableRow';
import { useTheme } from '../hooks/useTheme';
import { ThemedAlert } from '../components/ThemedAlert';
import { useThemedAlert } from '../hooks/useThemedAlert';
import {
  clearDownloadQueue,
  clearMusicCache,
  deleteCachedItem,
  redownloadItem,
  redownloadTrack,
} from '../services/musicCacheService';
import { clearQueue } from '../services/playerService';
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
  const { t } = useTranslation();
  const trackLabel = t('trackWithCount', { count: item.tracks.length });

  // Defer track list rendering by one frame so the chevron flip and row
  // expansion feel instant before mounting potentially many TrackFileRows.
  const [tracksReady, setTracksReady] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (expanded) {
      rafRef.current = requestAnimationFrame(() => setTracksReady(true));
    } else {
      setTracksReady(false);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    }
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [expanded]);

  const handleDelete = useCallback(() => {
    onDelete(item.itemId);
  }, [item.itemId, onDelete]);

  const handleRedownload = useCallback(() => {
    onRedownload(item.itemId);
  }, [item.itemId, onRedownload]);

  const handleToggle = useCallback(() => {
    onToggle(item.itemId);
  }, [item.itemId, onToggle]);

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'trash-outline' as const, color: colors.red, label: t('delete'), onPress: handleDelete, removesRow: true }],
    [colors.red, handleDelete, t],
  );

  const leftActions: SwipeAction[] = useMemo(
    () => offlineMode ? [] : [{ icon: 'refresh-outline' as const, color: colors.primary, label: t('refresh'), onPress: handleRedownload }],
    [offlineMode, colors.primary, handleRedownload, t],
  );

  return (
    <SwipeableRow rightActions={rightActions} leftActions={leftActions} enableFullSwipeRight enableFullSwipeLeft={!offlineMode} onPress={handleToggle} rowGap={10} borderRadius={12}>
      <View style={styles.rowContainer}>
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
              {item.type === 'album' ? t('album') : item.type === 'song' ? t('song') : t('playlist')} · {trackLabel} · {formatBytes(item.totalBytes)}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textSecondary}
            style={styles.chevron}
          />
        </View>

        {expanded && (
          <View style={[styles.trackList, { borderTopColor: colors.border }]}>
            {tracksReady ? (
              item.tracks.map((track) => (
                <TrackFileRow
                  key={track.id}
                  track={track}
                  itemId={item.itemId}
                  colors={colors}
                />
              ))
            ) : (
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={styles.trackLoading}
              />
            )}
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
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { alert, alertProps } = useThemedAlert();
  const transitionComplete = useTransitionComplete();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const cachedItems = musicCacheStore((s) => s.cachedItems);
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const hasItems = Object.keys(cachedItems).length > 0;

  const handleClearAll = useCallback(() => {
    alert(
      t('clearAllDownloads'),
      t('clearAllDownloadsMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clearAll'),
          style: 'destructive',
          onPress: async () => {
            setExpandedId(null);
            clearDownloadQueue();
            await clearQueue();
            await clearMusicCache();
          },
        },
      ],
    );
  }, [alert, t]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: hasItems
        ? () => (
            <Pressable
              onPress={handleClearAll}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={[styles.clearButton, { color: colors.primary }]}>{t('clear')}</Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, hasItems, handleClearAll, colors.primary]);

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
      t('removeDownload'),
      t('removeDownloadMessage', { name: item.name, size: formatBytes(item.totalBytes) }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
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
      t('redownload'),
      t('redownloadMessage', { name: item.name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('redownload'),
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
  const emptyMessage = isFiltered ? t('noMatchingDownloads') : t('noDownloadedMusic');
  const emptySubtitle = isFiltered ? undefined : t('downloadForOffline');

  const listEmpty = useMemo(
    () =>
      !transitionComplete ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <EmptyState icon="musical-notes-outline" title={emptyMessage} subtitle={emptySubtitle} />
      ),
    [transitionComplete, emptyMessage, emptySubtitle, colors.primary],
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
            onChangeText={setFilter}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      </View>
    ),
    [colors, filter],
  );

  return (
    <>
    <GradientBackground style={settingsStyles.container} scrollable>
      <FlashList
        data={transitionComplete ? entries : []}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={expandedId}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={{
          paddingTop: headerHeight,
          paddingHorizontal: 16,
          paddingBottom: 32,
          ...((!transitionComplete || entries.length === 0) ? { flex: 1 } : undefined),
        }}
        onScrollBeginDrag={closeOpenRow}
      />
    </GradientBackground>
    <ThemedAlert {...alertProps} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyListContent: {
    flex: 1,
  },
  rowContainer: {
    borderRadius: 12,
    overflow: 'hidden',
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
    borderRadius: 8,
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
  rowMeta: {
    fontSize: 12,
    marginTop: 3,
  },
  chevron: {
    marginLeft: 8,
  },
  trackList: {
    paddingLeft: 84,
    paddingRight: 16,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  trackLoading: {
    paddingVertical: 12,
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
    fontSize: 12,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  clearButton: {
    fontSize: 16,
    fontWeight: '400',
  },
});
