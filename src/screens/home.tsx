import { StyleSheet, View } from 'react-native';

import { GenreChipSection } from '../components/GenreChipSection';
import { LightRaysBackground } from '../components/LightRaysBackground';
import { useTheme } from '../hooks/useTheme';
import { completedScrobbleStore } from '../store/completedScrobbleStore';

export function HomeScreen() {
  const { colors } = useTheme();
  const genreCounts = completedScrobbleStore((s) => s.aggregates.genreCounts);

  return (
    <View style={styles.container}>
      <LightRaysBackground />
      <GenreChipSection genreCounts={genreCounts} colors={colors} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
