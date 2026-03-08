import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumRow } from '../components/AlbumRow';
import { ArtistCard } from '../components/ArtistCard';
import { CachedImage } from '../components/CachedImage';
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { SectionTitle } from '../components/SectionTitle';
import { SongCard } from '../components/SongCard';
import { closeOpenRow } from '../components/SwipeableRow';
import { useColorExtraction } from '../hooks/useColorExtraction';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { refreshCachedImage } from '../services/imageCacheService';
import { minDelay } from '../utils/stringHelpers';
import { playTrack } from '../services/playerService';
import { artistDetailStore } from '../store/artistDetailStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';

import {
  type AlbumID3,
  type ArtistInfo2,
  type ArtistWithAlbumsID3,
  type Child,
} from '../services/subsonicService';

const HERO_PADDING = 24;
const HERO_IMAGE_SIZE = 180;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = 44;
const CARD_WIDTH = 88;
const HORIZONTAL_GAP = 10;

/* ------------------------------------------------------------------ */
/*  Main screen                                                       */
/* ------------------------------------------------------------------ */

export function ArtistDetailScreen() {
  const { colors } = useTheme();
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const cachedEntry = artistDetailStore((s) => (id ? s.artists[id] : undefined));
  const [artist, setArtist] = useState<ArtistWithAlbumsID3 | null>(cachedEntry?.artist ?? null);
  const [artistInfo, setArtistInfo] = useState<ArtistInfo2 | null>(cachedEntry?.artistInfo ?? null);
  const [topSongs, setTopSongs] = useState<Child[]>(cachedEntry?.topSongs ?? []);
  const [biography, setBiography] = useState<string | null>(cachedEntry?.biography ?? null);
  const [loading, setLoading] = useState(!cachedEntry);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [albumSortDesc, setAlbumSortDesc] = useState(
    () => layoutPreferencesStore.getState().artistAlbumSortOrder === 'newest',
  );

  // Defer heavy sections (top songs, similar artists, albums) until the
  // navigation animation completes so the transition isn't blocked by
  // mounting dozens of CachedImage components synchronously.
  const ready = useTransitionComplete(!cachedEntry);

  const { coverBackgroundColor, gradientOpacity } = useColorExtraction(
    artist?.coverArt,
    colors.background,
  );

  // Sync local state when the store entry is updated externally (e.g. after
  // an MBID override triggers a background refetch).
  useEffect(() => {
    if (!cachedEntry) return;
    setArtist(cachedEntry.artist);
    setArtistInfo(cachedEntry.artistInfo);
    setTopSongs(cachedEntry.topSongs);
    setBiography(cachedEntry.biography);
  }, [cachedEntry]);

  /* ---- Header right: more options button ---- */
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    if (!artist) return;
    navigation.setOptions({
      headerRight: () => (
        <MoreOptionsButton
          onPress={() =>
            moreOptionsStore.getState().show({ type: 'artist', item: artist })
          }
          color={colors.textPrimary}
        />
      ),
    });
  }, [artist, navigation, colors.textPrimary]);

  /* ---- Data fetching ---- */
  const { fetchArtist } = artistDetailStore.getState();

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id) {
      setError('Missing artist id');
      if (!isRefresh) setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const delay = isRefresh ? minDelay() : null;
      const entry = await fetchArtist(id);
      if (!entry) {
        setError('Artist not found');
        setArtist(null);
        setArtistInfo(null);
        setTopSongs([]);
        setBiography(null);
      } else {
        setArtist(entry.artist);
        setArtistInfo(entry.artistInfo);
        setTopSongs(entry.topSongs);
        setBiography(entry.biography);
        if (isRefresh && entry.artist.coverArt) {
          refreshCachedImage(entry.artist.coverArt).catch(() => { /* non-critical */ });
        }
      }
      await delay;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load artist');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [id, fetchArtist]);

  // Only fetch on mount if no cached data
  useEffect(() => { if (!cachedEntry) fetchData(); }, [fetchData, cachedEntry]);

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

  /* ---- Derived values ---- */
  const gradientStart = coverBackgroundColor ?? colors.background;
  const gradientEnd = colors.background;

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

  const albums = artist?.album ?? [];
  const similarArtists = artistInfo?.similarArtist ?? [];

  const sortedAlbums = useMemo(() => {
    if (albums.length === 0) return albums;
    return [...albums].sort((a, b) => {
      const yearA = a.year ?? 0;
      const yearB = b.year ?? 0;
      return albumSortDesc ? yearB - yearA : yearA - yearB;
    });
  }, [albums, albumSortDesc]);

  const renderAlbumItem = useCallback(
    ({ item }: { item: AlbumID3 }) => (
      <View style={styles.albumRowWrap}>
        <AlbumRow album={item} />
      </View>
    ),
    [],
  );

  const albumKeyExtractor = useCallback((item: AlbumID3) => item.id, []);

  const topSongsRenderItem = useCallback(
    ({ item, index }: { item: Child; index: number }) => (
      <SongCard
        song={item}
        width={CARD_WIDTH}
        onPress={() => playTrack(item, topSongs)}
      />
    ),
    [topSongs],
  );

  const topSongsKeyExtractor = useCallback(
    (item: Child, index: number) => `${item.id}-${index}`,
    [],
  );

  const similarArtistsRenderItem = useCallback(
    ({ item }: { item: (typeof similarArtists)[number] }) => (
      <ArtistCard artist={item} width={CARD_WIDTH} />
    ),
    [],
  );

  const similarArtistsKeyExtractor = useCallback(
    (item: (typeof similarArtists)[number]) => item.id,
    [],
  );

  const listHeader = useMemo(() => {
    if (!artist) return null;
    return (
      <>
        {/* ---- Hero ---- */}
        <View style={styles.hero}>
          <CachedImage
            coverArtId={artist.coverArt}
            size={HERO_COVER_SIZE}
            fallbackUri={artistInfo?.largeImageUrl ?? undefined}
            style={styles.heroImage}
            resizeMode="cover"
          />
          <Text style={[styles.artistName, { color: colors.textPrimary }]}>
            {artist.name}
          </Text>
          <View style={styles.meta}>
            <Ionicons name="disc-outline" size={14} color={colors.primary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {artist.albumCount === 1 ? '1 album' : `${artist.albumCount} albums`}
            </Text>
          </View>
        </View>

        {/* Heavy sections deferred until after the navigation animation */}
        {ready && (
          <>
            {/* ---- Biography ---- */}
            {biography != null && biography.length > 0 && (
              <View style={styles.section}>
                <SectionTitle title="About" color={colors.label} />
                <Text
                  style={[styles.bioText, { color: colors.textSecondary }]}
                  numberOfLines={bioExpanded ? undefined : 4}
                >
                  {biography}
                </Text>
                <Pressable
                  onPress={() => setBioExpanded((prev) => !prev)}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={[styles.bioToggle, { color: colors.primary }]}>
                    {bioExpanded ? 'Show less' : 'Read more'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ---- Top Songs ---- */}
            {topSongs.length > 0 && (
              <View style={styles.section}>
                <SectionTitle title="Top Songs" color={colors.label} />
                <FlashList
                  data={topSongs}
                  renderItem={topSongsRenderItem}
                  keyExtractor={topSongsKeyExtractor}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                  ItemSeparatorComponent={() => (
                    <View style={{ width: HORIZONTAL_GAP }} />
                  )}
                />
              </View>
            )}

            {/* ---- Similar Artists ---- */}
            {similarArtists.length > 0 && (
              <View style={styles.section}>
                <SectionTitle title="Similar Artists" color={colors.label} />
                <FlashList
                  data={similarArtists}
                  renderItem={similarArtistsRenderItem}
                  keyExtractor={similarArtistsKeyExtractor}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                  ItemSeparatorComponent={() => (
                    <View style={{ width: HORIZONTAL_GAP }} />
                  )}
                />
              </View>
            )}

            {/* ---- Albums section header (list items follow in FlashList) ---- */}
            {albums.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <SectionTitle title="Albums" color={colors.label} />
                  <Pressable
                    onPress={() => setAlbumSortDesc((prev) => !prev)}
                    style={({ pressed }) => [
                      styles.sortButton,
                      pressed && styles.pressed,
                    ]}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={albumSortDesc ? 'arrow-down' : 'arrow-up'}
                      size={14}
                      color={colors.primary}
                    />
                    <Text style={[styles.sortLabel, { color: colors.textPrimary }]}>
                      {albumSortDesc ? 'Newest' : 'Oldest'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </>
        )}
      </>
    );
  }, [
    artist,
    artistInfo,
    ready,
    biography,
    bioExpanded,
    topSongs,
    similarArtists,
    albums.length,
    albumSortDesc,
    colors.textPrimary,
    colors.textSecondary,
    colors.label,
    colors.primary,
    topSongsRenderItem,
    topSongsKeyExtractor,
    similarArtistsRenderItem,
    similarArtistsKeyExtractor,
  ]);

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  /* ---- Error state ---- */
  if (error || !artist) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error ?? 'Artist not found'}
        </Text>
      </View>
    );
  }

  const gradientFillStyle = [
    StyleSheet.absoluteFillObject,
    { top: -insets.top, left: 0, right: 0, bottom: 0 },
  ];

  return (
    <>
      {Platform.OS === 'ios' && artist && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="ellipsis"
            onPress={() => moreOptionsStore.getState().show({ type: 'artist', item: artist })}
          />
        </Stack.Toolbar>
      )}
      <View style={styles.container}>
        {/* Background layers */}
        <View style={[gradientFillStyle, { backgroundColor: colors.background }]} />
        <Animated.View
          style={[gradientFillStyle, gradientAnimatedStyle]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={[gradientStart, gradientEnd]}
            locations={[0, 0.5]}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        <FlashList
          data={sortedAlbums}
          renderItem={renderAlbumItem}
          keyExtractor={albumKeyExtractor}
          ListHeaderComponent={listHeader}
          onScrollBeginDrag={closeOpenRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            Platform.OS !== 'ios' && {
              paddingTop: insets.top + HEADER_BAR_HEIGHT,
            },
          ]}
          contentInset={
            Platform.OS === 'ios'
              ? { top: insets.top + HEADER_BAR_HEIGHT }
              : undefined
          }
          contentOffset={
            Platform.OS === 'ios'
              ? { x: 0, y: -(insets.top + HEADER_BAR_HEIGHT) }
              : undefined
          }
          refreshControl={
            offlineMode ? undefined : (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                progressViewOffset={insets.top + HEADER_BAR_HEIGHT}
              />
            )
          }
        />
      </View>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
  },
  pressed: {
    opacity: 0.8,
  },

  /* Hero */
  hero: {
    width: '100%',
    paddingTop: HERO_PADDING / 2,
    paddingBottom: HERO_PADDING,
    alignItems: 'center',
  },
  heroImage: {
    width: HERO_IMAGE_SIZE,
    height: HERO_IMAGE_SIZE,
    borderRadius: HERO_IMAGE_SIZE / 2,
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  artistName: {
    fontSize: 26,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  metaText: {
    fontSize: 14,
    marginLeft: 4,
  },

  /* Sections */
  section: {
    paddingHorizontal: 16,
    marginTop: 20,
  },

  /* Biography */
  bioText: {
    fontSize: 15,
    lineHeight: 22,
  },
  bioToggle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },

  /* Album list */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    marginBottom: 10,
    gap: 4,
  },
  sortLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  albumRowWrap: {
    paddingHorizontal: 16,
  },

  /* Horizontal card lists (Top Songs / Similar Artists) */
  horizontalList: {
    paddingRight: 16,
  },
});
