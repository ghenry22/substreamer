import * as SplashScreen from 'expo-splash-screen';
import { Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import AnimatedSplashScreen from '../components/AnimatedSplashScreen';
import { useTheme } from '../hooks/useTheme';
import { albumListsStore } from '../store/albumListsStore';
import { authStore, clearPersistedData } from '../store/authStore';
import { fetchServerInfo } from '../services/subsonicService';
import { serverInfoStore } from '../store/serverInfoStore';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [splashVisible, setSplashVisible] = useState(true);
  const rehydrated = authStore((s) => s.rehydrated);
  const isLoggedIn = authStore((s) => s.isLoggedIn);
  const { theme, colors } = useTheme();

  useEffect(() => {
    (async () => {
      await clearPersistedData();
      const done = () => {
        authStore.getState().setRehydrated(true);
      };
      const p = authStore.persist.rehydrate();
      if (p instanceof Promise) {
        p.then(done);
      } else {
        done();
      }
    })();
  }, []);

  useEffect(() => {
    if (!rehydrated || !isLoggedIn) return;
    fetchServerInfo().then((info) => {
      if (info) serverInfoStore.getState().setServerInfo(info);
    });
    albumListsStore.getState().refreshAll();
  }, [rehydrated, isLoggedIn]);

  const handleSplashFinish = () => {
    setSplashVisible(false);
    SplashScreen.hideAsync();
  };

  if (splashVisible) {
    return <AnimatedSplashScreen onFinish={handleSplashFinish} />;
  }

  if (!rehydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/login" />;
  }

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        initialRouteName="(tabs)"
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="album-list"
          options={{ title: 'Albums', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="album/[id]"
          options={{
            title: '',
            headerBackTitle: 'Back',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="artist/[id]"
          options={{
            title: '',
            headerBackTitle: 'Back',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="playlist/[id]"
          options={{
            title: '',
            headerBackTitle: 'Back',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack>
    </>
  );
}
