import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumRow } from '../components/AlbumRow';
import { useTheme } from '../hooks/useTheme';
import {
  ensureCoverArtAuth,
  getArtist,
  getArtistInfo2,
  getCoverArtUrl,
  getTopSongs,
  type ArtistID3,
  type ArtistInfo2,
  type ArtistWithAlbumsID3,
  type Child,
} from '../services/subsonicService';

const HERO_PADDING = 24;
const HERO_IMAGE_SIZE = 180;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = 44;
const SIMILAR_THUMB_SIZE = 72;
const SONG_THUMB_SIZE = 72;

/* ------------------------------------------------------------------ */
/*  Color extraction helpers (shared pattern with album/playlist)     */
/* ------------------------------------------------------------------ */

type ExtractedColors = {
  vibrant?: string;
  lightVibrant?: string;
  darkVibrant?: string;
  dominant?: string;
  primary?: string;
  background?: string;
  secondary?: string;
  detail?: string;
};

function getProminentColor(result: ExtractedColors): string | null {
  if (result.primary && typeof result.primary === 'string') return result.primary;
  if (result.darkVibrant && typeof result.darkVibrant === 'string') return result.darkVibrant;
  return null;
}

/** Strip HTML tags from a string (Last.fm bios often include links). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/* ------------------------------------------------------------------ */
/*  Section title component                                           */
/* ------------------------------------------------------------------ */

function SectionTitle({ title, color }: { title: string; color: string }) {
  return <Text style={[styles.sectionTitle, { color }]}>{title}</Text>;
}

/* ------------------------------------------------------------------ */
/*  Similar artist thumbnail                                          */
/* ------------------------------------------------------------------ */

function SimilarArtistItem({
  artist,
  colors,
}: {
  artist: ArtistID3;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const router = useRouter();
  const uri = getCoverArtUrl(artist.coverArt ?? '', 300) ?? undefined;

  const onPress = useCallback(() => {
    router.push(`/artist/${artist.id}`);
  }, [artist.id, router]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.similarItem, pressed && styles.pressed]}
    >
      <Image
        source={{ uri }}
        style={styles.similarImage}
        resizeMode="cover"
      />
      <Text
        style={[styles.similarName, { color: colors.textPrimary }]}
        numberOfLines={2}
      >
        {artist.name}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Top song thumbnail                                                */
/* ------------------------------------------------------------------ */

function TopSongItem({
  song,
  colors,
}: {
  song: Child;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const uri = getCoverArtUrl(song.coverArt ?? '', 300) ?? undefined;

  return (
    <View style={styles.songItem}>
      <Image
        source={{ uri }}
        style={styles.songImage}
        resizeMode="cover"
      />
      <Text
        style={[styles.songTitle, { color: colors.textPrimary }]}
        numberOfLines={1}
      >
        {song.title}
      </Text>
      {song.artist && (
        <Text
          style={[styles.songArtist, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {song.artist}
        </Text>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Main screen                                                       */
/* ------------------------------------------------------------------ */

export function ArtistDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [artist, setArtist] = useState<ArtistWithAlbumsID3 | null>(null);
  const [artistInfo, setArtistInfo] = useState<ArtistInfo2 | null>(null);
  const [topSongs, setTopSongs] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [coverBackgroundColor, setCoverBackgroundColor] = useState<string | null>(null);
  const gradientOpacity = useRef(new Animated.Value(0)).current;

  /* ---- Data fetching ---- */
  useEffect(() => {
    if (!id) {
      setError('Missing artist id');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await ensureCoverArtAuth();
        if (cancelled) return;

        const [artistData, infoData] = await Promise.all([
          getArtist(id),
          getArtistInfo2(id),
        ]);
        if (cancelled) return;

        setArtist(artistData);
        setArtistInfo(infoData);
        if (!artistData) {
          setError('Artist not found');
        } else {
          // Fetch top songs after we have the artist name
          getTopSongs(artistData.name, 20).then((songs) => {
            if (!cancelled) setTopSongs(songs);
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load artist');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ---- Color extraction ---- */
  useEffect(() => {
    const coverArt = artist?.coverArt;
    if (!coverArt) {
      setCoverBackgroundColor(null);
      return;
    }
    if (Constants.appOwnership === 'expo') {
      setCoverBackgroundColor(null);
      return;
    }
    const uri = getCoverArtUrl(coverArt, 50);
    if (!uri) {
      setCoverBackgroundColor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getColors } = await import('react-native-image-colors');
        const result = await getColors(uri, {
          fallback: colors.background,
          quality: 'low',
        });
        if (cancelled) return;
        const prominent = getProminentColor(result as ExtractedColors);
        setCoverBackgroundColor(prominent ?? null);
      } catch {
        if (!cancelled) setCoverBackgroundColor(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artist?.coverArt, colors.background]);

  /* ---- Gradient animation ---- */
  useEffect(() => {
    if (coverBackgroundColor) {
      gradientOpacity.setValue(0);
      Animated.timing(gradientOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(gradientOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [coverBackgroundColor]);

  /* ---- Derived values ---- */
  const gradientStart = coverBackgroundColor ?? colors.background;
  const gradientEnd = colors.background;

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  /* ---- Error state ---- */
  if (error || !artist) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error ?? 'Artist not found'}
        </Text>
      </View>
    );
  }

  /* ---- Resolved image URI ---- */
  const heroUri =
    getCoverArtUrl(artist.coverArt ?? '', HERO_COVER_SIZE) ??
    artistInfo?.largeImageUrl ??
    undefined;

  const albums = artist.album ?? [];
  const rawBio = artistInfo?.biography ?? null;
  const biography = rawBio ? stripHtml(rawBio) : null;
  const similarArtists = artistInfo?.similarArtist ?? [];

  const gradientFillStyle = [
    StyleSheet.absoluteFillObject,
    { top: -insets.top, left: 0, right: 0, bottom: 0 },
  ];

  return (
    <View style={styles.container}>
      {/* Background layers */}
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
          { paddingTop: insets.top + HEADER_BAR_HEIGHT },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Hero ---- */}
        <View style={styles.hero}>
          <Image
            source={{ uri: heroUri }}
            style={styles.heroImage}
            resizeMode="cover"
          />
          <Text style={[styles.artistName, { color: colors.textPrimary }]}>
            {artist.name}
          </Text>
          <View style={styles.meta}>
            <Ionicons name="disc-outline" size={14} color={colors.primary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {artist.albumCount === 1 ? '1 album' : `${artist.albumCount} albums`}
            </Text>
          </View>
        </View>

        {/* ---- Biography ---- */}
        {biography != null && biography.length > 0 && (
          <View style={styles.section}>
            <SectionTitle title="About" color={colors.label} />
            <Text
              style={[styles.bioText, { color: colors.textSecondary }]}
              numberOfLines={bioExpanded ? undefined : 4}
            >
              {biography}
            </Text>
            <Pressable
              onPress={() => setBioExpanded((prev) => !prev)}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={[styles.bioToggle, { color: colors.primary }]}>
                {bioExpanded ? 'Show less' : 'Read more'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* ---- Top Songs ---- */}
        {topSongs.length > 0 && (
          <View style={styles.section}>
            <SectionTitle title="Top Songs" color={colors.label} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.songList}
            >
              {topSongs.map((song, index) => (
                <TopSongItem key={`${song.id}-${index}`} song={song} colors={colors} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ---- Similar Artists ---- */}
        {similarArtists.length > 0 && (
          <View style={styles.section}>
            <SectionTitle title="Similar Artists" color={colors.label} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.similarList}
            >
              {similarArtists.map((sa) => (
                <SimilarArtistItem key={sa.id} artist={sa} colors={colors} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ---- Albums ---- */}
        {albums.length > 0 && (
          <View style={styles.section}>
            <SectionTitle title="Albums" color={colors.label} />
            <View style={styles.albumList}>
              {albums.map((album) => (
                <AlbumRow key={album.id} album={album} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
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
  errorText: {
    fontSize: 16,
  },
  pressed: {
    opacity: 0.8,
  },

  /* Hero */
  hero: {
    width: '100%',
    paddingTop: HERO_PADDING / 2,
    paddingBottom: HERO_PADDING,
    alignItems: 'center',
  },
  heroImage: {
    width: HERO_IMAGE_SIZE,
    height: HERO_IMAGE_SIZE,
    borderRadius: HERO_IMAGE_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  artistName: {
    fontSize: 26,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  metaText: {
    fontSize: 14,
    marginLeft: 4,
  },

  /* Sections */
  section: {
    paddingHorizontal: 16,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },

  /* Biography */
  bioText: {
    fontSize: 15,
    lineHeight: 22,
  },
  bioToggle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },

  /* Album list */
  albumList: {
    // AlbumRow handles its own spacing
  },

  /* Top Songs */
  songList: {
    paddingRight: 16,
    gap: 14,
  },
  songItem: {
    width: SONG_THUMB_SIZE + 16,
  },
  songImage: {
    width: SONG_THUMB_SIZE,
    height: SONG_THUMB_SIZE,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  songTitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 6,
  },
  songArtist: {
    fontSize: 11,
    marginTop: 2,
  },

  /* Similar Artists */
  similarList: {
    paddingRight: 16,
    gap: 14,
  },
  similarItem: {
    alignItems: 'center',
    width: SIMILAR_THUMB_SIZE + 16,
  },
  similarImage: {
    width: SIMILAR_THUMB_SIZE,
    height: SIMILAR_THUMB_SIZE,
    borderRadius: SIMILAR_THUMB_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  similarName: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
});
