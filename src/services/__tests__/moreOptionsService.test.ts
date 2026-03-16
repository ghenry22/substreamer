jest.mock('../playerService', () => ({
  addToQueue: jest.fn().mockResolvedValue(undefined),
  playTrack: jest.fn().mockResolvedValue(undefined),
  removeFromQueue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../subsonicService');

jest.mock('../musicCacheService', () => ({
  enqueueAlbumDownload: jest.fn(),
  enqueuePlaylistDownload: jest.fn(),
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

    it('limits queue to MORE_BY_ARTIST_COUNT (20)', async () => {
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
          alb1: {
            itemId: 'alb1',
            name: 'Album One',
            coverArtId: 'cov1',
            tracks: [
              { id: 's1', title: 'Song 1', artist: 'Artist A', duration: 200, bytes: 1000, fileName: 'f1.mp3' },
              { id: 's2', title: 'Song 2', artist: 'Other', duration: 180, bytes: 900, fileName: 'f2.mp3' },
              { id: 's4', title: 'Song 4', artist: 'Artist A', duration: 190, bytes: 950, fileName: 'f4.mp3' },
              { id: 's5', title: 'Song 5', artist: 'Artist A', duration: 220, bytes: 1050, fileName: 'f5.mp3' },
            ],
          },
          alb2: {
            itemId: 'alb2',
            name: 'Album Two',
            coverArtId: 'cov2',
            tracks: [
              { id: 's3', title: 'Song 3', artist: 'Artist A', duration: 210, bytes: 1100, fileName: 'f3.mp3' },
              { id: 's6', title: 'Song 6', artist: 'Artist A', duration: 230, bytes: 1200, fileName: 'f6.mp3' },
            ],
          },
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
          alb1: {
            itemId: 'alb1',
            name: 'Album One',
            coverArtId: 'cov1',
            tracks: [
              { id: 's1', title: 'Song 1', artist: 'Other', duration: 200, bytes: 1000, fileName: 'f1.mp3' },
            ],
          },
        },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('No offline songs by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('shows error when cache is empty', async () => {
      (musicCacheStore.getState as jest.Mock).mockReturnValue({ cachedItems: {} });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('No offline songs by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('shows error when fewer than 5 offline songs match', async () => {
      (musicCacheStore.getState as jest.Mock).mockReturnValue({
        cachedItems: {
          alb1: {
            itemId: 'alb1',
            name: 'Album One',
            coverArtId: 'cov1',
            tracks: [
              { id: 's1', title: 'Song 1', artist: 'Artist A', duration: 200, bytes: 1000, fileName: 'f1.mp3' },
              { id: 's2', title: 'Song 2', artist: 'Artist A', duration: 180, bytes: 900, fileName: 'f2.mp3' },
            ],
          },
        },
      });

      await playMoreByArtist('ar1', 'Artist A');

      expect(mockOverlayShowError).toHaveBeenCalledWith('Not enough offline songs by Artist A');
      expect(mockPlayTrack).not.toHaveBeenCalled();
    });

    it('limits offline queue to 20', async () => {
      const tracks = Array.from({ length: 25 }, (_, i) => ({
        id: `s${i}`,
        title: `Song ${i}`,
        artist: 'Artist A',
        duration: 200,
        bytes: 1000,
        fileName: `f${i}.mp3`,
      }));
      (musicCacheStore.getState as jest.Mock).mockReturnValue({
        cachedItems: {
          alb1: { itemId: 'alb1', name: 'Album', coverArtId: 'cov', tracks },
        },
      });

      await playMoreByArtist('ar1', 'Artist A');

      const [, queue] = mockPlayTrack.mock.calls[0];
      expect(queue.length).toBe(20);
    });
  });
});
