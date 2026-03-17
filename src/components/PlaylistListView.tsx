import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme } from '../hooks/useTheme';
import type { Playlist } from '../services/subsonicService';
import { getFirstLetter } from '../utils/stringHelpers';
import { EmptyState } from './EmptyState';
import { PlaylistCard } from './PlaylistCard';
import { PlaylistRow } from './PlaylistRow';
import { closeOpenRow } from './SwipeableRow';
import { AlphabetScroller } from './AlphabetScroller';

export type PlaylistLayout = 'list' | 'grid';

const GRID_COLUMNS = 2;
const GRID_GAP = 10;
const LIST_PADDING = 16;

/* ------------------------------------------------------------------ */
/*  PlaylistListView                                                  */
/* ------------------------------------------------------------------ */

export interface PlaylistListViewProps {
  /** The list of playlists to display */
  playlists: Playlist[];
  /** Display layout: row list or grid of cards */
  layout?: PlaylistLayout;
  /** Whether data is currently loading */
  loading?: boolean;
  /** Error message to display, if any */
  error?: string | null;
  /** Called when the user pulls to refresh */
  onRefresh?: () => void;
  /** Whether a refresh is in progress (pull-to-refresh spinner) */
  refreshing?: boolean;
  /** Show the A-Z alphabet scroller on the right */
  showAlphabetScroller?: boolean;
  /** Custom empty-state message */
  emptyMessage?: string;
  /** Custom empty-state subtitle */
  emptySubtitle?: string;
  /** Ionicons icon name for the empty state */
  emptyIcon?: string;
  /** When this value changes, the list scrolls to the top */
  scrollToTopTrigger?: string;
}

export function PlaylistListView({
  playlists,
  layout = 'list',
  loading = false,
  error = null,
  onRefresh,
  refreshing = false,
  showAlphabetScroller = false,
  emptyMessage = 'No playlists',
  emptySubtitle = 'Playlists from your server will appear here. Pull to refresh to check for updates.',
  emptyIcon = 'list-outline',
  scrollToTopTrigger,
}: PlaylistListViewProps) {
  const { colors } = useTheme();
  const listRef = useRef<FlashListRef<Playlist>>(null);

  const listKey = scrollToTopTrigger ? `${layout}:${scrollToTopTrigger}` : layout;

  const screenWidth = Dimensions.get('window').width;
  const cardWidth = useMemo(
    () =>
      (screenWidth - LIST_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) /
      GRID_COLUMNS,
    [screenWidth]
  );

  const renderListItem = useCallback(
    ({ item }: { item: Playlist }) => <PlaylistRow playlist={item} />,
    []
  );

  const renderGridItem = useCallback(
    ({ item, index }: { item: Playlist; index: number }) => {
      const isLeftColumn = index % GRID_COLUMNS === 0;
      return (
        <View
          style={{
            flex: 1,
            paddingLeft: isLeftColumn ? 0 : GRID_GAP / 2,
            paddingRight: isLeftColumn ? GRID_GAP / 2 : 0,
          }}
        >
          <PlaylistCard playlist={item} width={cardWidth} />
        </View>
      );
    },
    [cardWidth]
  );

  const keyExtractor = useCallback((item: Playlist) => item.id, []);

  const EmptyComponent = useMemo(
    () => (
      <EmptyState
        icon={emptyIcon as any}
        title={emptyMessage}
        subtitle={emptySubtitle}
      />
    ),
    [emptyIcon, emptyMessage, emptySubtitle]
  );

  /* ---- Alphabet scroller support ---- */
  const scrollerVisible = showAlphabetScroller && playlists.length > 0;

  const activeLetters = useMemo(() => {
    if (!scrollerVisible) return new Set<string>();
    return new Set(playlists.map((p) => getFirstLetter(p.name)));
  }, [playlists, scrollerVisible]);

  const handleLetterChange = useCallback(
    (letter: string) => {
      const idx = playlists.findIndex((p) => {
        const first = getFirstLetter(p.name);
        if (letter === '#') return first === '#';
        return first === letter;
      });
      if (idx >= 0) {
        listRef.current?.scrollToIndex({ index: idx, animated: false });
      }
    },
    [playlists]
  );

  if (loading && playlists.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error && playlists.length === 0) {
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
      <FlashList
        ref={listRef}
        key={listKey}
        data={playlists}
        renderItem={isGrid ? renderGridItem : renderListItem}
        keyExtractor={keyExtractor}
        onScrollBeginDrag={closeOpenRow}
        numColumns={isGrid ? GRID_COLUMNS : 1}
        contentContainerStyle={[
          styles.listContent,
          scrollerVisible && styles.listContentWithScroller,
          playlists.length === 0 && styles.emptyListContent,
        ]}
        drawDistance={300}
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
});
