import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';

type ArtistLinkProps = {
  artistId: string;
  artistName: string;
  offline: boolean;
  fontSize?: number;
};

const ArtistLink = memo(function ArtistLink({
  artistId,
  artistName,
  offline,
  fontSize,
}: ArtistLinkProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const text = (
    <Text
      style={[
        styles.artistText,
        { color: colors.textSecondary },
        fontSize ? { fontSize } : undefined,
      ]}
      numberOfLines={1}
    >
      {artistName}
    </Text>
  );

  if (offline) return text;

  return (
    <Pressable
      onPress={() => router.push(`/artist/${artistId}`)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('goToArtist')}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {text}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  artistText: {
    fontSize: 16,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default ArtistLink;
