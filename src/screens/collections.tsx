import Ionicons from "@react-native-vector-icons/ionicons/static";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AlbumCard } from '../components/AlbumCard';
import { DownloadedIcon } from '../components/DownloadedIcon';
import { EmptyState } from '../components/EmptyState';
import { BottomChrome } from '../components/BottomChrome';
import { GradientBackground } from '../components/GradientBackground';
import { PlaylistCard } from '../components/PlaylistCard';
import { ResumeBookmarksSection } from '../components/ResumeBookmarksSection';
import WaveformLogo from '../components/WaveformLogo';
import { useTheme } from '../hooks/useTheme';
import type { AlbumID3, Playlist } from '../services/subsonicService';
import { composeHomeAlbumSections } from '../services/homeSectionsService';
import { albumListRowToAlbumID3 } from '../db/repository/albums';
import {
  listDownloadedAlbumIds,
  listDownloadedAlbums,
  listDownloadedPlaylists,
} from '../db/repository/downloads';
import { playlistListRowToPlaylist } from '../db/repository/playlists';
import { getDb } from '../store/persistence/db';
import {
  albumListsStore,
  type AlbumListType,
} from '../store/albumListsStore';
import { favoritesStore } from '../store/favoritesStore';
import { filterBarStore } from '../store/filterBarStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { LIST_LENGTH_DISPLAY_CAP } from '../store/layoutPreferencesStore';
import { offlineModeStore } from '../store/offlineModeStore';

import { absoluteFill } from '../utils/styles';
const CARD_WIDTH = 150;
const CARD_GAP = 12;
// Stable module-level separator so FlashList isn't handed a fresh component
// identity on every render of each horizontal section.
const CardSeparator = () => <View style={{ width: CARD_GAP }} />;
// Render off-screen items eagerly so the horizontal FlashLists nested inside the
// vertical home ScrollView paint before the user scrolls them into view. Without it,
// FlashList v2's lazy viewport measurement leaves the cards blank until some scroll
// event forces a re-measure. Matches AlbumListView / PlaylistListView / ArtistListView.
const HORIZONTAL_DRAW_DISTANCE = 300;

// Every carousel below passes `maintainVisibleContentPosition={{ disabled: true }}`.
// FlashList v2 enables it by default, anchoring the viewport to a previously-visible
// item; these carousels have their data REPLACED wholesale (filter toggle, section
// refresh, sync), so the anchor lands at a different index and parks the list where
// there is nothing to draw — only a manual scroll recovers it.

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
  }, [config]);
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
          // `listData` drops entries with a falsy id: keyExtractor returns `item.id`,
          // and an undefined key corrupts FlashList recycling into stuck placeholders.
          // Such a card can't render art, cache, or navigate anyway.
          data={listData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ItemSeparatorComponent={CardSeparator}
          // Data replaced wholesale — see the note on HORIZONTAL_DRAW_DISTANCE above.
          maintainVisibleContentPosition={{ disabled: true }}
          drawDistance={HORIZONTAL_DRAW_DISTANCE}
        />
      )}
    </View>
  );
}

function DownloadedAlbumSection({
  albums,
  colors,
  loading,
}: {
  albums: AlbumID3[];
  colors: ReturnType<typeof useTheme>['colors'];
  /** The SQL read is in flight — hold the placeholder back rather than claim "nothing
   *  downloaded" before the answer is known. */
  loading: boolean;
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
        loading ? null : (
          <SectionPlaceholder message={t('downloadAlbumsOffline')} colors={colors} />
        )
      ) : (
        <FlashList
          data={albums}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ItemSeparatorComponent={CardSeparator}
          // Data replaced wholesale — see the note on HORIZONTAL_DRAW_DISTANCE above.
          maintainVisibleContentPosition={{ disabled: true }}
          drawDistance={HORIZONTAL_DRAW_DISTANCE}
        />
      )}
    </View>
  );
}

function PlaylistSection({
  playlists,
  colors,
  loading,
}: {
  playlists: Playlist[];
  colors: ReturnType<typeof useTheme>['colors'];
  /** See `DownloadedAlbumSection` — same in-flight guard. */
  loading: boolean;
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
        loading ? null : (
          <SectionPlaceholder message={t('downloadPlaylistsOffline')} colors={colors} />
        )
      ) : (
        <FlashList
          data={playlists}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ItemSeparatorComponent={CardSeparator}
          // Data replaced wholesale — see the note on HORIZONTAL_DRAW_DISTANCE above.
          maintainVisibleContentPosition={{ disabled: true }}
          drawDistance={HORIZONTAL_DRAW_DISTANCE}
        />
      )}
    </View>
  );
}

export function CollectionsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  const recentlyAdded = albumListsStore((s) => s.recentlyAdded);
  const recentlyPlayed = albumListsStore((s) => s.recentlyPlayed);
  const frequentlyPlayed = albumListsStore((s) => s.frequentlyPlayed);
  const randomSelection = albumListsStore((s) => s.randomSelection);

  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const downloadedOnly = filterBarStore((s) => s.downloadedOnly);
  const favoritesOnly = filterBarStore((s) => s.favoritesOnly);
  // `revision` is the download tables' change signal. The three reads below are SQL, and
  // SQL has no Zustand subscription — without this a completing download leaves both
  // Downloaded sections AND the curated-list filter silently stale.
  const revision = musicCacheStore((s) => s.revision);
  const starredAlbumIds = favoritesStore((s) => s.albumIds);
  const includePartial = layoutPreferencesStore((s) => s.includePartialInDownloadedFilter);
  const albumSortOrder = layoutPreferencesStore((s) => s.albumSortOrder);

  // The Downloaded sections come from the never-reaped download tables (bounded,
  // offline-safe), not the paged library. One effect covers all three: they share a
  // trigger, and one loading flag keeps the two sections, the curated-list filter and
  // the whole-screen empty state from disagreeing about whether the answer is known.
  //
  // The id set is the MEMBERSHIP predicate (`cached_items` alone) that filters the curated
  // lists, whose albums arrive from the album-lists store already carrying their metadata;
  // the two row reads are VISIBILITY (they must be renderable). See `downloads.ts`.
  const [downloadedAlbumRows, setDownloadedAlbumRows] = useState<AlbumID3[]>([]);
  const [downloadedPlaylistRows, setDownloadedPlaylistRows] = useState<Playlist[]>([]);
  const [downloadedAlbumIds, setDownloadedAlbumIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // `albumSortOrder` is part of the key because the ORDER BY is the DB's: changing the
  // preference re-reads rather than re-sorting what we hold.
  const downloadedKey = `${includePartial}:${revision}:${albumSortOrder}`;
  // DERIVED, not seeded (see `album-library-list.tsx`): a mount-time seed only runs once,
  // so turning the Downloaded filter on later would render one empty-and-not-loading frame
  // and flash "No downloaded music" over the whole screen.
  const downloadedLoading = downloadedOnly && loadedKey !== downloadedKey;
  useEffect(() => {
    if (!downloadedOnly) return;
    let alive = true;
    void (async () => {
      const db = getDb();
      const [albums, playlists, ids]: [AlbumID3[], Playlist[], ReadonlySet<string>] = db
        ? await Promise.all([
            listDownloadedAlbums(db, { includePartial, sortOrder: albumSortOrder }).then((rs) =>
              rs.map(albumListRowToAlbumID3),
            ),
            listDownloadedPlaylists(db).then((rs) => rs.map(playlistListRowToPlaylist)),
            listDownloadedAlbumIds(db, { includePartial }),
          ])
        : [[], [], new Set<string>()];
      if (!alive) return;
      setDownloadedAlbumRows(albums);
      setDownloadedPlaylistRows(playlists);
      setDownloadedAlbumIds(ids);
      setLoadedKey(downloadedKey);
    })();
    return () => {
      alive = false;
    };
  }, [downloadedOnly, includePartial, revision, albumSortOrder, downloadedKey]);

  // Both reads come back ORDERED (SQL, on the stored `sort_*` keys). The guard stays:
  // the rows outlive a filter toggle-off, and the sections must empty with the filter.
  const downloadedAlbums = useMemo(
    () => (downloadedOnly ? downloadedAlbumRows : []),
    [downloadedOnly, downloadedAlbumRows],
  );

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
        downloadedAlbums,
        offlineMode,
        downloadedOnly,
        favoritesOnly,
        starredAlbumIds,
        downloadedAlbumIds,
      }),
    [
      recentlyAdded,
      recentlyPlayed,
      frequentlyPlayed,
      randomSelection,
      downloadedAlbums,
      offlineMode,
      downloadedOnly,
      favoritesOnly,
      starredAlbumIds,
      downloadedAlbumIds,
    ],
  );

  const hasAnyFilters = downloadedOnly || favoritesOnly;

  // Playlists download atomically (no partial state), so the read carries no gate; it
  // comes back A-Z on the stored `sort_title`. Never-reaped source, independent of the
  // paged library.
  const downloadedPlaylists = useMemo(
    () => (downloadedOnly ? downloadedPlaylistRows : []),
    [downloadedOnly, downloadedPlaylistRows],
  );

  // Every album section emptied by the active filter(s). Individual sections emptied by a
  // filter are hidden rather than placeheld (see the render below), so without this a
  // Favourites filter with nothing starred leaves a screen of missing sections and no
  // explanation for their absence.
  const filteredEmpty = useMemo(() => {
    if (!hasAnyFilters) return false;
    // "Nothing downloaded" is only true once the reads have answered — otherwise entering
    // the filter replaces the whole screen with the empty state for a frame.
    if (downloadedLoading) return false;
    const hasDownloadedAlbums = albumSections.some(
      (s) => s.type === 'downloadedAlbums' && s.albums.length > 0,
    );
    if (hasDownloadedAlbums || downloadedPlaylists.length > 0) return false;
    return albumSections
      .filter((s) => s.type !== 'downloadedAlbums')
      .every((s) => s.albums.length === 0);
  }, [hasAnyFilters, downloadedLoading, albumSections, downloadedPlaylists]);

  return (
    <GradientBackground style={styles.container}>
      {filteredEmpty ? (
        // The Downloaded filter keeps its own copy — "download something" is more
        // actionable than "adjust your filters", and the chip is locked offline anyway.
        // Reaching the other branch means Favourites is the only filter on.
        downloadedOnly ? (
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
          <EmptyState
            icon="heart-outline"
            title={t('noMatchesForFilters')}
            subtitle={t('tryAdjustingFilters')}
          />
        )
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          <ResumeBookmarksSection />
          {albumSections.map((section) => {
            if (section.type === 'downloadedAlbums') {
              // Downloaded Albums renders its own placeholder when empty, and is
              // immediately followed by the downloaded-playlists section.
              return (
                <Fragment key={section.type}>
                  <DownloadedAlbumSection
                    albums={section.albums}
                    colors={colors}
                    loading={downloadedLoading}
                  />
                  <PlaylistSection
                    playlists={downloadedPlaylists}
                    colors={colors}
                    loading={downloadedLoading}
                  />
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
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
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
});
