import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumOptionsSheet } from '../components/AlbumOptionsSheet';
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { TrackRow } from '../components/TrackRow';
import { useColorExtraction } from '../hooks/useColorExtraction';
import { useTheme } from '../hooks/useTheme';
import {
  ensureCoverArtAuth,
  getAlbum,
  getCoverArtUrl,
  type AlbumWithSongsID3,
  type Child,
} from '../services/subsonicService';

const HERO_PADDING = 24;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = 44;

function groupTracksByDisc(songs: Child[]): Map<number, Child[]> {
  const sorted = [...songs].sort((a, b) => {
    const discA = a.discNumber ?? 1;
    const discB = b.discNumber ?? 1;
    if (discA !== discB) return discA - discB;
    return (a.track ?? 0) - (b.track ?? 0);
  });
  const map = new Map<number, Child[]>();
  for (const s of sorted) {
    const disc = s.discNumber ?? 1;
    if (!map.has(disc)) map.set(disc, []);
    map.get(disc)!.push(s);
  }
  return map;
}

export function AlbumDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [album, setAlbum] = useState<AlbumWithSongsID3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const { coverBackgroundColor, gradientOpacity } = useColorExtraction(
    album?.coverArt,
    colors.background,
  );

  /* ---- Header right: more options button ---- */
  useEffect(() => {
    if (!album) return;
    navigation.setOptions({
      headerRight: () => (
        <MoreOptionsButton
          onPress={() => setSheetVisible(true)}
          color={colors.textPrimary}
        />
      ),
    });
  }, [album, navigation, colors.textPrimary]);

  const handleStarChanged = useCallback(
    (_albumId: string, starred: boolean) => {
      setAlbum((prev) => {
        if (!prev) return prev;
        return { ...prev, starred: starred ? new Date() : undefined };
      });
    },
    []
  );

  /* ---- Data fetching ---- */
  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id) {
      setError('Missing album id');
      if (!isRefresh) setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const minDelay = isRefresh
        ? new Promise((resolve) => setTimeout(resolve, 2000))
        : null;
      await ensureCoverArtAuth();
      const data = await getAlbum(id);
      setAlbum(data);
      if (!data) setError('Album not found');
      await minDelay;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load album');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

  const discs = useMemo(() => {
    if (!album?.song?.length) return new Map<number, Child[]>();
    return groupTracksByDisc(album.song);
  }, [album?.song]);

  const hasMultipleDiscs = discs.size > 1;

  const gradientStart = coverBackgroundColor ?? colors.background;

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !album) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error ?? 'Album not found'}
        </Text>
      </View>
    );
  }

  const coverUri = getCoverArtUrl(album.coverArt ?? '', HERO_COVER_SIZE) ?? undefined;
  const gradientEnd = colors.background;

  const gradientFillStyle = [
    StyleSheet.absoluteFillObject,
    { top: -insets.top, left: 0, right: 0, bottom: 0 },
  ];

  return (
    <View style={styles.container}>
        <View style={[gradientFillStyle, { backgroundColor: colors.background }]} />
        <Animated.View
          style={[gradientFillStyle, { opacity: gradientOpacity }]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={[gradientStart, gradientEnd]}
            locations={[0, 0.5]}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.content,
            Platform.OS !== 'ios' && { paddingTop: insets.top + HEADER_BAR_HEIGHT },
          ]}
          contentInset={Platform.OS === 'ios' ? { top: insets.top + HEADER_BAR_HEIGHT } : undefined}
          contentOffset={Platform.OS === 'ios' ? { x: 0, y: -(insets.top + HEADER_BAR_HEIGHT) } : undefined}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              progressViewOffset={insets.top + HEADER_BAR_HEIGHT}
            />
          }
        >
      <View style={styles.hero}>
        <View style={styles.heroImageWrap}>
          <Image
            source={{ uri: coverUri }}
            style={styles.heroImage}
            resizeMode="contain"
          />
        </View>
      </View>
      <View style={styles.info}>
        <Text style={[styles.albumName, { color: colors.textPrimary }]}>
          {album.name}
        </Text>
        <Text style={[styles.artistName, { color: colors.textSecondary }]}>
          {album.artist ?? album.displayArtist ?? 'Unknown Artist'}
        </Text>
        {album.year ? (
          <Text style={[styles.albumYear, { color: colors.textSecondary }]}>
            {album.year}
          </Text>
        ) : null}
      </View>

      {discs.size === 0 ? (
        <Text style={[styles.emptyTracks, { color: colors.textSecondary }]}>
          No tracks
        </Text>
      ) : (
        <View style={styles.trackList}>
          {Array.from(discs.entries()).map(([discNum, tracks]) => (
            <View key={discNum} style={styles.discSection}>
              {hasMultipleDiscs && (
                <Text style={[styles.discTitle, { color: colors.label }]}>
                  Disc {discNum}
                </Text>
              )}
              {tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  trackNumber={track.track != null ? `${track.track}. ` : undefined}
                  colors={colors}
                />
              ))}
            </View>
          ))}
        </View>
      )}
        </ScrollView>

      {album && (
        <AlbumOptionsSheet
          album={album}
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          onStarChanged={handleStarChanged}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hero: {
    width: '100%',
    paddingTop: HERO_PADDING / 2,
    paddingHorizontal: HERO_PADDING,
    paddingBottom: HERO_PADDING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImageWrap: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  info: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  albumName: {
    fontSize: 24,
    fontWeight: '700',
  },
  albumYear: {
    fontSize: 16,
    fontWeight: '400',
    marginTop: 4,
  },
  artistName: {
    fontSize: 16,
    marginTop: 4,
  },
  trackList: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  discSection: {
    marginBottom: 24,
  },
  discTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  emptyTracks: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 16,
  },
});
