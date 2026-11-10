import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../hooks/useTheme';

const ICON_SIZE = 26;

/** Home tab header: history and collections on the left, app name centered, search on the right. */
export function HomeHeader() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={[styles.side, styles.left]}>
          <Pressable
            onPress={() => router.push('/my-listening')}
            hitSlop={8}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('viewListeningHistory')}
          >
            <Ionicons name="time-outline" size={ICON_SIZE} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/collections')}
            hitSlop={8}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('collections')}
          >
            <Ionicons name="albums-outline" size={ICON_SIZE} color={colors.textPrimary} />
          </Pressable>
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          XXW Music
        </Text>
        <View style={[styles.side, styles.right]}>
          <Pressable
            onPress={() => router.navigate('/search')}
            hitSlop={8}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('search')}
          >
            <Ionicons name="search" size={ICON_SIZE} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingHorizontal: 16,
  },
  side: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  left: {
    justifyContent: 'flex-start',
  },
  right: {
    justifyContent: 'flex-end',
  },
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});
