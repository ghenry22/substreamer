/**
 * AlbumInfoContent — shared album info panel used by both the phone player
 * and tablet expanded player views.
 *
 * Displays: format badge, quick stats (year, play count, BPM), genre pills,
 * credits rows, album description with expand/collapse, skeleton loading
 * state, and external links (Last.fm, MusicBrainz, Wikipedia).
 */

import { FontAwesome5, Ionicons } from '@expo/vector-icons';
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
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

import { FormatBadge } from './FormatBadge';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { type Child } from '../services/subsonicService';
import { hexWithAlpha } from '../utils/colors';
import { getEffectiveFormat } from '../utils/effectiveFormat';
import { getGenreNames } from '../utils/genreHelpers';
import { timeAgo } from '../utils/stringHelpers';
import { VIZ_PALETTE } from '../constants/vizColors';

/* ------------------------------------------------------------------ */
/*  Genre pill palette (matches GenreChart)                            */
/* ------------------------------------------------------------------ */


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
  /** Last fetch error for this album, if any. */
  albumInfoError?: 'timeout' | 'error' | null;
  /** Called when the user taps Retry after an error. */
  onRetry?: () => void;
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
  albumInfoError,
  onRetry,
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

  // Build inline metadata phrases
  const metaPhrases = useMemo(() => {
    const phrases: string[] = [];
    if (track.year) {
      phrases.push(String(track.year));
    }
    if (track.playCount != null) {
      phrases.push(
        track.playCount > 0
          ? t('metaPlayCount', { count: track.playCount })
          : t('metaNotPlayed'),
      );
    }
    if (track.bpm) {
      phrases.push(t('metaBpm', { value: track.bpm }));
    }
    if (track.played) {
      const d = typeof track.played === 'string' ? new Date(track.played) : track.played;
      phrases.push(t('metaLastPlayed', { time: timeAgo(d.getTime(), t) }));
    }
    if (track.created) {
      const d = typeof track.created === 'string' ? new Date(track.created) : track.created;
      phrases.push(t('metaAdded', { date: d.toLocaleDateString(i18next.language, { year: 'numeric', month: 'short' }) }));
    }
    return phrases;
  }, [track, t]);

  // Build credit rows (album artist if different, composer)
  const credits = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
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
      {albumInfoError && !albumInfoLoading && !refreshing ? (
        <View style={styles.errorBlock}>
          <Ionicons
            name="cloud-offline-outline"
            size={36}
            color={colors.textSecondary}
            style={styles.errorIcon}
          />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {albumInfoError === 'timeout'
              ? t('albumInfoTimedOut')
              : t('albumInfoFailedToLoad')}
          </Text>
          {onRetry && (
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={t('retry')}
              style={({ pressed }) => [
                styles.retryButton,
                { borderColor: hexWithAlpha(colors.border, 0.5) },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.retryButtonText, { color: colors.textPrimary }]}>
                {t('retry')}
              </Text>
            </Pressable>
          )}
        </View>
      ) : (albumInfoLoading || refreshing) ? (
        /* Skeleton placeholder — mirrors the real layout */
        (() => {
          // Theme-aware skeleton fill: derives from `textSecondary` so light
          // mode gets a dark-gray bar (visible on white) and dark mode gets
          // a light-gray bar (visible on black). The hardcoded white-alpha
          // previously used was invisible on light backgrounds.
          const skeletonFill = { backgroundColor: hexWithAlpha(colors.textSecondary, 0.2) };
          return (
            <View>
              {/* Hero block */}
              <View style={styles.heroBlock}>
                <View style={[styles.skeletonBar, styles.skeletonAlbumTitle, skeletonFill]} />
                <View style={[styles.skeletonBar, styles.skeletonArtistSubtitle, skeletonFill]} />
                <View style={[styles.skeletonBar, styles.skeletonFormatBadge, skeletonFill]} />
                <View style={styles.skeletonGenrePillRow}>
                  {[72, 96, 60, 84].map((w, i) => (
                    <View key={i} style={[styles.skeletonBar, styles.skeletonGenrePill, skeletonFill, { width: w }]} />
                  ))}
                </View>
              </View>

              {/* Inline metadata strip */}
              <View style={[styles.skeletonBar, styles.skeletonMetaStrip, skeletonFill]} />

              {/* Description */}
              <View style={[styles.divider, { backgroundColor: colors.textSecondary }]} />
              <View style={styles.descriptionSection}>
                {[1, 0.97, 1, 0.95, 0.98, 1, 0.93, 0.96, 1, 0.6].map((w, i) => (
                  <View
                    key={i}
                    style={[styles.skeletonBar, styles.skeletonTextLine, skeletonFill, { width: `${w * 100}%` }]}
                  />
                ))}
              </View>

              {/* External links */}
              <View style={[styles.divider, { backgroundColor: colors.textSecondary }]} />
              <View style={styles.skeletonLinksRow}>
                {[90, 110, 95].map((w, i) => (
                  <View key={i} style={[styles.skeletonBar, styles.skeletonChip, skeletonFill, { width: w }]} />
                ))}
              </View>
            </View>
          );
        })()
      ) : (
        <>
          {/* ── Hero header block (centered) ── */}
          <View style={styles.heroBlock}>
            {/* Album & artist */}
            {track.album && (
              <Text style={[styles.albumTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                {track.album}
              </Text>
            )}
            {track.artist && (
              <Text style={[styles.artistSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {track.artist}
              </Text>
            )}

            {/* Format badge */}
            {effectiveFormat && (
              <View style={styles.formatBadgeWrap}>
                <FormatBadge format={effectiveFormat} textColor={colors.textPrimary} />
              </View>
            )}

            {/* Genre pills */}
            {genreNames.length > 0 && (
              <View style={styles.genrePillCloud}>
                {genreNames.map((name, i) => {
                  const pillColor = VIZ_PALETTE[i % VIZ_PALETTE.length];
                  return (
                    <View
                      key={name}
                      style={[styles.genrePill, { backgroundColor: hexWithAlpha(pillColor, 0.35) }]}
                    >
                      <Text style={[styles.genrePillText, { color: colors.textPrimary }]}>{name}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── Inline metadata strip ── */}
          {metaPhrases.length > 0 && (
            <Text style={[styles.metaStrip, { color: colors.textSecondary }]}>
              {metaPhrases.join('  ·  ')}
            </Text>
          )}

          {/* ── Credits (only if present) ── */}
          {credits.length > 0 && (
            <View style={styles.creditsSection}>
              <View style={[styles.divider, { backgroundColor: colors.textSecondary }]} />
              {credits.map((row) => (
                <View key={row.label} style={styles.creditRow}>
                  <Text style={[styles.creditLabel, { color: colors.textSecondary }]}>{row.label}</Text>
                  <Text style={[styles.creditValue, { color: colors.textPrimary }]} numberOfLines={2}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Album description ── */}
          {sanitizedNotes ? (
            <View style={styles.descriptionSection}>
              <View style={[styles.divider, { backgroundColor: colors.textSecondary }]} />
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

      {/* ── External links (centered) ── */}
      {(albumInfo?.lastFmUrl || overrideMbid || albumInfo?.musicBrainzId || notesAttributionUrl) && (
        <View>
          <View style={[styles.divider, { backgroundColor: colors.textSecondary }]} />
        <View style={styles.infoLinksRow}>
          {albumInfo?.lastFmUrl && (
            <Pressable
              onPress={handleLastFm}
              accessibilityRole="link"
              accessibilityLabel={t('viewOnLastFm')}
              style={({ pressed }) => [styles.infoLinkChip, { borderColor: hexWithAlpha(colors.border, 0.5) }, pressed && styles.pressed]}
            >
              <FontAwesome5 name="lastfm" size={14} color={colors.textPrimary} />
              <Text style={[styles.infoLinkText, { color: colors.textPrimary }]}>Last.fm</Text>
              <Ionicons name="open-outline" size={12} color={colors.textPrimary} style={styles.infoLinkArrow} />
            </Pressable>
          )}
          {(overrideMbid || albumInfo?.musicBrainzId) && (
            <Pressable
              onPress={handleMusicBrainz}
              accessibilityRole="link"
              accessibilityLabel={t('viewOnMusicBrainz')}
              style={({ pressed }) => [styles.infoLinkChip, { borderColor: hexWithAlpha(colors.border, 0.5) }, pressed && styles.pressed]}
            >
              <Ionicons name="finger-print-outline" size={14} color={colors.textPrimary} />
              <Text style={[styles.infoLinkText, { color: colors.textPrimary }]}>MusicBrainz</Text>
              <Ionicons name="open-outline" size={12} color={colors.textPrimary} style={styles.infoLinkArrow} />
            </Pressable>
          )}
          {notesAttributionUrl && (
            <Pressable
              onPress={handleWikipedia}
              accessibilityRole="link"
              accessibilityLabel={t('viewOnWikipedia')}
              style={({ pressed }) => [styles.infoLinkChip, { borderColor: hexWithAlpha(colors.border, 0.5) }, pressed && styles.pressed]}
            >
              <FontAwesome5 name="wikipedia-w" size={14} color={colors.textPrimary} />
              <Text style={[styles.infoLinkText, { color: colors.textPrimary }]}>Wikipedia</Text>
              <Ionicons name="open-outline" size={12} color={colors.textPrimary} style={styles.infoLinkArrow} />
            </Pressable>
          )}
        </View>
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

  /* Hero header block (centered) */
  heroBlock: {
    alignItems: 'center',
    marginBottom: 20,
    gap: 16,
  },
  albumTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  artistSubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  formatBadgeWrap: {
  },
  genrePillCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
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

  /* Inline metadata strip */
  metaStrip: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 20,
  },

  /* Divider */
  divider: {
    height: 1,
    opacity: 0.3,
    marginVertical: 10,
  },

  /* Credits */
  creditsSection: {
    marginBottom: 4,
  },
  creditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  creditLabel: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 0,
    marginRight: 12,
  },
  creditValue: {
    fontSize: 14,
    fontWeight: '400',
    flexShrink: 1,
    textAlign: 'right',
  },

  /* Album description */
  descriptionSection: {
    marginBottom: 4,
  },
  infoNotesText: {
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'justify' as const,
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

  /* External links (centered) */
  infoLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
  },
  infoLinkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoLinkText: {
    fontSize: 16,
    fontWeight: '500',
  },
  infoLinkArrow: {
    opacity: 0.6,
  },

  /* Skeleton loading — `backgroundColor` is applied inline per theme at
     render time (see `skeletonFill`) so bars are visible on both light
     and dark backgrounds. */
  skeletonBar: {
    height: 12,
    borderRadius: 6,
  },
  skeletonAlbumTitle: {
    width: '65%',
    height: 18,
    borderRadius: 9,
  },
  skeletonArtistSubtitle: {
    width: '40%',
    height: 14,
    borderRadius: 7,
  },
  skeletonFormatBadge: {
    width: 90,
    height: 22,
    borderRadius: 11,
  },
  skeletonGenrePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  skeletonGenrePill: {
    height: 24,
    borderRadius: 12,
  },
  skeletonMetaStrip: {
    alignSelf: 'center',
    width: '70%',
    height: 12,
    marginBottom: 8,
  },
  skeletonTextLine: {
    height: 14,
    marginBottom: 10,
  },
  skeletonLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
  },
  skeletonChip: {
    height: 30,
    borderRadius: 8,
  },

  pressed: {
    opacity: 0.6,
  },

  /* Error state */
  errorBlock: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 12,
  },
  errorIcon: {
    marginBottom: 4,
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
