import { create } from 'zustand';

export type ShareTargetType = 'album' | 'playlist' | 'queue';

interface CreateShareState {
  visible: boolean;
  shareType: ShareTargetType;
  itemId: string | null;
  songIds: string[];
  itemName: string;
  artistName: string | null;
  coverArtId: string | null;

  showAlbum: (albumId: string, albumName: string, artistName?: string, coverArtId?: string) => void;
  showPlaylist: (playlistId: string, playlistName: string, coverArtId?: string) => void;
  showQueue: (songIds: string[]) => void;
  hide: () => void;
}

export const createShareStore = create<CreateShareState>()((set) => ({
  visible: false,
  shareType: 'album',
  itemId: null,
  songIds: [],
  itemName: '',
  artistName: null,
  coverArtId: null,

  showAlbum: (albumId, albumName, artistName, coverArtId) =>
    set({
      visible: true,
      shareType: 'album',
      itemId: albumId,
      songIds: [],
      itemName: albumName,
      artistName: artistName ?? null,
      coverArtId: coverArtId ?? null,
    }),

  showPlaylist: (playlistId, playlistName, coverArtId) =>
    set({
      visible: true,
      shareType: 'playlist',
      itemId: playlistId,
      songIds: [],
      itemName: playlistName,
      artistName: null,
      coverArtId: coverArtId ?? null,
    }),

  showQueue: (songIds) =>
    set({
      visible: true,
      shareType: 'queue',
      itemId: null,
      songIds,
      itemName: 'Current Queue',
      artistName: null,
      coverArtId: null,
    }),

  hide: () =>
    set({
      visible: false,
      itemId: null,
      songIds: [],
      itemName: '',
      artistName: null,
      coverArtId: null,
    }),
}));
