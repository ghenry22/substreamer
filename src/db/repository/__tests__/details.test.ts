/**
 * Normalized detail reads (`getAlbumDetail`/`getArtistDetail`/`getPlaylistDetail`) —
 * the relationship queries that replace the legacy detail blob stores. Run against the
 * real better-sqlite3-backed DB (real SQL, real joins).
 */
import type { AlbumID3, ArtistID3, ArtistInfo2, Child, Playlist } from 'subsonic-api';

import { getDb } from '../../../store/persistence/db';
import { ensureNormalizedSchema } from '../../createNormalizedTables';
import { upsertAlbums } from '../albums';
import { setArtistTopSongs, upsertArtistBio, upsertArtistInfo, upsertArtists } from '../artists';
import { setPlaylistSongs, upsertPlaylists } from '../playlists';
import { upsertSongs } from '../songs';
import {
  getAlbumDetail,
  getArtistBase,
  getArtistBioRow,
  getArtistInfoRow,
  getArtistTopSongsRow,
  getPlaylistDetail,
} from '../details';

const db = () => getDb()!;

const album = (id: string, name: string, extra: Partial<AlbumID3> = {}): AlbumID3 => ({
  id, name, created: new Date('2020-01-01'), duration: 100, songCount: 2, ...extra,
});
const song = (id: string, title: string, extra: Partial<Child> = {}): Child => ({
  id, title, isDir: false, ...extra,
});
const artist = (id: string, name: string, extra: Partial<ArtistID3> = {}): ArtistID3 => ({
  id, name, albumCount: 0, ...extra,
});
const playlist = (id: string, name: string, extra: Partial<Playlist> = {}): Playlist => ({
  id, name, created: new Date('2020-01-01'), changed: new Date('2020-01-01'), duration: 0, songCount: 0, ...extra,
});

beforeAll(() => ensureNormalizedSchema(db()));
beforeEach(() => {
  for (const t of [
    'albums',
    'songs',
    'artists',
    'playlists',
    'playlist_songs',
    'artist_similar',
    'artist_top_songs',
  ]) {
    db().runSync(`DELETE FROM ${t}`);
  }
});

describe('getAlbumDetail', () => {
  it('returns the album + its songs in disc/track order', async () => {
    await upsertAlbums(db(), [album('al1', 'Abbey Road', { artist: 'The Beatles', artistId: 'ar1', year: 1969 })]);
    await upsertSongs(db(), [
      song('s2', 'Something', { albumId: 'al1', discNumber: 1, track: 2, artist: 'The Beatles' }),
      song('s1', 'Come Together', { albumId: 'al1', discNumber: 1, track: 1, artist: 'The Beatles' }),
      song('sx', 'Other', { albumId: 'alX', track: 1 }),
    ]);

    const detail = await getAlbumDetail(db(), 'al1');
    expect(detail?.album.name).toBe('Abbey Road');
    expect(detail?.album.artistId).toBe('ar1');
    expect(detail?.album.year).toBe(1969);
    expect(detail?.songs.map((s) => s.id)).toEqual(['s1', 's2']); // track order, album-scoped
  });

  it('returns null for an un-synced album', async () => {
    expect(await getAlbumDetail(db(), 'nope')).toBeNull();
  });

  it('carries the array children on both the album and its songs', async () => {
    // Detail and the list reads share one projection + adapter, so the fields a
    // consumer gets cannot depend on which screen it arrived from.
    await upsertAlbums(db(), [
      album('al1', 'Abbey Road', { genres: ['Rock'], recordLabels: [{ name: 'Apple' }] }),
    ]);
    await upsertSongs(db(), [
      song('s1', 'Come Together', {
        albumId: 'al1',
        track: 1,
        genres: ['Rock', 'Blues'],
        contributors: [{ role: 'composer', artist: { id: 'c1', name: 'Lennon', albumCount: 0 } }],
      }),
    ]);
    const detail = await getAlbumDetail(db(), 'al1');
    expect(detail?.album.genres).toEqual(['Rock']);
    expect(detail?.album.recordLabels).toEqual([{ name: 'Apple' }]);
    expect(detail?.songs[0].genres).toEqual(['Rock', 'Blues']);
    expect(detail?.songs[0].contributors?.[0].artist?.name).toBe('Lennon');
  });

  it('preserves displayComposer through the round trip — the Album View offline/cached read path', async () => {
    // album-detail.tsx reads a cache hit straight through getAlbumDetail, so this is the
    // exact shape its TrackRow rows render from when offline or opened from cache.
    await upsertAlbums(db(), [album('al1', 'Classical Sampler', { artist: 'Various Artists' })]);
    await upsertSongs(db(), [
      song('s1', 'Air on the G String', { albumId: 'al1', track: 1, displayComposer: 'J.S. Bach' }),
      song('s2', 'Untitled Study', { albumId: 'al1', track: 2 }),
    ]);
    const detail = await getAlbumDetail(db(), 'al1');
    expect(detail?.songs[0].displayComposer).toBe('J.S. Bach');
    expect(detail?.songs[1].displayComposer).toBeUndefined();
  });
});

describe('artist detail parts', () => {
  it('getArtistBase returns the artist + albums, newest first', async () => {
    await upsertArtists(db(), [artist('ar1', 'The Beatles', { albumCount: 2 })]);
    await upsertAlbums(db(), [
      album('al1', 'Please Please Me', { artistId: 'ar1', year: 1963 }),
      album('al2', 'Abbey Road', { artistId: 'ar1', year: 1969 }),
      album('alX', 'Not Theirs', { artistId: 'ar2', year: 1970 }),
    ]);
    const base = await getArtistBase(db(), 'ar1');
    expect(base?.artist.name).toBe('The Beatles');
    expect(base?.albums.map((a) => a.id)).toEqual(['al2', 'al1']);
  });

  it('getArtistBase is a MISS when the row exists but its albums have not synced', async () => {
    // A row exists for every artist after a list sync; that is not "we have this artist".
    await upsertArtists(db(), [artist('ar2', 'Pending', { albumCount: 5 })]);
    expect(await getArtistBase(db(), 'ar2')).toBeNull();
  });

  it('getArtistBase is a HIT for a genuinely album-less artist', async () => {
    await upsertArtists(db(), [artist('ar3', 'Empty', { albumCount: 0 })]);
    expect(await getArtistBase(db(), 'ar3')).not.toBeNull();
  });

  it('getArtistBase is null for an artist that never synced at all', async () => {
    expect(await getArtistBase(db(), 'nope')).toBeNull();
  });

  it('getArtistInfoRow returns the server envelope + similar artists', async () => {
    await upsertArtists(db(), [artist('ar1', 'The Beatles')]);
    await upsertArtistInfo(
      db(),
      'ar1',
      {
        biography: 'Server bio.',
        lastFmUrl: 'https://last.fm/x',
        musicBrainzId: 'mb-1',
        imageUrlSmall: null,
        imageUrlMedium: null,
        imageUrlLarge: 'https://img/large',
        retrievedAt: 111,
      },
      { similarArtist: [{ id: 'ar9', name: 'The Rolling Stones', albumCount: 1, coverArt: 'ca9' }] } as ArtistInfo2,
    );
    const info = await getArtistInfoRow(db(), 'ar1');
    expect(info?.biography).toBe('Server bio.');
    expect(info?.musicBrainzId).toBe('mb-1');
    expect(info?.largeImageUrl).toBe('https://img/large');
    expect(info?.similarArtist.map((sa) => sa.id)).toEqual(['ar9']);
    expect(await getArtistInfoRow(db(), 'nope')).toBeNull();
  });

  it('getArtistBioRow distinguishes never-attempted from looked-and-found-none', async () => {
    await upsertArtists(db(), [artist('ar1', 'The Beatles')]);
    expect(await getArtistBioRow(db(), 'ar1')).toBeNull(); // never attempted
    await upsertArtistBio(db(), 'ar1', { biography: null, resolvedMbid: 'mb-1', checkedAt: 42 });
    const bio = await getArtistBioRow(db(), 'ar1');
    expect(bio).not.toBeNull();            // attempted...
    expect(bio?.biography).toBeNull();     // ...and this artist has none
    expect(bio?.resolvedMbid).toBe('mb-1');
    expect(bio?.checkedAt).toBe(42);
  });

  it('getArtistBioRow maps an all-empty row to nulls, not undefined', async () => {
    // Every column of `artist_bio` is nullable, and this is the row a MusicBrainz
    // lookup that resolved nothing leaves behind. `checkedAt: null` is what makes the
    // caller retry rather than treat it as a negative cache hit.
    await upsertArtists(db(), [artist('ar1', 'The Beatles')]);
    await upsertArtistBio(db(), 'ar1', { biography: null, resolvedMbid: null, checkedAt: null });
    expect(await getArtistBioRow(db(), 'ar1')).toEqual({
      biography: null,
      resolvedMbid: null,
      checkedAt: null,
    });
  });

  it('getArtistTopSongsRow reports the junction order and the written count', async () => {
    await upsertArtists(db(), [artist('ar1', 'The Beatles')]);
    await upsertSongs(db(), [song('t1', 'Hey Jude'), song('t2', 'Let It Be')]);
    expect(await getArtistTopSongsRow(db(), 'ar1')).toBeNull(); // no state row = never fetched
    await setArtistTopSongs(db(), 'ar1', ['t2', 't1'], { listLength: 20 });
    const top = await getArtistTopSongsRow(db(), 'ar1');
    expect(top?.songs.map((sg) => sg.id)).toEqual(['t2', 't1']); // position order
    expect(top?.listLength).toBe(20);
    expect(top?.songCount).toBe(2);
  });

  it('getArtistTopSongsRow exposes a reaped song as resolved < songCount', async () => {
    // `artist_top_songs.song_id` has no FK, so a song removed by deleteAlbumSongsNotIn
    // drops out of the JOIN while its junction row survives. Only comparing the RESOLVED
    // count against `song_count` catches that.
    await upsertArtists(db(), [artist('ar1', 'The Beatles')]);
    await upsertSongs(db(), [song('t1', 'Hey Jude'), song('t2', 'Let It Be')]);
    await setArtistTopSongs(db(), 'ar1', ['t1', 't2'], { listLength: 20 });
    db().runSync("DELETE FROM songs WHERE id = 't2'");
    const top = await getArtistTopSongsRow(db(), 'ar1');
    expect(top?.songCount).toBe(2);
    expect(top?.songs).toHaveLength(1);
  });

  it('omitting the state argument records NO presence — a failed fetch must not stamp', async () => {
    await upsertArtists(db(), [artist('ar1', 'The Beatles')]);
    await upsertSongs(db(), [song('t1', 'Hey Jude')]);
    await setArtistTopSongs(db(), 'ar1', ['t1']);
    expect(await getArtistTopSongsRow(db(), 'ar1')).toBeNull();
  });
});

describe('getPlaylistDetail', () => {
  it('returns the playlist + its tracks in membership (position) order', async () => {
    await upsertPlaylists(db(), [
      playlist('p1', 'Roadtrip', { owner: 'dave', comment: 'summer', public: true, songCount: 2, duration: 400 }),
    ]);
    await upsertSongs(db(), [
      song('s1', 'First', { artist: 'A' }),
      song('s2', 'Second', { artist: 'B' }),
    ]);
    await setPlaylistSongs(db(), 'p1', ['s2', 's1']); // deliberate non-id order

    const detail = await getPlaylistDetail(db(), 'p1');
    expect(detail?.playlist.name).toBe('Roadtrip');
    expect(detail?.playlist.owner).toBe('dave');
    expect(detail?.playlist.comment).toBe('summer');
    expect(detail?.entry.map((e) => e.id)).toEqual(['s2', 's1']); // position order, not id order
  });

  it('returns null for an un-synced playlist', async () => {
    expect(await getPlaylistDetail(db(), 'nope')).toBeNull();
  });

  it('hydrates a track listed twice without losing its children', async () => {
    // A playlist may hold the same song at two positions; the batched child fetch
    // must serve both rows rather than only the first occurrence.
    await upsertPlaylists(db(), [playlist('p1', 'Repeat')]);
    await upsertSongs(db(), [song('s1', 'Encore', { genres: ['Live'] })]);
    await setPlaylistSongs(db(), 'p1', ['s1', 's1']);
    const detail = await getPlaylistDetail(db(), 'p1');
    expect(detail?.entry.map((e) => e.genres)).toEqual([['Live'], ['Live']]);
  });
});
