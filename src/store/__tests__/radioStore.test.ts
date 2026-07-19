jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');

import { getInternetRadioStations } from '../../services/subsonicService';
import { radioStore } from '../radioStore';

const mockGetStations = getInternetRadioStations as jest.Mock;

const station = {
  id: 'ir-1',
  name: 'Jazz FM',
  streamUrl: 'https://stream.jazzfm.example/live',
};

beforeEach(() => {
  radioStore.setState({ stations: [], loading: false, loaded: false });
  mockGetStations.mockReset();
});

describe('radioStore.fetchStations', () => {
  it('stores stations on success and marks the store loaded', async () => {
    mockGetStations.mockResolvedValue([station]);
    await radioStore.getState().fetchStations();
    expect(radioStore.getState().stations).toEqual([station]);
    expect(radioStore.getState().loading).toBe(false);
    expect(radioStore.getState().loaded).toBe(true);
  });

  it('keeps the previous list when the fetch fails (null)', async () => {
    radioStore.setState({ stations: [station] });
    mockGetStations.mockResolvedValue(null);
    await radioStore.getState().fetchStations();
    expect(radioStore.getState().stations).toEqual([station]);
    expect(radioStore.getState().loading).toBe(false);
    expect(radioStore.getState().loaded).toBe(true);
  });

  it('replaces the list with an empty result (stations deleted on server)', async () => {
    radioStore.setState({ stations: [station] });
    mockGetStations.mockResolvedValue([]);
    await radioStore.getState().fetchStations();
    expect(radioStore.getState().stations).toEqual([]);
  });

  it('sets loading while the fetch is in flight', async () => {
    let resolveFetch!: (v: unknown) => void;
    mockGetStations.mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    const promise = radioStore.getState().fetchStations();
    expect(radioStore.getState().loading).toBe(true);
    resolveFetch([]);
    await promise;
    expect(radioStore.getState().loading).toBe(false);
  });
});
