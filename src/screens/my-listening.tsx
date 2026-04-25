import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import i18next from 'i18next';
import { useCallback, useContext, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { GenreChart } from '../components/GenreChart';
import { GradientBackground } from '../components/GradientBackground';
import { MiniBarChart } from '../components/MiniBarChart';
import { BottomChrome } from '../components/BottomChrome';
import { SectionTitle } from '../components/SectionTitle';
import { StatCard } from '../components/StatCard';
import { TopItemRow } from '../components/TopItemRow';
import { usePlaybackAnalytics, type TimePeriod } from '../hooks/usePlaybackAnalytics';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { pendingScrobbleStore } from '../store/pendingScrobbleStore';
import { getArtistInitials, minDelay, timeAgo } from '../utils/stringHelpers';

const PERIODS: { key: TimePeriod; labelKey: string }[] = [
  { key: '7d', labelKey: 'period7d' },
  { key: '30d', labelKey: 'period30d' },
  { key: '90d', labelKey: 'period90d' },
  { key: 'all', labelKey: 'periodAll' },
];

function buildHourLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { hour: 'numeric' });
  return Array.from({ length: 24 }, (_, h) => {
    if (h % 3 !== 0) return '';
    const d = new Date(2000, 0, 1, h);
    return fmt.format(d);
  });
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatHour(hour: number): string {
  const d = new Date(2000, 0, 1, hour);
  return new Intl.DateTimeFormat(i18next.language, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}


export function MyListeningScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const transitionComplete = useTransitionComplete();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const refreshControlKey = useRefreshControlKey();
  const [period, setPeriod] = useState<TimePeriod>('30d');
  const [refreshing, setRefreshing] = useState(false);

  const hourLabels = useMemo(() => buildHourLabels(i18next.language), []);
  const completedScrobbles = completedScrobbleStore((s) => s.completedScrobbles);
  const pendingScrobbles = pendingScrobbleStore((s) => s.pendingScrobbles);
  const aggregates = completedScrobbleStore((s) => s.aggregates);
  const dateFormat = layoutPreferencesStore((s) => s.dateFormat);

  const analytics = usePlaybackAnalytics(completedScrobbles, period, pendingScrobbles, aggregates);

  const handlePeriodChange = useCallback((p: TimePeriod) => {
    setPeriod(p);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const delay = minDelay();
    completedScrobbleStore.getState().rebuildAggregates();
    await delay;
    setRefreshing(false);
  }, []);

  if (!transitionComplete) {
    return (
      <GradientBackground style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
        <BottomChrome withSafeAreaPadding />
      </GradientBackground>
    );
  }

  const isEmpty = completedScrobbles.length === 0 && pendingScrobbles.length === 0;

  if (isEmpty) {
    return (
      <GradientBackground style={styles.loadingContainer}>
        <EmptyState
          icon="musical-notes-outline"
          title={t('noListeningHistoryYet')}
          subtitle={t('noListeningHistorySubtitle')}
        >
          <Text style={[styles.emptyDisclaimer, { color: colors.textSecondary }]}>
            {t('listeningHistoryDisclaimer')}
          </Text>
        </EmptyState>
        <BottomChrome withSafeAreaPadding />
      </GradientBackground>
    );
  }

  const dailyBarData = analytics.dailyActivity.map((d) => {
    const [, mm, dd] = d.date.split('-');
    return {
      value: d.count,
      label: dateFormat === 'yyyy/dd/mm' ? `${dd}/${mm}` : `${mm}/${dd}`,
    };
  });

  const hourlyBarData = analytics.hourlyDistribution.map((count, i) => ({
    value: count,
    label: hourLabels[i],
  }));

  const recentScrobbles = [...completedScrobbles]
    .sort((a, b) => b.time - a.time)
    .slice(0, 20);

  return (
    <GradientBackground scrollable>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: headerHeight + 8 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          key={refreshControlKey}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
          progressViewOffset={headerHeight}
        />
      }
    >
      {/* Period selector */}
      <View style={[styles.periodRow, { backgroundColor: colors.card }]}>
        {PERIODS.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => handlePeriodChange(p.key)}
            style={[
              styles.periodButton,
              period === p.key && { backgroundColor: colors.primary },
            ]}
          >
            <Text
              style={[
                styles.periodLabel,
                { color: period === p.key ? '#fff' : colors.textSecondary },
                period === p.key && styles.periodLabelActive,
              ]}
            >
              {t(p.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Hero stat cards */}
      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          <StatCard
            icon="musical-notes"
            value={analytics.totalPlays.toLocaleString(i18next.language)}
            label={t('totalPlays')}
            colors={colors}
            index={0}
          />
          <StatCard
            icon="time-outline"
            value={formatDuration(analytics.totalListeningSeconds)}
            label={t('listeningTime')}
            colors={colors}
            index={1}
          />
        </View>
        <View style={styles.statsRow}>
          <StatCard
            icon="people-outline"
            value={analytics.uniqueArtists.toLocaleString(i18next.language)}
            label={t('uniqueArtists')}
            colors={colors}
            index={2}
          />
          <StatCard
            icon="flame-outline"
            value={t('streakDays', { count: analytics.currentStreak })}
            label={analytics.longestStreak > analytics.currentStreak ? t('streakWithBest', { best: analytics.longestStreak }) : t('streak')}
            colors={colors}
            index={3}
          />
        </View>
      </View>

      {/* Daily activity */}
      {analytics.dailyActivity.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title={t('dailyActivity')} color={colors.textSecondary} />
          <MiniBarChart
            data={dailyBarData}
            colors={colors}
            highlightIndex={dailyBarData.length - 1}
          />
        </View>
      )}

      {/* Peak listening hours */}
      <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.sectionHeader}>
          <SectionTitle title={t('listeningHours')} color={colors.textSecondary} />
          <View style={styles.peakBadge}>
            <Ionicons name="sunny-outline" size={12} color={colors.primary} />
            <Text style={[styles.peakText, { color: colors.primary }]}>
              {t('peakHour', { hour: formatHour(analytics.peakHour) })}
            </Text>
          </View>
        </View>
        <MiniBarChart data={hourlyBarData} colors={colors} highlightIndex={analytics.peakHour} />
      </View>

      {/* Top songs */}
      {analytics.topSongs.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title={t('mostPlayedSongs')} color={colors.textSecondary} />
          {analytics.topSongs.map((item, i) => (
            <TopItemRow
              key={item.song.id}
              rank={i + 1}
              title={item.song.title}
              subtitle={item.song.artist ?? undefined}
              count={item.count}
              maxCount={analytics.topSongs[0].count}
              coverArtId={item.song.coverArt ?? undefined}
              colors={colors}
              index={i}
            />
          ))}
        </View>
      )}

      {/* Top artists */}
      {analytics.topArtists.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title={t('mostPlayedArtists')} color={colors.textSecondary} />
          {analytics.topArtists.map((item, i) => (
            <TopItemRow
              key={item.artist}
              rank={i + 1}
              title={item.artist}
              count={item.count}
              maxCount={analytics.topArtists[0].count}
              colors={colors}
              initials={getArtistInitials(item.artist)}
              index={i}
            />
          ))}
        </View>
      )}

      {/* Top albums */}
      {analytics.topAlbums.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title={t('topAlbums')} color={colors.textSecondary} />
          {analytics.topAlbums.map((item, i) => (
            <TopItemRow
              key={`${item.album}-${item.artist}`}
              rank={i + 1}
              title={item.album}
              subtitle={item.artist}
              count={item.count}
              maxCount={analytics.topAlbums[0].count}
              coverArtId={item.coverArt}
              colors={colors}
              index={i}
            />
          ))}
        </View>
      )}

      {/* Genre breakdown */}
      <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
        <SectionTitle title={t('genres')} color={colors.textSecondary} />
        <GenreChart
          data={analytics.genreBreakdown}
          totalPlays={analytics.totalPlays}
          colors={colors}
        />
      </View>

      {/* Activity heatmap */}
      <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
        <SectionTitle title={t('listeningHistory')} color={colors.textSecondary} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ActivityHeatmap data={analytics.heatmapData} colors={colors} />
        </ScrollView>
      </View>

      {/* Pending scrobbles */}
      {pendingScrobbles.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <SectionTitle title={t('pendingScrobbles')} color={colors.textSecondary} />
            <View style={[styles.pendingBadge, { backgroundColor: colors.red + '20' }]}>
              <Text style={[styles.pendingCount, { color: colors.red }]}>
                {pendingScrobbles.length}
              </Text>
            </View>
          </View>
          <Text style={[styles.pendingHint, { color: colors.textSecondary }]}>
            {t('waitingToBeSubmitted')}
          </Text>
          {[...pendingScrobbles].reverse().slice(0, 10).map((s) => (
            <View key={s.id} style={[styles.recentRow, { borderBottomColor: colors.border }]}>
              {s.song.coverArt && (
                <CachedImage
                  coverArtId={s.song.coverArt}
                  size={150}
                  style={styles.recentThumb}
                  resizeMode="cover"
                />
              )}
              <View style={styles.recentInfo}>
                <Text style={[styles.recentTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                  {s.song.title}
                </Text>
                <Text
                  style={[styles.recentSubtitle, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {s.song.artist ?? t('unknownArtist')}
                </Text>
              </View>
              <Text style={[styles.recentTime, { color: colors.textSecondary }]}>
                {timeAgo(s.time, t)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Recent scrobble timeline */}
      {recentScrobbles.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title={t('recentPlays')} color={colors.textSecondary} />
          {recentScrobbles.map((s) => (
            <View key={s.id} style={[styles.recentRow, { borderBottomColor: colors.border }]}>
              {s.song.coverArt && (
                <CachedImage
                  coverArtId={s.song.coverArt}
                  size={150}
                  style={styles.recentThumb}
                  resizeMode="cover"
                />
              )}
              <View style={styles.recentInfo}>
                <Text style={[styles.recentTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                  {s.song.title}
                </Text>
                <Text
                  style={[styles.recentSubtitle, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {s.song.artist ?? t('unknownArtist')} — {s.song.album ?? t('unknownAlbum')}
                </Text>
              </View>
              <Text style={[styles.recentTime, { color: colors.textSecondary }]}>
                {timeAgo(s.time, t)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.footer} />
    </ScrollView>
    <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyDisclaimer: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  periodRow: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  periodLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  periodLabelActive: {
    fontWeight: '700',
  },
  statsGrid: {
    gap: 12,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  section: {
    marginBottom: 16,
  },
  card: {
    borderRadius: 12,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  peakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  peakText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pendingBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 10,
  },
  pendingCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  pendingHint: {
    fontSize: 12,
    marginBottom: 10,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  recentThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  recentInfo: {
    flex: 1,
    gap: 4,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  recentSubtitle: {
    fontSize: 12,
  },
  recentTime: {
    fontSize: 12,
    fontWeight: '500',
  },
  footer: {
    height: 40,
  },
});
