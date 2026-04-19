import { getImageCount, imageCacheStore } from '../imageCacheStore';

jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

beforeEach(() => {
  imageCacheStore.getState().reset();
});

describe('getImageCount', () => {
  it('divides fileCount by 4', () => {
    expect(getImageCount(8)).toBe(2);
    expect(getImageCount(12)).toBe(3);
    expect(getImageCount(1)).toBe(0);
  });

  it('returns 0 for zero fileCount', () => {
    expect(getImageCount(0)).toBe(0);
  });

  it('floors non-multiple file counts', () => {
    expect(getImageCount(7)).toBe(1);
    expect(getImageCount(3)).toBe(0);
  });
});

describe('imageCacheStore', () => {
  it('addFile increments totals', () => {
    imageCacheStore.getState().addFile(1000);
    imageCacheStore.getState().addFile(500);
    expect(imageCacheStore.getState().totalBytes).toBe(1500);
    expect(imageCacheStore.getState().fileCount).toBe(2);
  });

  it('removeFiles decrements totals', () => {
    imageCacheStore.setState({ totalBytes: 2000, fileCount: 4 });
    imageCacheStore.getState().removeFiles(2, 1000);
    expect(imageCacheStore.getState().totalBytes).toBe(1000);
    expect(imageCacheStore.getState().fileCount).toBe(2);
  });

  it('removeFiles does not go below zero', () => {
    imageCacheStore.setState({ totalBytes: 100, fileCount: 1 });
    imageCacheStore.getState().removeFiles(5, 500);
    expect(imageCacheStore.getState().totalBytes).toBe(0);
    expect(imageCacheStore.getState().fileCount).toBe(0);
  });

  it('recalculate sets totals from provided stats', () => {
    imageCacheStore.setState({ totalBytes: 999, fileCount: 99 });
    imageCacheStore.getState().recalculate({ totalBytes: 2000, imageCount: 5 });
    expect(imageCacheStore.getState().totalBytes).toBe(2000);
    expect(imageCacheStore.getState().fileCount).toBe(20);
  });

  it('reset restores to initial state', () => {
    imageCacheStore.setState({ totalBytes: 5000, fileCount: 10 });
    imageCacheStore.getState().reset();
    expect(imageCacheStore.getState().totalBytes).toBe(0);
    expect(imageCacheStore.getState().fileCount).toBe(0);
  });

  it('setMaxConcurrentImageDownloads updates the setting', () => {
    imageCacheStore.getState().setMaxConcurrentImageDownloads(10);
    expect(imageCacheStore.getState().maxConcurrentImageDownloads).toBe(10);
    imageCacheStore.getState().setMaxConcurrentImageDownloads(1);
    expect(imageCacheStore.getState().maxConcurrentImageDownloads).toBe(1);
  });
});
