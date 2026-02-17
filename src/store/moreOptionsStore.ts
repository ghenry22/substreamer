/**
 * Lightweight Zustand store managing the "more options" bottom sheet.
 *
 * Any component can call `moreOptionsStore.getState().show(...)` to open
 * the sheet.  The sheet itself is rendered once in the root layout and
 * reads from this store.
 */

import { create } from 'zustand';

import { type AlbumID3, type ArtistID3, type Child, type Playlist } from '../services/subsonicService';

/* ------------------------------------------------------------------ */
/*  Entity types                                                       */
/* ------------------------------------------------------------------ */

export type MoreOptionsEntity =
  | { type: 'song'; item: Child }
  | { type: 'album'; item: AlbumID3 }
  | { type: 'artist'; item: ArtistID3 }
  | { type: 'playlist'; item: Playlist };

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export interface MoreOptionsState {
  visible: boolean;
  entity: MoreOptionsEntity | null;

  show: (entity: MoreOptionsEntity) => void;
  hide: () => void;
}

export const moreOptionsStore = create<MoreOptionsState>()((set) => ({
  visible: false,
  entity: null,

  show: (entity) => set({ visible: true, entity }),

  hide: () => set({ visible: false, entity: null }),
}));
