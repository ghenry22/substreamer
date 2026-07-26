/**
 * Shared Jest automatic mock for subsonicService.
 *
 * Activated with: jest.mock('../../services/subsonicService')
 * or jest.mock('../services/subsonicService') depending on depth.
 *
 * All async functions return null/[] by default.
 * Override per-test with mockResolvedValue / mockResolvedValueOnce.
 */

export const login = jest.fn().mockResolvedValue({ success: false, error: 'mock' });
export const getApi = jest.fn().mockReturnValue(null);
export const getApiUnchecked = jest.fn().mockReturnValue(null);
export const clearApiCache = jest.fn();

export const VARIOUS_ARTISTS_NAME = 'Various Artists';
export const VARIOUS_ARTISTS_BIO =
  'Various Artists collects compilation albums, soundtracks, tribute records and other ' +
  'releases that feature songs from multiple artists.\n\n' +
  "Browse the albums below to discover what's in your collection.";
export const VARIOUS_ARTISTS_COVER_ART_ID = '__various_artists_cover__';
export const getVariousArtistsName = () => VARIOUS_ARTISTS_NAME;
export const getVariousArtistsBio = () => VARIOUS_ARTISTS_BIO;

export const isVariousArtists = (name: string | undefined) =>
  name?.trim().toLowerCase() === 'various artists';

export const ensureCoverArtAuth = jest.fn().mockResolvedValue(undefined);
export const getCoverArtUrl = jest.fn().mockReturnValue(null);
export const normalizeServerUrl = jest.fn((url: string) => url.trim().replace(/\/+$/, ''));
export const getStreamUrl = jest.fn().mockReturnValue(null);
export const getDownloadStreamUrl = jest.fn().mockReturnValue(null);

export const getRecentlyAddedAlbums = jest.fn().mockResolvedValue([]);
export const getRecentlyPlayedAlbums = jest.fn().mockResolvedValue([]);
export const getFrequentlyPlayedAlbums = jest.fn().mockResolvedValue([]);
export const getRandomAlbums = jest.fn().mockResolvedValue([]);
export const getAlbum = jest.fn().mockResolvedValue(null);
export const getAlbumInfo2 = jest.fn().mockResolvedValue(null);
export const probeEmptySearch3 = jest.fn().mockResolvedValue(true);
export const searchAlbumsPage = jest.fn().mockResolvedValue([]);
export const searchSongsPage = jest.fn().mockResolvedValue([]);
export const getAlbumListAlphabetical = jest.fn().mockResolvedValue([]);
export const getAlbumsPageByName = jest.fn().mockResolvedValue([]);
export const getAllAlbumsAlphabetical = jest.fn().mockResolvedValue([]);
export const getAllArtists = jest.fn().mockResolvedValue([]);
export const getArtist = jest.fn().mockResolvedValue(null);
export const getArtistInfo2 = jest.fn().mockResolvedValue(null);
export const getTopSongs = jest.fn().mockResolvedValue([]);
export const getRandomSongsFiltered = jest.fn().mockResolvedValue([]);
export const getSimilarSongs = jest.fn().mockResolvedValue([]);
export const getSimilarSongs2 = jest.fn().mockResolvedValue([]);
export const getAllPlaylists = jest.fn().mockResolvedValue([]);
export const getPlaylist = jest.fn().mockResolvedValue(null);
export const deletePlaylist = jest.fn().mockResolvedValue(false);
export const updatePlaylistOrder = jest.fn().mockResolvedValue(undefined);
export const createNewPlaylist = jest.fn().mockResolvedValue(null);
export const addToPlaylist = jest.fn().mockResolvedValue(undefined);
export const removeFromPlaylist = jest.fn().mockResolvedValue(undefined);
export const fetchServerInfo = jest.fn().mockResolvedValue(null);
export const getStarred2 = jest.fn().mockResolvedValue({ albums: [], artists: [], songs: [] });
export const search3 = jest.fn().mockResolvedValue({ albums: [], artists: [], songs: [] });
export const starAlbum = jest.fn().mockResolvedValue(undefined);
export const unstarAlbum = jest.fn().mockResolvedValue(undefined);
export const starArtist = jest.fn().mockResolvedValue(undefined);
export const unstarArtist = jest.fn().mockResolvedValue(undefined);
export const starSong = jest.fn().mockResolvedValue(undefined);
export const unstarSong = jest.fn().mockResolvedValue(undefined);
export const setRating = jest.fn().mockResolvedValue(undefined);
export const getScanStatus = jest.fn().mockResolvedValue(null);
export const startScan = jest.fn().mockResolvedValue(null);
export const getGenres = jest.fn().mockResolvedValue(null);
export const getSongsByGenre = jest.fn().mockResolvedValue(null);
export const getShares = jest.fn().mockResolvedValue({ ok: false, reason: 'error', message: 'Not connected to a server.' });

export const RADIO_ID_PREFIX = 'internet-radio:';
export const isRadioChild = (child: { id: string }) =>
  child.id.startsWith(RADIO_ID_PREFIX) &&
  typeof (child as { radioStreamUrl?: unknown }).radioStreamUrl === 'string';
export const radioStationToChild = jest.fn(
  (station: { id: string; name: string; streamUrl: string }) => ({
    id: `${RADIO_ID_PREFIX}${station.id}`,
    isDir: false,
    title: station.name,
    artist: 'Internet Radio',
    duration: 0,
    radioStreamUrl: station.streamUrl,
  }),
);
export const getInternetRadioStations = jest.fn().mockResolvedValue(null);
export const isRadioId = (id: string) => id.startsWith(RADIO_ID_PREFIX);
export const radioStationIdFromChildId = (childId: string) =>
  childId.slice(RADIO_ID_PREFIX.length);
export const stationLogoUrl = jest.fn().mockReturnValue(null);
export const createRadioStation = jest.fn().mockResolvedValue({ ok: true });
export const updateRadioStation = jest.fn().mockResolvedValue({ ok: true });
export const deleteRadioStation = jest.fn().mockResolvedValue({ ok: true });
export const createShare = jest.fn().mockResolvedValue(null);
export const updateShare = jest.fn().mockResolvedValue(undefined);
export const deleteShare = jest.fn().mockResolvedValue(false);
