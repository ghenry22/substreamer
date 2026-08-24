import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export const AutoplayQueueHeading = memo(function AutoplayQueueHeading({
  color,
}: {
  color: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={[styles.text, { color }]}>
        {t('autoplay')}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { paddingTop: 18, paddingBottom: 4, paddingHorizontal: 16 },
  text: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
});
