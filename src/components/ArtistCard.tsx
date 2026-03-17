import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CachedImage } from './CachedImage';
import { LongPressable } from './LongPressable';
import { StarRatingDisplay } from './StarRating';
import { useIsStarred } from '../hooks/useIsStarred';
import { useRating } from '../hooks/useRating';
import { useTheme } from '../hooks/useTheme';
import { type ArtistID3WithRating } from '../services/subsonicService';
import { moreOptionsStore } from '../store/moreOptionsStore';

const COVER_SIZE = 300;

export const ArtistCard = memo(function ArtistCard({
  artist,
  width,
}: {
  artist: ArtistID3WithRating;
  width: number;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const starred = useIsStarred('artist', artist.id);
  const rating = useRating(artist.id, artist.userRating);
  const imageSize = width - 16; // 8px padding on each side

  const onPress = useCallback(() => {
    router.push(`/artist/${artist.id}`);
  }, [artist.id, router]);

  const onLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'artist', item: artist });
  }, [artist]);

  return (
    <LongPressable onPress={onPress} onLongPress={onLongPress}>
      <View style={[styles.card, { backgroundColor: colors.card, width }]}>
        <View style={{ width: imageSize, height: imageSize }}>
          <CachedImage
            coverArtId={artist.coverArt}
            size={COVER_SIZE}
            style={[styles.cover, { width: imageSize, height: imageSize }]}
            resizeMode="cover"
          />
          {starred && (
            <View style={styles.indicators}>
              <Ionicons name="heart" size={14} color={colors.red} />
            </View>
          )}
          {rating > 0 && (
            <View style={styles.ratingOverlay}>
              <StarRatingDisplay rating={rating} size={11} color={colors.primary} emptyColor={colors.primary} />
            </View>
          )}
        </View>
        <Text
          style={[styles.artistName, { color: colors.textPrimary }]}
          numberOfLines={1}
        >
          {artist.name}
        </Text>
        <Text
          style={[styles.albumCount, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {artist.albumCount === 1
            ? '1 album'
            : `${artist.albumCount} albums`}
        </Text>
      </View>
    </LongPressable>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 8,
  },
  cover: {
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  indicators: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    flexDirection: 'row',
    gap: 4,
  },
  artistName: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  albumCount: {
    fontSize: 13,
    marginTop: 2,
  },
  ratingOverlay: {
    position: 'absolute',
    bottom: 4,
    left: 4,
  },
});
