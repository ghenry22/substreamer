import {
  parseMediaId,
  sectionId,
  listId,
  albumId,
  playlistId,
  azLetterId,
  azBucketId,
  albumTrackId,
  playlistTrackId,
  playlistShuffleId,
  favTrackId,
  bucketLetter,
  albumLetterRows,
  albumsForLetter,
  albumsForBucket,
  resolveAlbumLetterNode,
  CAR_MAX_ITEMS_PER_NODE,
  type AzItem,
} from '../headlessMediaService.helpers';
import type { BrowseItem } from 'react-native-queue-player';

describe('parseMediaId', () => {
  it('round-trips every id builder', () => {
    expect(parseMediaId(sectionId('albums'))).toEqual({ kind: 'section', section: 'albums' });
    expect(parseMediaId(listId('recentlyAdded'))).toEqual({ kind: 'list', list: 'recentlyAdded' });
    expect(parseMediaId(albumId('al-9'))).toEqual({ kind: 'album', albumId: 'al-9' });
    expect(parseMediaId(playlistId('p-3'))).toEqual({ kind: 'playlist', playlistId: 'p-3' });
    expect(parseMediaId(playlistShuffleId('p-3'))).toEqual({ kind: 'shuffle', playlistId: 'p-3' });
    expect(parseMediaId(azLetterId('S'))).toEqual({ kind: 'azLetter', letter: 'S' });
    expect(parseMediaId(azBucketId('S', 'sa', 'sm'))).toEqual({
      kind: 'azBucket',
      letter: 'S',
      lo: 'sa',
      hi: 'sm',
    });
  });

  it('parses track ids for each context', () => {
    expect(parseMediaId(albumTrackId('al-9', 4))).toEqual({
      kind: 'track',
      ctx: 'album',
      ctxId: 'al-9',
      index: 4,
    });
    expect(parseMediaId(playlistTrackId('p-3', 0))).toEqual({
      kind: 'track',
      ctx: 'playlist',
      ctxId: 'p-3',
      index: 0,
    });
    expect(parseMediaId(favTrackId(2))).toEqual({
      kind: 'track',
      ctx: 'fav',
      ctxId: '',
      index: 2,
    });
  });

  it('tolerates a colon inside an album/playlist id', () => {
    expect(parseMediaId('album:a:b')).toEqual({ kind: 'album', albumId: 'a:b' });
    expect(parseMediaId(albumTrackId('a:b', 7))).toEqual({
      kind: 'track',
      ctx: 'album',
      ctxId: 'a:b',
      index: 7,
    });
  });

  it('returns unknown for malformed ids', () => {
    expect(parseMediaId('nope')).toEqual({ kind: 'unknown', raw: 'nope' });
    expect(parseMediaId('shuffle:').kind).toBe('unknown');
    expect(parseMediaId('track:album:al-9:notanumber').kind).toBe('unknown');
    expect(parseMediaId('az:artists:S').kind).toBe('unknown'); // only albums bucketed
  });
});

describe('bucketLetter', () => {
  it('uppercases the first char; non-alpha → #', () => {
    expect(bucketLetter('abbey road')).toBe('A');
    expect(bucketLetter('Zooropa')).toBe('Z');
    expect(bucketLetter('123 Overture')).toBe('#');
    expect(bucketLetter('  spaced')).toBe('S');
    expect(bucketLetter('')).toBe('#');
  });
});

describe('albumLetterRows', () => {
  it('emits one hasChildren row per non-empty letter, # last', () => {
    const albums: AzItem[] = [
      { id: '1', title: 'Zoo' },
      { id: '2', title: 'Abbey' },
      { id: '3', title: '99 Luftballons' },
      { id: '4', title: 'Apple' },
    ];
    const rows = albumLetterRows(albums);
    expect(rows.map((r) => r.title)).toEqual(['A', 'Z', '#']);
    expect(rows.every((r) => r.hasChildren && !r.playable)).toBe(true);
    expect(rows[0].id).toBe(azLetterId('A'));
  });
});

describe('albumsForLetter', () => {
  it('filters by first letter and title-sorts', () => {
    const albums: AzItem[] = [
      { id: '1', title: 'Apple' },
      { id: '2', title: 'Abbey' },
      { id: '3', title: 'Zoo' },
    ];
    expect(albumsForLetter(albums, 'A').map((a) => a.title)).toEqual(['Abbey', 'Apple']);
  });
});

describe('resolveAlbumLetterNode', () => {
  const toAlbumRow = async (a: AzItem): Promise<BrowseItem> => ({
    id: albumId(a.id),
    title: a.title,
    playable: false,
    hasChildren: true,
  });

  it('returns album rows directly when under the cap', async () => {
    const albums: AzItem[] = [
      { id: '1', title: 'Apple' },
      { id: '2', title: 'Abbey' },
    ];
    const rows = await resolveAlbumLetterNode(albumsForLetter(albums, 'A'), 'A', toAlbumRow);
    expect(rows.map((r) => r.id)).toEqual([albumId('2'), albumId('1')]);
  });

  it('sub-buckets a fat letter so every child stays under the cap', async () => {
    // 600 "S.." albums with varied second chars → over the 500 cap.
    const alpha = 'abcdefghijklmnopqrstuvwxyz';
    const albums: AzItem[] = Array.from({ length: 600 }, (_, i) => ({
      id: `s${i}`,
      title: `S${alpha[i % 26]}${i} Sessions`,
    }));
    const inLetter = albumsForLetter(albums, 'S');
    const rows = await resolveAlbumLetterNode(inLetter, 'S', toAlbumRow);

    // All rows are sub-buckets (not album leaves), each drillable.
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.id.startsWith('az:albums:S:') && r.hasChildren)).toBe(true);

    // Buckets partition the letter with no gaps and each ≤ cap.
    let total = 0;
    for (const r of rows) {
      const parsed = parseMediaId(r.id);
      expect(parsed.kind).toBe('azBucket');
      if (parsed.kind === 'azBucket') {
        const bucketAlbums = albumsForBucket(albums, 'S', parsed.lo, parsed.hi);
        expect(bucketAlbums.length).toBeLessThanOrEqual(CAR_MAX_ITEMS_PER_NODE);
        total += bucketAlbums.length;
      }
    }
    expect(total).toBe(inLetter.length);
  });
});
