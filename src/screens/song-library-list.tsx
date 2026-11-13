import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SongListView, type SongLayout } from '../components/SongListView';
import { useDownloadedSongs } from '../hooks/useDownloadedSongs';
import { onPullToRefresh } from '../services/dataSyncService';
import { playTrack } from '../services/playerService';
import {
  listSongs,
  listSongsBefore,
  songCursorOf,
  songListRowToChild,
  type SongListRow,
} from '../db/repository/songs';
import { type Cursor } from '../db/repository/core';
import {
  downloadedSongRowToChild,
  downloadedSongSortKey,
  type DownloadedSongRow,
} from '../db/repository/downloads';
import {
  listAllStarredSongs,
  starredItemOf,
  starredSortKeyOf,
  type StarredItem,
} from '../db/repository/favorites';
import { getDb } from '../store/persistence/db';
import { favoritesStore } from '../store/favoritesStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import type { Child } from '../services/subsonicService';

const PAGE = 120;
/** Alphabet-scroller letters — all active in keyset mode (the loaded window can't
 *  reveal which letters exist; a tap on an empty letter seeks to the next one). */
const ALL_LETTERS = new Set<string>([
  '#',
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
]);

/** Play just the tapped song. Only the paged keyset browse list uses this: a bounded
 *  window can't stand in for the whole library. The Downloaded/Favourites filters are
 *  whole-set reads, so they deliberately leave `onSongPress` unset and let
 *  `SongListView` queue the entire filtered list (making repeat/shuffle act on all of
 *  the downloaded or starred songs). */
const handleSongPress = (song: Child): void => {
  void playTrack(song, [song]);
};

/**
 * Main song browse — reads bounded KEYSET pages from the normalized `songs` table
 * (never loads the whole library into memory). Honors the song sort setting (song
 * title / artist name); A-Z tap seeks via the DB; scrolling pages both directions.
 */
function KeysetSongList({
  layout,
  contentInsetTop,
}: {
  layout: SongLayout;
  contentInsetTop: number;
}) {
  const [rows, setRows] = useState<SongListRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seekTick, setSeekTick] = useState(0);
  const cursorRef = useRef<Cursor | null>(null); // forward (end)
  const prevCursorRef = useRef<Cursor | null>(null); // backward (start)
  const doneRef = useRef(false);
  const busyRef = useRef(false);
  // Bumped by every load that REPLACES the window (first page, letter seek, top seek).
  // A paging load that was already in flight when one of those ran must not write its
  // rows or cursors afterwards — it belongs to a window that no longer exists.
  const loadGenRef = useRef(0);
  // Whether the loaded window begins at the START of the library. `prevCursorRef` cannot
  // answer this: after the first page it holds row 0's own cursor, which is non-null and
  // looks identical to a window that starts mid-library after a letter seek.
  const atLibraryStartRef = useRef(true);
  // Held across the whole prepend -> scroll -> trim transition. `busyRef` cannot do this
  // job: every pager clears it in its own `finally`, so an in-flight load would drop the
  // guard part-way through.
  const transitionRef = useRef(false);
  const sortOrder = layoutPreferencesStore((s) => s.songSortOrder);

  const loadFirstPage = useCallback(async () => {
    const gen = (loadGenRef.current += 1);
    busyRef.current = true;
    try {
      const db = getDb();
      if (!db) return;
      const page = await listSongs(db, { cursor: null, limit: PAGE, sortOrder });
      // A newer load superseded this one — its rows belong to a window that is gone.
      if (gen !== loadGenRef.current) return;
      atLibraryStartRef.current = true;
      cursorRef.current = page.nextCursor;
      doneRef.current = !page.nextCursor;
      prevCursorRef.current = page.rows.length > 0 ? songCursorOf(page.rows[0], sortOrder) : null;
      setRows(page.rows);
    } finally {
      busyRef.current = false;
      setInitialLoading(false);
    }
  }, [sortOrder]);

  const loadMore = useCallback(async () => {
    if (transitionRef.current) return;
    if (busyRef.current || doneRef.current) return;
    const gen = loadGenRef.current;
    busyRef.current = true;
    try {
      const db = getDb();
      if (!db) return;
      const page = await listSongs(db, { cursor: cursorRef.current, limit: PAGE, sortOrder });
      if (gen !== loadGenRef.current) return false;
      cursorRef.current = page.nextCursor;
      if (!page.nextCursor) doneRef.current = true;
      setRows((r) => [...r, ...page.rows]);
    } finally {
      busyRef.current = false;
    }
  }, [sortOrder]);

  const loadPrevious = useCallback(async () => {
    const before = prevCursorRef.current;
    if (transitionRef.current) return;
    if (busyRef.current || !before) return;
    const gen = loadGenRef.current;
    busyRef.current = true;
    try {
      const db = getDb();
      if (!db) return;
      const page = await listSongsBefore(db, { before, limit: PAGE, sortOrder });
      if (gen !== loadGenRef.current) return;
      prevCursorRef.current = page.prevCursor;
      if (page.prevCursor === null) atLibraryStartRef.current = true;
      if (page.rows.length > 0) setRows((r) => [...page.rows, ...r]);
    } finally {
      busyRef.current = false;
    }
  }, [sortOrder]);

  const seekLetter = useCallback(
    async (letter: string) => {
      const gen = (loadGenRef.current += 1);
      busyRef.current = true;
      try {
        const db = getDb();
        if (!db) return;
        const page = await listSongs(db, { letter, limit: PAGE, sortOrder });
        // A newer seek superseded this one — same reasoning.
        if (gen !== loadGenRef.current) return;
        atLibraryStartRef.current = false;
        cursorRef.current = page.nextCursor;
        doneRef.current = !page.nextCursor;
        prevCursorRef.current = page.rows.length > 0 ? songCursorOf(page.rows[0], sortOrder) : null;
        setRows(page.rows);
        setSeekTick((t) => t + 1); // triggers scroll-to-top in SongListView
      } finally {
        busyRef.current = false;
      }
    },
    [sortOrder],
  );

  // iOS status-bar tap, delivered by `StatusBarTapTarget` — the list itself declines it,
  // so nothing has scrolled when we get here. Reset to the first page exactly the way a
  // letter seek does: replace the window, bump the tick. No traversal to flash through.
  const seekTop = useCallback(async (): Promise<boolean> => {
    // Already showing the first page: there is no window to replace, so report that and
    // let the list scroll itself — otherwise the tap does nothing at all.
    if (atLibraryStartRef.current || transitionRef.current) return false;
    transitionRef.current = true;
    try {
      const db = getDb();
      if (!db) return false;
      const gen = (loadGenRef.current += 1);
      const page = await listSongs(db, { cursor: null, limit: PAGE, sortOrder });
      // A newer load superseded this one; it has already moved the list.
      if (gen !== loadGenRef.current) return true;
      cursorRef.current = page.nextCursor;
      doneRef.current = !page.nextCursor;
      prevCursorRef.current = page.rows.length > 0 ? songCursorOf(page.rows[0], sortOrder) : null;
      atLibraryStartRef.current = true;
      setRows(page.rows);
      setSeekTick((t) => t + 1);
      return true;
    } finally {
      transitionRef.current = false;
    }
  }, [sortOrder]);

  // (Re)load from the top on mount and whenever the sort order changes.
  useEffect(() => {
    cursorRef.current = null;
    prevCursorRef.current = null;
    doneRef.current = false;
    setInitialLoading(true);
    void loadFirstPage();
  }, [loadFirstPage]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onPullToRefresh('songs');
      await loadFirstPage();
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  return (
    <SongListView
      items={rows}
      toSong={songListRowToChild}
      layout={layout}
      loading={initialLoading}
      showAlphabetScroller
      activeLetters={ALL_LETTERS}
      onEndReached={loadMore}
      onStartReached={loadPrevious}
      onSeekLetter={seekLetter}
      onScrollToTop={seekTop}
      onRefresh={handleRefresh}
      refreshing={refreshing}
      onSongPress={handleSongPress}
      scrollToTopTrigger={`${sortOrder}:${seekTick}`}
      contentInsetTop={contentInsetTop}
    />
  );
}

/** Downloaded/favorites filters read BOUNDED sources — favourites straight from SQL
 *  (marked library rows + the `favorite_*` remainder), downloaded from the never-reaped
 *  `cached_songs` set. Both come back ORDERED by the same stored `sort_*` keys the main
 *  list's keyset uses, under the same song sort order, so a filter can never reorder the
 *  list; the Favourites TAB is recency-ordered, this filter is the Songs tab with a
 *  predicate. */
function FilteredSongList({
  layout,
  downloadedOnly,
  favoritesOnly,
  contentInsetTop,
}: {
  layout: SongLayout;
  downloadedOnly: boolean;
  favoritesOnly: boolean;
  contentInsetTop: number;
}) {
  const { t } = useTranslation();
  const { rows: downloadedRows, loading } = useDownloadedSongs({
    downloadedOnly: downloadedOnly && !favoritesOnly,
  });
  const version = favoritesStore((s) => s.version);
  const sortOrder = layoutPreferencesStore((s) => s.songSortOrder);
  const [starred, setStarred] = useState<StarredItem<Child>[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // `sortOrder` is part of the key because the ORDER BY is now the DB's: changing the
  // preference has to re-read, not re-sort what we hold.
  const starredKey = `${downloadedOnly}:${version}:${sortOrder}`;
  // DERIVED, not seeded — see the note in `album-library-list.tsx`. A mount-time seed
  // misses the case where Favourites is switched on while Downloaded is already on.
  const starredLoading = favoritesOnly && loadedKey !== starredKey;
  useEffect(() => {
    if (!favoritesOnly) return;
    let alive = true;
    void (async () => {
      const db = getDb();
      const list = db ? await listAllStarredSongs(db, { downloadedOnly, sortOrder }) : [];
      if (alive) {
        setStarred(list);
        setLoadedKey(starredKey);
      }
    })();
    return () => {
      alive = false;
    };
  }, [favoritesOnly, downloadedOnly, version, sortOrder, starredKey]);

  const [refreshing, setRefreshing] = useState(false);
  // Refreshes the SERVER source the branch on screen reads — `getStarred2` for a
  // favourites view, whatever else is filtered on top of it, the song library otherwise.
  // A filter narrows the view, never the source, so this matches the unfiltered list.
  // `onPullToRefresh` holds offline mode's deliberate no-op and the spinner's min
  // duration; each branch's own read re-fires off the store the refresh bumps.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onPullToRefresh(favoritesOnly ? 'favorites' : 'songs');
    } finally {
      setRefreshing(false);
    }
  }, [favoritesOnly]);

  // The key the DOWNLOADED read ordered by, so the scroller letters on it rather than
  // re-deriving one from the envelope. Memoised: a fresh arrow per render would recompute
  // the whole letter set every time.
  const downloadedSortKeyOf = useCallback(
    (r: DownloadedSongRow) => downloadedSongSortKey(r, sortOrder),
    [sortOrder],
  );

  const viewProps = {
    layout,
    onRefresh: handleRefresh,
    refreshing,
    // No `onSongPress`: SongListView's default queues the whole filtered list.
    showAlphabetScroller: true,
    scrollToTopTrigger: `${downloadedOnly}:${favoritesOnly}`,
    contentInsetTop,
    // This component only exists under a filter, so an empty result here always means
    // "the filter removed everything" — never "your library is empty". The unfiltered
    // list (`KeysetSongList`) keeps the "No songs found" copy.
    emptyMessage: t('noMatchesForFilters'),
    emptySubtitle: t('tryAdjustingFilters'),
  };

  // Both branches render the same component in the same slot, so switching filters
  // updates the instance rather than remounting it — which is what the derived loading
  // flags above depend on.
  return favoritesOnly ? (
    <SongListView
      items={starred}
      toSong={starredItemOf}
      sortKeyOf={starredSortKeyOf}
      loading={starredLoading}
      {...viewProps}
    />
  ) : (
    <SongListView
      items={downloadedRows}
      toSong={downloadedSongRowToChild}
      sortKeyOf={downloadedSortKeyOf}
      loading={loading}
      {...viewProps}
    />
  );
}

export function SongLibraryListScreen({
  layout = 'list',
  downloadedOnly = false,
  favoritesOnly = false,
  contentInsetTop = 0,
}: {
  layout?: SongLayout;
  downloadedOnly?: boolean;
  favoritesOnly?: boolean;
  contentInsetTop?: number;
}) {
  return (
    <View style={styles.container}>
      {downloadedOnly || favoritesOnly ? (
        <FilteredSongList
          layout={layout}
          downloadedOnly={downloadedOnly}
          favoritesOnly={favoritesOnly}
          contentInsetTop={contentInsetTop}
        />
      ) : (
        <KeysetSongList layout={layout} contentInsetTop={contentInsetTop} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
