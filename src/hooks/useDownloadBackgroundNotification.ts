import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { musicCacheStore } from '../store/musicCacheStore';

const CHANNEL_ID = 'downloads';

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Downloads',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
  });
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function useDownloadBackgroundNotification() {
  const notificationId = useRef<string | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      const hasActive = musicCacheStore.getState().downloadQueue
        .some((q) => q.status === 'queued' || q.status === 'downloading');

      if (next === 'background' && hasActive) {
        const { granted } = await Notifications.requestPermissionsAsync();
        if (!granted) return;

        notificationId.current = await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Downloads in Progress',
            body: 'Return to Substreamer within a few minutes to avoid download interruption.',
            ...(Platform.OS === 'android' && { channelId: CHANNEL_ID }),
          },
          trigger: null,
        });
      } else if (next === 'active' && notificationId.current) {
        await Notifications.dismissNotificationAsync(notificationId.current);
        notificationId.current = null;
      }
    });

    return () => sub.remove();
  }, []);
}
