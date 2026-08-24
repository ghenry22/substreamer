import { getDb } from '../../store/persistence/db';
import {
  KEPT_TABLES,
  MODEL_TABLES,
  ddlTableNames,
  ensureNormalizedSchema,
  normalizedTableNames,
} from '../createNormalizedTables';

const NORMALIZED_TABLES = [
  'songs',
  'albums',
  'artists',
  'playlists',
  'song_genres',
  'song_artists',
  'song_album_artists',
  'song_contributors',
  'song_moods',
  'album_genres',
  'album_artists',
  'album_release_types',
  'album_moods',
  'album_record_labels',
  'album_disc_titles',
  'artist_roles',
  'album_info',
  'artist_info',
  'artist_bio',
  'artist_similar',
  'artist_top_songs',
  'artist_top_songs_state',
  'playlist_songs',
  'playlist_allowed_users',
  'favorite_songs',
  'favorite_albums',
  'favorite_artists',
];

describe('ensureNormalizedSchema', () => {
  it('creates every normalized table and is idempotent', () => {
    const db = getDb();
    expect(db).not.toBeNull();
    ensureNormalizedSchema(db!);
    ensureNormalizedSchema(db!); // second run must be a no-op, not a throw

    const tables = db!
      .getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .map((r) => r.name);
    for (const t of NORMALIZED_TABLES) {
      expect(tables).toContain(t);
    }
  });

  it('creates the keyset + favorites indexes on songs', () => {
    const db = getDb();
    ensureNormalizedSchema(db!);
    const indexes = db!
      .getAllSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='songs'",
      )
      .map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_songs_sort', 'idx_songs_album', 'idx_songs_starred_key']),
    );
  });

  it('adds new queue columns to an existing database without losing rows', () => {
    const db = getDb();
    expect(db).not.toBeNull();
    ensureNormalizedSchema(db!);
    db!.runSync("DELETE FROM queue_snapshots WHERE id = 'schema-upgrade';");
    db!.execSync('ALTER TABLE queue_snapshot_songs DROP COLUMN origin;');
    db!.runSync(
      `INSERT INTO queue_snapshots
         (id, kind, created_at, current_index, track_count)
       VALUES ('schema-upgrade', 'live', 1, 0, 1);`,
    );
    db!.runSync(
      `INSERT INTO queue_snapshot_songs (snapshot_id, pos, song_id, title)
       VALUES ('schema-upgrade', 0, 'song-1', 'Existing song');`,
    );

    ensureNormalizedSchema(db!);

    const columns = db!
      .getAllSync<{ name: string }>('PRAGMA table_info("queue_snapshot_songs")')
      .map((column) => column.name);
    const row = db!.getFirstSync<{ title: string; origin: string | null }>(
      "SELECT title, origin FROM queue_snapshot_songs WHERE snapshot_id = 'schema-upgrade';",
    );
    expect(columns).toContain('origin');
    expect(row).toEqual({ title: 'Existing song', origin: null });
    db!.runSync("DELETE FROM queue_snapshots WHERE id = 'schema-upgrade';");
  });

  it('drops the favourites remainder tables on logout (they are server-scoped)', () => {
    const droppable = new Set(normalizedTableNames());
    for (const t of [
      'favorite_songs', 'favorite_song_genres', 'favorite_song_artists',
      'favorite_song_album_artists', 'favorite_song_contributors', 'favorite_song_moods',
      'favorite_albums', 'favorite_album_genres', 'favorite_album_artists',
      'favorite_album_release_types', 'favorite_album_moods', 'favorite_album_record_labels',
      'favorite_album_disc_titles', 'favorite_artists', 'favorite_artist_roles',
    ]) {
      expect(droppable.has(t)).toBe(true);
    }
  });

  it('round-trips a row through a created table (schema is usable)', () => {
    const db = getDb();
    ensureNormalizedSchema(db!);
    db!.runSync(
      "INSERT OR REPLACE INTO songs (id, title, sort_title, is_video) VALUES ('s1', 'Alpha', 'alpha', 0)",
    );
    const row = db!.getFirstSync<{ id: string; title: string }>(
      "SELECT id, title FROM songs WHERE id = 's1'",
    );
    expect(row?.title).toBe('Alpha');
  });

  it('cascade-deletes children with their parent', () => {
    const db = getDb();
    ensureNormalizedSchema(db!);
    db!.runSync("INSERT OR REPLACE INTO albums (id, name) VALUES ('a1', 'Album One')");
    db!.runSync("INSERT OR REPLACE INTO album_genres (album_id, pos, name) VALUES ('a1', 0, 'Rock')");
    db!.runSync("DELETE FROM albums WHERE id = 'a1'");
    const childCount = db!.getFirstSync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM album_genres WHERE album_id = 'a1'",
    );
    expect(childCount?.n).toBe(0);
  });
});

describe('drop scope', () => {
  it('classifies every table in the DDL as either model or kept', () => {
    // Both lists are hard-coded on purpose. A derived MODEL = DDL - KEPT would make this
    // assertion vacuous AND fail open: a new unclassified table would join the drop list.
    const classified = new Set([...MODEL_TABLES, ...KEPT_TABLES]);
    const unclassified = ddlTableNames().filter((n) => !classified.has(n));
    expect(unclassified).toEqual([]);
  });

  it('has no stale entries — every MODEL_TABLE still exists in the DDL', () => {
    // Catches a rename: the old name lingers here (and in every shipped DB) while the
    // DDL moves on, so it would never be dropped again and would leak across accounts.
    const inDdl = new Set(ddlTableNames());
    expect(MODEL_TABLES.filter((n) => !inDdl.has(n))).toEqual([]);
  });

  it('never exposes a kept table as droppable', () => {
    const droppable = new Set(normalizedTableNames());
    for (const kept of KEPT_TABLES) expect(droppable.has(kept)).toBe(false);
  });

  it('reports the library model as droppable', () => {
    expect(normalizedTableNames()).toEqual(expect.arrayContaining(['albums', 'songs']));
  });
});
