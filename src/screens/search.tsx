import { useRouter } from 'expo-router';
import { useIsFocused } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AlbumRow } from '../components/AlbumRow';
import { EmptyState } from '../components/EmptyState';
import { ArtistRow } from '../components/ArtistRow';
import { RecentSearches } from '../components/RecentSearches';
import { SongRow } from '../components/SongRow';
import { useTheme } from '../hooks/useTheme';
import { getLocalTrackUri } from '../services/musicCacheService';
import { playTrack } from '../services/playerService';
import { minDelay } from '../utils/stringHelpers';
import {
  type AlbumID3,
  type ArtistID3,
  type Child,
} from '../services/subsonicService';
import { listDownloadedAlbumIds } from '../db/repository/downloads';
import { favoritesStore } from '../store/favoritesStore';
import { filterBarStore } from '../store/filterBarStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { getDb } from '../store/persistence/db';
import { offlineModeStore } from '../store/offlineModeStore';
import { recentSearchStore } from '../store/recentSearchStore';
import { searchStore } from '../store/searchStore';
import { syncStatusStore } from '../store/syncStatusStore';

/* ------------------------------------------------------------------ */
/*  Section data types                                                */
/* ------------------------------------------------------------------ */

type SectionItem =
  | { type: 'artist'; data: ArtistID3 }
  | { type: 'album'; data: AlbumID3 }
  | { type: 'song'; data: Child };

interface ResultSection {
  titleKey: string;
  data: SectionItem[];
}

/* ------------------------------------------------------------------ */
/*  SearchScreen                                                      */
/* ------------------------------------------------------------------ */

export function SearchScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const isFocused = useIsFocused();
  const headerHeight = searchStore((s) => s.headerHeight);
  const recentSearches = recentSearchStore((s) => s.recentSearches);

  const query = searchStore((s) => s.query);
  const results = searchStore((s) => s.results);
  const loading = searchStore((s) => s.loading);
  const performSearch = searchStore((s) => s.performSearch);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const alwaysUseServerSearch = syncStatusStore((s) => s.alwaysUseServerSearch);

  useEffect(() => {
    if (!isFocused) return;
    const store = filterBarStore.getState();
    store.setLayoutToggle(null);
    store.setDownloadButtonConfig(null);
    store.setHideDownloaded(false);
    store.setHideFavorites(false);
  }, [isFocused]);

  // Re-run the active search when offline/online mode or server-search override flips.
  // `searchLibrary` routes on these flags, so a stale result set from the previous
  // mode must be replaced without the user having to re-type. Skip the mount pass
  // (didModeMount) and empty queries.
  const didModeMount = useRef(false);
  useEffect(() => {
    if (!didModeMount.current) {
      didModeMount.current = true;
      return;
    }
    if (searchStore.getState().query.trim()) void performSearch();
  }, [offlineMode, alwaysUseServerSearch, performSearch]);

  const downloadedOnly = filterBarStore((s) => s.downloadedOnly);
  const favoritesOnly = filterBarStore((s) => s.favoritesOnly);
  // `revision` is the download tables' change signal: the id set below is SQL, and SQL has
  // no Zustand subscription, so without it a download completing (or being deleted) under
  // the user leaves these results silently stale.
  const revision = musicCacheStore((s) => s.revision);
  const includePartial = layoutPreferencesStore((s) => s.includePartialInDownloadedFilter);
  const starredSongIds = favoritesStore((s) => s.songIds);
  const starredAlbumIds = favoritesStore((s) => s.albumIds);
  const starredArtistIds = favoritesStore((s) => s.artistIds);

  // The downloaded ALBUM ids — MEMBERSHIP (`cached_items` alone), because these albums came
  // from the search results and already carry their metadata.
  //
  // `null` means NOT YET KNOWN, and it is a distinct state from "known to be empty" on
  // purpose. The read is asynchronous, so without the distinction the filter has to guess,
  // and both guesses are wrong: an unfiltered fall-through flashes music that is not on the
  // device, and treating a refresh as unknown blanks a populated list every time a download
  // completes. Unknown ⇒ no albums; a refresh keeps the previous answer on screen (the same
  // trade `album-library-list.tsx` makes by keeping its rows while `loading`).
  const [downloadedAlbumIds, setDownloadedAlbumIds] = useState<ReadonlySet<string> | null>(null);
  // `revision` reaches the effect ONLY through this key, so it cannot be dropped without the
  // re-read being dropped with it.
  const downloadedKey = `${includePartial}:${revision}`;
  useEffect(() => {
    if (!downloadedOnly) return;
    let alive = true;
    void (async () => {
      const db = getDb();
      const ids = db ? await listDownloadedAlbumIds(db, { includePartial }) : new Set<string>();
      if (alive) setDownloadedAlbumIds(ids);
    })();
    return () => {
      alive = false;
    };
  }, [downloadedOnly, includePartial, downloadedKey]);
  const downloadedUnknown = downloadedOnly && downloadedAlbumIds === null;

  const filtered = useMemo(() => {
    let artists = results.artists;
    let albums = results.albums;
    let songs = results.songs;

    if (downloadedOnly) {
      // No set yet ⇒ no albums. Never fall through to the unfiltered list: showing music
      // that isn't on the device is the one failure a Downloaded filter must not have.
      albums =
        downloadedAlbumIds === null ? [] : albums.filter((a) => downloadedAlbumIds.has(a.id));
      songs = songs.filter((s) => getLocalTrackUri(s.id) !== null);
      // Artists cannot be downloaded, so the filter drops them outright — the same
      // handling the library and favourites tabs give the Artists segment. Only the
      // ONLINE path reaches this; offline search already returns no artists.
      artists = [];
    }

    if (favoritesOnly) {
      artists = artists.filter((a) => starredArtistIds.has(a.id));
      albums = albums.filter((a) => starredAlbumIds.has(a.id));
      songs = songs.filter((s) => starredSongIds.has(s.id));
    }

    return { artists, albums, songs };
  }, [
    results,
    downloadedOnly,
    favoritesOnly,
    downloadedAlbumIds,
    starredSongIds,
    starredAlbumIds,
    starredArtistIds,
  ]);

  const hasResults =
    filtered.artists.length > 0 ||
    filtered.albums.length > 0 ||
    filtered.songs.length > 0;

  // "The query matched nothing" and "a chip removed every match" get different copy.
  // Search can tell them apart without an extra query because it holds the UNFILTERED
  // result set alongside the filtered one.
  const filteredAway =
    (downloadedOnly || favoritesOnly) &&
    (results.artists.length > 0 || results.albums.length > 0 || results.songs.length > 0);

  // "Nothing to show" is only meaningful once the downloaded set has answered — otherwise
  // entering the filter renders "No results found" over results that are about to appear.
  const busy = loading || downloadedUnknown;

  const sections: ResultSection[] = useMemo(() => {
    const result: ResultSection[] = [];
    if (filtered.artists.length > 0) {
      result.push({
        titleKey: 'artists',
        data: filtered.artists.map((a) => ({ type: 'artist' as const, data: a })),
      });
    }
    if (filtered.albums.length > 0) {
      result.push({
        titleKey: 'albums',
        data: filtered.albums.map((a) => ({ type: 'album' as const, data: a })),
      });
    }
    if (filtered.songs.length > 0) {
      result.push({
        titleKey: 'songs',
        data: filtered.songs.map((s) => ({ type: 'song' as const, data: s })),
      });
    }
    return result;
  }, [filtered]);

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (!query.trim()) return;
    setRefreshing(true);
    const delay = minDelay();
    await performSearch();
    await delay;
    setRefreshing(false);
  }, [query, performSearch]);

  const renderItem = useCallback(
    ({ item }: { item: SectionItem }) => {
      // Tapping a result is the "this search led somewhere" signal — record the
      // live query (read lazily so these closures don't churn per keystroke),
      // then perform the row's normal action.
      const recordCurrent = () =>
        recentSearchStore.getState().record(searchStore.getState().query);
      switch (item.type) {
        case 'artist':
          return (
            <ArtistRow
              artist={item.data}
              onPress={() => {
                recordCurrent();
                router.push(`/artist/${item.data.id}`);
              }}
            />
          );
        case 'album':
          return (
            <AlbumRow
              album={item.data}
              onPress={() => {
                recordCurrent();
                router.push(`/album/${item.data.id}`);
              }}
            />
          );
        case 'song':
          return (
            <SongRow
              song={item.data}
              onPress={() => {
                recordCurrent();
                playTrack(item.data, [item.data]);
              }}
            />
          );
      }
    },
    [router]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: ResultSection }) => (
      <Text style={[styles.sectionTitle, { color: colors.label }]}>
        {t(section.titleKey)}
      </Text>
    ),
    [colors.label, t]
  );

  const keyExtractor = useCallback(
    (item: SectionItem, index: number) => `${item.type}-${item.data.id}-${index}`,
    []
  );

  // Empty box: show recent-searches history when present, otherwise the
  // original placeholder (offline-aware).
  if (!query.trim()) {
    if (recentSearches.length > 0) {
      return <RecentSearches paddingTop={headerHeight} />;
    }
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <EmptyState
          icon="search-outline"
          title={offlineMode ? t('searchDownloadedMusic') : t('searchForMusic')}
          subtitle={offlineMode ? t('findDownloadedMusic') : t('findMusic')}
        />
      </View>
    );
  }

  // Query present, a search/refresh (or the downloaded-set read) in flight with nothing to
  // show yet — a spinner, not a blank screen. Covers the first search and an offline↔online
  // switch with no prior results.
  if (busy && !hasResults) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <View style={styles.loadingCentered}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {t('searching')}
          </Text>
        </View>
      </View>
    );
  }

  // Query present, no results, nothing in flight: no-results placeholder.
  if (!hasResults && !busy) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <EmptyState
          icon="search-outline"
          title={filteredAway ? t('noMatchesForFilters') : t('noResultsFound')}
          subtitle={filteredAway ? t('tryAdjustingFilters') : t('noResultsFor', { query })}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* A refresh in flight while previous results stay visible — e.g. flipping
          offline↔online, or a new keystroke. A top strip so the user sees the
          results are being updated rather than the screen sitting silently. */}
      {loading && (
        <View
          style={[
            styles.loadingStrip,
            {
              top: headerHeight,
              backgroundColor: colors.background,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingStripText, { color: colors.textSecondary }]}>
            {t('searching')}
          </Text>
        </View>
      )}
      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={keyExtractor}
        contentContainerStyle={[styles.listContent, { paddingTop: headerHeight + 16 }]}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  loadingCentered: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
  },
  loadingStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  loadingStripText: {
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
    marginLeft: 4,
  },
});
