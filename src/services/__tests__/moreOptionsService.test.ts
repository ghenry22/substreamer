jest.mock('../playerService', () => ({
  addToQueue: jest.fn().mockResolvedValue(undefined),
  playTrack: jest.fn().mockResolvedValue(undefined),
  removeFromQueue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../subsonicService');

jest.mock('../musicCacheService', () => ({
  enqueueAlbumDownload: jest.fn(),
  enqueuePlaylistDownload: jest.fn(),
  enqueueSongDownload: jest.fn().mockResolvedValue(undefined),
  deleteCachedItem: jest.fn(),
  cancelDownload: jest.fn(),
}));

const mockSetOverride = jest.fn();
const mockFetchStarred = jest.fn();

jest.mock('../../store/favoritesStore', () => ({
  favoritesStore: {
    getState: jest.fn(() => ({
      songs: [],
      albums: [],
      artists: [],
      overrides: {} as Record<string, boolean>,
      setOverride: mockSetOverride,
      fetchStarred: mockFetchStarred,
    })),
  },
}));

jest.mock('../../store/albumDetailStore', () => ({
  albumDetailStore: {
    getState: jest.fn(() => ({ albums: {} })),
  },
}));

jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: {
    getState: jest.fn(() => ({ offlineMode: false })),
  },
}));

jest.mock('../../store/musicCacheStore', () => ({
  musicCacheStore: {
    getState: jest.fn(() => ({ cachedItems: {} })),
  },
}));

jest.mock('../../store/artistDetailStore', () => ({
  artistDetailStore: {
    getState: jest.fn(() => ({
      artists: {},
      fetchArtist: jest.fn().mockResolvedValue(null),
    })),
  },
}));

jest.mock('../../store/playlistDetailStore', () => ({
  playlistDetailStore: {
    getState: jest.fn(() => ({ playlists: {} })),
  },
}));

jest.mock('../../store/playlistLibraryStore', () => ({
  playlistLibraryStore: {
    getState: jest.fn(() => ({
      fetchAllPlaylists: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('../../store/layoutPreferencesStore', () => ({
  layoutPreferencesStore: {
    getState: jest.fn(() => ({ listLength: 20 })),
  },
}));

const mockOverlayShow = jest.fn();
const mockOverlayShowSuccess = jest.fn();
const mockOverlayShowError = jest.fn();

jest.mock('../../store/processingOverlayStore', () => ({
  processingOverlayStore: {
    getState: jest.fn(() => ({
      show: mockOverlayShow,
      showSuccess: mockOverlayShowSuccess,
      showError: mockOverlayShowError,
    })),
  },
}));

import { addToQueue, playTrack, removeFromQueue } from '../playerService';
import {
  enqueueSongDownload as mockEnqueueSongDownload,
  deleteCachedItem as mockDeleteCachedItem,
} from '../musicCacheService';
import {
  starSong,
  unstarSong,
  starAlbum,
  unstarAlbum,
  starArtist,
  unstarArtist,
  getAlbum,
  getPlaylist,
  getSimilarSongs,
  getSimilarSongs2,
  createNewPlaylist,
} from '../subsonicService';
import { favoritesStore } from '../../store/favoritesStore';
import { albumDetailStore } from '../../store/albumDetailStore';
import { playlistDetailStore } from '../../store/playlistDetailStore';
import { artistDetailStore } from '../../store/artistDetailStore';
import { playlistLibraryStore } from '../../store/playlistLibraryStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import { musicCacheStore } from '../../store/musicCacheStore';
import {
  toggleStar,
  addSongToQueue,
  addAlbumToQueue,
  addPlaylistToQueue,
  removeItemFromQueue,
  playMoreLikeThis,
  playSimilarArtistsMix,
  saveArtistTopSongsPlaylist,
  playMoreByArtist,
  playAllByArtist,
  handleDownloadSong,
  handleRemoveSongDownload,
  songItemId,
} from '../moreOptionsService';

const mockStarSong = starSong as jest.Mock;
const mockUnstarSong = unstarSong as jest.Mock;
const mockStarAlbum = starAlbum as jest.Mock;
const mockUnstarAlbum = unstarAlbum as jest.Mock;
const mockStarArtist = starArtist as jest.Mock;
const mockUnstarArtist = unstarArtist as jest.Mock;
const mockGetAlbum = getAlbum as jest.Mock;
const mockGetPlaylist = getPlaylist as jest.Mock;
const mockGetSimilarSongs = getSimilarSongs as jest.Mock;
const mockGetSimilarSongs2 = getSimilarSongs2 as jest.Mock;
const mockCreateNewPlaylist = createNewPlaylist as jest.Mock;
const mockAddToQueue = addToQueue as jest.Mock;
const mockPlayTrack = playTrack as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (favoritesStore.getState as jest.Mock).mockReturnValue({
    songs: [],
    albums: [],
    artists: [],
    overrides: {},
    setOverride: mockSetOverride,
    fetchStarred: mockFetchStarred,
  });
});

describe('toggleStar', () => {
  it('stars an unstarred song', async () => {
    const result = await toggleStar('song', 'song-1');

    expect(result).toBe(true);
    expect(mockSetOverride).toHaveBeenCalledWith('song-1', true);
    expect(mockStarSong).toHaveBeenCalledWith('song-1');
    expect(mockFetchStarred).toHaveBeenCalled();
  });

  it('unstars a starred song', async () => {
    (favoritesStore.getState as jest.Mock).mockReturnValue({
      songs: [{ id: 'song-1' }],
      albums: [],
      artists: [],
      overrides: {},
      setOverride: mockSetOverride,
      fetchStarred: mockFetchStarred,
    });

    const result = await toggleStar('song', 'song-1');

    expect(result).toBe(false);
    expect(mockSetOverride).toHaveBeenCalledWith('song-1', false);
    expect(mockUnstarSong).toHaveBeenCalledWith('song-1');
  });

  it('uses override value when present', async () => {
    (favoritesStore.getState as jest.Mock).mockReturnValue({
      songs: [],
      albums: [],
      artists: [],
      overrides: { 'song-1': true },
      setOverride: mockSetOverride,
      fetchStarred: mockFetchStarred,
    });

    const result = await toggleStar('song', 'song-1');
    expect(result).toBe(false);
    expect(mockUnstarSong).toHaveBeenCalledWith('song-1');
  });

  it('stars an album', async () => {
    const result = await toggleStar('album', 'album-1');
    expect(result).toBe(true);
    expect(mockStarAlbum).toHaveBeenCalledWith('album-1');
  });

  it('unstars an album', async () => {
    (favoritesStore.getState as jest.Mock).mockReturnValue({
      songs: [],
      albums: [{ id: 'album-1' }],
      artists: [],
      overrides: {},
      setOverride: mockSetOverride,
      fetchStarred: mockFetchStarred,
    });
    const result = await toggleStar('album', 'album-1');
    expect(result).toBe(false);
    expect(mockUnstarAlbum).toHaveBeenCalledWith('album-1');
  });

  it('stars an artist', async () => {
    const result = await toggleStar('artist', 'artist-1');
    expect(result).toBe(true);
    expect(mockStarArtist).toHaveBeenCalledWith('artist-1');
  });

  it('unstars an artist', async () => {
    (favoritesStore.getState as jest.Mock).mockReturnValue({
      songs: [],
      albums: [],
      artists: [{ id: 'artist-1' }],
      overrides: {},
      setOverride: mockSetOverride,
      fetchStarred: mockFetchStarred,
    });
    const result = await toggleStar('artist', 'artist-1');
    expect(result).toBe(false);
    expect(mockUnstarArtist).toHaveBeenCalledWith('artist-1');
  });

  it('reverts optimistic update on API failure', async () => {
    mockStarSong.mockRejectedValueOnce(new Error('network'));

    const result = await toggleStar('song', 'song-1');

    expect(result).toBe(true);
    // First call: optimistic (true), second call: revert (false)
    expect(mockSetOverride).toHaveBeenCalledWith('song-1', true);
    expect(mockSetOverride).toHaveBeenCalledWith('song-1', false);
  });
});

describe('addSongToQueue', () => {
  it('adds a single song to the queue', async () => {
    const song = { id: 's1', title: 'Song 1' } as any;
    await addSongToQueue(song);
    expect(mockAddToQueue).toHaveBeenCalledWith([song]);
  });
});

describe('addAlbumToQueue', () => {
  it('uses cached album data when available', async () => {
    const songs = [{ id: 's1' }, { id: 's2' }];
    (albumDetailStore.getState as jest.Mock).mockReturnValueOnce({
      albums: { 'a1': { album: { song: songs } } },
    });

    await addAlbumToQueue({ id: 'a1' } as any);

    expect(mockGetAlbum).not.toHaveBeenCalled();
    expect(mockAddToQueue).toHaveBeenCalledWith(songs);
  });

  it('fetches from API when not cached', async () => {
    (albumDetailStore.getState as jest.Mock).mockReturnValueOnce({ albums: {} });
    const songs = [{ id: 's1' }];
    mockGetAlbum.mockResolvedValue({ song: songs });

    await addAlbumToQueue({ id: 'a1' } as any);

    expect(mockGetAlbum).toHaveBeenCalledWith('a1');
    expect(mockAddToQueue).toHaveBeenCalledWith(songs);
  });

  it('does nothing when album has no songs', async () => {
    (albumDetailStore.getState as jest.Mock).mockReturnValueOnce({ albums: {} });
    mockGetAlbum.mockResolvedValue({ song: [] });
    await addAlbumToQueue({ id: 'a1' } as any);
    expect(mockAddToQueue).not.toHaveBeenCalled();
  });

  it('does nothing when API returns null', async () => {
    (albumDetailStore.getState as jest.Mock).mockReturnValueOnce({ albums: {} });
    mockGetAlbum.mockResolvedValue(null);
    await addAlbumToQueue({ id: 'a1' } as any);
    expect(mockAddToQueue).not.toHaveBeenCalled();
  });
});

describe('addPlaylistToQueue', () => {
  it('uses cached playlist data when available', async () => {
    const entries = [{ id: 's1' }, { id: 's2' }];
    (playlistDetailStore.getState as jest.Mock).mockReturnValueOnce({
      playlists: { 'p1': { playlist: { entry: entries } } },
    });

    await addPlaylistToQueue({ id: 'p1' } as any);

    expect(mockGetPlaylist).not.toHaveBeenCalled();
    expect(mockAddToQueue).toHaveBeenCalledWith(entries, 'p1');
  });

  it('fetches from API when not cached', async () => {
    (playlistDetailStore.getState as jest.Mock).mockReturnValueOnce({ playlists: {} });
    const entries = [{ id: 's1' }];
    mockGetPlaylist.mockResolvedValue({ entry: entries });

    await addPlaylistToQueue({ id: 'p1' } as any);

    expect(mockGetPlaylist).toHaveBeenCalledWith('p1');
    expect(mockAddToQueue).toHaveBeenCalledWith(entries, 'p1');
  });

  it('does nothing when playlist has no entries', async () => {
    (playlistDetailStore.getState as jest.Mock).mockReturnValueOnce({ playlists: {} });
    mockGetPlaylist.mockResolvedValue({ entry: [] });
    await addPlaylistToQueue({ id: 'p1' } as any);
    expect(mockAddToQueue).not.toHaveBeenCalled();
  });
});

describe('removeItemFromQueue', () => {
  it('delegates to removeFromQueue', async () => {
    await removeItemFromQueue(3);
    expect(removeFromQueue).toHaveBeenCalledWith(3);
  });
});

describe('playMoreLikeThis', () => {
  it('plays similar songs on success', async () => {
    const tracks = [{ id: 't1' }, { id: 't2' }] as any[];
    mockGetSimilarSongs.mockResolvedValue(tracks);

    await playMoreLikeThis({ id: 's1' } as any);

    expect(mockOverlayShow).toHaveBeenCalledWith('Loading…');
    expect(mockGetSimilarSongs).toHaveBeenCalledWith('s1', 20);
    expect(mockPlayTrack).toHaveBeenCalledWith(tracks[0], tracks);
    expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Playing similar songs');
  });

  it('shows error when no similar songs found', async () => {
    mockGetSimilarSongs.mockResolvedValue([]);

    await playMoreLikeThis({ id: 's1' } as any);

    expect(mockOverlayShowError).toHaveBeenCalledWith('No similar songs found');
    expect(mockPlayTrack).not.toHaveBeenCalled();
  });

  it('shows error on failure', async () => {
    mockGetSimilarSongs.mockRejectedValue(new Error('fail'));

    await playMoreLikeThis({ id: 's1' } as any);

    expect(mockOverlayShowError).toHaveBeenCalledWith('Failed to load similar songs');
  });
});

describe('playSimilarArtistsMix', () => {
  it('plays similar artist mix on success', async () => {
    const tracks = [{ id: 't1' }, { id: 't2' }] as any[];
    mockGetSimilarSongs2.mockResolvedValue(tracks);

    await playSimilarArtistsMix({ id: 'ar1', name: 'Artist' } as any);

    expect(mockGetSimilarSongs2).toHaveBeenCalledWith('ar1', 20);
    expect(mockPlayTrack).toHaveBeenCalledWith(tracks[0], tracks);
    expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Playing similar artists mix');
  });

  it('shows error when no similar artists mix available', async () => {
    mockGetSimilarSongs2.mockResolvedValue([]);

    await playSimilarArtistsMix({ id: 'ar1', name: 'Artist' } as any);

    expect(mockOverlayShowError).toHaveBeenCalledWith('No similar artists mix available');
  });

  it('shows error on failure', async () => {
    mockGetSimilarSongs2.mockRejectedValue(new Error('fail'));

    await playSimilarArtistsMix({ id: 'ar1', name: 'Artist' } as any);

    expect(mockOverlayShowError).toHaveBeenCalledWith('Failed to load similar artists mix');
  });
});

describe('saveArtistTopSongsPlaylist', () => {
  const artist = { id: 'ar1', name: 'Test Artist' } as any;

  it('creates playlist from cached top songs', async () => {
    const topSongs = [{ id: 's1' }, { id: 's2' }];
    (artistDetailStore.getState as jest.Mock).mockReturnValue({
      artists: { ar1: { topSongs } },
      fetchArtist: jest.fn(),
    });
    mockCreateNewPlaylist.mockResolvedValue(true);
    const mockFetchAllPlaylists = jest.fn().mockResolvedValue(undefined);
    (playlistLibraryStore.getState as jest.Mock).mockReturnValue({
      fetchAllPlaylists: mockFetchAllPlaylists,
    });

    await saveArtistTopSongsPlaylist(artist);

    expect(mockOverlayShow).toHaveBeenCalledWith('Creating…');
    expect(mockCreateNewPlaylist).toHaveBeenCalledWith('Test Artist Top Songs', ['s1', 's2']);
    expect(mockFetchAllPlaylists).toHaveBeenCalled();
    expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Playlist Created');
  });

  it('fetches artist when top songs are not cached', async () => {
    const topSongs = [{ id: 's1' }];
    const mockFetchArtist = jest.fn().mockResolvedValue({ topSongs });
    (artistDetailStore.getState as jest.Mock).mockReturnValue({
      artists: {},
      fetchArtist: mockFetchArtist,
    });
    mockCreateNewPlaylist.mockResolvedValue(true);
    const mockFetchAllPlaylists = jest.fn().mockResolvedValue(undefined);
    (playlistLibraryStore.getState as jest.Mock).mockReturnValue({
      fetchAllPlaylists: mockFetchAllPlaylists,
    });

    await saveArtistTopSongsPlaylist(artist);

    expect(mockFetchArtist).toHaveBeenCalledWith('ar1');
    expect(mockCreateNewPlaylist).toHaveBeenCalledWith('Test Artist Top Songs', ['s1']);
    expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Playlist Created');
  });

  it('shows error when no top songs are available', async () => {
    const mockFetchArtist = jest.fn().mockResolvedValue({ topSongs: [] });
    (artistDetailStore.getState as jest.Mock).mockReturnValue({
      artists: {},
      fetchArtist: mockFetchArtist,
    });

    await saveArtistTopSongsPlaylist(artist);

    expect(mockOverlayShowError).toHaveBeenCalledWith('No top songs available');
    expect(mockCreateNewPlaylist).not.toHaveBeenCalled();
  });

  it('shows error when createNewPlaylist returns false', async () => {
    const topSongs = [{ id: 's1' }];
    (artistDetailStore.getState as jest.Mock).mockReturnValue({
      artists: { ar1: { topSongs } },
      fetchArtist: jest.fn(),
    });
    mockCreateNewPlaylist.mockResolvedValue(false);

    await saveArtistTopSongsPlaylist(artist);

    expect(mockOverlayShowError).toHaveBeenCalledWith('Failed to create playlist');
  });

  it('shows error on exception', async () => {
    (artistDetailStore.getState as jest.Mock).mockReturnValue({
      artists: {},
      fetchArtist: jest.fn().mockRejectedValue(new Error('network')),
    });

    await saveArtistTopSongsPlaylist(artist);

    expect(mockOverlayShowError).toHaveBeenCalledWith('Failed to create playlist');
  });
});

describe('playMoreByArtist', () => {
  describe('online path', () => {
    beforeEach(() => {
      (offlineModeStore.getState as jest.Mock).mockReturnValue({ offlineMode: false });
    });

    it('fetches albums, shuffles songs, and plays', async () => {
      const songs = [
        { id: 's1', title: 'Song 1', artist: 'Artist A', artistId: 'ar1' },
        { id: 's2', title: 'Song 2', artist: 'Artist A', artistId: 'ar1' },
        { id: 's3', title: 'Song 3', artist: 'Artist A', artistId: 'ar1' },
        { id: 's4', title: 'Song 4', artist: 'Artist A', artistId: 'ar1' },
        { id: 's5', title: 'Song 5', artist: 'Artist A', artistId: 'ar1' },
      ];
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {
          ar1: {
            artist: { album: [{ id: 'alb1' }] },
          },
        },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShow).toHaveBeenCalledWith('Loading…');
      expect(mockPlayTrack).toHaveBeenCalled();
      const [firstTrack, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(5);
      expect(queue).toContain(firstTrack);
      expect(mockOverlayShowSuccess).toHaveBeenCalledWith(`Playing Artist A mix`);
    });

    it('fetches artist when not cached', async () => {
      const songs = Array.from({ length: 6 }, (_, i) => ({
        id: `s${i}`, artist: 'Artist B', artistId: 'ar2',
      }));
      const mockFetchArtist = jest.fn().mockResolvedValue({
        artist: { album: [{ id: 'alb1' }] },
      });
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {},
        fetchArtist: mockFetchArtist,
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({ albums: {} });
      mockGetAlbum.mockResolvedValue({ song: songs });

      await playMoreByArtist('ar2', 'Artist B');

      expect(mockFetchArtist).toHaveBeenCalledWith('ar2');
      expect(mockGetAlbum).toHaveBeenCalledWith('alb1');
      expect(mockPlayTrack).toHaveBeenCalled();
    });

    it('filters out songs from other artists in compilations', async () => {
      const songs = [
        { id: 's1', artist: 'Artist A', artistId: 'ar1' },
        { id: 's2', artist: 'Other Artist', artistId: 'ar99' },
        { id: 's3', artist: 'Artist A', artistId: 'ar1' },
        { id: 's4', artist: 'Artist A', artistId: 'ar1' },
        { id: 's5', artist: 'Artist A', artistId: 'ar1' },
        { id: 's6', artist: 'Artist A', artistId: 'ar1' },
        { id: 's7', artist: 'Another', artistId: 'ar88' },
      ];
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {
          ar1: { artist: { album: [{ id: 'alb1' }] } },
        },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playMoreByArtist('ar1', 'Artist A');

      const [, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(5);
      expect(queue.every((s: any) => s.artistId === 'ar1')).toBe(true);
    });

    it('limits queue to listLength (default 20)', async () => {
      const songs = Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`,
        artist: 'Artist A',
        artistId: 'ar1',
      }));
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {
          ar1: { artist: { album: [{ id: 'alb1' }] } },
        },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playMoreByArtist('ar1', 'Artist A');

      const [, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(20);
    });

    it('shows error when no songs found', async () => {
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {
          ar1: { artist: { album: [{ id: 'alb1' }] } },
        },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: [] } } },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('No songs found by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('shows error when artist has no albums', async () => {
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {
          ar1: { artist: { album: [] } },
        },
        fetchArtist: jest.fn(),
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('No songs found by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('shows error when fewer than 5 songs found', async () => {
      const songs = [
        { id: 's1', artist: 'Artist A', artistId: 'ar1' },
        { id: 's2', artist: 'Artist A', artistId: 'ar1' },
        { id: 's3', artist: 'Artist A', artistId: 'ar1' },
      ];
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {
          ar1: { artist: { album: [{ id: 'alb1' }] } },
        },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('Not enough songs by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('plays when exactly 5 songs found', async () => {
      const songs = Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`, artist: 'Artist A', artistId: 'ar1',
      }));
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {
          ar1: { artist: { album: [{ id: 'alb1' }] } },
        },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockPlayTrack).toHaveBeenCalled();
      const [, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(5);
    });

    it('shows error on exception', async () => {
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {},
        fetchArtist: jest.fn().mockRejectedValue(new Error('fail')),
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('Failed to load Artist A songs');
    });
  });

  describe('offline path', () => {
    beforeEach(() => {
      (offlineModeStore.getState as jest.Mock).mockReturnValue({ offlineMode: true });
    });

    it('plays songs from cached items matching artist name', async () => {
      (musicCacheStore.getState as jest.Mock).mockReturnValue({
        cachedItems: {
          alb1: { itemId: 'alb1', name: 'Album One', coverArtId: 'cov1', songIds: ['s1', 's2', 's4', 's5'] },
          alb2: { itemId: 'alb2', name: 'Album Two', coverArtId: 'cov2', songIds: ['s3', 's6'] },
        },
        cachedSongs: {
          s1: { id: 's1', title: 'Song 1', artist: 'Artist A', duration: 200, bytes: 1000 },
          s2: { id: 's2', title: 'Song 2', artist: 'Other', duration: 180, bytes: 900 },
          s3: { id: 's3', title: 'Song 3', artist: 'Artist A', duration: 210, bytes: 1100 },
          s4: { id: 's4', title: 'Song 4', artist: 'Artist A', duration: 190, bytes: 950 },
          s5: { id: 's5', title: 'Song 5', artist: 'Artist A', duration: 220, bytes: 1050 },
          s6: { id: 's6', title: 'Song 6', artist: 'Artist A', duration: 230, bytes: 1200 },
        },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockPlayTrack).toHaveBeenCalled();
      const [firstTrack, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(5);
      expect(queue.every((s: any) => s.artist === 'Artist A')).toBe(true);
      // Verify Child reconstruction
      const song = queue.find((s: any) => s.id === 's1');
      expect(song.album).toBe('Album One');
      expect(song.coverArt).toBe('cov1');
      expect(song.isDir).toBe(false);
      expect(queue).toContain(firstTrack);
      expect(mockOverlayShowSuccess).toHaveBeenCalledWith(`Playing Artist A mix`);
    });

    it('shows error when no offline songs match', async () => {
      (musicCacheStore.getState as jest.Mock).mockReturnValue({
        cachedItems: {
          alb1: { itemId: 'alb1', name: 'Album One', coverArtId: 'cov1', songIds: ['s1'] },
        },
        cachedSongs: {
          s1: { id: 's1', title: 'Song 1', artist: 'Other', duration: 200, bytes: 1000 },
        },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('No offline songs by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('shows error when cache is empty', async () => {
      (musicCacheStore.getState as jest.Mock).mockReturnValue({ cachedItems: {}, cachedSongs: {} });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('No offline songs by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('shows error when fewer than 5 offline songs match', async () => {
      (musicCacheStore.getState as jest.Mock).mockReturnValue({
        cachedItems: {
          alb1: { itemId: 'alb1', name: 'Album One', coverArtId: 'cov1', songIds: ['s1', 's2'] },
        },
        cachedSongs: {
          s1: { id: 's1', title: 'Song 1', artist: 'Artist A', duration: 200, bytes: 1000 },
          s2: { id: 's2', title: 'Song 2', artist: 'Artist A', duration: 180, bytes: 900 },
        },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('Not enough offline songs by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('limits offline queue to 20', async () => {
      const songIds = Array.from({ length: 25 }, (_, i) => `s${i}`);
      const cachedSongs: Record<string, any> = {};
      for (let i = 0; i < 25; i++) {
        cachedSongs[`s${i}`] = {
          id: `s${i}`,
          title: `Song ${i}`,
          artist: 'Artist A',
          duration: 200,
          bytes: 1000,
        };
      }
      (musicCacheStore.getState as jest.Mock).mockReturnValue({
        cachedItems: {
          alb1: { itemId: 'alb1', name: 'Album', coverArtId: 'cov', songIds },
        },
        cachedSongs,
      });

      await playMoreByArtist('ar1', 'Artist A');

      const [, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(20);
    });
  });
});

describe('playAllByArtist', () => {
  describe('online – sequential (shuffle=false)', () => {
    beforeEach(() => {
      (offlineModeStore.getState as jest.Mock).mockReturnValue({ offlineMode: false });
    });

    it('plays all songs sorted by year → disc → track', async () => {
      const songs = [
        { id: 's1', artist: 'A', artistId: 'ar1', year: 2020, discNumber: 1, track: 2 },
        { id: 's2', artist: 'A', artistId: 'ar1', year: 2019, discNumber: 1, track: 1 },
        { id: 's3', artist: 'A', artistId: 'ar1', year: 2020, discNumber: 1, track: 1 },
        { id: 's4', artist: 'A', artistId: 'ar1', year: 2020, discNumber: 2, track: 1 },
      ];
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: { ar1: { artist: { album: [{ id: 'alb1' }] } } },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playAllByArtist('ar1', 'A', false);

      const [firstTrack, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.map((s: any) => s.id)).toEqual(['s2', 's3', 's1', 's4']);
      expect(firstTrack.id).toBe('s2');
      expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Playing all songs by A');
    });

    it('does not cap queue length', async () => {
      const songs = Array.from({ length: 50 }, (_, i) => ({
        id: `s${i}`, artist: 'A', artistId: 'ar1', year: 2020, discNumber: 1, track: i + 1,
      }));
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: { ar1: { artist: { album: [{ id: 'alb1' }] } } },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playAllByArtist('ar1', 'A', false);

      const [, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(50);
    });

    it('plays even with fewer than 5 songs (no min check)', async () => {
      const songs = [
        { id: 's1', artist: 'A', artistId: 'ar1', year: 2020, discNumber: 1, track: 1 },
        { id: 's2', artist: 'A', artistId: 'ar1', year: 2020, discNumber: 1, track: 2 },
      ];
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: { ar1: { artist: { album: [{ id: 'alb1' }] } } },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playAllByArtist('ar1', 'A', false);

      expect(mockPlayTrack).toHaveBeenCalled();
      const [, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(2);
    });

    it('shows error when no songs found', async () => {
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: { ar1: { artist: { album: [{ id: 'alb1' }] } } },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: [] } } },
      });

      await playAllByArtist('ar1', 'A', false);

      expect(mockOverlayShowError).toHaveBeenCalledWith('No songs found by A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('shows error on exception', async () => {
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: {},
        fetchArtist: jest.fn().mockRejectedValue(new Error('fail')),
      });

      await playAllByArtist('ar1', 'A', false);

      expect(mockOverlayShowError).toHaveBeenCalledWith('Failed to load A songs');
    });
  });

  describe('online – shuffle (shuffle=true)', () => {
    beforeEach(() => {
      (offlineModeStore.getState as jest.Mock).mockReturnValue({ offlineMode: false });
    });

    it('shuffles all songs and plays', async () => {
      const songs = Array.from({ length: 10 }, (_, i) => ({
        id: `s${i}`, artist: 'A', artistId: 'ar1',
      }));
      (artistDetailStore.getState as jest.Mock).mockReturnValue({
        artists: { ar1: { artist: { album: [{ id: 'alb1' }] } } },
        fetchArtist: jest.fn(),
      });
      (albumDetailStore.getState as jest.Mock).mockReturnValue({
        albums: { alb1: { album: { song: songs } } },
      });

      await playAllByArtist('ar1', 'A', true);

      expect(mockPlayTrack).toHaveBeenCalled();
      const [firstTrack, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(10);
      expect(queue).toContain(firstTrack);
      expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Shuffling all songs by A');
    });
  });

  describe('offline', () => {
    beforeEach(() => {
      (offlineModeStore.getState as jest.Mock).mockReturnValue({ offlineMode: true });
    });

    it('plays offline songs sorted by year when shuffle=false', async () => {
      (musicCacheStore.getState as jest.Mock).mockReturnValue({
        cachedItems: {
          alb1: { itemId: 'alb1', name: 'Album', coverArtId: 'cov', songIds: ['s1', 's2'] },
        },
        cachedSongs: {
          s1: { id: 's1', title: 'Song 1', artist: 'A', duration: 200, bytes: 1000 },
          s2: { id: 's2', title: 'Song 2', artist: 'A', duration: 180, bytes: 900 },
        },
      });

      await playAllByArtist('ar1', 'A', false);

      expect(mockPlayTrack).toHaveBeenCalled();
      const [, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(2);
    });

    it('shows error when no offline songs match', async () => {
      (musicCacheStore.getState as jest.Mock).mockReturnValue({ cachedItems: {}, cachedSongs: {} });

      await playAllByArtist('ar1', 'A', false);

      expect(mockOverlayShowError).toHaveBeenCalledWith('No offline songs by A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });
  });
});

describe('songItemId', () => {
  it('returns the deterministic synthetic item id', () => {
    expect(songItemId('abc')).toBe('song:abc');
    expect(songItemId('')).toBe('song:');
  });
});

describe('handleDownloadSong', () => {
  const mockEnqueue = mockEnqueueSongDownload as jest.Mock;

  it('no-ops on falsy song', async () => {
    await handleDownloadSong(undefined as any);
    await handleDownloadSong({} as any);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockOverlayShowSuccess).not.toHaveBeenCalled();
  });

  it('enqueues and shows success toast on happy path', async () => {
    const song = { id: 's1', title: 'Cool Song', artist: 'A' } as any;
    await handleDownloadSong(song);
    expect(mockEnqueue).toHaveBeenCalledWith(song);
    expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Downloading "Cool Song"');
  });

  it('falls back to unknownSong when title is missing', async () => {
    const song = { id: 's1' } as any;
    await handleDownloadSong(song);
    expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Downloading "Unknown Song"');
  });

  it('shows error overlay when enqueue throws', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('boom'));
    const song = { id: 's1', title: 'Cool Song' } as any;
    await handleDownloadSong(song);
    expect(mockOverlayShowError).toHaveBeenCalledWith('Download failed');
  });

  it('still fires enqueue when song is already cached (service short-circuits)', async () => {
    // The service layer handles the already-cached short-circuit. From the
    // more-options perspective we still call through and show a toast.
    const song = { id: 'cached', title: 'Cached' } as any;
    await handleDownloadSong(song);
    expect(mockEnqueue).toHaveBeenCalledWith(song);
    expect(mockOverlayShowSuccess).toHaveBeenCalled();
  });
});

describe('handleRemoveSongDownload', () => {
  const mockDelete = mockDeleteCachedItem as jest.Mock;

  it('no-ops on falsy song', () => {
    handleRemoveSongDownload(undefined as any);
    handleRemoveSongDownload({} as any);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes the song: item and shows a success toast', () => {
    const song = { id: 's1', title: 'Cool Song' } as any;
    handleRemoveSongDownload(song);
    expect(mockDelete).toHaveBeenCalledWith('song:s1');
    expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Removed "Cool Song"');
  });

  it('falls back to unknownSong when title is missing', () => {
    const song = { id: 's1' } as any;
    handleRemoveSongDownload(song);
    expect(mockOverlayShowSuccess).toHaveBeenCalledWith('Removed "Unknown Song"');
  });

  it('shows error overlay when delete throws', () => {
    mockDelete.mockImplementationOnce(() => { throw new Error('nope'); });
    const song = { id: 's1', title: 'Cool Song' } as any;
    handleRemoveSongDownload(song);
    expect(mockOverlayShowError).toHaveBeenCalledWith('Failed to load');
  });
});
