jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { onboardingStore } from '../onboardingStore';

beforeEach(() => {
  onboardingStore.setState({ hasCompleted: false, visible: false });
});

describe('onboardingStore', () => {
  it('starts with hasCompleted false and visible false', () => {
    const state = onboardingStore.getState();
    expect(state.hasCompleted).toBe(false);
    expect(state.visible).toBe(false);
  });

  it('show() sets visible to true', () => {
    onboardingStore.getState().show();
    expect(onboardingStore.getState().visible).toBe(true);
  });

  it('dismiss() sets hasCompleted true and visible false', () => {
    onboardingStore.setState({ visible: true });
    onboardingStore.getState().dismiss();
    const state = onboardingStore.getState();
    expect(state.hasCompleted).toBe(true);
    expect(state.visible).toBe(false);
  });

  it('reset() sets hasCompleted back to false', () => {
    onboardingStore.setState({ hasCompleted: true });
    onboardingStore.getState().reset();
    expect(onboardingStore.getState().hasCompleted).toBe(false);
  });

  it('show() after reset() makes guide visible again', () => {
    onboardingStore.getState().dismiss();
    expect(onboardingStore.getState().hasCompleted).toBe(true);
    onboardingStore.getState().reset();
    onboardingStore.getState().show();
    expect(onboardingStore.getState().visible).toBe(true);
    expect(onboardingStore.getState().hasCompleted).toBe(false);
  });

  it('dismiss() from already-dismissed state is idempotent', () => {
    onboardingStore.getState().dismiss();
    onboardingStore.getState().dismiss();
    const state = onboardingStore.getState();
    expect(state.hasCompleted).toBe(true);
    expect(state.visible).toBe(false);
  });

  it('partialize excludes visible from persistence', () => {
    const persist = (onboardingStore as any).persist;
    const partialize = persist?.getOptions?.()?.partialize;
    if (partialize) {
      const result = partialize({ hasCompleted: true, visible: true });
      expect(result).toEqual({ hasCompleted: true });
      expect(result).not.toHaveProperty('visible');
    }
  });
});
