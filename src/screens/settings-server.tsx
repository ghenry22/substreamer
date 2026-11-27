import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useContext } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomChrome } from '../components/BottomChrome';
import { GradientBackground } from '../components/GradientBackground';
import { AccountCard } from '../components/settings/AccountCard';
import { LibraryScanCard } from '../components/settings/LibraryScanCard';
import { ServerAddressCard } from '../components/settings/ServerAddressCard';
import { ServerInformationCard } from '../components/settings/ServerInformationCard';
import { ServerSearchCard } from '../components/settings/ServerSearchCard';
import { settingsStyles } from '../styles/settingsStyles';

export function SettingsServerScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  return (
    <GradientBackground scrollable>
      <ScrollView
        style={settingsStyles.container}
        contentContainerStyle={[
          settingsStyles.content,
          {
            paddingTop: headerHeight + 16,
            paddingBottom: Math.max(insets.bottom, 32),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ServerInformationCard />
        <ServerAddressCard />
        <ServerSearchCard />
        <LibraryScanCard />
        <AccountCard />
      </ScrollView>
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}
