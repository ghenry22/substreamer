/**
 * Convert the ids in a backup being restored onto an install the Navidrome re-key has
 * already converted. A backup taken before the server's 0.64 upgrade carries the retired
 * ids, and restored verbatim they would stay retired for good.
 *
 * Same allowlists as the pass: entity ids only, never a MusicBrainz id, a path, a
 * scrobble's own id or a bookmark's UUID. `canonicalId` is idempotent, so ids already in
 * the current form are left alone.
 */

import type { CompletedScrobble } from '../../store/completedScrobbleStore';
import type { PlayQueueBookmark } from '../../store/bookmarksStore';
import type { MbidOverride } from '../../store/mbidOverrideStore';
import type { ScrobbleExclusionMaps } from '../../store/persistence/scrobbleExclusionTable';
import { canonicalId } from './canonicalId';
import { remapIdsInObject } from './jsonEnvelope';
import { rekeyRecordKeys } from './reidKv';

const moved = (id: string): string | undefined => {
  const next = canonicalId(id);
  return next === id ? undefined : next;
};

export function convertRestoredScrobbles(scrobbles: CompletedScrobble[]): CompletedScrobble[] {
  return scrobbles.map((s) => ({ ...s, song: remapIdsInObject(s.song, moved) }));
}

export function convertRestoredBookmarks(
  bookmarks: Record<string, PlayQueueBookmark>,
): Record<string, PlayQueueBookmark> {
  const out: Record<string, PlayQueueBookmark> = {};
  for (const [key, bookmark] of Object.entries(bookmarks)) {
    out[key] = { ...bookmark, queue: bookmark.queue.map((song) => remapIdsInObject(song, moved)) };
  }
  return out;
}

export function convertRestoredMbidOverrides(
  overrides: Record<string, MbidOverride>,
): Record<string, MbidOverride> {
  const out: Record<string, MbidOverride> = {};
  for (const [key, override] of Object.entries(overrides)) {
    // Malformed entries pass through; the store's replace and merge drop them.
    if (typeof override?.entityId !== 'string' || typeof override.type !== 'string') {
      out[key] = override;
      continue;
    }
    const entityId = moved(override.entityId) ?? override.entityId;
    out[`${override.type}:${entityId}`] = { ...override, entityId };
  }
  return out;
}

export function convertRestoredExclusions(data: ScrobbleExclusionMaps): ScrobbleExclusionMaps {
  const convert = (map: ScrobbleExclusionMaps['excludedAlbums']): ScrobbleExclusionMaps['excludedAlbums'] => {
    const rekeyed = rekeyRecordKeys(map) as ScrobbleExclusionMaps['excludedAlbums'];
    const out: ScrobbleExclusionMaps['excludedAlbums'] = {};
    for (const [key, exclusion] of Object.entries(rekeyed)) {
      out[key] = { ...exclusion, id: moved(exclusion.id) ?? exclusion.id };
    }
    return out;
  };
  return {
    excludedAlbums: convert(data.excludedAlbums ?? {}),
    excludedArtists: convert(data.excludedArtists ?? {}),
    excludedPlaylists: convert(data.excludedPlaylists ?? {}),
  };
}
