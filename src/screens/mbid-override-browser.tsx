import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../components/EmptyState';
import { SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { useTheme } from '../hooks/useTheme';
import { artistDetailStore } from '../store/artistDetailStore';
import { mbidOverrideStore, type MbidOverride } from '../store/mbidOverrideStore';
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
  const handlePress = useCallback(() => {
    if (offlineMode) return;
    mbidSearchStore
      .getState()
      .show(override.artistId, override.artistName, override.mbid);
  }, [override, offlineMode]);

  const handleDelete = useCallback(async () => {
    const { artistId } = override;
    mbidOverrideStore.getState().removeOverride(artistId);
    if (artistId in artistDetailStore.getState().artists) {
      processingOverlayStore.getState().show('Updating Artist…');
      try {
        await artistDetailStore.getState().fetchArtist(artistId);
        processingOverlayStore.getState().showSuccess('Artist Updated');
      } catch {
        processingOverlayStore.getState().showError('Failed to update artist');
      }
    }
  }, [override]);

  const leftActions: SwipeAction[] = useMemo(
    () =>
      offlineMode
        ? []
        : [
            {
              icon: 'trash-outline' as const,
              color: colors.red,
              label: 'Delete',
              onPress: handleDelete,
              removesRow: true,
            },
          ],
    [colors.red, handleDelete, offlineMode],
  );

  return (
    <SwipeableRow
      leftActions={leftActions}
      enableFullSwipeLeft={!offlineMode}
      onPress={handlePress}
    >
      <View style={[styles.row, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.rowContent}>
          <Text style={[styles.artistName, { color: colors.textPrimary }]} numberOfLines={1}>
            {override.artistName}
          </Text>
          <Text style={[styles.mbid, { color: colors.textSecondary }]} numberOfLines={1}>
            {override.mbid}
          </Text>
        </View>
      </View>
    </SwipeableRow>
  );
});

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export function MbidOverrideBrowserScreen() {
  const { colors } = useTheme();
  const overrides = mbidOverrideStore((s) => s.overrides);
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const data = useMemo(
    () => Object.values(overrides).sort((a, b) => a.artistName.localeCompare(b.artistName)),
    [overrides],
  );

  const renderItem = useCallback(
    ({ item }: { item: MbidOverride }) => (
      <OverrideRow override={item} offlineMode={offlineMode} colors={colors} />
    ),
    [colors, offlineMode],
  );

  const keyExtractor = useCallback((item: MbidOverride) => item.artistId, []);

  if (data.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="finger-print-outline"
          title="No MBID Overrides"
          subtitle="Overrides you set from an artist's menu will appear here."
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
  artistName: {
    fontSize: 16,
    fontWeight: '600',
  },
  mbid: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
