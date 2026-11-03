/**
 * Per-row SQLite persistence for the v2 music-downloads stack — query
 * helpers only. The shared handle, PRAGMAs, schema, health reporting, and
 * test injection live in `./db.ts`.
 *
 * Owns these tables in `substreamer7.db`:
 *   - `cached_songs`       — canonical song pool (one row per unique song), the
 *                            full Subsonic `Child` in typed columns
 *   - `cached_song_*`      — the `Child` multi-valued fields (genres, artists,
 *                            albumArtists, contributors, moods)
 *   - `cached_items`       — download intents (album/playlist/favorites/song)
 *   - `cached_albums` /
 *     `cached_playlists`   — 1:1 per-type metadata for an item
 *   - `cached_item_songs`  — many-to-many edges (refcount-via-COUNT)
 *   - `download_queue`     — persisted download queue
 *   - `download_queue_songs`
 *     + `download_queue_song_*`
 *                          — a queued item's `Child[]` payload, positional, with the
 *                            same five multi-valued mirrors
 *
 * Error-swallowing: every read returns a safe default ({}, [], 0) and every
 * write is a silent no-op on failure. Consumers never need to handle
 * exceptions from this module.
 */
import type { AlbumID3, Child, Playlist } from 'subsonic-api';

import {
  childFromSnapshotRow,
  childGenreNames,
  childSnapshotArrayCommands,
  childSnapshotArrayKey,
  childSnapshotFields,
  childSnapshotInsertCommand,
  childSnapshotRowFromRaw,
  readChildSnapshotArraysAsync,
  CHILD_SNAPSHOT_SELECT,
  type ChildSnapshotArrays,
} from '@/db/childSnapshot';
import { getSortArticles } from '@/db/sortArticles';
import { albumSortKeys, playlistSortTitle, songSortKeys } from '@/db/sortKeys';

import { getDb, type BatchCommand, type InternalDb } from './db';

/** The `album_id` directory of a downloaded song the server gave no album. */
export const UNKNOWN_ALBUM_ID = '_unknown';

// The `Child` ⇄ columns mapping is shared with the other snapshot tables; re-exported
// so the download-side consumers keep one import.
export { childGenreNames };

export interface CachedSongRow {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  /** The file's DIRECTORY (`_unknown` when the server gave none) — NOT `Child.albumId`. */
  albumId: string;
  coverArt?: string;
  bytes: number;
  duration: number;
  /** The file's EXTENSION, post-transcode — NOT `Child.suffix`. */
  suffix: string;
  /** The EFFECTIVE downloaded format — NOT `Child.bitRate`. */
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
  formatCapturedAt: number;
  downloadedAt: number;

  /* --- the server's track (`Child`), promoted from the envelope --- */
  /** `Child.albumId` — the SERVER's album, unlike `albumId` above. */
  srcAlbumId?: string;
  srcSuffix?: string;
  srcBitRate?: number;
  srcBitDepth?: number;
  srcSamplingRate?: number;
  artistId?: string;
  displayArtist?: string;
  displayAlbumArtist?: string;
  displayComposer?: string;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  size?: number;
  contentType?: string;
  transcodedContentType?: string;
  transcodedSuffix?: string;
  channelCount?: number;
  path?: string;
  userRating?: number;
  averageRating?: number;
  playCount?: number;
  /** Epoch ms. */
  created?: number;
  /** Epoch ms. */
  starred?: number;
  played?: string;
  type?: string;
  bpm?: number;
  comment?: string;
  sortName?: string;
  musicBrainzId?: string;
  explicitStatus?: string;
  bookmarkPosition?: number;
  isVideo?: boolean;
  isDir?: boolean;
  parent?: string;
  originalWidth?: number;
  originalHeight?: number;
  rgTrackGain?: number;
  rgAlbumGain?: number;
  rgTrackPeak?: number;
  rgAlbumPeak?: number;
  rgBaseGain?: number;
  rgFallbackGain?: number;
  /**
   * Projection of `cached_song_genres`, joined by the async hydrate. The other
   * four child tables are stored and queryable but deliberately NOT hydrated —
   * they have no consumer and this path gates CarPlay browse/playback/voice.
   */
  genres?: string[];
}

/** `cached_albums` — the `AlbumID3` scalars an `album` download carries. */
export interface CachedAlbumMeta {
  artistId?: string;
  name?: string;
  artist?: string;
  displayArtist?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  playCount?: number;
  /** Epoch ms. */
  created?: number;
  /** Epoch ms. */
  starred?: number;
  year?: number;
  genre?: string;
  played?: string;
  userRating?: number;
  version?: string;
  musicBrainzId?: string;
  sortName?: string;
  isCompilation?: boolean;
  explicitStatus?: string;
  originalReleaseYear?: number;
  originalReleaseMonth?: number;
  originalReleaseDay?: number;
  releaseYear?: number;
  releaseMonth?: number;
  releaseDay?: number;
}

/** `cached_playlists` — the `Playlist` scalars a `playlist` download carries. */
export interface CachedPlaylistMeta {
  name?: string;
  comment?: string;
  coverArt?: string;
  /** Epoch ms. */
  created?: number;
  /** Epoch ms. */
  changed?: number;
  duration?: number;
  owner?: string;
  public?: boolean;
  songCount?: number;
}

export interface CachedItemRow {
  itemId: string;
  type: 'album' | 'playlist' | 'favorites' | 'song';
  name: string;
  artist?: string;
  coverArtId?: string;
  expectedSongCount: number;
  parentAlbumId?: string;
  lastSyncAt: number;
  downloadedAt: number;
  /** Joined from cached_item_songs on hydrate, in position order. */
  songIds: string[];
  /**
   * Per-type metadata from the component tables: `cached_albums` for an `album`
   * item, `cached_playlists` for a `playlist` one. `favorites` / `song` intents
   * have none, which is why these are component tables rather than 40-odd
   * permanently-NULL columns on `cached_items`.
   */
  albumMeta?: CachedAlbumMeta;
  playlistMeta?: CachedPlaylistMeta;
  /**
   * `true` for an auto-created partial `album:<id>` grouping row (built by
   * `ensurePartialAlbumEdge` so playlist/favorites/song-downloaded tracks are
   * browsable by album). Such rows are NOT "real" download holders: a song's
   * file lives only as long as a REAL holder (album-full / playlist / favorites
   * / `song:<id>`) references it. Stamped by which function creates the row,
   * never inferred from counts. Defaults to `false`.
   */
  derived?: boolean;
}

export interface DownloadQueueRow {
  queueId: string;
  itemId: string;
  type: 'album' | 'playlist' | 'favorites' | 'song';
  name: string;
  artist?: string;
  coverArtId?: string;
  status: 'queued' | 'downloading' | 'complete' | 'error';
  totalSongs: number;
  completedSongs: number;
  error?: string;
  addedAt: number;
  queuePosition: number;
}

/**
 * A queue row as Migration 14 replays it: the v1 blob is still the payload, because
 * Migration 20 rewrites `songs_json` afterwards to repair the lean entries v1 wrote.
 * Everything since goes through {@link insertDownloadQueueItem} and stores rows.
 */
export interface LegacyDownloadQueueRow extends DownloadQueueRow {
  /** JSON-serialized `Child[]`. */
  songsJson: string;
}

/* ------------------------------------------------------------------ */
/*  Promoted metadata columns                                          */
/* ------------------------------------------------------------------ */

/**
 * One promoted column: its SQLite name, the matching key on the row/meta
 * object, and whether SQLite stores it as INTEGER-as-boolean. A single list per
 * table drives the SELECT projection, the row mapper, the UPSERT and the
 * conversion UPDATE, so those four cannot drift apart.
 */
interface ColumnDef<T> {
  col: string;
  key: keyof T & string;
  bool?: true;
}

/**
 * `Child` fields promoted onto `cached_songs`. Excludes the 15 columns that
 * already existed: `title`/`artist`/`album`/`cover_art`/`duration` mean the same
 * on both sides, and `album_id`/`suffix`/`bit_rate`/`bit_depth`/`sampling_rate`
 * describe the FILE — hence the `src_*` pairs here. Search/sort derivations
 * (`sort_*`/`norm_*`/`dmeta_*`) are library artefacts and are not mirrored.
 */
const PROMOTED_SONG_COLUMNS: ReadonlyArray<ColumnDef<CachedSongRow>> = [
  { col: 'src_album_id', key: 'srcAlbumId' },
  { col: 'src_suffix', key: 'srcSuffix' },
  { col: 'src_bit_rate', key: 'srcBitRate' },
  { col: 'src_bit_depth', key: 'srcBitDepth' },
  { col: 'src_sampling_rate', key: 'srcSamplingRate' },
  { col: 'artist_id', key: 'artistId' },
  { col: 'display_artist', key: 'displayArtist' },
  { col: 'display_album_artist', key: 'displayAlbumArtist' },
  { col: 'display_composer', key: 'displayComposer' },
  { col: 'track', key: 'track' },
  { col: 'disc_number', key: 'discNumber' },
  { col: 'year', key: 'year' },
  { col: 'genre', key: 'genre' },
  { col: 'size', key: 'size' },
  { col: 'content_type', key: 'contentType' },
  { col: 'transcoded_content_type', key: 'transcodedContentType' },
  { col: 'transcoded_suffix', key: 'transcodedSuffix' },
  { col: 'channel_count', key: 'channelCount' },
  { col: 'path', key: 'path' },
  { col: 'user_rating', key: 'userRating' },
  { col: 'average_rating', key: 'averageRating' },
  { col: 'play_count', key: 'playCount' },
  { col: 'created', key: 'created' },
  { col: 'starred', key: 'starred' },
  { col: 'played', key: 'played' },
  { col: 'type', key: 'type' },
  { col: 'bpm', key: 'bpm' },
  { col: 'comment', key: 'comment' },
  { col: 'sort_name', key: 'sortName' },
  { col: 'music_brainz_id', key: 'musicBrainzId' },
  { col: 'explicit_status', key: 'explicitStatus' },
  { col: 'bookmark_position', key: 'bookmarkPosition' },
  { col: 'is_video', key: 'isVideo', bool: true },
  { col: 'is_dir', key: 'isDir', bool: true },
  { col: 'parent', key: 'parent' },
  { col: 'original_width', key: 'originalWidth' },
  { col: 'original_height', key: 'originalHeight' },
  { col: 'rg_track_gain', key: 'rgTrackGain' },
  { col: 'rg_album_gain', key: 'rgAlbumGain' },
  { col: 'rg_track_peak', key: 'rgTrackPeak' },
  { col: 'rg_album_peak', key: 'rgAlbumPeak' },
  { col: 'rg_base_gain', key: 'rgBaseGain' },
  { col: 'rg_fallback_gain', key: 'rgFallbackGain' },
];

const ALBUM_META_COLUMNS: ReadonlyArray<ColumnDef<CachedAlbumMeta>> = [
  { col: 'artist_id', key: 'artistId' },
  { col: 'name', key: 'name' },
  { col: 'artist', key: 'artist' },
  { col: 'display_artist', key: 'displayArtist' },
  { col: 'cover_art', key: 'coverArt' },
  { col: 'song_count', key: 'songCount' },
  { col: 'duration', key: 'duration' },
  { col: 'play_count', key: 'playCount' },
  { col: 'created', key: 'created' },
  { col: 'starred', key: 'starred' },
  { col: 'year', key: 'year' },
  { col: 'genre', key: 'genre' },
  { col: 'played', key: 'played' },
  { col: 'user_rating', key: 'userRating' },
  { col: 'version', key: 'version' },
  { col: 'music_brainz_id', key: 'musicBrainzId' },
  { col: 'sort_name', key: 'sortName' },
  { col: 'is_compilation', key: 'isCompilation', bool: true },
  { col: 'explicit_status', key: 'explicitStatus' },
  { col: 'original_release_year', key: 'originalReleaseYear' },
  { col: 'original_release_month', key: 'originalReleaseMonth' },
  { col: 'original_release_day', key: 'originalReleaseDay' },
  { col: 'release_year', key: 'releaseYear' },
  { col: 'release_month', key: 'releaseMonth' },
  { col: 'release_day', key: 'releaseDay' },
];

const PLAYLIST_META_COLUMNS: ReadonlyArray<ColumnDef<CachedPlaylistMeta>> = [
  { col: 'name', key: 'name' },
  { col: 'comment', key: 'comment' },
  { col: 'cover_art', key: 'coverArt' },
  { col: 'created', key: 'created' },
  { col: 'changed', key: 'changed' },
  { col: 'duration', key: 'duration' },
  { col: 'owner', key: 'owner' },
  { col: 'public', key: 'public', bool: true },
  { col: 'song_count', key: 'songCount' },
];

/** The five `Child` multi-valued mirrors, deepest-first for truncation. */
const CACHED_SONG_CHILD_TABLES = [
  'cached_song_genres',
  'cached_song_artists',
  'cached_song_album_artists',
  'cached_song_contributors',
  'cached_song_moods',
] as const;

/** The same five for a QUEUED song's `Child`, deepest-first for truncation. */
const DOWNLOAD_QUEUE_SONG_CHILD_TABLES = [
  'download_queue_song_genres',
  'download_queue_song_artists',
  'download_queue_song_album_artists',
  'download_queue_song_contributors',
  'download_queue_song_moods',
] as const;

const columnNames = <T>(defs: ReadonlyArray<ColumnDef<T>>): string =>
  defs.map((d) => d.col).join(', ');

const aliasedColumns = <T>(
  defs: ReadonlyArray<ColumnDef<T>>,
  table: string,
  prefix: string,
): string => defs.map((d) => `${table}.${d.col} AS ${prefix}${d.col}`).join(', ');

const placeholders = (n: number): string => new Array(n).fill('?').join(', ');

const excludedAssignments = <T>(defs: ReadonlyArray<ColumnDef<T>>): string =>
  defs.map((d) => `${d.col} = excluded.${d.col}`).join(', ');

const coalesceAssignments = <T>(defs: ReadonlyArray<ColumnDef<T>>): string =>
  defs.map((d) => `${d.col} = COALESCE(excluded.${d.col}, ${d.col})`).join(', ');

const setAssignments = <T>(defs: ReadonlyArray<ColumnDef<T>>): string =>
  defs.map((d) => `${d.col} = ?`).join(', ');

/** Bind values in column order; absent/null → NULL, booleans → 0/1. */
function columnParams<T>(
  defs: ReadonlyArray<ColumnDef<T>>,
  obj: Partial<T>,
): Array<string | number | null> {
  return defs.map((d) => {
    const v = (obj as Record<string, unknown>)[d.key];
    if (v === undefined || v === null) return null;
    if (d.bool) return v ? 1 : 0;
    return v as string | number;
  });
}

/** Inverse of {@link columnParams}: read a raw row (optionally alias-prefixed)
 *  into the typed object, leaving NULL columns absent. */
function readColumns<T>(
  defs: ReadonlyArray<ColumnDef<T>>,
  raw: Record<string, unknown>,
  prefix = '',
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = raw[prefix + d.col];
    if (v === undefined || v === null) continue;
    out[d.key] = d.bool ? v === 1 || v === true : v;
  }
  return out as Partial<T>;
}

/** Dates arrive as live `Date` from the API and as ISO strings out of a parsed
 *  envelope; both store as epoch ms. */
function toEpoch(v: Date | string | number | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * The promoted `cached_songs` fields for a real `Child` — spread into a
 * `CachedSongRow` literal by the download paths, and used by the conversion.
 *
 * The five renamed here are the collision this table alone has: their natural names
 * belong to its file-on-disk columns, which `resolveSongFile` reads. Renaming at the
 * boundary is what keeps a server value off them — the shared mapping carries them
 * under the `Child` names, as every other snapshot table wants them.
 */
export function promotedSongFieldsFromChild(child: Child): Partial<CachedSongRow> {
  const { albumId, suffix, bitRate, bitDepth, samplingRate, ...rest } = childSnapshotFields(child);
  return {
    srcAlbumId: albumId,
    srcSuffix: suffix,
    srcBitRate: bitRate,
    srcBitDepth: bitDepth,
    srcSamplingRate: samplingRate,
    ...rest,
    genres: childGenreNames(child),
  };
}

/** `cached_albums` row content for a server `AlbumID3`. */
export function albumMetaFromAlbumID3(album: AlbumID3): CachedAlbumMeta {
  return {
    artistId: album.artistId,
    name: album.name,
    artist: album.artist,
    displayArtist: album.displayArtist,
    coverArt: album.coverArt,
    songCount: album.songCount,
    duration: album.duration,
    playCount: album.playCount,
    created: toEpoch(album.created),
    starred: toEpoch(album.starred),
    year: album.year,
    genre: album.genre,
    played: album.played,
    userRating: album.userRating,
    version: album.version,
    musicBrainzId: album.musicBrainzId,
    sortName: album.sortName,
    isCompilation: album.isCompilation,
    explicitStatus: album.explicitStatus,
    originalReleaseYear: album.originalReleaseDate?.year,
    originalReleaseMonth: album.originalReleaseDate?.month,
    originalReleaseDay: album.originalReleaseDate?.day,
    releaseYear: album.releaseDate?.year,
    releaseMonth: album.releaseDate?.month,
    releaseDay: album.releaseDate?.day,
  };
}

/** `cached_playlists` row content for a server `Playlist`. */
export function playlistMetaFromPlaylist(playlist: Playlist): CachedPlaylistMeta {
  return {
    name: playlist.name,
    comment: playlist.comment,
    coverArt: playlist.coverArt,
    created: toEpoch(playlist.created),
    changed: toEpoch(playlist.changed),
    duration: playlist.duration,
    owner: playlist.owner,
    public: playlist.public,
    songCount: playlist.songCount,
  };
}

/* ------------------------------------------------------------------ */
/*  Row <-> object mapping helpers                                     */
/* ------------------------------------------------------------------ */

interface RawSongRow {
  song_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  album_id: string;
  cover_art: string | null;
  bytes: number;
  duration: number;
  suffix: string;
  bit_rate: number | null;
  bit_depth: number | null;
  sampling_rate: number | null;
  format_captured_at: number;
  downloaded_at: number;
  /** `json_group_array` projection of `cached_song_genres`; `'[]'` when none. */
  genres?: string | null;
}

interface RawItemRow {
  item_id: string;
  type: string;
  name: string;
  artist: string | null;
  cover_art_id: string | null;
  expected_song_count: number;
  parent_album_id: string | null;
  last_sync_at: number;
  downloaded_at: number;
  derived: number | null;
  /** Present only on the component-joined hydrate; `ca_`/`cp_` alias prefixes. */
  ca_item_id?: string | null;
  cp_item_id?: string | null;
}

interface RawQueueRow {
  queue_id: string;
  item_id: string;
  type: string;
  name: string;
  artist: string | null;
  cover_art_id: string | null;
  status: string;
  total_songs: number;
  completed_songs: number;
  error: string | null;
  added_at: number;
  queue_position: number;
}

function mapSongRow(row: RawSongRow): CachedSongRow {
  const out: CachedSongRow = {
    id: row.song_id,
    title: row.title,
    albumId: row.album_id,
    bytes: row.bytes,
    duration: row.duration,
    suffix: row.suffix,
    formatCapturedAt: row.format_captured_at,
    downloadedAt: row.downloaded_at,
  };
  if (row.artist !== null) out.artist = row.artist;
  if (row.album !== null) out.album = row.album;
  if (row.cover_art !== null) out.coverArt = row.cover_art;
  if (row.bit_rate !== null) out.bitRate = row.bit_rate;
  if (row.bit_depth !== null) out.bitDepth = row.bit_depth;
  if (row.sampling_rate !== null) out.samplingRate = row.sampling_rate;
  Object.assign(out, readColumns(PROMOTED_SONG_COLUMNS, row as unknown as Record<string, unknown>));
  // `'[]'` is the no-genres case — skip the parse rather than allocate an empty
  // array for every song on the boot path.
  if (row.genres && row.genres !== '[]') {
    try {
      out.genres = JSON.parse(row.genres) as string[];
    } catch {
      /* a corrupt projection just means no genres */
    }
  }
  return out;
}

function mapItemRow(row: RawItemRow, songIds: string[]): CachedItemRow {
  const out: CachedItemRow = {
    itemId: row.item_id,
    type: row.type as CachedItemRow['type'],
    name: row.name,
    expectedSongCount: row.expected_song_count,
    lastSyncAt: row.last_sync_at,
    downloadedAt: row.downloaded_at,
    songIds,
  };
  if (row.artist !== null) out.artist = row.artist;
  if (row.cover_art_id !== null) out.coverArtId = row.cover_art_id;
  if (row.parent_album_id !== null) out.parentAlbumId = row.parent_album_id;
  // Component presence is the joined PK, never a data column — every metadata
  // column is legitimately NULL for a real row.
  const raw = row as unknown as Record<string, unknown>;
  if (row.ca_item_id !== null && row.ca_item_id !== undefined) {
    out.albumMeta = readColumns(ALBUM_META_COLUMNS, raw, 'ca_');
  }
  if (row.cp_item_id !== null && row.cp_item_id !== undefined) {
    out.playlistMeta = readColumns(PLAYLIST_META_COLUMNS, raw, 'cp_');
  }
  // Unconditional (NOT the `!== null` optional pattern): a legacy/NULL row maps
  // to `false`, matching the `COALESCE(derived,0)` orphan-count guard so no real
  // holder is ever mistaken for derived.
  out.derived = row.derived === 1;
  return out;
}

function mapQueueRow(row: RawQueueRow): DownloadQueueRow {
  const out: DownloadQueueRow = {
    queueId: row.queue_id,
    itemId: row.item_id,
    type: row.type as DownloadQueueRow['type'],
    name: row.name,
    status: row.status as DownloadQueueRow['status'],
    totalSongs: row.total_songs,
    completedSongs: row.completed_songs,
    addedAt: row.added_at,
    queuePosition: row.queue_position,
  };
  if (row.artist !== null) out.artist = row.artist;
  if (row.cover_art_id !== null) out.coverArtId = row.cover_art_id;
  if (row.error !== null) out.error = row.error;
  return out;
}

/**
 * Idempotent `ALTER TABLE ... ADD COLUMN` for databases created before a column
 * existed; the base schema in `db.ts` covers fresh installs. Used by Migration 17.
 *
 * Checks `PRAGMA table_info(<table>)` rather than matching the "duplicate column"
 * error string, which is awkward to match across SQLite releases.
 *
 * Returns `true` when the column was added, `false` when it already existed
 * or the operation was skipped (DB unavailable / malformed).
 */
export function addColumnIfMissing(
  table: string,
  column: string,
  sqlType: string,
): boolean {
  const db = getDb();
  if (db === null) return false;
  try {
    const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === column)) return false;
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType};`);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Hydrate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Read all cached song rows into a Record keyed by song_id. Used once at
 * launch to populate the store's in-memory mirror.
 */
export function hydrateCachedSongs(): Record<string, CachedSongRow> {
  const db = getDb();
  if (db === null) return {};
  try {
    const rows = db.getAllSync<RawSongRow>(
      `SELECT song_id, title, artist, album, album_id, cover_art, bytes,
              duration, suffix, bit_rate, bit_depth, sampling_rate,
              format_captured_at, downloaded_at
         FROM cached_songs;`,
    );
    const out: Record<string, CachedSongRow> = {};
    for (const row of rows) {
      if (!row.song_id) continue;
      out[row.song_id] = mapSongRow(row);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read all cached items with their songId arrays joined in position order.
 * Implemented as two queries + merge in JS (simpler than GROUP_CONCAT).
 */
export function hydrateCachedItems(): Record<string, CachedItemRow> {
  const db = getDb();
  if (db === null) return {};
  try {
    const items = db.getAllSync<RawItemRow>(
      `SELECT item_id, type, name, artist, cover_art_id, expected_song_count,
              parent_album_id, last_sync_at, downloaded_at, derived
         FROM cached_items;`,
    );
    const edges = db.getAllSync<{ item_id: string; song_id: string }>(
      'SELECT item_id, song_id FROM cached_item_songs ORDER BY item_id, position ASC;',
    );
    const edgesByItem = new Map<string, string[]>();
    for (const edge of edges) {
      const list = edgesByItem.get(edge.item_id);
      if (list) list.push(edge.song_id);
      else edgesByItem.set(edge.item_id, [edge.song_id]);
    }
    const out: Record<string, CachedItemRow> = {};
    for (const row of items) {
      if (!row.item_id) continue;
      const songIds = edgesByItem.get(row.item_id) ?? [];
      out[row.item_id] = mapItemRow(row, songIds);
    }
    return out;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Async hydrate (boot path — off the JS thread)                      */
/* ------------------------------------------------------------------ */

/** Rows mapped per macrotask yield during async hydration. */
const HYDRATE_MAP_CHUNK = 2000;

const yieldMacrotask = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

async function yieldEvery(i: number): Promise<void> {
  if (i > 0 && i % HYDRATE_MAP_CHUNK === 0) {
    await yieldMacrotask();
  }
}

/**
 * Song projection for the async hydrate: the file columns, every promoted
 * `Child` column, and the genre array. `raw_json` is deliberately NOT selected —
 * nothing reads it at runtime, and a library of pre-cutover downloads would keep
 * every envelope string resident in JS from boot for no consumer.
 *
 * Genres come back as a scalar subquery over an inner `ORDER BY pos`, NOT
 * `GROUP_CONCAT` (real genre names contain commas — "Folk, World, & Country")
 * and not `json_group_array(name ORDER BY pos)` (aggregate ORDER BY needs
 * SQLite >= 3.44).
 */
const SONG_HYDRATE_SELECT = `SELECT song_id, title, artist, album, album_id, cover_art, bytes,
        duration, suffix, bit_rate, bit_depth, sampling_rate,
        format_captured_at, downloaded_at,
        ${columnNames(PROMOTED_SONG_COLUMNS)},
        (SELECT json_group_array(name)
           FROM (SELECT name FROM cached_song_genres
                  WHERE song_id = cached_songs.song_id
                  ORDER BY pos)) AS genres
   FROM cached_songs;`;

/** Item projection for the async hydrate: the item row plus its 1:1 component
 *  row. Every component column is alias-prefixed — `name`, `artist`, `cover_art`,
 *  `created` and `duration` all exist on more than one of the three tables. */
const ITEM_HYDRATE_SELECT = `SELECT i.item_id, i.type, i.name, i.artist, i.cover_art_id,
        i.expected_song_count, i.parent_album_id, i.last_sync_at, i.downloaded_at,
        i.derived,
        a.item_id AS ca_item_id, ${aliasedColumns(ALBUM_META_COLUMNS, 'a', 'ca_')},
        p.item_id AS cp_item_id, ${aliasedColumns(PLAYLIST_META_COLUMNS, 'p', 'cp_')}
   FROM cached_items i
   LEFT JOIN cached_albums a ON a.item_id = i.item_id
   LEFT JOIN cached_playlists p ON p.item_id = i.item_id;`;

/**
 * Async counterpart of {@link hydrateCachedSongs}, widened to the promoted
 * `Child` columns + the genre array so `getSongEnvelope` can stay synchronous.
 * The read runs on the DB's background thread (`getAllAsync`) and the
 * row→object mapping is chunked with `setTimeout(0)` yields, so a large
 * cached-songs table does not freeze the JS thread at boot.
 */
export async function hydrateCachedSongsAsync(): Promise<Record<string, CachedSongRow>> {
  const db = getDb();
  if (db === null) return {};
  try {
    const rows = await db.getAllAsync<RawSongRow>(SONG_HYDRATE_SELECT);
    const out: Record<string, CachedSongRow> = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.song_id) out[row.song_id] = mapSongRow(row);
      await yieldEvery(i);
    }
    return out;
  } catch {
    return {};
  }
}

/** Async counterpart of {@link hydrateCachedItems}, LEFT JOINing the component
 *  tables so the in-memory row carries its per-type metadata — the Downloaded
 *  list helpers are pure in-memory functions over this map. */
export async function hydrateCachedItemsAsync(): Promise<Record<string, CachedItemRow>> {
  const db = getDb();
  if (db === null) return {};
  try {
    const items = await db.getAllAsync<RawItemRow>(ITEM_HYDRATE_SELECT);
    const edges = await db.getAllAsync<{ item_id: string; song_id: string }>(
      'SELECT item_id, song_id FROM cached_item_songs ORDER BY item_id, position ASC;',
    );
    const edgesByItem = new Map<string, string[]>();
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const list = edgesByItem.get(edge.item_id);
      if (list) list.push(edge.song_id);
      else edgesByItem.set(edge.item_id, [edge.song_id]);
      await yieldEvery(i);
    }
    const out: Record<string, CachedItemRow> = {};
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      if (!row.item_id) continue;
      out[row.item_id] = mapItemRow(row, edgesByItem.get(row.item_id) ?? []);
      await yieldEvery(i);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read the full download queue ordered by queue_position ASC, on the background
 * thread. Used at launch and whenever the queue needs a full refresh.
 *
 * The songs are deliberately NOT projected: `fullLibraryDownloadService` enqueues one
 * row per album, so selecting the payload here put the whole catalogue's tracks in JS
 * from boot. They are read per queue item, at download time
 * ({@link readDownloadQueueSongsAsync}).
 */
export async function hydrateDownloadQueueAsync(): Promise<DownloadQueueRow[]> {
  const db = getDb();
  if (db === null) return [];
  try {
    const rows = await db.getAllAsync<RawQueueRow>(
      `SELECT queue_id, item_id, type, name, artist, cover_art_id, status,
              total_songs, completed_songs, error, added_at, queue_position
         FROM download_queue
         ORDER BY queue_position ASC;`,
    );
    return rows.map(mapQueueRow);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Counts                                                             */
/* ------------------------------------------------------------------ */

export function countCachedSongs(): number {
  const db = getDb();
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM cached_songs;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export function countCachedItems(): number {
  const db = getDb();
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM cached_items;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Read a single PRAGMA value from the current connection. Used by the
 * migration diagnostics to verify FK enforcement / journal mode state.
 * Returns `null` on error.
 */
export function readPragma(name: string): string | null {
  const db = getDb();
  if (db === null) return null;
  try {
    const row = db.getFirstSync<Record<string, unknown>>(`PRAGMA ${name};`);
    if (!row) return null;
    // PRAGMA results come back with the pragma name as the key.
    const val = row[name];
    if (val === undefined || val === null) return null;
    return String(val);
  } catch {
    return null;
  }
}

export function countCachedItemSongs(): number {
  const db = getDb();
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM cached_item_songs;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export function countDownloadQueueItems(): number {
  const db = getDb();
  if (db === null) return 0;
  try {
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM download_queue;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Batched, async real-holder refcount for a set of songs in one round-trip.
 * Returns a Map songId → count of edges whose holder is
 * NOT a derived partial-album grouping (`COALESCE(derived,0)=0`). Songs with no real
 * holder are omitted (caller treats a missing key as 0). Chunked to stay under the
 * SQLite bound-variable limit. Fails SAFE: if the `derived` column doesn't exist yet
 * (migrations not yet run) the JOIN throws and we fall back to the raw all-edges count
 * rather than mass-orphaning.
 */
export async function countRealSongRefsForSongsAsync(
  songIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const db = getDb();
  if (db === null || songIds.length === 0) return counts;
  const CHUNK = 500;
  for (let i = 0; i < songIds.length; i += CHUNK) {
    const chunk = songIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    try {
      // eslint-disable-next-line no-await-in-loop
      const rows = await db.getAllAsync<{ song_id: string; c: number }>(
        `SELECT e.song_id AS song_id, COUNT(*) AS c FROM cached_item_songs e
           JOIN cached_items i ON e.item_id = i.item_id
          WHERE e.song_id IN (${placeholders}) AND COALESCE(i.derived, 0) = 0
          GROUP BY e.song_id;`,
        chunk,
      );
      for (const r of rows) counts.set(r.song_id, r.c);
    } catch {
      // eslint-disable-next-line no-await-in-loop
      const rows = await db.getAllAsync<{ song_id: string; c: number }>(
        `SELECT song_id, COUNT(*) AS c FROM cached_item_songs
          WHERE song_id IN (${placeholders})
          GROUP BY song_id;`,
        chunk,
      );
      for (const r of rows) counts.set(r.song_id, r.c);
    }
  }
  return counts;
}

/**
 * The ONE way this file moves rows inside a unique position space —
 * `cached_item_songs.position` and `download_queue.queue_position` both.
 *
 * SQLite applies an UPDATE row by row in rowid order and re-checks the unique
 * index (`PRIMARY KEY (item_id, position)` / `idx_download_queue_position_unique`)
 * after every row, so a plain `position = position ± 1` over a contiguous run
 * collides mid-statement as soon as rowid order runs opposite to the direction of
 * travel — and a completed shift is exactly what leaves rowid order reversed for
 * the next one. Writing each row's new position NEGATED cannot collide from either
 * direction: every target is negative while every untouched source is still
 * positive. `restore` then flips the whole block back.
 *
 * `newPosition` is SQL for the row's new position and the builder negates it, so
 * its binds come first. `restore` keys off `<column> < 0`, which only `shift`
 * can have written, so it is safe anywhere after it in the batch — callers that
 * need a statement in between (`orphanSongCommands` deletes there) just place it
 * later. Narrow it with `restoreWhere` when other rows in the table may hold
 * negatives (a per-item space); leave it off for a table-wide one.
 */
function positionShiftCommands(spec: {
  table: string;
  column: string;
  newPosition: string;
  where: string;
  params: ReadonlyArray<string | number | null>;
  restoreWhere?: string;
  restoreParams?: ReadonlyArray<string | number | null>;
}): { shift: BatchCommand; restore: BatchCommand } {
  const restoreScope = spec.restoreWhere === undefined ? '' : ` AND ${spec.restoreWhere}`;
  return {
    shift: [
      `UPDATE ${spec.table} SET ${spec.column} = -(${spec.newPosition}) WHERE ${spec.where};`,
      spec.params,
    ],
    restore: [
      `UPDATE ${spec.table} SET ${spec.column} = -${spec.column} WHERE ${spec.column} < 0${restoreScope};`,
      spec.restoreParams ?? [],
    ],
  };
}

/**
 * The guard every destructive statement of the orphan batch carries: true only
 * while NO real (non-derived) holder still has an edge to this song. It is
 * uncorrelated with the row being written and none of the statements can change
 * it — they only ever remove derived holders and this song's own edges — so the
 * batch's outcome does not depend on evaluation order, and a real holder that
 * appears between the pre-read and the batch turns the WHOLE batch into a no-op
 * rather than costing the user a downloaded song.
 */
const NO_REAL_HOLDER_SQL = `NOT EXISTS (SELECT 1 FROM cached_item_songs e2
             JOIN cached_items i2 ON i2.item_id = e2.item_id
            WHERE e2.song_id = ? AND COALESCE(i2.derived, 0) = 0)`;

/**
 * The orphan itself, as five self-guarded statements. Every decision is in the
 * SQL: nothing here reads a value and then branches on it in JS, which is what
 * makes the whole thing safe to ship as one indivisible batch.
 *
 * Statement order 2 → 3 → 4 is load-bearing. Statements 2 and 4 are the two
 * halves of one `positionShiftCommands` repack (see its docblock for why the
 * detour through negative space is mandatory), and the delete must sit BETWEEN
 * them: running the halves back to back would flip a survivor's tail back onto
 * the slot the doomed edge still occupies.
 */
const orphanSongCommands = (songId: string): BatchCommand[] => {
  // Every edge ABOVE this song's slot, in its owning item. Unscoped by item —
  // one call repacks every holder at once — so the restore half stays unscoped
  // too. `cached_item_songs` unaliased inside the subquery is the UPDATE target.
  const tailShift = positionShiftCommands({
    table: 'cached_item_songs',
    column: 'position',
    newPosition: 'position - 1',
    where: `EXISTS (SELECT 1 FROM cached_item_songs d
                      WHERE d.item_id = cached_item_songs.item_id AND d.song_id = ?
                        AND d.position < cached_item_songs.position)
            AND ${NO_REAL_HOLDER_SQL}`,
    params: [songId, songId],
  });
  return [
    // 1. Prune derived holders whose ONLY song is this one — FK cascade takes
    //    their edges (and their component rows) with them.
    [
      `DELETE FROM cached_items
       WHERE COALESCE(derived, 0) = 1
         AND EXISTS (SELECT 1 FROM cached_item_songs e
                      WHERE e.item_id = cached_items.item_id AND e.song_id = ?)
         AND NOT EXISTS (SELECT 1 FROM cached_item_songs x
                          WHERE x.item_id = cached_items.item_id AND x.song_id <> ?)
         AND ${NO_REAL_HOLDER_SQL};`,
      [songId, songId, songId],
    ],
    // 2. Survivors above the doomed slot go negative, already decremented.
    tailShift.shift,
    // 3. Drop the edges. By song_id, not by (item_id, position) — there is no edge
    //    list read in JS, so there is nothing that can go stale.
    [`DELETE FROM cached_item_songs WHERE song_id = ? AND ${NO_REAL_HOLDER_SQL};`, [songId, songId]],
    // 4. Bring the shifted tails back up.
    tailShift.restore,
    // 5. The song row, iff no edge anywhere still points at it.
    [
      `DELETE FROM cached_songs WHERE song_id = ?
       AND NOT EXISTS (SELECT 1 FROM cached_item_songs WHERE cached_item_songs.song_id = ?);`,
      [songId, songId],
    ],
  ];
};

/**
 * "Orphan this song iff no REAL holder remains" — one advisory pre-read, ONE
 * atomic batch that makes no decision in JS, then post-reads for what actually
 * happened. Ships as `runAtomicBatchAsync` (one indivisible pool task) rather
 * than a transaction held across a JS yield.
 *
 * `orphaned` is derived from a POST-read, so a rolled-back batch reports false
 * and the store keeps a song the DB still holds, instead of dropping it.
 *
 * `affectedItems` comes from the pre-read and is advisory: it can over-include
 * (the store's filter is then a harmless no-op) or, if `ensurePartialAlbumEdge`
 * adds a derived edge inside the ~ms window, under-include — one phantom songId
 * in memory until the next hydrate.
 */
export async function orphanSongIfUnreferencedAsync(
  songId: string,
): Promise<{ orphaned: boolean; affectedItems: string[]; prunedItems: string[] }> {
  const db = getDb();
  const affectedItems: string[] = [];
  const prunedItems: string[] = [];
  if (db === null) return { orphaned: false, affectedItems, prunedItems };
  let orphaned = false;
  try {
    // Advisory pre-read. A real holder here means the batch would no-op anyway,
    // so skip it; a real holder appearing after this point is caught by the
    // batch's own guard. Both directions fail safe — the song survives.
    const holders = await db.getAllAsync<{ item_id: string; derived: number }>(
      `SELECT e.item_id AS item_id, COALESCE(i.derived, 0) AS derived
         FROM cached_item_songs e
         JOIN cached_items i ON i.item_id = e.item_id
        WHERE e.song_id = ?;`,
      [songId],
    );
    if (holders.some((h) => h.derived === 0)) return { orphaned: false, affectedItems, prunedItems };
    affectedItems.push(...new Set(holders.map((h) => h.item_id)));

    await db.runAtomicBatchAsync(orphanSongCommands(songId));

    const remaining = await db.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM cached_songs WHERE song_id = ?;',
      [songId],
    );
    orphaned = (remaining?.c ?? 1) === 0;
    if (affectedItems.length > 0) {
      const survivors = await db.getAllAsync<{ item_id: string }>(
        'SELECT item_id FROM cached_items WHERE item_id IN (SELECT value FROM json_each(?));',
        [JSON.stringify(affectedItems)],
      );
      const alive = new Set(survivors.map((s) => s.item_id));
      prunedItems.push(...affectedItems.filter((i) => !alive.has(i)));
    }
  } catch {
    /* dropped — `orphaned` stays false, so the store keeps the song */
  }
  return { orphaned, affectedItems, prunedItems };
}

/* ------------------------------------------------------------------ */
/*  cached_songs writes                                                */
/* ------------------------------------------------------------------ */

// Every write is expressed as a `*Commands` builder returning batch tuples, so a
// caller that owns one row and a caller that composes several (`markDownloadComplete`,
// `bulkReplace`) ship the same SQL through one `runAtomicBatchAsync`. No helper
// re-enters a public function: composing at the command level keeps each write to
// ONE batch, which is what makes it atomic.

/** Rebuild the five `cached_song_*` mirrors from a real `Child`. */
const cachedSongChildCommands = (songId: string, child: Child): BatchCommand[] =>
  childSnapshotArrayCommands({
    tablePrefix: 'cached_song',
    key: { song_id: songId },
    child,
  });

const CACHED_SONG_UPSERT_SQL = `INSERT INTO cached_songs
   (song_id, title, artist, album, album_id, cover_art, bytes, duration,
    suffix, bit_rate, bit_depth, sampling_rate, format_captured_at,
    downloaded_at, sort_title, sort_artist,
    ${columnNames(PROMOTED_SONG_COLUMNS)})
   VALUES (${placeholders(16 + PROMOTED_SONG_COLUMNS.length)})
   ON CONFLICT(song_id) DO UPDATE SET
     title = excluded.title,
     artist = excluded.artist,
     album = excluded.album,
     album_id = excluded.album_id,
     cover_art = excluded.cover_art,
     bytes = excluded.bytes,
     duration = excluded.duration,
     suffix = excluded.suffix,
     bit_rate = excluded.bit_rate,
     bit_depth = excluded.bit_depth,
     sampling_rate = excluded.sampling_rate,
     format_captured_at = excluded.format_captured_at,
     downloaded_at = excluded.downloaded_at,
     sort_title = excluded.sort_title,
     sort_artist = excluded.sort_artist,
     ${coalesceAssignments(PROMOTED_SONG_COLUMNS)};`;

/**
 * @param child the real server `Child` behind this write, when there is one.
 *   The five `cached_song_*` mirrors are rebuilt ONLY from that — a row rebuilt
 *   from memory carries the `genres` projection alone, so discriminating on row
 *   contents would silently empty the other four.
 */
function cachedSongCommands(song: CachedSongRow, child?: Child): BatchCommand[] {
  // UPSERT rather than `INSERT OR REPLACE` — see `cachedItemCommands`
  // for the rationale. Applies the same pattern here for consistency so
  // nobody can accidentally reintroduce the cascade-delete footgun.
  //
  // The 14 file columns are written unconditionally (`redownloadTrack`
  // legitimately clears bit_depth/sampling_rate). The promoted metadata columns
  // are `COALESCE(excluded.x, x)`, because the write-back paths rebuild a row
  // from memory and would otherwise null every one of them.
  //
  // `raw_json` and `meta_v` are absent from the statement entirely, so a write
  // leaves both exactly as they are on disk — the legacy envelope survives for
  // `convertLegacyMetadataAsync` and Migrations 18/20 without being read into
  // memory, and a new download writes its metadata straight into the columns.
  //
  // The A–Z keys are DERIVED here from the same row that supplies `title`/`artist`,
  // through the same `db/sortKeys` derivation the `songs` table uses, and written
  // unconditionally alongside them — nothing in JS reads them back, only the
  // Downloaded filter's `ORDER BY` does.
  const keys = songSortKeys(song, getSortArticles());
  const commands: BatchCommand[] = [
    [
      CACHED_SONG_UPSERT_SQL,
      [
        song.id,
        song.title,
        song.artist ?? null,
        song.album ?? null,
        song.albumId,
        song.coverArt ?? null,
        song.bytes,
        song.duration,
        song.suffix,
        song.bitRate ?? null,
        song.bitDepth ?? null,
        song.samplingRate ?? null,
        song.formatCapturedAt,
        song.downloadedAt,
        keys.sort_title,
        keys.sort_artist,
        ...columnParams(PROMOTED_SONG_COLUMNS, song),
      ],
    ],
  ];
  if (child) commands.push(...cachedSongChildCommands(song.id, child));
  return commands;
}

export async function upsertCachedSong(song: CachedSongRow, child?: Child): Promise<void> {
  const db = getDb();
  if (db === null) return;
  if (!song.id || !song.albumId) return;
  try {
    // Row + child tables are one unit — one atomic batch.
    await db.runAtomicBatchAsync(cachedSongCommands(song, child));
  } catch {
    /* dropped */
  }
}

/** A file size read from disk, with the `bytes`/`suffix` it was compared against. */
export interface CachedSongBytesUpdate {
  songId: string;
  bytes: number;
  prevBytes: number;
  suffix: string;
}

/**
 * Write file sizes read from disk. Compare-and-set: a row whose `bytes` or
 * `suffix` changed since the read (a redownload landed) is left alone.
 */
export async function updateCachedSongBytes(updates: CachedSongBytesUpdate[]): Promise<void> {
  const db = getDb();
  if (db === null || updates.length === 0) return;
  try {
    await db.runAtomicBatchAsync(
      updates.map((u): BatchCommand => [
        'UPDATE cached_songs SET bytes = ? WHERE song_id = ? AND bytes = ? AND suffix = ?;',
        [u.bytes, u.songId, u.prevBytes, u.suffix],
      ]),
    );
  } catch {
    /* dropped */
  }
}

export async function deleteCachedSong(songId: string): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAsync('DELETE FROM cached_songs WHERE song_id = ?;', [songId]);
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  cached_items writes                                                */
/* ------------------------------------------------------------------ */

/**
 * The A–Z keys are DERIVED at write time from the metadata already in hand, not carried
 * on the meta object — nothing in JS reads them back, only the Downloaded filter's
 * `ORDER BY` does. They are appended past the `ColumnDef` list for that reason: adding
 * them to `ALBUM_META_COLUMNS` would round-trip a database artefact through
 * `CachedAlbumMeta` and every hydrate.
 */
const CACHED_ALBUM_UPSERT_SQL = `INSERT INTO cached_albums
   (item_id, ${columnNames(ALBUM_META_COLUMNS)}, sort_title, sort_artist)
   VALUES (${placeholders(3 + ALBUM_META_COLUMNS.length)})
   ON CONFLICT(item_id) DO UPDATE SET ${excludedAssignments(ALBUM_META_COLUMNS)},
     sort_title = excluded.sort_title, sort_artist = excluded.sort_artist;`;

const CACHED_PLAYLIST_UPSERT_SQL = `INSERT INTO cached_playlists
   (item_id, ${columnNames(PLAYLIST_META_COLUMNS)}, sort_title)
   VALUES (${placeholders(2 + PLAYLIST_META_COLUMNS.length)})
   ON CONFLICT(item_id) DO UPDATE SET ${excludedAssignments(PLAYLIST_META_COLUMNS)},
     sort_title = excluded.sort_title;`;

// Component rows are written unconditionally from `excluded.*`: the caller only
// reaches here holding a complete server snapshot, and a write without one skips
// the component row entirely (see `cachedItemCommands`).
const cachedAlbumUpsertCommand = (itemId: string, meta: CachedAlbumMeta): BatchCommand => {
  const keys = albumSortKeys(meta, getSortArticles());
  return [
    CACHED_ALBUM_UPSERT_SQL,
    [itemId, ...columnParams(ALBUM_META_COLUMNS, meta), keys.sort_title, keys.sort_artist],
  ];
};

const cachedPlaylistUpsertCommand = (itemId: string, meta: CachedPlaylistMeta): BatchCommand => [
  CACHED_PLAYLIST_UPSERT_SQL,
  [itemId, ...columnParams(PLAYLIST_META_COLUMNS, meta), playlistSortTitle(meta, getSortArticles())],
];

function cachedItemCommands(item: Omit<CachedItemRow, 'songIds'>): BatchCommand[] {
  // UPSERT (not `INSERT OR REPLACE`): SQLite implements `OR REPLACE` as
  // DELETE-then-INSERT, which would fire `ON DELETE CASCADE` on the
  // `cached_item_songs` edges table and silently wipe every edge for this
  // item_id — an offline playlist would evaporate the first time a downstream
  // write touched its parent item. UPSERT updates the row in place with no
  // DELETE, preserving children.
  //
  // `raw_json` / `meta_v` are off the statement — same shape as cached_songs,
  // see that helper.
  const commands: BatchCommand[] = [];
  commands.push([
    `INSERT INTO cached_items
       (item_id, type, name, artist, cover_art_id, expected_song_count,
        parent_album_id, last_sync_at, downloaded_at, derived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         type = excluded.type,
         name = excluded.name,
         artist = excluded.artist,
         cover_art_id = excluded.cover_art_id,
         expected_song_count = excluded.expected_song_count,
         parent_album_id = excluded.parent_album_id,
         last_sync_at = excluded.last_sync_at,
         downloaded_at = excluded.downloaded_at,
         derived = excluded.derived;`,
    [
      item.itemId,
      item.type,
      item.name,
      item.artist ?? null,
      item.coverArtId ?? null,
      item.expectedSongCount,
      item.parentAlbumId ?? null,
      item.lastSyncAt,
      item.downloadedAt,
      item.derived ? 1 : 0,
    ],
  ]);
  // A write with NO metadata must not touch the component row — never blank real
  // metadata with a row full of NULLs. `downloadItem` builds its item literal
  // from `albums`/`playlists`, which a `forceFullResync` empties and repopulates
  // progressively, so a download completing in that window supplies none.
  if (item.albumMeta) commands.push(cachedAlbumUpsertCommand(item.itemId, item.albumMeta));
  if (item.playlistMeta) commands.push(cachedPlaylistUpsertCommand(item.itemId, item.playlistMeta));
  return commands;
}

export async function upsertCachedItem(item: Omit<CachedItemRow, 'songIds'>): Promise<void> {
  const db = getDb();
  if (db === null) return;
  if (!item.itemId) return;
  try {
    // Parent + component in ONE atomic batch: this call is fire-and-forget
    // optimistic, and a lost second statement leaves a Downloaded album with no
    // metadata.
    await db.runAtomicBatchAsync(cachedItemCommands(item));
  } catch {
    /* dropped */
  }
}

/**
 * Delete an item row. FOREIGN KEY ON DELETE CASCADE removes the associated
 * cached_item_songs edges in the same SQLite statement.
 */
export async function deleteCachedItem(itemId: string): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAsync('DELETE FROM cached_items WHERE item_id = ?;', [itemId]);
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  cached_item_songs (edge) writes                                    */
/* ------------------------------------------------------------------ */

/**
 * One edge. Batched despite being a single statement, and that is load-bearing: the row
 * FKs to `cached_items` AND `cached_songs`, both written by batches, and op-sqlite runs
 * batches in submission order while a bare statement overtakes every batch still parked
 * on its transaction lock. Sent bare, the edge lands before its parents and
 * `PRAGMA foreign_keys = ON` rejects it — silently, since the write swallows.
 */
export async function insertCachedItemSong(itemId: string, position: number, songId: string): Promise<void> {
  const db = getDb();
  if (db === null) return;
  if (!itemId || !songId) return;
  try {
    await db.runAtomicBatchAsync([
      [
        'INSERT OR IGNORE INTO cached_item_songs (item_id, position, song_id) VALUES (?, ?, ?);',
        [itemId, position, songId],
      ],
    ]);
  } catch {
    /* dropped */
  }
}

/**
 * Remove an edge at a specific position and shift higher positions down by 1
 * so positions remain contiguous within the item.
 */
export async function removeCachedItemSong(itemId: string, position: number): Promise<void> {
  const db = getDb();
  if (db === null) return;
  const tailShift = positionShiftCommands({
    table: 'cached_item_songs',
    column: 'position',
    newPosition: 'position - 1',
    where: 'item_id = ? AND position > ?',
    params: [itemId, position],
    restoreWhere: 'item_id = ?',
    restoreParams: [itemId],
  });
  try {
    await db.runAtomicBatchAsync([
      ['DELETE FROM cached_item_songs WHERE item_id = ? AND position = ?;', [itemId, position]],
      tailShift.shift,
      tailShift.restore,
    ]);
  } catch {
    /* dropped */
  }
}

/**
 * Reorder one edge within an item from `fromPosition` to `toPosition`.
 *
 * The moving row and the run it displaces are ONE repack: everything in
 * `[from, to]` gets its final position in the same statement, the mover landing
 * on `toPosition` and the rest stepping one slot the other way. No sentinel —
 * the negative space IS the staging area, so there is no second reserved value
 * to keep out of its way.
 */
export async function reorderCachedItemSongs(
  itemId: string,
  fromPosition: number,
  toPosition: number,
): Promise<void> {
  const db = getDb();
  if (db === null) return;
  if (fromPosition === toPosition) return;
  const step = fromPosition < toPosition ? -1 : 1;
  const move = positionShiftCommands({
    table: 'cached_item_songs',
    column: 'position',
    newPosition: 'CASE WHEN position = ? THEN ? ELSE position + ? END',
    where: 'item_id = ? AND position >= ? AND position <= ?',
    params: [
      fromPosition,
      toPosition,
      step,
      itemId,
      Math.min(fromPosition, toPosition),
      Math.max(fromPosition, toPosition),
    ],
    restoreWhere: 'item_id = ?',
    restoreParams: [itemId],
  });
  try {
    await db.runAtomicBatchAsync([move.shift, move.restore]);
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  download_queue writes                                              */
/* ------------------------------------------------------------------ */

/**
 * The statements that make a queue item's songs exactly `songs`. The leading DELETE is
 * what makes a re-write with FEWER tracks correct — `pos` is positional, so without it
 * a shorter payload leaves stale tail rows — and it cascades each removed song's five
 * array rows with it.
 *
 * Entries with no id are dropped: `song_id` is NOT NULL and one would abort the whole
 * batch, and the worker cannot download a song it has no id for.
 */
function downloadQueueSongCommands(
  queueId: string,
  songs: readonly Child[],
): BatchCommand[] {
  const commands: BatchCommand[] = [
    ['DELETE FROM download_queue_songs WHERE queue_id = ?;', [queueId]],
  ];
  songs
    .filter((s) => !!s?.id)
    .forEach((child, pos) => {
      commands.push(
        childSnapshotInsertCommand({
          table: 'download_queue_songs',
          key: { queue_id: queueId, pos },
          child,
        }),
        ...childSnapshotArrayCommands({
          tablePrefix: 'download_queue_song',
          key: { queue_id: queueId, song_pos: pos },
          child,
        }),
      );
    });
  return commands;
}

/**
 * Where one queue row's payload actually lives.
 *
 * The rows are authoritative ONLY when the row has as many of them as `total_songs`
 * says it should. That is the whole safety gate: a row this release has not converted
 * has none, and reading it through the child table would return ZERO songs — which
 * `downloadItem` would take as "nothing left to fetch" and mark complete, silently
 * discarding a download the user is waiting on.
 *
 * Per ROW, not per install: a row enqueued after the upgrade and a row a halted
 * migration chain left behind coexist, and only the row itself knows which it is.
 * `total_songs` is written at insert and never mutated afterwards
 * ({@link updateDownloadQueueItem} touches status/completed/error only), so it is the
 * payload's true length for every writer — including the top-up branch, whose payload
 * is the missing-song DELTA rather than the album.
 */
interface QueuePayloadSource {
  fromRows: boolean;
  /** The legacy blob, for a row whose songs have not been converted. */
  songsJson: string;
}

const PAYLOAD_SOURCE_SQL = `SELECT q.total_songs AS total_songs, q.songs_json AS songs_json,
          (SELECT COUNT(*) FROM download_queue_songs s WHERE s.queue_id = q.queue_id) AS song_rows
     FROM download_queue q
    WHERE q.queue_id = ?;`;

async function queuePayloadSource(
  db: InternalDb,
  queueId: string,
): Promise<QueuePayloadSource | null> {
  const row = await db.getFirstAsync<{
    total_songs: number;
    songs_json: string | null;
    song_rows: number;
  }>(PAYLOAD_SOURCE_SQL, [queueId]);
  if (row === null || row === undefined) return null;
  return {
    fromRows: row.song_rows > 0 && row.song_rows === row.total_songs,
    songsJson: row.songs_json ?? '',
  };
}

/** The legacy blob as `Child[]`; `[]` when it is absent or unparseable. */
export function parseLegacyQueuePayload(songsJson: string): Child[] {
  if (!songsJson) return [];
  try {
    const parsed = JSON.parse(songsJson) as unknown;
    return Array.isArray(parsed) ? (parsed as Child[]) : [];
  } catch {
    return [];
  }
}

const NO_ARRAYS: ChildSnapshotArrays = {};

/**
 * One queue item's payload as real `Child`s, in order — what the download worker
 * needs. Falls back to `songs_json` for a row whose songs are not stored yet
 * (see {@link QueuePayloadSource}).
 */
export async function readDownloadQueueSongsAsync(queueId: string): Promise<Child[]> {
  const db = getDb();
  if (db === null) return [];
  try {
    const source = await queuePayloadSource(db, queueId);
    if (source === null) return [];
    if (!source.fromRows) return parseLegacyQueuePayload(source.songsJson);
    const [rows, arrays] = await Promise.all([
      db.getAllAsync<Record<string, unknown>>(
        `SELECT pos, ${CHILD_SNAPSHOT_SELECT} FROM download_queue_songs ` +
          'WHERE queue_id = ? ORDER BY pos;',
        [queueId],
      ),
      readChildSnapshotArraysAsync(db, {
        tablePrefix: 'download_queue_song',
        keyColumns: ['queue_id', 'song_pos'],
        where: 'queue_id = ?',
        params: [queueId],
      }),
    ]);
    return rows.map((raw) =>
      childFromSnapshotRow(
        childSnapshotRowFromRaw(raw),
        arrays.get(childSnapshotArrayKey([queueId, raw.pos as number])) ?? NO_ARRAYS,
      ),
    );
  } catch {
    return [];
  }
}

/** The distinct album ids a queue item's songs belong to — the directories a `.tmp`
 *  sweep has to visit. One row per album, not one per song, and no `Child` rebuilt.
 *  `null` album ids come back as `null` for the caller to map to its own sentinel. */
export async function readDownloadQueueAlbumIdsAsync(
  queueId: string,
): Promise<Array<string | null>> {
  const db = getDb();
  if (db === null) return [];
  try {
    const source = await queuePayloadSource(db, queueId);
    if (source === null) return [];
    if (!source.fromRows) {
      return [...new Set(parseLegacyQueuePayload(source.songsJson).map((s) => s.albumId ?? null))];
    }
    const rows = await db.getAllAsync<{ album_id: string | null }>(
      'SELECT DISTINCT album_id FROM download_queue_songs WHERE queue_id = ?;',
      [queueId],
    );
    return rows.map((r) => r.album_id);
  } catch {
    return [];
  }
}

/** One queue item's `(song id, album id)` pairs — everything the cancel/cleanup
 *  sweeps need, without rebuilding a `Child`. Two columns, not fifty. */
export async function readDownloadQueueSongRefsAsync(
  queueId: string,
): Promise<Array<{ id: string; albumId?: string }>> {
  const db = getDb();
  if (db === null) return [];
  try {
    const source = await queuePayloadSource(db, queueId);
    if (source === null) return [];
    if (!source.fromRows) {
      return parseLegacyQueuePayload(source.songsJson).map((s) => ({ id: s.id, albumId: s.albumId }));
    }
    const rows = await db.getAllAsync<{ song_id: string; album_id: string | null }>(
      'SELECT song_id, album_id FROM download_queue_songs WHERE queue_id = ? ORDER BY pos;',
      [queueId],
    );
    return rows.map((r) => ({ id: r.song_id, albumId: r.album_id ?? undefined }));
  } catch {
    return [];
  }
}

/** Every queue row with what the payload gate needs to classify it: how many songs the
 *  row says it has, how many are stored, and the blob for the ones that are not. */
export interface DownloadQueuePayloadRow {
  queueId: string;
  totalSongs: number;
  songRows: number;
  songsJson: string;
}

/** The whole queue's payload state, for the one-time conversion. One query. */
export async function readDownloadQueuePayloadRowsAsync(): Promise<DownloadQueuePayloadRow[]> {
  const db = getDb();
  if (db === null) return [];
  try {
    const rows = await db.getAllAsync<{
      queue_id: string;
      total_songs: number;
      songs_json: string | null;
      song_rows: number;
    }>(
      `SELECT q.queue_id AS queue_id, q.total_songs AS total_songs, q.songs_json AS songs_json,
              (SELECT COUNT(*) FROM download_queue_songs s WHERE s.queue_id = q.queue_id) AS song_rows
         FROM download_queue q;`,
    );
    return rows.map((r) => ({
      queueId: r.queue_id,
      totalSongs: r.total_songs,
      songRows: r.song_rows,
      songsJson: r.songs_json ?? '',
    }));
  } catch {
    return [];
  }
}

/**
 * Replace one queue item's stored songs, as ONE atomic batch — a half-written payload
 * is a download that can never complete. Returns false when the write was dropped.
 */
export async function replaceDownloadQueueSongs(
  queueId: string,
  songs: readonly Child[],
): Promise<boolean> {
  const db = getDb();
  if (db === null || !queueId) return false;
  try {
    await db.runAtomicBatchAsync(downloadQueueSongCommands(queueId, songs));
    return true;
  } catch {
    return false;
  }
}

/** Drop one queue item's stored songs, leaving the row itself alone. The conversion
 *  uses it to undo a write that did not verify, so the gate shuts and the blob stays
 *  authoritative. */
export async function deleteDownloadQueueSongs(queueId: string): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAsync('DELETE FROM download_queue_songs WHERE queue_id = ?;', [queueId]);
  } catch {
    /* dropped */
  }
}

/** The stored song ids for a queue item, in `pos` order — UNGATED, so the conversion's
 *  read-back checks the rows themselves rather than whatever the gate would serve. */
export async function readStoredQueueSongIdsAsync(queueId: string): Promise<string[] | null> {
  const db = getDb();
  if (db === null) return null;
  try {
    const rows = await db.getAllAsync<{ song_id: string }>(
      'SELECT song_id FROM download_queue_songs WHERE queue_id = ? ORDER BY pos;',
      [queueId],
    );
    return rows.map((r) => r.song_id);
  } catch {
    return null;
  }
}

/**
 * Is this song in an ACTIVE queue item, and which? One indexed point lookup —
 * `idx_download_queue_songs_song_id` seeks the song, the correlated lookup checks its
 * item's status.
 *
 * SYNCHRONOUS because `useDownloadStatus` asks from inside a zustand selector, which
 * cannot await. Bounded work on one row: the alternative — an in-memory index of every
 * queued song id — is the resident-catalogue cost this table exists to remove.
 * Answers `null` when the DB is unavailable, and for a row Migration 39 has not
 * converted (a missing badge, never a wrong download).
 *
 * `ORDER BY queue_position` because a song can sit in two active items at once (an
 * album and a playlist): the answer is the one nearest the front, as it was when this
 * scanned the in-memory queue in slot order.
 */
const QUEUED_SONG_STATUS_SQL = `SELECT q.status AS status
     FROM download_queue_songs s
     JOIN download_queue q ON q.queue_id = s.queue_id
    WHERE s.song_id = ? AND q.status IN ('queued', 'downloading')
    ORDER BY q.queue_position
    LIMIT 1;`;

export function readQueuedSongStatus(songId: string): 'queued' | 'downloading' | null {
  const db = getDb();
  if (db === null || !songId) return null;
  try {
    const row = db.getFirstSync<{ status: string }>(QUEUED_SONG_STATUS_SQL, [songId]);
    if (row?.status === 'queued' || row?.status === 'downloading') return row.status;
    return null;
  } catch {
    return null;
  }
}

/**
 * Everything a re-write of an existing `queue_id` may change. `queue_position` is
 * deliberately absent: the two writers below disagree about who owns the slot, so each
 * appends its own clause. So is `songs_json`, which the append form supplies as `''` —
 * naming it here would let a re-write blank an unconverted row's only payload.
 */
const DOWNLOAD_QUEUE_CONFLICT_SET = `item_id = excluded.item_id,
         type = excluded.type,
         name = excluded.name,
         artist = excluded.artist,
         cover_art_id = excluded.cover_art_id,
         status = excluded.status,
         total_songs = excluded.total_songs,
         completed_songs = excluded.completed_songs,
         error = excluded.error,
         added_at = excluded.added_at`;

/** Restore form: the caller supplies the slot AND the legacy blob. Only `bulkReplace`
 *  uses it, replaying a Migration 14 snapshot whose positions are already fixed. */
const RESTORE_DOWNLOAD_QUEUE_SQL = `INSERT INTO download_queue
       (queue_id, item_id, type, name, artist, cover_art_id, status,
        total_songs, completed_songs, error, added_at, queue_position,
        songs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(queue_id) DO UPDATE SET
         ${DOWNLOAD_QUEUE_CONFLICT_SET},
         songs_json = excluded.songs_json,
         queue_position = excluded.queue_position;`;

/**
 * Append form: the DATABASE picks the slot, so no JS read of an in-memory mirror can
 * hand out a position that is already taken. A re-write of an existing `queue_id`
 * keeps its current slot — refreshing a queued item's payload must not send it to the
 * back of the line.
 *
 * No `RETURNING`: the row and its songs go in as one atomic batch, which returns
 * nothing, so the assigned slot is read back by id afterwards.
 */
const APPEND_DOWNLOAD_QUEUE_SQL = `INSERT INTO download_queue
       (queue_id, item_id, type, name, artist, cover_art_id, status,
        total_songs, completed_songs, error, added_at, queue_position,
        songs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT COALESCE(MAX(queue_position), 0) + 1 FROM download_queue), ?)
       ON CONFLICT(queue_id) DO UPDATE SET
         ${DOWNLOAD_QUEUE_CONFLICT_SET};`;

/** The 11 binds shared by both forms, in column order, minus `queue_position`. */
const downloadQueueParams = (
  item: Omit<DownloadQueueRow, 'queuePosition'>,
): Array<string | number | null> => [
  item.queueId,
  item.itemId,
  item.type,
  item.name,
  item.artist ?? null,
  item.coverArtId ?? null,
  item.status,
  item.totalSongs,
  item.completedSongs,
  item.error ?? null,
  item.addedAt,
];

function downloadQueueUpsertCommand(item: LegacyDownloadQueueRow): BatchCommand {
  // `INSERT OR REPLACE` is now unsafe here — `download_queue_songs` FK-cascades off
  // this row, so DELETE-then-INSERT would take a queue item's whole payload with it
  // (AGENTS.md §11). UPSERT was already the pattern; it is now load-bearing.
  return [
    RESTORE_DOWNLOAD_QUEUE_SQL,
    [...downloadQueueParams(item), item.queuePosition, item.songsJson],
  ];
}

/**
 * Append a row at the end of the queue with its songs, as ONE atomic batch — a queue
 * item whose payload only half-landed is a download that can never complete.
 *
 * Returns the `queue_position` SQL assigned, or null when the write was dropped — the
 * caller mirrors it into memory so the two cannot drift. `songs_json` is `NOT NULL` and
 * stays on the table, so the write supplies `''`: the payload is in the rows now.
 */
export async function insertDownloadQueueItem(
  item: Omit<DownloadQueueRow, 'queuePosition'>,
  songs: readonly Child[],
): Promise<number | null> {
  const db = getDb();
  if (db === null) return null;
  if (!item.queueId) return null;
  try {
    await db.runAtomicBatchAsync([
      [APPEND_DOWNLOAD_QUEUE_SQL, [...downloadQueueParams(item), '']],
      ...downloadQueueSongCommands(item.queueId, songs),
    ]);
    const row = await db.getFirstAsync<{ queue_position: number }>(
      'SELECT queue_position FROM download_queue WHERE queue_id = ?;',
      [item.queueId],
    );
    return row?.queue_position ?? null;
  } catch {
    /* dropped */
    return null;
  }
}

/**
 * Delete the row and leave the hole. `queue_position` is UNIQUE and monotonic, NOT
 * dense — do not add a "close the gap" shift here.
 *
 * Nothing reads a slot as an ordinal: the queue is ordered by `ORDER BY
 * queue_position`, new rows take `MAX + 1`, and `reorderQueue` moves rows by the
 * slots they actually hold. Renumbering would cost a rewrite of every row above the
 * deleted one on a queue that `fullLibraryDownloadService` fills one row per album —
 * and because the queue drains from the front, that is O(N²) writes across a
 * full-library download, at a library ceiling of ~200k albums.
 */
export async function removeDownloadQueueItem(queueId: string): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAsync('DELETE FROM download_queue WHERE queue_id = ?;', [queueId]);
  } catch {
    /* dropped */
  }
}

/**
 * Partial update of a queue row. Only status / completedSongs / error can be
 * updated via this path; other fields are immutable once the item is queued.
 */
export async function updateDownloadQueueItem(
  queueId: string,
  update: Partial<Pick<DownloadQueueRow, 'status' | 'completedSongs' | 'error'>>,
): Promise<void> {
  const db = getDb();
  if (db === null) return;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (update.status !== undefined) {
    clauses.push('status = ?');
    params.push(update.status);
  }
  if (update.completedSongs !== undefined) {
    clauses.push('completed_songs = ?');
    params.push(update.completedSongs);
  }
  if (update.error !== undefined) {
    clauses.push('error = ?');
    params.push(update.error ?? null);
  }
  if (clauses.length === 0) return;
  params.push(queueId);
  try {
    await db.runAsync(
      `UPDATE download_queue SET ${clauses.join(', ')} WHERE queue_id = ?;`,
      params,
    );
  } catch {
    /* dropped */
  }
}

/**
 * Move a queue row from one position to another.
 *
 * The moving row and the run it displaces are ONE repack: everything in
 * `[from, to]` gets its final position in the same statement, the mover landing on
 * `toPosition` and the rest stepping one slot the other way. No sentinel — the
 * negative space IS the staging area, so there is no reserved value to keep out of
 * the way, and no `± 1` shift that a unique index can reject mid-statement (see
 * `positionShiftCommands`). `download_queue` is ONE position space, so the restore
 * half is unscoped.
 */
export async function reorderDownloadQueue(fromPosition: number, toPosition: number): Promise<void> {
  const db = getDb();
  if (db === null) return;
  if (fromPosition === toPosition) return;
  const step = fromPosition < toPosition ? -1 : 1;
  const move = positionShiftCommands({
    table: 'download_queue',
    column: 'queue_position',
    newPosition: 'CASE WHEN queue_position = ? THEN ? ELSE queue_position + ? END',
    where: 'queue_position >= ? AND queue_position <= ?',
    params: [
      fromPosition,
      toPosition,
      step,
      Math.min(fromPosition, toPosition),
      Math.max(fromPosition, toPosition),
    ],
  });
  try {
    await db.runAtomicBatchAsync([move.shift, move.restore]);
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  Complex transactional ops                                          */
/* ------------------------------------------------------------------ */

/**
 * Append an edge at the end of an item's list, with the position computed by the
 * statement itself rather than by a JS counter. Sequential statements in one batch
 * see each other's inserts, so N of these append 1..N; and because an ignored
 * duplicate (UNIQUE (item_id, song_id)) leaves MAX(position) untouched, the next
 * one reuses the slot instead of leaving a hole.
 */
const APPEND_CACHED_ITEM_SONG_SQL = `INSERT OR IGNORE INTO cached_item_songs (item_id, position, song_id)
   VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM cached_item_songs WHERE item_id = ?), ?);`;

/**
 * Atomically finalise a download: delete the queue row, upsert the item, upsert
 * all songs, and append every edge — ONE `runAtomicBatchAsync`, so consumers
 * never observe a half-committed state and nothing can interleave mid-write.
 *
 * The queue DELETE cascades `download_queue_songs` and its five array tables, so the
 * payload goes with the item it belonged to. A row left in `error` status is NOT
 * deleted (the user may still retry it), and keeps its songs for the same reason.
 *
 * The vacated `queue_position` stays vacant, deliberately — see
 * `removeDownloadQueueItem`. This is the path that makes renumbering untenable:
 * the queue drains from the front, so a shift here would rewrite every remaining
 * row once per completed album.
 *
 * Statement order is load-bearing: `cached_items` and `cached_songs` are the FK
 * parents of `cached_item_songs`, so both must land before any edge.
 *
 * `songs` is a MIX of `Child`-derived rows and rows rebuilt from memory, and
 * nothing on the row distinguishes them — so `childBySongId` is the explicit
 * channel for the real `Child`s, and only ids present in it get their
 * `cached_song_*` mirrors rewritten.
 */
export async function markDownloadComplete(
  queueId: string,
  item: Omit<CachedItemRow, 'songIds'>,
  songs: CachedSongRow[],
  edges: Array<{ songId: string; position: number }>,
  childBySongId?: Map<string, Child>,
): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    const commands: BatchCommand[] = [
      ['DELETE FROM download_queue WHERE queue_id = ?;', [queueId]],
      ...cachedItemCommands(item),
    ];
    for (const song of songs) {
      if (!song.id || !song.albumId) continue;
      commands.push(...cachedSongCommands(song, childBySongId?.get(song.id)));
    }
    // Edges append after whatever the item already holds, so a top-up merging
    // into an existing row doesn't collide with its 1..K edges (the caller's
    // positions are 1-based within the queue item's payload, not the cached
    // row). Sorting fixes the statement order, which fixes the resulting order.
    const sortedEdges = [...edges].sort((a, b) => a.position - b.position);
    for (const edge of sortedEdges) {
      if (!edge.songId) continue;
      commands.push([APPEND_CACHED_ITEM_SONG_SQL, [item.itemId, item.itemId, edge.songId]]);
    }
    await db.runAtomicBatchAsync(commands);
  } catch {
    /* dropped */
  }
}

/**
 * Wipe the download tables and replace their contents in ONE atomic batch.
 * Used by the v1→v2 download migration after parsing the v1 blob.
 */
export async function bulkReplace(params: {
  items: Array<Omit<CachedItemRow, 'songIds'>>;
  songs: CachedSongRow[];
  edges: Array<{ itemId: string; position: number; songId: string }>;
  queue: LegacyDownloadQueueRow[];
}): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    const commands = truncateMusicCacheCommands();
    for (const song of params.songs) {
      if (!song.id || !song.albumId) continue;
      commands.push(...cachedSongCommands(song));
    }
    for (const item of params.items) {
      if (!item.itemId) continue;
      commands.push(...cachedItemCommands(item));
    }
    for (const edge of params.edges) {
      if (!edge.itemId || !edge.songId) continue;
      commands.push([
        'INSERT OR IGNORE INTO cached_item_songs (item_id, position, song_id) VALUES (?, ?, ?);',
        [edge.itemId, edge.position, edge.songId],
      ]);
    }
    for (const q of params.queue) {
      if (!q.queueId) continue;
      commands.push(downloadQueueUpsertCommand(q));
    }
    await db.runAtomicBatchAsync(commands);
  } catch {
    /* dropped */
  }
}

/** Empty every download table, children + component rows before their parents so the
 *  truncation works regardless of PRAGMA state rather than relying on ON DELETE CASCADE. */
const truncateMusicCacheCommands = (): BatchCommand[] =>
  [
    ...CACHED_SONG_CHILD_TABLES,
    ...DOWNLOAD_QUEUE_SONG_CHILD_TABLES,
    'download_queue_songs',
    'cached_albums',
    'cached_playlists',
    'cached_item_songs',
    'download_queue',
    'cached_items',
    'cached_songs',
  ].map((table): BatchCommand => [`DELETE FROM ${table};`, []]);

/**
 * Truncate the download tables. Used by `resetAllStores` on logout / server switch.
 */
export async function clearAllMusicCacheRows(): Promise<void> {
  const db = getDb();
  if (db === null) return;
  try {
    await db.runAtomicBatchAsync(truncateMusicCacheCommands());
  } catch {
    /* dropped */
  }
}

/* ------------------------------------------------------------------ */
/*  One-time legacy-metadata conversion                                */
/* ------------------------------------------------------------------ */

/** Value stamped into `meta_v` once a row's metadata lives in columns. */
const META_V = 1;

/** Rows converted per transaction, with a macrotask yield between chunks. */
const CONVERT_CHUNK = 200;

/** The A–Z keys are rewritten here too: this statement lands `sort_name`, which
 *  `songSortKeys` reads, so a conversion that left them alone would leave a row filed
 *  under the letter it had before its sort name arrived. */
const CONVERT_SONG_UPDATE_SQL =
  `UPDATE cached_songs SET ${setAssignments(PROMOTED_SONG_COLUMNS)}, ` +
  'sort_title = ?, sort_artist = ?, meta_v = ? WHERE song_id = ?;';

/** The two tables the conversion promotes, in the order it walks them. */
const CONVERTED_TABLES = ['cached_songs', 'cached_items'] as const;

/** Rows the conversion has not promoted. Zero on BOTH tables is the only proof
 *  the typed columns carry everything the envelopes did — a count that cannot be
 *  read at all reports -1 so it can never pass for empty. */
async function unconvertedRows(db: InternalDb, table: string): Promise<number> {
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${table} WHERE meta_v IS NULL AND raw_json IS NOT NULL;`,
  );
  return row?.c ?? -1;
}

let conversionInFlight: Promise<boolean> | null = null;

async function runLegacyMetadataConversion(): Promise<boolean> {
  const db = getDb();
  if (db === null) return false;
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await db.getAllAsync<{ song_id: string; raw_json: string }>(
        `SELECT song_id, raw_json FROM cached_songs
          WHERE meta_v IS NULL AND raw_json IS NOT NULL LIMIT ${CONVERT_CHUNK};`,
      );
      if (rows.length === 0) break;
      const commands: BatchCommand[] = [];
      for (const row of rows) {
        let child: Child | null = null;
        try {
          child = JSON.parse(row.raw_json) as Child;
        } catch {
          /* corrupt envelope — stamped below and read from columns instead */
        }
        // EVERY row in the chunk is stamped, parseable or not: one left in
        // the work set would spin this LIMIT loop forever on the boot path.
        if (child) {
          const keys = songSortKeys(child, getSortArticles());
          commands.push([
            CONVERT_SONG_UPDATE_SQL,
            [
              ...columnParams(PROMOTED_SONG_COLUMNS, promotedSongFieldsFromChild(child)),
              keys.sort_title,
              keys.sort_artist,
              META_V,
              row.song_id,
            ],
          ]);
          commands.push(...cachedSongChildCommands(row.song_id, child));
        } else {
          commands.push([
            'UPDATE cached_songs SET meta_v = ? WHERE song_id = ?;',
            [META_V, row.song_id],
          ]);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await db.runAtomicBatchAsync(commands);
      // eslint-disable-next-line no-await-in-loop
      await yieldMacrotask();
    }

    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await db.getAllAsync<{ item_id: string; type: string; raw_json: string }>(
        `SELECT item_id, type, raw_json FROM cached_items
          WHERE meta_v IS NULL AND raw_json IS NOT NULL LIMIT ${CONVERT_CHUNK};`,
      );
      if (rows.length === 0) break;
      const commands: BatchCommand[] = [];
      for (const row of rows) {
        let envelope: unknown = null;
        try {
          envelope = JSON.parse(row.raw_json);
        } catch {
          /* corrupt envelope — stamped below, leaving no component row */
        }
        if (envelope && row.type === 'album') {
          commands.push(
            cachedAlbumUpsertCommand(row.item_id, albumMetaFromAlbumID3(envelope as AlbumID3)),
          );
        } else if (envelope && row.type === 'playlist') {
          commands.push(
            cachedPlaylistUpsertCommand(row.item_id, playlistMetaFromPlaylist(envelope as Playlist)),
          );
        }
        commands.push([
          'UPDATE cached_items SET meta_v = ? WHERE item_id = ?;',
          [META_V, row.item_id],
        ]);
      }
      // eslint-disable-next-line no-await-in-loop
      await db.runAtomicBatchAsync(commands);
      // eslint-disable-next-line no-await-in-loop
      await yieldMacrotask();
    }
  } catch {
    // The work set is unchanged — every batch is atomic, so a row is either
    // fully promoted or untouched. Report NOT complete and let the caller retry.
    return false;
  }

  for (const table of CONVERTED_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    if ((await unconvertedRows(db, table)) !== 0) return false;
  }
  return true;
}

/**
 * Promote the legacy `raw_json` envelopes of pre-cutover downloads into typed
 * columns / component rows / child tables, stamping `meta_v` in the same UPDATE.
 *
 * Work set is `meta_v IS NULL AND raw_json IS NOT NULL`, so it shrinks
 * monotonically, needs no cursor, and resumes after an interruption. `raw_json`
 * is LEFT INTACT: Migrations 18/19 backfill `WHERE raw_json IS NULL` and would
 * otherwise overwrite a converted row from an older blob, and a rollback to the
 * previous release still renders every download. Rows with a NULL envelope are
 * outside the set by design — there is no library fallback.
 *
 * Resolves TRUE only when the work set is provably empty on BOTH tables. Nothing
 * reads an envelope at runtime any more, so `hydrateFromDbAsync` AWAITS this
 * before it publishes: a row published ahead of its own conversion would serve
 * empty columns. A false verdict leaves every envelope intact for the next run.
 */
/** Resolves once any running conversion has finished. The Navidrome re-key waits on it. */
export function legacyMetadataConversionInFlight(): Promise<unknown> {
  return conversionInFlight ?? Promise.resolve();
}

export function convertLegacyMetadataAsync(): Promise<boolean> {
  if (conversionInFlight) return conversionInFlight;
  const run = runLegacyMetadataConversion().finally(() => {
    conversionInFlight = null;
  });
  conversionInFlight = run;
  return run;
}
