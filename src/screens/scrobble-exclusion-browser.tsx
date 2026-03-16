import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../components/EmptyState';
import { SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { useTheme } from '../hooks/useTheme';
import {
  scrobbleExclusionStore,
  type ScrobbleExclusion,
  type ScrobbleExclusionType,
} from '../store/scrobbleExclusionStore';

const ROW_HEIGHT = 72;

interface ExclusionItem extends ScrobbleExclusion {
  type: ScrobbleExclusionType;
}

/* ------------------------------------------------------------------ */
/*  Row                                                                */
/* ------------------------------------------------------------------ */

const ExclusionRow = memo(function ExclusionRow({
  item,
  colors,
}: {
  item: ExclusionItem;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const handleDelete = useCallback(() => {
    scrobbleExclusionStore.getState().removeExclusion(item.type, item.id);
  }, [item]);

  const rightActions: SwipeAction[] = useMemo(
    () => [
      {
        icon: 'trash-outline' as const,
        color: colors.red,
        label: 'Delete',
        onPress: handleDelete,
        removesRow: true,
      },
    ],
    [colors.red, handleDelete],
  );

  const typeLabel =
    item.type === 'album' ? 'Album' : item.type === 'artist' ? 'Artist' : 'Playlist';

  return (
    <SwipeableRow rightActions={rightActions} enableFullSwipeRight>
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={styles.rowContent}>
          <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.type, { color: colors.textSecondary }]} numberOfLines={1}>
            {typeLabel}
          </Text>
        </View>
      </View>
    </SwipeableRow>
  );
});

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function ScrobbleExclusionBrowserScreen() {
  const { colors } = useTheme();
  const excludedAlbums = scrobbleExclusionStore((s) => s.excludedAlbums);
  const excludedArtists = scrobbleExclusionStore((s) => s.excludedArtists);
  const excludedPlaylists = scrobbleExclusionStore((s) => s.excludedPlaylists);

  const data = useMemo(() => {
    const items: ExclusionItem[] = [
      ...Object.values(excludedAlbums).map((e) => ({ ...e, type: 'album' as const })),
      ...Object.values(excludedArtists).map((e) => ({ ...e, type: 'artist' as const })),
      ...Object.values(excludedPlaylists).map((e) => ({ ...e, type: 'playlist' as const })),
    ];
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [excludedAlbums, excludedArtists, excludedPlaylists]);

  const renderItem = useCallback(
    ({ item }: { item: ExclusionItem }) => (
      <ExclusionRow item={item} colors={colors} />
    ),
    [colors],
  );

  const keyExtractor = useCallback(
    (item: ExclusionItem) => `${item.type}-${item.id}`,
    [],
  );

  if (data.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="eye-off-outline"
          title="No Scrobble Exclusions"
          subtitle="Exclusions you set from an album, artist, or playlist menu will appear here."
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  row: {
    minHeight: ROW_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  rowContent: {
    gap: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  type: {
    fontSize: 13,
  },
});
