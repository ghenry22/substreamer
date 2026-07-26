/**
 * Priority-aware container for the top-of-screen pill banners. At most ONE
 * banner is shown at a time; the highest-priority banner with an active state
 * wins and suppresses the others.
 *
 * Ladder (highest priority first — matches the plan document):
 *   1. Persistence degraded (PersistenceDegradedBanner) — sticky session-long
 *      signal that writes won't survive relaunch; user MUST know about it
 *      even if connectivity is also broken
 *   2. SSL-error / network-unreachable / reconnected (ConnectivityBanner)
 *   3. Storage full (StorageFullBanner)
 *   4. Library-sync error variants: paused-auth-error, paused-metered, error
 *      (LibrarySyncBanner — actionable failures rank above a plain offline
 *      state so users see "reauthenticate" before "offline")
 *   5. (reserved — no connectivity "offline" variant exists today;
 *      ConnectivityBanner hides itself when the user enables offline mode)
 *   6. Library-sync progress / paused-offline variants (LibrarySyncBanner)
 *   7. Image-cache refresh progress (ImageCacheBanner) — transient
 *      user-initiated cover-art refresh cycle; ranks below library-sync
 *      progress because metadata catch-up is the higher-priority signal
 *   8. Downloaded-metadata refresh progress (DownloadedMetadataBanner) —
 *      transient re-cache of downloaded items' detail + covers (startup
 *      backfill or manual button); lowest priority, purely informational
 */

import { memo } from 'react';

import { ConnectivityBanner } from './ConnectivityBanner';
import { DownloadedMetadataBanner } from './DownloadedMetadataBanner';
import { ImageCacheBanner } from './ImageCacheBanner';
import { LibrarySyncBanner } from './LibrarySyncBanner';
import { PersistenceDegradedBanner } from './PersistenceDegradedBanner';
import { StorageFullBanner } from './StorageFullBanner';
import { connectivityStore } from '../store/connectivityStore';
import { downloadedMetadataRefreshStore } from '../store/downloadedMetadataRefreshStore';
import { imageDownloadQueueStore } from '../store/imageDownloadQueueStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { isDbHealthy } from '../store/persistence';
import { storageLimitStore } from '../store/storageLimitStore';
import { syncStatusStore } from '../store/syncStatusStore';

export const BannerStack = memo(function BannerStack() {
  const bannerState = connectivityStore((s) => s.bannerState);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const isStorageFull = storageLimitStore((s) => s.isStorageFull);
  const syncPhase = syncStatusStore((s) => s.detailSyncPhase);
  const listSyncPhase = syncStatusStore((s) => s.librarySyncPhase);
  const imageQueueCycleId = imageDownloadQueueStore((s) => s.cycleId);
  const imageQueueTotal = imageDownloadQueueStore((s) => s.cycleTotal);
  const imageQueuePhase = imageDownloadQueueStore((s) => s.phase);
  const metaRefreshActive = downloadedMetadataRefreshStore((s) => s.active);
  const metaRefreshTotal = downloadedMetadataRefreshStore((s) => s.total);

  // Persistence-degraded is sticky and captured at module load. If SQLite
  // failed to open, surface this above everything else so the user knows
  // settings/login won't persist.
  if (!isDbHealthy()) return <PersistenceDegradedBanner />;

  // ConnectivityBanner internally hides itself when offlineMode is true (see
  // ConnectivityBanner.tsx:62). Mirror that logic here so the priority
  // ladder doesn't needlessly block lower-priority banners.
  const connectivityShowing = bannerState !== 'hidden' && !offlineMode;

  if (connectivityShowing) return <ConnectivityBanner />;
  if (isStorageFull) return <StorageFullBanner />;

  // Library-sync: error/paused-auth/paused-metered rank above plain offline.
  // Currently functionally equivalent to the progress variant (they all
  // render <LibrarySyncBanner />) but structured explicitly so that a
  // future connectivity "offline" variant can be inserted between them.
  const isSyncError =
    syncPhase === 'error'
    || syncPhase === 'paused-auth-error'
    || syncPhase === 'paused-metered';
  if (isSyncError) return <LibrarySyncBanner />;

  // Album-LIST fetch progress (paginated `library_albums` sync) shares this
  // slot — it runs before the detail walk, so surface it here too.
  if (
    syncPhase === 'syncing'
    || syncPhase === 'paused-offline'
    || listSyncPhase === 'fetching'
    || listSyncPhase === 'paused-offline'
  ) {
    return <LibrarySyncBanner />;
  }

  // 'dismissed' keeps the cycle alive (for retry) but must not claim the banner
  // slot — otherwise a dismissed error would suppress lower-priority banners.
  if (imageQueueCycleId !== null && imageQueueTotal > 0 && imageQueuePhase !== 'dismissed') {
    return <ImageCacheBanner />;
  }

  // Lowest priority: the downloaded-metadata re-cache pass (startup backfill or
  // manual button). Purely informational, so it yields to every banner above.
  if (metaRefreshActive && metaRefreshTotal > 0) {
    return <DownloadedMetadataBanner />;
  }
  return null;
});
