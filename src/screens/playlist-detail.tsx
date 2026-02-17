import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  InteractionManager,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CachedImage } from '../components/CachedImage';
import { closeOpenRow } from '../components/SwipeableRow';
import { TrackRow } from '../components/TrackRow';
import { useColorExtraction } from '../hooks/useColorExtraction';
import { useTheme } from '../hooks/useTheme';
import { refreshCachedImage } from '../services/imageCacheService';
import { playTrack } from '../services/playerService';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { formatCompactDuration } from '../utils/formatters';

import { type Child, type PlaylistWithSongs } from '../services/subsonicService';

const HERO_PADDING = 24;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = 44;

export function PlaylistDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cachedEntry = playlistDetailStore((s) => (id ? s.playlists[id] : undefined));
  const [playlist, setPlaylist] = useState<PlaylistWithSongs | null>(cachedEntry?.playlist ?? null);
  const [loading, setLoading] = useState(!cachedEntry);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitionComplete, setTransitionComplete] = useState(false);

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setTransitionComplete(true);
    });
    return () => handle.cancel();
  }, []);

  const { coverBackgroundColor, gradientOpacity } = useColorExtraction(
    playlist?.coverArt,
    colors.background,
  );

  /* ---- Data fetching ---- */
  const { fetchPlaylist } = playlistDetailStore.getState();

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
      const data = await fetchPlaylist(id);
      setPlaylist(data);
      if (!data) setError('Playlist not found');
      if (isRefresh && data?.coverArt) {
        refreshCachedImage(data.coverArt).catch(() => {});
      }
      await minDelay;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load playlist');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [id, fetchPlaylist]);

  // Only fetch on mount if no cached data
  useEffect(() => { if (!cachedEntry) fetchData(); }, [fetchData, cachedEntry]);

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

  const tracks = useMemo(() => playlist?.entry ?? [], [playlist?.entry]);

  const renderItem = useCallback(
    ({ item, index }: { item: Child; index: number }) => (
      <View style={styles.trackItemWrap}>
        <TrackRow
          track={item}
          trackNumber={`${index + 1}. `}
          colors={colors}
          onPress={() => playTrack(item, tracks)}
        />
      </View>
    ),
    [colors, tracks],
  );

  const keyExtractor = useCallback(
    (item: Child, index: number) => `${item.id}-${index}`,
    [],
  );

  const listHeader = useMemo(() => {
    if (!playlist) return null;
    return (
      <>
        <View style={styles.hero}>
          <View style={styles.heroImageWrap}>
            <CachedImage
              coverArtId={playlist.coverArt}
              size={HERO_COVER_SIZE}
              style={styles.heroImage}
              resizeMode="contain"
            />
          </View>
        </View>
        <View style={styles.info}>
          <View style={styles.infoText}>
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
          {tracks.length > 0 && (
            <Pressable
              onPress={() => playTrack(tracks[0], tracks)}
              style={({ pressed }) => [
                styles.playAllButton,
                { backgroundColor: colors.primary },
                pressed && styles.playAllButtonPressed,
              ]}
            >
              <Ionicons name="play" size={28} color="#fff" style={styles.playAllIcon} />
            </Pressable>
          )}
        </View>
        <View style={styles.trackListSpacer} />
      </>
    );
  }, [playlist, colors, tracks]);

  const listEmpty = useMemo(
    () => (
      <Text style={[styles.emptyTracks, { color: colors.textSecondary }]}>
        No tracks
      </Text>
    ),
    [colors.textSecondary],
  );

  const gradientStart = coverBackgroundColor ?? colors.background;

  if (loading || !transitionComplete) {
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

  const gradientEnd = colors.background;

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
      <FlashList
        data={tracks}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        onScrollBeginDrag={closeOpenRow}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 32,
          ...(Platform.OS !== 'ios' ? { paddingTop: insets.top + HEADER_BAR_HEIGHT } : undefined),
        }}
        contentInset={Platform.OS === 'ios' ? { top: insets.top + HEADER_BAR_HEIGHT } : undefined}
        contentOffset={Platform.OS === 'ios' ? { x: 0, y: -(insets.top + HEADER_BAR_HEIGHT) } : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            progressViewOffset={insets.top + HEADER_BAR_HEIGHT}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    backgroundColor: 'rgba(128,128,128,0.12)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  infoText: {
    flex: 1,
  },
  playAllButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  playAllButtonPressed: {
    opacity: 0.7,
  },
  playAllIcon: {
    marginLeft: 3,
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
  trackItemWrap: {
    paddingHorizontal: 16,
  },
  trackListSpacer: {
    height: 16,
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
