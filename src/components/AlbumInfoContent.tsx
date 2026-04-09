/**
 * AlbumInfoContent — shared album info panel used by both the phone player
 * and tablet expanded player views.
 *
 * Displays: format badge, quick stats (year, play count, BPM), genre pills,
 * credits rows, album description with expand/collapse, skeleton loading
 * state, and external links (Last.fm, MusicBrainz, Wikipedia).
 */

import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { FormatBadge } from './FormatBadge';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { type Child } from '../services/subsonicService';
import { hexWithAlpha } from '../utils/colors';
import { getEffectiveFormat } from '../utils/effectiveFormat';
import { getGenreNames } from '../utils/genreHelpers';

/* ------------------------------------------------------------------ */
/*  Genre pill palette (matches GenreChart)                            */
/* ------------------------------------------------------------------ */

const GENRE_PALETTE = [
  '#6366F1', // indigo
  '#F59E0B', // amber
  '#10B981', // emerald
  '#EF4444', // red
  '#8B5CF6', // violet
  '#64748B', // slate
];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AlbumInfoContentProps {
  track: Child;
  albumInfo: { notes?: string; lastFmUrl?: string; musicBrainzId?: string } | null;
  /** Release-group MBID from user override, or null. */
  overrideMbid: string | null;
  sanitizedNotes: string | null;
  notesAttributionUrl: string | null;
  albumInfoLoading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  colors: {
    textPrimary: string;
    textSecondary: string;
    primary: string;
    card: string;
    label: string;
    border: string;
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const AlbumInfoContent = memo(function AlbumInfoContent({
  track,
  albumInfo,
  overrideMbid,
  sanitizedNotes,
  notesAttributionUrl,
  albumInfoLoading,
  refreshing,
  onRefresh,
  colors,
}: AlbumInfoContentProps) {
  const { t } = useTranslation();
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const refreshControlKey = useRefreshControlKey();

  // Reset expand/truncation state when notes change (different album)
  const notesRef = useRef(sanitizedNotes);
  if (notesRef.current !== sanitizedNotes) {
    notesRef.current = sanitizedNotes;
    if (notesExpanded) setNotesExpanded(false);
    if (needsTruncation) setNeedsTruncation(false);
  }

  const effectiveFormat = useMemo(() => getEffectiveFormat(track), [track]);
  const genreNames = useMemo(() => getGenreNames(track), [track]);

  // Build quick stats
  const quickStats = useMemo(() => {
    const stats: { icon: string; value: string; label: string }[] = [];
    if (track.year) {
      stats.push({ icon: 'calendar-outline', value: String(track.year), label: t('detailYear') });
    }
    if (track.playCount != null && track.playCount > 0) {
      stats.push({ icon: 'play-outline', value: String(track.playCount), label: t('detailPlayCount') });
    }
    if (track.bpm) {
      stats.push({ icon: 'pulse-outline', value: String(track.bpm), label: t('detailBpm') });
    }
    return stats;
  }, [track, t]);

  // Build credit rows (artist, album artist, composer)
  const credits = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    if (track.album) rows.push({ label: t('detailAlbum'), value: track.album });
    if (track.artist) rows.push({ label: t('detailArtist'), value: track.artist });
    if (track.displayAlbumArtist && track.displayAlbumArtist !== track.artist) {
      rows.push({ label: t('detailAlbumArtist'), value: track.displayAlbumArtist });
    }
    if (track.displayComposer) rows.push({ label: t('detailComposer'), value: track.displayComposer });
    return rows;
  }, [track, t]);

  const handleLastFm = useCallback(() => {
    if (albumInfo?.lastFmUrl) Linking.openURL(albumInfo.lastFmUrl);
  }, [albumInfo?.lastFmUrl]);

  const handleMusicBrainz = useCallback(() => {
    if (overrideMbid) {
      Linking.openURL(`https://musicbrainz.org/release-group/${overrideMbid}`);
    } else if (albumInfo?.musicBrainzId) {
      Linking.openURL(`https://musicbrainz.org/release/${albumInfo.musicBrainzId}`);
    }
  }, [overrideMbid, albumInfo?.musicBrainzId]);

  const handleWikipedia = useCallback(() => {
    if (notesAttributionUrl) Linking.openURL(notesAttributionUrl);
  }, [notesAttributionUrl]);

  return (
    <ScrollView
      style={styles.infoScrollView}
      contentContainerStyle={styles.infoContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          key={refreshControlKey}
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {(albumInfoLoading || refreshing) ? (
        /* Skeleton placeholder */
        <View>
          {[0.4, 0.6, 0.5, 0.35, 0.55].map((w, i) => (
            <View key={i} style={styles.skeletonRow}>
              <View style={[styles.skeletonBar, styles.skeletonLabel]} />
              <View style={[styles.skeletonBar, { width: `${w * 100}%` }]} />
            </View>
          ))}
          <View style={styles.infoSection}>
            {[1, 0.97, 1, 0.95, 0.98, 1, 0.93, 0.96, 1, 0.6].map((w, i) => (
              <View
                key={i}
                style={[styles.skeletonBar, styles.skeletonTextLine, { width: `${w * 100}%` }]}
              />
            ))}
          </View>
          <View style={styles.skeletonLinksRow}>
            {[75, 95, 80].map((w, i) => (
              <View key={i} style={[styles.skeletonBar, styles.skeletonChip, { width: w }]} />
            ))}
          </View>
        </View>
      ) : (
        <>
          {/* Format badge */}
          {effectiveFormat && (
            <View style={styles.formatSection}>
              <FormatBadge format={effectiveFormat} />
            </View>
          )}

          {/* Quick stats */}
          {quickStats.length > 0 && (
            <View style={styles.statsRow}>
              {quickStats.map((stat) => (
                <View key={stat.label} style={[styles.statCard, { backgroundColor: colors.card }]}>
                  <Ionicons name={stat.icon as any} size={16} color={colors.primary} />
                  <Text style={[styles.statValue, { color: colors.textPrimary }]}>{stat.value}</Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Genre pills */}
          {genreNames.length > 0 && (
            <View style={styles.genreSection}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                {genreNames.length > 1 ? t('detailGenres') : t('detailGenre')}
              </Text>
              <View style={styles.genrePillCloud}>
                {genreNames.map((name, i) => {
                  const pillColor = GENRE_PALETTE[i % GENRE_PALETTE.length];
                  return (
                    <View
                      key={name}
                      style={[styles.genrePill, { backgroundColor: hexWithAlpha(pillColor, 0.15) }]}
                    >
                      <Text style={[styles.genrePillText, { color: pillColor }]}>{name}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Credits & details */}
          {credits.map((row) => (
            <View key={row.label} style={[styles.infoDetailRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.infoDetailLabel, { color: colors.textSecondary }]}>{row.label}</Text>
              <Text style={[styles.infoDetailValue, { color: colors.textPrimary }]} numberOfLines={2}>
                {row.value}
              </Text>
            </View>
          ))}

          {/* Album description */}
          {sanitizedNotes ? (
            <View style={styles.infoSection}>
              <Text
                style={[styles.infoNotesText, { color: colors.textPrimary }]}
                numberOfLines={notesExpanded || !needsTruncation ? undefined : 12}
                onTextLayout={(e) => {
                  if (!needsTruncation && !notesExpanded && e.nativeEvent.lines.length > 15) {
                    setNeedsTruncation(true);
                  }
                }}
              >
                {sanitizedNotes}
              </Text>
              {needsTruncation && (
                <Pressable
                  onPress={() => setNotesExpanded((prev) => !prev)}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={[styles.infoReadMore, { color: colors.primary }]}>
                    {notesExpanded ? t('showLess') : t('showMore')}
                  </Text>
                </Pressable>
              )}
              {notesAttributionUrl && (
                <Pressable
                  onPress={handleWikipedia}
                  style={({ pressed }) => [styles.infoAttribution, pressed && styles.pressed]}
                  accessibilityRole="link"
                  accessibilityLabel={t('sourceWikipedia')}
                >
                  <Text style={[styles.infoAttributionText, { color: colors.textSecondary }]}>
                    {t('sourceWikipedia')}
                  </Text>
                  <Ionicons name="open-outline" size={11} color={colors.textSecondary} style={styles.infoLinkArrow} />
                </Pressable>
              )}
            </View>
          ) : null}
        </>
      )}

      {/* External links */}
      {(albumInfo?.lastFmUrl || overrideMbid || albumInfo?.musicBrainzId || notesAttributionUrl) && (
        <View style={styles.infoLinksRow}>
          {albumInfo?.lastFmUrl && (
            <Pressable
              onPress={handleLastFm}
              accessibilityRole="link"
              accessibilityLabel={t('viewOnLastFm')}
              style={({ pressed }) => [styles.infoLinkChip, pressed && styles.pressed]}
            >
              <Ionicons name="musical-notes" size={14} color={colors.textPrimary} />
              <Text style={[styles.infoLinkText, { color: colors.textPrimary }]}>Last.fm</Text>
              <Ionicons name="open-outline" size={12} color={colors.textPrimary} style={styles.infoLinkArrow} />
            </Pressable>
          )}
          {(overrideMbid || albumInfo?.musicBrainzId) && (
            <Pressable
              onPress={handleMusicBrainz}
              accessibilityRole="link"
              accessibilityLabel={t('viewOnMusicBrainz')}
              style={({ pressed }) => [styles.infoLinkChip, pressed && styles.pressed]}
            >
              <Ionicons name="disc" size={14} color={colors.textPrimary} />
              <Text style={[styles.infoLinkText, { color: colors.textPrimary }]}>MusicBrainz</Text>
              <Ionicons name="open-outline" size={12} color={colors.textPrimary} style={styles.infoLinkArrow} />
            </Pressable>
          )}
          {notesAttributionUrl && (
            <Pressable
              onPress={handleWikipedia}
              accessibilityRole="link"
              accessibilityLabel={t('viewOnWikipedia')}
              style={({ pressed }) => [styles.infoLinkChip, pressed && styles.pressed]}
            >
              <Ionicons name="globe-outline" size={14} color={colors.textPrimary} />
              <Text style={[styles.infoLinkText, { color: colors.textPrimary }]}>Wikipedia</Text>
              <Ionicons name="open-outline" size={12} color={colors.textPrimary} style={styles.infoLinkArrow} />
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
});

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  infoScrollView: {
    flex: 1,
  },
  infoContent: {
    paddingTop: 20,
    paddingBottom: 24,
  },
  infoSection: {
    marginTop: 32,
  },

  /* Format badge */
  formatSection: {
    marginBottom: 16,
  },

  /* Quick stats */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  /* Genre pills */
  genreSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  genrePillCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genrePill: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  genrePillText: {
    fontSize: 14,
    fontWeight: '600',
  },

  /* Credits & detail rows */
  infoDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoDetailLabel: {
    fontSize: 17,
    flexShrink: 0,
  },
  infoDetailValue: {
    fontSize: 17,
    fontWeight: '500',
    marginLeft: 16,
    textAlign: 'right',
    flex: 1,
  },

  /* Album notes */
  infoNotesText: {
    fontSize: 17,
    lineHeight: 26,
  },
  infoReadMore: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  infoAttribution: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
  },
  infoAttributionText: {
    fontSize: 14,
    opacity: 0.6,
  },

  /* External links */
  infoLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 32,
  },
  infoLinkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  infoLinkText: {
    fontSize: 15,
    fontWeight: '500',
  },
  infoLinkArrow: {
    opacity: 0.6,
  },

  /* Skeleton loading */
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  skeletonBar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  skeletonLabel: {
    width: 70,
  },
  skeletonTextLine: {
    height: 14,
    marginBottom: 10,
  },
  skeletonLinksRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 32,
  },
  skeletonChip: {
    height: 28,
    borderRadius: 8,
  },

  pressed: {
    opacity: 0.6,
  },
});
