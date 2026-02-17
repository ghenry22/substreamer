import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CachedImage } from './CachedImage';
import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useIsStarred } from '../hooks/useIsStarred';
import { useTheme } from '../hooks/useTheme';
import { toggleStar } from '../services/moreOptionsService';
import { type ArtistID3 } from '../services/subsonicService';
import { moreOptionsStore } from '../store/moreOptionsStore';

const COVER_SIZE = 300;

/** Total row height (padding 12*2 + image 56 = 80). Exported for getItemLayout. */
export const ROW_HEIGHT = 80;

export const ArtistRow = memo(function ArtistRow({ artist }: { artist: ArtistID3 }) {
  const { colors } = useTheme();
  const router = useRouter();
  const starred = useIsStarred('artist', artist.id);

  const onPress = useCallback(() => {
    router.push(`/artist/${artist.id}`);
  }, [artist.id, router]);

  const handleToggleStar = useCallback(() => {
    toggleStar('artist', artist.id);
  }, [artist.id]);

  const handleLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'artist', item: artist });
  }, [artist]);

  const leftActions: SwipeAction[] = useMemo(
    () => [
      {
        icon: starred ? 'heart' : 'heart-outline',
        color: colors.red,
        label: starred ? 'Remove' : 'Add',
        onPress: handleToggleStar,
      },
    ],
    [starred, colors.red, handleToggleStar],
  );

  return (
    <SwipeableRow
      leftActions={leftActions}
      onLongPress={handleLongPress}
      onPress={onPress}
    >
      <View style={[styles.row, { backgroundColor: colors.card }]}>
        <CachedImage coverArtId={artist.coverArt} size={COVER_SIZE} style={styles.cover} resizeMode="cover" />
        <View style={styles.text}>
          <Text
            style={[styles.artistName, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {artist.name}
          </Text>
          <View style={styles.meta}>
            <Ionicons name="disc-outline" size={14} color={colors.primary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {artist.albumCount === 1 ? '1 album' : `${artist.albumCount} albums`}
            </Text>
          </View>
        </View>
      </View>
    </SwipeableRow>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  text: {
    flex: 1,
    marginLeft: 12,
  },
  artistName: {
    fontSize: 16,
    fontWeight: '600',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  metaText: {
    fontSize: 13,
    marginLeft: 3,
  },
});
