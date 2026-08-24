jest.mock('../subsonicService');

import {
  getRandomSongs,
  getRandomSongsFiltered,
  getSimilarSongs,
  getSimilarSongs2,
  getTopSongs,
  type Child,
} from '../subsonicService';
import { fetchSimilarSongsOrRandom } from '../recommendationService';

const song = (id: string) => ({ id, title: id } as Child);

beforeEach(() => {
  jest.clearAllMocks();
  (getSimilarSongs as jest.Mock).mockResolvedValue([]);
  (getRandomSongs as jest.Mock).mockResolvedValue([]);
});

function expectNoOtherEndpoints(): void {
  expect(getSimilarSongs2).not.toHaveBeenCalled();
  expect(getRandomSongsFiltered).not.toHaveBeenCalled();
  expect(getTopSongs).not.toHaveBeenCalled();
}

it('returns non-empty similar songs without calling a fallback', async () => {
  const similar = [song('similar')];
  (getSimilarSongs as jest.Mock).mockResolvedValue(similar);

  await expect(fetchSimilarSongsOrRandom('source', 3)).resolves.toEqual(similar);
  expect(getSimilarSongs).toHaveBeenCalledWith('source', 3);
  expect(getRandomSongs).not.toHaveBeenCalled();
  expectNoOtherEndpoints();
});

it('calls random songs once when similar songs are empty', async () => {
  const random = [song('random')];
  (getRandomSongs as jest.Mock).mockResolvedValue(random);

  await expect(fetchSimilarSongsOrRandom('source', 3)).resolves.toEqual(random);
  expect(getSimilarSongs).toHaveBeenCalledWith('source', 3);
  expect(getRandomSongs).toHaveBeenCalledTimes(1);
  expect(getRandomSongs).toHaveBeenCalledWith(3);
  expectNoOtherEndpoints();
});

it('returns an empty array when both endpoints return no songs', async () => {
  (getRandomSongs as jest.Mock).mockResolvedValue(null);

  await expect(fetchSimilarSongsOrRandom('source', 3)).resolves.toEqual([]);
  expect(getRandomSongs).toHaveBeenCalledTimes(1);
  expectNoOtherEndpoints();
});
