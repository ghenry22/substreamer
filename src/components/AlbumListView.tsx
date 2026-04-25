import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSharedValue } from 'react-native-reanimated';

import { useGridColumns, getGridItemPadding, GRID_GAP, LIST_PADDING } from '../hooks/useGridColumns';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { EmptyState } from './EmptyState';
import type { AlbumID3 } from '../services/subsonicService';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { getSortFirstLetter } from '../utils/sortHelpers';
import { serverInfoStore } from '../store/serverInfoStore';
import { AlbumCard } from './AlbumCard';
import { AlbumRow } from './AlbumRow';
import { closeOpenRow } from './SwipeableRow';
import { AlphabetScroller } from './AlphabetScroller';
import { InsetRefreshSpacer } from './InsetRefreshSpacer';

export type AlbumLayout = 'list' | 'grid';

/* ------------------------------------------------------------------ */
/*  AlbumListView                                                     */
/* ------------------------------------------------------------------ */

export interface AlbumListViewProps {
  /** The list of albums to display */
  albums: AlbumID3[];
  /** Display layout: row list or grid of cards */
  layout?: AlbumLayout;
  /** Whether data is currently loading */
  loading?: boolean;
  /** Error message to display, if any */
  error?: string | null;
  /** Called when the user pulls to refresh */
  onRefresh?: () => void;
  /** Whether a refresh is in progress (pull-to-refresh spinner) */
  refreshing?: boolean;
  /** Custom empty-state message */
  emptyMessage?: string;
  /** Custom empty-state subtitle */
  emptySubtitle?: string;
  /** Optional Ionicons icon name for empty state */
  emptyIcon?: string;
  /** Show the A-Z alphabet scroller on the right */
  showAlphabetScroller?: boolean;
  /** When this value changes, the list scrolls to the top */
  scrollToTopTrigger?: string;
  /** Extra top padding so content starts below a floating header but scrolls behind it */
  contentInsetTop?: number;
}

export function AlbumListView({
  albums,
  layout = 'list',
  loading = false,
  error = null,
  onRefresh,
  refreshing = false,
  emptyMessage,
  emptySubtitle,
  emptyIcon,
  showAlphabetScroller = false,
  scrollToTopTrigger,
  contentInsetTop = 0,
}: AlbumListViewProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const resolvedEmptyMessage = emptyMessage ?? t('noAlbumsFound');
  const resolvedEmptySubtitle = emptySubtitle ?? t('tryAdjustingFilters');
  const gridColumns = useGridColumns();
  const listRef = useRef<FlashListRef<AlbumID3>>(null);
  const scrollY = useSharedValue(0);
  const refreshControlKey = useRefreshControlKey();

  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollY.value = e.nativeEvent.contentOffset.y;
    },
    [scrollY],
  );

  const listKey = scrollToTopTrigger ? `${layout}:${scrollToTopTrigger}` : layout;

  const renderListItem = useCallback(
    ({ item }: { item: AlbumID3 }) => <AlbumRow album={item} />,
    []
  );

  const renderGridItem = useCallback(
    ({ item, index }: { item: AlbumID3; index: number }) => {
      const { paddingLeft, paddingRight } = getGridItemPadding(index, gridColumns, GRID_GAP);
      return (
        <View
          style={{
            flex: 1,
            paddingLeft,
            paddingRight,
            marginBottom: GRID_GAP,
          }}
        >
          <AlbumCard album={item} />
        </View>
      );
    },
    [gridColumns]
  );

  const keyExtractor = useCallback((item: AlbumID3) => item.id, []);

  const EmptyComponent = useMemo(
    () => (
      <EmptyState
        icon={(emptyIcon as any) ?? 'albums-outline'}
        title={resolvedEmptyMessage}
        subtitle={resolvedEmptySubtitle}
      />
    ),
    [emptyIcon, resolvedEmptyMessage, resolvedEmptySubtitle]
  );

  /* ---- Alphabet scroller support ---- */
  const scrollerVisible = showAlphabetScroller && albums.length > 0;
  const albumSortOrder = layoutPreferencesStore((s) => s.albumSortOrder);
  const ignoredArticles = serverInfoStore((s) => s.ignoredArticles);

  /** Compute the alphabet-scroller letter for a given album, mirroring
   *  the article-stripped sort key used by `albumLibraryStore`. */
  const getLetter = useCallback(
    (a: AlbumID3): string =>
      albumSortOrder === 'title'
        ? getSortFirstLetter(a.name ?? '', a.sortName, ignoredArticles ?? undefined)
        : getSortFirstLetter(a.artist ?? a.name ?? '', undefined, ignoredArticles ?? undefined),
    [albumSortOrder, ignoredArticles],
  );

  const activeLetters = useMemo(() => {
    if (!scrollerVisible) return new Set<string>();
    return new Set(albums.map((a) => getLetter(a)));
  }, [albums, scrollerVisible, getLetter]);

  const handleLetterChange = useCallback(
    (letter: string) => {
      const idx = albums.findIndex((a) => {
        const first = getLetter(a);
        return letter === '#' ? first === '#' : first === letter;
      });
      if (idx >= 0) {
        listRef.current?.scrollToIndex({ index: idx, animated: false });
      }
    },
    [albums, getLetter]
  );

  if (loading && albums.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error && albums.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error}
        </Text>
      </View>
    );
  }

  const isGrid = layout === 'grid';

  return (
    <View style={styles.wrapper}>
      <FlashList
        ref={listRef}
        key={listKey}
        data={albums}
        renderItem={isGrid ? renderGridItem : renderListItem}
        keyExtractor={keyExtractor}
        onScrollBeginDrag={closeOpenRow}
        numColumns={isGrid ? gridColumns : 1}
        contentContainerStyle={[
          styles.listContent,
          scrollerVisible && styles.listContentWithScroller,
          albums.length === 0 && styles.emptyListContent,
        ]}
        onScroll={contentInsetTop > 0 && Platform.OS === 'ios' ? handleScroll : undefined}
        scrollEventThrottle={contentInsetTop > 0 && Platform.OS === 'ios' ? 16 : undefined}
        ListHeaderComponent={
          contentInsetTop > 0 ? (
            Platform.OS === 'ios' ? (
              <InsetRefreshSpacer
                height={contentInsetTop}
                refreshing={refreshing}
                scrollY={scrollY}
                color={colors.primary}
              />
            ) : (
              <View style={{ height: contentInsetTop }} />
            )
          ) : undefined
        }
        refreshControl={
          onRefresh ? (
            <RefreshControl
              key={refreshControlKey}
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={contentInsetTop > 0 ? 'transparent' : colors.primary}
              colors={[colors.primary]}
              progressViewOffset={contentInsetTop}
            />
          ) : undefined
        }
        drawDistance={300}
        ListEmptyComponent={EmptyComponent}
      />
      {scrollerVisible && (
        <AlphabetScroller
          activeLetters={activeLetters}
          onLetterChange={handleLetterChange}
          topInset={contentInsetTop}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: LIST_PADDING,
    paddingBottom: 32,
  },
  listContentWithScroller: {
    paddingRight: LIST_PADDING + 20,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
  },
});
