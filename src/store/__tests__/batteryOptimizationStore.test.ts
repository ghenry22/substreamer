jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { batteryOptimizationStore } from '../batteryOptimizationStore';

beforeEach(() => {
  batteryOptimizationStore.setState({ restricted: null });
});

describe('batteryOptimizationStore', () => {
  it('has null restricted by default', () => {
    expect(batteryOptimizationStore.getState().restricted).toBeNull();
  });

  it('setRestricted sets to true', () => {
    batteryOptimizationStore.getState().setRestricted(true);
    expect(batteryOptimizationStore.getState().restricted).toBe(true);
  });

  it('setRestricted sets to false', () => {
    batteryOptimizationStore.getState().setRestricted(false);
    expect(batteryOptimizationStore.getState().restricted).toBe(false);
  });

  it('setRestricted can toggle between states', () => {
    batteryOptimizationStore.getState().setRestricted(true);
    expect(batteryOptimizationStore.getState().restricted).toBe(true);

    batteryOptimizationStore.getState().setRestricted(false);
    expect(batteryOptimizationStore.getState().restricted).toBe(false);
  });
});
