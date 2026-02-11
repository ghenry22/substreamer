import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrackRow } from '../components/TrackRow';
import { useColorExtraction } from '../hooks/useColorExtraction';
import { useTheme } from '../hooks/useTheme';
import {
  ensureCoverArtAuth,
  getPlaylist,
  getCoverArtUrl,
  type PlaylistWithSongs,
} from '../services/subsonicService';
import { formatCompactDuration } from '../utils/formatters';

const HERO_PADDING = 24;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = 44;

export function PlaylistDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<PlaylistWithSongs | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { coverBackgroundColor, gradientOpacity } = useColorExtraction(
    playlist?.coverArt,
    colors.background,
  );

  /* ---- Data fetching ---- */
  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id) {
      setError('Missing playlist id');
      if (!isRefresh) setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const minDelay = isRefresh
        ? new Promise((resolve) => setTimeout(resolve, 2000))
        : null;
      await ensureCoverArtAuth();
      const data = await getPlaylist(id);
      setPlaylist(data);
      if (!data) setError('Playlist not found');
      await minDelay;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load playlist');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

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
          Platform.OS !== 'ios' && { paddingTop: insets.top + HEADER_BAR_HEIGHT },
        ]}
        contentInset={Platform.OS === 'ios' ? { top: insets.top + HEADER_BAR_HEIGHT } : undefined}
        contentOffset={Platform.OS === 'ios' ? { x: 0, y: -(insets.top + HEADER_BAR_HEIGHT) } : undefined}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            progressViewOffset={insets.top + HEADER_BAR_HEIGHT}
          />
        }
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
              {formatCompactDuration(playlist.duration)}
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
              <TrackRow
                key={track.id}
                track={track}
                trackNumber={`${index + 1}. `}
                showArtist
                colors={colors}
              />
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
