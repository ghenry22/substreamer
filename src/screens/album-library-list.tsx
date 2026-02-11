import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AlbumListView, type AlbumLayout } from '../components/AlbumListView';
import { useTheme } from '../hooks/useTheme';
import { albumLibraryStore } from '../store/albumLibraryStore';

export function AlbumLibraryListScreen({ layout = 'list' }: { layout?: AlbumLayout }) {
  const { colors } = useTheme();
  const albums = albumLibraryStore((s) => s.albums);
  const loading = albumLibraryStore((s) => s.loading);
  const error = albumLibraryStore((s) => s.error);
  const fetchAllAlbums = albumLibraryStore((s) => s.fetchAllAlbums);

  // Auto-fetch when mounted if the store has no data
  useEffect(() => {
    if (albums.length === 0 && !loading) {
      fetchAllAlbums();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const minDelay = new Promise((resolve) => setTimeout(resolve, 2000));
    await fetchAllAlbums();
    await minDelay;
    setRefreshing(false);
  }, [fetchAllAlbums]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AlbumListView
        albums={albums}
        layout={layout}
        loading={loading}
        error={error}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        showAlphabetScroller={layout === 'list'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
