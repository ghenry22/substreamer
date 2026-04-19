jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { autoOfflineStore } from '../autoOfflineStore';

beforeEach(() => {
  autoOfflineStore.setState({
    enabled: false,
    mode: 'wifi-only',
    homeSSIDs: [],
    locationPermissionGranted: false,
  });
});

describe('autoOfflineStore', () => {
  it('setEnabled updates enabled', () => {
    autoOfflineStore.getState().setEnabled(true);
    expect(autoOfflineStore.getState().enabled).toBe(true);
  });

  it('setMode updates mode', () => {
    autoOfflineStore.getState().setMode('home-wifi');
    expect(autoOfflineStore.getState().mode).toBe('home-wifi');
  });

  it('addSSID appends a new SSID', () => {
    autoOfflineStore.getState().addSSID('HomeWifi');
    expect(autoOfflineStore.getState().homeSSIDs).toEqual(['HomeWifi']);
  });

  it('addSSID does not add duplicate', () => {
    autoOfflineStore.getState().addSSID('HomeWifi');
    autoOfflineStore.getState().addSSID('HomeWifi');
    expect(autoOfflineStore.getState().homeSSIDs).toEqual(['HomeWifi']);
  });

  it('addSSID appends different SSIDs', () => {
    autoOfflineStore.getState().addSSID('Home');
    autoOfflineStore.getState().addSSID('Office');
    expect(autoOfflineStore.getState().homeSSIDs).toEqual(['Home', 'Office']);
  });

  it('removeSSID removes the SSID', () => {
    autoOfflineStore.setState({ homeSSIDs: ['Home', 'Office'] });
    autoOfflineStore.getState().removeSSID('Home');
    expect(autoOfflineStore.getState().homeSSIDs).toEqual(['Office']);
  });

  it('removeSSID is safe for non-existing SSID', () => {
    autoOfflineStore.setState({ homeSSIDs: ['Home'] });
    autoOfflineStore.getState().removeSSID('NonExistent');
    expect(autoOfflineStore.getState().homeSSIDs).toEqual(['Home']);
  });

  it('updateSSID replaces old with new', () => {
    autoOfflineStore.setState({ homeSSIDs: ['Home', 'Office'] });
    autoOfflineStore.getState().updateSSID('Home', 'NewHome');
    expect(autoOfflineStore.getState().homeSSIDs).toEqual(['NewHome', 'Office']);
  });

  it('updateSSID leaves others unchanged', () => {
    autoOfflineStore.setState({ homeSSIDs: ['A', 'B', 'C'] });
    autoOfflineStore.getState().updateSSID('B', 'D');
    expect(autoOfflineStore.getState().homeSSIDs).toEqual(['A', 'D', 'C']);
  });

  it('setLocationPermissionGranted updates state', () => {
    autoOfflineStore.getState().setLocationPermissionGranted(true);
    expect(autoOfflineStore.getState().locationPermissionGranted).toBe(true);
  });
});
