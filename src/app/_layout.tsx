import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import AnimatedSplashScreen from '../components/AnimatedSplashScreen';
import { useTheme } from '../hooks/useTheme';
import { getImageCacheStats, initImageCache } from '../services/imageCacheService';
import { initPlayer } from '../services/playerService';
import { fetchScanStatus } from '../services/scanService';
import { initScrobbleService } from '../services/scrobbleService';
import { initSslTrustStore } from '../services/sslTrustService';
import { albumListsStore } from '../store/albumListsStore';
import { imageCacheStore } from '../store/imageCacheStore';
import { authStore, clearPersistedData } from '../store/authStore';
import { favoritesStore } from '../store/favoritesStore';
import { fetchServerInfo } from '../services/subsonicService';
import { serverInfoStore } from '../store/serverInfoStore';

// Keep the native splash visible until the animated splash is ready.
// AnimatedSplashScreen calls hideAsync() itself once mounted so the
// transition is seamless (both share the same blue + logo appearance).
SplashScreen.preventAutoHideAsync();

// Initialise the on-disk image cache directory at module load.
initImageCache();

// Initialise the SSL trust store so the custom TrustManager / URLSession
// delegate is installed before any network requests are made.
initSslTrustStore();

// Reconcile persisted cache stats with the actual filesystem.
imageCacheStore.getState().recalculate(getImageCacheStats());

export default function RootLayout() {
  const [splashVisible, setSplashVisible] = useState(true);
  const rehydrated = authStore((s) => s.rehydrated);
  const isLoggedIn = authStore((s) => s.isLoggedIn);
  const { theme, colors } = useTheme();
  const router = useRouter();
  const segments = useSegments();

  // --- Rehydrate auth from SQLite ---
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

  // --- Initialise audio player & pre-fetch server data when logged in ---
  useEffect(() => {
    if (!rehydrated || !isLoggedIn) return;
    initPlayer();
    initScrobbleService();
    fetchServerInfo().then((info) => {
      if (info) serverInfoStore.getState().setServerInfo(info);
    });
    fetchScanStatus();
    albumListsStore.getState().refreshAll();
    favoritesStore.getState().fetchStarred();
  }, [rehydrated, isLoggedIn]);

  // --- Auth-based navigation ---
  // Use router.replace inside useEffect instead of <Redirect> so the
  // Stack navigator stays mounted and expo-router can render the target screen.
  useEffect(() => {
    if (!rehydrated || splashVisible) return;

    const onLoginScreen = segments[0] === 'login';

    if (!isLoggedIn && !onLoginScreen) {
      router.replace('/login');
    } else if (isLoggedIn && onLoginScreen) {
      router.replace('/');
    }
  }, [rehydrated, isLoggedIn, splashVisible, segments, router]);

  const handleSplashFinish = useCallback(() => {
    setSplashVisible(false);
  }, []);

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
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
        <Stack.Screen
          name="image-cache-browser"
          options={{ title: 'Image Cache', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="metadata-cache-browser"
          options={{ title: 'Metadata Cache', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="settings-server"
          options={{ title: 'Server Management', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-appearance"
          options={{ title: 'Appearance & Layout', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-connectivity"
          options={{ title: 'Connectivity', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-storage"
          options={{ title: 'Storage & Data', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-media-formats"
          options={{ title: 'Media Formats', headerBackTitle: 'Settings' }}
        />
      </Stack>

      {/* Animated splash renders as an overlay on top of the Stack so the
          navigator is always mounted and ready for auth-based navigation. */}
      {splashVisible && (
        <AnimatedSplashScreen onFinish={handleSplashFinish} />
      )}
    </>
  );
}
