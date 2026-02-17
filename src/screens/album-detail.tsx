import { useLocalSearchParams, useNavigation } from 'expo-router';
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
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { closeOpenRow } from '../components/SwipeableRow';
import { TrackRow } from '../components/TrackRow';
import { useColorExtraction } from '../hooks/useColorExtraction';
import { useTheme } from '../hooks/useTheme';
import { refreshCachedImage } from '../services/imageCacheService';
import { playTrack } from '../services/playerService';
import { albumDetailStore } from '../store/albumDetailStore';
import { moreOptionsStore } from '../store/moreOptionsStore';

import type { AlbumWithSongsID3, Child } from '../services/subsonicService';

const HERO_PADDING = 24;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = 44;

type AlbumListItem =
  | { type: 'disc-header'; discNumber: number }
  | { type: 'track'; track: Child };

function groupTracksByDisc(songs: Child[]): Map<number, Child[]> {
  const sorted = [...songs].sort((a, b) => {
    const discA = a.discNumber ?? 1;
    const discB = b.discNumber ?? 1;
    if (discA !== discB) return discA - discB;
    return (a.track ?? 0) - (b.track ?? 0);
  });
  const map = new Map<number, Child[]>();
  for (const s of sorted) {
    const disc = s.discNumber ?? 1;
    if (!map.has(disc)) map.set(disc, []);
    map.get(disc)!.push(s);
  }
  return map;
}

export function AlbumDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cachedEntry = albumDetailStore((s) => (id ? s.albums[id] : undefined));
  const [album, setAlbum] = useState<AlbumWithSongsID3 | null>(cachedEntry?.album ?? null);
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
    album?.coverArt,
    colors.background,
  );

  /* ---- Header right: more options button ---- */
  useEffect(() => {
    if (!album) return;
    navigation.setOptions({
      headerRight: () => (
        <MoreOptionsButton
          onPress={() =>
            moreOptionsStore.getState().show({ type: 'album', item: album })
          }
          color={colors.textPrimary}
        />
      ),
    });
  }, [album, navigation, colors.textPrimary]);

  /* ---- Data fetching ---- */
  const { fetchAlbum } = albumDetailStore.getState();

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id) {
      setError('Missing album id');
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
      const data = await fetchAlbum(id);
      setAlbum(data);
      if (!data) setError('Album not found');
      if (isRefresh && data?.coverArt) {
        refreshCachedImage(data.coverArt).catch(() => {});
      }
      await minDelay;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load album');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [id, fetchAlbum]);

  // Only fetch on mount if no cached data
  useEffect(() => { if (!cachedEntry) fetchData(); }, [fetchData, cachedEntry]);

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

  const allSongs = useMemo(() => album?.song ?? [], [album?.song]);

  const listData = useMemo(() => {
    if (!allSongs.length) return [];
    const discs = groupTracksByDisc(allSongs);
    const hasMultipleDiscs = discs.size > 1;
    const items: AlbumListItem[] = [];
    for (const [discNum, tracks] of discs.entries()) {
      if (hasMultipleDiscs) {
        items.push({ type: 'disc-header', discNumber: discNum });
      }
      for (const track of tracks) {
        items.push({ type: 'track', track });
      }
    }
    return items;
  }, [allSongs]);

  const renderItem = useCallback(
    ({ item, index }: { item: AlbumListItem; index: number }) => {
      if (item.type === 'disc-header') {
        return (
          <View style={[styles.discHeaderWrap, index > 0 && styles.discHeaderGap]}>
            <Text style={[styles.discTitle, { color: colors.label }]}>
              Disc {item.discNumber}
            </Text>
          </View>
        );
      }
      return (
        <View style={styles.trackItemWrap}>
          <TrackRow
            track={item.track}
            trackNumber={item.track.track != null ? `${item.track.track}. ` : undefined}
            colors={colors}
            onPress={() => playTrack(item.track, allSongs)}
          />
        </View>
      );
    },
    [colors, allSongs],
  );

  const keyExtractor = useCallback(
    (item: AlbumListItem, index: number) =>
      item.type === 'disc-header' ? `disc-${item.discNumber}` : `${item.track.id}-${index}`,
    [],
  );

  const getItemType = useCallback(
    (item: AlbumListItem) => item.type,
    [],
  );

  const listHeader = useMemo(() => {
    if (!album) return null;
    return (
      <>
        <View style={styles.hero}>
          <View style={styles.heroImageWrap}>
            <CachedImage
              coverArtId={album.coverArt}
              size={HERO_COVER_SIZE}
              style={styles.heroImage}
              resizeMode="contain"
            />
          </View>
        </View>
        <View style={styles.info}>
          <View style={styles.infoText}>
            <Text style={[styles.albumName, { color: colors.textPrimary }]}>
              {album.name}
            </Text>
            <Text style={[styles.artistName, { color: colors.textSecondary }]}>
              {album.artist ?? album.displayArtist ?? 'Unknown Artist'}
            </Text>
            {album.year ? (
              <Text style={[styles.albumYear, { color: colors.textSecondary }]}>
                {album.year}
              </Text>
            ) : null}
          </View>
          {allSongs.length > 0 && (
            <Pressable
              onPress={() => playTrack(allSongs[0], allSongs)}
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
  }, [album, colors, allSongs]);

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

  if (error || !album) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error ?? 'Album not found'}
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
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
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
  albumName: {
    fontSize: 24,
    fontWeight: '700',
  },
  albumYear: {
    fontSize: 16,
    fontWeight: '400',
    marginTop: 4,
  },
  artistName: {
    fontSize: 16,
    marginTop: 4,
  },
  trackItemWrap: {
    paddingHorizontal: 16,
  },
  discHeaderWrap: {
    paddingHorizontal: 16,
  },
  discHeaderGap: {
    marginTop: 24,
  },
  trackListSpacer: {
    height: 16,
  },
  discTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
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
