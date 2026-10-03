import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
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
import Ionicons from "@react-native-vector-icons/ionicons/static";
import { FlashList } from '@shopify/flash-list';
import { LIST_DRAW_DISTANCE } from '../constants/layout';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { DownloadButton } from '../components/DownloadButton';
import { MarqueeText } from '../components/MarqueeText';
import { BottomChrome } from '../components/BottomChrome';
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { closeOpenRow } from '../components/SwipeableRow';
import { TrackRow } from '../components/TrackRow';
import { DetailScreenBackground } from '../components/DetailScreenBackground';
import { PlayAllButton, ShufflePlayButton } from '../components/DetailHeroButtons';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useDetailFetch } from '../hooks/useDetailFetch';
import { useIsStarred } from '../hooks/useIsStarred';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { refreshCoverArt } from '../services/imageCacheService';
import { toggleStar } from '../services/moreOptionsService';
import { enqueueAlbumDownload } from '../services/musicCacheService';
import { shuffleArray } from '../utils/arrayHelpers';
import { playTrack } from '../services/playerService';
import { fetchAlbumDetail } from '../services/detailFetchService';
import { getDb } from '../store/persistence/db';
import { getAlbumDetail } from '../db/repository/details';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';

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
  const { t } = useTranslation();
  const { colors } = useTheme();
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [album, setAlbum] = useState<AlbumWithSongsID3 | null>(null);
  const [hasCache, setHasCache] = useState(false);
  const [cacheChecked, setCacheChecked] = useState(false);
  // Read the cached detail from the local DB first (fast) — the server fetch only runs
  // on a genuine miss. The server refresh (fetchAlbum) dual-writes normalized, so a
  // re-open resolves instantly from here without a network round-trip.
  useEffect(() => {
    if (!id) return;
    const db = getDb();
    if (!db) {
      setCacheChecked(true);
      return;
    }
    let alive = true;
    getAlbumDetail(db, id)
      .then((d) => {
        if (!alive) return;
        if (d) {
          setAlbum((prev) => prev ?? ({ ...d.album, song: d.songs } as AlbumWithSongsID3));
          // "Cached" only if we actually have the tracks — an album ROW can exist without
          // its songs synced yet; an empty song list ⇒ fetch from the server.
          setHasCache(d.songs.length > 0);
        }
        setCacheChecked(true);
      })
      .catch(() => {
        if (alive) setCacheChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  const starred = useIsStarred('album', id ?? '');
  const transitionComplete = useTransitionComplete();
  const downloadStatus = useDownloadStatus('album', Platform.OS === 'ios' ? (id ?? '') : '');
  const isWide = useLayoutMode() === 'wide';
  const refreshControlKey = useRefreshControlKey();

  const handleToggleStar = useCallback(() => {
    if (id) toggleStar('album', id);
  }, [id]);

  /* ---- Header right: download button + more options ---- */
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    if (!album || !id) return;
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
          <DownloadButton itemId={id} type="album" />
          <MoreOptionsButton
            onPress={() =>
              moreOptionsStore.getState().show({ type: 'album', item: album })
            }
            color={colors.textPrimary}
          />
        </View>
      ),
    });
  }, [album, id, navigation, colors.textPrimary, colors.red, starred, offlineMode, handleToggleStar]);

  /* ---- Data fetching ---- */
  const load = useCallback(async (albumId: string, isRefresh: boolean) => {
    // The fetch always upserts the album row, so the viewed album reaches the library
    // list without a separate sync step. `force` only on an explicit pull-to-refresh;
    // a normal open answers from the local database when we already hold the tracks.
    const data = await fetchAlbumDetail(albumId, { force: isRefresh });
    setAlbum(data);
    if (isRefresh && data?.id) {
      refreshCoverArt(data.id, 'album-detail-pull').catch(() => { /* non-critical */ });
    }
    return data ? null : t('albumNotFound');
  }, [t]);

  const { loading, refreshing, error, onRefresh } = useDetailFetch({
    id,
    hasCache,
    cacheChecked,
    missingIdMessage: t('missingAlbumId'),
    failedMessage: t('failedToLoadAlbum'),
    load,
  });

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

  // paddingTop on contentContainerStyle for BOTH platforms — never iOS's
  // contentInset.top + contentOffset.y = -inset to clear the floating Stack.Toolbar.
  // Fabric recycles RCTScrollViewComponentView instances across screen pushes and
  // `contentOffset` is initial-only, so it is not re-applied to a recycled instance:
  // the second push of any detail screen leaves the hero scrolled partly off the top.
  // paddingTop is content-side, so the layout engine applies it either way.
  const headerInset = insets.top + HEADER_BAR_HEIGHT;
  const listContentContainerStyle = useMemo(
    () => ({
      paddingTop: headerInset,
      paddingBottom: 32,
    }),
    [headerInset],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: AlbumListItem; index: number }) => {
      if (item.type === 'disc-header') {
        return (
          <View style={[styles.discHeaderWrap, index > 0 && styles.discHeaderGap]}>
            <Ionicons name="disc-outline" size={16} color={colors.primary} style={styles.discIcon} />
            <Text style={[styles.discTitle, { color: colors.label }]}>
              {t('discNumber', { number: item.discNumber })}
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
            songs={allSongs}
            showComposer
          />
        </View>
      );
    },
    [colors, allSongs, t],
  );

  const keyExtractor = useCallback(
    (item: AlbumListItem) =>
      item.type === 'disc-header' ? `disc-${item.discNumber}` : `track-${item.track.id}`,
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
          <MarqueeText style={[styles.albumName, { color: colors.textPrimary }]}>
            {album.name}
          </MarqueeText>
          <View style={styles.subtitleRow}>
            <View style={styles.subtitleText}>
              {album.artistId && !offlineMode ? (
                <Pressable
                  onPress={() => router.push(`/artist/${album.artistId}`)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('goToArtist')}
                  style={({ pressed }) => pressed && styles.artistNamePressed}
                >
                  <Text style={[styles.artistName, { color: colors.textSecondary }]}>
                    {album.artist ?? album.displayArtist ?? t('unknownArtist')}
                  </Text>
                </Pressable>
              ) : (
                <Text style={[styles.artistName, { color: colors.textSecondary }]}>
                  {album.artist ?? album.displayArtist ?? t('unknownArtist')}
                </Text>
              )}
              {album.year ? (
                <Text style={[styles.albumYear, { color: colors.textSecondary }]}>
                  {album.year}
                </Text>
              ) : null}
            </View>
            {allSongs.length > 1 && (
              <ShufflePlayButton
                style={styles.heroButtonSpacing}
                onPress={() => {
                  const shuffled = shuffleArray(allSongs);
                  playTrack(shuffled[0], shuffled);
                }}
              />
            )}
            {allSongs.length > 0 && (
              <PlayAllButton
                style={styles.heroButtonSpacing}
                onPress={() => playTrack(allSongs[0], allSongs)}
              />
            )}
          </View>
        </View>
        <View style={styles.trackListSpacer} />
      </>
    );
  }, [album, colors, allSongs, offlineMode, router, t]);

  const listEmpty = useMemo(
    () => (
      <View style={styles.emptyTracks}>
        <Text style={[styles.emptyTracksTitle, { color: colors.textPrimary }]}>
          {t('noTracksFound')}
        </Text>
        <Text style={[styles.emptyTracksSubtitle, { color: colors.textSecondary }]}>
          {t('noTracksFoundSubtitle')}
        </Text>
      </View>
    ),
    [colors.textPrimary, colors.textSecondary, t],
  );

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
        <EmptyState
          icon="disc-outline"
          title={t('couldntLoadAlbum')}
          subtitle={`${t('loadAlbumError')}\n\n${error ?? t('unknownError')}`}
        />
      </View>
    );
  }

  return (
    <>
      {Platform.OS === 'ios' && album && id && (
        <Stack.Toolbar placement="right">
          {!offlineMode && (
            <Stack.Toolbar.Button
              icon={starred ? 'heart.fill' : 'heart'}
              onPress={handleToggleStar}
              tintColor={starred ? colors.red : undefined}
            />
          )}
          {downloadStatus === 'none' ? (
            <Stack.Toolbar.Button
              icon="arrow.down.circle"
              onPress={() => enqueueAlbumDownload(id)}
            />
          ) : (
            <Stack.Toolbar.View>
              <DownloadButton itemId={id} type="album" />
            </Stack.Toolbar.View>
          )}
          <Stack.Toolbar.Button
            icon="ellipsis"
            onPress={() => moreOptionsStore.getState().show({ type: 'album', item: album })}
          />
        </Stack.Toolbar>
      )}
      <View style={styles.container}>
        <DetailScreenBackground coverArt={album?.coverArt} isWide={isWide} />
        <FlashList
          data={listData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          drawDistance={LIST_DRAW_DISTANCE}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          onScrollBeginDrag={closeOpenRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={listContentContainerStyle}
          refreshControl={
            offlineMode ? undefined : (
              <RefreshControl
                key={refreshControlKey}
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                progressViewOffset={headerInset}
              />
            )
          }
        />
        <BottomChrome withSafeAreaPadding />
      </View>
    </>
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
    maxWidth: 448,
    alignSelf: 'center',
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
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
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
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  subtitleText: {
    flex: 1,
  },
  heroButtonSpacing: {
    marginLeft: 10,
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
  },
  artistNamePressed: {
    opacity: 0.6,
  },
  trackItemWrap: {
    // Deliberately empty: TrackRow carries the 16px horizontal padding (matching the
    // `info` block) so its content edge aligns with the title text above while the
    // swipe-gesture area still reaches the screen edge.
  },
  discHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  discIcon: {
    marginRight: 6,
  },
  discHeaderGap: {
    marginTop: 24,
  },
  trackListSpacer: {
    height: 8,
  },
  discTitle: {
    fontSize: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyTracks: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  emptyTracksTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyTracksSubtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
});
