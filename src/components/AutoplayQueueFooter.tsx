import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
import { playerStore } from '@/store/playerStore';
import { isAutoplaySectionStart } from '@/utils/queueOrigins';

import { AutoplayQueueHeading } from './AutoplayQueueHeading';

export const AutoplayQueueFooter = memo(function AutoplayQueueFooter() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const autoplayLoading = playerStore((state) => state.autoplayLoading);
  const currentTrackIndex = playerStore((state) => state.currentTrackIndex);
  const queueOrigins = playerStore((state) => state.queueOrigins);
  const hasHeading = queueOrigins.some((_, index) =>
    isAutoplaySectionStart(queueOrigins, currentTrackIndex, index),
  );

  if (!autoplayLoading) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityLabel={t('buildingAutoplayQueue')}
    >
      {!hasHeading && <AutoplayQueueHeading color={colors.textPrimary} />}
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          {t('buildingAutoplayQueue')}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  loadingText: { fontSize: 14 },
});
