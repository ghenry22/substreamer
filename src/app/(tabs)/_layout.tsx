import Ionicons from "@react-native-vector-icons/ionicons/static";
import type { BottomTabBar } from "expo-router/js-tabs";
import { PlatformPressable } from "expo-router/react-navigation";
import { Tabs } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, StyleSheet, View } from 'react-native';

import WaveformLogo from '../../components/WaveformLogo';
import { BannerStack } from '../../components/BannerStack';
import { BottomChrome } from '../../components/BottomChrome';
import { FloatingTabBar } from '../../components/FloatingTabBar';
import { GradientBackground } from '../../components/GradientBackground';
import { HomeHeader } from '../../components/HomeHeader';
import { SearchableHeader } from '../../components/SearchableHeader';
import { SearchResultsOverlay } from '../../components/SearchResultsOverlay';
import { useTheme } from '../../hooks/useTheme';
import { searchStore } from '../../store/searchStore';

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});

export default function TabLayout() {
  const { t } = useTranslation();
  const { colors, primaryColor } = useTheme();

  const renderTabBar = useCallback(
    (props: React.ComponentProps<typeof BottomTabBar>) => {
      const onHome = props.state.routes[props.state.index]?.name === 'index';
      // On home the bar overlays the scene so the genre fan runs behind it.
      return (
        <View style={onHome ? styles.overlay : undefined} pointerEvents="box-none">
          <BottomChrome hideMiniPlayer={onHome} />
          <FloatingTabBar {...props} />
        </View>
      );
    },
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
              {props.route.name === 'index' ? <HomeHeader /> : <SearchableHeader {...props} />}
              <BannerStack />
            </View>
          ),
          headerTransparent: true,
          sceneStyle: { backgroundColor: 'transparent' },
          tabBarActiveTintColor: primaryColor ?? colors.textPrimary,
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
