import { requireNativeModule } from 'expo-modules-core';

let module: { excludeFromBackup: () => Promise<void> };

try {
  module = requireNativeModule('ExpoBackupExclusions');
} catch {
  console.warn(
    '[expo-backup-exclusions] Native module not found. ' +
      'Run `npx expo run:ios` or `npx expo run:android` to rebuild with the native module.'
  );

  module = {
    excludeFromBackup: () => Promise.resolve(),
  };
}

export default module;
