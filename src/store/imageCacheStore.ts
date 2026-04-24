/**
 * Zustand store exposing the image-cache aggregate state held by the
 * per-row `cached_images` SQLite table.
 *
 * The old version of this store persisted its own totalBytes/fileCount
 * aggregates via `persist(createJSONStorage(kvStorage))`. Those are now
 * derived from SQL on every launch via `hydrateFromDb()` and kept in sync
 * by service-layer callers invoking `recalculateFromDb()` after any
 * variant write or delete. `fileCount` used to double as both "files on
 * disk" and "logical images" — we now expose both explicitly plus a
 * count of covers that are missing one or more variants.
 *
 * `maxConcurrentImageDownloads` is a user setting, not cache state, so it
 * lives in a separate tiny KV blob (`substreamer-image-cache-settings`),
 * same pattern as `musicCacheStore`.
 */
import { create } from 'zustand';

import { hydrateImageCacheAggregates } from './persistence/imageCacheTable';
import { kvStorage } from './persistence';

export type MaxConcurrentImageDownloads = 1 | 3 | 5 | 10;

const SETTINGS_KEY = 'substreamer-image-cache-settings';
const DEFAULT_MAX_CONCURRENT: MaxConcurrentImageDownloads = 5;

interface ImageCacheSettings {
  maxConcurrentImageDownloads: MaxConcurrentImageDownloads;
  /** Timestamp of the last successful FS↔SQL reconcile, epoch ms.
   *  Consumed by imageCacheService to throttle reconcile to once per
   *  week in the deferred-init path. Undefined = never run. */
  lastReconcileMs?: number;
  /** Set true after the one-shot filesystem-hostile-char (`:` etc.)
   *  directory migration has run and renamed any pre-existing
   *  `dc-xxxx:N`-style dirs under image-cache to the sanitised form. */
  fsKeyMigrationV1Done?: boolean;
}

function readSettingsBlob(): ImageCacheSettings {
  const raw = kvStorage.getItem(SETTINGS_KEY) as string | null;
  if (raw === null) {
    return { maxConcurrentImageDownloads: DEFAULT_MAX_CONCURRENT };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ImageCacheSettings>;
    const max = parsed?.maxConcurrentImageDownloads;
    const validated: ImageCacheSettings = {
      maxConcurrentImageDownloads:
        max === 1 || max === 3 || max === 5 || max === 10
          ? max
          : DEFAULT_MAX_CONCURRENT,
    };
    if (typeof parsed?.lastReconcileMs === 'number' && parsed.lastReconcileMs > 0) {
      validated.lastReconcileMs = parsed.lastReconcileMs;
    }
    if (parsed?.fsKeyMigrationV1Done === true) {
      validated.fsKeyMigrationV1Done = true;
    }
    return validated;
  } catch {
    return { maxConcurrentImageDownloads: DEFAULT_MAX_CONCURRENT };
  }
}

function writeSettingsBlob(settings: ImageCacheSettings): void {
  try {
    kvStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* dropped — next launch falls back to defaults */
  }
}

/**
 * Return the epoch-ms timestamp of the last successful image-cache
 * reconcile, or undefined when one has never completed. Consumed by the
 * service's deferred-init throttle.
 */
export function getLastReconcileMs(): number | undefined {
  return readSettingsBlob().lastReconcileMs;
}

/**
 * Persist the timestamp of a just-completed reconcile pass. Merges with
 * the existing settings blob so unrelated fields (e.g. the concurrency
 * limit) aren't clobbered.
 */
export function markReconcileRan(ts: number): void {
  const existing = readSettingsBlob();
  writeSettingsBlob({ ...existing, lastReconcileMs: ts });
}

/** True once the FS-hostile-char cache-dir migration has run. */
export function getFsKeyMigrationDone(): boolean {
  return readSettingsBlob().fsKeyMigrationV1Done === true;
}

/** Persist the migration-done flag; preserves all other settings. */
export function markFsKeyMigrationDone(): void {
  const existing = readSettingsBlob();
  writeSettingsBlob({ ...existing, fsKeyMigrationV1Done: true });
}

export interface ImageCacheState {
  /** Sum of every variant file's size on disk, in bytes. */
  totalBytes: number;
  /** COUNT(*) — total variant files across every cover. */
  fileCount: number;
  /** COUNT(DISTINCT cover_art_id) — unique logical images. */
  imageCount: number;
  /** Covers with fewer than 4 variants on disk. */
  incompleteCount: number;
  /** Max number of images to download concurrently. Persisted separately. */
  maxConcurrentImageDownloads: MaxConcurrentImageDownloads;
  /** True after the initial SQL aggregate read has populated the store. */
  hasHydrated: boolean;

  /** Re-read every aggregate from SQL. Cheap — indexed scans only. Called
   *  by the service layer after writes and by `rehydrateAllStores()` on
   *  launch. Idempotent re-read; safe to call multiple times. */
  recalculateFromDb: () => void;
  /** Called once at app start via `rehydrateAllStores()`. Pulls aggregates
   *  from SQL and reads the maxConcurrent setting from the KV blob. */
  hydrateFromDb: () => void;
  /** Zero every aggregate in memory. Used by `clearImageCache` /
   *  `resetAllStores` after the underlying rows are dropped. */
  reset: () => void;
  /** Persist and apply a new concurrency limit. */
  setMaxConcurrentImageDownloads: (max: MaxConcurrentImageDownloads) => void;
}

export const imageCacheStore = create<ImageCacheState>()((set) => ({
  totalBytes: 0,
  fileCount: 0,
  imageCount: 0,
  incompleteCount: 0,
  maxConcurrentImageDownloads: DEFAULT_MAX_CONCURRENT,
  hasHydrated: false,

  recalculateFromDb: () => {
    const agg = hydrateImageCacheAggregates();
    set({
      totalBytes: agg.totalBytes,
      fileCount: agg.fileCount,
      imageCount: agg.imageCount,
      incompleteCount: agg.incompleteCount,
    });
  },

  hydrateFromDb: () => {
    const agg = hydrateImageCacheAggregates();
    const { maxConcurrentImageDownloads } = readSettingsBlob();
    set({
      totalBytes: agg.totalBytes,
      fileCount: agg.fileCount,
      imageCount: agg.imageCount,
      incompleteCount: agg.incompleteCount,
      maxConcurrentImageDownloads,
      hasHydrated: true,
    });
  },

  reset: () =>
    set({
      totalBytes: 0,
      fileCount: 0,
      imageCount: 0,
      incompleteCount: 0,
    }),

  setMaxConcurrentImageDownloads: (max) => {
    const existing = readSettingsBlob();
    writeSettingsBlob({ ...existing, maxConcurrentImageDownloads: max });
    set({ maxConcurrentImageDownloads: max });
  },
}));
