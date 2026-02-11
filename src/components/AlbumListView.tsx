import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme } from '../hooks/useTheme';
import type { AlbumID3 } from '../services/subsonicService';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { AlbumCard } from './AlbumCard';
import { AlbumRow, ROW_HEIGHT } from './AlbumRow';
import { AlphabetScroller } from './AlphabetScroller';

export type AlbumLayout = 'list' | 'grid';

const GRID_COLUMNS = 2;
const GRID_GAP = 10;
const LIST_PADDING = 16;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getFirstLetter(name: string): string {
  const ch = name.charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

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
  /** Optional Ionicons icon name for empty state */
  emptyIcon?: string;
  /** Show the A-Z alphabet scroller on the right (list mode only) */
  showAlphabetScroller?: boolean;
}

export function AlbumListView({
  albums,
  layout = 'list',
  loading = false,
  error = null,
  onRefresh,
  refreshing = false,
  emptyMessage = 'No albums',
  emptyIcon,
  showAlphabetScroller = false,
}: AlbumListViewProps) {
  const { colors } = useTheme();
  const flatListRef = useRef<FlatList<AlbumID3>>(null);

  const screenWidth = Dimensions.get('window').width;
  const cardWidth = useMemo(
    () =>
      (screenWidth - LIST_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) /
      GRID_COLUMNS,
    [screenWidth]
  );

  const renderListItem = useCallback(
    ({ item }: { item: AlbumID3 }) => <AlbumRow album={item} />,
    []
  );

  const renderGridItem = useCallback(
    ({ item }: { item: AlbumID3 }) => (
      <AlbumCard album={item} width={cardWidth} />
    ),
    [cardWidth]
  );

  const keyExtractor = useCallback((item: AlbumID3) => item.id, []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<AlbumID3> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    []
  );

  const columnWrapperStyle = useMemo(
    () => ({ gap: GRID_GAP }),
    []
  );

  const EmptyComponent = useMemo(
    () => (
      <View style={styles.emptyContainer}>
        {emptyIcon && (
          <Ionicons
            name={emptyIcon as any}
            size={48}
            color={colors.textSecondary}
            style={styles.emptyIcon}
          />
        )}
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {emptyMessage}
        </Text>
      </View>
    ),
    [emptyIcon, emptyMessage, colors.textSecondary]
  );

  /* ---- Alphabet scroller support ---- */
  const isList = layout === 'list';
  const scrollerVisible = showAlphabetScroller && isList && albums.length > 0;
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
        flatListRef.current?.scrollToIndex({ index: idx, animated: false });
      }
    },
    [albums, getSortField]
  );

  if (loading && albums.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error && albums.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error}
        </Text>
      </View>
    );
  }

  const isGrid = layout === 'grid';

  return (
    <View style={styles.wrapper}>
      <FlatList
        ref={flatListRef}
        key={layout}
        data={albums}
        renderItem={isGrid ? renderGridItem : renderListItem}
        keyExtractor={keyExtractor}
        {...(isGrid
          ? { numColumns: GRID_COLUMNS, columnWrapperStyle }
          : { getItemLayout })}
        contentContainerStyle={[
          styles.listContent,
          scrollerVisible && styles.listContentWithScroller,
          albums.length === 0 && styles.emptyListContent,
        ]}
        windowSize={11}
        maxToRenderPerBatch={isGrid ? 12 : 20}
        initialNumToRender={isGrid ? 10 : 15}
        removeClippedSubviews
        onRefresh={onRefresh}
        refreshing={refreshing}
        ListEmptyComponent={EmptyComponent}
      />
      {scrollerVisible && (
        <AlphabetScroller
          activeLetters={activeLetters}
          onLetterChange={handleLetterChange}
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyIcon: {
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
  },
});
