import { PermissionsAndroid, Platform } from 'react-native';
import type { Permission } from 'react-native';

/** Android 17+ (API 37) gates LAN access behind ACCESS_LOCAL_NETWORK for apps targeting SDK 37+. */
export const ANDROID_LOCAL_NETWORK_PERMISSION = 'android.permission.ACCESS_LOCAL_NETWORK';

const ENFORCING_API_LEVEL = 37;

export async function ensureAndroidLocalNetworkPermission(): Promise<
  'granted' | 'denied'
> {
  if (Platform.OS !== 'android') return 'granted';
  if (Number(Platform.Version) < ENFORCING_API_LEVEL) return 'granted';
  try {
    // Not yet in RN's Permission union.
    const permission = ANDROID_LOCAL_NETWORK_PERMISSION as Permission;
    if (await PermissionsAndroid.check(permission)) {
      return 'granted';
    }
    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  } catch {
    // Don't block login if the state can't be determined.
    return 'granted';
  }
}
