import { HeaderHeightContext } from '@react-navigation/elements';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { MiniPlayerFooter } from '../components/MiniPlayerFooter';
import { SegmentControl, type Segment } from '../components/SegmentControl';
import { SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { useTheme } from '../hooks/useTheme';
import { albumInfoStore } from '../store/albumInfoStore';
import { artistDetailStore } from '../store/artistDetailStore';
import { mbidOverrideStore, type MbidOverride, type MbidOverrideType } from '../store/mbidOverrideStore';
import { mbidSearchStore } from '../store/mbidSearchStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { processingOverlayStore } from '../store/processingOverlayStore';

const ROW_HEIGHT = 72;

/* ------------------------------------------------------------------ */
/*  Row                                                                */
/* ------------------------------------------------------------------ */

const OverrideRow = memo(function OverrideRow({
  override,
  offlineMode,
  colors,
}: {
  override: MbidOverride;
  offlineMode: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (offlineMode) return;
    if (override.type === 'artist') {
      mbidSearchStore
        .getState()
        .showArtist(override.entityId, override.entityName, override.mbid);
    } else {
      mbidSearchStore
        .getState()
        .showAlbum(override.entityId, override.entityName, null, override.mbid);
    }
  }, [override, offlineMode]);

  const handleDelete = useCallback(async () => {
    const { type, entityId } = override;
    mbidOverrideStore.getState().removeOverride(type, entityId);
    if (type === 'artist' && entityId in artistDetailStore.getState().artists) {
      processingOverlayStore.getState().show(t('updatingArtist'));
      try {
        await artistDetailStore.getState().fetchArtist(entityId);
        processingOverlayStore.getState().showSuccess(t('artistUpdated'));
      } catch {
        processingOverlayStore.getState().showError(t('failedToUpdateArtist'));
      }
    } else if (type === 'album' && entityId in albumInfoStore.getState().entries) {
      processingOverlayStore.getState().show(t('updatingAlbum'));
      try {
        await albumInfoStore.getState().fetchAlbumInfo(entityId);
        processingOverlayStore.getState().showSuccess(t('albumUpdated'));
      } catch {
        processingOverlayStore.getState().showError(t('failedToUpdateAlbum'));
      }
    }
  }, [override]);

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

  return (
    <View style={styles.rowWrapper}>
      <SwipeableRow
        rightActions={rightActions}
        enableFullSwipeRight
        onPress={handlePress}
        borderRadius={12}
      >
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={[styles.entityName, { color: colors.textPrimary }]} numberOfLines={1}>
              {override.entityName}
            </Text>
            <View style={styles.mbidRow}>
              <Ionicons name="finger-print-outline" size={14} color={colors.primary} />
              <Text style={[styles.mbid, { color: colors.textSecondary }]} numberOfLines={1}>
                {override.mbid}
              </Text>
            </View>
          </View>
        </View>
      </SwipeableRow>
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function MbidOverrideBrowserScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const overrides = mbidOverrideStore((s) => s.overrides);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const [selectedType, setSelectedType] = useState<MbidOverrideType>('artist');

  const segments = useMemo<Segment<MbidOverrideType>[]>(
    () => [
      { key: 'artist', label: t('artists') },
      { key: 'album', label: t('albums') },
    ],
    [t],
  );

  const allEntries = useMemo(() => Object.values(overrides), [overrides]);

  const data = useMemo(
    () =>
      allEntries
        .filter((o) => o.type === selectedType)
        .sort((a, b) => a.entityName.localeCompare(b.entityName)),
    [allEntries, selectedType],
  );

  const renderItem = useCallback(
    ({ item }: { item: MbidOverride }) => (
      <OverrideRow override={item} offlineMode={offlineMode} colors={colors} />
    ),
    [colors, offlineMode],
  );

  const keyExtractor = useCallback((item: MbidOverride) => `${item.type}:${item.entityId}`, []);

  return (
    <GradientBackground style={styles.container} scrollable>
      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={
          <View style={styles.segmentWrapper}>
            <SegmentControl segments={segments} selected={selectedType} onSelect={setSelectedType} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="finger-print-outline"
            title={selectedType === 'artist' ? t('noArtistOverrides') : t('noAlbumOverrides')}
            subtitle={selectedType === 'artist' ? t('artistOverridesAppearHere') : t('albumOverridesAppearHere')}
          />
        }
        contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: 32 }}
      />
      <MiniPlayerFooter />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  segmentWrapper: {
    paddingBottom: 12,
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
  entityName: {
    fontSize: 16,
    fontWeight: '600',
  },
  mbidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mbid: {
    fontSize: 12,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
});
