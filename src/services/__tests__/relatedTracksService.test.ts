const mockOffline = { offlineMode: false };
const mockCachedSongs: Record<string, unknown> = {};
const mockEnvelopes: Record<string, any> = {};

jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: { getState: () => mockOffline },
}));
jest.mock('../../store/layoutPreferencesStore', () => ({
  layoutPreferencesStore: { getState: () => ({ listLength: 3 }) },
}));
jest.mock('../../store/musicCacheStore', () => ({
  musicCacheStore: { getState: () => ({ cachedSongs: mockCachedSongs }) },
  getSongEnvelope: (id: string) => mockEnvelopes[id] ?? null,
}));
jest.mock('../subsonicService');
jest.mock('../../utils/arrayHelpers', () => ({ shuffleArray: <T>(items: T[]) => items }));

import {
  getRandomSongs,
  getRandomSongsFiltered,
  getSimilarSongs,
  getSimilarSongs2,
  getTopSongs,
  type Child,
} from '../subsonicService';
import { buildAutoplayQueue, buildMoreLikeThisQueue } from '../relatedTracksService';

const song = (id: string, fields: Partial<Child> = {}) => ({ id, title: id, ...fields } as Child);
const options = (queue: Child[] = [song('source')]) => ({
  currentQueue: queue,
  currentTrackIndex: queue.length - 1,
  target: 3,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline.offlineMode = false;
  for (const key of Object.keys(mockCachedSongs)) delete mockCachedSongs[key];
  for (const key of Object.keys(mockEnvelopes)) delete mockEnvelopes[key];
  (getSimilarSongs as jest.Mock).mockResolvedValue([]);
  (getSimilarSongs2 as jest.Mock).mockResolvedValue([]);
  (getRandomSongsFiltered as jest.Mock).mockResolvedValue([]);
  (getTopSongs as jest.Mock).mockResolvedValue([]);
  (getRandomSongs as jest.Mock).mockResolvedValue([]);
});

it('shares the ordered online fallback chain with more-like-this', async () => {
  (getSimilarSongs as jest.Mock).mockResolvedValue([song('similar')]);
  (getSimilarSongs2 as jest.Mock).mockResolvedValue([song('artist')]);
  (getRandomSongsFiltered as jest.Mock).mockResolvedValue([song('genre')]);
  const source = song('source', { artistId: 'artist-id', artist: 'Artist', genre: 'Rock' });

  await expect(buildMoreLikeThisQueue(source, 3)).resolves.toEqual([
    song('similar'),
    song('artist'),
    song('genre'),
  ]);
  expect(getTopSongs).not.toHaveBeenCalled();
});

it('returns one usable similar song without topping up from random', async () => {
  (getSimilarSongs as jest.Mock).mockResolvedValue([song('similar')]);
  (getSimilarSongs2 as jest.Mock).mockResolvedValue([song('artist')]);
  (getRandomSongsFiltered as jest.Mock).mockResolvedValue([song('genre')]);
  const result = await buildAutoplayQueue(
    song('source', { artistId: 'artist-id', artist: 'Artist', genre: 'Rock' }),
    options(),
  );
  expect(result.map((track) => track.id)).toEqual(['similar']);
  expect(getSimilarSongs2).not.toHaveBeenCalled();
  expect(getRandomSongsFiltered).not.toHaveBeenCalled();
  expect(getTopSongs).not.toHaveBeenCalled();
  expect(getRandomSongs).not.toHaveBeenCalled();
});

it('falls through to random when similarity returns only the source', async () => {
  (getSimilarSongs as jest.Mock).mockResolvedValue([song('source')]);
  (getRandomSongs as jest.Mock).mockResolvedValue([song('random')]);

  await expect(buildAutoplayQueue(song('source'), options())).resolves.toEqual([
    song('random'),
  ]);
  expect(getRandomSongs).toHaveBeenCalledTimes(1);
});

it('falls through to random when similar songs are already in the queue', async () => {
  const played = song('played');
  const source = song('source');
  const upcoming = song('upcoming');
  (getSimilarSongs as jest.Mock).mockResolvedValue([played, upcoming]);
  (getRandomSongs as jest.Mock).mockResolvedValue([song('random')]);

  await expect(buildAutoplayQueue(source, {
    currentQueue: [played, source, upcoming],
    currentTrackIndex: 1,
    target: 3,
  })).resolves.toEqual([song('random')]);
  expect(getRandomSongs).toHaveBeenCalledTimes(1);
});

it('normalizes an object genre for the explicit-action fallback', async () => {
  (getRandomSongsFiltered as jest.Mock).mockResolvedValue([song('genre')]);
  const source = song('source', {
    genres: [{ name: 'Rock' }] as unknown as string[],
  });

  await expect(buildMoreLikeThisQueue(source, 3)).resolves.toEqual([song('genre')]);
  expect(getRandomSongsFiltered).toHaveBeenCalledWith({ size: 6, genre: 'Rock' });
});

it('uses downloaded genre tracks first, then all downloads', async () => {
  mockOffline.offlineMode = true;
  Object.assign(mockCachedSongs, { jazz: {}, rock: {}, other: {} });
  Object.assign(mockEnvelopes, {
    jazz: song('jazz', { genre: 'Jazz' }),
    rock: song('rock', { genre: 'Rock' }),
    other: song('other'),
  });
  const result = await buildAutoplayQueue(song('source', { genre: 'Rock' }), options());
  expect(result.map((track) => track.id)).toEqual(['rock', 'jazz', 'other']);
  expect(getSimilarSongs).not.toHaveBeenCalled();
});

it('matches object and string genre shapes in the downloaded library', async () => {
  mockOffline.offlineMode = true;
  Object.assign(mockCachedSongs, { jazz: {}, rock: {} });
  Object.assign(mockEnvelopes, {
    jazz: song('jazz', { genres: ['Jazz'] }),
    rock: song('rock', { genres: ['Rock'] }),
  });
  const source = song('source', {
    genres: [{ name: 'Rock' }] as unknown as string[],
  });

  const result = await buildAutoplayQueue(source, options());

  expect(result.map((track) => track.id)).toEqual(['rock', 'jazz']);
});

it('filters random songs and keeps fresh results ahead of played history', async () => {
  (getRandomSongs as jest.Mock).mockResolvedValue([
    song(''), song('source'), song('manual'), song('played'), song('fresh'), song('fresh'),
  ]);
  const result = await buildAutoplayQueue(song('source'), {
    ...options([song('played'), song('source')]),
    currentQueue: [song('played'), song('source'), song('manual')],
  });
  expect(result.map((track) => track.id)).toEqual(['fresh']);
});

it('recycles random played history when no fresh random song remains', async () => {
  (getRandomSongs as jest.Mock).mockResolvedValue([
    song('source'), song('manual'), song('played'), song('played'),
  ]);

  const result = await buildAutoplayQueue(song('source'), {
    currentQueue: [song('played'), song('source'), song('manual')],
    currentTrackIndex: 1,
    target: 3,
  });

  expect(result.map((track) => track.id)).toEqual(['played']);
});

it('does not recycle an autoplay track that is still ahead in the queue', async () => {
  const future = song('future-autoplay');
  (getSimilarSongs as jest.Mock).mockResolvedValue([future]);

  const result = await buildAutoplayQueue(song('source'), {
    ...options([song('source'), future]),
    currentTrackIndex: 0,
  });

  expect(result).toEqual([]);
  expect(getRandomSongs).toHaveBeenCalledTimes(1);
  expect(getSimilarSongs2).not.toHaveBeenCalled();
  expect(getRandomSongsFiltered).not.toHaveBeenCalled();
  expect(getTopSongs).not.toHaveBeenCalled();
});

it('uses random songs when similar songs are empty', async () => {
  (getRandomSongs as jest.Mock).mockResolvedValue([song('fallback')]);
  const source = song('source', { artistId: 'artist-id', artist: 'Artist', genre: 'Rock' });
  await expect(buildAutoplayQueue(source, options())).resolves.toEqual([song('fallback')]);
  expect(getRandomSongs).toHaveBeenCalledWith(3);
  expect(getSimilarSongs2).not.toHaveBeenCalled();
  expect(getRandomSongsFiltered).not.toHaveBeenCalled();
  expect(getTopSongs).not.toHaveBeenCalled();

  (getRandomSongs as jest.Mock).mockResolvedValue(null);
  await expect(buildAutoplayQueue(song('source'), options())).resolves.toEqual([]);
});

it('returns an empty batch when similar and random songs are empty', async () => {
  await expect(buildAutoplayQueue(song('source'), options())).resolves.toEqual([]);
  expect(getSimilarSongs).toHaveBeenCalledTimes(1);
  expect(getRandomSongs).toHaveBeenCalledTimes(1);
});
