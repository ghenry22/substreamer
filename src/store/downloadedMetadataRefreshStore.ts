import { create } from 'zustand';

/**
 * Progress for the "refresh downloaded metadata" pass — re-caching album/playlist
 * detail + cover art for downloaded items (the proactive migration backfill and
 * the manual settings button). Non-persisted; a single run at a time.
 */
export interface DownloadedMetadataRefreshState {
  /** A refresh is currently running. */
  active: boolean;
  /** Total items to process this run. */
  total: number;
  /** Items completed (ok or failed). */
  done: number;
  /** Items that failed to fetch. */
  failed: number;

  start: (total: number) => void;
  tick: (ok: boolean) => void;
  finish: () => void;
}

export const downloadedMetadataRefreshStore = create<DownloadedMetadataRefreshState>()((set) => ({
  active: false,
  total: 0,
  done: 0,
  failed: 0,

  start: (total) => set({ active: true, total, done: 0, failed: 0 }),
  tick: (ok) =>
    set((s) => ({ done: s.done + 1, failed: ok ? s.failed : s.failed + 1 })),
  finish: () => set({ active: false }),
}));
