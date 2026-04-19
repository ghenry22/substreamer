jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { filterBarStore } from '../filterBarStore';
import { offlineModeStore } from '../offlineModeStore';

beforeEach(() => {
  offlineModeStore.setState({ offlineMode: false, showInFilterBar: true });
  filterBarStore.setState({ downloadedOnly: false });
});

describe('offlineModeStore', () => {
  it('toggleOfflineMode flips from false to true', () => {
    offlineModeStore.getState().toggleOfflineMode();
    expect(offlineModeStore.getState().offlineMode).toBe(true);
  });

  it('toggleOfflineMode flips from true to false', () => {
    offlineModeStore.setState({ offlineMode: true });
    offlineModeStore.getState().toggleOfflineMode();
    expect(offlineModeStore.getState().offlineMode).toBe(false);
  });

  it('setOfflineMode sets directly', () => {
    offlineModeStore.getState().setOfflineMode(true);
    expect(offlineModeStore.getState().offlineMode).toBe(true);
  });

  it('setShowInFilterBar updates state', () => {
    offlineModeStore.getState().setShowInFilterBar(false);
    expect(offlineModeStore.getState().showInFilterBar).toBe(false);
  });

  it('syncs downloadedOnly in filterBarStore when offlineMode changes', () => {
    offlineModeStore.getState().setOfflineMode(true);
    expect(filterBarStore.getState().downloadedOnly).toBe(true);
  });

  it('clears downloadedOnly when offlineMode goes false', () => {
    offlineModeStore.setState({ offlineMode: true });
    filterBarStore.setState({ downloadedOnly: true });
    offlineModeStore.getState().setOfflineMode(false);
    expect(filterBarStore.getState().downloadedOnly).toBe(false);
  });
});
