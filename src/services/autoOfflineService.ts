import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

import { autoOfflineStore } from '../store/autoOfflineStore';
import { offlineModeStore } from '../store/offlineModeStore';

let unsubscribeNetInfo: (() => void) | null = null;
let unsubscribeStore: (() => void) | null = null;

function handleNetworkChange(state: NetInfoState): void {
  const { mode, homeSSIDs } = autoOfflineStore.getState();

  if (mode === 'wifi-only') {
    const isOnline = state.type === 'wifi' || state.type === 'ethernet';
    offlineModeStore.getState().setOfflineMode(!isOnline);
    return;
  }

  // home-wifi mode — requires at least one configured SSID to function
  if (homeSSIDs.length === 0) {
    console.warn('[AutoOffline] Home WiFi mode active but no SSIDs configured. Skipping toggle.');
    return;
  }

  if (state.type !== 'wifi') {
    offlineModeStore.getState().setOfflineMode(true);
    return;
  }

  const ssid = (state.details as { ssid?: string | null })?.ssid ?? null;
  if (ssid == null) {
    console.warn('[AutoOffline] SSID is null — location permission may be denied or unavailable (simulators cannot read SSIDs). Skipping toggle.');
    return;
  }

  const isHome = homeSSIDs.includes(ssid);
  console.log(`[AutoOffline] WiFi SSID "${ssid}" ${isHome ? 'matches' : 'does not match'} home networks → ${isHome ? 'online' : 'offline'}`);
  offlineModeStore.getState().setOfflineMode(!isHome);
}

function subscribe(): void {
  if (unsubscribeNetInfo) return;

  const { mode } = autoOfflineStore.getState();
  if (mode === 'home-wifi') {
    NetInfo.configure({ shouldFetchWiFiSSID: true });
  }

  unsubscribeNetInfo = NetInfo.addEventListener(handleNetworkChange);
}

function unsubscribe(): void {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
}

export function startAutoOffline(): void {
  if (!autoOfflineStore.getState().enabled) return;
  subscribe();

  // Re-subscribe when store settings change
  unsubscribeStore = autoOfflineStore.subscribe((state, prev) => {
    if (!state.enabled) {
      unsubscribe();
      return;
    }

    const modeChanged = state.mode !== prev.mode;
    const ssidsChanged = state.homeSSIDs !== prev.homeSSIDs;
    const enabledChanged = state.enabled !== prev.enabled;

    if (modeChanged || enabledChanged) {
      // Restart with new config
      unsubscribe();
      subscribe();
    } else if (ssidsChanged && state.mode === 'home-wifi') {
      // Re-evaluate with current network state
      NetInfo.fetch().then(handleNetworkChange);
    }
  });
}

export function stopAutoOffline(): void {
  unsubscribe();
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
}

export async function getCurrentSSID(): Promise<string | null> {
  try {
    NetInfo.configure({ shouldFetchWiFiSSID: true });
    const state = await NetInfo.fetch();
    if (state.type !== 'wifi') return null;
    return (state.details as { ssid?: string | null })?.ssid ?? null;
  } catch {
    return null;
  }
}

export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    const granted = status === 'granted';
    autoOfflineStore.getState().setLocationPermissionGranted(granted);
    return granted;
  } catch {
    return false;
  }
}

export async function checkLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    const granted = status === 'granted';
    autoOfflineStore.getState().setLocationPermissionGranted(granted);
    return granted;
  } catch {
    return false;
  }
}

export function openAppSettings(): void {
  if (Platform.OS === 'ios') {
    Linking.openURL('app-settings:');
  } else {
    Linking.openSettings();
  }
}
