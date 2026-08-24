import { getRandomSongs, getSimilarSongs } from './subsonicService';

import type { Child } from './subsonicService';

export async function fetchSimilarSongsOrRandom(
  songId: string,
  target: number,
): Promise<Child[]> {
  const similar = await getSimilarSongs(songId, target);
  if (similar.length > 0) return similar;
  return (await getRandomSongs(target)) ?? [];
}
