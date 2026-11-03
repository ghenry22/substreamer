import Ionicons from "@react-native-vector-icons/ionicons/static";
import { BottomTabBar } from "expo-router/js-tabs";
import { PlatformPressable } from "expo-router/react-navigation";
import { Tabs } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, View } from 'react-native';

import WaveformLogo from '../../components/WaveformLogo';
import { BannerStack } from '../../components/BannerStack';
import { BottomChrome } from '../../components/BottomChrome';
import { GradientBackground } from '../../components/GradientBackground';
import { SearchableHeader } from '../../components/SearchableHeader';
import { SearchResultsOverlay } from '../../components/SearchResultsOverlay';
import { useTheme } from '../../hooks/useTheme';
import { searchStore } from '../../store/searchStore';

export default function TabLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const renderTabBar = useCallback(
    (props: React.ComponentProps<typeof BottomTabBar>) => (
      <>
        <BottomChrome />
        <BottomTabBar {...props} />
      </>
    ),
    [],
  );

  return (
    <GradientBackground>
      <Tabs
        tabBar={renderTabBar}
        screenListeners={{
          tabPress: () => Keyboard.dismiss(),
        }}
        screenOptions={{
          header: (props) => (
            <View onLayout={(e) => searchStore.getState().setHeaderHeight(e.nativeEvent.layout.height)}>
              <SearchableHeader {...props} />
              <BannerStack />
            </View>
          ),
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: 'transparent',
          },
          headerTransparent: true,
          sceneStyle: { backgroundColor: 'transparent' },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          // The default tab button uses a borderless Android ripple — an
          // unbounded circle sized to the tab width that overshoots the short
          // bar and clips at the top. Bound it to the cell + a small
          // radius so the circle fits inside the short bar's height without
          // clipping top/bottom. iOS ignores android_ripple.
          tabBarButton: (props) => (
            <PlatformPressable {...props} android_ripple={{ borderless: false, radius: 22 }} />
          ),
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('home'),
            tabBarIcon: ({ color, size }) => (
              <WaveformLogo size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: t('library'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="musical-notes" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="favorites"
          options={{
            title: t('favorites'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: t('search'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="search" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('settings'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
      <SearchResultsOverlay />
    </GradientBackground>
  );
}
