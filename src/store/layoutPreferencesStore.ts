import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { sqliteStorage } from './sqliteStorage';

export type ItemLayout = 'list' | 'grid';
export type AlbumSortOrder = 'artist' | 'title';
export type ArtistAlbumSortOrder = 'newest' | 'oldest';

export interface LayoutPreferencesState {
  albumLayout: ItemLayout;
  artistLayout: ItemLayout;
  playlistLayout: ItemLayout;
  favSongLayout: ItemLayout;
  favAlbumLayout: ItemLayout;
  favArtistLayout: ItemLayout;
  albumSortOrder: AlbumSortOrder;
  artistAlbumSortOrder: ArtistAlbumSortOrder;
  marqueeScrolling: boolean;
  setAlbumLayout: (layout: ItemLayout) => void;
  setArtistLayout: (layout: ItemLayout) => void;
  setPlaylistLayout: (layout: ItemLayout) => void;
  setFavSongLayout: (layout: ItemLayout) => void;
  setFavAlbumLayout: (layout: ItemLayout) => void;
  setFavArtistLayout: (layout: ItemLayout) => void;
  setAlbumSortOrder: (order: AlbumSortOrder) => void;
  setArtistAlbumSortOrder: (order: ArtistAlbumSortOrder) => void;
  setMarqueeScrolling: (enabled: boolean) => void;
}

const PERSIST_KEY = 'substreamer-layout-preferences';

export const layoutPreferencesStore = create<LayoutPreferencesState>()(
  persist(
    (set) => ({
      albumLayout: 'list',
      artistLayout: 'list',
      playlistLayout: 'list',
      favSongLayout: 'list',
      favAlbumLayout: 'list',
      favArtistLayout: 'list',
      albumSortOrder: 'artist',
      artistAlbumSortOrder: 'newest',
      marqueeScrolling: true,
      setAlbumLayout: (albumLayout) => set({ albumLayout }),
      setArtistLayout: (artistLayout) => set({ artistLayout }),
      setPlaylistLayout: (playlistLayout) => set({ playlistLayout }),
      setFavSongLayout: (favSongLayout) => set({ favSongLayout }),
      setFavAlbumLayout: (favAlbumLayout) => set({ favAlbumLayout }),
      setFavArtistLayout: (favArtistLayout) => set({ favArtistLayout }),
      setAlbumSortOrder: (albumSortOrder) => {
        set({ albumSortOrder });
        // Trigger re-sort of the album library without a re-fetch.
        // Use setTimeout + require to avoid circular dependency.
        setTimeout(() => {
          const { albumLibraryStore } = require('./albumLibraryStore');
          albumLibraryStore.getState().resortAlbums();
        }, 0);
      },
      setArtistAlbumSortOrder: (artistAlbumSortOrder) =>
        set({ artistAlbumSortOrder }),
      setMarqueeScrolling: (marqueeScrolling) => set({ marqueeScrolling }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        albumLayout: state.albumLayout,
        artistLayout: state.artistLayout,
        playlistLayout: state.playlistLayout,
        favSongLayout: state.favSongLayout,
        favAlbumLayout: state.favAlbumLayout,
        favArtistLayout: state.favArtistLayout,
        albumSortOrder: state.albumSortOrder,
        artistAlbumSortOrder: state.artistAlbumSortOrder,
        marqueeScrolling: state.marqueeScrolling,
      }),
    }
  )
);
