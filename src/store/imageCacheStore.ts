import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getImageCacheStats, IMAGE_SIZES } from '../services/imageCacheService';

export interface ImageCacheState {
  /** Total bytes used by cached images. */
  totalBytes: number;
  /** Total number of individual cached files (each image has 4 size variants). */
  fileCount: number;

  /** Record a newly cached file. */
  addFile: (bytes: number) => void;
  /** Reset stats to zero (called after cache clear). */
  reset: () => void;
  /** Reconcile stats from the actual filesystem. */
  recalculate: () => void;
}

/** Derive the unique image count from the file count. */
export function getImageCount(fileCount: number): number {
  return Math.floor(fileCount / IMAGE_SIZES.length);
}

const PERSIST_KEY = 'substreamer-image-cache-stats';

export const imageCacheStore = create<ImageCacheState>()(
  persist(
    (set) => ({
      totalBytes: 0,
      fileCount: 0,

      addFile: (bytes: number) =>
        set((state) => ({
          totalBytes: state.totalBytes + bytes,
          fileCount: state.fileCount + 1,
        })),

      reset: () => set({ totalBytes: 0, fileCount: 0 }),

      recalculate: () => {
        const { totalBytes, imageCount } = getImageCacheStats();
        set({
          totalBytes,
          fileCount: imageCount * IMAGE_SIZES.length,
        });
      },
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        totalBytes: state.totalBytes,
        fileCount: state.fileCount,
      }),
    }
  )
);
