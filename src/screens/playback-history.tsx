import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { GenreChart } from '../components/GenreChart';
import { MiniBarChart } from '../components/MiniBarChart';
import { SectionTitle } from '../components/SectionTitle';
import { StatCard } from '../components/StatCard';
import { TopItemRow } from '../components/TopItemRow';
import { usePlaybackAnalytics, type TimePeriod } from '../hooks/usePlaybackAnalytics';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { pendingScrobbleStore } from '../store/pendingScrobbleStore';

const PERIODS: { key: TimePeriod; label: string }[] = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'all', label: 'All' },
];

const HOUR_LABELS = [
  '12am', '', '', '3am', '', '', '6am', '', '', '9am', '', '',
  '12pm', '', '', '3pm', '', '', '6pm', '', '', '9pm', '', '',
];

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function PlaybackHistoryScreen() {
  const { colors } = useTheme();
  const transitionComplete = useTransitionComplete();
  const [period, setPeriod] = useState<TimePeriod>('30d');

  const completedScrobbles = completedScrobbleStore((s) => s.completedScrobbles);
  const pendingScrobbles = pendingScrobbleStore((s) => s.pendingScrobbles);
  const dateFormat = layoutPreferencesStore((s) => s.dateFormat);

  const analytics = usePlaybackAnalytics(completedScrobbles, period);

  const handlePeriodChange = useCallback((p: TimePeriod) => {
    setPeriod(p);
  }, []);

  if (!transitionComplete) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const isEmpty = completedScrobbles.length === 0 && pendingScrobbles.length === 0;

  if (isEmpty) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="musical-notes-outline"
          title="No playback history yet"
          subtitle="Listen to some music and check back soon to see your personal stats, top tracks, and listening trends."
        >
          <Text style={[styles.emptyDisclaimer, { color: colors.textSecondary }]}>
            Listening history is tracked locally on this device and is not synced to your server or
            other devices.
          </Text>
        </EmptyState>
      </View>
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
    label: HOUR_LABELS[i],
  }));

  const recentScrobbles = [...completedScrobbles]
    .sort((a, b) => b.time - a.time)
    .slice(0, 20);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
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
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Hero stat cards */}
      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          <StatCard
            icon="musical-notes"
            value={analytics.totalPlays.toLocaleString()}
            label="Total Plays"
            colors={colors}
            index={0}
          />
          <StatCard
            icon="time-outline"
            value={formatDuration(analytics.totalListeningSeconds)}
            label="Listening Time"
            colors={colors}
            index={1}
          />
        </View>
        <View style={styles.statsRow}>
          <StatCard
            icon="people-outline"
            value={analytics.uniqueArtists.toLocaleString()}
            label="Unique Artists"
            colors={colors}
            index={2}
          />
          <StatCard
            icon="flame-outline"
            value={`${analytics.longestStreak}d`}
            label={`Streak${analytics.currentStreak > 0 ? ` (${analytics.currentStreak}d active)` : ''}`}
            colors={colors}
            index={3}
          />
        </View>
      </View>

      {/* Daily activity */}
      {analytics.dailyActivity.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title="Daily Activity" color={colors.textSecondary} />
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
          <SectionTitle title="Listening Hours" color={colors.textSecondary} />
          <View style={styles.peakBadge}>
            <Ionicons name="sunny-outline" size={12} color={colors.primary} />
            <Text style={[styles.peakText, { color: colors.primary }]}>
              Peak: {formatHour(analytics.peakHour)}
            </Text>
          </View>
        </View>
        <MiniBarChart data={hourlyBarData} colors={colors} highlightIndex={analytics.peakHour} />
      </View>

      {/* Top songs */}
      {analytics.topSongs.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title="Most Played Songs" color={colors.textSecondary} />
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
          <SectionTitle title="Most Played Artists" color={colors.textSecondary} />
          {analytics.topArtists.map((item, i) => (
            <TopItemRow
              key={item.artist}
              rank={i + 1}
              title={item.artist}
              count={item.count}
              maxCount={analytics.topArtists[0].count}
              colors={colors}
              initials={item.artist.substring(0, 2).toUpperCase()}
              index={i}
            />
          ))}
        </View>
      )}

      {/* Top albums */}
      {analytics.topAlbums.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title="Top Albums" color={colors.textSecondary} />
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
        <SectionTitle title="Genres" color={colors.textSecondary} />
        <GenreChart
          data={analytics.genreBreakdown}
          totalPlays={analytics.totalPlays}
          colors={colors}
        />
      </View>

      {/* Activity heatmap */}
      <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
        <SectionTitle title="Listening History" color={colors.textSecondary} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ActivityHeatmap data={analytics.heatmapData} colors={colors} />
        </ScrollView>
      </View>

      {/* Pending scrobbles */}
      {pendingScrobbles.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <SectionTitle title="Pending Scrobbles" color={colors.textSecondary} />
            <View style={[styles.pendingBadge, { backgroundColor: colors.red + '20' }]}>
              <Text style={[styles.pendingCount, { color: colors.red }]}>
                {pendingScrobbles.length}
              </Text>
            </View>
          </View>
          <Text style={[styles.pendingHint, { color: colors.textSecondary }]}>
            Waiting to be submitted to the server
          </Text>
          {pendingScrobbles.slice(0, 10).map((s) => (
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
                  {s.song.artist ?? 'Unknown'}
                </Text>
              </View>
              <Text style={[styles.recentTime, { color: colors.textSecondary }]}>
                {timeAgo(s.time)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Recent scrobble timeline */}
      {recentScrobbles.length > 0 && (
        <View style={[styles.section, styles.card, { backgroundColor: colors.card }]}>
          <SectionTitle title="Recent Plays" color={colors.textSecondary} />
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
                  {s.song.artist ?? 'Unknown'} — {s.song.album ?? 'Unknown'}
                </Text>
              </View>
              <Text style={[styles.recentTime, { color: colors.textSecondary }]}>
                {timeAgo(s.time)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.footer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
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
    fontSize: 13,
    fontWeight: '600',
  },
  periodLabelActive: {
    fontWeight: '700',
  },
  statsGrid: {
    gap: 10,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
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
    gap: 10,
  },
  recentThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  recentInfo: {
    flex: 1,
    gap: 2,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  recentSubtitle: {
    fontSize: 12,
  },
  recentTime: {
    fontSize: 11,
    fontWeight: '500',
  },
  footer: {
    height: 40,
  },
});
