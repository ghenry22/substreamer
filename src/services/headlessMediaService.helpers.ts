/**
 * Pure, store-free helpers for the CarPlay / Android Auto browse tree — the
 * media-id scheme and the A–Z bucketing for large album libraries. Kept free of
 * stores + native so it's unit-testable in jest. `headlessMediaService.ts` supplies the
 * data + artwork and wires these into the RNQP handler.
 *
 * ID scheme (`type:payload`, colon-delimited, one `parseMediaId` dispatcher):
 *   section:{home,favorites,albums,playlists}   — section anchors (not tapped)
 *   list:{recentlyAdded,recentlyPlayed,frequentlyPlayed,random,downloadedAlbums}
 *   az:albums:<L>[:<lo>-<hi>]                    — Albums letter buckets
 *   album:<id> / playlist:<id>                   — drill → tracks
 *   track:album:<albumId>:<i> / track:playlist:<playlistId>:<i> / track:fav:<i>
 *   shuffle:<playlistId>                         — "Shuffle play" row inside a playlist
 *
 * `playable` and `hasChildren` are mutually exclusive (RNQP): list/album/
 * playlist/az rows are `hasChildren`; track rows are `playable`.
 */
import type { BrowseItem } from 'react-native-queue-player';

import { baseCollator } from '../utils/intl';

/** Per-node item cap (CarPlay `CPListTemplate.maximumItemCount` / Android Auto). */
export const CAR_MAX_ITEMS_PER_NODE = 500;

export const CAR_ROOT_ID = 'root';

/* ------------------------------------------------------------------ */
/*  ID builders                                                        */
/* ------------------------------------------------------------------ */

export const sectionId = (section: string): string => `section:${section}`;
export const listId = (list: string): string => `list:${list}`;
export const albumId = (id: string): string => `album:${id}`;
export const playlistId = (id: string): string => `playlist:${id}`;
export const azLetterId = (letter: string): string => `az:albums:${letter}`;
export const azBucketId = (letter: string, lo: string, hi: string): string =>
  `az:albums:${letter}:${lo}-${hi}`;
export const albumTrackId = (albumIdVal: string, index: number): string =>
  `track:album:${albumIdVal}:${index}`;
export const playlistTrackId = (playlistIdVal: string, index: number): string =>
  `track:playlist:${playlistIdVal}:${index}`;
export const playlistShuffleId = (id: string): string => `shuffle:${id}`;
export const favTrackId = (index: number): string => `track:fav:${index}`;

/* ------------------------------------------------------------------ */
/*  ID parsing                                                         */
/* ------------------------------------------------------------------ */

export type CarMediaId =
  | { kind: 'section'; section: string }
  | { kind: 'list'; list: string }
  | { kind: 'album'; albumId: string }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'shuffle'; playlistId: string }
  | { kind: 'azLetter'; letter: string }
  | { kind: 'azBucket'; letter: string; lo: string; hi: string }
  | { kind: 'track'; ctx: 'album' | 'playlist' | 'fav'; ctxId: string; index: number }
  | { kind: 'unknown'; raw: string };

/**
 * Parse a media id into a discriminated shape. Robust to ids whose payload
 * contains colons (Subsonic ids rarely do, but `az` buckets and any exotic id
 * are handled by anchoring on the leading type token and the trailing index).
 */
export function parseMediaId(id: string): CarMediaId {
  const firstColon = id.indexOf(':');
  if (firstColon === -1) return { kind: 'unknown', raw: id };
  const type = id.slice(0, firstColon);
  const rest = id.slice(firstColon + 1);

  switch (type) {
    case 'section':
      return { kind: 'section', section: rest };
    case 'list':
      return { kind: 'list', list: rest };
    case 'album':
      return { kind: 'album', albumId: rest };
    case 'playlist':
      return { kind: 'playlist', playlistId: rest };
    case 'shuffle':
      return rest === '' ? { kind: 'unknown', raw: id } : { kind: 'shuffle', playlistId: rest };
    case 'az': {
      // rest = `albums:<L>` or `albums:<L>:<lo>-<hi>`
      const parts = rest.split(':');
      if (parts[0] !== 'albums' || parts.length < 2) return { kind: 'unknown', raw: id };
      const letter = parts[1];
      if (parts.length === 2) return { kind: 'azLetter', letter };
      const range = parts.slice(2).join(':');
      const dash = range.indexOf('-');
      if (dash === -1) return { kind: 'unknown', raw: id };
      return { kind: 'azBucket', letter, lo: range.slice(0, dash), hi: range.slice(dash + 1) };
    }
    case 'track': {
      // rest = `album:<id>:<i>` | `playlist:<id>:<i>` | `fav:<i>`
      const parts = rest.split(':');
      const ctx = parts[0];
      const index = Number(parts[parts.length - 1]);
      if (!Number.isInteger(index) || index < 0) return { kind: 'unknown', raw: id };
      if (ctx === 'fav') return { kind: 'track', ctx: 'fav', ctxId: '', index };
      if (ctx === 'album' || ctx === 'playlist') {
        const ctxId = parts.slice(1, -1).join(':');
        if (ctxId === '') return { kind: 'unknown', raw: id };
        return { kind: 'track', ctx, ctxId, index };
      }
      return { kind: 'unknown', raw: id };
    }
    default:
      return { kind: 'unknown', raw: id };
  }
}

/* ------------------------------------------------------------------ */
/*  A–Z bucketing (over `{ id, title }`)                               */
/* ------------------------------------------------------------------ */

export interface AzItem {
  id: string;
  title: string;
  /** Optional cover-art value carried through so leaf rows can render artwork
   *  (the A–Z bucketing itself only uses `title`). */
  coverArt?: string;
  /** Optional subtitle (album artist) carried through so leaf rows match the
   *  home-list album rows (the A–Z bucketing itself only uses `title`). */
  subtitle?: string;
}

/** Bucket key for a title: uppercased first char, or '#' for non-alpha. */
export function bucketLetter(title: string): string {
  const c = (title ?? '').trim().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

/** Lowercased second char of a title (for sub-bucketing), '#' if absent. */
function secondChar(title: string): string {
  return ((title ?? '').trim().charAt(1) || '#').toLowerCase();
}

/** Sort letters A–Z with '#' (non-alpha) always last. */
function compareLetters(x: string, y: string): number {
  if (x === '#') return 1;
  if (y === '#') return -1;
  return baseCollator.compare(x, y);
}

/** The Albums tab's top level: one row per non-empty letter bucket. */
export function albumLetterRows(albums: ReadonlyArray<AzItem>): BrowseItem[] {
  const letters = new Set<string>();
  for (const a of albums) letters.add(bucketLetter(a.title));
  return [...letters].sort(compareLetters).map((letter) => ({
    id: azLetterId(letter),
    title: letter,
    playable: false,
    hasChildren: true,
  }));
}

/** Albums whose title falls in `letter`, title-sorted. */
export function albumsForLetter(albums: ReadonlyArray<AzItem>, letter: string): AzItem[] {
  return albums
    .filter((a) => bucketLetter(a.title) === letter)
    .sort((a, b) => baseCollator.compare(a.title, b.title));
}

/**
 * Resolve a letter node → album rows (via `toAlbumRow`), or — when the letter
 * exceeds the per-node cap — second-char sub-bucket rows (`az:albums:<L>:<lo>-<hi>`)
 * so every child stays under the cap.
 */
export async function resolveAlbumLetterNode(
  albumsInLetter: ReadonlyArray<AzItem>,
  letter: string,
  toAlbumRow: (a: AzItem) => Promise<BrowseItem>,
): Promise<BrowseItem[]> {
  if (albumsInLetter.length <= CAR_MAX_ITEMS_PER_NODE) {
    return Promise.all(albumsInLetter.map(toAlbumRow));
  }
  // Pack consecutive second-char groups into non-overlapping buckets <= cap.
  const counts = new Map<string, number>();
  for (const a of albumsInLetter) {
    const c = secondChar(a.title);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const chars = [...counts.keys()].sort();
  const buckets: BrowseItem[] = [];
  let i = 0;
  while (i < chars.length) {
    let count = 0;
    let j = i;
    while (j < chars.length && count + counts.get(chars[j])! <= CAR_MAX_ITEMS_PER_NODE) {
      count += counts.get(chars[j])!;
      j += 1;
    }
    if (j === i) {
      // A single second char already exceeds the cap — take it alone (a real
      // catalog this fat would need a third level; two suffices in practice).
      count = counts.get(chars[j])!;
      j = i + 1;
    }
    const lo = chars[i];
    const hi = chars[j - 1];
    buckets.push({
      id: azBucketId(letter, lo, hi),
      title:
        lo === hi
          ? `${letter}${lo.toUpperCase()}`
          : `${letter}${lo.toUpperCase()}–${letter}${hi.toUpperCase()}`,
      subtitle: `${count} albums`,
      playable: false,
      hasChildren: true,
    });
    i = j;
  }
  return buckets;
}

/** Albums for a second-char sub-bucket `[lo..hi]` within a letter, title-sorted. */
export function albumsForBucket(
  albums: ReadonlyArray<AzItem>,
  letter: string,
  lo: string,
  hi: string,
): AzItem[] {
  return albumsForLetter(albums, letter).filter((a) => {
    const c = secondChar(a.title);
    return c >= lo && c <= hi;
  });
}
