import Ionicons from '@react-native-vector-icons/ionicons/static';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../hooks/useTheme';
import { settingsStyles } from '../../styles/settingsStyles';
import { DEFAULT_PRIMARY_COLOR } from '../../store/themeStore';
import { SettingsSectionTitle } from './SettingsSectionTitle';

const ACCENT_COLORS: { labelKey: string; hex: string }[] = [
  { labelKey: 'colorGraphiteDefault', hex: '#8A8A8A' },
  { labelKey: 'colorBlue', hex: '#1D9BF0' },
  { labelKey: 'colorRed', hex: '#E91429' },
  { labelKey: 'colorGreen', hex: '#00BA7C' },
  { labelKey: 'colorOrange', hex: '#FF6F00' },
  { labelKey: 'colorPurple', hex: '#7B61FF' },
  { labelKey: 'colorPink', hex: '#F91880' },
  { labelKey: 'colorTeal', hex: '#00BCD4' },
  { labelKey: 'colorYellow', hex: '#FFD600' },
];

export function AccentColorCard() {
  const { t } = useTranslation();
  const { colors, primaryColor, setPrimaryColor } = useTheme();
  const [open, setOpen] = useState(false);
  const activePrimary = primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const activeMatch = ACCENT_COLORS.find((c) => c.hex === activePrimary);
  const activeLabel = activeMatch ? t(activeMatch.labelKey) : t('custom');

  const handleSelect = useCallback(
    (hex: string) => {
      setPrimaryColor(hex === DEFAULT_PRIMARY_COLOR ? null : hex);
      setOpen(false);
    },
    [setPrimaryColor],
  );

  return (
    <View style={settingsStyles.section}>
      <SettingsSectionTitle>{t('accentColor')}</SettingsSectionTitle>
      <View style={[styles.dropdown, { backgroundColor: colors.card }]}>
        <Pressable
          onPress={() => setOpen((prev) => !prev)}
          style={({ pressed }) => [styles.header, pressed && settingsStyles.pressed]}
        >
          <View style={styles.chip}>
            <View style={[styles.dot, { backgroundColor: activePrimary }]} />
            <Text style={[styles.label, { color: colors.textPrimary }]}>{activeLabel}</Text>
          </View>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>
        {open && (
          <View style={[styles.list, { borderTopColor: colors.border }]}>
            {ACCENT_COLORS.map((c) => {
              const isActive = activePrimary === c.hex;
              return (
                <Pressable
                  key={c.hex}
                  onPress={() => handleSelect(c.hex)}
                  style={({ pressed }) => [
                    styles.option,
                    { borderBottomColor: colors.border },
                    pressed && settingsStyles.pressed,
                  ]}
                >
                  <View style={styles.chip}>
                    <View style={[styles.dot, { backgroundColor: c.hex }]} />
                    <Text style={[styles.label, { color: colors.textPrimary }]}>
                      {t(c.labelKey)}
                    </Text>
                  </View>
                  {isActive && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                </Pressable>
              );
            })}
            {primaryColor != null && (
              <Pressable
                onPress={() => {
                  setPrimaryColor(null);
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.reset, pressed && settingsStyles.pressed]}
              >
                <Text style={[styles.resetText, { color: colors.textSecondary }]}>
                  {t('resetToDefault')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dropdown: { borderRadius: 12, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  list: { borderTopWidth: StyleSheet.hairlineWidth },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 22, height: 22, borderRadius: 11 },
  label: { fontSize: 16 },
  reset: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 12 },
  resetText: { fontSize: 16, fontWeight: '500' },
});
