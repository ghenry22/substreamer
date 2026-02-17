/**
 * Hook that checks whether an item is starred (favorited) by looking up
 * the `favoritesStore` – the single source of truth for starred state.
 *
 * Supports optimistic overrides so the UI updates instantly after a toggle,
 * before the server round-trip completes.
 */

import { useCallback } from 'react';

import { favoritesStore, type FavoritesState } from '../store/favoritesStore';

/**
 * Returns `true` when the item identified by `type` + `id` is starred.
 *
 * The hook subscribes to `favoritesStore` so re-renders happen automatically
 * when the starred state changes (including optimistic overrides).
 */
export function useIsStarred(type: 'song' | 'album' | 'artist', id: string): boolean {
  return favoritesStore(
    useCallback(
      (s: FavoritesState) => {
        if (!id) return false;
        if (id in s.overrides) return s.overrides[id];
        switch (type) {
          case 'song':
            return s.songs.some((song) => song.id === id);
          case 'album':
            return s.albums.some((album) => album.id === id);
          case 'artist':
            return s.artists.some((artist) => artist.id === id);
        }
      },
      [type, id],
    ),
  );
}
