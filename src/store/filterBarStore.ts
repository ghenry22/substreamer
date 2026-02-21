import { create } from 'zustand';

import { type ItemLayout } from './layoutPreferencesStore';

interface LayoutToggleConfig {
  layout: ItemLayout;
  onToggle: () => void;
}

interface DownloadButtonConfig {
  itemId: string;
  type: 'album' | 'playlist';
  onDownload: () => void;
  onDelete: () => void;
}

export interface FilterBarState {
  downloadedOnly: boolean;
  favoritesOnly: boolean;
  toggleDownloaded: () => void;
  toggleFavorites: () => void;
  setDownloadedOnly: (value: boolean) => void;

  hideDownloaded: boolean;
  hideFavorites: boolean;
  layoutToggle: LayoutToggleConfig | null;
  downloadButtonConfig: DownloadButtonConfig | null;

  setHideDownloaded: (hide: boolean) => void;
  setHideFavorites: (hide: boolean) => void;
  setLayoutToggle: (config: LayoutToggleConfig | null) => void;
  setDownloadButtonConfig: (config: DownloadButtonConfig | null) => void;
}

export const filterBarStore = create<FilterBarState>()((set) => ({
  downloadedOnly: false,
  favoritesOnly: false,
  toggleDownloaded: () => set((s) => ({ downloadedOnly: !s.downloadedOnly })),
  toggleFavorites: () => set((s) => ({ favoritesOnly: !s.favoritesOnly })),
  setDownloadedOnly: (downloadedOnly) => set({ downloadedOnly }),

  hideDownloaded: false,
  hideFavorites: false,
  layoutToggle: null,
  downloadButtonConfig: null,

  setHideDownloaded: (hideDownloaded) => set({ hideDownloaded }),
  setHideFavorites: (hideFavorites) => set({ hideFavorites }),
  setLayoutToggle: (layoutToggle) => set({ layoutToggle }),
  setDownloadButtonConfig: (downloadButtonConfig) => set({ downloadButtonConfig }),
}));
