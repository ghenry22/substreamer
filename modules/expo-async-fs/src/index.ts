import ExpoAsyncFsModule from './ExpoAsyncFsModule';

/**
 * List directory contents asynchronously on a native background thread.
 * Returns an array of entry names (not full paths).
 */
export function listDirectoryAsync(uri: string): Promise<string[]> {
  return ExpoAsyncFsModule.listDirectoryAsync(uri);
}

/**
 * Calculate total size (in bytes) of a directory recursively
 * on a native background thread.
 */
export function getDirectorySizeAsync(uri: string): Promise<number> {
  return ExpoAsyncFsModule.getDirectorySizeAsync(uri);
}
