import { HeaderHeightContext } from '@react-navigation/elements';
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState as EmptyStateComponent } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { SegmentControl } from '../components/SegmentControl';
import { useTheme } from '../hooks/useTheme';
import { completedScrobbleStore, type CompletedScrobble } from '../store/completedScrobbleStore';
import { pendingScrobbleStore, type PendingScrobble } from '../store/pendingScrobbleStore';
import { timeAgo } from '../utils/stringHelpers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Scrobble = PendingScrobble | CompletedScrobble;

type ScrobbleSegment = 'completed' | 'pending';

const SEGMENT_KEYS = [
  { key: 'completed', labelKey: 'completed' },
  { key: 'pending', labelKey: 'pending' },
] as const;

const ROW_HEIGHT = 56;

/* ------------------------------------------------------------------ */
/*  ScrobbleRow                                                        */
/* ------------------------------------------------------------------ */

const ScrobbleRow = memo(function ScrobbleRow({
  scrobble,
  colors,
}: {
  scrobble: Scrobble;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.rowLeft}>
        <Text style={[styles.trackTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {scrobble.song.title}
        </Text>
        {scrobble.song.artist ? (
          <Text style={[styles.artistName, { color: colors.textSecondary }]} numberOfLines={1}>
            {scrobble.song.artist}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>
        {timeAgo(scrobble.time, t)}
      </Text>
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Empty State                                                        */
/* ------------------------------------------------------------------ */

function ScrobbleEmptyState({ segment }: { segment: ScrobbleSegment }) {
  const { t } = useTranslation();
  const icon = segment === 'completed' ? 'checkmark-done-outline' : 'time-outline';
  const message =
    segment === 'completed' ? t('noCompletedScrobblesYet') : t('noPendingScrobbles');
  const subtitle =
    segment === 'completed'
      ? t('scrobblesAppearAfterPlaying')
      : t('pendingScrobblesSentAutomatically');

  return <EmptyStateComponent icon={icon} title={message} subtitle={subtitle} />;
}

/* ------------------------------------------------------------------ */
/*  ScrobbleBrowserScreen                                              */
/* ------------------------------------------------------------------ */

export function ScrobbleBrowserScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const [activeSegment, setActiveSegment] = useState<ScrobbleSegment>('completed');

  const segments = useMemo(
    () => SEGMENT_KEYS.map((s) => ({ key: s.key, label: t(s.labelKey) })),
    [t],
  );

  const pendingScrobbles = pendingScrobbleStore((s) => s.pendingScrobbles);
  const completedScrobbles = completedScrobbleStore((s) => s.completedScrobbles);


  const completedReversed = useMemo(
    () => [...completedScrobbles].reverse(),
    [completedScrobbles],
  );

  const pendingReversed = useMemo(
    () => [...pendingScrobbles].reverse(),
    [pendingScrobbles],
  );

  const keyExtractor = useCallback((item: Scrobble, index: number) => `${item.id}-${index}`, []);

  const renderItem = useCallback(
    ({ item }: { item: Scrobble }) => <ScrobbleRow scrobble={item} colors={colors} />,
    [colors],
  );

  const completedEmpty = useCallback(
    () => <ScrobbleEmptyState segment="completed" />,
    [],
  );

  const pendingEmpty = useCallback(
    () => <ScrobbleEmptyState segment="pending" />,
    [],
  );

  const segmentHeight = 52;
  const contentInsetTop = headerHeight + segmentHeight;

  const completedContentContainerStyle = useMemo(
    () => ({
      paddingTop: contentInsetTop,
      ...(completedReversed.length === 0 ? { flexGrow: 1 } : undefined),
    }),
    [contentInsetTop, completedReversed.length],
  );
  const pendingContentContainerStyle = useMemo(
    () => ({
      paddingTop: contentInsetTop,
      ...(pendingReversed.length === 0 ? { flexGrow: 1 } : undefined),
    }),
    [contentInsetTop, pendingReversed.length],
  );

  return (
    <GradientBackground style={styles.container} scrollable>
      <View style={styles.content}>
        {activeSegment === 'completed' && (
          <FlashList
            data={completedReversed}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ListEmptyComponent={completedEmpty}
            contentContainerStyle={completedContentContainerStyle}
          />
        )}
        {activeSegment === 'pending' && (
          <FlashList
            data={pendingReversed}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ListEmptyComponent={pendingEmpty}
            contentContainerStyle={pendingContentContainerStyle}
          />
        )}
      </View>
      <View style={[styles.segmentOverlay, { top: headerHeight }]}>
        <SegmentControl segments={segments} selected={activeSegment} onSelect={setActiveSegment} />
      </View>
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  segmentOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: ROW_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: {
    flex: 1,
    marginRight: 12,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  artistName: {
    fontSize: 12,
    marginTop: 2,
  },
  timeLabel: {
    fontSize: 12,
    flexShrink: 0,
  },
});
