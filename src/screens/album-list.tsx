import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AlbumListView } from '../components/AlbumListView';
import { useTheme } from '../hooks/useTheme';
import {
  ensureCoverArtAuth,
  getFrequentlyPlayedAlbums,
  getRandomAlbums,
  getRecentlyAddedAlbums,
  getRecentlyPlayedAlbums,
  type AlbumID3,
} from '../services/subsonicService';
import type { AlbumListType } from '../store/albumListsStore';

const SIZE_SEE_MORE = 100;

const TYPE_TO_GETTER: Record<
  AlbumListType,
  (size: number) => Promise<AlbumID3[]>
> = {
  recentlyAdded: getRecentlyAddedAlbums,
  recentlyPlayed: getRecentlyPlayedAlbums,
  frequentlyPlayed: getFrequentlyPlayedAlbums,
  randomSelection: getRandomAlbums,
};

const TYPE_TO_TITLE: Record<AlbumListType, string> = {
  recentlyAdded: 'Recently Added',
  recentlyPlayed: 'Recently Played',
  frequentlyPlayed: 'Frequently Played',
  randomSelection: 'Random Selection',
};

const VALID_TYPES: AlbumListType[] = [
  'recentlyAdded',
  'recentlyPlayed',
  'frequentlyPlayed',
  'randomSelection',
];

export function AlbumListScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ type?: string }>();
  const type = (VALID_TYPES.includes(params.type as AlbumListType)
    ? params.type
    : 'recentlyAdded') as AlbumListType;

  const [albums, setAlbums] = useState<AlbumID3[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: TYPE_TO_TITLE[type] });
  }, [type, navigation]);

  const fetchAlbums = useCallback(async () => {
    try {
      await ensureCoverArtAuth();
      const getter = TYPE_TO_GETTER[type];
      const list = await getter(SIZE_SEE_MORE);
      setAlbums(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load albums');
    }
  }, [type]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      await fetchAlbums();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAlbums]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const minDelay = new Promise((resolve) => setTimeout(resolve, 2000));
    await fetchAlbums();
    await minDelay;
    setRefreshing(false);
  }, [fetchAlbums]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AlbumListView
        albums={albums}
        loading={loading}
        error={error}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
