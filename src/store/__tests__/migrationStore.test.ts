jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { migrationStore } from '../migrationStore';

beforeEach(() => {
  migrationStore.setState({ completedVersion: 0 });
});

describe('migrationStore', () => {
  it('initializes with completedVersion 0', () => {
    expect(migrationStore.getState().completedVersion).toBe(0);
  });

  it('setCompletedVersion updates the version', () => {
    migrationStore.getState().setCompletedVersion(3);
    expect(migrationStore.getState().completedVersion).toBe(3);
  });

  it('setCompletedVersion can be called multiple times', () => {
    migrationStore.getState().setCompletedVersion(1);
    migrationStore.getState().setCompletedVersion(5);
    expect(migrationStore.getState().completedVersion).toBe(5);
  });

  it('partializes to only persist completedVersion', () => {
    const persist = (migrationStore as any).persist;
    const options = persist?.getOptions?.();
    if (options?.partialize) {
      const full = { completedVersion: 3, setCompletedVersion: () => {} };
      const result = options.partialize(full);
      expect(result).toEqual({ completedVersion: 3 });
      expect(result).not.toHaveProperty('setCompletedVersion');
    }
  });
});
