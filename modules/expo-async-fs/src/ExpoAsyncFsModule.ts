import { requireNativeModule } from 'expo-modules-core';

interface ExpoAsyncFsNativeModule {
  listDirectoryAsync(uri: string): Promise<string[]>;
  getDirectorySizeAsync(uri: string): Promise<number>;
}

let module: ExpoAsyncFsNativeModule;

try {
  module = requireNativeModule('ExpoAsyncFs');
} catch {
  console.warn(
    '[expo-async-fs] Native module not found. ' +
      'Run `npx expo run:ios` or `npx expo run:android` to rebuild with the native module.'
  );

  module = {
    listDirectoryAsync: () => Promise.resolve([]),
    getDirectorySizeAsync: () => Promise.resolve(0),
  };
}

export default module;
