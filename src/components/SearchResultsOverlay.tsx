import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
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

const COVER_SIZE = 150;
const TOTAL_BUDGET = 9;
const DEFAULT_PER_CATEGORY = 3;

/* ------------------------------------------------------------------ */
/*  Result redistribution logic                                       */
/* ------------------------------------------------------------------ */

function getSlotCounts(
  artistCount: number,
  albumCount: number,
  songCount: number
): { artists: number; albums: number; songs: number } {
  const categories = [
    { key: 'artists' as const, count: artistCount },
    { key: 'albums' as const, count: albumCount },
    { key: 'songs' as const, count: songCount },
  ];

  const nonEmpty = categories.filter((c) => c.count > 0);
  if (nonEmpty.length === 0) return { artists: 0, albums: 0, songs: 0 };

  // Distribute total budget among non-empty categories
  const perCategory = Math.floor(TOTAL_BUDGET / nonEmpty.length);
  let remainder = TOTAL_BUDGET - perCategory * nonEmpty.length;

  const slots: Record<string, number> = { artists: 0, albums: 0, songs: 0 };
  for (const cat of nonEmpty) {
    slots[cat.key] = Math.min(cat.count, perCategory + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }

  return slots as { artists: number; albums: number; songs: number };
}

/* ------------------------------------------------------------------ */
/*  Compact result rows                                               */
/* ------------------------------------------------------------------ */

function CompactArtistRow({
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
      style={({ pressed }) => [styles.compactRow, pressed && styles.pressed]}
    >
      <Image source={{ uri }} style={styles.compactCoverCircle} resizeMode="cover" />
      <View style={styles.compactText}>
        <Text style={[styles.compactPrimary, { color: colors.textPrimary }]} numberOfLines={1}>
          {artist.name}
        </Text>
        <Text style={[styles.compactSecondary, { color: colors.textSecondary }]} numberOfLines={1}>
          {artist.albumCount === 1 ? '1 album' : `${artist.albumCount} albums`}
        </Text>
      </View>
    </Pressable>
  );
}

function CompactAlbumRow({
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
      style={({ pressed }) => [styles.compactRow, pressed && styles.pressed]}
    >
      <Image source={{ uri }} style={styles.compactCover} resizeMode="cover" />
      <View style={styles.compactText}>
        <Text style={[styles.compactPrimary, { color: colors.textPrimary }]} numberOfLines={1}>
          {album.name}
        </Text>
        <Text style={[styles.compactSecondary, { color: colors.textSecondary }]} numberOfLines={1}>
          {album.artist ?? 'Unknown Artist'}
        </Text>
      </View>
    </Pressable>
  );
}

function CompactSongRow({
  song,
  colors,
  onPress,
}: {
  song: Child;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  const uri = getCoverArtUrl(song.coverArt ?? '', COVER_SIZE) ?? undefined;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.compactRow, pressed && styles.pressed]}
    >
      <Image source={{ uri }} style={styles.compactCover} resizeMode="cover" />
      <View style={styles.compactText}>
        <Text style={[styles.compactPrimary, { color: colors.textPrimary }]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={[styles.compactSecondary, { color: colors.textSecondary }]} numberOfLines={1}>
          {song.artist ?? 'Unknown Artist'}
        </Text>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  SearchResultsOverlay                                              */
/* ------------------------------------------------------------------ */

export function SearchResultsOverlay() {
  const { colors } = useTheme();
  const router = useRouter();

  const isOverlayVisible = searchStore((s) => s.isOverlayVisible);
  const results = searchStore((s) => s.results);
  const loading = searchStore((s) => s.loading);
  const query = searchStore((s) => s.query);
  const headerHeight = searchStore((s) => s.headerHeight);
  const hideOverlay = searchStore((s) => s.hideOverlay);

  const slots = useMemo(
    () =>
      getSlotCounts(
        results.artists.length,
        results.albums.length,
        results.songs.length
      ),
    [results.artists.length, results.albums.length, results.songs.length]
  );

  const hasResults =
    results.artists.length > 0 ||
    results.albums.length > 0 ||
    results.songs.length > 0;

  const handleBackdropPress = useCallback(() => {
    hideOverlay();
    Keyboard.dismiss();
  }, [hideOverlay]);

  const handleSeeMore = useCallback(() => {
    hideOverlay();
    Keyboard.dismiss();
    router.push('/(tabs)/search');
  }, [hideOverlay, router]);

  const navigateToArtist = useCallback(
    (id: string) => {
      hideOverlay();
      Keyboard.dismiss();
      router.push(`/artist/${id}`);
    },
    [hideOverlay, router]
  );

  const navigateToAlbum = useCallback(
    (id: string) => {
      hideOverlay();
      Keyboard.dismiss();
      router.push(`/album/${id}`);
    },
    [hideOverlay, router]
  );

  if (!isOverlayVisible || !query.trim()) return null;

  return (
    <View style={[styles.overlay, { top: headerHeight }]}>
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={handleBackdropPress} />

      {/* Results card */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        {loading && !hasResults ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : !hasResults && query.trim() ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No results found
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Artists */}
            {slots.artists > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.label }]}>
                  Artists
                </Text>
                {results.artists.slice(0, slots.artists).map((artist) => (
                  <CompactArtistRow
                    key={artist.id}
                    artist={artist}
                    colors={colors}
                    onPress={() => navigateToArtist(artist.id)}
                  />
                ))}
              </View>
            )}

            {/* Albums */}
            {slots.albums > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.label }]}>
                  Albums
                </Text>
                {results.albums.slice(0, slots.albums).map((album) => (
                  <CompactAlbumRow
                    key={album.id}
                    album={album}
                    colors={colors}
                    onPress={() => navigateToAlbum(album.id)}
                  />
                ))}
              </View>
            )}

            {/* Songs */}
            {slots.songs > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.label }]}>
                  Songs
                </Text>
                {results.songs.slice(0, slots.songs).map((song) => (
                  <CompactSongRow
                    key={song.id}
                    song={song}
                    colors={colors}
                    onPress={() => {}}
                  />
                ))}
              </View>
            )}

            {/* See more link */}
            <Pressable
              onPress={handleSeeMore}
              style={({ pressed }) => [
                styles.seeMoreButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.seeMoreText, { color: colors.primary }]}>
                See more results
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </Pressable>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    elevation: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    marginHorizontal: 12,
    marginTop: 4,
    borderRadius: 14,
    maxHeight: 420,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingVertical: 8,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
  },
  section: {
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 8,
    marginLeft: 4,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  pressed: {
    opacity: 0.7,
  },
  compactCover: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  compactCoverCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  compactText: {
    flex: 1,
    marginLeft: 10,
  },
  compactPrimary: {
    fontSize: 15,
    fontWeight: '500',
  },
  compactSecondary: {
    fontSize: 13,
    marginTop: 1,
  },
  seeMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  seeMoreText: {
    fontSize: 15,
    fontWeight: '600',
    marginRight: 4,
  },
});
