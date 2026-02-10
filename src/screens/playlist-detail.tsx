import Constants from 'expo-constants';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../hooks/useTheme';
import {
  ensureCoverArtAuth,
  getPlaylist,
  getCoverArtUrl,
  type PlaylistWithSongs,
  type Child,
} from '../services/subsonicService';

const HERO_PADDING = 24;
const HERO_COVER_SIZE = 600;
/** Approximate height of the nav header bar (below status bar). */
const HEADER_BAR_HEIGHT = 44;

/** Result shape from react-native-image-colors (Android/Web: vibrant swatches; iOS: primary). */
type ExtractedColors = {
  vibrant?: string;
  lightVibrant?: string;
  darkVibrant?: string;
  dominant?: string;
  primary?: string;
  background?: string;
  secondary?: string;
  detail?: string;
};

/** Prefer primary (iOS) then darkVibrant (Android/Web); else null for theme background. */
function getProminentColor(result: ExtractedColors): string | null {
  if (result.primary && typeof result.primary === 'string') return result.primary;
  if (result.darkVibrant && typeof result.darkVibrant === 'string') return result.darkVibrant;
  return null;
}

/** Format seconds as m:ss for individual tracks. */
function formatTrackDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format seconds as compact duration like "46m" or "1h30m". */
function formatTotalDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

function TrackRow({
  track,
  index,
  colors,
}: {
  track: Child;
  index: number;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const duration = track.duration != null ? formatTrackDuration(track.duration) : '—';
  const starred = Boolean(track.starred);
  const rating = track.userRating;
  return (
    <View style={[styles.trackRow, { borderBottomColor: colors.border }]}>
      <View style={styles.trackLeft}>
        <Text style={[styles.trackNum, { color: colors.textSecondary }]}>
          {index + 1}.{' '}
        </Text>
        <View style={styles.trackInfo}>
          <Text style={[styles.trackTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {track.title}
          </Text>
          {track.artist && (
            <Text style={[styles.trackArtist, { color: colors.textSecondary }]} numberOfLines={1}>
              {track.artist}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.trackRight}>
        {starred && (
          <Ionicons name="star" size={14} color={colors.primary} />
        )}
        {rating != null && rating > 0 && (
          <Text style={[styles.trackRating, { color: colors.textSecondary }]}>
            {rating}/5
          </Text>
        )}
        <Text style={[styles.trackDuration, { color: colors.textSecondary }]}>
          {duration}
        </Text>
      </View>
    </View>
  );
}

export function PlaylistDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<PlaylistWithSongs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coverBackgroundColor, setCoverBackgroundColor] = useState<string | null>(null);
  const gradientOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!id) {
      setError('Missing playlist id');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await ensureCoverArtAuth();
        if (cancelled) return;
        const data = await getPlaylist(id);
        if (cancelled) return;
        setPlaylist(data);
        if (!data) setError('Playlist not found');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load playlist');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Extract prominent color from cover art. Skip in Expo Go (native module required).
  useEffect(() => {
    if (!playlist?.coverArt) {
      setCoverBackgroundColor(null);
      return;
    }
    if (Constants.appOwnership === 'expo') {
      setCoverBackgroundColor(null);
      return;
    }
    const uri = getCoverArtUrl(playlist.coverArt, 50);
    if (!uri) {
      setCoverBackgroundColor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getColors } = await import('react-native-image-colors');
        const result = await getColors(uri, {
          fallback: colors.background,
          quality: 'low',
        });
        if (cancelled) return;
        const prominent = getProminentColor(result as ExtractedColors);
        setCoverBackgroundColor(prominent ?? null);
      } catch {
        if (!cancelled) setCoverBackgroundColor(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlist?.coverArt, colors.background]);

  useEffect(() => {
    if (coverBackgroundColor) {
      gradientOpacity.setValue(0);
      Animated.timing(gradientOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(gradientOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [coverBackgroundColor]);

  const gradientStart = coverBackgroundColor ?? colors.background;

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !playlist) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error ?? 'Playlist not found'}
        </Text>
      </View>
    );
  }

  const coverUri = getCoverArtUrl(playlist.coverArt ?? '', HERO_COVER_SIZE) ?? undefined;
  const gradientEnd = colors.background;
  const tracks = playlist.entry ?? [];

  const gradientFillStyle = [
    StyleSheet.absoluteFillObject,
    { top: -insets.top, left: 0, right: 0, bottom: 0 },
  ];

  return (
    <View style={styles.container}>
      <View style={[gradientFillStyle, { backgroundColor: colors.background }]} />
      <Animated.View
        style={[gradientFillStyle, { opacity: gradientOpacity }]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[gradientStart, gradientEnd]}
          locations={[0, 0.5]}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + HEADER_BAR_HEIGHT },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroImageWrap}>
            <Image
              source={{ uri: coverUri }}
              style={styles.heroImage}
              resizeMode="contain"
            />
          </View>
        </View>
        <View style={styles.info}>
          <Text style={[styles.playlistName, { color: colors.textPrimary }]}>
            {playlist.name}
          </Text>
          {playlist.owner && (
            <Text style={[styles.ownerName, { color: colors.textSecondary }]}>
              by {playlist.owner}
            </Text>
          )}
          {playlist.comment ? (
            <Text style={[styles.comment, { color: colors.textSecondary }]}>
              {playlist.comment}
            </Text>
          ) : null}
          <View style={styles.meta}>
            <Ionicons name="musical-notes-outline" size={14} color={colors.primary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {playlist.songCount} {playlist.songCount === 1 ? 'song' : 'songs'}
            </Text>
            <View style={styles.metaSpacer} />
            <Ionicons name="time-outline" size={14} color={colors.primary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {formatTotalDuration(playlist.duration)}
            </Text>
          </View>
        </View>

        {tracks.length === 0 ? (
          <Text style={[styles.emptyTracks, { color: colors.textSecondary }]}>
            No tracks
          </Text>
        ) : (
          <View style={styles.trackList}>
            {tracks.map((track, index) => (
              <TrackRow key={track.id} track={track} index={index} colors={colors} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hero: {
    width: '100%',
    paddingTop: HERO_PADDING / 2,
    paddingHorizontal: HERO_PADDING,
    paddingBottom: HERO_PADDING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImageWrap: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  info: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  playlistName: {
    fontSize: 24,
    fontWeight: '700',
  },
  ownerName: {
    fontSize: 16,
    marginTop: 4,
  },
  comment: {
    fontSize: 14,
    marginTop: 6,
    fontStyle: 'italic',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  metaText: {
    fontSize: 14,
    marginLeft: 4,
  },
  metaSpacer: {
    width: 14,
  },
  trackList: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  trackNum: {
    fontSize: 15,
    minWidth: 28,
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontSize: 16,
  },
  trackArtist: {
    fontSize: 13,
    marginTop: 2,
  },
  trackRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  trackRating: {
    fontSize: 12,
  },
  trackDuration: {
    fontSize: 15,
  },
  emptyTracks: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 16,
  },
});
