import { HeaderHeightContext } from '@react-navigation/elements';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useContext, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AlbumListView } from '../components/AlbumListView';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import {
  albumListsStore,
  type AlbumListType,
} from '../store/albumListsStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { minDelay } from '../utils/stringHelpers';

const TYPE_TO_TITLE_KEY: Record<AlbumListType, string> = {
  recentlyAdded: 'recentlyAdded',
  recentlyPlayed: 'recentlyPlayed',
  frequentlyPlayed: 'frequentlyPlayed',
  randomSelection: 'randomSelection',
};

const TYPE_TO_REFRESH: Record<AlbumListType, () => Promise<void>> = {
  recentlyAdded: () => albumListsStore.getState().refreshRecentlyAdded(),
  recentlyPlayed: () => albumListsStore.getState().refreshRecentlyPlayed(),
  frequentlyPlayed: () => albumListsStore.getState().refreshFrequentlyPlayed(),
  randomSelection: () => albumListsStore.getState().refreshRandomSelection(),
};

const VALID_TYPES: AlbumListType[] = [
  'recentlyAdded',
  'recentlyPlayed',
  'frequentlyPlayed',
  'randomSelection',
];

export function AlbumListScreen() {
  const { t } = useTranslation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ type?: string }>();
  const type = (VALID_TYPES.includes(params.type as AlbumListType)
    ? params.type
    : 'recentlyAdded') as AlbumListType;

  const albums = albumListsStore((s) => s[type]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: t(TYPE_TO_TITLE_KEY[type]) });
  }, [type, navigation, t]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const delay = minDelay();
    await TYPE_TO_REFRESH[type]();
    await delay;
    setRefreshing(false);
  }, [type]);

  return (
    <GradientBackground style={styles.container} scrollable>
      <AlbumListView
        albums={albums}
        loading={false}
        error={null}
        onRefresh={offlineMode ? undefined : handleRefresh}
        refreshing={refreshing}
        contentInsetTop={headerHeight}
      />
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
