/**
 * Storage budget service.
 *
 * Reads device disk space via expo-file-system Paths, combines it with
 * the image and music cache stores to determine how much space is used
 * vs. the user-configured limit, and exposes a single `checkStorageLimit`
 * function that the download pipeline calls before each track.
 */

import { Paths } from 'expo-file-system';

import { imageCacheStore } from '../store/imageCacheStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { storageLimitStore } from '../store/storageLimitStore';

const BYTES_PER_GB = 1024 ** 3;

export function getFreeDiskSpace(): number {
  return Paths.availableDiskSpace ?? 0;
}

export function getTotalDiskSpace(): number {
  return Paths.totalDiskSpace ?? 0;
}

export interface CacheUsage {
  imageBytes: number;
  musicBytes: number;
  totalBytes: number;
}

export function getCurrentCacheUsage(): CacheUsage {
  const imageBytes = imageCacheStore.getState().totalBytes;
  const musicBytes = musicCacheStore.getState().totalBytes;
  return { imageBytes, musicBytes, totalBytes: imageBytes + musicBytes };
}

/**
 * Maximum bytes the cache is allowed to occupy under the current
 * user settings. Returns Infinity when no limit is configured.
 */
export function getEffectiveBudget(): number {
  const { limitMode, maxCacheSizeGB } = storageLimitStore.getState();
  if (limitMode === 'fixed' && maxCacheSizeGB > 0) {
    return maxCacheSizeGB * BYTES_PER_GB;
  }
  return Infinity;
}

export interface StorageBreakdown {
  imageBytes: number;
  musicBytes: number;
  budgetBytes: number;
  availableInBudget: number;
  freeDiskBytes: number;
  totalDiskBytes: number;
}

export function getStorageBreakdown(): StorageBreakdown {
  const { imageBytes, musicBytes, totalBytes } = getCurrentCacheUsage();
  const budgetBytes = getEffectiveBudget();
  const freeDiskBytes = getFreeDiskSpace();
  const totalDiskBytes = getTotalDiskSpace();

  const availableInBudget = Number.isFinite(budgetBytes)
    ? Math.max(0, budgetBytes - totalBytes)
    : freeDiskBytes;

  return {
    imageBytes,
    musicBytes,
    budgetBytes,
    availableInBudget,
    freeDiskBytes,
    totalDiskBytes,
  };
}

/**
 * Evaluate whether the storage limit has been reached and update
 * `storageLimitStore.isStorageFull` accordingly.
 *
 * Returns `true` when the cache is at or over the budget.
 */
export function checkStorageLimit(): boolean {
  const budget = getEffectiveBudget();
  if (!Number.isFinite(budget)) {
    storageLimitStore.getState().setStorageFull(false);
    return false;
  }

  const { totalBytes } = getCurrentCacheUsage();
  const full = totalBytes >= budget;
  storageLimitStore.getState().setStorageFull(full);
  return full;
}
