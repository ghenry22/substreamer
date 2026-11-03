/**
 * Re-key the entity ids inside a stored Subsonic envelope.
 *
 * `cached_songs.raw_json` and `cached_items.raw_json` hold the verbatim server response for
 * a downloaded item, which is the only complete record of it we have — the hot columns
 * beside them are for indexing. Those envelopes carry the same ids as the columns, so they
 * go stale in exactly the same way.
 *
 * Rewritten by walking the parsed object against a KEY ALLOWLIST, never by string
 * replacement. A blind replace would corrupt free text that happens to contain an id
 * (a track called after a hash, a path, a comment) and, far worse, would rewrite
 * `musicBrainzId` — a dashed UUID that `canonicalId` will happily transform and that has
 * no server copy to restore it from.
 */

import { remapArtworkToken } from './artworkToken';

/** Keys whose STRING value is an entity id. */
const ID_KEYS: ReadonlySet<string> = new Set([
  'id',
  'parent',
  'albumId',
  'artistId',
  'songId',
  'playlistId',
  'itemId',
]);

/** Keys whose string value is an artwork token with an id inside it. */
const ARTWORK_KEYS: ReadonlySet<string> = new Set(['coverArt', 'coverArtId']);

/**
 * Keys that must never be rewritten even though their value is id-shaped. Listed
 * explicitly rather than relied on by omission: the walk only rewrites allowlisted keys,
 * so these are already safe — but naming them documents the hazard for the next reader,
 * and the test asserts it.
 */
export const NEVER_WALK: ReadonlySet<string> = new Set([
  'musicBrainzId',
  'musicBrainzTrackId',
  'mbid',
  'path',
]);

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Walk a parsed envelope, rewriting allowlisted keys. Returns a new value; the input is
 * not mutated, so a caller that decides not to write can simply drop the result.
 */
function walk(value: Json, lookup: (id: string) => string | undefined): Json {
  if (Array.isArray(value)) return value.map((v) => walk(v, lookup));
  if (value === null || typeof value !== 'object') return value;

  const out: { [k: string]: Json } = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && !NEVER_WALK.has(key)) {
      if (ID_KEYS.has(key)) {
        out[key] = lookup(child) ?? child;
        continue;
      }
      if (ARTWORK_KEYS.has(key)) {
        out[key] = remapArtworkToken(child, lookup) ?? child;
        continue;
      }
    }
    // Recurse into nested objects and arrays — `artists[]`, `albumArtists[]`,
    // `contributors[]` all carry their own `id`.
    out[key] = walk(child, lookup);
  }
  return out;
}

/** Rewrite the allowlisted ids inside an already-parsed object. The input is not mutated. */
export function remapIdsInObject<T>(value: T, lookup: (id: string) => string | undefined): T {
  return walk(value as unknown as Json, lookup) as unknown as T;
}

/**
 * Rewrite a stored JSON envelope, or return it unchanged.
 *
 * Unparseable input comes back as-is rather than throwing: a corrupt envelope is already a
 * problem, and losing it during a migration would turn a degraded row into a destroyed
 * one. Same for a parse that yields something other than an object.
 */
export function remapJsonEnvelope(
  raw: string | null | undefined,
  lookup: (id: string) => string | undefined,
): string | null | undefined {
  if (!raw) return raw;
  let parsed: Json;
  try {
    parsed = JSON.parse(raw) as Json;
  } catch {
    return raw;
  }
  if (parsed === null || typeof parsed !== 'object') return raw;

  const rewritten = walk(parsed, lookup);
  const next = JSON.stringify(rewritten);
  // Returning the original when nothing changed lets the caller skip the write.
  return next === raw ? raw : next;
}
