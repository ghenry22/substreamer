/**
 * More-options sheet: which options each entity type shows in each context, and
 * what each option does when pressed (the service / store call, navigation,
 * confirmation and overlay it drives).
 */

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import React from 'react';
import { ActivityIndicator } from 'react-native';
import { act, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react-native';

/* ------------------------------------------------------------------ */
/*  Mutable mock state (read through closures by the mocks below)      */
/* ------------------------------------------------------------------ */

type DownloadStatus = 'none' | 'queued' | 'downloading' | 'partial' | 'complete';

let mockCachedItems: Record<string, { type: string; songIds: string[] }> = {};
let mockDownloadQueue: { queueId: string; itemId: string }[] = [];
let mockOfflineMode = false;
let mockDownloadStatus: Record<string, DownloadStatus> = {};
let mockStarred = false;
let mockRating = 0;
let mockIsVA = false;
let mockSupportsArtistRating = true;
let mockCanShare = true;
let mockExcluded: { excludedAlbums: Record<string, unknown>; excludedArtists: Record<string, unknown>; excludedPlaylists: Record<string, unknown> } = {
  excludedAlbums: {},
  excludedArtists: {},
  excludedPlaylists: {},
};
let mockOverride: { mbid: string } | undefined;
let mockDb: object | null = null;
let mockPathname = '/';
let mockCanGoBack = true;
let mockQueue: unknown[] = [];

const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();
const mockAlert = jest.fn();
const mockConfirmRemove = jest.fn();
const mockSetPlayerExpanded = jest.fn();
const mockAddToPlaylistShowSong = jest.fn();
const mockAddToPlaylistShowAlbum = jest.fn();
const mockAddToPlaylistShowQueue = jest.fn();
const mockShareShowAlbum = jest.fn();
const mockShareShowPlaylist = jest.fn();
const mockShareShowSong = jest.fn();
const mockMbidShowArtist = jest.fn();
const mockMbidShowAlbum = jest.fn();
const mockBumpLibraryUpdated = jest.fn();
const mockRatingShow = jest.fn();
const mockAddExclusion = jest.fn();
const mockRemoveExclusion = jest.fn();

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      card: '#111',
      textPrimary: '#fff',
      textSecondary: '#888',
      border: '#333',
      primary: '#1D9BF0',
      red: '#e91429',
    },
  }),
}));

// Children inline. Unmounting stands in for the real sheet's close-complete
// signal, so `hideAndAwait` resolves as soon as the sheet is gone.
jest.mock('../BottomSheet', () => {
  const { View } = require('react-native');
  const { useEffect, useRef } = require('react');
  return {
    BottomSheet: ({
      visible,
      onCloseComplete,
      children,
    }: {
      visible: boolean;
      onCloseComplete?: () => void;
      children: React.ReactNode;
    }) => {
      const signal = useRef(onCloseComplete);
      signal.current = onCloseComplete;
      useEffect(() => () => signal.current?.(), []);
      return visible ? <View testID="bottom-sheet">{children}</View> : null;
    },
  };
});

jest.mock('../CachedImage', () => {
  const { View } = require('react-native');
  return { CachedImage: jest.fn(() => <View testID="cover" />) };
});

jest.mock('../AlbumDetailsModal', () => {
  const { Pressable, Text } = require('react-native');
  return {
    AlbumDetailsModal: ({ album, visible, onClose }: { album: { name: string }; visible: boolean; onClose: () => void }) =>
      visible ? (
        <Pressable testID="album-details" onPress={onClose}>
          <Text>{`album-details:${album.name}`}</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock('../TrackDetailsModal', () => {
  const { Pressable, Text } = require('react-native');
  return {
    TrackDetailsModal: ({ track, visible, onClose }: { track: { title: string }; visible: boolean; onClose: () => void }) =>
      visible ? (
        <Pressable testID="track-details" onPress={onClose}>
          <Text>{`track-details:${track.title}`}</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock('../StarRating', () => {
  const { Text } = require('react-native');
  return { StarRatingDisplay: ({ rating }: { rating: number }) => <Text>{`stars:${rating}`}</Text> };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush, back: mockRouterBack, canGoBack: () => mockCanGoBack }),
  usePathname: () => mockPathname,
}));

jest.mock('../../hooks/useConfirmAlbumRemoval', () => ({
  useConfirmAlbumRemoval: () => ({ confirmRemove: mockConfirmRemove }),
}));
jest.mock('../../hooks/useThemedAlert', () => ({
  useThemedAlert: () => ({ alert: mockAlert }),
}));
jest.mock('../../hooks/useDownloadStatus', () => ({
  useDownloadStatus: (type: string) => mockDownloadStatus[type] ?? 'none',
}));
jest.mock('../../hooks/useIsStarred', () => ({ useIsStarred: () => mockStarred }));
jest.mock('../../hooks/useRating', () => ({ useRating: () => mockRating }));
jest.mock('../../services/imageCacheService', () => ({
  resolveCoverArtId: jest.fn(async (subject: { coverArt?: string }) => `resolved:${subject.coverArt}`),
}));

jest.mock('../../services/moreOptionsService', () => ({
  addAlbumToQueue: jest.fn(),
  addPlaylistToQueue: jest.fn(),
  addSongToQueue: jest.fn(),
  cancelDownload: jest.fn(),
  enqueueAlbumDownload: jest.fn(),
  enqueuePlaylistDownload: jest.fn(),
  handleDownloadSong: jest.fn(),
  handleRemoveSongDownload: jest.fn(),
  playMoreByArtist: jest.fn(),
  playMoreLikeThis: jest.fn(),
  playSimilarArtistsMix: jest.fn(),
  playSongNextInQueue: jest.fn(),
  removeDownload: jest.fn(),
  saveArtistTopSongsPlaylist: jest.fn(),
  songItemId: (songId: string) => `song:${songId}`,
  toggleStar: jest.fn(),
}));

jest.mock('../../services/musicCacheService', () => ({ deleteCachedItem: jest.fn() }));
jest.mock('../../services/subsonicService', () => ({
  deletePlaylist: jest.fn(),
  isVariousArtists: () => mockIsVA,
}));
jest.mock('../../services/serverCapabilityService', () => ({
  canUserShare: () => mockCanShare,
  supports: (feature: string) => (feature === 'albumArtistRating' ? mockSupportsArtistRating : true),
}));

jest.mock('../../store/musicCacheStore', () => {
  const state = () => ({ cachedItems: mockCachedItems, downloadQueue: mockDownloadQueue });
  return {
    musicCacheStore: Object.assign(
      (sel: (s: ReturnType<typeof state>) => unknown) => sel(state()),
      { getState: state },
    ),
  };
});

jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: Object.assign(
    (sel: (s: { offlineMode: boolean }) => unknown) => sel({ offlineMode: mockOfflineMode }),
    { getState: () => ({ offlineMode: mockOfflineMode }) },
  ),
}));

jest.mock('../../store/scrobbleExclusionStore', () => ({
  scrobbleExclusionStore: Object.assign(
    (sel: (s: typeof mockExcluded) => unknown) => sel(mockExcluded),
    { getState: () => ({ addExclusion: mockAddExclusion, removeExclusion: mockRemoveExclusion }) },
  ),
}));

jest.mock('../../store/tabletLayoutStore', () => ({
  tabletLayoutStore: { getState: () => ({ setPlayerExpanded: mockSetPlayerExpanded }) },
}));
jest.mock('../../store/addToPlaylistStore', () => ({
  addToPlaylistStore: {
    getState: () => ({
      showSong: mockAddToPlaylistShowSong,
      showAlbum: mockAddToPlaylistShowAlbum,
      showQueue: mockAddToPlaylistShowQueue,
    }),
  },
}));
jest.mock('../../store/createShareStore', () => ({
  createShareStore: {
    getState: () => ({ showAlbum: mockShareShowAlbum, showPlaylist: mockShareShowPlaylist, showSong: mockShareShowSong }),
  },
}));
jest.mock('../../store/mbidOverrideStore', () => ({
  mbidOverrideStore: { getState: () => ({ overrides: {} }) },
  getOverride: jest.fn(() => mockOverride),
}));
jest.mock('../../store/mbidSearchStore', () => ({
  mbidSearchStore: { getState: () => ({ showArtist: mockMbidShowArtist, showAlbum: mockMbidShowAlbum }) },
}));
jest.mock('../../store/playerStore', () => ({
  playerStore: { getState: () => ({ queue: mockQueue }) },
}));
jest.mock('../../store/syncStatusStore', () => ({
  syncStatusStore: { getState: () => ({ bumpLibraryUpdated: mockBumpLibraryUpdated }) },
}));
jest.mock('../../store/setRatingStore', () => ({
  setRatingStore: { getState: () => ({ show: mockRatingShow }) },
}));
jest.mock('../../store/persistence/db', () => ({ getDb: () => mockDb }));
jest.mock('../../db/repository/details', () => ({ getArtistBioRow: jest.fn() }));
jest.mock('../../db/repository/playlists', () => ({ deletePlaylist: jest.fn() }));
jest.mock('../../db/detailNotifier', () => ({ bumpDetailChanged: jest.fn() }));

import { MoreOptionsSheet } from '../MoreOptionsSheet';
import { CachedImage } from '../CachedImage';
import { moreOptionsStore, type MoreOptionsEntity, type MoreOptionsSource } from '../../store/moreOptionsStore';
import { processingOverlayStore } from '../../store/processingOverlayStore';
import { resolveCoverArtId } from '../../services/imageCacheService';
import {
  addAlbumToQueue,
  addPlaylistToQueue,
  addSongToQueue,
  cancelDownload,
  enqueueAlbumDownload,
  enqueuePlaylistDownload,
  handleDownloadSong,
  handleRemoveSongDownload,
  playMoreByArtist,
  playMoreLikeThis,
  playSimilarArtistsMix,
  playSongNextInQueue,
  removeDownload,
  saveArtistTopSongsPlaylist,
  toggleStar,
} from '../../services/moreOptionsService';
import { deleteCachedItem } from '../../services/musicCacheService';
import { deletePlaylist } from '../../services/subsonicService';
import { getArtistBioRow } from '../../db/repository/details';
import { deletePlaylist as deletePlaylistRow } from '../../db/repository/playlists';
import { bumpDetailChanged } from '../../db/detailNotifier';
import type { AlbumID3, ArtistID3, Child, Playlist } from '../../services/subsonicService';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const song = {
  id: 's1',
  title: 'Test Track',
  artist: 'Test Artist',
  artistId: 'ar1',
  albumId: 'al1',
  coverArt: 'cs1',
  duration: 180,
} as unknown as Child;

const album = {
  id: 'al1',
  name: 'Test Album',
  year: 2020,
  artist: 'Album Artist',
  artistId: 'ar1',
  coverArt: 'cal1',
} as unknown as AlbumID3;

const artist = {
  id: 'ar1',
  name: 'Some Artist',
  albumCount: 3,
  coverArt: 'car1',
} as unknown as ArtistID3;

const playlist = {
  id: 'p1',
  name: 'Test Playlist',
  songCount: 5,
  coverArt: 'cp1',
} as unknown as Playlist;

const songEntity: MoreOptionsEntity = { type: 'song', item: song };
const albumEntity: MoreOptionsEntity = { type: 'album', item: album };
const artistEntity: MoreOptionsEntity = { type: 'artist', item: artist };
const playlistEntity: MoreOptionsEntity = { type: 'playlist', item: playlist };

function open(entity: MoreOptionsEntity, source?: MoreOptionsSource) {
  moreOptionsStore.getState().show(entity, source);
  return render(<MoreOptionsSheet />);
}

/** Labels of every option row the sheet can render. */
const ALL_OPTIONS = [
  'Add to Favorites',
  'Set Rating',
  'Save Top Songs Playlist',
  'Play Similar Artists',
  'Add to Playlist',
  'Play More Like This',
  'Play More by This Artist',
  'Play Next',
  'Add to Queue',
  'Go to Album',
  'Go to Artist',
  'Share',
  'Album Details',
  'Track Details',
  'Set MusicBrainz ID',
  'Exclude from Scrobbling',
  'Download Song',
  'Remove Download',
  'Download',
  'Delete Playlist',
  'Add Queue to Playlist',
];

function shownOptions(): string[] {
  return ALL_OPTIONS.filter((label) => screen.queryByText(label) !== null);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const sheetClosed = () => expect(screen.queryByTestId('bottom-sheet')).toBeNull();

beforeEach(() => {
  jest.clearAllMocks();
  mockCachedItems = {};
  mockDownloadQueue = [];
  mockOfflineMode = false;
  mockDownloadStatus = {};
  mockStarred = false;
  mockRating = 0;
  mockIsVA = false;
  mockSupportsArtistRating = true;
  mockCanShare = true;
  mockExcluded = { excludedAlbums: {}, excludedArtists: {}, excludedPlaylists: {} };
  mockOverride = undefined;
  mockDb = null;
  mockPathname = '/';
  mockCanGoBack = true;
  mockQueue = [];
  moreOptionsStore.setState({ visible: false, entity: null, source: 'default' });
});

/* ------------------------------------------------------------------ */
/*  Option visibility                                                  */
/* ------------------------------------------------------------------ */

describe('MoreOptionsSheet — options per entity (online, default source)', () => {
  it('renders nothing when no entity is set', () => {
    render(<MoreOptionsSheet />);
    expect(screen.queryByTestId('bottom-sheet')).toBeNull();
  });

  it('song', () => {
    open(songEntity);
    expect(shownOptions()).toEqual([
      'Add to Favorites',
      'Set Rating',
      'Add to Playlist',
      'Play More Like This',
      'Play More by This Artist',
      'Play Next',
      'Add to Queue',
      'Go to Album',
      'Go to Artist',
      'Share',
      'Track Details',
      'Download Song',
    ]);
  });

  it('album', () => {
    open(albumEntity);
    expect(shownOptions()).toEqual([
      'Add to Favorites',
      'Set Rating',
      'Add to Playlist',
      'Play More by This Artist',
      'Add to Queue',
      'Go to Artist',
      'Share',
      'Album Details',
      'Set MusicBrainz ID',
      'Exclude from Scrobbling',
      'Download',
    ]);
  });

  it('artist', () => {
    open(artistEntity);
    expect(shownOptions()).toEqual([
      'Add to Favorites',
      'Set Rating',
      'Save Top Songs Playlist',
      'Play Similar Artists',
      'Play More by This Artist',
      'Set MusicBrainz ID',
      'Exclude from Scrobbling',
    ]);
  });

  it('playlist', () => {
    open(playlistEntity);
    expect(shownOptions()).toEqual(['Add to Queue', 'Share', 'Download', 'Delete Playlist']);
  });
});

describe('MoreOptionsSheet — options in offline mode', () => {
  beforeEach(() => {
    mockOfflineMode = true;
  });

  it('song keeps only the local actions; Go to Album hidden when its album is not cached', () => {
    open(songEntity);
    expect(shownOptions()).toEqual(['Play More by This Artist', 'Play Next', 'Add to Queue', 'Track Details']);
  });

  it('song offers Go to Album when its album is cached', () => {
    mockCachedItems = { al1: { type: 'album', songIds: ['s1'] } };
    open(songEntity);
    expect(screen.queryByText('Go to Album')).toBeTruthy();
  });

  it('song without an album id never offers Go to Album', () => {
    mockCachedItems = { al1: { type: 'album', songIds: ['s1'] } };
    open({ type: 'song', item: { ...song, albumId: undefined } as Child });
    expect(screen.queryByText('Go to Album')).toBeNull();
  });

  it('album', () => {
    open(albumEntity);
    expect(shownOptions()).toEqual([
      'Play More by This Artist',
      'Add to Queue',
      'Album Details',
      'Set MusicBrainz ID',
      'Exclude from Scrobbling',
      'Download',
    ]);
  });

  it('artist', () => {
    open(artistEntity);
    expect(shownOptions()).toEqual(['Play More by This Artist', 'Set MusicBrainz ID', 'Exclude from Scrobbling']);
  });

  it('playlist', () => {
    open(playlistEntity);
    expect(shownOptions()).toEqual(['Add to Queue', 'Download']);
  });

  it('player sources drop Add Queue to Playlist offline', () => {
    open(songEntity, 'player-phone-portrait');
    expect(screen.queryByText('Player Queue')).toBeNull();
    expect(screen.queryByText('Add Queue to Playlist')).toBeNull();
    expect(shownOptions()).toEqual(['Play More by This Artist', 'Track Details']);
  });
});

describe('MoreOptionsSheet — option gating details', () => {
  it('Various Artists hides the per-artist actions', () => {
    mockIsVA = true;
    open(artistEntity);
    expect(shownOptions()).toEqual(['Add to Favorites', 'Set Rating', 'Exclude from Scrobbling']);
  });

  it('album/artist rating needs the server to support it; song rating does not', () => {
    mockSupportsArtistRating = false;
    const { unmount } = open(albumEntity);
    expect(screen.queryByText('Set Rating')).toBeNull();
    unmount();
    const artistView = open(artistEntity);
    expect(screen.queryByText('Set Rating')).toBeNull();
    artistView.unmount();
    open(songEntity);
    expect(screen.queryByText('Set Rating')).toBeTruthy();
  });

  it('Share is hidden when the user may not share', () => {
    mockCanShare = false;
    open(albumEntity);
    expect(screen.queryByText('Share')).toBeNull();
  });

  it('a song or album without an artist id has no artist links', () => {
    open({ type: 'song', item: { ...song, artistId: undefined } as Child });
    expect(screen.queryByText('Go to Artist')).toBeNull();
    expect(screen.queryByText('Play More by This Artist')).toBeNull();
    screen.unmount();
    open({ type: 'album', item: { ...album, artistId: undefined } as AlbumID3 });
    expect(screen.queryByText('Go to Artist')).toBeNull();
    expect(screen.queryByText('Play More by This Artist')).toBeNull();
  });

  it('a song that is already downloaded offers no Download Song', () => {
    mockDownloadStatus = { song: 'complete' };
    open(songEntity);
    expect(screen.queryByText('Download Song')).toBeNull();
  });

  it('starred entities offer Remove from Favorites', () => {
    mockStarred = true;
    open(songEntity);
    expect(screen.queryByText('Remove from Favorites')).toBeTruthy();
    expect(screen.queryByText('Add to Favorites')).toBeNull();
  });

  it('shows the current rating next to Set Rating', () => {
    mockRating = 4;
    open(songEntity);
    expect(screen.queryByText('stars:4')).toBeTruthy();
  });

  it('shows no rating badge when unrated', () => {
    open(songEntity);
    expect(screen.queryByText(/^stars:/)).toBeNull();
  });

  it.each([
    ['album', albumEntity, 'excludedAlbums'],
    ['artist', artistEntity, 'excludedArtists'],
  ] as const)('an excluded %s offers Include in Scrobbling', (_label, entity, key) => {
    mockExcluded = { ...mockExcluded, [key]: { [entity.item.id]: true } };
    open(entity);
    expect(screen.queryByText('Include in Scrobbling')).toBeTruthy();
    expect(screen.queryByText('Exclude from Scrobbling')).toBeNull();
  });

  it.each([
    ['none', 'Download'],
    ['partial', 'Download remaining tracks'],
    ['queued', 'Cancel Download'],
    ['downloading', 'Cancel Download'],
    ['complete', 'Remove Download'],
  ] as const)('album download status %s labels the download row %s', (status, label) => {
    mockDownloadStatus = { album: status };
    open(albumEntity);
    expect(screen.queryByText(label)).toBeTruthy();
  });

  it('the player queue section heads the sheet in player sources', () => {
    open(songEntity, 'player-tablet-portrait');
    expect(screen.queryByText('Player Queue')).toBeTruthy();
  });
});

describe('MoreOptionsSheet — header', () => {
  it('song: title, artist and a cover resolved from its cover art and album', () => {
    open(songEntity);
    expect(screen.queryByText('Test Track')).toBeTruthy();
    expect(screen.queryByText('Test Artist')).toBeTruthy();
    const props = (CachedImage as unknown as jest.Mock).mock.calls.at(-1)[0];
    expect(props).toMatchObject({ coverArtId: 'cs1', albumId: 'al1', size: 150 });
  });

  it('song without title or artist falls back to Unknown labels', () => {
    open({ type: 'song', item: { id: 's2' } as Child });
    expect(screen.queryByText('Unknown Song')).toBeTruthy();
    expect(screen.queryByText('Unknown Artist')).toBeTruthy();
    expect(screen.queryByTestId('cover')).toBeNull();
  });

  it('song with only an album id still renders a cover', () => {
    open({ type: 'song', item: { id: 's2', albumId: 'al9' } as Child });
    const props = (CachedImage as unknown as jest.Mock).mock.calls.at(-1)[0];
    expect(props).toMatchObject({ coverArtId: undefined, albumId: 'al9' });
  });

  it('album: name with year, album artist', () => {
    open(albumEntity);
    expect(screen.queryByText('Test Album (2020)')).toBeTruthy();
    expect(screen.queryByText('Album Artist')).toBeTruthy();
  });

  it('album without year or artist falls back to the display artist', () => {
    open({ type: 'album', item: { id: 'al2', name: 'Bare', displayArtist: 'Display Artist' } as AlbumID3 });
    expect(screen.queryByText('Bare')).toBeTruthy();
    expect(screen.queryByText('Display Artist')).toBeTruthy();
    expect(screen.queryByTestId('cover')).toBeNull();
  });

  it('album with no artist at all shows Unknown Artist', () => {
    open({ type: 'album', item: { id: 'al2', name: 'Bare' } as AlbumID3 });
    expect(screen.queryByText('Unknown Artist')).toBeTruthy();
  });

  it('artist: name and album count', () => {
    open(artistEntity);
    expect(screen.queryByText('Some Artist')).toBeTruthy();
    expect(screen.queryByText('3 albums')).toBeTruthy();
  });

  it('artist without an album count shows zero', () => {
    open({ type: 'artist', item: { id: 'ar2', name: 'New' } as ArtistID3 });
    expect(screen.queryByText('0 albums')).toBeTruthy();
  });

  it('playlist: name and track count', () => {
    open(playlistEntity);
    expect(screen.queryByText('Test Playlist')).toBeTruthy();
    expect(screen.queryByText('5 tracks')).toBeTruthy();
  });

  it('playlist without a song count shows zero', () => {
    open({ type: 'playlist', item: { id: 'p2', name: 'Empty' } as Playlist });
    expect(screen.queryByText('0 tracks')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Actions                                                            */
/* ------------------------------------------------------------------ */

describe('MoreOptionsSheet — favourites', () => {
  it.each([
    ['song', songEntity],
    ['album', albumEntity],
    ['artist', artistEntity],
  ] as const)('toggles the star on a %s and closes', async (type, entity) => {
    (toggleStar as jest.Mock).mockResolvedValue(undefined);
    open(entity);
    fireEvent.press(screen.getByText('Add to Favorites'));
    await waitForElementToBeRemoved(() => screen.queryByTestId('bottom-sheet'));
    expect(toggleStar).toHaveBeenCalledWith(type, entity.item.id);
  });

  it('shows a spinner and ignores repeat presses while the toggle is in flight', async () => {
    const pending = deferred<void>();
    (toggleStar as jest.Mock).mockReturnValue(pending.promise);
    open(songEntity);
    fireEvent.press(screen.getByText('Add to Favorites'));
    fireEvent.press(screen.getByText('Add to Favorites'));
    expect(toggleStar).toHaveBeenCalledTimes(1);
    expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    await act(async () => pending.resolve());
    sheetClosed();
  });

  it('closes even when the toggle fails', async () => {
    (toggleStar as jest.Mock).mockRejectedValue(new Error('offline'));
    open(albumEntity);
    fireEvent.press(screen.getByText('Add to Favorites'));
    await waitForElementToBeRemoved(() => screen.queryByTestId('bottom-sheet'));
    expect(toggleStar).toHaveBeenCalledWith('album', 'al1');
  });
});

describe('MoreOptionsSheet — playlist and queue actions', () => {
  it('Add to Playlist hands a song to the add-to-playlist sheet', async () => {
    open(songEntity);
    fireEvent.press(screen.getByText('Add to Playlist'));
    await waitFor(() => expect(mockAddToPlaylistShowSong).toHaveBeenCalledWith(song));
    expect(mockAddToPlaylistShowAlbum).not.toHaveBeenCalled();
    sheetClosed();
  });

  it('Add to Playlist hands an album to the add-to-playlist sheet', async () => {
    open(albumEntity);
    fireEvent.press(screen.getByText('Add to Playlist'));
    await waitFor(() => expect(mockAddToPlaylistShowAlbum).toHaveBeenCalledWith(album));
    expect(mockAddToPlaylistShowSong).not.toHaveBeenCalled();
  });

  it('Add Queue to Playlist hands the player queue over', async () => {
    mockQueue = [song];
    open(songEntity, 'player-phone-portrait');
    fireEvent.press(screen.getByText('Add Queue to Playlist'));
    await waitFor(() => expect(mockAddToPlaylistShowQueue).toHaveBeenCalledWith([song]));
    sheetClosed();
  });

  it.each([
    ['song', songEntity, addSongToQueue],
    ['album', albumEntity, addAlbumToQueue],
    ['playlist', playlistEntity, addPlaylistToQueue],
  ] as const)('Add to Queue enqueues a %s and closes', async (_type, entity, fn) => {
    (fn as jest.Mock).mockResolvedValue(undefined);
    open(entity);
    fireEvent.press(screen.getByText('Add to Queue'));
    sheetClosed();
    await waitFor(() => expect(fn).toHaveBeenCalledWith(entity.item));
  });

  it('Add to Queue swallows a failure', async () => {
    (addSongToQueue as jest.Mock).mockRejectedValue(new Error('nope'));
    open(songEntity);
    fireEvent.press(screen.getByText('Add to Queue'));
    await waitFor(() => expect(addSongToQueue).toHaveBeenCalledWith(song));
    sheetClosed();
  });

  it('Play Next inserts the song after the current one', async () => {
    (playSongNextInQueue as jest.Mock).mockResolvedValue(undefined);
    open(songEntity);
    fireEvent.press(screen.getByText('Play Next'));
    sheetClosed();
    await waitFor(() => expect(playSongNextInQueue).toHaveBeenCalledWith(song));
  });

  it('Play Next swallows a failure', async () => {
    (playSongNextInQueue as jest.Mock).mockRejectedValue(new Error('offline'));
    open(songEntity);
    fireEvent.press(screen.getByText('Play Next'));
    await waitFor(() => expect(playSongNextInQueue).toHaveBeenCalledWith(song));
  });
});

describe('MoreOptionsSheet — play actions', () => {
  it('Play More Like This starts a mix from the song', () => {
    open(songEntity);
    fireEvent.press(screen.getByText('Play More Like This'));
    sheetClosed();
    expect(playMoreLikeThis).toHaveBeenCalledWith(song);
  });

  it('Play Similar Artists starts a mix from the artist', () => {
    open(artistEntity);
    fireEvent.press(screen.getByText('Play Similar Artists'));
    sheetClosed();
    expect(playSimilarArtistsMix).toHaveBeenCalledWith(artist);
  });

  it('Save Top Songs Playlist saves for the artist', () => {
    open(artistEntity);
    fireEvent.press(screen.getByText('Save Top Songs Playlist'));
    sheetClosed();
    expect(saveArtistTopSongsPlaylist).toHaveBeenCalledWith(artist);
  });

  it.each([
    ['song', songEntity, 'ar1', 'Test Artist'],
    ['album', albumEntity, 'ar1', 'Album Artist'],
    ['artist', artistEntity, 'ar1', 'Some Artist'],
  ] as const)('Play More by This Artist from a %s', (_type, entity, id, name) => {
    open(entity);
    fireEvent.press(screen.getByText('Play More by This Artist'));
    sheetClosed();
    expect(playMoreByArtist).toHaveBeenCalledWith(id, name);
  });

  it('Play More by This Artist does nothing without an artist name', () => {
    open({ type: 'song', item: { ...song, artist: undefined } as Child });
    fireEvent.press(screen.getByText('Play More by This Artist'));
    expect(playMoreByArtist).not.toHaveBeenCalled();
    expect(screen.queryByTestId('bottom-sheet')).toBeTruthy();
  });
});

describe('MoreOptionsSheet — navigation', () => {
  it.each([
    ['song', songEntity],
    ['album', albumEntity],
  ] as const)('Go to Artist from a %s pushes the artist route', (_type, entity) => {
    open(entity);
    fireEvent.press(screen.getByText('Go to Artist'));
    sheetClosed();
    expect(mockRouterPush).toHaveBeenCalledWith('/artist/ar1');
    expect(mockSetPlayerExpanded).not.toHaveBeenCalled();
  });

  it('Go to Album pushes the album route', () => {
    open(songEntity);
    fireEvent.press(screen.getByText('Go to Album'));
    sheetClosed();
    expect(mockRouterPush).toHaveBeenCalledWith('/album/al1');
    expect(mockSetPlayerExpanded).not.toHaveBeenCalled();
  });

  it.each(['Go to Artist', 'Go to Album'])('%s collapses the tablet-landscape player first', (label) => {
    open(songEntity, 'player-tablet-landscape');
    fireEvent.press(screen.getByText(label));
    expect(mockSetPlayerExpanded).toHaveBeenCalledWith(false);
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });

  it.each(['player-phone-portrait', 'player-tablet-portrait', 'player-tablet-splitview'] as const)(
    '%s does not touch the tablet player layout',
    (source) => {
      open(songEntity, source);
      fireEvent.press(screen.getByText('Go to Album'));
      expect(mockSetPlayerExpanded).not.toHaveBeenCalled();
      expect(mockRouterPush).toHaveBeenCalledWith('/album/al1');
    },
  );
});

describe('MoreOptionsSheet — details modals', () => {
  it('Album Details opens the album modal after the sheet closes, and closes it', async () => {
    open(albumEntity);
    fireEvent.press(screen.getByText('Album Details'));
    await waitFor(() => expect(screen.queryByText('album-details:Test Album')).toBeTruthy());
    sheetClosed();
    fireEvent.press(screen.getByTestId('album-details'));
    expect(screen.queryByTestId('album-details')).toBeNull();
  });

  it('Track Details opens the track modal after the sheet closes, and closes it', async () => {
    open(songEntity);
    fireEvent.press(screen.getByText('Track Details'));
    await waitFor(() => expect(screen.queryByText('track-details:Test Track')).toBeTruthy());
    sheetClosed();
    fireEvent.press(screen.getByTestId('track-details'));
    expect(screen.queryByTestId('track-details')).toBeNull();
  });

  it('a details modal stays mounted beneath a re-opened sheet', async () => {
    open(albumEntity);
    fireEvent.press(screen.getByText('Album Details'));
    await waitFor(() => expect(screen.queryByTestId('album-details')).toBeTruthy());
    act(() => moreOptionsStore.getState().show(songEntity));
    expect(screen.queryByTestId('album-details')).toBeTruthy();
    fireEvent.press(screen.getByText('Track Details'));
    await waitFor(() => expect(screen.queryByTestId('track-details')).toBeTruthy());
  });

  it('a track modal stays mounted beneath a re-opened sheet and closes from there', async () => {
    open(songEntity);
    fireEvent.press(screen.getByText('Track Details'));
    await waitFor(() => expect(screen.queryByTestId('track-details')).toBeTruthy());
    act(() => moreOptionsStore.getState().show(albumEntity));
    fireEvent.press(screen.getByTestId('track-details'));
    expect(screen.queryByTestId('track-details')).toBeNull();
    fireEvent.press(screen.getByText('Album Details'));
    await waitFor(() => expect(screen.queryByTestId('album-details')).toBeTruthy());
    act(() => moreOptionsStore.getState().show(songEntity));
    fireEvent.press(screen.getByTestId('album-details'));
    expect(screen.queryByTestId('album-details')).toBeNull();
  });
});

describe('MoreOptionsSheet — MusicBrainz ID', () => {
  it('artist: an override wins over the resolved bio MBID', async () => {
    mockOverride = { mbid: 'override-mbid' };
    mockDb = {};
    (getArtistBioRow as jest.Mock).mockResolvedValue({ resolvedMbid: 'bio-mbid' });
    open(artistEntity);
    fireEvent.press(screen.getByText('Set MusicBrainz ID'));
    await waitFor(() =>
      expect(mockMbidShowArtist).toHaveBeenCalledWith('ar1', 'Some Artist', 'override-mbid', 'car1'),
    );
    sheetClosed();
  });

  it('artist: falls back to the MBID the bio fetch resolved', async () => {
    mockDb = {};
    (getArtistBioRow as jest.Mock).mockResolvedValue({ resolvedMbid: 'bio-mbid' });
    open(artistEntity);
    fireEvent.press(screen.getByText('Set MusicBrainz ID'));
    await waitFor(() => expect(mockMbidShowArtist).toHaveBeenCalledWith('ar1', 'Some Artist', 'bio-mbid', 'car1'));
    expect(getArtistBioRow).toHaveBeenCalledWith(mockDb, 'ar1');
  });

  it('artist: null when no bio row exists', async () => {
    mockDb = {};
    (getArtistBioRow as jest.Mock).mockResolvedValue(null);
    open({ type: 'artist', item: { ...artist, coverArt: undefined } as ArtistID3 });
    fireEvent.press(screen.getByText('Set MusicBrainz ID'));
    await waitFor(() => expect(mockMbidShowArtist).toHaveBeenCalledWith('ar1', 'Some Artist', null, undefined));
  });

  it('artist: null without a database', async () => {
    open(artistEntity);
    fireEvent.press(screen.getByText('Set MusicBrainz ID'));
    await waitFor(() => expect(mockMbidShowArtist).toHaveBeenCalledWith('ar1', 'Some Artist', null, 'car1'));
    expect(getArtistBioRow).not.toHaveBeenCalled();
  });

  it('album: passes the override MBID', async () => {
    mockOverride = { mbid: 'album-mbid' };
    open(albumEntity);
    fireEvent.press(screen.getByText('Set MusicBrainz ID'));
    await waitFor(() =>
      expect(mockMbidShowAlbum).toHaveBeenCalledWith('al1', 'Test Album', 'Album Artist', 'album-mbid', 'cal1'),
    );
    sheetClosed();
  });

  it('album: null MBID and artist when neither is known', async () => {
    open({ type: 'album', item: { ...album, artist: undefined } as AlbumID3 });
    fireEvent.press(screen.getByText('Set MusicBrainz ID'));
    await waitFor(() => expect(mockMbidShowAlbum).toHaveBeenCalledWith('al1', 'Test Album', null, null, 'cal1'));
  });
});

describe('MoreOptionsSheet — share and rating resolve the cover', () => {
  function subjectPassed() {
    return (resolveCoverArtId as jest.Mock).mock.calls[0][0];
  }

  it('song share passes its cover art and album, and the resolved cover', async () => {
    open(songEntity);
    fireEvent.press(screen.getByText('Share'));
    await waitFor(() =>
      expect(mockShareShowSong).toHaveBeenCalledWith('s1', 'Test Track', 'Test Artist', 'resolved:cs1'),
    );
    expect(subjectPassed()).toStrictEqual({ coverArt: 'cs1', albumId: 'al1' });
    sheetClosed();
  });

  it('song share without an artist passes undefined', async () => {
    open({ type: 'song', item: { ...song, artist: null } as unknown as Child });
    fireEvent.press(screen.getByText('Share'));
    await waitFor(() => expect(mockShareShowSong).toHaveBeenCalledWith('s1', 'Test Track', undefined, 'resolved:cs1'));
  });

  it('album share passes only its cover art', async () => {
    open(albumEntity);
    fireEvent.press(screen.getByText('Share'));
    await waitFor(() =>
      expect(mockShareShowAlbum).toHaveBeenCalledWith('al1', 'Test Album', 'Album Artist', 'resolved:cal1'),
    );
    expect(subjectPassed()).toStrictEqual({ coverArt: 'cal1' });
  });

  it('playlist share passes only its cover art', async () => {
    open(playlistEntity);
    fireEvent.press(screen.getByText('Share'));
    await waitFor(() => expect(mockShareShowPlaylist).toHaveBeenCalledWith('p1', 'Test Playlist', 'resolved:cp1'));
    expect(subjectPassed()).toStrictEqual({ coverArt: 'cp1' });
  });

  it('song rating passes its cover art and album, title and current rating', async () => {
    mockRating = 3;
    open(songEntity);
    fireEvent.press(screen.getByText('Set Rating'));
    await waitFor(() => expect(mockRatingShow).toHaveBeenCalledWith('song', 's1', 'Test Track', 3, 'resolved:cs1'));
    expect(subjectPassed()).toStrictEqual({ coverArt: 'cs1', albumId: 'al1' });
    sheetClosed();
  });

  it('album rating uses the year-suffixed title and only its cover art', async () => {
    open(albumEntity);
    fireEvent.press(screen.getByText('Set Rating'));
    await waitFor(() =>
      expect(mockRatingShow).toHaveBeenCalledWith('album', 'al1', 'Test Album (2020)', 0, 'resolved:cal1'),
    );
    expect(subjectPassed()).toStrictEqual({ coverArt: 'cal1' });
  });

  it('artist rating passes only its cover art', async () => {
    open(artistEntity);
    fireEvent.press(screen.getByText('Set Rating'));
    await waitFor(() => expect(mockRatingShow).toHaveBeenCalledWith('artist', 'ar1', 'Some Artist', 0, 'resolved:car1'));
    expect(subjectPassed()).toStrictEqual({ coverArt: 'car1' });
  });
});

describe('MoreOptionsSheet — scrobble exclusion', () => {
  it.each([
    ['album', albumEntity, 'Test Album'],
    ['artist', artistEntity, 'Some Artist'],
  ] as const)('excludes a %s by id and name', (type, entity, name) => {
    open(entity);
    fireEvent.press(screen.getByText('Exclude from Scrobbling'));
    expect(mockAddExclusion).toHaveBeenCalledWith(type, entity.item.id, name);
    expect(mockRemoveExclusion).not.toHaveBeenCalled();
    sheetClosed();
  });

  it('includes an excluded album again', () => {
    mockExcluded = { ...mockExcluded, excludedAlbums: { al1: true } };
    open(albumEntity);
    fireEvent.press(screen.getByText('Include in Scrobbling'));
    expect(mockRemoveExclusion).toHaveBeenCalledWith('album', 'al1');
    expect(mockAddExclusion).not.toHaveBeenCalled();
    sheetClosed();
  });

  it('excludes with an empty name when the entity has none', () => {
    open({ type: 'artist', item: { id: 'ar9' } as ArtistID3 });
    fireEvent.press(screen.getByText('Exclude from Scrobbling'));
    expect(mockAddExclusion).toHaveBeenCalledWith('artist', 'ar9', '');
  });
});

describe('MoreOptionsSheet — downloads', () => {
  it.each([
    ['album', albumEntity, enqueueAlbumDownload, 'Download'],
    ['playlist', playlistEntity, enqueuePlaylistDownload, 'Download'],
  ] as const)('Download enqueues a %s', async (_type, entity, fn, label) => {
    (fn as jest.Mock).mockResolvedValue(undefined);
    open(entity);
    fireEvent.press(screen.getByText(label));
    sheetClosed();
    await waitFor(() => expect(fn).toHaveBeenCalledWith(entity.item.id));
  });

  it('Download Remaining enqueues the rest of a partial album', async () => {
    mockDownloadStatus = { album: 'partial' };
    open(albumEntity);
    fireEvent.press(screen.getByText('Download remaining tracks'));
    await waitFor(() => expect(enqueueAlbumDownload).toHaveBeenCalledWith('al1'));
  });

  it('swallows an enqueue failure', async () => {
    (enqueuePlaylistDownload as jest.Mock).mockRejectedValue(new Error('full'));
    open(playlistEntity);
    fireEvent.press(screen.getByText('Download'));
    await waitFor(() => expect(enqueuePlaylistDownload).toHaveBeenCalledWith('p1'));
  });

  it.each(['queued', 'downloading'] as const)('Cancel Download cancels the %s queue entry', (status) => {
    mockDownloadStatus = { playlist: status };
    mockDownloadQueue = [
      { queueId: 'q0', itemId: 'other' },
      { queueId: 'q1', itemId: 'p1' },
    ];
    open(playlistEntity);
    fireEvent.press(screen.getByText('Cancel Download'));
    expect(cancelDownload).toHaveBeenCalledWith('q1');
    sheetClosed();
  });

  it('Cancel Download does nothing when the entry has already left the queue', () => {
    mockDownloadStatus = { album: 'queued' };
    open(albumEntity);
    fireEvent.press(screen.getByText('Cancel Download'));
    expect(cancelDownload).not.toHaveBeenCalled();
    sheetClosed();
  });

  it('Remove Download on an album goes through the album-removal confirmation', () => {
    mockDownloadStatus = { album: 'complete' };
    open(albumEntity);
    fireEvent.press(screen.getByText('Remove Download'));
    expect(mockConfirmRemove).toHaveBeenCalledWith('al1');
    expect(removeDownload).not.toHaveBeenCalled();
    sheetClosed();
  });

  it('Remove Download on a playlist removes it directly', () => {
    mockDownloadStatus = { playlist: 'complete' };
    open(playlistEntity);
    fireEvent.press(screen.getByText('Remove Download'));
    expect(removeDownload).toHaveBeenCalledWith('p1');
    expect(mockConfirmRemove).not.toHaveBeenCalled();
  });

  it('Download Song downloads the single song', async () => {
    (handleDownloadSong as jest.Mock).mockResolvedValue(undefined);
    open(songEntity);
    fireEvent.press(screen.getByText('Download Song'));
    sheetClosed();
    await waitFor(() => expect(handleDownloadSong).toHaveBeenCalledWith(song));
  });

  it('Remove Download on a song releases its per-song claim', () => {
    mockCachedItems = { 'song:s1': { type: 'song', songIds: ['s1'] } };
    mockDownloadStatus = { song: 'complete' };
    open(songEntity);
    fireEvent.press(screen.getByText('Remove Download'));
    expect(handleRemoveSongDownload).toHaveBeenCalledWith(song);
    sheetClosed();
  });

  it('a song whose album entry is a playlist claim offers no per-song removal', () => {
    mockCachedItems = { al1: { type: 'playlist', songIds: ['s1'] } };
    mockDownloadStatus = { song: 'complete' };
    open(songEntity);
    expect(screen.queryByText('Remove Download')).toBeNull();
  });
});

describe('MoreOptionsSheet — delete playlist', () => {
  type AlertButton = { text: string; style?: string; onPress?: () => Promise<void> };

  async function openAndConfirm(): Promise<AlertButton[]> {
    open(playlistEntity);
    fireEvent.press(screen.getByText('Delete Playlist'));
    await waitFor(() => expect(mockAlert).toHaveBeenCalled());
    sheetClosed();
    return mockAlert.mock.calls[0][2] as AlertButton[];
  }

  beforeEach(() => {
    processingOverlayStore.getState().hide();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks for confirmation with Cancel and a destructive Delete', async () => {
    const buttons = await openAndConfirm();
    expect(mockAlert.mock.calls[0][0]).toBe('Delete Playlist');
    expect(mockAlert.mock.calls[0][1]).toBe('Are you sure you want to delete "Test Playlist"?');
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Delete', 'destructive'],
    ]);
    expect(deletePlaylist).not.toHaveBeenCalled();
  });

  it('deletes on the server and locally, removes the download, and pops the detail view', async () => {
    mockPathname = '/playlist/p1';
    mockDb = {};
    mockCachedItems = { p1: { type: 'playlist', songIds: [] } };
    (deletePlaylist as jest.Mock).mockResolvedValue(true);
    const buttons = await openAndConfirm();

    jest.useFakeTimers();
    await act(async () => {
      await buttons[1].onPress!();
    });
    expect(deletePlaylist).toHaveBeenCalledWith('p1');
    expect(deletePlaylistRow).toHaveBeenCalledWith(mockDb, 'p1');
    expect(bumpDetailChanged).toHaveBeenCalledWith('playlist', 'p1');
    expect(mockBumpLibraryUpdated).toHaveBeenCalled();
    expect(deleteCachedItem).toHaveBeenCalledWith('p1');

    expect(mockRouterBack).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(800));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    act(() => jest.runOnlyPendingTimers());
    expect(processingOverlayStore.getState()).toMatchObject({ status: 'success', label: 'Playlist Deleted' });
  });

  it('does not pop when the stack cannot go back', async () => {
    mockPathname = '/playlist/p1';
    mockCanGoBack = false;
    (deletePlaylist as jest.Mock).mockResolvedValue(true);
    const buttons = await openAndConfirm();

    jest.useFakeTimers();
    await act(async () => {
      await buttons[1].onPress!();
    });
    act(() => jest.advanceTimersByTime(800));
    expect(mockRouterBack).not.toHaveBeenCalled();
    act(() => jest.runOnlyPendingTimers());
  });

  it('stays put when deleted from outside the detail view, and skips absent db / download', async () => {
    mockPathname = '/playlists';
    (deletePlaylist as jest.Mock).mockResolvedValue(true);
    const buttons = await openAndConfirm();

    jest.useFakeTimers();
    await act(async () => {
      await buttons[1].onPress!();
    });
    expect(deletePlaylistRow).not.toHaveBeenCalled();
    expect(deleteCachedItem).not.toHaveBeenCalled();
    expect(bumpDetailChanged).toHaveBeenCalledWith('playlist', 'p1');
    act(() => jest.advanceTimersByTime(800));
    expect(mockRouterBack).not.toHaveBeenCalled();
    act(() => jest.runOnlyPendingTimers());
  });

  it('a server refusal shows the error overlay and changes nothing locally', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPathname = '/playlist/p1';
    mockDb = {};
    (deletePlaylist as jest.Mock).mockResolvedValue(false);
    const buttons = await openAndConfirm();

    jest.useFakeTimers();
    await act(async () => {
      await buttons[1].onPress!();
    });
    expect(warn).toHaveBeenCalledWith('[processingOverlay] task failed:', new Error('API returned false'));
    expect(deletePlaylistRow).not.toHaveBeenCalled();
    expect(bumpDetailChanged).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(800));
    expect(mockRouterBack).not.toHaveBeenCalled();
    act(() => jest.runOnlyPendingTimers());
    expect(processingOverlayStore.getState()).toMatchObject({ status: 'error', label: 'Failed to delete playlist' });
    warn.mockRestore();
  });
});
