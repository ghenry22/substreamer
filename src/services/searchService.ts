import {
  ensureCoverArtAuth,
  search3,
  SEARCH3_RESULT_LIMIT,
  type AlbumID3,
  type ArtistID3,
  type Child,
} from './subsonicService';
import { musicCacheStore, getSongEnvelope } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { syncStatusStore } from '../store/syncStatusStore';
import { connectivityStore } from '../store/connectivityStore';
import { getDb } from '../store/persistence/db';
import { hasLocalCorpus, searchAlbums, searchArtists, searchSongs } from '../db/repository/search';
import { albumListRowToAlbumID3, listAlbumsByIds } from '../db/repository/albums';
import { artistListRowToArtistID3 } from '../db/repository/artists';
import { songListRowToChild } from '../db/repository/songs';
import { listPlaylistsByIds, playlistListRowToPlaylist } from '../db/repository/playlists';
import { normalize, tokenize, metaphoneKey, scoreField, scoreCandidate, REJECT, CONFIDENT } from './searchMatch';
import { getGenreNames } from '../utils/genreHelpers';

export interface SearchResults {
  albums: AlbumID3[];
  artists: ArtistID3[];
  songs: Child[];
}

export async function performOnlineSearch(query: string): Promise<SearchResults> {
  await ensureCoverArtAuth();
  return search3(query);
}

/**
 * Offline search over the cached library.
 *
 * The per-song scan can sweep the entire downloaded catalog (tens of thousands of
 * rows on a heavily-cached device), so it must not run in one JS turn: it yields
 * every {@link OFFLINE_SCAN_CHUNK} song iterations, or typing in the search box
 * freezes the UI for the whole scan. `shouldAbort` cancels a scan whose keystroke
 * is no longer the current query. setTimeout, not rAF — rAF can stall on Fabric.
 */
const OFFLINE_SCAN_CHUNK = 1024;

export async function performOfflineSearch(
  query: string,
  shouldAbort?: () => boolean,
): Promise<SearchResults> {
  // Empty / whitespace query matches nothing (guards the scan too).
  if (!normalize(query)) return { albums: [], artists: [], songs: [] };
  const { cachedItems, cachedSongs } = musicCacheStore.getState();
  const cachedIds = Object.keys(cachedItems);

  // Relevance for a name (+ optional artist) — the best of the two field scores.
  const rel = (name: string, artist?: string | null): number =>
    Math.max(
      scoreField(query, name).score,
      artist ? scoreField(query, artist).score : 0,
    );

  // Downloaded albums/playlists: the normalized rows for the downloaded id set, scored in
  // full — perfect recall over that small set. No downloads / no db → nothing to match.
  const db = getDb();
  const albums = (db && cachedIds.length ? await listAlbumsByIds(db, cachedIds) : [])
    .map((r) => ({ a: albumListRowToAlbumID3(r), s: rel(r.name ?? '', r.display_artist) }))
    .filter((x) => x.s >= REJECT)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.a);

  const playlists = (db && cachedIds.length ? await listPlaylistsByIds(db, cachedIds) : [])
    .map((r) => ({ p: playlistListRowToPlaylist(r), s: scoreField(query, r.name ?? '').score }))
    .filter((x) => x.s >= REJECT)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.p);

  const playlistAlbums: AlbumID3[] = playlists.map((p) => ({
    id: p.id,
    name: p.name,
    artist: p.owner,
    coverArt: p.coverArt,
    songCount: p.songCount,
    duration: p.duration,
    created: p.created,
  }));

  const scored: Array<{ c: Child; s: number }> = [];
  const seen = new Set<string>();
  let ops = 0;
  for (const item of Object.values(cachedItems)) {
    for (const songId of item.songIds) {
      // Yield + abort check on a fixed iteration budget, counting every
      // song examined (including skips) so even a single huge item still
      // yields mid-scan.
      if (++ops % OFFLINE_SCAN_CHUNK === 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (shouldAbort?.()) return { albums: [], artists: [], songs: [] };
      }
      if (seen.has(songId)) continue;
      const track = cachedSongs[songId];
      if (!track) continue;
      // Score off the row, not the envelope: building one per candidate would
      // rebuild the whole downloaded catalog on every keystroke.
      const s = rel(track.title, track.artist);
      if (s < REJECT) continue;
      // The snapshot above predates the awaits, so a song deleted mid-scan is gone here.
      const envelope = getSongEnvelope(songId);
      if (!envelope) continue;
      seen.add(songId);
      scored.push({ c: { ...envelope, album: item.name }, s });
    }
  }
  scored.sort((a, b) => b.s - a.s);

  return {
    albums: [...albums, ...playlistAlbums].slice(0, ALBUM_RESULT_CAP),
    // No artists offline — a meaningful artist view needs online calls.
    artists: [],
    songs: scored.slice(0, SONG_RESULT_CAP).map((x) => x.c),
  };
}

const EMPTY_RESULTS: SearchResults = { albums: [], artists: [], songs: [] };

// Output caps. Local search can score hundreds of candidates and the results
// SectionList re-renders the whole set per keystroke, so an uncapped list makes the
// Search screen janky. Set to the server path's per-category cap (`search3` returns 20
// each) so the two paths feel the same. Results are ranked, so the cap keeps the best.
const SONG_RESULT_CAP = SEARCH3_RESULT_LIMIT;
const ALBUM_RESULT_CAP = SEARCH3_RESULT_LIMIT;
const ARTIST_RESULT_CAP = SEARCH3_RESULT_LIMIT;

/** The server call can't be allowed to hang the search on a slow/unreachable
 *  host — cap it (local results are already the primary answer). */
const SERVER_SEARCH_TIMEOUT_MS = 5000;

/** Fuzzy/phonetic-tolerant relevance for a name (+ optional artist): the best of
 *  the two field scores. Shared by the full-library SQL path below. */
function relevance(query: string, name: string, artist?: string | null): number {
  return Math.max(
    scoreField(query, name).score,
    artist ? scoreField(query, artist).score : 0,
  );
}

/**
 * Local fuzzy search over the ENTIRE synced library (the normalized `songs` +
 * `albums` tables) via candidate SQL + JS re-rank. Distinct from
 * `performOfflineSearch`, which scans only the downloaded set held in memory.
 * Returns the ranked results plus the top relevance score — the routing gate for
 * whether the server is still worth consulting. `shouldAbort` bails a superseded
 * query (the user typed further).
 */
export async function searchFullLibraryScored(
  query: string,
  shouldAbort?: () => boolean,
): Promise<{ results: SearchResults; topScore: number }> {
  const norm = normalize(query);
  if (!norm) return { results: EMPTY_RESULTS, topScore: 0 };
  const db = getDb();
  if (!db) return { results: EMPTY_RESULTS, topScore: 0 };
  const tokens = tokenize(norm);
  // Phonetic tier is gated to tokens ≥4 chars (short tokens over-collide) and
  // to non-empty codes (non-Latin encodes to '' — never a phonetic candidate).
  const dmetaTokens = tokens
    .filter((t) => t.length >= 4)
    .map((t) => metaphoneKey(t))
    .filter((k) => k.length > 0);

  // Tiered candidate generation over the normalized tables (norm_*/dmeta_* columns),
  // then the JS precision re-rank below.
  const [songCands, albumCands, artistCands] = await Promise.all([
    searchSongs(db, norm, tokens, dmetaTokens),
    searchAlbums(db, norm, tokens, dmetaTokens),
    searchArtists(db, norm, tokens, dmetaTokens),
  ]);
  if (shouldAbort?.()) return { results: EMPTY_RESULTS, topScore: 0 };

  const songs = songCands
    .map((r) => ({ r, s: relevance(query, r.title ?? '', r.artist) }))
    .filter((x) => x.s >= REJECT)
    .sort((a, b) => b.s - a.s);
  const albums = albumCands
    .map((r) => ({ r, s: relevance(query, r.name ?? '', r.display_artist) }))
    .filter((x) => x.s >= REJECT)
    .sort((a, b) => b.s - a.s);

  // Artists are held to the CONFIDENT floor, deliberately stricter than songs/albums'
  // REJECT: a wrong artist row misroutes the whole browse, so only a near-certain name
  // match is worth surfacing.
  const artists = artistCands
    .map((r) => ({ r, s: scoreField(query, r.name ?? '').score }))
    .filter((x) => x.s >= CONFIDENT)
    .sort((x, y) => y.s - x.s);

  const topScore = Math.max(songs[0]?.s ?? 0, albums[0]?.s ?? 0, artists[0]?.s ?? 0);
  return {
    results: {
      albums: albums.slice(0, ALBUM_RESULT_CAP).map((x) => albumListRowToAlbumID3(x.r)),
      artists: artists.slice(0, ARTIST_RESULT_CAP).map((x) => artistListRowToArtistID3(x.r)),
      songs: songs.slice(0, SONG_RESULT_CAP).map((x) => songListRowToChild(x.r)),
    },
    topScore,
  };
}

/** `performOnlineSearch` (search3) wrapped with a timeout + error swallow so a
 *  slow or unreachable server can't hang the search — null on either. */
async function guardedServerSearch(
  query: string,
  shouldAbort?: () => boolean,
): Promise<SearchResults | null> {
  if (shouldAbort?.()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      performOnlineSearch(query),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SERVER_SEARCH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Merge server results into local — local first (it ranked by real relevance),
 *  the server contributing only ids not already present. Per-type dedup by id. */
function mergeResults(local: SearchResults, server: SearchResults): SearchResults {
  const merge = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const seen = new Set(a.map((x) => x.id));
    return [...a, ...b.filter((x) => !seen.has(x.id))];
  };
  return {
    albums: merge(local.albums, server.albums),
    artists: merge(local.artists, server.artists),
    songs: merge(local.songs, server.songs),
  };
}

export interface SearchLibraryOptions {
  /** Bail early when the query has been superseded (the user typed further). */
  shouldAbort?: () => boolean;
  /**
   * Called with the LOCAL results the instant they're ready, BEFORE any server
   * augmentation. Lets an interactive caller (the search box) render locally
   * without waiting on the network. Only fires on the partial-sync path — the
   * fully-synced / offline / unreachable paths return local directly with
   * nothing further to wait for.
   */
  onLocalResults?: (results: SearchResults) => void;
}

/**
 * Data-state-aware search router shared by the in-app box AND voice. Keys off
 * the hard `offlineMode` toggle, the `isFullySynced` flags, and reachability:
 *   - offlineMode ON → downloaded-only local scan, never the server.
 *   - online, no local corpus → straight to the server (empty if unreachable).
 *   - online, fully synced (or unreachable) → local is authoritative and
 *     COMPLETE; return it immediately — NEVER block an interactive search on the
 *     network (a weak/typo/partial hit is still just local; the server can't
 *     hold anything a fully-synced library doesn't).
 *   - online, partially synced + reachable → surface local FIRST (via
 *     `onLocalResults`), then augment with a timeout-guarded server search for
 *     the entries not yet synced, MERGED into the returned value.
 */
export async function searchLibrary(
  query: string,
  options?: SearchLibraryOptions,
): Promise<SearchResults> {
  const { shouldAbort, onLocalResults } = options ?? {};
  if (!normalize(query)) return EMPTY_RESULTS;

  if (offlineModeStore.getState().offlineMode) {
    return performOfflineSearch(query, shouldAbort);
  }

  const { librarySyncComplete, songSyncComplete, alwaysUseServerSearch } = syncStatusStore.getState();
  const fullySynced = librarySyncComplete && songSyncComplete;
  const { hasConnection, isServerReachable } = connectivityStore.getState();
  const reachable = hasConnection && isServerReachable;

  const db = getDb();
  if (!db || !(await hasLocalCorpus(db))) {
    return reachable ? performOnlineSearch(query) : EMPTY_RESULTS;
  }

  const { results: local } = await searchFullLibraryScored(query, shouldAbort);
  if (shouldAbort?.()) return EMPTY_RESULTS;

  // Local is the complete answer — return instantly, no network wait (unless the
  // user explicitly opted in to always querying the server).
  if ((fullySynced && !alwaysUseServerSearch) || !reachable) return local;

  // Partial sync (or alwaysUseServerSearch) + reachable → show local now, then augment with the server.
  onLocalResults?.(local);
  const server = await guardedServerSearch(query, shouldAbort);
  if (!server || shouldAbort?.()) return local;
  return mergeResults(local, server);
}

/**
 * Best local album match for a voice "play album" intent. Fuzzy-matches the
 * album name over the normalized `albums` table, weighting the (optional) artist via
 * `scoreCandidate` so "Ten by Pearl Jam" picks Pearl Jam's Ten, not some other
 * "Ten". Local-only (the album table is on-device, so it works offline too);
 * null when nothing clears the reject floor. The caller fetches + plays the
 * album's tracks in order.
 */
export async function findAlbum(name: string, artist?: string): Promise<AlbumID3 | null> {
  const norm = normalize(name);
  if (!norm) return null;
  const tokens = tokenize(norm);
  const dmetaTokens = tokens
    .filter((t) => t.length >= 4)
    .map((t) => metaphoneKey(t))
    .filter((k) => k.length > 0);
  const db = getDb();
  if (!db) return null;
  const candidates = await searchAlbums(db, norm, tokens, dmetaTokens);
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((r) => ({
      r,
      score: scoreCandidate(
        { song: name, artist },
        { title: r.name ?? '', artist: r.display_artist ?? undefined },
      ),
    }))
    .filter((x) => x.score >= REJECT)
    .sort((x, y) => y.score - x.score);
  return scored[0] ? albumListRowToAlbumID3(scored[0].r) : null;
}

/**
 * Songs strongly attributed to an artist for a voice "play artist" intent. Runs
 * the shared offline/online-aware `searchLibrary` on the artist name, then keeps
 * only hits whose ARTIST field confidently matches (drops same-named-title
 * noise). Bounded by the search cap — the top tracks, plenty to seed a queue.
 */
export async function findArtistSongs(name: string): Promise<Child[]> {
  if (!normalize(name)) return [];
  const { songs } = await searchLibrary(name);
  return songs.filter((s) => scoreField(name, s.artist ?? '').score >= CONFIDENT);
}

/**
 * Every downloaded song, optionally filtered by genre.
 *
 * Iterates `cachedItems` (downloaded items including the `__starred__`
 * aggregate) → `songIds` → `getSongEnvelope()`. Dedup by song id so a track
 * that lives under multiple cached items appears once.
 *
 * `album` is overridden with the containing item's name, so a playlist-downloaded
 * song shows the playlist rather than its own album — the display these callers
 * have always had.
 */
function collectOfflineSongs(genreFilter?: string): Child[] {
  const g = genreFilter?.toLowerCase();
  const { cachedItems } = musicCacheStore.getState();

  const out: Child[] = [];
  const seen = new Set<string>();

  for (const item of Object.values(cachedItems)) {
    for (const songId of item.songIds) {
      if (seen.has(songId)) continue;
      const envelope = getSongEnvelope(songId);
      if (!envelope) continue;
      if (g && !getGenreNames(envelope).some((name) => name.toLowerCase() === g)) continue;
      seen.add(songId);
      out.push({ ...envelope, album: item.name });
    }
  }

  return out;
}

export function getOfflineSongsByGenre(genre: string): Child[] {
  return collectOfflineSongs(genre);
}

/**
 * The set of genre names (lowercased) present anywhere in the offline (cached)
 * library. ONE pass over all cached songs, building each `Child` once — callers
 * needing the genre list (the Tuned-In builder) must use this rather than calling
 * `getOfflineSongsByGenre` per candidate genre, which re-walks the whole library
 * each time and blocks the JS thread at mount on a large offline library.
 */
export function getOfflineGenresPresent(): Set<string> {
  const { cachedItems, cachedSongs } = musicCacheStore.getState();
  const present = new Set<string>();
  const seen = new Set<string>();
  for (const item of Object.values(cachedItems)) {
    for (const songId of item.songIds) {
      if (seen.has(songId)) continue;
      seen.add(songId);
      if (!cachedSongs[songId]) continue;
      const envelope = getSongEnvelope(songId);
      if (!envelope) continue;
      for (const name of getGenreNames(envelope)) present.add(name.toLowerCase());
    }
  }
  return present;
}

export function getOfflineSongsAll(): Child[] {
  return collectOfflineSongs();
}
