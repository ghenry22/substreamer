/**
 * CarPlay / Android Auto browse + playback service.
 *
 * Feeds RNQP a browse snapshot built from the app's stores and resolves
 * taps/voice to the app's `playTrack()` (which carries all app bookkeeping —
 * offline filtering, streaming, artwork, scrobble). Registered at bootstrap
 * (AFTER `configure()`) so a cold car / Siri / Assistant wake is served before
 * any UI mounts. Lifecycle:
 *   installHeadlessMediaService → registerPlaybackService(() => handler) + pushSnapshot,
 *   push on onCarConnect, re-install on onServiceReady('service-reborn').
 *
 * The four sections (platform ~4-tab limit): Home (curated album lists, offline
 * recomposed via homeSectionsService), Favorites (flat songs), Albums (A–Z
 * buckets), Playlists. See src/services/headlessMediaService.helpers.ts for the
 * id scheme + A–Z bucketing.
 */
import type {
  BrowseItem,
  BrowseSection,
  BrowseSnapshot,
  MediaSearchRequest,
  PlaybackServiceHandler,
  TrackItem,
} from 'react-native-queue-player';
import { getTrackPlayer, registerPlaybackService, SectionIcon } from 'react-native-queue-player';

import type { AlbumID3, Child, Playlist } from './subsonicService';
import { buildPlayableQueue } from './playerHelpers';
import { playTrack, initPlayer } from './playerService';
import { initScrobbleService } from './scrobbleService';
import { resolveDisplayImage, resolveDisplayImages } from './imageCacheService';
import { coverArtForAlbum, coverArtForPlaylist } from '../utils/coverArtId';
import { baseCollator } from '../utils/intl';
import {
  searchLibrary,
  performOnlineSearch,
  getOfflineSongsByGenre,
  findAlbum,
  findArtistSongs,
} from './searchService';
import { logVoiceSearch } from './voiceSearchLogger';
import { scoreCandidate, REJECT } from './searchMatch';
import { composeHomeAlbumSections, type ComposeHomeInput } from './homeSectionsService';
import { getDb } from '../store/persistence/db';
import {
  listAllAlbums,
  albumBrowseRowToAlbumID3,
  albumListRowToAlbumID3,
} from '../db/repository/albums';
import { listAllStarredSongs, listStarredArtistNames, starredItemOf } from '../db/repository/favorites';
import { listAllPlaylists, playlistBrowseRowToPlaylist } from '../db/repository/playlists';
import {
  listDownloadedAlbumIds,
  listDownloadedAlbums,
  listDownloadedPlaylistIds,
} from '../db/repository/downloads';
import { favoritesStore } from '../store/favoritesStore';
import { albumListsStore } from '../store/albumListsStore';
import { fetchAlbumDetail, fetchPlaylistDetail } from './detailFetchService';
import { offlineModeStore } from '../store/offlineModeStore';
import { authStore } from '../store/authStore';
import { isLogoutPending } from '../store/logoutPending';
import { syncStatusStore } from '../store/syncStatusStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { awaitKvHydration, rehydrateAllStores } from '../store/persistence/rehydrate';
import { shouldBlockContent } from './navidromeReid/reidMarker';
import i18n from '../i18n/i18n';
import {
  CAR_ROOT_ID,
  CAR_MAX_ITEMS_PER_NODE,
  sectionId,
  listId,
  albumId,
  playlistId,
  albumTrackId,
  playlistTrackId,
  favTrackId,
  parseMediaId,
  albumLetterRows,
  albumsForLetter,
  albumsForBucket,
  resolveAlbumLetterNode,
  type AzItem,
} from './headlessMediaService.helpers';

const LOG_TAG = '[headlessMediaService]';
const ART_SIZE = 300;
const SEARCH_ID_PREFIX = 'search:';

/* ------------------------------------------------------------------ */
/*  Mode-appropriate data selectors                                    */
/* ------------------------------------------------------------------ */

/**
 * Offline for the car's purposes — the user's own offline mode, OR a Navidrome re-key
 * that has not run yet.
 *
 * A pending re-key means our ids may be the ones the server has retired, so anything
 * server-backed would 404. Downloads are different: they play from local files keyed by
 * `cached_songs`, so their ids never reach the server and they work exactly as they do
 * in offline mode. Treating the pending state AS offline therefore reuses a path that is
 * already correct rather than inventing a second one — and it is what the user asked
 * for: a car that still plays your downloaded music while the update waits.
 *
 * This replaced a blanket refusal that returned an empty browse tree, which stranded
 * someone driving away from home with downloaded music and no way to reach it.
 */
function isOffline(): boolean {
  return offlineModeStore.getState().offlineMode || shouldBlockContent();
}

/**
 * Headless serves nothing without an account, or while a logout is pending: the tables
 * may still hold the previous account's library, and the splash is what finishes the wipe.
 */
function headlessSessionReady(): boolean {
  return authStore.getState().isLoggedIn && !isLogoutPending();
}

/** All library albums from the normalized `albums` table (sort-title order). This is a
 *  WHOLE-TABLE load — the car browse tree needs the full A–Z set to bucket it. */
async function allAlbums(): Promise<AlbumID3[]> {
  const db = getDb();
  return db ? (await listAllAlbums(db)).map(albumBrowseRowToAlbumID3) : [];
}

/** All playlists from the normalized `playlists` table. */
async function allPlaylists(): Promise<Playlist[]> {
  const db = getDb();
  return db ? (await listAllPlaylists(db)).map(playlistBrowseRowToPlaylist) : [];
}

/** Library albums, filtered to downloaded when offline. MEMBERSHIP, not visibility: these
 *  albums came from the library table and already carry their metadata, so an item row in
 *  `cached_items` is all "downloaded" means (see `downloads.ts`). */
async function albumSet(): Promise<AlbumID3[]> {
  const albums = await allAlbums();
  if (!isOffline()) return albums;
  const db = getDb();
  if (!db) return [];
  const includePartial = layoutPreferencesStore.getState().includePartialInDownloadedFilter;
  const downloadedIds = await listDownloadedAlbumIds(db, { includePartial });
  return albums.filter((a) => downloadedIds.has(a.id));
}

/** Favorite songs, filtered to downloaded when offline. ONE ordering, shared by the
 *  browse rows (display-capped) and `resolvePlayback` (full list) — `favTrackId(i)`
 *  indexes across both, so they must agree row for row. */
async function favoriteSongs(): Promise<Child[]> {
  const db = getDb();
  if (!db) return [];
  return (await listAllStarredSongs(db, { downloadedOnly: isOffline() })).map(starredItemOf);
}

/** Playlists, filtered to downloaded when offline. MEMBERSHIP, exactly like `albumSet`:
 *  these playlists came from the library table and already carry their metadata, so an
 *  item row in `cached_items` is all "downloaded" means. No partial gate — playlists
 *  download atomically. */
async function playlistSet(): Promise<Playlist[]> {
  const pls = await allPlaylists();
  if (!isOffline()) return pls;
  const db = getDb();
  if (!db) return [];
  const downloadedIds = await listDownloadedPlaylistIds(db);
  return pls.filter((p) => downloadedIds.has(p.id));
}

async function azItems(): Promise<AzItem[]> {
  return (await albumSet()).map((a) => ({
    id: a.id,
    title: a.name,
    coverArt: a.coverArt ?? undefined,
    subtitle: a.artist ?? undefined,
  }));
}

/**
 * The `ComposeHomeInput` for the car's Home section. Async because both downloaded
 * reads are SQL; costless here, since there is no UI to flash an empty state at.
 */
async function homeInput(): Promise<ComposeHomeInput> {
  const offline = isOffline();
  const lists = albumListsStore.getState();
  const includePartial = layoutPreferencesStore.getState().includePartialInDownloadedFilter;
  const db = getDb();
  // Two different predicates, both from the never-reaped download tables (offline-safe):
  // the Downloaded Albums body needs renderable metadata (VISIBILITY), the curated-list
  // filter only needs ids because those albums carry their own (MEMBERSHIP).
  // ORDERED by SQL under the phone's own album-sort preference, so the browse tree and
  // the Home screen show the same sequence.
  const sortOrder = layoutPreferencesStore.getState().albumSortOrder;
  const [downloadedAlbums, downloadedAlbumIds]: [AlbumID3[], ReadonlySet<string>] = db
    ? await Promise.all([
        listDownloadedAlbums(db, { includePartial, sortOrder }).then((rs) =>
          rs.map(albumListRowToAlbumID3),
        ),
        listDownloadedAlbumIds(db, { includePartial }),
      ])
    : [[], new Set<string>()];
  return {
    recentlyAdded: lists.recentlyAdded,
    recentlyPlayed: lists.recentlyPlayed,
    frequentlyPlayed: lists.frequentlyPlayed,
    randomSelection: lists.randomSelection,
    downloadedAlbums,
    offlineMode: offline,
    downloadedOnly: offline,
    favoritesOnly: false,
    // `favoritesOnly` is hard-coded false above, so the composer never reads this.
    starredAlbumIds: new Set<string>(),
    downloadedAlbumIds,
  };
}

/* ------------------------------------------------------------------ */
/*  Browse-item mappers                                                */
/* ------------------------------------------------------------------ */

/**
 * Row artwork via the app's SHARED resolver (`resolveDisplayImage`) — the same
 * file:// cache → server-URL decision (offline/remote-failed-gated) `CachedImage`
 * uses. Keyed off the entity's coverArt VALUE, never its id.
 */
async function resolveRowArtwork(coverArtValue: string | undefined): Promise<string | undefined> {
  if (!coverArtValue) return undefined;
  return (await resolveDisplayImage({ coverArt: coverArtValue }, ART_SIZE, { offline: isOffline() })).uri ?? undefined;
}

async function albumRow(album: AlbumID3): Promise<BrowseItem> {
  return {
    id: albumId(album.id),
    title: album.name,
    subtitle: album.artist ?? undefined,
    artworkUrl: await resolveRowArtwork(coverArtForAlbum(album)),
    playable: false,
    hasChildren: true,
  };
}

/** A–Z leaf album row — artwork + artist subtitle via the values carried on the
 *  AzItem, so it matches the home-list album rows (bucketing only uses `title`). */
const toAzAlbumRow = async (a: AzItem): Promise<BrowseItem> => ({
  id: albumId(a.id),
  title: a.title,
  subtitle: a.subtitle,
  artworkUrl: await resolveRowArtwork(a.coverArt),
  playable: false,
  hasChildren: true,
});

async function playlistRow(pl: Playlist): Promise<BrowseItem> {
  return {
    id: playlistId(pl.id),
    title: pl.name,
    subtitle: i18n.t('cacheTracksValue', { count: pl.songCount }),
    artworkUrl: await resolveRowArtwork(coverArtForPlaylist(pl)),
    playable: false,
    hasChildren: true,
  };
}

/** Playable song rows for a list, artwork from the one cover resolver in one query.
 *  `idFor(index)` builds the per-context media id (album / playlist / fav / search). */
async function trackRows(
  tracks: ReadonlyArray<Child>,
  idFor: (index: number) => string,
): Promise<BrowseItem[]> {
  const artwork = await resolveDisplayImages(tracks, ART_SIZE, { offline: isOffline() });
  return tracks.map((t, i) => ({
    id: idFor(i),
    title: t.title,
    subtitle: t.artist ?? undefined,
    artworkUrl: artwork[i].uri ?? undefined,
    playable: true,
    hasChildren: false,
  }));
}

/* ------------------------------------------------------------------ */
/*  Snapshot                                                           */
/* ------------------------------------------------------------------ */

async function buildSnapshot(): Promise<BrowseSnapshot> {
  // Home: curated album lists (offline recomposed — drop Random, add
  // Downloaded Albums, filter to downloaded) — one drill row per non-empty list.
  const homeItems: BrowseItem[] = composeHomeAlbumSections(await homeInput())
    .filter((s) => s.albums.length > 0)
    .map((s) => ({
      id: listId(s.type),
      title: i18n.t(s.titleKey),
      playable: false,
      hasChildren: true,
    }));

  // Favorites: flat playable songs (display-capped; play uses the same list).
  const favItems = await trackRows(
    (await favoriteSongs()).slice(0, CAR_MAX_ITEMS_PER_NODE),
    favTrackId,
  );

  // Albums: A–Z letter buckets first (mandatory — libraries exceed the cap).
  const albumItems = albumLetterRows(await azItems());

  // Playlists: shown directly (display-capped; play loads the full list).
  const playlistItems = await Promise.all(
    (await playlistSet()).slice(0, CAR_MAX_ITEMS_PER_NODE).map(playlistRow),
  );

  return snapshotOf(homeItems, favItems, albumItems, playlistItems);
}

/** The four tabs, always all four: CarPlay's tab bar is never left empty. */
function snapshotOf(
  homeItems: BrowseItem[],
  favItems: BrowseItem[],
  albumItems: BrowseItem[],
  playlistItems: BrowseItem[],
): BrowseSnapshot {
  const sections: BrowseSection[] = [
    { id: sectionId('home'), title: i18n.t('home'), icon: SectionIcon.Home, items: homeItems },
    {
      id: sectionId('favorites'),
      title: i18n.t('favorites'),
      icon: SectionIcon.Favourites,
      items: favItems,
    },
    { id: sectionId('albums'), title: i18n.t('albums'), icon: SectionIcon.Albums, items: albumItems },
    {
      id: sectionId('playlists'),
      title: i18n.t('playlists'),
      icon: SectionIcon.Playlists,
      items: playlistItems,
    },
  ];
  return { rootId: CAR_ROOT_ID, sections };
}

/* ------------------------------------------------------------------ */
/*  Drilldown resolution                                               */
/* ------------------------------------------------------------------ */

/**
 * In offline mode, drop album tracks with no downloaded file. The app greys these
 * out instead (`TrackRow`'s `isOfflineUnplayable`), but a car list has no useful
 * disabled state — an unplayable row just invites a tap that does nothing.
 *
 * Albums only: they are the sole item type with a partial download state
 * (`isPartialAlbum`), so a downloaded playlist or favorites set always holds every
 * track and has nothing to filter.
 *
 * Applied inside `albumSongs` so browse, play and voice see the SAME list — the
 * browse media ids encode a position (`albumTrackId(id, i)`) that playback resolves
 * against, so filtering one caller and not another would play the wrong track.
 */
function playableOffline(songs: Child[]): Child[] {
  if (!isOffline()) return songs;
  const cached = musicCacheStore.getState().cachedSongs;
  return songs.filter((s) => s.id in cached);
}

/** Album tracks via the SHARED offline-aware `fetchAlbum` — same function + source
 *  the app's album screen uses (online → server; offline → persisted detail cache). */
async function albumSongs(id: string): Promise<Child[]> {
  try {
    return playableOffline((await fetchAlbumDetail(id))?.song ?? []);
  } catch (e) {
    console.warn(`${LOG_TAG} fetchAlbum(${id}) failed:`, e);
    return [];
  }
}

/** Playlist entries via the SHARED offline-aware `fetchPlaylist` — same function +
 *  source the app's playlist screen uses (online → server; offline → detail cache). */
async function playlistSongs(id: string): Promise<Child[]> {
  try {
    return (await fetchPlaylistDetail(id))?.entry ?? [];
  } catch (e) {
    console.warn(`${LOG_TAG} fetchPlaylist(${id}) failed:`, e);
    return [];
  }
}

async function resolveBrowseChildren(parentId: string): Promise<BrowseItem[]> {
  await ensureHeadlessDataReady();
  const p = parseMediaId(parentId);
  switch (p.kind) {
    case 'list': {
      const section = composeHomeAlbumSections(await homeInput()).find((s) => s.type === p.list);
      return Promise.all((section?.albums ?? []).map(albumRow));
    }
    case 'azLetter': {
      const items = await azItems();
      return resolveAlbumLetterNode(albumsForLetter(items, p.letter), p.letter, toAzAlbumRow);
    }
    case 'azBucket':
      return Promise.all(albumsForBucket(await azItems(), p.letter, p.lo, p.hi).map(toAzAlbumRow));
    case 'album':
      return trackRows(await albumSongs(p.albumId), (i) => albumTrackId(p.albumId, i));
    case 'playlist':
      return trackRows(
        (await playlistSongs(p.playlistId)).slice(0, CAR_MAX_ITEMS_PER_NODE),
        (i) => playlistTrackId(p.playlistId, i),
      );
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Play resolution                                                    */
/* ------------------------------------------------------------------ */

interface ResolvedPlayback {
  queue: Child[];
  startIndex: number;
  sourcePlaylistId: string | null;
}

const clampIndex = (i: number, q: readonly Child[]): number =>
  i >= 0 && i < q.length ? i : 0;

/** Last search's songs — so a tapped search-result row resolves to playback. */
let lastSearchSongs: Child[] = [];

async function resolvePlayback(mediaId: string): Promise<ResolvedPlayback> {
  await ensureHeadlessDataReady();
  if (mediaId.startsWith(SEARCH_ID_PREFIX)) {
    const i = Number(mediaId.slice(SEARCH_ID_PREFIX.length));
    if (Number.isInteger(i) && i >= 0 && i < lastSearchSongs.length) {
      return { queue: lastSearchSongs, startIndex: i, sourcePlaylistId: null };
    }
    return { queue: [], startIndex: 0, sourcePlaylistId: null };
  }
  const p = parseMediaId(mediaId);
  if (p.kind === 'track') {
    if (p.ctx === 'album') {
      const queue = await albumSongs(p.ctxId);
      return { queue, startIndex: clampIndex(p.index, queue), sourcePlaylistId: null };
    }
    if (p.ctx === 'playlist') {
      const queue = await playlistSongs(p.ctxId);
      return { queue, startIndex: clampIndex(p.index, queue), sourcePlaylistId: p.ctxId };
    }
    // fav
    const queue = await favoriteSongs();
    return { queue, startIndex: clampIndex(p.index, queue), sourcePlaylistId: null };
  }
  return { queue: [], startIndex: 0, sourcePlaylistId: null };
}

async function findPlaylistByName(name: string): Promise<Playlist | undefined> {
  const target = name.trim().toLowerCase();
  const pls = await playlistSet();
  return (
    pls.find((p) => p.name.trim().toLowerCase() === target) ??
    pls.find((p) => p.name.trim().toLowerCase().includes(target))
  );
}

/** One-line description of a voice request for the diagnostics log — reveals
 *  exactly what the assistant transcribed (query/song/artist/…) so an on-device
 *  miss is debuggable. Gated by the Voice Search Diagnostics toggle. */
function describeVoiceRequest(r: MediaSearchRequest): string {
  const f = (k: string, v?: string) => (v ? ` ${k}=${JSON.stringify(v)}` : '');
  return (
    `request origin=${r.origin ?? '?'} offline=${isOffline()}` +
    f('type', r.type) +
    f('query', r.query) +
    f('song', r.song) +
    f('artist', r.artist) +
    f('album', r.album) +
    f('playlist', r.playlist) +
    f('genre', r.genre)
  );
}

type VoiceIntent = 'playlist' | 'genre' | 'album' | 'artist' | 'song' | 'free-text';

/** Classify a voice request into an intent: the assistant's `type` when present
 *  (iOS SiriKit + Android media-focus set it), else inferred from populated
 *  slots, else free-text. Never assumes a field is present. */
function classifyVoiceIntent(r: MediaSearchRequest): VoiceIntent {
  switch (r.type) {
    case 'playlist':
      return 'playlist';
    case 'genre':
      return 'genre';
    case 'album':
      return 'album';
    case 'artist':
      return 'artist';
    case 'song':
      return 'song';
    default:
      break; // no / unrecognized type → infer from the populated slots
  }
  if (r.playlist?.trim()) return 'playlist';
  if (r.genre?.trim()) return 'genre';
  if (r.album?.trim()) return 'album';
  if (r.song?.trim()) return 'song';
  if (r.artist?.trim()) return 'artist';
  return 'free-text';
}

/**
 * Song-title search with the artist as a SCORING signal (boost + fuzzy filter)
 * via `scoreCandidate`, so "by Korn" — and phonetically "by corn" — locks onto
 * Korn. Keeps the top title hit if the artist floor empties the list (better to
 * play something than nothing).
 */
async function resolveSongIntent(song: string, artist?: string): Promise<Child[]> {
  const { songs } = await searchLibrary(song);
  if (songs.length === 0 || !artist?.trim()) return songs;
  const ranked = songs
    .map((s) => ({
      s,
      score: scoreCandidate({ song, artist }, { title: s.title ?? '', artist: s.artist }),
    }))
    .sort((a, b) => b.score - a.score);
  const kept = ranked.filter((r) => r.score >= REJECT).map((r) => r.s);
  return kept.length ? kept : [ranked[0].s];
}

/** Album tracks in playback order: disc, then track, then a stable id tiebreak
 *  (defensive — servers usually return album order, but multi-disc can slip). */
function sortAlbumTracks(songs: Child[]): Child[] {
  return [...songs].sort((a, b) => {
    const ad = a.discNumber ?? 1;
    const bd = b.discNumber ?? 1;
    if (ad !== bd) return ad - bd;
    const at = a.track ?? 0;
    const bt = b.track ?? 0;
    if (at !== bt) return at - bt;
    return (a.id ?? '') < (b.id ?? '') ? -1 : 1;
  });
}

/** Resolve a voice request → a Child[] to play. Intent-driven: the assistant's
 *  structure (playlist / genre / album / artist / song) is used when present,
 *  with a free-text fallback and every branch falling through rather than
 *  dead-ending. */
async function resolveVoice(request: MediaSearchRequest): Promise<Child[]> {
  await ensureHeadlessDataReady();
  logVoiceSearch(describeVoiceRequest(request));
  const intent = classifyVoiceIntent(request);
  logVoiceSearch(`intent=${intent}`);

  if (intent === 'playlist') {
    const pl = await findPlaylistByName(request.playlist?.trim() || request.query);
    if (pl) {
      const songs = await playlistSongs(pl.id);
      if (songs.length) {
        logVoiceSearch(`→ playlist "${pl.name}": ${songs.length} songs`);
        return songs;
      }
    }
    // no playlist matched → fall through to a text search
  }

  if (intent === 'genre') {
    const genre = request.genre?.trim() || request.query;
    const byGenre = isOffline()
      ? getOfflineSongsByGenre(genre)
      : await getOnlineSongsByGenre(genre);
    if (byGenre.length) {
      logVoiceSearch(`→ genre "${genre}": ${byGenre.length} songs`);
      return byGenre;
    }
    // no genre songs → fall through
  }

  if (intent === 'album') {
    // Match the album name over the local album list, preferring the given
    // artist ("Ten by Pearl Jam" → Pearl Jam's Ten), then play it in order.
    const albumName = request.album?.trim() || request.song?.trim() || request.query;
    const album = await findAlbum(albumName, request.artist);
    if (album) {
      const tracks = sortAlbumTracks(await albumSongs(album.id));
      if (tracks.length) {
        logVoiceSearch(`→ album "${album.name}" / "${album.artist ?? ''}": ${tracks.length} tracks`);
        return tracks;
      }
    }
    // no album resolved → fall through to a song search
  }

  if (intent === 'artist') {
    const artistName = request.artist?.trim() || request.query;
    const artistSongs = await findArtistSongs(artistName);
    if (artistSongs.length) {
      logVoiceSearch(`→ artist "${artistName}": ${artistSongs.length} songs`);
      return artistSongs;
    }
    // no strong artist match → fall through
  }

  // song / free-text (and any fall-throughs above): title search with fuzzy
  // artist boost/filter.
  const term = request.song?.trim() || request.album?.trim() || request.query;
  const songs = await resolveSongIntent(term, request.artist);
  logVoiceSearch(
    `→ search term=${JSON.stringify(term)}: ${songs.length} hit(s)` +
      (songs[0]
        ? ` top="${songs[0].title ?? ''}" / "${songs[0].artist ?? ''}"`
        : ' (MISS)'),
  );
  return songs;
}

/**
 * Dispatch a voice request (Android App Actions deep link, from the `play`
 * route) through the same resolver + playback path as `onPlayFromSearchRequest`.
 */
export async function dispatchVoiceSearchRequest(request: MediaSearchRequest): Promise<void> {
  if (!headlessSessionReady()) return;
  // No re-key refusal: `resolveVoice` runs through the same offline-aware resolvers as
  // browse, so a pending re-key narrows this to downloads rather than blocking it.
  const queue = await resolveVoice(request);
  if (queue.length === 0) return;
  await playTrack(queue[0], queue, null);
}

/** Online genre → songs via a search fallback (no dedicated genre API here). */
async function getOnlineSongsByGenre(genre: string): Promise<Child[]> {
  const results = await performOnlineSearch(genre);
  return results.songs.filter((s) => (s.genre ?? '').toLowerCase() === genre.toLowerCase());
}

async function resolveSearch(query: string): Promise<BrowseItem[]> {
  await ensureHeadlessDataReady();
  if (query.trim().length === 0) return [];
  const results = await searchLibrary(query);
  lastSearchSongs = results.songs;
  const songRows = await trackRows(results.songs, (i) => `${SEARCH_ID_PREFIX}${i}`);
  const albumRows = await Promise.all(results.albums.map(albumRow));
  // Songs first (most likely intent), then album drill rows; cap per node.
  return [...songRows, ...albumRows].slice(0, CAR_MAX_ITEMS_PER_NODE);
}

/* ------------------------------------------------------------------ */
/*  Snapshot push + voice vocabulary                                   */
/* ------------------------------------------------------------------ */

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => baseCollator.compare(a, b));
}

async function donateVocabulary(): Promise<void> {
  try {
    const [albums, playlists] = await Promise.all([allAlbums(), allPlaylists()]);
    const db = getDb();
    const artists = uniqueSorted([
      ...albums.map((a) => a.artist).filter((a): a is string => !!a),
      ...(db ? await listStarredArtistNames(db) : []),
    ]);
    getTrackPlayer().donateVoiceVocabulary({ artists, playlists: playlists.map((p) => p.name) });
  } catch (e) {
    console.warn(`${LOG_TAG} donateVoiceVocabulary failed:`, e);
  }
}

async function pushSnapshot(): Promise<void> {
  try {
    // Single source of truth for "a car is listening": RNQP's native, process-scoped
    // connection state, which survives a missed onCarConnect (e.g. the CarPlay scene
    // attached before this JS process registered its handler on a headless launch).
    // Gating here means no buildSnapshot / setBrowseSnapshot work at all on the
    // phone-only path, and every caller inherits it.
    // A pending Navidrome id re-key means every id we hold is one the server has
    // retired. `index.js` loads playerBootstrap before expo-router, so a CarPlay / Siri /
    // lock-screen cold wake arms this service without rendering `_layout` and without
    // running the migration chain — the interstitial cannot gate it.
    //
    // The snapshot is still pushed, because `buildSnapshot` reads the same offline-aware
    // browse tree: a pending re-key narrows it to downloaded music, which plays from
    // local files and needs no server. Refusing outright used to leave a driver with
    // downloads on the device and an empty car UI.
    // Not ready still pushes, empty: the native snapshot keeps the last one pushed, which
    // after a logout is the previous account's library.
    const ready = headlessSessionReady();
    if (getTrackPlayer().isCarConnected()) {
      const snapshot = ready ? await buildSnapshot() : snapshotOf([], [], [], []);
      getTrackPlayer().setBrowseSnapshot(snapshot);
    }
    // Siri vocabulary is iOS SiriKit (INVocabulary) — phone-side, independent of any
    // car connection — so it is NOT car-gated (unlike the browse snapshot above).
    if (ready) await donateVocabulary();
    else getTrackPlayer().donateVoiceVocabulary({ artists: [], playlists: [] });
  } catch (e) {
    console.warn(`${LOG_TAG} pushSnapshot failed:`, e);
  }
}

/* ------------------------------------------------------------------ */
/*  Handler + lifecycle                                                */
/* ------------------------------------------------------------------ */

const handler: PlaybackServiceHandler = {
  // No blanket refusal here any more: `isOffline()` already covers a pending re-key, so
  // these resolve the downloads-only view rather than an empty one.
  onBrowseRequest: async (parentId) =>
    (headlessSessionReady() ? resolveBrowseChildren(parentId) : []),
  onSearchRequest: async (query) => (headlessSessionReady() ? resolveSearch(query) : []),
  onPlayFromIdRequest: async (mediaId) => {
    if (!headlessSessionReady()) return [];
    const { queue, startIndex, sourcePlaylistId } = await resolvePlayback(mediaId);
    if (queue.length === 0) return [];
    // Fire-and-forget playTrack (carries app bookkeeping); native steps back and
    // does not double-apply. Return the TrackItem[] for the RNQP contract.
    void playTrack(queue[startIndex], queue, sourcePlaylistId);
    const { rnTracks } = await buildPlayableQueue(queue);
    return rnTracks;
  },
  onPlayFromSearchRequest: async (request) => {
    if (!headlessSessionReady()) return [];
    const queue = await resolveVoice(request);
    if (queue.length === 0) return [];
    void playTrack(queue[0], queue, null);
    const { rnTracks } = await buildPlayableQueue(queue);
    return rnTracks;
  },
  onCarConnect: () => {
    // RNQP sets its native connection flag BEFORE firing this callback, so the
    // gated pushSnapshot() sees isCarConnected() === true and proceeds.
    void pushSnapshot();
  },
  onServiceReady: (reason) => {
    if (reason === 'service-reborn') {
      // The OS rebuilt the service after a kill; its BrowseDataProvider starts
      // empty. Drop the guard so installHeadlessMediaService re-registers + re-pushes.
      installed = false;
      installHeadlessMediaService();
    }
  },
};

let installed = false;
let subscribed = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/** Set once the initial hydrate-then-push has run; gates `scheduleRefresh`. */
let dataReady = false;
/** Store-subscription disposers, captured so `__test.reset()` can tear them down. */
const headlessSubscriptions: Array<() => void> = [];
/** Memoized full-hydration promise (see `ensureHeadlessDataReady`). */
let dataReadyPromise: Promise<void> | null = null;

/** Coalesce library-change re-pushes into one push per ~30s, and only while a
 *  car is connected — never churn the native cache on every store write
 *  (anti-refresh-loop). `pushSnapshot` re-checks the live connection at fire time,
 *  so a mid-window disconnect makes the deferred push a no-op. */
function scheduleRefresh(): void {
  // Hydration replaces whole store slices, which every subscription below reads as a
  // change. Ignore refreshes until the post-hydration push has already gone out.
  if (!dataReady || refreshTimer || !getTrackPlayer().isCarConnected()) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void pushSnapshot();
  }, 30_000);
}

/**
 * Full headless hydration, memoized. On a CarPlay / Siri cold-launch the phone
 * app's UI never mounts, so the normal startup hydration chain (`_layout` →
 * `rehydrateAllStores()` + `awaitKvHydration()`) never runs. We run the SAME pair
 * here so every headless surface — browse, voice, and CarPlay if plugged in after
 * a voice-triggered start — reads fully-hydrated stores (same data the app uses).
 * Memoized: runs once per process once the session is ready (before that it does
 * nothing and is not memoized, so a call after login hydrates), and is a cheap no-op
 * await once the app has been opened (every store already hydrated). Awaited by `hydrateThenPush` and at
 * the top of each RNQP resolver so nothing reads `isOffline()`/stores too early.
 */
function ensureHeadlessDataReady(): Promise<void> {
  if (!headlessSessionReady()) return Promise.resolve();
  if (!dataReadyPromise) {
    dataReadyPromise = Promise.all([rehydrateAllStores(), awaitKvHydration()])
      // Run the full player + scrobble init now that the stores are hydrated. On
      // a headless CarPlay/Siri cold start the UI's `initPlayer()` /
      // `initScrobbleService()` never run, so a headless queue would ignore
      // persisted repeat (+ speed/pitch/EQ) and — crucially — never attach the
      // onTrackChange/onProgress listeners that capture scrobbles, nor the retry
      // timer that drains the pending queue. Both are idempotent.
      .then(async () => {
        await initPlayer();
        initScrobbleService();
      })
      .catch((e) => console.warn(`${LOG_TAG} ensureHeadlessDataReady failed:`, e));
  }
  return dataReadyPromise;
}

/** Hydrate the full store set, then push the now-populated browse snapshot. */
async function hydrateThenPush(): Promise<void> {
  await ensureHeadlessDataReady();
  dataReady = true;
  void pushSnapshot();
}

/**
 * Idempotent install — register the handler + push the initial snapshot, and
 * (once) subscribe to offline-mode flips to re-push. Call at bootstrap AFTER
 * `configure()` resolves. RNQP's `registerPlaybackService` is itself idempotent
 * (replaces prior registrations); the guard is bookkeeping for our bootstrap.
 */
export function installHeadlessMediaService(): void {
  if (installed) return;
  installed = true;
  registerPlaybackService(() => handler);
  // Immediate push so the section tabs appear instantly WHEN a car is already
  // connected (e.g. a headless launch where the scene attached first); pushSnapshot
  // self-gates on the connection, so this no-ops on a phone-only launch. Content is
  // filled in by hydrateThenPush() once the persisted library loads from SQLite —
  // no phone-app open required.
  void pushSnapshot();
  void hydrateThenPush();
  if (!subscribed) {
    subscribed = true;
    // Offline flip rebuilds the whole tree — re-push. pushSnapshot self-gates on the
    // live car connection, so this is safe whether or not a car is attached.
    headlessSubscriptions.push(
      offlineModeStore.subscribe((state, prev) => {
        if (state.offlineMode !== prev.offlineMode) void pushSnapshot();
      }),
    );
    // Library changes → a debounced, self-gated refresh so the car tree stays
    // current without churning on every write. Module-lifetime subs.
    headlessSubscriptions.push(
      albumListsStore.subscribe(scheduleRefresh),
      favoritesStore.subscribe(scheduleRefresh),
      // Library data changed (album/artist/playlist sync, playlist create/rename/delete).
      // Compare the stamp rather than subscribing bare: syncStatusStore ticks on every
      // cursor write during a sync.
      syncStatusStore.subscribe((state, prev) => {
        if (state.libraryLastUpdatedAt !== prev.libraryLastUpdatedAt) scheduleRefresh();
      }),
      // Offline, the whole tree filters on the downloaded set, so a download finishing or
      // an item being deleted while already offline otherwise never reaches the car.
      // Totals, not `cachedItems` identity: re-hydration rebuilds that object with the
      // same contents, which would arm a redundant whole-table rebuild on every launch.
      musicCacheStore.subscribe((state, prev) => {
        if (state.totalFiles !== prev.totalFiles || state.totalBytes !== prev.totalBytes) {
          scheduleRefresh();
        }
      }),
    );
  }
}

/**
 * Re-push the snapshot once stores are hydrated (called from the app boot path
 * after `initPlayer()`), so a cold car wake that rendered an empty skeleton
 * self-corrects. No-op when no car is connected.
 */
export function refreshHeadlessMediaSnapshot(): void {
  void pushSnapshot();
}

/** Internal resolvers + lifecycle hooks exposed for unit tests (not public API). */
export const __test = {
  buildSnapshot,
  resolveBrowseChildren,
  resolvePlayback,
  resolveVoice,
  classifyVoiceIntent,
  pushSnapshot,
  /** Tear down subscriptions + reset module state so install-path tests isolate. */
  reset: () => {
    headlessSubscriptions.forEach((dispose) => dispose());
    headlessSubscriptions.length = 0;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    installed = false;
    subscribed = false;
    dataReady = false;
    dataReadyPromise = null;
  },
};
