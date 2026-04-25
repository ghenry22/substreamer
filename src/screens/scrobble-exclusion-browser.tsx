import { HeaderHeightContext } from '@react-navigation/elements';
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useContext, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
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
  const { t } = useTranslation();
  const handleDelete = useCallback(() => {
    scrobbleExclusionStore.getState().removeExclusion(item.type, item.id);
  }, [item]);

  const rightActions: SwipeAction[] = useMemo(
    () => [
      {
        icon: 'trash-outline' as const,
        color: colors.red,
        label: t('delete'),
        onPress: handleDelete,
        removesRow: true,
      },
    ],
    [colors.red, handleDelete, t],
  );

  const typeLabel =
    item.type === 'album' ? t('album') : item.type === 'artist' ? t('artist') : t('playlist');

  return (
    <View style={styles.rowWrapper}>
      <SwipeableRow rightActions={rightActions} enableFullSwipeRight borderRadius={12}>
        <View style={styles.row}>
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
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function ScrobbleExclusionBrowserScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
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

  const contentContainerStyle = useMemo(
    () => ({ paddingTop: headerHeight, paddingBottom: 32 }),
    [headerHeight],
  );

  if (data.length === 0) {
    return (
      <GradientBackground style={styles.container}>
        <EmptyState
          icon="eye-off-outline"
          title={t('noScrobbleExclusions')}
          subtitle={t('scrobbleExclusionsSubtitle')}
        />
        <BottomChrome withSafeAreaPadding />
      </GradientBackground>
    );
  }

  return (
    <GradientBackground style={styles.container} scrollable>
      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={contentContainerStyle}
      />
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  rowWrapper: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  row: {
    minHeight: ROW_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
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
    fontSize: 12,
  },
});
