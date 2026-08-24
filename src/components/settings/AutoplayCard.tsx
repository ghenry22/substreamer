import { useCallback } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../hooks/useTheme';
import { setAutoplayEnabled } from '../../services/playerService';
import { playbackSettingsStore } from '../../store/playbackSettingsStore';

export function AutoplayCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const enabled = playbackSettingsStore((state) => state.autoplayEnabled);
  const handleToggle = useCallback((value: boolean) => {
    void setAutoplayEnabled(value);
  }, []);

  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={[styles.label, { color: colors.textPrimary }]}>{t('autoplay')}</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('autoplayHint')}</Text>
      </View>
      <Switch
        testID="autoplay-toggle"
        value={enabled}
        onValueChange={handleToggle}
        trackColor={{ false: colors.border, true: colors.primary }}
        accessibilityLabel={t('autoplay')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  text: { flex: 1, gap: 4 },
  label: { fontSize: 16, fontWeight: '500' },
  hint: { fontSize: 13, lineHeight: 18 },
});
