import { requireNativeModule } from 'expo-modules-core';

interface ExpoImageResizeNativeModule {
  /**
   * Decode the JPEG at `sourceUri`, scale to `maxWidth` (aspect-preserving),
   * and write the result to `targetUri` as a JPEG at `quality` (0.0–1.0).
   * All work runs on a native background thread.
   */
  resizeImageToFileAsync(
    sourceUri: string,
    targetUri: string,
    maxWidth: number,
    quality: number,
  ): Promise<void>;
}

let module: ExpoImageResizeNativeModule;

try {
  module = requireNativeModule('ExpoImageResize');
} catch {
  console.warn(
    '[expo-image-resize] Native module not found. ' +
      'Run `npx expo run:ios` or `npx expo run:android` to rebuild with the native module.',
  );

  module = {
    resizeImageToFileAsync: () => Promise.resolve(),
  } as unknown as ExpoImageResizeNativeModule;
}

export default module;
