import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ArtistListView, type ArtistLayout } from '../components/ArtistListView';
import { useTheme } from '../hooks/useTheme';
import { artistLibraryStore } from '../store/artistLibraryStore';

export function ArtistListScreen({ layout = 'list' }: { layout?: ArtistLayout }) {
  const { colors } = useTheme();
  const artists = artistLibraryStore((s) => s.artists);
  const loading = artistLibraryStore((s) => s.loading);
  const error = artistLibraryStore((s) => s.error);
  const fetchAllArtists = artistLibraryStore((s) => s.fetchAllArtists);

  // Auto-fetch when mounted if the store has no data
  useEffect(() => {
    if (artists.length === 0 && !loading) {
      fetchAllArtists();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const minDelay = new Promise((resolve) => setTimeout(resolve, 2000));
    await fetchAllArtists();
    await minDelay;
    setRefreshing(false);
  }, [fetchAllArtists]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ArtistListView
        artists={artists}
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
