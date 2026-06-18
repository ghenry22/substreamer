import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { LIST_DRAW_DISTANCE } from '../constants/layout';
import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumRow } from '../components/AlbumRow';
import { EmptyState } from '../components/EmptyState';
import { ArtistCard } from '../components/ArtistCard';
import { CachedImage } from '../components/CachedImage';
import { BottomChrome } from '../components/BottomChrome';
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { SectionTitle } from '../components/SectionTitle';
import { SongCard } from '../components/SongCard';
import { closeOpenRow } from '../components/SwipeableRow';
import { DetailScreenBackground } from '../components/DetailScreenBackground';
import { PlayAllButton, ShufflePlayButton } from '../components/DetailHeroButtons';
import { useDetailFetch } from '../hooks/useDetailFetch';
import { useIsStarred } from '../hooks/useIsStarred';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { refreshCoverArt } from '../services/imageCacheService';
import { PillToggle } from '../components/PillToggle';
import { playAllByArtist, playMoreByArtist, toggleStar } from '../services/moreOptionsService';
import { shuffleArray } from '../utils/arrayHelpers';
import { playTrack } from '../services/playerService';
import { artistDetailStore } from '../store/artistDetailStore';
import { layoutPreferencesStore, LIST_LENGTH_DISPLAY_CAP } from '../store/layoutPreferencesStore';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playbackSettingsStore, type ArtistPlayMode } from '../store/playbackSettingsStore';

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
  const { t } = useTranslation();
  const { colors } = useTheme();
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const artistPlayMode = playbackSettingsStore((s) => s.artistPlayMode);
  const { width: screenWidth } = useWindowDimensions();
  const heroImageSize = Math.min(Math.max(HERO_IMAGE_SIZE, screenWidth * 0.35), 280);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const starred = useIsStarred('artist', id ?? '');

  const handleToggleStar = useCallback(() => {
    if (id) toggleStar('artist', id);
  }, [id]);

  const cachedEntry = artistDetailStore((s) => (id ? s.artists[id] : undefined));
  const [artist, setArtist] = useState<ArtistWithAlbumsID3 | null>(cachedEntry?.artist ?? null);
  const [artistInfo, setArtistInfo] = useState<ArtistInfo2 | null>(cachedEntry?.artistInfo ?? null);
  const [topSongs, setTopSongs] = useState<Child[]>(cachedEntry?.topSongs ?? []);
  const [biography, setBiography] = useState<string | null>(cachedEntry?.biography ?? null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [albumSortDesc, setAlbumSortDesc] = useState(
    () => layoutPreferencesStore.getState().artistAlbumSortOrder === 'newest',
  );

  // Defer heavy sections (top songs, similar artists, albums) until the
  // navigation animation completes so the transition isn't blocked by
  // mounting dozens of CachedImage components synchronously.
  const ready = useTransitionComplete(!cachedEntry);
  const isWide = useLayoutMode() === 'wide';
  const refreshControlKey = useRefreshControlKey();

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
        <View style={styles.headerRight}>
          {!offlineMode && (
            <Pressable onPress={handleToggleStar} hitSlop={8} style={styles.starButton}>
              <Ionicons
                name={starred ? 'heart' : 'heart-outline'}
                size={22}
                color={starred ? colors.red : colors.textPrimary}
              />
            </Pressable>
          )}
          <MoreOptionsButton
            onPress={() =>
              moreOptionsStore.getState().show({ type: 'artist', item: artist })
            }
            color={colors.textPrimary}
          />
        </View>
      ),
    });
  }, [artist, navigation, colors.textPrimary, colors.red, starred, offlineMode, handleToggleStar]);

  /* ---- Data fetching ---- */
  const { fetchArtist } = artistDetailStore.getState();

  const load = useCallback(async (artistId: string, isRefresh: boolean) => {
    const entry = await fetchArtist(artistId);
    if (!entry) {
      setArtist(null);
      setArtistInfo(null);
      setTopSongs([]);
      setBiography(null);
      return t('artistNotFound');
    }
    setArtist(entry.artist);
    setArtistInfo(entry.artistInfo);
    setTopSongs(entry.topSongs);
    setBiography(entry.biography);
    if (isRefresh && entry.artist.id) {
      refreshCoverArt(entry.artist.id, 'artist-detail-pull').catch(() => { /* non-critical */ });
    }
    return null;
  }, [fetchArtist, t]);

  const { loading, refreshing, error, onRefresh } = useDetailFetch({
    id,
    hasCache: !!cachedEntry,
    missingIdMessage: t('missingArtistId'),
    failedMessage: t('failedToLoadArtist'),
    load,
  });

  /* ---- Derived values ---- */
  const albums = artist?.album ?? [];
  // Deduplicate by id — some backends (e.g. Navidrome) can return the same
  // artist multiple times in similarArtist, which causes visible gaps when
  // FlashList allocates space for the duplicate but React skips rendering it.
  const similarArtists = useMemo(() => {
    const seen = new Set<string>();
    return (artistInfo?.similarArtist ?? []).filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [artistInfo?.similarArtist]);

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
    ({ item }: { item: Child }) => (
      <SongCard
        song={item}
        width={CARD_WIDTH}
        songs={topSongs}
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

  const playModeOptions = useMemo(
    (): [{ key: ArtistPlayMode; label: string }, { key: ArtistPlayMode; label: string }] => [
      { key: 'topSongs', label: t('topSongs') },
      { key: 'allSongs', label: t('allSongs') },
    ],
    [t],
  );

  const handlePlayModeChange = useCallback((mode: ArtistPlayMode) => {
    playbackSettingsStore.getState().setArtistPlayMode(mode);
  }, []);

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
            style={[styles.heroImage, { width: heroImageSize, height: heroImageSize, borderRadius: heroImageSize / 2 }]}
            resizeMode="cover"
          />
          <Text style={[styles.artistName, { color: colors.textPrimary }]}>
            {artist.name}
          </Text>
          <View style={styles.meta}>
            <Ionicons name="disc-outline" size={14} color={colors.primary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {t('albumCount', { count: artist.albumCount ?? 0 })}
            </Text>
          </View>
        </View>
        <View style={styles.heroButtons}>
          {topSongs.length > 0 && (
            <PillToggle
              options={playModeOptions}
              selected={artistPlayMode}
              onSelect={handlePlayModeChange}
              colors={colors}
            />
          )}
          <View style={styles.heroPlayButtons}>
            <ShufflePlayButton
              onPress={() => {
                if (artistPlayMode === 'allSongs') {
                  playAllByArtist(artist.id, artist.name, true);
                } else if (topSongs.length > 1) {
                  const shuffled = shuffleArray(topSongs);
                  playTrack(shuffled[0], shuffled);
                } else {
                  playMoreByArtist(artist.id, artist.name);
                }
              }}
            />
            <PlayAllButton
              onPress={() => {
                if (artistPlayMode === 'allSongs') {
                  playAllByArtist(artist.id, artist.name, false);
                } else if (topSongs.length > 0) {
                  playTrack(topSongs[0], topSongs);
                } else {
                  playMoreByArtist(artist.id, artist.name);
                }
              }}
            />
          </View>
        </View>

        {/* Heavy sections deferred until after the navigation animation */}
        {ready && (
          <>
            {/* ---- Biography ---- */}
            {biography != null && biography.length > 0 && (
              <View style={styles.section}>
                <SectionTitle title={t('about')} color={colors.label} />
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
                    {bioExpanded ? t('showLess') : t('readMore')}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ---- Top Songs ---- */}
            {topSongs.length > 0 && (
              <View style={styles.section}>
                <SectionTitle title={t('topSongs')} color={colors.label} />
                <FlashList
                  data={topSongs.slice(0, LIST_LENGTH_DISPLAY_CAP)}
                  renderItem={topSongsRenderItem}
                  keyExtractor={topSongsKeyExtractor}
                  drawDistance={LIST_DRAW_DISTANCE}
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
                <SectionTitle title={t('similarArtists')} color={colors.label} />
                <FlashList
                  data={similarArtists}
                  renderItem={similarArtistsRenderItem}
                  keyExtractor={similarArtistsKeyExtractor}
                  drawDistance={LIST_DRAW_DISTANCE}
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
                  <SectionTitle title={t('albums')} color={colors.label} />
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
                      {albumSortDesc ? t('newest') : t('oldest')}
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
    heroImageSize,
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
    artistPlayMode,
    playModeOptions,
    handlePlayModeChange,
    t,
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
        <EmptyState
          icon="person-outline"
          title={t('couldntLoadArtist')}
          subtitle={`${t('loadArtistError')}\n\n${error ?? t('unknownError')}`}
        />
      </View>
    );
  }

  return (
    <>
      {Platform.OS === 'ios' && artist && (
        <Stack.Toolbar placement="right">
          {!offlineMode && (
            <Stack.Toolbar.Button
              icon={starred ? 'heart.fill' : 'heart'}
              onPress={handleToggleStar}
              tintColor={starred ? colors.red : undefined}
            />
          )}
          <Stack.Toolbar.Button
            icon="ellipsis"
            onPress={() => moreOptionsStore.getState().show({ type: 'artist', item: artist })}
          />
        </Stack.Toolbar>
      )}
      <View style={styles.container}>
        <DetailScreenBackground coverArt={artist?.coverArt} isWide={isWide} />

        <FlashList
          data={sortedAlbums}
          renderItem={renderAlbumItem}
          keyExtractor={albumKeyExtractor}
          drawDistance={LIST_DRAW_DISTANCE}
          ListHeaderComponent={listHeader}
          onScrollBeginDrag={closeOpenRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            // Unified paddingTop for iOS + Android. iOS previously used
            // contentInset+contentOffset to position content under the
            // floating Stack.Toolbar, but RN 0.85 Fabric recycles
            // RCTScrollViewComponentView across screen pushes and ignores
            // contentOffset on a recycled instance — leaving the hero
            // partly scrolled off the top on subsequent detail pushes.
            // See album-detail.tsx for the full explanation.
            { paddingTop: insets.top + HEADER_BAR_HEIGHT },
          ]}
          refreshControl={
            offlineMode ? undefined : (
              <RefreshControl
                key={refreshControlKey}
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                progressViewOffset={insets.top + HEADER_BAR_HEIGHT}
              />
            )
          }
        />
        <BottomChrome withSafeAreaPadding />
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
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
    fontSize: 24,
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
  heroButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  heroPlayButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  /* Sections */
  section: {
    paddingHorizontal: 16,
    marginTop: 20,
  },

  /* Biography */
  bioText: {
    fontSize: 16,
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
