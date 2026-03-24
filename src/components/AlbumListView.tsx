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
import { useSharedValue } from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { EmptyState } from './EmptyState';
import type { AlbumID3 } from '../services/subsonicService';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { getFirstLetter } from '../utils/stringHelpers';
import { AlbumCard } from './AlbumCard';
import { AlbumRow } from './AlbumRow';
import { closeOpenRow } from './SwipeableRow';
import { AlphabetScroller } from './AlphabetScroller';
import { InsetRefreshSpacer } from './InsetRefreshSpacer';

export type AlbumLayout = 'list' | 'grid';

const GRID_COLUMNS = 2;
const GRID_GAP = 10;
const LIST_PADDING = 16;

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
  emptyMessage = 'No albums found',
  emptySubtitle = 'Try adjusting your filters, or pull to refresh',
  emptyIcon,
  showAlphabetScroller = false,
  scrollToTopTrigger,
  contentInsetTop = 0,
}: AlbumListViewProps) {
  const { colors } = useTheme();
  const listRef = useRef<FlashListRef<AlbumID3>>(null);
  const scrollY = useSharedValue(0);

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
      const isLeftColumn = index % GRID_COLUMNS === 0;
      return (
        <View
          style={{
            flex: 1,
            paddingLeft: isLeftColumn ? 0 : GRID_GAP / 2,
            paddingRight: isLeftColumn ? GRID_GAP / 2 : 0,
            marginBottom: GRID_GAP,
          }}
        >
          <AlbumCard album={item} />
        </View>
      );
    },
    []
  );

  const keyExtractor = useCallback((item: AlbumID3) => item.id, []);

  const EmptyComponent = useMemo(
    () => (
      <EmptyState
        icon={(emptyIcon as any) ?? 'albums-outline'}
        title={emptyMessage}
        subtitle={emptySubtitle}
      />
    ),
    [emptyIcon, emptyMessage, emptySubtitle]
  );

  /* ---- Alphabet scroller support ---- */
  const scrollerVisible = showAlphabetScroller && albums.length > 0;
  const albumSortOrder = layoutPreferencesStore((s) => s.albumSortOrder);

  /** Return the field the list is currently sorted by for a given album. */
  const getSortField = useCallback(
    (a: AlbumID3) => (albumSortOrder === 'title' ? a.name : (a.artist ?? a.name)),
    [albumSortOrder]
  );

  const activeLetters = useMemo(() => {
    if (!scrollerVisible) return new Set<string>();
    return new Set(albums.map((a) => getFirstLetter(getSortField(a))));
  }, [albums, scrollerVisible, getSortField]);

  const handleLetterChange = useCallback(
    (letter: string) => {
      const idx = albums.findIndex((a) => {
        const first = getFirstLetter(getSortField(a));
        return letter === '#' ? first === '#' : first === letter;
      });
      if (idx >= 0) {
        listRef.current?.scrollToIndex({ index: idx, animated: false });
      }
    },
    [albums, getSortField]
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
        numColumns={isGrid ? GRID_COLUMNS : 1}
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
