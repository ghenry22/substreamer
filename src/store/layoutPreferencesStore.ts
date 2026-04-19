import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

export type ItemLayout = 'list' | 'grid';
export type AlbumSortOrder = 'artist' | 'title';
export type ArtistAlbumSortOrder = 'newest' | 'oldest';
export type DateFormat = 'yyyy/mm/dd' | 'yyyy/dd/mm';
export type ListLength = 20 | 30 | 50 | 100;

export const LIST_LENGTH_DISPLAY_CAP = 20;

export interface LayoutPreferencesState {
  albumLayout: ItemLayout;
  artistLayout: ItemLayout;
  playlistLayout: ItemLayout;
  favSongLayout: ItemLayout;
  favAlbumLayout: ItemLayout;
  favArtistLayout: ItemLayout;
  albumSortOrder: AlbumSortOrder;
  artistAlbumSortOrder: ArtistAlbumSortOrder;
  dateFormat: DateFormat;
  listLength: ListLength;
  setAlbumLayout: (layout: ItemLayout) => void;
  setArtistLayout: (layout: ItemLayout) => void;
  setPlaylistLayout: (layout: ItemLayout) => void;
  setFavSongLayout: (layout: ItemLayout) => void;
  setFavAlbumLayout: (layout: ItemLayout) => void;
  setFavArtistLayout: (layout: ItemLayout) => void;
  setAlbumSortOrder: (order: AlbumSortOrder) => void;
  setArtistAlbumSortOrder: (order: ArtistAlbumSortOrder) => void;
  setDateFormat: (format: DateFormat) => void;
  setListLength: (length: ListLength) => void;
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
      dateFormat: 'yyyy/mm/dd',
      listLength: 20,
      setAlbumLayout: (albumLayout) => set({ albumLayout }),
      setArtistLayout: (artistLayout) => set({ artistLayout }),
      setPlaylistLayout: (playlistLayout) => set({ playlistLayout }),
      setFavSongLayout: (favSongLayout) => set({ favSongLayout }),
      setFavAlbumLayout: (favAlbumLayout) => set({ favAlbumLayout }),
      setFavArtistLayout: (favArtistLayout) => set({ favArtistLayout }),
      setAlbumSortOrder: (albumSortOrder) => set({ albumSortOrder }),
      setArtistAlbumSortOrder: (artistAlbumSortOrder) =>
        set({ artistAlbumSortOrder }),
      setDateFormat: (dateFormat) => set({ dateFormat }),
      setListLength: (listLength) => set({ listLength }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        albumLayout: state.albumLayout,
        artistLayout: state.artistLayout,
        playlistLayout: state.playlistLayout,
        favSongLayout: state.favSongLayout,
        favAlbumLayout: state.favAlbumLayout,
        favArtistLayout: state.favArtistLayout,
        albumSortOrder: state.albumSortOrder,
        artistAlbumSortOrder: state.artistAlbumSortOrder,
        dateFormat: state.dateFormat,
        listLength: state.listLength,
      }),
    }
  )
);
