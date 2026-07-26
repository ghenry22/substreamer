import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useIsFocused } from "expo-router/react-navigation";
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { AlbumCard } from '../components/AlbumCard';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { DownloadedIcon } from '../components/DownloadedIcon';
import { EmptyState } from '../components/EmptyState';
import { GenreChipSection } from '../components/GenreChipSection';
import { PlaylistCard } from '../components/PlaylistCard';
import { ResumeBookmarksSection } from '../components/ResumeBookmarksSection';
import WaveformLogo from '../components/WaveformLogo';
import { computeStreaks, dateKey } from '../hooks/usePlaybackAnalytics';
import { useTheme } from '../hooks/useTheme';
import type { AlbumID3, Playlist } from '../services/subsonicService';
import { composeHomeAlbumSections } from '../services/homeSectionsService';
import { albumLibraryStore } from '../store/albumLibraryStore';
import {
  albumListsStore,
  type AlbumListType,
} from '../store/albumListsStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { favoritesStore } from '../store/favoritesStore';
import { pendingScrobbleStore } from '../store/pendingScrobbleStore';
import { filterBarStore } from '../store/filterBarStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { LIST_LENGTH_DISPLAY_CAP } from '../store/layoutPreferencesStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistLibraryStore } from '../store/playlistLibraryStore';
import { radioStore } from '../store/radioStore';
import { playTrack } from '../services/playerService';
import { RADIO_ID_PREFIX, radioStationToChild } from '../services/subsonicService';
import { searchStore } from '../store/searchStore';
import { selectionAsync } from '../utils/haptics';

import { absoluteFill } from '../utils/styles';
const CARD_WIDTH = 150;
const CARD_GAP = 12;
// Stable module-level separator so FlashList isn't handed a fresh component
// identity on every render of each horizontal section.
const CardSeparator = () => <View style={{ width: CARD_GAP }} />;
// Render off-screen items eagerly so horizontal FlashLists nested below the
// vertical home-screen ScrollView paint before the user scrolls them into
// view. Without this, FlashList v2's lazy viewport measurement under the
// New Architecture leaves the cards blank until a scroll event triggers a
// re-measure (kill + restart was the only way to recover). Matches the
// 300px used by AlbumListView / PlaylistListView / ArtistListView.
const HORIZONTAL_DRAW_DISTANCE = 300;

const SECTION_CONFIG: Record<
  AlbumListType,
  { titleKey: string; emptyMessageKey: string; refresh: () => Promise<void> }
> = {
  recentlyAdded: {
    titleKey: 'recentlyAdded',
    emptyMessageKey: 'recentlyAddedEmpty',
    refresh: () => albumListsStore.getState().refreshRecentlyAdded(),
  },
  recentlyPlayed: {
    titleKey: 'recentlyPlayed',
    emptyMessageKey: 'recentlyPlayedEmpty',
    refresh: () => albumListsStore.getState().refreshRecentlyPlayed(),
  },
  frequentlyPlayed: {
    titleKey: 'frequentlyPlayed',
    emptyMessageKey: 'frequentlyPlayedEmpty',
    refresh: () => albumListsStore.getState().refreshFrequentlyPlayed(),
  },
  randomSelection: {
    titleKey: 'randomSelection',
    emptyMessageKey: 'randomSelectionEmpty',
    refresh: () => albumListsStore.getState().refreshRandomSelection(),
  },
};

function SectionPlaceholder({
  message,
  colors,
}: {
  message: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.emptySection}>
      <View style={styles.emptyCards}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.emptyCardImage, { backgroundColor: colors.inputBg }]}>
              <WaveformLogo size={32} color={colors.primary + '40'} />
            </View>
            <View style={[styles.emptyCardLine, { backgroundColor: colors.border }]} />
            <View style={[styles.emptyCardLineShort, { backgroundColor: colors.border }]} />
          </View>
        ))}
      </View>
      <View style={[styles.emptyOverlay, { backgroundColor: colors.background + '99' }]}>
        <Ionicons name="musical-notes-outline" size={24} color={colors.primary} />
        <Text style={[styles.emptyOverlayText, { color: colors.textSecondary }]}>
          {message}
        </Text>
      </View>
    </View>
  );
}

function AlbumSection({
  listType,
  albums,
  colors,
  offlineMode,
}: {
  listType: AlbumListType;
  albums: AlbumID3[];
  colors: ReturnType<typeof useTheme>['colors'];
  offlineMode: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const config = SECTION_CONFIG[listType];
  const title = t(config.titleKey);
  const renderItem = useCallback(
    ({ item }: { item: AlbumID3 }) => (
      <AlbumCard album={item} width={CARD_WIDTH} />
    ),
    []
  );
  const keyExtractor = useCallback((item: AlbumID3) => item.id, []);
  // Memoise the filtered/sliced list so FlashList isn't handed a brand-new array
  // (and forced to reconcile) on every render of the parent screen.
  const listData = useMemo(
    () => albums.filter((a) => a.id).slice(0, LIST_LENGTH_DISPLAY_CAP),
    [albums],
  );
  const onRefresh = useCallback(() => {
    config.refresh();
  }, [listType]);
  const onSeeMore = useCallback(() => {
    router.push({ pathname: '/album-list', params: { type: listType } });
  }, [listType, router]);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {offlineMode ? (
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {title}
          </Text>
        ) : (
          <Pressable
            onPress={onSeeMore}
            style={({ pressed }) => [
              { flex: 1 },
              pressed && styles.iconButtonPressed,
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('seeMoreAlbums', { section: title })}
          >
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              {title}
            </Text>
          </Pressable>
        )}
        {!offlineMode && (
          <View style={styles.sectionHeaderActions}>
            <Pressable
              onPress={onRefresh}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}
              hitSlop={8}
            >
              <Ionicons
                name="refresh"
                size={22}
                color={colors.textSecondary}
              />
            </Pressable>
            <Pressable
              onPress={onSeeMore}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}
              hitSlop={8}
            >
              <Ionicons
                name="chevron-forward"
                size={24}
                color={colors.textSecondary}
              />
            </Pressable>
          </View>
        )}
      </View>
      {albums.length === 0 ? (
        <SectionPlaceholder message={t(config.emptyMessageKey)} colors={colors} />
      ) : (
        <FlashList
          // Guard against entries with a falsy id: keyExtractor returns
          // `item.id`, so an id-less item yields an `undefined` key that
          // corrupts FlashList recycling (a stuck-placeholder vector). Such a
          // card can't render art, cache, or navigate anyway — drop it.
          data={listData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ItemSeparatorComponent={CardSeparator}
          drawDistance={HORIZONTAL_DRAW_DISTANCE}
        />
      )}
    </View>
  );
}

/** "Continue listening" — one-tap resume of the last played radio station.
 *  Hidden until a station has been played and is still on the server list. */
function LastStationCard({ colors }: { colors: ReturnType<typeof useTheme>['colors'] }) {
  const { t } = useTranslation();
  const lastPlayedStationId = radioStore((s) => s.lastPlayedStationId);
  const stations = radioStore((s) => s.stations);

  const station = useMemo(
    () => stations.find((s) => s.id === lastPlayedStationId) ?? null,
    [stations, lastPlayedStationId],
  );

  const handlePlay = useCallback(() => {
    if (!station) return;
    selectionAsync();
    // The whole station list becomes the queue (same as the radio screen) so
    // next/previous hops between stations.
    const children = radioStore.getState().stations.map(radioStationToChild);
    const child = children.find((c) => c.id === `${RADIO_ID_PREFIX}${station.id}`);
    if (child) playTrack(child, children);
  }, [station]);

  if (!station) return null;

  return (
    <Pressable
      onPress={handlePlay}
      style={({ pressed }) => [
        styles.radioCard,
        styles.lastStationCard,
        { backgroundColor: colors.card + 'B3' },
        pressed && styles.listeningCardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('playRadioStation', { name: station.name })}
    >
      <View style={[styles.radioIconCircle, { backgroundColor: colors.primary + '18' }]}>
        <Ionicons name="play" size={20} color={colors.primary} />
      </View>
      <View style={styles.radioTextBlock}>
        <Text style={[styles.radioTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {station.name}
        </Text>
        <Text style={[styles.radioSubtitle, { color: colors.textSecondary }]}>
          {t('lastPlayedStation')}
        </Text>
      </View>
      <Ionicons name="radio-outline" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

function DownloadedAlbumSection({
  albums,
  colors,
}: {
  albums: AlbumID3[];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { t } = useTranslation();
  const renderItem = useCallback(
    ({ item }: { item: AlbumID3 }) => (
      <AlbumCard album={item} width={CARD_WIDTH} />
    ),
    []
  );
  const keyExtractor = useCallback((item: AlbumID3) => item.id, []);

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: 16 }]}>
        {t('downloadedAlbums')}
      </Text>
      {albums.length === 0 ? (
        <SectionPlaceholder message={t('downloadAlbumsOffline')} colors={colors} />
      ) : (
        <FlashList
          data={albums}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ItemSeparatorComponent={CardSeparator}
          drawDistance={HORIZONTAL_DRAW_DISTANCE}
        />
      )}
    </View>
  );
}

function PlaylistSection({
  playlists,
  colors,
}: {
  playlists: Playlist[];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { t } = useTranslation();
  const renderItem = useCallback(
    ({ item }: { item: Playlist }) => (
      <PlaylistCard playlist={item} width={CARD_WIDTH} />
    ),
    []
  );
  const keyExtractor = useCallback((item: Playlist) => item.id, []);

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: 16 }]}>
        {t('downloadedPlaylists')}
      </Text>
      {playlists.length === 0 ? (
        <SectionPlaceholder message={t('downloadPlaylistsOffline')} colors={colors} />
      ) : (
        <FlashList
          data={playlists}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ItemSeparatorComponent={CardSeparator}
          drawDistance={HORIZONTAL_DRAW_DISTANCE}
        />
      )}
    </View>
  );
}

function AnimatedStatIcon({
  value,
  iconBgColor,
  children,
}: {
  value: number | string;
  iconBgColor: string;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    scale.value = withSequence(
      withTiming(1.1, { duration: 300 }),
      withSpring(1, { damping: 10, stiffness: 120 })
    );
  }, [value, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.statIcon, { backgroundColor: iconBgColor }, animatedStyle]}>
      {children}
    </Animated.View>
  );
}


export function HomeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const isFocused = useIsFocused();
  const headerHeight = searchStore((s) => s.headerHeight);

  const recentlyAdded = albumListsStore((s) => s.recentlyAdded);
  const recentlyPlayed = albumListsStore((s) => s.recentlyPlayed);
  const frequentlyPlayed = albumListsStore((s) => s.frequentlyPlayed);
  const randomSelection = albumListsStore((s) => s.randomSelection);

  const genreCounts = completedScrobbleStore((s) => s.aggregates.genreCounts);
  const totalPlays = completedScrobbleStore((s) => s.stats.totalPlays);
  const totalSeconds = completedScrobbleStore((s) => s.stats.totalListeningSeconds);
  const uniqueArtistCount = completedScrobbleStore(
    (s) => Object.keys(s.stats.uniqueArtists).length
  );
  const dayCounts = completedScrobbleStore((s) => s.aggregates.dayCounts);
  const pendingScrobbles = pendingScrobbleStore((s) => s.pendingScrobbles);
  const listeningStats = useMemo(() => {
    const dayKeys = new Set(Object.keys(dayCounts));
    for (const s of pendingScrobbles) dayKeys.add(dateKey(s.time));
    const { current: streak } = computeStreaks(Array.from(dayKeys));
    return { total: totalPlays, totalSeconds, artists: uniqueArtistCount, streak };
  }, [totalPlays, totalSeconds, uniqueArtistCount, dayCounts, pendingScrobbles]);

  useEffect(() => {
    if (!isFocused) return;
    const store = filterBarStore.getState();
    store.setLayoutToggle(null);
    store.setDownloadButtonConfig(null);
    store.setHideDownloaded(false);
    store.setHideFavorites(false);
  }, [isFocused]);

  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const downloadedOnly = filterBarStore((s) => s.downloadedOnly);
  const favoritesOnly = filterBarStore((s) => s.favoritesOnly);
  const cachedItems = musicCacheStore((s) => s.cachedItems);
  const starredAlbums = favoritesStore((s) => s.albums);
  const includePartial = layoutPreferencesStore((s) => s.includePartialInDownloadedFilter);

  const allLibraryAlbums = albumLibraryStore((s) => s.albums);
  const allPlaylists = playlistLibraryStore((s) => s.playlists);

  // Which album lists appear (order + downloaded/favorites filtering + offline
  // drop-Random + Downloaded Albums) is owned by the shared homeSectionsService
  // selector, so the Home screen and the CarPlay/Android Auto browse tree agree.
  const albumSections = useMemo(
    () =>
      composeHomeAlbumSections({
        recentlyAdded,
        recentlyPlayed,
        frequentlyPlayed,
        randomSelection,
        allLibraryAlbums,
        offlineMode,
        downloadedOnly,
        favoritesOnly,
        starredAlbums,
        cachedItems,
        includePartial,
      }),
    [
      recentlyAdded,
      recentlyPlayed,
      frequentlyPlayed,
      randomSelection,
      allLibraryAlbums,
      offlineMode,
      downloadedOnly,
      favoritesOnly,
      starredAlbums,
      cachedItems,
      includePartial,
    ],
  );

  const hasAnyFilters = downloadedOnly || favoritesOnly;

  const downloadedPlaylists = useMemo(() => {
    if (!downloadedOnly) return [];
    // Playlists don't have a "partial" state — they download atomically.
    return allPlaylists.filter((p) => p.id in cachedItems);
  }, [downloadedOnly, allPlaylists, cachedItems]);

  const offlineEmpty = useMemo(() => {
    if (!downloadedOnly) return false;
    const hasDownloadedAlbums = albumSections.some(
      (s) => s.type === 'downloadedAlbums' && s.albums.length > 0,
    );
    if (hasDownloadedAlbums || downloadedPlaylists.length > 0) return false;
    return albumSections
      .filter((s) => s.type !== 'downloadedAlbums')
      .every((s) => s.albums.length === 0);
  }, [downloadedOnly, albumSections, downloadedPlaylists]);

  return (
    <View style={styles.container}>
      {offlineEmpty ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('noDownloadedMusic')}
        >
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {t('noDownloadedMusicHintBefore')}{' '}
            <DownloadedIcon size={15} circleColor={colors.primary} arrowColor="#fff" />
            {' '}{t('noDownloadedMusicHintAfter')}
          </Text>
        </EmptyState>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Pressable
                onPress={() => router.push('/my-listening')}
                style={({ pressed }) => [
                  { flex: 1 },
                  pressed && styles.iconButtonPressed,
                ]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('viewListeningHistory')}
              >
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                  {t('myListening')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/my-listening')}
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && styles.iconButtonPressed,
                ]}
                hitSlop={8}
              >
                <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Pressable
              onPress={() => router.push('/my-listening')}
              style={({ pressed }) => [
                styles.listeningCard,
                { backgroundColor: colors.card + 'B3' },
                pressed && styles.listeningCardPressed,
              ]}
            >
              {listeningStats.total > 0 ? (
                <View style={styles.statsRow}>
                  <View style={styles.statBlock}>
                    <AnimatedStatIcon value={listeningStats.total} iconBgColor={colors.primary + '18'}>
                      <Ionicons name="musical-notes" size={20} color={colors.primary} />
                    </AnimatedStatIcon>
                    <AnimatedNumber
                      value={listeningStats.total}
                      style={[styles.statValue, { color: colors.textPrimary }]}
                    />
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                      {t('plays')}
                    </Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statBlock}>
                    <AnimatedStatIcon value={listeningStats.totalSeconds} iconBgColor={colors.primary + '18'}>
                      <Ionicons name="time" size={20} color={colors.primary} />
                    </AnimatedStatIcon>
                    <AnimatedNumber
                      value={listeningStats.totalSeconds}
                      format="duration"
                      style={[styles.statValue, { color: colors.textPrimary }]}
                    />
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                      {t('listening')}
                    </Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statBlock}>
                    <AnimatedStatIcon value={listeningStats.artists} iconBgColor={colors.primary + '18'}>
                      <Ionicons name="people" size={20} color={colors.primary} />
                    </AnimatedStatIcon>
                    <AnimatedNumber
                      value={listeningStats.artists}
                      style={[styles.statValue, { color: colors.textPrimary }]}
                    />
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                      {t('artistsLabel')}
                    </Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statBlock}>
                    <AnimatedStatIcon value={listeningStats.streak} iconBgColor={colors.primary + '18'}>
                      <Ionicons name="flame" size={20} color={colors.primary} />
                    </AnimatedStatIcon>
                    <AnimatedNumber
                      value={listeningStats.streak}
                      style={[styles.statValue, { color: colors.textPrimary }]}
                      suffix="d"
                    />
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                      {t('streak')}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.statsEmpty}>
                  <Ionicons name="analytics-outline" size={24} color={colors.primary} />
                  <Text style={[styles.statsEmptyText, { color: colors.textSecondary }]}>
                    {t('listenToSeeStats')}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
          <GenreChipSection genreCounts={genreCounts} colors={colors} />
          {!offlineMode && (
            <View style={styles.section}>
              <Pressable
                onPress={() => router.push('/radio')}
                style={({ pressed }) => [
                  styles.radioCard,
                  { backgroundColor: colors.card + 'B3' },
                  pressed && styles.listeningCardPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('openInternetRadio')}
              >
                <View style={[styles.radioIconCircle, { backgroundColor: colors.primary + '18' }]}>
                  <Ionicons name="radio-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.radioTextBlock}>
                  <Text style={[styles.radioTitle, { color: colors.textPrimary }]}>
                    {t('internetRadio')}
                  </Text>
                  <Text style={[styles.radioSubtitle, { color: colors.textSecondary }]}>
                    {t('internetRadioHomeHint')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </Pressable>
              <LastStationCard colors={colors} />
            </View>
          )}
          <ResumeBookmarksSection />
          {albumSections.map((section) => {
            if (section.type === 'downloadedAlbums') {
              // Downloaded Albums renders its own placeholder when empty, and is
              // immediately followed by the downloaded-playlists section.
              return (
                <Fragment key={section.type}>
                  <DownloadedAlbumSection albums={section.albums} colors={colors} />
                  <PlaylistSection playlists={downloadedPlaylists} colors={colors} />
                </Fragment>
              );
            }
            if (hasAnyFilters && section.albums.length === 0) return null;
            return (
              <AlbumSection
                key={section.type}
                listType={section.type}
                albums={section.albums}
                colors={colors}
                offlineMode={offlineMode}
              />
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  sectionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    padding: 4,
  },
  iconButtonPressed: {
    opacity: 0.6,
  },
  emptySubtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
  emptySection: {
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  emptyCards: {
    flexDirection: 'row' as const,
    gap: CARD_GAP,
  },
  emptyCard: {
    width: CARD_WIDTH,
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
  },
  emptyCardImage: {
    width: CARD_WIDTH - 16,
    height: CARD_WIDTH - 16,
    borderRadius: 8,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  emptyCardLine: {
    height: 10,
    borderRadius: 5,
    marginTop: 8,
  },
  emptyCardLineShort: {
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    width: '60%' as const,
  },
  emptyOverlay: {
    ...absoluteFill,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderRadius: 12,
  },
  emptyOverlayText: {
    fontSize: 14,
    fontWeight: '500' as const,
    textAlign: 'center' as const,
    paddingHorizontal: 24,
  },
  horizontalList: {
    paddingRight: 16,
  },
  listeningCard: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 2,
  },
  listeningCardPressed: {
    opacity: 0.7,
  },
  radioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  lastStationCard: {
    marginTop: 12,
  },
  radioIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioTextBlock: {
    flex: 1,
  },
  radioTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  radioSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 48,
    opacity: 0.6,
  },
  statsEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  statsEmptyText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
});
