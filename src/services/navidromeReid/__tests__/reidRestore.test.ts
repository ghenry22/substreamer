import type { Child } from 'subsonic-api';

import {
  convertRestoredBookmarks,
  convertRestoredExclusions,
  convertRestoredMbidOverrides,
  convertRestoredScrobbles,
} from '../reidRestore';

// Vectors from canonicalId.test.ts: a legacy 32-hex id and its current form.
const OLD = 'e3b7fc2ae9447bbec37a13bf916e3cf6';
const NEW = '6VHl3uR4kss6sUPKA8Cwnk';
const OLD_ALBUM = 'zzzzzzzzzzzzzzzzzzzzzz';
const NEW_ALBUM = '3LyqmwQBm5IRqlVjNYASwb';
// A dashed UUID, which canonicalId WOULD transform: protected fields must keep it.
const MBID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const song = (): Child => ({
  id: OLD,
  title: 'Song',
  isDir: false,
  albumId: OLD_ALBUM,
  parent: OLD_ALBUM,
  musicBrainzId: MBID,
  path: `Artist/${OLD}.mp3`,
} as Child);

describe('convertRestoredScrobbles', () => {
  it('converts the song ids and nothing else', () => {
    const [out] = convertRestoredScrobbles([{ id: OLD, song: song(), time: 1 }]);

    expect(out.id).toBe(OLD);
    expect(out.song.id).toBe(NEW);
    expect(out.song.albumId).toBe(NEW_ALBUM);
    expect(out.song.parent).toBe(NEW_ALBUM);
    expect(out.song.musicBrainzId).toBe(MBID);
    expect(out.song.path).toBe(`Artist/${OLD}.mp3`);
  });

  it('is idempotent', () => {
    const once = convertRestoredScrobbles([{ id: 'x', song: song(), time: 1 }]);
    expect(convertRestoredScrobbles(once)).toEqual(once);
  });
});

describe('convertRestoredBookmarks', () => {
  it('converts the queued songs, never the bookmark UUID', () => {
    const out = convertRestoredBookmarks({
      [MBID]: { id: MBID, name: 'B', createdAt: 0, queue: [song()], currentIndex: 0, positionSec: 0 },
    });

    expect(Object.keys(out)).toEqual([MBID]);
    expect(out[MBID].id).toBe(MBID);
    expect(out[MBID].queue[0].id).toBe(NEW);
  });
});

describe('convertRestoredMbidOverrides', () => {
  it('converts the entity id and its key, never the MBID', () => {
    const out = convertRestoredMbidOverrides({
      [`artist:${OLD}`]: { type: 'artist', entityId: OLD, entityName: 'A', mbid: MBID },
    });

    expect(out).toEqual({
      [`artist:${NEW}`]: { type: 'artist', entityId: NEW, entityName: 'A', mbid: MBID },
    });
  });

  it('passes a malformed entry through for the store to drop', () => {
    const bad = { mbid: MBID } as never;
    expect(convertRestoredMbidOverrides({ junk: bad })).toEqual({ junk: bad });
  });
});

describe('convertRestoredExclusions', () => {
  it('converts the keys and ids in all three maps', () => {
    const out = convertRestoredExclusions({
      excludedAlbums: { [OLD_ALBUM]: { id: OLD_ALBUM, name: 'Al' } },
      excludedArtists: { [OLD]: { id: OLD, name: 'Ar' } },
      excludedPlaylists: { [MBID]: { id: MBID, name: 'P' } },
    });

    expect(out.excludedAlbums).toEqual({ [NEW_ALBUM]: { id: NEW_ALBUM, name: 'Al' } });
    expect(out.excludedArtists).toEqual({ [NEW]: { id: NEW, name: 'Ar' } });
    // A playlist UUID is an entity id Navidrome re-encodes too.
    expect(Object.keys(out.excludedPlaylists)).toEqual(['7rke2SAWaicSeSYzkhww6R']);
  });
});
