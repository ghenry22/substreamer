import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { childGenreNames } from '../db/childSnapshot';
import { getSongEnvelope, musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { shuffleArray } from '../utils/arrayHelpers';
import {
  getRandomSongs,
  getRandomSongsFiltered,
  getSimilarSongs,
  getSimilarSongs2,
  getTopSongs,
} from './subsonicService';

import type { Child } from './subsonicService';

const sourceGenre = (source: Child): string | undefined =>
  source.genre ?? childGenreNames(source)[0];

function downloadedSongs(): Child[] {
  return Object.keys(musicCacheStore.getState().cachedSongs)
    .map((id) => getSongEnvelope(id))
    .filter((song): song is Child => song !== null);
}

function onlineSources(source: Child, target: number): Array<() => Promise<Child[] | null>> {
  const sources: Array<() => Promise<Child[] | null>> = [
    () => getSimilarSongs(source.id, target),
  ];
  if (source.artistId) {
    const artistId = source.artistId;
    sources.push(() => getSimilarSongs2(artistId, target));
  }
  const genre = sourceGenre(source);
  if (genre) sources.push(() => getRandomSongsFiltered({ size: target * 2, genre }));
  if (source.artist) {
    const artist = source.artist;
    sources.push(() => getTopSongs(artist, target));
  }
  return sources;
}

/** Build the ordered fallback queue used by the explicit "more like this" action. */
export async function buildMoreLikeThisQueue(
  source: Child,
  target: number,
): Promise<Child[]> {
  const seen = new Set<string>([source.id]);
  const output: Child[] = [];
  for (const load of onlineSources(source, target)) {
    if (output.length >= target) return output;
    for (const track of (await load()) ?? []) {
      if (output.length >= target) return output;
      if (!track?.id || seen.has(track.id)) continue;
      seen.add(track.id);
      output.push(track);
    }
  }
  return output;
}

export interface AutoplayOptions {
  currentQueue: readonly Child[];
  currentTrackIndex: number;
  target?: number;
}

/** Build one best-effort autoplay batch, preferring tracks not already queued. */
export async function buildAutoplayQueue(
  source: Child,
  options: AutoplayOptions,
): Promise<Child[]> {
  const target = options.target ?? layoutPreferencesStore.getState().listLength;
  const playedIds = new Set(
    options.currentQueue.slice(0, options.currentTrackIndex).map((track) => track.id),
  );
  const futureIds = options.currentQueue
    .slice(options.currentTrackIndex + 1)
    .map((track) => track.id);
  const excluded = new Set<string>([source.id, ...futureIds]);
  const fresh: Child[] = [];
  const recycled: Child[] = [];
  const push = (tracks: readonly Child[]): void => {
    for (const track of tracks) {
      if (!track?.id || excluded.has(track.id)) continue;
      excluded.add(track.id);
      (playedIds.has(track.id) ? recycled : fresh).push(track);
    }
  };

  if (offlineModeStore.getState().offlineMode) {
    const all = downloadedSongs();
    const genre = sourceGenre(source);
    if (genre) push(shuffleArray(all.filter((song) => sourceGenre(song) === genre)));
    push(shuffleArray(all));
    return [...fresh, ...recycled].slice(0, target);
  }

  const classify = (tracks: readonly Child[]): { fresh: Child[]; recycled: Child[] } => {
    const seen = new Set(excluded);
    const usable: Child[] = [];
    const history: Child[] = [];
    for (const track of tracks) {
      if (!track?.id || seen.has(track.id)) continue;
      seen.add(track.id);
      (playedIds.has(track.id) ? history : usable).push(track);
    }
    return { fresh: usable.slice(0, target), recycled: history.slice(0, target) };
  };

  const similar = classify(await getSimilarSongs(source.id, target));
  if (similar.fresh.length > 0) return similar.fresh;

  const random = classify((await getRandomSongs(target)) ?? []);
  return random.fresh.length > 0 ? random.fresh : random.recycled;
}
