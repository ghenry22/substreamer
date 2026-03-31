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
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { DownloadButton } from '../components/DownloadButton';
import { MarqueeText } from '../components/MarqueeText';
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { closeOpenRow } from '../components/SwipeableRow';
import { TrackRow } from '../components/TrackRow';
import {
  DARK_MIX,
  GRADIENT_LOCATIONS,
  GRADIENT_MIX_CURVE,
  LIGHT_MIX,
} from '../components/GradientBackground';
import { SKIP_COLOR_EXTRACTION, useColorExtraction } from '../hooks/useColorExtraction';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useIsStarred } from '../hooks/useIsStarred';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { useTheme } from '../hooks/useTheme';
import { mixHexColors } from '../utils/colors';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { refreshCachedImage } from '../services/imageCacheService';
import { toggleStar } from '../services/moreOptionsService';
import { enqueueAlbumDownload } from '../services/musicCacheService';
import { minDelay } from '../utils/stringHelpers';
import { playTrack } from '../services/playerService';
import { albumDetailStore } from '../store/albumDetailStore';
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
  const { colors, theme } = useTheme();
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cachedEntry = albumDetailStore((s) => (id ? s.albums[id] : undefined));
  const [album, setAlbum] = useState<AlbumWithSongsID3 | null>(cachedEntry?.album ?? null);
  const [loading, setLoading] = useState(!cachedEntry);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const starred = useIsStarred('album', id ?? '');
  const transitionComplete = useTransitionComplete();
  const downloadStatus = useDownloadStatus('album', Platform.OS === 'ios' ? (id ?? '') : '');
  const isWide = useLayoutMode() === 'wide';

  const handleToggleStar = useCallback(() => {
    if (id) toggleStar('album', id);
  }, [id]);

  const { coverBackgroundColor, gradientOpacity } = useColorExtraction(
    isWide ? SKIP_COLOR_EXTRACTION : album?.coverArt,
    colors.background,
  );

  const themeGradientColors = useMemo(() => {
    if (!isWide) return null;
    const peak = theme === 'dark' ? DARK_MIX : LIGHT_MIX;
    return GRADIENT_MIX_CURVE.map((m) =>
      mixHexColors(colors.background, colors.primary, peak * m),
    ) as [string, string, ...string[]];
  }, [isWide, theme, colors.primary, colors.background]);

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
      const delay = isRefresh ? minDelay() : null;
      const data = await fetchAlbum(id);
      setAlbum(data);
      if (!data) setError('Album not found');
      if (isRefresh && data?.coverArt) {
        refreshCachedImage(data.coverArt).catch(() => { /* non-critical */ });
      }
      await delay;
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
            <Ionicons name="disc-outline" size={16} color={colors.primary} style={styles.discIcon} />
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
            <MarqueeText style={[styles.albumName, { color: colors.textPrimary }]}>
              {album.name}
            </MarqueeText>
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
      <View style={styles.emptyTracks}>
        <Text style={[styles.emptyTracksTitle, { color: colors.textPrimary }]}>
          No tracks found
        </Text>
        <Text style={[styles.emptyTracksSubtitle, { color: colors.textSecondary }]}>
          Please check your server is online and reachable, then pull to refresh
        </Text>
      </View>
    ),
    [colors.textPrimary, colors.textSecondary],
  );

  const gradientStart = coverBackgroundColor ?? colors.background;

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

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
          title="Couldn't Load Album"
          subtitle={`Substreamer ran into an issue loading this album.\n\n${error ?? 'Unknown error'}`}
        />
      </View>
    );
  }

  const gradientEnd = colors.background;

  const gradientFillStyle = [
    StyleSheet.absoluteFillObject,
    { top: -insets.top, left: 0, right: 0, bottom: 0 },
  ];

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
        {themeGradientColors && (
          <LinearGradient
            colors={themeGradientColors}
            locations={[...GRADIENT_LOCATIONS]}
            style={gradientFillStyle}
            pointerEvents="none"
          />
        )}
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
            offlineMode ? undefined : (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                progressViewOffset={Platform.OS === 'android' ? insets.top + HEADER_BAR_HEIGHT : 0}
              />
            )
          }
        />
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  infoText: {
    flex: 1,
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
    fontSize: 15,
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
    fontSize: 15,
    textAlign: 'center',
  },
});
