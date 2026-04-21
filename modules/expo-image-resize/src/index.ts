import ExpoImageResizeModule from './ExpoImageResizeModule';

/**
 * Decode a JPEG from `sourceUri`, scale it to `maxWidth` pixels wide
 * preserving aspect ratio, and write the result as a JPEG to `targetUri`.
 *
 * All work runs on a native background thread. No intermediate in-memory
 * buffers are exposed to JS.
 *
 * - `sourceUri` / `targetUri`: accept `file://` URIs or bare file paths.
 * - `maxWidth`: target width in pixels; height scales proportionally.
 * - `quality`: JPEG quality, 0.0–1.0.
 *
 * This module exists specifically to bypass the Glide-backed loader inside
 * `expo-image-manipulator`, which has a long-running Android coroutine
 * double-resume race (crashing as `IllegalStateException: alreadyResumed`
 * inside `EngineJob.callCallbackOnLoadFailed`). Using `BitmapFactory`
 * directly eliminates the callback surface entirely.
 */
export function resizeImageToFileAsync(
  sourceUri: string,
  targetUri: string,
  maxWidth: number,
  quality: number,
): Promise<void> {
  return ExpoImageResizeModule.resizeImageToFileAsync(
    sourceUri,
    targetUri,
    maxWidth,
    quality,
  );
}
