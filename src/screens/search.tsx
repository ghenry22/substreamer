import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import {
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme } from '../hooks/useTheme';
import {
  getCoverArtUrl,
  type AlbumID3,
  type ArtistID3,
  type Child,
} from '../services/subsonicService';
import { searchStore } from '../store/searchStore';

const COVER_SIZE = 300;

/* ------------------------------------------------------------------ */
/*  Section data types                                                */
/* ------------------------------------------------------------------ */

type SectionItem =
  | { type: 'artist'; data: ArtistID3 }
  | { type: 'album'; data: AlbumID3 }
  | { type: 'song'; data: Child };

interface ResultSection {
  title: string;
  data: SectionItem[];
}

/* ------------------------------------------------------------------ */
/*  Result row components                                             */
/* ------------------------------------------------------------------ */

function ArtistResultRow({
  artist,
  colors,
  onPress,
}: {
  artist: ArtistID3;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  const uri = getCoverArtUrl(artist.coverArt ?? '', COVER_SIZE) ?? undefined;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card },
        pressed && styles.pressed,
      ]}
    >
      <Image source={{ uri }} style={styles.coverCircle} resizeMode="cover" />
      <View style={styles.rowText}>
        <Text style={[styles.primaryText, { color: colors.textPrimary }]} numberOfLines={1}>
          {artist.name}
        </Text>
        <View style={styles.meta}>
          <Ionicons name="disc-outline" size={14} color={colors.primary} />
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            {artist.albumCount === 1 ? '1 album' : `${artist.albumCount} albums`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function AlbumResultRow({
  album,
  colors,
  onPress,
}: {
  album: AlbumID3;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  const uri = getCoverArtUrl(album.coverArt ?? '', COVER_SIZE) ?? undefined;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card },
        pressed && styles.pressed,
      ]}
    >
      <Image source={{ uri }} style={styles.cover} resizeMode="cover" />
      <View style={styles.rowText}>
        <Text style={[styles.primaryText, { color: colors.textPrimary }]} numberOfLines={1}>
          {album.name}
        </Text>
        <Text style={[styles.secondaryText, { color: colors.textSecondary }]} numberOfLines={1}>
          {album.artist ?? 'Unknown Artist'}
        </Text>
      </View>
    </Pressable>
  );
}

function SongResultRow({
  song,
  colors,
}: {
  song: Child;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const uri = getCoverArtUrl(song.coverArt ?? '', COVER_SIZE) ?? undefined;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card },
        pressed && styles.pressed,
      ]}
    >
      <Image source={{ uri }} style={styles.cover} resizeMode="cover" />
      <View style={styles.rowText}>
        <Text style={[styles.primaryText, { color: colors.textPrimary }]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={[styles.secondaryText, { color: colors.textSecondary }]} numberOfLines={1}>
          {song.artist ?? 'Unknown Artist'}
          {song.album ? ` \u2022 ${song.album}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  SearchScreen                                                      */
/* ------------------------------------------------------------------ */

export function SearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const query = searchStore((s) => s.query);
  const results = searchStore((s) => s.results);
  const loading = searchStore((s) => s.loading);
  const performSearch = searchStore((s) => s.performSearch);

  const hasResults =
    results.artists.length > 0 ||
    results.albums.length > 0 ||
    results.songs.length > 0;

  // Build sections from results
  const sections: ResultSection[] = [];
  if (results.artists.length > 0) {
    sections.push({
      title: 'Artists',
      data: results.artists.map((a) => ({ type: 'artist' as const, data: a })),
    });
  }
  if (results.albums.length > 0) {
    sections.push({
      title: 'Albums',
      data: results.albums.map((a) => ({ type: 'album' as const, data: a })),
    });
  }
  if (results.songs.length > 0) {
    sections.push({
      title: 'Songs',
      data: results.songs.map((s) => ({ type: 'song' as const, data: s })),
    });
  }

  const handleRefresh = useCallback(() => {
    if (query.trim()) performSearch();
  }, [query, performSearch]);

  const renderItem = useCallback(
    ({ item }: { item: SectionItem }) => {
      switch (item.type) {
        case 'artist':
          return (
            <ArtistResultRow
              artist={item.data}
              colors={colors}
              onPress={() => router.push(`/artist/${item.data.id}`)}
            />
          );
        case 'album':
          return (
            <AlbumResultRow
              album={item.data}
              colors={colors}
              onPress={() => router.push(`/album/${item.data.id}`)}
            />
          );
        case 'song':
          return <SongResultRow song={item.data} colors={colors} />;
      }
    },
    [colors, router]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: ResultSection }) => (
      <Text style={[styles.sectionTitle, { color: colors.label }]}>
        {section.title}
      </Text>
    ),
    [colors.label]
  );

  const keyExtractor = useCallback(
    (item: SectionItem, index: number) => `${item.type}-${item.data.id}-${index}`,
    []
  );

  // Empty state: no query or no results
  if (!query.trim() || (!hasResults && !loading)) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.emptyContainer}>
          <Ionicons
            name="search-outline"
            size={56}
            color={colors.textSecondary}
            style={styles.emptyIcon}
          />
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
            {!query.trim()
              ? 'Search for music'
              : 'No results found'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {!query.trim()
              ? 'Find songs, albums, and artists'
              : `No results for "${query}"`}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        onRefresh={handleRefresh}
        refreshing={loading}
        keyboardShouldPersistTaps="handled"
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    marginBottom: 6,
  },
  pressed: {
    opacity: 0.85,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  coverCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryText: {
    fontSize: 14,
    marginTop: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  metaText: {
    fontSize: 13,
    marginLeft: 4,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
  },
});
