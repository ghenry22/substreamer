import { HeaderHeightContext } from '@react-navigation/elements';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useContext, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
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
            <Text style={[styles.artistName, { color: colors.textPrimary }]} numberOfLines={1}>
              {override.artistName}
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
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
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
      <GradientBackground style={styles.container}>
        <EmptyState
          icon="finger-print-outline"
          title="No MBID Overrides"
          subtitle="Overrides you set from an artist's menu will appear here."
        />
      </GradientBackground>
    );
  }

  return (
    <GradientBackground style={styles.container} scrollable>
      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: 32 }}
      />
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
  artistName: {
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
