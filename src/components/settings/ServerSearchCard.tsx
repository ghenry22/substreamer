import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../hooks/useTheme';
import { searchSettingsStore } from '../../store/searchSettingsStore';
import { settingsStyles } from '../../styles/settingsStyles';
import { SettingsRow } from './SettingsRow';
import { SettingsSectionTitle } from './SettingsSectionTitle';

export function ServerSearchCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const alwaysSearchServer = searchSettingsStore((s) => s.alwaysSearchServer);
  const setAlwaysSearchServer = searchSettingsStore((s) => s.setAlwaysSearchServer);
  const label = t('includeServerSearchResults');

  return (
    <View style={settingsStyles.section}>
      <SettingsSectionTitle>{t('search')}</SettingsSectionTitle>
      <View style={[settingsStyles.card, { backgroundColor: colors.card, paddingHorizontal: 16 }]}>
        <SettingsRow
          label={label}
          hint={t('includeServerSearchResultsHint')}
          isLast
          right={
            <Switch
              accessibilityLabel={label}
              accessibilityState={{ checked: alwaysSearchServer }}
              value={alwaysSearchServer}
              onValueChange={setAlwaysSearchServer}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          }
        />
      </View>
    </View>
  );
}
